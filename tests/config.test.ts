import { describe, expect, it } from 'vitest';
import { ConfigError, defaultAggregation, normalizeConfig } from '../src/config';

const base = { type: 'custom:chrono-heatmap-card', entity: 'sensor.temp' };

function errorKey(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ConfigError ? e.key : `unexpected:${String(e)}`;
  }
  return undefined;
}

describe('normalizeConfig', () => {
  it('requires an entity', () => {
    expect(errorKey(() => normalizeConfig({ type: 'x' } as never))).toBe('error.missing_entity');
  });

  it('applies defaults', () => {
    const c = normalizeConfig(base);
    expect(c.row_unit).toBe('day');
    expect(c.column_unit).toBe('hour');
    expect(c.rows).toBe(14);
    expect(c.orientation).toBe('horizontal');
    expect(c.source).toBe('auto');
    expect(c.aggregation).toBeUndefined();
    expect(c.on_states).toBeUndefined();
    expect(c.show_legend).toBe(true);
    expect(c.show_labels).toBe(true);
    expect(c.newest_first).toBe(false);
    expect(c.cell_spacing).toBe('normal');
  });

  it('picks the default column unit per row unit', () => {
    expect(normalizeConfig({ ...base, row_unit: 'hour' }).column_unit).toBe('5minute');
    expect(normalizeConfig({ ...base, row_unit: 'week' }).column_unit).toBe('day');
    expect(normalizeConfig({ ...base, row_unit: 'month' }).column_unit).toBe('day');
    expect(normalizeConfig({ ...base, row_unit: 'year' }).column_unit).toBe('month');
  });

  it('rejects invalid row/column combinations', () => {
    expect(errorKey(() => normalizeConfig({ ...base, row_unit: 'day', column_unit: 'minute' }))).toBe(
      'error.invalid_combination',
    );
    expect(errorKey(() => normalizeConfig({ ...base, row_unit: 'year', column_unit: 'day' }))).toBe(
      'error.invalid_combination',
    );
  });

  it('accepts all allowed combinations', () => {
    expect(normalizeConfig({ ...base, row_unit: 'hour', column_unit: 'minute' }).column_unit).toBe('minute');
    expect(normalizeConfig({ ...base, row_unit: 'week', column_unit: 'hour' }).column_unit).toBe('hour');
    expect(normalizeConfig({ ...base, row_unit: 'year', column_unit: 'week' }).column_unit).toBe('week');
  });

  it('rejects unknown option values', () => {
    expect(errorKey(() => normalizeConfig({ ...base, row_unit: 'decade' as never }))).toBe(
      'error.invalid_option',
    );
    expect(errorKey(() => normalizeConfig({ ...base, aggregation: 'median' as never }))).toBe(
      'error.invalid_option',
    );
  });

  it('validates rows', () => {
    expect(errorKey(() => normalizeConfig({ ...base, rows: 0 }))).toBe('error.rows');
    expect(errorKey(() => normalizeConfig({ ...base, rows: 2.5 }))).toBe('error.rows');
    expect(normalizeConfig({ ...base, rows: 3 }).rows).toBe(3);
  });

  it('rejects relative steps outside 0..1', () => {
    expect(
      errorKey(() =>
        normalizeConfig({
          ...base,
          scale: {
            type: 'relative',
            steps: [
              { value: 0, color: '#000' },
              { value: 5, color: '#fff' },
            ],
          },
        }),
      ),
    ).toBe('error.relative_steps');
  });

  it('defaults custom steps to absolute and sorts them', () => {
    const c = normalizeConfig({
      ...base,
      scale: {
        steps: [
          { value: 30, color: '#f00' },
          { value: 0, color: '#00f' },
        ],
      },
    });
    expect(c.scale.type).toBe('absolute');
    expect(c.scale.steps?.map((s) => s.value)).toEqual([0, 30]);
  });

  it('rejects absolute type for relative presets without steps', () => {
    expect(errorKey(() => normalizeConfig({ ...base, scale: { preset: 'viridis', type: 'absolute' } }))).toBe(
      'error.absolute_needs_steps',
    );
    expect(
      normalizeConfig({ ...base, scale: { preset: 'temperature', type: 'absolute' } }).scale.preset,
    ).toBe('temperature');
    expect(normalizeConfig({ ...base, scale: { preset: 'co2', type: 'absolute' } }).scale.preset).toBe('co2');
    expect(errorKey(() => normalizeConfig({ ...base, scale: { preset: 'traffic', type: 'absolute' } }))).toBe(
      'error.absolute_needs_steps',
    );
  });

  it('validates scale.reverse', () => {
    expect(normalizeConfig({ ...base, scale: { reverse: true } }).scale.reverse).toBe(true);
    expect(normalizeConfig({ ...base, scale: { reverse: false } }).scale.reverse).toBeUndefined();
    expect(errorKey(() => normalizeConfig({ ...base, scale: { reverse: 'yes' as never } }))).toBe(
      'error.invalid_option',
    );
  });

  it('validates newest_first', () => {
    expect(normalizeConfig({ ...base, newest_first: true }).newest_first).toBe(true);
    expect(normalizeConfig({ ...base, newest_first: false }).newest_first).toBe(false);
    expect(errorKey(() => normalizeConfig({ ...base, newest_first: 'yes' as never }))).toBe(
      'error.invalid_option',
    );
  });

  it('validates cell_spacing', () => {
    expect(normalizeConfig({ ...base, cell_spacing: 'none' }).cell_spacing).toBe('none');
    expect(errorKey(() => normalizeConfig({ ...base, cell_spacing: 'tight' as never }))).toBe(
      'error.invalid_option',
    );
  });

  it('rejects min >= max', () => {
    expect(errorKey(() => normalizeConfig({ ...base, scale: { min: 5, max: 5 } }))).toBe('error.min_max');
  });

  it('requires at least two steps', () => {
    expect(
      errorKey(() => normalizeConfig({ ...base, scale: { steps: [{ value: 1, color: '#fff' }] } })),
    ).toBe('error.steps_count');
  });
});

describe('defaultAggregation', () => {
  it('uses change for meters, mean for measurements, on_ratio for non-numeric', () => {
    expect(defaultAggregation('total_increasing', true)).toBe('change');
    expect(defaultAggregation('total', true)).toBe('change');
    expect(defaultAggregation('measurement', true)).toBe('mean');
    expect(defaultAggregation(undefined, false)).toBe('on_ratio');
  });
});
