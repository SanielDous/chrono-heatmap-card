import { bucketsFromHistory, bucketsFromStatistics, mergeBuckets } from './buckets';
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
}

export interface LoadResult {
  buckets: BaseBucket[];
  source: 'statistics' | 'history';
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

/** Load base buckets for the visible grid. History fills the time after the last compiled statistic. */
export async function loadBuckets(hass: HomeAssistant, opts: LoadOptions): Promise<LoadResult> {
  const { config, grid, now, mode } = opts;
  const onStates = config.on_states ?? defaultOnStates(config.entity);
  const size = baseBucketSize(config.column_unit);
  const to = Math.min(grid.end, now);
  const source = chooseSource(opts);

  if (source === 'history') {
    const points = await fetchHistory(hass, config.entity, grid.start, to);
    return {
      source,
      buckets: bucketsFromHistory(points, grid.start, grid.end, size, mode, onStates, now),
    };
  }

  const period = config.column_unit === '5minute' ? '5minute' : 'hour';
  const stat = bucketsFromStatistics(
    await fetchStatistics(hass, config.entity, grid.start, grid.end, period),
  );
  const covered = stat.length ? stat[stat.length - 1].end : grid.start;
  let hist: BaseBucket[] = [];
  if (covered < to) {
    const points = await fetchHistory(hass, config.entity, covered, to);
    hist = bucketsFromHistory(points, covered, grid.end, size, mode, onStates, now);
  }
  return { source, buckets: mergeBuckets(stat, hist) };
}
