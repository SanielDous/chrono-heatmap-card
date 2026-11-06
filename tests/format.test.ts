import { describe, expect, it } from 'vitest';
import { columnLabels, formatPeriod, weekNumber } from '../src/format';
import { buildGrid } from '../src/grid';

const TZ = 'Europe/Berlin';

describe('weekNumber', () => {
  it('uses ISO weeks for Monday starts', () => {
    expect(weekNumber(Date.parse('2026-01-04T23:00:00Z'), TZ, 1)).toBe(2); // Mon 5 Jan 2026 local
    expect(weekNumber(Date.parse('2025-12-28T23:00:00Z'), TZ, 1)).toBe(1); // Mon 29 Dec 2025 = 2026-W01
    expect(weekNumber(Date.parse('2026-12-27T23:00:00Z'), TZ, 1)).toBe(53); // Mon 28 Dec 2026
  });

  it('uses week 1 = week of 1 January for Sunday starts', () => {
    expect(weekNumber(Date.parse('2026-01-04T12:00:00Z'), 'America/New_York', 0)).toBe(2); // Sun 4 Jan
    expect(weekNumber(Date.parse('2025-12-28T12:00:00Z'), 'America/New_York', 0)).toBe(1); // Sun 28 Dec
  });
});

describe('year × week labels', () => {
  const grid = buildGrid('year', 'week', 2, Date.parse('2026-06-01T10:00:00Z'), TZ, 1);

  it('labels columns with calendar weeks of the most recent year', () => {
    const labels = columnLabels(grid, 'de', 1);
    expect(labels[0]).toBe('KW2'); // first week starting in 2026: Mon 5 Jan
    expect(labels[1]).toBe('KW3');
  });

  it('shows the week number in the tooltip period', () => {
    const lastOf2025 = grid.rows[0].cells.filter(Boolean).at(-1)!;
    expect(formatPeriod(lastOf2025, 'week', 'de', TZ, 1)).toMatch(/^KW1 · 29\. Dez\. 2025 – 4\. Jan\. 2026$/);
  });
});
