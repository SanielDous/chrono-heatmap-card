import type { HassEntity, HomeAssistant } from '../src/hass-types';
import { formatState, scenarioFor, SCENARIOS, type Scenario } from './scenarios';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Recorder keeps raw history and 5-minute statistics for this long (HA default: 10 days). */
const RETENTION = 10 * DAY;

export interface MockOptions {
  now: number;
  language: string;
  dark: boolean;
  /** artificial latency for WS calls */
  latency?: number;
}

function entityState(s: Scenario, now: number): HassEntity {
  const v = s.valueAt(now);
  const iso = new Date(now).toISOString();
  return {
    entity_id: s.entity_id,
    state: formatState(s, v),
    attributes: { ...s.attributes },
    last_changed: iso,
    last_updated: iso,
  };
}

function statisticsRows(s: Scenario, from: number, to: number, period: '5minute' | 'hour', now: number) {
  const size = period === 'hour' ? HOUR : 5 * MIN;
  // statistics exist only for periods that are finished
  const lastEnd = Math.floor(now / size) * size;
  const oldest = period === '5minute' ? now - RETENTION : -Infinity;
  const rows = [];
  for (let start = Math.ceil(Math.max(from, oldest) / size) * size; start < to && start + size <= lastEnd; start += size) {
    if (s.meter) {
      const a = s.valueAt(start) as number;
      const b = s.valueAt(start + size) as number;
      rows.push({ start, end: start + size, state: b, sum: b - 12000, change: b - a });
      continue;
    }
    let sum = 0;
    let n = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let t = start; t < start + size; t += s.sampleEvery) {
      const v = s.valueAt(t);
      if (typeof v !== 'number') continue;
      sum += v;
      n++;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    if (n === 0) continue;
    rows.push({ start, end: start + size, mean: sum / n, min, max });
  }
  return rows;
}

function historyRows(s: Scenario, from: number, to: number, now: number) {
  const start = Math.max(from, now - RETENTION);
  const end = Math.min(to, now);
  if (end <= start) return [];
  const out: { s: string; lu: number }[] = [];
  let prev: string | undefined;
  const first = Math.floor(start / s.sampleEvery) * s.sampleEvery;
  for (let t = first; t < end; t += s.sampleEvery) {
    const state = formatState(s, s.valueAt(t));
    if (state === prev) continue;
    prev = state;
    out.push({ s: state, lu: Math.max(t, start) / 1000 });
  }
  return out;
}

export function createMockHass(opts: MockOptions): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  for (const s of SCENARIOS) states[s.entity_id] = entityState(s, opts.now);

  const handle = (msg: Record<string, unknown>): unknown => {
    switch (msg.type) {
      case 'recorder/get_statistics_metadata': {
        const ids = (msg.statistic_ids as string[]) ?? [];
        return ids
          .map(scenarioFor)
          .filter((s): s is Scenario => !!s && s.hasStatistics)
          .map((s) => ({ statistic_id: s.entity_id, has_mean: !s.meter, has_sum: !!s.meter }));
      }
      case 'recorder/statistics_during_period': {
        const id = (msg.statistic_ids as string[])[0];
        const s = scenarioFor(id);
        if (!s?.hasStatistics) return {};
        const from = Date.parse(msg.start_time as string);
        const to = msg.end_time ? Date.parse(msg.end_time as string) : opts.now;
        return { [id]: statisticsRows(s, from, to, msg.period as '5minute' | 'hour', opts.now) };
      }
      case 'history/history_during_period': {
        const id = (msg.entity_ids as string[])[0];
        const s = scenarioFor(id);
        if (!s) return {};
        const from = Date.parse(msg.start_time as string);
        const to = msg.end_time ? Date.parse(msg.end_time as string) : opts.now;
        return { [id]: historyRows(s, from, to, opts.now) };
      }
      default:
        throw { code: 'unknown_command', message: `Mock does not support ${String(msg.type)}` };
    }
  };

  return {
    states,
    language: opts.language,
    locale: { language: opts.language, time_zone: 'server', first_weekday: 'language' },
    config: { time_zone: 'Europe/Berlin' },
    themes: { darkMode: opts.dark },
    formatEntityName: (e) => String(e.attributes.friendly_name ?? e.entity_id),
    callWS: <T>(msg: Record<string, unknown>) =>
      new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          try {
            resolve(handle(msg) as T);
          } catch (e) {
            reject(e);
          }
        }, opts.latency ?? 0);
      }),
  };
}
