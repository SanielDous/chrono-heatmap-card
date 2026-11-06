import { bucketsFromHistory, bucketsFromStatistics, meterModeFor, mergeBuckets } from './buckets';
import type { BaseBucket, HistPoint, StatRow } from './buckets';
import { defaultOnStates, type ColumnUnit, type NormalizedConfig } from './config';
import type { Grid } from './grid';
import type { HomeAssistant } from './hass-types';

const MIN = 60_000;

export type ValueMode = 'numeric' | 'binary';

export function baseBucketSize(col: ColumnUnit): number {
  if (col === 'minute') return MIN;
  if (col === '5minute') return 5 * MIN;
  return 60 * MIN;
}

const BINARY_DOMAINS = new Set([
  'binary_sensor',
  'switch',
  'input_boolean',
  'light',
  'fan',
  'person',
  'device_tracker',
  'lock',
  'cover',
  'media_player',
  'climate',
  'vacuum',
  'automation',
  'siren',
]);

/** Whether an entity's states are numbers (sensor values) or discrete states (on/off, home/away). */
export function isNumericEntity(
  entityId: string,
  state: string | undefined,
  unit: string | undefined,
  stateClass?: string,
): boolean {
  const domain = entityId.split('.')[0];
  if (BINARY_DOMAINS.has(domain)) return false;
  if (unit || stateClass) return true;
  if (state !== undefined && state.trim() !== '' && Number.isFinite(Number(state))) return true;
  // A transient unavailable/unknown state says nothing about the kind of entity.
  return (
    NUMERIC_DOMAINS.has(domain) && (state === undefined || state === 'unavailable' || state === 'unknown')
  );
}

const NUMERIC_DOMAINS = new Set(['sensor', 'number', 'input_number', 'counter']);

/**
 * Hourly/5-minute statistics are aligned to whole UTC hours. In time zones with a :30/:45 offset they do not
 * line up with local cells, so history must be used there.
 */
export function statisticsAlign(timeZone: string, from: number, to: number): boolean {
  const offsetMinutes = (t: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(t);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round((local - Math.floor(t / 60_000) * 60_000) / 60_000);
  };
  return [from, to, (from + to) / 2].every((t) => offsetMinutes(t) % 60 === 0);
}

interface StatisticsMetadata {
  statistic_id: string;
  has_sum?: boolean;
  has_mean?: boolean;
  mean_type?: number;
}

export async function hasStatistics(hass: HomeAssistant, entityId: string): Promise<boolean> {
  const meta = await hass.callWS<StatisticsMetadata[]>({
    type: 'recorder/get_statistics_metadata',
    statistic_ids: [entityId],
  });
  return Array.isArray(meta) && meta.some((m) => m.statistic_id === entityId);
}

const toMs = (v: number | string): number => (typeof v === 'number' ? v : Date.parse(v));

export async function fetchStatistics(
  hass: HomeAssistant,
  entityId: string,
  from: number,
  to: number,
  period: '5minute' | 'hour',
): Promise<StatRow[]> {
  const res = await hass.callWS<
    Record<string, (Omit<StatRow, 'start' | 'end'> & { start: number | string; end: number | string })[]>
  >({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    statistic_ids: [entityId],
    period,
    types: ['mean', 'min', 'max', 'state', 'change'],
  });
  return (res?.[entityId] ?? []).map((r) => ({ ...r, start: toMs(r.start), end: toMs(r.end) }));
}

interface CompressedState {
  s: string;
  /** last_updated, seconds */
  lu: number;
  /** last_changed, seconds (only when different from lu) */
  lc?: number;
}

export async function fetchHistory(
  hass: HomeAssistant,
  entityId: string,
  from: number,
  to: number,
): Promise<HistPoint[]> {
  const res = await hass.callWS<Record<string, CompressedState[]>>({
    type: 'history/history_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    entity_ids: [entityId],
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: true,
    no_attributes: true,
  });
  return (res?.[entityId] ?? []).map((p) => ({ t: Math.round((p.lc ?? p.lu) * 1000), s: p.s }));
}

