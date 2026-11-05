import { describe, expect, it } from 'vitest';
import { aggregateCells, bucketsFromHistory, bucketsFromStatistics, mergeBuckets } from '../src/buckets';
import type { BaseBucket } from '../src/buckets';
import { buildGrid } from '../src/grid';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-06-10T00:00:00Z');

describe('bucketsFromHistory (numeric)', () => {
  it('computes a time-weighted mean', () => {
    // 10 for 45 min, 20 for 15 min → 12.5
    const b = bucketsFromHistory(
      [
        { t: T0, s: '10' },
        { t: T0 + 45 * MIN, s: '20' },
      ],
      T0,
      T0 + HOUR,
      HOUR,
      'numeric',
      ['on'],
      T0 + 10 * HOUR,
    );
    expect(b).toHaveLength(1);
    expect(b[0].mean).toBeCloseTo(12.5);
    expect(b[0].min).toBe(10);
    expect(b[0].max).toBe(20);
    expect(b[0].last).toBe(20);
  });

  it('treats unavailable as a gap, not as zero', () => {
    const b = bucketsFromHistory(
      [
        { t: T0, s: '10' },
        { t: T0 + 30 * MIN, s: 'unavailable' },
      ],
      T0,
      T0 + HOUR,
      HOUR,
      'numeric',
      ['on'],
      T0 + 10 * HOUR,
    );
    expect(b[0].mean).toBe(10);
    expect(b[0].min).toBe(10);
    expect(b[0].coverage).toBe(30 * MIN);
  });

  it('splits segments over buckets and stops at now', () => {
    const b = bucketsFromHistory(
      [{ t: T0 - HOUR, s: '5' }],
      T0,
      T0 + 3 * HOUR,
      HOUR,
      'numeric',
      [],
      T0 + 90 * MIN,
    );
    expect(b.map((x) => x.start)).toEqual([T0, T0 + HOUR]);
    expect(b[1].coverage).toBe(30 * MIN);
  });

  it('counts meter changes per bucket and treats drops as resets', () => {
    const b = bucketsFromHistory(
      [
        { t: T0, s: '100' }, // start state, not a change
        { t: T0 + 10 * MIN, s: '101' },
        { t: T0 + 70 * MIN, s: '103' },
        { t: T0 + 80 * MIN, s: '1' }, // reset → +1
        { t: T0 + 90 * MIN, s: '2' },
      ],
      T0,
      T0 + 2 * HOUR,
      HOUR,
      'numeric',
      [],
      T0 + 10 * HOUR,
    );
    expect(b[0].change).toBe(1);
    expect(b[1].change).toBe(2 + 1 + 1);
  });

  it('change across a gap compares with the last valid value', () => {
    const b = bucketsFromHistory(
      [
        { t: T0, s: '10' },
        { t: T0 + 10 * MIN, s: 'unavailable' },
        { t: T0 + 20 * MIN, s: '12' },
      ],
      T0,
      T0 + HOUR,
      HOUR,
      'numeric',
      [],
      T0 + 10 * HOUR,
    );
    expect(b[0].change).toBe(2);
  });
});

describe('bucketsFromHistory (binary)', () => {
  it('computes the on ratio', () => {
    const b = bucketsFromHistory(
      [
        { t: T0, s: 'off' },
        { t: T0 + 30 * MIN, s: 'on' },
        { t: T0 + 45 * MIN, s: 'off' },
      ],
      T0,
      T0 + HOUR,
      HOUR,
      'binary',
      ['on'],
      T0 + 10 * HOUR,
    );
    expect(b[0].onRatio).toBeCloseTo(0.25);
    expect(b[0].change).toBeNull();
  });

  it('respects custom on_states and ignores unavailable time', () => {
    const b = bucketsFromHistory(
      [
        { t: T0, s: 'home' },
        { t: T0 + 30 * MIN, s: 'unavailable' },
      ],
      T0,
      T0 + HOUR,
      HOUR,
      'binary',
      ['home'],
      T0 + 10 * HOUR,
    );
    expect(b[0].onRatio).toBe(1);
  });
});

describe('bucketsFromStatistics', () => {
  it('maps mean and sum statistics', () => {
    const b = bucketsFromStatistics([
      { start: T0 + HOUR, end: T0 + 2 * HOUR, mean: 5, min: 1, max: 9 },
      { start: T0, end: T0 + HOUR, state: 100, sum: 50, change: 2 },
      { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR },
    ]);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ start: T0, mean: 100, change: 2, last: 100 });
    expect(b[1]).toMatchObject({ mean: 5, min: 1, max: 9, change: null });
  });
});

describe('mergeBuckets', () => {
  const mk = (start: number, end: number, mean: number): BaseBucket => ({
    start,
    end,
    mean,
    min: mean,
    max: mean,
    last: mean,
    change: null,
    onRatio: null,
    coverage: end - start,
  });

  it('prefers statistics and fills the rest from history without overlap', () => {
    const stat = [mk(T0, T0 + HOUR, 1), mk(T0 + HOUR, T0 + 2 * HOUR, 2)];
    const hist = [mk(T0 + HOUR, T0 + 2 * HOUR, 99), mk(T0 + 2 * HOUR, T0 + 3 * HOUR, 3)];
    const m = mergeBuckets(stat, hist);
    expect(m.map((b) => b.mean)).toEqual([1, 2, 3]);
  });
});

describe('aggregateCells', () => {
  const grid = buildGrid('day', 'hour', 1, T0 + 5 * HOUR, 'UTC', 1);
  const bucket = (
    start: number,
    size: number,
    mean: number,
    coverage = size,
    change: number | null = null,
  ) => ({
    start,
    end: start + size,
    mean,
    min: mean,
    max: mean,
    last: mean,
    change,
    onRatio: null,
    coverage,
  });

  it('weights means by coverage and leaves empty cells null', () => {
    const buckets = [
      bucket(T0, 5 * MIN, 10, 5 * MIN),
      bucket(T0 + 5 * MIN, 5 * MIN, 20, 1 * MIN),
      bucket(T0 + 2 * HOUR, 5 * MIN, 7),
    ];
    const v = aggregateCells(grid, buckets, 'mean');
    expect(v[0][0]).toBeCloseTo((10 * 5 + 20 * 1) / 6);
    expect(v[0][1]).toBeNull();
    expect(v[0][2]).toBe(7);
  });

  it('sums changes, takes min/max/last', () => {
    const buckets = [bucket(T0, 30 * MIN, 1, 30 * MIN, 2), bucket(T0 + 30 * MIN, 30 * MIN, 5, 30 * MIN, 3)];
    expect(aggregateCells(grid, buckets, 'change')[0][0]).toBe(5);
    expect(aggregateCells(grid, buckets, 'min')[0][0]).toBe(1);
    expect(aggregateCells(grid, buckets, 'max')[0][0]).toBe(5);
    expect(aggregateCells(grid, buckets, 'last')[0][0]).toBe(5);
    expect(aggregateCells(grid, buckets, 'sum')[0][0]).toBe(6);
  });

  it('ignores buckets outside the grid', () => {
    const v = aggregateCells(grid, [bucket(T0 - HOUR, HOUR, 3)], 'mean');
    expect(v[0].every((x) => x === null)).toBe(true);
  });
});
