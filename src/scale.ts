import type { Aggregation, NormalizedScale, PresetName, ScaleStep, ScaleType } from './config';

interface Preset {
  type: ScaleType;
  /** absolute presets: values in `units[0]`; relative presets: positions 0..1 */
  steps: ScaleStep[];
  /** Units the absolute values are meant for; with another unit the preset is used as a relative scale. */
  units?: string[];
}

const MONO_BASE = 'var(--chm-mono-color, var(--primary-color, #03a9f4))';

export const PRESETS: Record<PresetName, Preset> = {
  temperature: {
    type: 'absolute',
    units: ['°C', '°F'],
    steps: [
      { value: -10, color: '#313695' },
      { value: 0, color: '#4575b4' },
      { value: 10, color: '#74add1' },
      { value: 16, color: '#abd9e9' },
      { value: 19, color: '#66bd63' },
      { value: 22, color: '#d9ef8b' },
      { value: 25, color: '#fee08b' },
      { value: 28, color: '#fdae61' },
      { value: 31, color: '#f46d43' },
      { value: 35, color: '#a50026' },
    ],
  },
  // Relative humidity: dry (brown), comfortable 40–60 % (green), humid (blue).
  humidity: {
    type: 'absolute',
    units: ['%'],
    steps: [
      { value: 20, color: '#b35806' },
      { value: 30, color: '#f1a340' },
      { value: 40, color: '#91cf60' },
      { value: 50, color: '#1a9850' },
      { value: 60, color: '#91cf60' },
      { value: 70, color: '#67a9cf' },
      { value: 85, color: '#2166ac' },
    ],
  },
  // Indoor CO2: outdoor air is about 400 ppm, ventilate above about 1000 ppm, poor above 1400 ppm.
  co2: {
    type: 'absolute',
    units: ['ppm'],
    steps: [
      { value: 400, color: '#1a9850' },
      { value: 800, color: '#91cf60' },
      { value: 1000, color: '#fee08b' },
      { value: 1400, color: '#fc8d59' },
      { value: 2000, color: '#d73027' },
      { value: 3000, color: '#7f0000' },
    ],
  },
  // PM2.5 bands of the European Air Quality Index (good 0–5, fair –15, moderate –50, poor –90, very poor –140).
  pm25: {
    type: 'absolute',
    units: ['µg/m³', 'μg/m³'],
    steps: [
      { value: 0, color: '#1a9850' },
      { value: 5, color: '#66bd63' },
      { value: 15, color: '#fee08b' },
      { value: 50, color: '#fc8d59' },
      { value: 90, color: '#d73027' },
      { value: 140, color: '#7b3294' },
    ],
  },
  // Green (low), yellow, red (high); `reverse: true` for "high is good" (e.g. battery).
  traffic: {
    type: 'relative',
    steps: [
      { value: 0, color: '#1a9850' },
      { value: 0.5, color: '#fee08b' },
      { value: 1, color: '#d73027' },
    ],
  },
  viridis: {
    type: 'relative',
    steps: [
      { value: 0, color: '#440154' },
      { value: 0.25, color: '#3b528b' },
      { value: 0.5, color: '#21918c' },
      { value: 0.75, color: '#5ec962' },
      { value: 1, color: '#fde725' },
    ],
  },
  mono: {
    type: 'relative',
    steps: [
      { value: 0, color: `color-mix(in srgb, ${MONO_BASE} 12%, transparent)` },
      { value: 1, color: MONO_BASE },
    ],
  },
};

export interface ResolvedScale {
  /** Stops in the entity's units, sorted ascending, at least two. */
  stops: ScaleStep[];
  min: number;
  max: number;
}

export interface ScaleContext {
  unit?: string;
  deviceClass?: string;
  /** Values currently shown (used for relative scales without fixed min/max). */
  values: number[];
  /** Aggregation is on_ratio → fixed 0..1 range. */
  isRatio: boolean;
  /** Aggregation shown; level presets (temperature, CO2, …) are only chosen for level aggregations. */
  aggregation?: Aggregation;
}

/** Aggregations whose values are levels of the entity (not sums or changes). */
const LEVEL_AGGREGATIONS: Aggregation[] = ['mean', 'min', 'max', 'last'];

export interface AutoChoice {
  preset: PresetName;
  reverse?: boolean;
  min?: number;
  max?: number;
}