export interface LoadOptions {
  config: NormalizedConfig;
  grid: Grid;
  now: number;
  mode: ValueMode;
  statisticsAvailable: boolean;
  /** `state_class` of the entity; decides how drops count for `change`. */
  stateClass?: string;
  /** Result of the previous load; when compatible, only data after its `covered` time is fetched again. */
  previous?: LoadResult;
}

export interface LoadResult {
  buckets: BaseBucket[];
  source: 'statistics' | 'history';
  /** Statistics source only: final buckets (statistics + history for gaps between them) from `start` … */
  stable?: BaseBucket[];
  start?: number;
  /** … up to this time (end of the last compiled statistic). */
  covered?: number;
  /** Identifies what `stable` was computed for. */
  key?: string;
}

export function chooseSource(
  opts: Pick<LoadOptions, 'config' | 'mode' | 'statisticsAvailable' | 'grid'>,
): 'statistics' | 'history' {
  const { config, mode, statisticsAvailable, grid } = opts;
  if (mode === 'binary' || config.column_unit === 'minute') return 'history';
  // Never put values into the wrong cell: statistics do not line up with :30/:45 time zones.
  if (!statisticsAlign(grid.timeZone, grid.start, grid.end)) return 'history';
  if (config.source === 'history') return 'history';
  if (config.source === 'statistics') return 'statistics';
  return statisticsAvailable ? 'statistics' : 'history';
}

/** Most gap ranges fetched from history per load (the most recent ones). */
export const MAX_GAP_FETCHES = 12;

/** Stretches in [from, covered) of at least `minLength` that statistics do not cover, oldest first. */
export function statisticsGaps(
  stat: BaseBucket[],
  from: number,
  covered: number,
  minLength: number,
): [number, number][] {
  const gaps: [number, number][] = [];
  let t = from;
  for (const b of stat) {
    if (b.start - t >= minLength) gaps.push([t, Math.min(b.start, covered)]);
    t = Math.max(t, b.end);
  }
  return gaps;
}

/**
 * Load base buckets for the visible grid.
 * Statistics source: compiled statistics, with history filling gaps between them (e.g. HA was down, or the
 * entity got a state_class recently) and the time after the last compiled statistic.
 * With a compatible `previous` result, only statistics after its `covered` time are fetched again.
 */
export async function loadBuckets(hass: HomeAssistant, opts: LoadOptions): Promise<LoadResult> {
  const { config, grid, now, mode, previous } = opts;
  const onStates = config.on_states ?? defaultOnStates(config.entity);
  const size = baseBucketSize(config.column_unit);
  const meterMode = meterModeFor(opts.stateClass);
  const to = Math.min(grid.end, now);
  const source = chooseSource(opts);
  const history = async (from: number, until: number): Promise<BaseBucket[]> =>
    bucketsFromHistory(
      await fetchHistory(hass, config.entity, from, Math.min(until, to)),
      from,
      until,
      size,
      mode,
      onStates,
      now,
      meterMode,
    );

  if (source === 'history') return { source, buckets: await history(grid.start, grid.end) };

  const period = config.column_unit === '5minute' ? '5minute' : 'hour';
  const key = [config.entity, period, mode, meterMode].join('|');
  const reuse =
    previous?.key === key &&
    previous.stable !== undefined &&
    previous.covered !== undefined &&
    previous.start !== undefined &&
    previous.start <= grid.start &&
    previous.covered >= grid.start &&
    previous.covered <= to;
  const from = reuse ? previous.covered! : grid.start;
  const kept = reuse ? previous.stable!.filter((b) => b.end > grid.start) : [];

  const stat = bucketsFromStatistics(await fetchStatistics(hass, config.entity, from, grid.end, period));
  const covered = stat.length ? stat[stat.length - 1].end : from;
  const gaps = statisticsGaps(stat, from, covered, size).slice(-MAX_GAP_FETCHES);
  const [tail, ...filled] = await Promise.all([
    covered < to ? history(covered, grid.end) : Promise.resolve([]),
    ...gaps.map(([a, b]) => history(a, b)),
  ]);
  const stable = [...kept, ...mergeBuckets(stat, filled.flat())];
  return {
    source,
    buckets: [...stable, ...tail],
    stable,
    start: reuse ? previous.start : grid.start,
    covered,
    key,
  };
}
