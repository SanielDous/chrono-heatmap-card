import { describe, expect, it } from 'vitest';
import { autoPreset, colorFor, legendGradient, PRESETS, resolveScale } from '../src/scale';

const ctx = { values: [] as number[], isRatio: false };

describe('resolveScale', () => {
  it('uses the temperature preset for temperature entities', () => {
    const s = resolveScale({}, { ...ctx, deviceClass: 'temperature', unit: '°C' });
    expect(s.stops).toEqual(PRESETS.temperature.steps);
  });

  it('converts the temperature preset to °F', () => {
    const s = resolveScale({ preset: 'temperature' }, { ...ctx, unit: '°F' });
    const idx = PRESETS.temperature.steps.findIndex((x) => x.value === 19);
    expect(s.stops[idx].value).toBeCloseTo(66.2);
    expect(s.min).toBe(14);
  });

  it('defaults to viridis spread over the data range', () => {
    const s = resolveScale({}, { ...ctx, values: [100, 300, 200] });
    expect(s.min).toBe(100);
    expect(s.max).toBe(300);
    expect(s.stops[2].value).toBe(200);
  });

  it('honors configured min/max for relative scales', () => {
    const s = resolveScale({ preset: 'mono', min: 0, max: 3000 }, { ...ctx, values: [5] });
    expect([s.min, s.max]).toEqual([0, 3000]);
  });

  it('uses a fixed 0..1 range for on_ratio', () => {
    const s = resolveScale({}, { values: [0.2, 0.3], isRatio: true, deviceClass: 'temperature' });
    expect([s.min, s.max]).toEqual([0, 1]);
    expect(s.stops[0].color).toBe(PRESETS.viridis.steps[0].color);
  });

  it('does not divide by zero when all values are equal', () => {
    const s = resolveScale({}, { ...ctx, values: [4, 4] });
    expect(s.max).toBeGreaterThan(s.min);
  });

  it('spreads relative custom steps; keeps absolute custom steps', () => {
    const steps = [
      { value: 0, color: '#000000' },
      { value: 1, color: '#ffffff' },
    ];
    expect(resolveScale({ steps, type: 'relative', min: 10, max: 20 }, ctx).stops[1].value).toBe(20);
    expect(resolveScale({ steps, type: 'absolute' }, ctx).stops[1].value).toBe(1);
  });

  it('temperature preset as relative scale keeps its colors over the data range', () => {
    const s = resolveScale({ preset: 'temperature', type: 'relative' }, { ...ctx, values: [0, 90] });
    expect(s.min).toBe(0);
    expect(s.max).toBe(90);
    expect(s.stops).toHaveLength(PRESETS.temperature.steps.length);
  });
});

describe('colorFor', () => {
  const scale = resolveScale(
    {
      steps: [
        { value: 0, color: '#000000' },
        { value: 10, color: '#ffffff' },
      ],
    },
    ctx,
  );

  it('clamps outside the range', () => {
    expect(colorFor(scale, -5)).toBe('#000000');
    expect(colorFor(scale, 50)).toBe('#ffffff');
  });

  it('mixes between stops', () => {
    expect(colorFor(scale, 5)).toBe('color-mix(in oklab, #000000 50%, #ffffff)');
    expect(colorFor(scale, 2.5)).toBe('color-mix(in oklab, #000000 75%, #ffffff)');
  });

  it('returns exact stop colors', () => {
    expect(colorFor(scale, 10)).toBe('#ffffff');
  });
});

describe('legendGradient', () => {
  it('positions stops by value', () => {
    const s = resolveScale(
      {
        steps: [
          { value: 0, color: 'red' },
          { value: 5, color: 'green' },
          { value: 20, color: 'blue' },
        ],
      },
      ctx,
    );
    expect(legendGradient(s)).toBe('linear-gradient(to right, red 0%, green 25%, blue 100%)');
  });
});

