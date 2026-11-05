import { TZDate } from '@date-fns/tz';
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
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

/** Cell boundaries [start, end, column] for one row. */
function cellBoundaries(
  rowStart: TZDate,
  rowEnd: TZDate,
  colUnit: ColumnUnit,
  weekStartsOn: WeekDay,
): [number, number, number][] {
  const out: [number, number, number][] = [];
  const endMs = rowEnd.getTime();
  const push = (start: number, end: number) => out.push([start, end, out.length]);
  switch (colUnit) {
    case 'minute':
    case '5minute': {
      const size = colUnit === 'minute' ? MINUTE : 5 * MINUTE;
      for (let t = rowStart.getTime(); t < endMs; t += size) push(t, Math.min(t + size, endMs));
      return out;
    }
    case 'hour': {
      // Place each hour by its wall-clock hour so columns line up across rows: on the spring DST day the
      // skipped hour stays empty; on the autumn DST day the repeated hour gets an extra column at the end.
      const tz = rowStart.timeZone ?? 'UTC';
      const perDay = 24;
      const days = Math.round(differenceInCalendarDays(rowEnd, rowStart));
      const used = new Set<number>();
      let extra = days * perDay;
      for (let t = rowStart.getTime(); t < endMs; t += HOUR) {
        const local = new TZDate(t, tz);
        let col = differenceInCalendarDays(local, rowStart) * perDay + local.getHours();
        if (used.has(col)) col = extra++;
        used.add(col);
        out.push([t, Math.min(t + HOUR, endMs), col]);
      }
      return out;
    }
    case 'day': {
      for (let d = rowStart; d.getTime() < endMs; d = addDays(d, 1))
        push(d.getTime(), addDays(d, 1).getTime());
      return out;
    }
    case 'month': {
      for (let d = rowStart; d.getTime() < endMs; d = addMonths(d, 1))
        push(d.getTime(), addMonths(d, 1).getTime());
      return out;
    }
    case 'week': {
      // A week belongs to the year in which its first day lies. Column 0 is the first week that starts in the year.
      let first = startOfWeek(rowStart, { weekStartsOn });
      if (first.getTime() < rowStart.getTime()) first = addWeeks(first, 1);
      for (let d = first; d.getTime() < endMs; d = addWeeks(d, 1))
        push(d.getTime(), addWeeks(d, 1).getTime());
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
  const raw: { start: TZDate; end: TZDate; bounds: [number, number, number][] }[] = [];
  for (let i = rowCount - 1; i >= 0; i--) {
    const start = addRowUnit(current, rowUnit, -i);
    const end = addRowUnit(start, rowUnit, 1);
    raw.push({ start, end, bounds: cellBoundaries(start, end, colUnit, weekStartsOn) });
  }
  let columns = 0;
  let start = raw[0].start.getTime();
  let end = raw[raw.length - 1].end.getTime();
  for (const r of raw) {
    for (const [s, e, col] of r.bounds) {
      if (col + 1 > columns) columns = col + 1;
      if (s < start) start = s;
      if (e > end) end = e; // year × week: the last week can extend into the next year
    }
  }
  const rows: GridRow[] = raw.map((r, rowIdx) => {
    const cells: (Cell | null)[] = Array.from({ length: columns }, () => null);
    for (const [start, end, col] of r.bounds) cells[col] = { start, end, row: rowIdx, col };
    return { start: r.start.getTime(), end: r.end.getTime(), cells };
  });

  return { rowUnit, columnUnit: colUnit, timeZone, weekStartsOn, rows, columns, start, end };
}

/** All non-null cells, in time order. */
export function gridCells(grid: Grid): Cell[] {
  const out: Cell[] = [];
  for (const r of grid.rows) for (const c of r.cells) if (c) out.push(c);
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Resolve the time zone the user wants (HA profile setting "local" or "server").
 */
export function resolveTimeZone(localeTz: string | undefined, serverTz: string | undefined): string {
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (localeTz === 'local') return browserTz || serverTz || 'UTC';
  return serverTz || browserTz || 'UTC';
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
