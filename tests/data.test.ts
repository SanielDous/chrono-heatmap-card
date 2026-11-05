import { describe, expect, it } from 'vitest';
import { defaultOnStates, normalizeConfig } from '../src/config';
import { chooseSource, isNumericEntity, statisticsAlign } from '../src/data';
import { buildGrid } from '../src/grid';

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