/** Preset chosen from the entity's device class when the config names none. */
export function autoPreset(ctx: ScaleContext): AutoChoice {
  if (ctx.isRatio || (ctx.aggregation !== undefined && !LEVEL_AGGREGATIONS.includes(ctx.aggregation))) {
    return { preset: 'viridis' };
  }
  switch (ctx.deviceClass) {
    case 'temperature':
      return { preset: 'temperature' };
    case 'humidity':
      return { preset: 'humidity' };
    case 'carbon_dioxide':
      return { preset: 'co2' };
    case 'pm25':
      return { preset: 'pm25' };
    case 'battery':
      return ctx.unit === '%'
        ? { preset: 'traffic', reverse: true, min: 0, max: 100 }
        : { preset: 'traffic', reverse: true };
    default:
      return { preset: 'viridis' };
  }
}

const cToF = (c: number): number => (c * 9) / 5 + 32;

function relativeRange(
  min: number | undefined,
  max: number | undefined,
  ctx: ScaleContext,
): [number, number] {
  let lo = min ?? (ctx.isRatio ? 0 : undefined);
  let hi = max ?? (ctx.isRatio ? 1 : undefined);
  if (lo === undefined || hi === undefined) {
    let dmin = Infinity;
    let dmax = -Infinity;
    for (const v of ctx.values) {
      if (v < dmin) dmin = v;
      if (v > dmax) dmax = v;
    }
    if (dmin === Infinity) {
      dmin = 0;
      dmax = 1;
    }
    lo ??= dmin;
    hi ??= dmax;
  }
  if (!(hi > lo)) hi = lo + 1;
  return [lo, hi];
}

function spread(positions: ScaleStep[], [lo, hi]: [number, number]): ScaleStep[] {
  return positions.map((s) => ({ value: lo + s.value * (hi - lo), color: s.color }));
}

function toPositions(steps: ScaleStep[]): ScaleStep[] {
  const first = steps[0].value;
  const span = steps[steps.length - 1].value - first || 1;
  return steps.map((s) => ({ value: (s.value - first) / span, color: s.color }));
}

/** Mirror the colors over the same value range. */
function reversed(stops: ScaleStep[]): ScaleStep[] {
  const lo = stops[0].value;
  const hi = stops[stops.length - 1].value;
  return stops.map((s) => ({ value: lo + hi - s.value, color: s.color })).reverse();
}

export function resolveScale(cfg: NormalizedScale, ctx: ScaleContext): ResolvedScale {
  let stops: ScaleStep[];
  let reverse = cfg.reverse ?? false;
  if (cfg.steps) {
    stops =
      (cfg.type ?? 'absolute') === 'absolute'
        ? cfg.steps
        : spread(cfg.steps, relativeRange(cfg.min, cfg.max, ctx));
  } else {
    const auto = cfg.preset ? undefined : autoPreset(ctx);
    const name: PresetName = cfg.preset ?? auto!.preset;
    // `reverse` flips whatever the scale would show, so false (the editor's unchecked box) is always the default
    reverse = (auto?.reverse ?? false) !== reverse;
    const preset = PRESETS[name];
    const unitFits = !ctx.unit || !preset.units || preset.units.includes(ctx.unit);
    const type = cfg.type ?? (preset.type === 'absolute' && unitFits ? 'absolute' : 'relative');
    if (type === 'absolute') {
      const fahrenheit = name === 'temperature' && ctx.unit === '°F';
      stops = preset.steps.map((s) => ({ value: fahrenheit ? cToF(s.value) : s.value, color: s.color }));
    } else {
      const positions = preset.type === 'relative' ? preset.steps : toPositions(preset.steps);
      stops = spread(positions, relativeRange(cfg.min ?? auto?.min, cfg.max ?? auto?.max, ctx));
    }
  }
  if (reverse) stops = reversed(stops);
  return { stops, min: stops[0].value, max: stops[stops.length - 1].value };
}

/** CSS color for a value; interpolates in OKLab via color-mix so any CSS color (incl. var()) works. */
export function colorFor(scale: ResolvedScale, value: number): string {
  const { stops } = scale;
  if (value <= stops[0].value) return stops[0].color;
  const last = stops[stops.length - 1];
  if (value >= last.value) return last.color;
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    if (value <= hi.value) {
      const lo = stops[i - 1];
      const f = (value - lo.value) / (hi.value - lo.value);
      if (f <= 0) return lo.color;
      if (f >= 1) return hi.color;
      const pct = Math.round((1 - f) * 1000) / 10;
      return `color-mix(in oklab, ${lo.color} ${pct}%, ${hi.color})`;
    }
  }
  return last.color;
}

/** CSS linear-gradient for the legend. */
export function legendGradient(scale: ResolvedScale, direction = 'to right'): string {
  const span = scale.max - scale.min || 1;
  const parts = scale.stops.map(
    (s) => `${s.color} ${Math.round(((s.value - scale.min) / span) * 1000) / 10}%`,
  );
  return `linear-gradient(${direction}, ${parts.join(', ')})`;
}
