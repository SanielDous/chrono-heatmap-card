import { describe, expect, it } from 'vitest';
import { defaultOnStates, normalizeConfig } from '../src/config';
import type { BaseBucket } from '../src/buckets';
import { chooseSource, isNumericEntity, loadBuckets, statisticsAlign, statisticsGaps } from '../src/data';
import { buildGrid } from '../src/grid';
import type { HomeAssistant } from '../src/hass-types';

const NOW = Date.parse('2026-10-26T13:37:00Z');

describe('isNumericEntity', () => {
  it('treats on/off domains as binary', () => {
    expect(isNumericEntity('binary_sensor.door', 'on', undefined)).toBe(false);
    expect(isNumericEntity('climate.living', 'heat', undefined)).toBe(false);
  });

  it('treats sensors with unit or state_class as numeric', () => {
    expect(isNumericEntity('sensor.t', 'unavailable', '°C')).toBe(true);
    expect(isNumericEntity('sensor.count', 'unknown', undefined, 'measurement')).toBe(true);
  });

  it('does not misread a unitless numeric sensor that is unavailable at load time', () => {
    expect(isNumericEntity('sensor.aqi', 'unavailable', undefined)).toBe(true);
    expect(isNumericEntity('sensor.aqi', '42', undefined)).toBe(true);
  });

  it('treats text sensors as discrete', () => {
    expect(isNumericEntity('sensor.weather', 'sunny', undefined)).toBe(false);
  });
});

describe('statisticsAlign / chooseSource', () => {
  it('detects whole-hour offsets', () => {
    expect(statisticsAlign('Europe/Berlin', NOW - 86_400_000, NOW)).toBe(true);
    expect(statisticsAlign('Asia/Kolkata', NOW - 86_400_000, NOW)).toBe(false);
    expect(statisticsAlign('Asia/Kathmandu', NOW - 86_400_000, NOW)).toBe(false);
  });

  it('falls back to history in :30 time zones even when statistics exist', () => {
    const config = normalizeConfig({ type: 'x', entity: 'sensor.t' });
    const berlin = buildGrid('day', 'hour', 3, NOW, 'Europe/Berlin', 1);
    const kolkata = buildGrid('day', 'hour', 3, NOW, 'Asia/Kolkata', 1);
    expect(chooseSource({ config, mode: 'numeric', statisticsAvailable: true, grid: berlin })).toBe(
      'statistics',
    );
    expect(chooseSource({ config, mode: 'numeric', statisticsAvailable: true, grid: kolkata })).toBe(
      'history',
    );
  });

  it('uses history for binary entities and minute columns', () => {
    const grid = buildGrid('hour', 'minute', 2, NOW, 'Europe/Berlin', 1);
    const minute = normalizeConfig({
      type: 'x',
      entity: 'sensor.t',
      row_unit: 'hour',
      column_unit: 'minute',
    });
    expect(chooseSource({ config: minute, mode: 'numeric', statisticsAvailable: true, grid })).toBe(
      'history',
    );
  });
});

describe('defaultOnStates', () => {
  it('knows common domains', () => {
    expect(defaultOnStates('person.anna')).toEqual(['home']);
    expect(defaultOnStates('media_player.tv')).toEqual(['playing']);
    expect(defaultOnStates('switch.pump')).toEqual(['on']);
  });
});