describe('device class presets', () => {
  it('picks a preset from the device class for level aggregations', () => {
    expect(autoPreset({ ...ctx, deviceClass: 'carbon_dioxide', aggregation: 'mean' }).preset).toBe('co2');
    expect(autoPreset({ ...ctx, deviceClass: 'humidity', aggregation: 'max' }).preset).toBe('humidity');
    expect(autoPreset({ ...ctx, deviceClass: 'pm25' }).preset).toBe('pm25');
    expect(autoPreset({ ...ctx, deviceClass: 'temperature', aggregation: 'last' }).preset).toBe(
      'temperature',
    );
  });

  it('does not use level presets for sums, changes or on ratios', () => {
    expect(autoPreset({ ...ctx, deviceClass: 'carbon_dioxide', aggregation: 'sum' }).preset).toBe('viridis');
    expect(autoPreset({ ...ctx, deviceClass: 'temperature', aggregation: 'change' }).preset).toBe('viridis');
    expect(autoPreset({ ...ctx, deviceClass: 'humidity', isRatio: true }).preset).toBe('viridis');
  });

  it('uses absolute CO2 values in ppm', () => {
    const s = resolveScale({}, { ...ctx, deviceClass: 'carbon_dioxide', unit: 'ppm', values: [450, 600] });
    expect([s.min, s.max]).toEqual([400, 3000]);
    expect(colorFor(s, 1000)).toBe('#fee08b');
  });

  it('falls back to a relative scale when the unit does not match the automatic preset', () => {
    const s = resolveScale({}, { ...ctx, deviceClass: 'humidity', unit: 'g/m³', values: [5, 15] });
    expect([s.min, s.max]).toEqual([5, 15]);
    expect(s.stops).toHaveLength(PRESETS.humidity.steps.length);
  });

  it('keeps an explicitly chosen absolute preset absolute, whatever the unit', () => {
    const s = resolveScale({ preset: 'temperature' }, { ...ctx, unit: 'C', values: [18, 24] });
    expect([s.min, s.max]).toEqual([-10, 35]);
  });

  it('never uses relative preset positions as absolute values', () => {
    const s = resolveScale({ type: 'absolute' }, { ...ctx, deviceClass: 'battery', unit: '%', values: [50] });
    expect([s.min, s.max]).toEqual([0, 100]);
  });

  it('reverse keeps the thresholds of uneven presets', () => {
    const s = resolveScale({ preset: 'co2', reverse: true }, { ...ctx, unit: 'ppm', values: [] });
    expect(s.stops.map((x) => x.value)).toEqual(PRESETS.co2.steps.map((x) => x.value));
    expect(colorFor(s, 1000)).toBe('#fc8d59'); // was yellow, now the mirrored neighbour color
    expect(colorFor(s, 400)).toBe('#7f0000');
  });

  it('accepts both micro signs for PM2.5', () => {
    for (const unit of ['µg/m³', 'μg/m³']) {
      expect(resolveScale({}, { ...ctx, deviceClass: 'pm25', unit, values: [3] }).max).toBe(140);
    }
  });

  it('shows battery levels as a reversed traffic light from 0 to 100 %', () => {
    const s = resolveScale({}, { ...ctx, deviceClass: 'battery', unit: '%', values: [60, 90] });
    expect([s.min, s.max]).toEqual([0, 100]);
    expect(colorFor(s, 100)).toBe('#1a9850'); // full = green
    expect(colorFor(s, 0)).toBe('#d73027'); // empty = red
  });

  it('reverse flips the colors over the same range', () => {
    const s = resolveScale({ preset: 'traffic', reverse: true }, { ...ctx, values: [10, 30] });
    expect([s.min, s.max]).toEqual([10, 30]);
    expect(colorFor(s, 10)).toBe('#d73027');
    expect(colorFor(s, 30)).toBe('#1a9850');
  });

  it('reverse flips the automatic battery scale; false keeps the default', () => {
    const battery = { ...ctx, deviceClass: 'battery', unit: '%', values: [50] };
    expect(colorFor(resolveScale({ reverse: true }, battery), 100)).toBe('#d73027');
    expect(colorFor(resolveScale({ reverse: undefined }, battery), 100)).toBe('#1a9850');
  });
});
