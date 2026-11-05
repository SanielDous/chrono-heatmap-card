import { describe, expect, it } from 'vitest';
import { colorFor, legendGradient, PRESETS, resolveScale } from '../src/scale';

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