describe('loadBuckets (statistics source)', () => {
  const HOUR = 3_600_000;
  const now = Date.parse('2026-06-10T05:30:00Z');
  const grid = buildGrid('day', 'hour', 1, now, 'UTC', 1); // 2026-06-10 00:00–24:00 UTC
  const config = normalizeConfig({ type: 'x', entity: 'sensor.t' });

  /** Statistics for hours 0, 2, 3 (hour 1 missing, e.g. HA was down); history has a value for every hour. */
  function fakeHass(statHours: number[]) {
    const calls: Record<string, unknown>[] = [];
    const hass = {
      callWS: async (msg: Record<string, unknown>) => {
        calls.push(msg);
        const from = Date.parse(msg.start_time as string);
        const to = Date.parse(msg.end_time as string);
        if (msg.type === 'recorder/statistics_during_period') {
          return {
            'sensor.t': statHours
              .map((h) => grid.start + h * HOUR)
              .filter((s) => s >= from && s < to)
              .map((s) => ({ start: s, end: s + HOUR, mean: 10, min: 10, max: 10, state: 10 })),
          };
        }
        const points = [];
        for (let h = 0; h < 6; h++) {
          const t = grid.start + h * HOUR;
          if (t >= from && t < to) points.push({ s: String(20 + h), lu: t / 1000 });
        }
        if (!points.length || points[0].lu * 1000 > from) points.unshift({ s: '20', lu: from / 1000 });
        return { 'sensor.t': points };
      },
    } as unknown as HomeAssistant;
    return { hass, calls };
  }

  const opts = { config, grid, now, mode: 'numeric' as const, statisticsAvailable: true };

  it('finds gaps between statistics', () => {
    const b = (h: number) => ({ start: h * HOUR, end: (h + 1) * HOUR }) as BaseBucket;
    expect(statisticsGaps([b(0), b(2), b(3)], 0, 4 * HOUR, HOUR)).toEqual([[HOUR, 2 * HOUR]]);
    expect(statisticsGaps([b(2)], 0, 3 * HOUR, HOUR)).toEqual([[0, 2 * HOUR]]);
  });

  it('fills statistics gaps and the tail from history', async () => {
    const { hass, calls } = fakeHass([0, 2, 3]);
    const res = await loadBuckets(hass, opts);
    const byHour = new Map(res.buckets.map((b) => [(b.start - grid.start) / HOUR, b.mean]));
    expect(byHour.get(0)).toBe(10); // statistics
    expect(byHour.get(1)).toBe(21); // gap → history
    expect(byHour.get(2)).toBe(10);
    expect(byHour.get(4)).toBe(24); // tail after the last statistic → history
    expect(res.covered).toBe(grid.start + 4 * HOUR);
    const history = calls.filter((c) => c.type === 'history/history_during_period');
    expect(history.map((c) => c.start_time).sort()).toEqual([
      new Date(grid.start + HOUR).toISOString(),
      new Date(grid.start + 4 * HOUR).toISOString(),
    ]);
  });

  it('reuses the previous result and only fetches what is new', async () => {
    const first = await loadBuckets(fakeHass([0, 2, 3]).hass, opts);
    const { hass, calls } = fakeHass([0, 2, 3, 4]); // hour 4 got compiled meanwhile
    const res = await loadBuckets(hass, { ...opts, previous: first });
    const stats = calls.find((c) => c.type === 'recorder/statistics_during_period')!;
    expect(stats.start_time).toBe(new Date(grid.start + 4 * HOUR).toISOString());
    const history = calls.filter((c) => c.type === 'history/history_during_period');
    expect(history.map((c) => c.start_time)).toEqual([new Date(grid.start + 5 * HOUR).toISOString()]);
    const byHour = new Map(res.buckets.map((b) => [(b.start - grid.start) / HOUR, b.mean]));
    expect([0, 1, 2, 3, 4, 5].map((h) => byHour.get(h))).toEqual([10, 21, 10, 10, 10, 25]);
  });

  it('reuses a result across aggregation changes, but not for a longer range', async () => {
    const first = await loadBuckets(fakeHass([0, 2, 3]).hass, opts);
    const { hass, calls } = fakeHass([0, 2, 3]);
    const other = normalizeConfig({ type: 'x', entity: 'sensor.t', column_unit: 'hour', rows: 1 });
    await loadBuckets(hass, { ...opts, config: { ...other, aggregation: 'max' }, previous: first });
    expect(calls.find((c) => c.type === 'recorder/statistics_during_period')!.start_time).toBe(
      new Date(grid.start + 4 * HOUR).toISOString(),
    ); // same entity/period/mode → reused
    const longer = buildGrid('day', 'hour', 2, now, 'UTC', 1);
    const { hass: h2, calls: c2 } = fakeHass([0, 2, 3]);
    await loadBuckets(h2, { ...opts, grid: longer, previous: first });
    expect(c2.find((c) => c.type === 'recorder/statistics_during_period')!.start_time).toBe(
      new Date(longer.start).toISOString(),
    );
  });
});
