import { TZDate } from '@date-fns/tz';
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  addYears,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import type { ColumnUnit, RowUnit } from './config';

export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** One heatmap cell, covering [start, end) in epoch milliseconds. */
export interface Cell {
  start: number;
  end: number;
  row: number;
  col: number;
}

export interface GridRow {
  start: number;
  end: number;
  /** Padded with null up to `columns` for rows that are shorter than the longest row. */
  cells: (Cell | null)[];
}

export interface Grid {
  rowUnit: RowUnit;
  columnUnit: ColumnUnit;
  timeZone: string;
  weekStartsOn: WeekDay;
  rows: GridRow[];
  columns: number;
  /** Start of the first row / end of the last row */
  start: number;
  end: number;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

function rowStartOf(d: TZDate, unit: RowUnit, weekStartsOn: WeekDay): TZDate {
  switch (unit) {
    case 'hour':
      return startOfHour(d);
    case 'day':
      return startOfDay(d);
    case 'week':
      return startOfWeek(d, { weekStartsOn });
    case 'month':
      return startOfMonth(d);
    case 'year':
      return startOfYear(d);
  }
}

function addRowUnit(d: TZDate, unit: RowUnit, amount: number): TZDate {
  switch (unit) {
    case 'hour':
      return addHours(d, amount);
    case 'day':
      return addDays(d, amount);
    case 'week':
      return addWeeks(d, amount);
    case 'month':
      return addMonths(d, amount);
    case 'year':
      return addYears(d, amount);
  }
}

/** Cell boundaries [start, end) for one row. */
function cellBoundaries(
  rowStart: TZDate,
  rowEnd: TZDate,
  colUnit: ColumnUnit,
  weekStartsOn: WeekDay,
): [number, number][] {
  const out: [number, number][] = [];
  const endMs = rowEnd.getTime();
  switch (colUnit) {
    case 'minute':
    case '5minute':
    case 'hour': {
      // Fixed-length units: step in absolute time so DST days naturally get 23 or 25 hours.
      const size = colUnit === 'minute' ? MINUTE : colUnit === '5minute' ? 5 * MINUTE : HOUR;
      for (let t = rowStart.getTime(); t < endMs; t += size) out.push([t, Math.min(t + size, endMs)]);
      return out;
    }
    case 'day': {
      for (let d = rowStart; d.getTime() < endMs; d = addDays(d, 1)) {
        out.push([d.getTime(), addDays(d, 1).getTime()]);
      }
      return out;
    }
    case 'month': {
      for (let d = rowStart; d.getTime() < endMs; d = addMonths(d, 1)) {
        out.push([d.getTime(), addMonths(d, 1).getTime()]);
      }
      return out;
    }
    case 'week': {
      // A week belongs to the year in which its first day lies. Column 0 is the first week that starts in the year.
      let first = startOfWeek(rowStart, { weekStartsOn });
      if (first.getTime() < rowStart.getTime()) first = addWeeks(first, 1);
      for (let d = first; d.getTime() < endMs; d = addWeeks(d, 1)) {
        out.push([d.getTime(), addWeeks(d, 1).getTime()]);
      }
      return out;
    }
  }
}

/**
 * Build the heatmap grid: `rowCount` periods of `rowUnit`, the last one containing `now`.
 * All calendar math happens in `timeZone`.
 */
export function buildGrid(
  rowUnit: RowUnit,
  colUnit: ColumnUnit,
  rowCount: number,
  now: number,
  timeZone: string,
  weekStartsOn: WeekDay,
): Grid {
  const current = rowStartOf(new TZDate(now, timeZone), rowUnit, weekStartsOn);
  const raw: { start: TZDate; end: TZDate; bounds: [number, number][] }[] = [];
  for (let i = rowCount - 1; i >= 0; i--) {
    const start = addRowUnit(current, rowUnit, -i);
    const end = addRowUnit(start, rowUnit, 1);
    raw.push({ start, end, bounds: cellBoundaries(start, end, colUnit, weekStartsOn) });
  }
  const columns = Math.max(...raw.map((r) => r.bounds.length));
  const rows: GridRow[] = raw.map((r, rowIdx) => {
    const cells: (Cell | null)[] = r.bounds.map(([start, end], col) => ({ start, end, row: rowIdx, col }));
    while (cells.length < columns) cells.push(null);
    return { start: r.start.getTime(), end: r.end.getTime(), cells };
  });

  // For year × week the last week can extend into the next year.
  const lastCells = raw[raw.length - 1].bounds;
  const end = Math.max(raw[raw.length - 1].end.getTime(), lastCells[lastCells.length - 1]?.[1] ?? 0);
  const firstBounds = raw[0].bounds;
  const start = Math.min(raw[0].start.getTime(), firstBounds[0]?.[0] ?? Infinity);

  return { rowUnit, columnUnit: colUnit, timeZone, weekStartsOn, rows, columns, start, end };
}

/** All non-null cells, in time order. */
export function gridCells(grid: Grid): Cell[] {
  const out: Cell[] = [];
  for (const r of grid.rows) for (const c of r.cells) if (c) out.push(c);
  return out;
}

/**
 * Resolve the time zone the user wants (HA profile setting "local" or "server").
 */
export function resolveTimeZone(localeTz: string | undefined, serverTz: string | undefined): string {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (localeTz === 'server') return serverTz || browserTz;
  return browserTz || serverTz || 'UTC';
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Resolve the first day of week from HA's `first_weekday` setting ("language" or a day name). */
export function resolveWeekStart(firstWeekday: string | undefined, language: string): WeekDay {
  const idx = firstWeekday ? WEEKDAYS.indexOf(firstWeekday) : -1;
  if (idx >= 0) return idx as WeekDay;
  try {
    const loc = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info?.firstDay) return (info.firstDay % 7) as WeekDay; // Intl: 1 = Monday … 7 = Sunday
  } catch {
    // fall through
  }
  return 1;
}
