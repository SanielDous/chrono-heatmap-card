export type RowUnit = 'hour' | 'day' | 'week' | 'month' | 'year';
export type ColumnUnit = 'minute' | '5minute' | 'hour' | 'day' | 'week' | 'month';
export type Aggregation = 'mean' | 'min' | 'max' | 'sum' | 'last' | 'change' | 'on_ratio';
export type Source = 'auto' | 'statistics' | 'history';
export type Orientation = 'horizontal' | 'vertical';
export type PresetName = 'temperature' | 'humidity' | 'co2' | 'pm25' | 'traffic' | 'viridis' | 'mono';
export type ScaleType = 'absolute' | 'relative';

export interface ScaleStep {
  value: number;
  color: string;
}

export interface ScaleConfig {
  preset?: PresetName;
  type?: ScaleType;
  min?: number;
  max?: number;
  /** Flip the colors of the chosen scale (e.g. traffic light: high = green). */
  reverse?: boolean;
  steps?: ScaleStep[];
}

export interface CardConfig {
  type: string;
  entity: string;
  title?: string;
  row_unit?: RowUnit;
  column_unit?: ColumnUnit;
  rows?: number;
  orientation?: Orientation;
  source?: Source;
  aggregation?: Aggregation;
  on_states?: string[];
  scale?: ScaleConfig;
  show_legend?: boolean;
  show_labels?: boolean;
}

export interface NormalizedScale {
  /** undefined = choose from entity (device_class) */
  preset?: PresetName;
  type?: ScaleType;
  min?: number;
  max?: number;
  reverse?: boolean;
  steps?: ScaleStep[];
}

export interface NormalizedConfig {
  entity: string;
  title?: string;
  row_unit: RowUnit;
  column_unit: ColumnUnit;
  rows: number;
  orientation: Orientation;
  source: Source;
  /** undefined = choose from entity (state_class / numeric) */
  aggregation?: Aggregation;
  /** undefined = choose from the entity domain (see defaultOnStates) */
  on_states?: string[];
  scale: NormalizedScale;
  show_legend: boolean;
  show_labels: boolean;
}

export const ROW_UNITS: RowUnit[] = ['hour', 'day', 'week', 'month', 'year'];
export const COLUMN_UNITS: ColumnUnit[] = ['minute', '5minute', 'hour', 'day', 'week', 'month'];
export const AGGREGATIONS: Aggregation[] = ['mean', 'min', 'max', 'sum', 'last', 'change', 'on_ratio'];
export const PRESET_NAMES: PresetName[] = [
  'temperature',
  'humidity',
  'co2',
  'pm25',
  'traffic',
  'viridis',
  'mono',
];
/** Presets with fixed values in the entity's unit (the others spread over the data range). */
export const ABSOLUTE_PRESETS: PresetName[] = ['temperature', 'humidity', 'co2', 'pm25'];

/** Allowed column units per row unit; the first entry is the default. */
export const ALLOWED_COLUMNS: Record<RowUnit, ColumnUnit[]> = {
  hour: ['5minute', 'minute'],
  day: ['hour'],
  week: ['day', 'hour'],
  month: ['day'],
  year: ['month', 'week'],
};

export const DEFAULT_ROWS: Record<RowUnit, number> = {
  hour: 12,
  day: 14,
  week: 8,
  month: 6,
  year: 2,
};

export const MAX_ROWS = 400;

/** Error with a translation key, so the card can show a localized message. */
export class ConfigError extends Error {
  constructor(
    public readonly key: string,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(`${key} ${JSON.stringify(params)}`);
    this.name = 'ConfigError';
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ConfigError('error.invalid_option', { option: key, value: String(value) });
  }
  return value as T;
}

function optionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new ConfigError('error.invalid_number', { option: key });
  }
  return n;
}

