import type { NormalizedScale, PresetName, ScaleStep, ScaleType } from './config';

interface Preset {
  type: ScaleType;
  /** absolute presets: values in °C; relative presets: positions 0..1 */
  steps: ScaleStep[];
}

const MONO_BASE = 'var(--chm-mono-color, var(--primary-color, #03a9f4))';

export const PRESETS: Record<PresetName, Preset> = {
  temperature: {
    type: 'absolute',
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
}

const cToF = (c: number): number => (c * 9) / 5 + 32;

function relativeRange(cfg: NormalizedScale, ctx: ScaleContext): [number, number] {
  let lo = cfg.min ?? (ctx.isRatio ? 0 : undefined);
  let hi = cfg.max ?? (ctx.isRatio ? 1 : undefined);
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

export function resolveScale(cfg: NormalizedScale, ctx: ScaleContext): ResolvedScale {
  let stops: ScaleStep[];
  if (cfg.steps) {
    stops = (cfg.type ?? 'absolute') === 'absolute' ? cfg.steps : spread(cfg.steps, relativeRange(cfg, ctx));
  } else {
    const name: PresetName =
      cfg.preset ?? (ctx.deviceClass === 'temperature' && !ctx.isRatio ? 'temperature' : 'viridis');
    const preset = PRESETS[name];
    const type = cfg.type ?? preset.type;
    if (type === 'absolute') {
      const fahrenheit = name === 'temperature' && ctx.unit === '°F';
      stops = preset.steps.map((s) => ({ value: fahrenheit ? cToF(s.value) : s.value, color: s.color }));
    } else {
      const positions = preset.type === 'relative' ? preset.steps : toPositions(preset.steps);
      stops = spread(positions, relativeRange(cfg, ctx));
    }
  }
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
