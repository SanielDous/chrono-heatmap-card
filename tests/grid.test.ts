import { describe, expect, it } from 'vitest';
import { buildGrid, gridCells, resolveWeekStart } from '../src/grid';

const TZ = 'Europe/Berlin';
const HOUR = 3_600_000;

function iso(ms: number, tz = TZ): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

describe('buildGrid', () => {
  it('day × hour: last row contains now, 24 columns on normal days', () => {
    const now = Date.parse('2026-06-10T12:30:00Z');
    const g = buildGrid('day', 'hour', 3, now, TZ, 1);
    expect(g.rows).toHaveLength(3);
    expect(g.columns).toBe(24);
    const last = g.rows[2];
    expect(last.start <= now && now < last.end).toBe(true);
    expect(iso(last.start)).toBe('2026-06-10 00:00');
    expect(iso(g.rows[0].start)).toBe('2026-06-08 00:00');
  });

  it('day × hour on spring DST day has 23 cells and padding', () => {
    const now = Date.parse('2026-03-30T10:00:00Z');
    const g = buildGrid('day', 'hour', 2, now, TZ, 1);
    const dst = g.rows[0]; // 2026-03-29
    expect(iso(dst.start)).toBe('2026-03-29 00:00');
    expect(dst.cells.filter(Boolean)).toHaveLength(23);
    expect(dst.cells[23]).toBeNull();
    expect(g.columns).toBe(24);
    expect(dst.end - dst.start).toBe(23 * HOUR);
  });

  it('day × hour on autumn DST day has 25 cells', () => {
    const now = Date.parse('2026-10-25T20:00:00Z');
    const g = buildGrid('day', 'hour', 2, now, TZ, 1);
    const dst = g.rows[1];
    expect(dst.cells.filter(Boolean)).toHaveLength(25);
    expect(g.columns).toBe(25);
    expect(g.rows[0].cells[24]).toBeNull();
  });

  it('cells never overlap and cover each row without gaps', () => {
    const now = Date.parse('2026-10-25T20:00:00Z');
    const g = buildGrid('week', 'hour', 2, now, TZ, 1);
    for (const r of g.rows) {
      const cells = r.cells.filter((c) => c !== null);
      expect(cells[0]!.start).toBe(r.start);
      expect(cells[cells.length - 1]!.end).toBe(r.end);
      for (let i = 1; i < cells.length; i++) expect(cells[i]!.start).toBe(cells[i - 1]!.end);
    }
  });

  it('month × day pads February', () => {
    const now = Date.parse('2026-03-15T10:00:00Z');
    const g = buildGrid('month', 'day', 2, now, TZ, 1);
    expect(g.columns).toBe(31);
    expect(g.rows[0].cells.filter(Boolean)).toHaveLength(28);
    expect(g.rows[0].cells.slice(28)).toEqual([null, null, null]);
  });

  it('week × day respects week start', () => {
    const now = Date.parse('2026-11-05T10:00:00Z'); // Thursday
    expect(iso(buildGrid('week', 'day', 1, now, TZ, 1).rows[0].start)).toBe('2026-11-02 00:00'); // Monday
    expect(iso(buildGrid('week', 'day', 1, now, TZ, 0).rows[0].start)).toBe('2026-11-01 00:00'); // Sunday
    expect(buildGrid('week', 'day', 1, now, TZ, 1).columns).toBe(7);
  });

  it('year × week: weeks belong to the year they start in', () => {
    const now = Date.parse('2026-06-01T10:00:00Z');
    const g = buildGrid('year', 'week', 2, now, TZ, 1);
    const y2026 = g.rows[1];
    expect(iso(y2026.cells[0]!.start)).toBe('2026-01-05 00:00');
    const y2025 = g.rows[0];
    const lastOf2025 = y2025.cells.filter(Boolean).at(-1)!;
    expect(iso(lastOf2025.start)).toBe('2025-12-29 00:00');
    expect(iso(lastOf2025.end)).toBe('2026-01-05 00:00');
    // no gap between the two years
    expect(lastOf2025.end).toBe(y2026.cells[0]!.start);
    expect(y2026.cells.filter(Boolean).length).toBeGreaterThanOrEqual(52);
  });

  it('year × month has 12 columns', () => {
    const g = buildGrid('year', 'month', 2, Date.parse('2026-06-01T10:00:00Z'), TZ, 1);
    expect(g.columns).toBe(12);
    expect(iso(g.rows[0].cells[0]!.start)).toBe('2025-01-01 00:00');
  });

  it('hour × 5minute has 12 columns, hour × minute 60', () => {
    const now = Date.parse('2026-06-01T10:17:00Z');
    expect(buildGrid('hour', '5minute', 3, now, TZ, 1).columns).toBe(12);
    expect(buildGrid('hour', 'minute', 3, now, TZ, 1).columns).toBe(60);
  });

  it('uses the given time zone', () => {
    const now = Date.parse('2026-06-10T02:00:00Z');
    const g = buildGrid('day', 'hour', 1, now, 'America/New_York', 1);
    expect(iso(g.rows[0].start, 'America/New_York')).toBe('2026-06-09 00:00');
  });

  it('gridCells returns cells in time order', () => {
    const g = buildGrid('day', 'hour', 2, Date.parse('2026-06-10T12:30:00Z'), TZ, 1);
    const cells = gridCells(g);
    expect(cells).toHaveLength(48);
    for (let i = 1; i < cells.length; i++) expect(cells[i].start).toBeGreaterThan(cells[i - 1].start);
  });
});

describe('resolveWeekStart', () => {
  it('uses explicit weekday', () => {
    expect(resolveWeekStart('sunday', 'de')).toBe(0);
    expect(resolveWeekStart('monday', 'en')).toBe(1);
  });
  it('falls back to the language', () => {
    expect(resolveWeekStart('language', 'de-DE')).toBe(1);
    expect(resolveWeekStart('language', 'en-US')).toBe(0);
  });
});
