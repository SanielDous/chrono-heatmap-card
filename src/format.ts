import type { Aggregation, ColumnUnit, RowUnit } from './config';
import type { Cell, Grid, GridRow } from './grid';
import { localize } from './i18n';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(lang: string, timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${timeZone}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { ...opts, timeZone });
    fmtCache.set(key, f);
  }
  return f;
}

export function formatRowLabel(row: GridRow, unit: RowUnit, lang: string, tz: string): string {
  switch (unit) {
    case 'hour':
      return dtf(lang, tz, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(row.start);
    case 'day':
      return dtf(lang, tz, { weekday: 'short', day: 'numeric', month: 'numeric' }).format(row.start);
    case 'week':
      return dtf(lang, tz, { day: 'numeric', month: 'numeric' }).format(row.start);
    case 'month':
      return dtf(lang, tz, { month: 'short', year: '2-digit' }).format(row.start);
    case 'year':
      return dtf(lang, tz, { year: 'numeric' }).format(row.start);
  }
}

/** Pick the row used for column labels: the latest row that has all columns. */
function referenceRow(grid: Grid): GridRow {
  for (let i = grid.rows.length - 1; i >= 0; i--) {
    if (grid.rows[i].cells.every((c) => c !== null)) return grid.rows[i];
  }
  return grid.rows[grid.rows.length - 1];
}

/**
 * Column labels; empty string = no label. `minSpacing` is the number of columns a label needs.
 */
export function columnLabels(grid: Grid, lang: string, minSpacing: number): string[] {
  const ref = referenceRow(grid);
  const tz = grid.timeZone;
  const step = Math.max(1, Math.ceil(minSpacing));
  return ref.cells.map((cell, i) => {
    if (!cell) return '';
    if (grid.rowUnit === 'week' && grid.columnUnit === 'hour') {
      // label day starts only
      const hour = Number(dtf('en-GB', tz, { hour: '2-digit', hourCycle: 'h23' }).format(cell.start));
      return hour === 0 ? dtf(lang, tz, { weekday: 'short' }).format(cell.start) : '';
    }
    if (i % step !== 0) return '';
    return formatColumn(cell, grid.columnUnit, grid.rowUnit, lang, tz, i);
  });
}

function formatColumn(cell: Cell, unit: ColumnUnit, _row: RowUnit, lang: string, tz: string, index: number): string {
  switch (unit) {
    case 'minute':
    case '5minute':
      return `:${dtf('en-GB', tz, { minute: '2-digit' }).format(cell.start).padStart(2, '0')}`;
    case 'hour':
      return dtf('en-GB', tz, { hour: '2-digit', hourCycle: 'h23' }).format(cell.start);
    case 'day':
      return _row === 'week'
        ? dtf(lang, tz, { weekday: 'short' }).format(cell.start)
        : String(index + 1);
    case 'week':
      return localize(lang, 'ui.week_short', { n: index + 1 });
    case 'month':
      return dtf(lang, tz, { month: 'short' }).format(cell.start);
  }
}

/** Approximate label width in columns-independent pixels, used for thinning. */
export function columnLabelWidth(unit: ColumnUnit, rowUnit: RowUnit): number {
  if (unit === 'month' || (unit === 'day' && rowUnit === 'week')) return 28;
  if (unit === 'week') return 30;
  return 22;
}

export function formatPeriod(cell: Cell, unit: ColumnUnit, lang: string, tz: string): string {
  switch (unit) {
    case 'minute':
    case '5minute':
    case 'hour': {
      const start = dtf(lang, tz, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(cell.start);
      const end = dtf(lang, tz, { hour: '2-digit', minute: '2-digit' }).format(cell.end);
      return `${start} – ${end}`;
    }
    case 'day':
      return dtf(lang, tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(cell.start);
    case 'week': {
      const f = dtf(lang, tz, { day: 'numeric', month: 'short', year: 'numeric' });
      return `${f.format(cell.start)} – ${f.format(cell.end - 1)}`;
    }
    case 'month':
      return dtf(lang, tz, { month: 'long', year: 'numeric' }).format(cell.start);
  }
}

export function formatValue(value: number, agg: Aggregation, unit: string | undefined, lang: string): string {
  if (agg === 'on_ratio') {
    const pct = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(value * 100);
    return localize(lang, 'ui.on_ratio_value', { value: pct });
  }
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const n = new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value);
  return unit ? `${n} ${unit}` : n;
}
