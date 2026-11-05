import type { Aggregation } from './config';
import type { Grid } from './grid';

/**
 * A base bucket is the smallest time slice the card works with (1 min, 5 min or 1 h).
 * Base buckets never overlap; cells are aggregated from them.
 */
export interface BaseBucket {
  start: number;
  end: number;
  /** Time-weighted mean of the bucket (for binary entities: share of "on" time, 0..1). */
  mean: number | null;
  min: number | null;
  max: number | null;
  /** Value at the end of the bucket. */
  last: number | null;
  /** Increase of a meter within the bucket (resets counted as increase from 0). */
  change: number | null;
  /** Share of time the entity was "on" (binary entities only). */
  onRatio: number | null;
  /** Milliseconds of the bucket that are covered by valid data. */
  coverage: number;
}

/** One row of `recorder/statistics_during_period` (times in epoch ms). */
export interface StatRow {
  start: number;
  end: number;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  state?: number | null;
  sum?: number | null;
  change?: number | null;
}

/** One state change: t = epoch ms, s = state string. */
export interface HistPoint {
  t: number;
  s: string;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function bucketsFromStatistics(rows: StatRow[]): BaseBucket[] {
  const out: BaseBucket[] = [];
  for (const r of rows) {
    const mean = num(r.mean) ?? num(r.state);
    const change = num(r.change);
    if (mean === null && change === null) continue;
    out.push({
      start: r.start,
      end: r.end,
      mean,
      min: num(r.min) ?? mean,
      max: num(r.max) ?? mean,
      last: num(r.state) ?? mean,
      change,
      onRatio: null,
      coverage: r.end - r.start,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

interface Acc {
  weighted: number;
  coverage: number;
  min: number;
  max: number;
  last: number | null;
  lastT: number;
  change: number;
  hasChange: boolean;
  on: number;
}

function newAcc(): Acc {
  return {
    weighted: 0,
    coverage: 0,
    min: Infinity,
    max: -Infinity,
    last: null,
    lastT: -Infinity,
    change: 0,
    hasChange: false,
    on: 0,
  };
}

/**
 * Turn raw state changes into base buckets of `sizeMs` between `from` and `to` (clipped at `now`).
 * Bucket boundaries are aligned to `from`.
 * - numeric mode: non-numeric states (unavailable, unknown, …) are gaps.
 * - binary mode: states in `onStates` count as on; unavailable/unknown are gaps; other states count as off.
 */
export function bucketsFromHistory(
  points: HistPoint[],
  from: number,
  to: number,
  sizeMs: number,
  mode: 'numeric' | 'binary',
  onStates: string[],
  now: number,
): BaseBucket[] {
  const end = Math.min(to, now);
  if (end <= from || points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);

  const valueOf = (s: string): number | null => {
    if (mode === 'binary') {
      if (s === 'unavailable' || s === 'unknown' || s === '') return null;
      return onStates.includes(s) ? 1 : 0;
    }
    const v = Number(s);
    return s.trim() !== '' && Number.isFinite(v) ? v : null;
  };

  const accs = new Map<number, Acc>();
  const accFor = (idx: number): Acc => {
    let a = accs.get(idx);
    if (!a) accs.set(idx, (a = newAcc()));
    return a;
  };

  let prevValid: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const v = valueOf(p.s);
    const segStart = Math.max(p.t, from);
    const segEnd = Math.min(i + 1 < sorted.length ? sorted[i + 1].t : end, end);

    // Meter change: count transitions that happen inside the window.
    if (mode === 'numeric' && v !== null && prevValid !== null && p.t > from && p.t < end) {
      const delta = v >= prevValid ? v - prevValid : v; // drop = reset → count from 0
      const a = accFor(Math.floor((p.t - from) / sizeMs));
      a.change += delta;
      a.hasChange = true;
    }
    if (v !== null) prevValid = v;

    if (v === null || segEnd <= segStart) continue;
    // Spread the segment over the buckets it touches.
    let t = segStart;
    while (t < segEnd) {
      const idx = Math.floor((t - from) / sizeMs);
      const bucketEnd = from + (idx + 1) * sizeMs;
      const sliceEnd = Math.min(segEnd, bucketEnd);
      const dur = sliceEnd - t;
      const a = accFor(idx);
      a.weighted += v * dur;
      a.coverage += dur;
      a.min = Math.min(a.min, v);
      a.max = Math.max(a.max, v);
      if (t >= a.lastT) {
        a.last = v;
        a.lastT = t;
      }
      if (mode === 'binary') a.on += v * dur;
      t = sliceEnd;
    }
  }

  const out: BaseBucket[] = [];
  for (const [idx, a] of [...accs.entries()].sort((x, y) => x[0] - y[0])) {
    const start = from + idx * sizeMs;
    if (start >= end) continue;
    if (a.coverage === 0 && !a.hasChange) continue;
    const covered = a.coverage > 0;
    out.push({
      start,
      end: Math.min(start + sizeMs, to),
      mean: covered ? a.weighted / a.coverage : null,
      min: covered ? a.min : null,
      max: covered ? a.max : null,
      last: a.last,
      change: mode === 'numeric' ? (a.hasChange ? a.change : covered ? 0 : null) : null,
      onRatio: mode === 'binary' && covered ? a.on / a.coverage : null,
      coverage: a.coverage,
    });
  }
  return out;
}

/** Combine statistics and history buckets; history only fills time not covered by statistics. */
export function mergeBuckets(stat: BaseBucket[], hist: BaseBucket[]): BaseBucket[] {
  const sortedStat = [...stat].sort((a, b) => a.start - b.start);
  const overlaps = (h: BaseBucket): boolean => {
    // binary search for the first stat bucket that ends after h.start
    let lo = 0;
    let hi = sortedStat.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedStat[mid].end <= h.start) lo = mid + 1;
      else hi = mid;
    }
    return lo < sortedStat.length && sortedStat[lo].start < h.end;
  };
  return [...sortedStat, ...hist.filter((h) => !overlaps(h))].sort((a, b) => a.start - b.start);
}

/**
 * Aggregate base buckets into the grid. Each bucket is assigned to the cell that contains its start.
 * Returns one value (or null for no data) per grid cell position.
 */
export function aggregateCells(grid: Grid, buckets: BaseBucket[], agg: Aggregation): (number | null)[][] {
  const groups = grid.rows.map((r) => r.cells.map(() => [] as BaseBucket[]));
  const flat: { start: number; end: number; row: number; col: number }[] = [];
  grid.rows.forEach((r, ri) => r.cells.forEach((c, ci) => c && flat.push({ ...c, row: ri, col: ci })));
  flat.sort((a, b) => a.start - b.start);

  for (const b of buckets) {
    let lo = 0;
    let hi = flat.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (flat[mid].start <= b.start) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) continue;
    const cell = flat[found];
    if (b.start >= cell.end) continue;
    groups[cell.row][cell.col].push(b);
  }

  return groups.map((row) => row.map((bs) => aggregate(bs, agg)));
}

function aggregate(bs: BaseBucket[], agg: Aggregation): number | null {
  if (bs.length === 0) return null;
  const weightedMean = (pick: (b: BaseBucket) => number | null): number | null => {
    let w = 0;
    let sum = 0;
    for (const b of bs) {
      const v = pick(b);
      if (v === null || b.coverage <= 0) continue;
      sum += v * b.coverage;
      w += b.coverage;
    }
    return w > 0 ? sum / w : null;
  };
  const values = (pick: (b: BaseBucket) => number | null): number[] =>
    bs.map(pick).filter((v): v is number => v !== null);

  switch (agg) {
    case 'mean':
      return weightedMean((b) => b.mean);
    case 'on_ratio':
      return weightedMean((b) => b.onRatio);
    case 'min': {
      const v = values((b) => b.min);
      return v.length ? Math.min(...v) : null;
    }
    case 'max': {
      const v = values((b) => b.max);
      return v.length ? Math.max(...v) : null;
    }
    case 'sum': {
      const v = values((b) => b.mean);
      return v.length ? v.reduce((a, c) => a + c, 0) : null;
    }
    case 'change': {
      const v = values((b) => b.change);
      return v.length ? v.reduce((a, c) => a + c, 0) : null;
    }
    case 'last': {
      for (let i = bs.length - 1; i >= 0; i--) if (bs[i].last !== null) return bs[i].last;
      return null;
    }
  }
}