function normalizeScale(scale: ScaleConfig | undefined): NormalizedScale {
  if (scale === undefined || scale === null) return {};
  if (typeof scale !== 'object')
    throw new ConfigError('error.invalid_option', { option: 'scale', value: '' });
  const preset = oneOf(scale.preset, PRESET_NAMES, 'scale.preset');
  let type = oneOf(scale.type, ['absolute', 'relative'] as const, 'scale.type');
  const min = optionalNumber(scale.min, 'scale.min');
  const max = optionalNumber(scale.max, 'scale.max');
  if (min !== undefined && max !== undefined && min >= max) {
    throw new ConfigError('error.min_max');
  }

  let steps: ScaleStep[] | undefined;
  if (scale.steps !== undefined) {
    if (!Array.isArray(scale.steps) || scale.steps.length < 2) {
      throw new ConfigError('error.steps_count');
    }
    steps = scale.steps.map((s, i) => {
      const value = optionalNumber(s?.value, `scale.steps[${i}].value`);
      if (value === undefined || typeof s.color !== 'string' || s.color.trim() === '') {
        throw new ConfigError('error.step_invalid', { index: i });
      }
      return { value, color: s.color.trim() };
    });
    steps.sort((a, b) => a.value - b.value);
    type ??= 'absolute';
    if (type === 'relative' && steps.some((s) => s.value < 0 || s.value > 1)) {
      throw new ConfigError('error.relative_steps');
    }
  } else if (type === 'absolute' && preset !== undefined && !ABSOLUTE_PRESETS.includes(preset)) {
    throw new ConfigError('error.absolute_needs_steps', { preset });
  }

  if (scale.reverse !== undefined && scale.reverse !== null && typeof scale.reverse !== 'boolean') {
    throw new ConfigError('error.invalid_option', { option: 'scale.reverse', value: String(scale.reverse) });
  }
  const reverse = scale.reverse === true ? true : undefined;

  return { preset, type, min, max, reverse, steps };
}

export function normalizeConfig(config: CardConfig): NormalizedConfig {
  if (!config || typeof config !== 'object') throw new ConfigError('error.invalid_config');
  if (typeof config.entity !== 'string' || config.entity.trim() === '') {
    throw new ConfigError('error.missing_entity');
  }

  const row_unit = oneOf(config.row_unit, ROW_UNITS, 'row_unit') ?? 'day';
  const column_unit = oneOf(config.column_unit, COLUMN_UNITS, 'column_unit') ?? ALLOWED_COLUMNS[row_unit][0];
  if (!ALLOWED_COLUMNS[row_unit].includes(column_unit)) {
    throw new ConfigError('error.invalid_combination', {
      row_unit,
      column_unit,
      allowed: ALLOWED_COLUMNS[row_unit].join(', '),
    });
  }

  const rowsRaw = optionalNumber(config.rows, 'rows');
  const rows = rowsRaw ?? DEFAULT_ROWS[row_unit];
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) {
    throw new ConfigError('error.rows', { max: MAX_ROWS });
  }

  let on_states: string[] | undefined;
  if (config.on_states !== undefined) {
    if (!Array.isArray(config.on_states) || config.on_states.length === 0) {
      throw new ConfigError('error.on_states');
    }
    on_states = config.on_states.map((s) => String(s));
  }

  return {
    entity: config.entity.trim(),
    title: typeof config.title === 'string' && config.title !== '' ? config.title : undefined,
    row_unit,
    column_unit,
    rows,
    orientation:
      oneOf(config.orientation, ['horizontal', 'vertical'] as const, 'orientation') ?? 'horizontal',
    source: oneOf(config.source, ['auto', 'statistics', 'history'] as const, 'source') ?? 'auto',
    aggregation: oneOf(config.aggregation, AGGREGATIONS, 'aggregation'),
    on_states,
    scale: normalizeScale(config.scale),
    show_legend: config.show_legend ?? true,
    show_labels: config.show_labels ?? true,
  };
}

/** Choose the aggregation for an entity when not configured. */
export function defaultAggregation(stateClass: string | undefined, numeric: boolean): Aggregation {
  if (!numeric) return 'on_ratio';
  if (stateClass === 'total' || stateClass === 'total_increasing') return 'change';
  return 'mean';
}

const DOMAIN_ON_STATES: Record<string, string[]> = {
  person: ['home'],
  device_tracker: ['home'],
  cover: ['open', 'opening', 'closing'],
  lock: ['unlocked', 'unlocking', 'open'],
  media_player: ['playing'],
  vacuum: ['cleaning'],
  climate: ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
};

/** States that count as "on" for `on_ratio` when `on_states` is not configured. */
export function defaultOnStates(entityId: string): string[] {
  return DOMAIN_ON_STATES[entityId.split('.')[0]] ?? ['on'];
}
