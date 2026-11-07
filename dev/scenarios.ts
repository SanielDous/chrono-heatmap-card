// Deterministic fake sensors for the dev page. Every value is a pure function of time,
// so statistics and history always agree with each other and screenshots are reproducible.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = 5 * MIN;

/** Integer hash → [0, 1) */
function noise(seed: number, n: number): number {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [-1, 1] over slots of `period` ms. */
function smooth(seed: number, t: number, period: number): number {
  const x = t / period;
  const i = Math.floor(x);
  const f = x - i;
  const a = noise(seed, i) * 2 - 1;
  const b = noise(seed, i + 1) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

/** Local hour of day in Europe/Berlin-ish (UTC+1/+2 is close enough for fake data). */
const hourOfDay = (t: number): number => ((((t + HOUR) % DAY) + DAY) % DAY) / HOUR;
const dayOfYear = (t: number): number => {
  const d = new Date(t);
  return (
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY
  );
};

export interface Scenario {
  entity_id: string;
  name: string;
  attributes: Record<string, unknown>;
  /** numeric value at time t, or a discrete state string; null = unavailable */
  valueAt(t: number): number | string | null;
  /** how often the state is sampled into history (ms) */
  sampleEvery: number;
  hasStatistics: boolean;
  /** cumulative meter (state_class total_increasing) */
  meter?: boolean;
  decimals?: number;
}

const outdoor: Scenario = {
  entity_id: 'sensor.outdoor_temperature',
  name: 'Outdoor temperature',
  attributes: {
    friendly_name: 'Outdoor temperature',
    unit_of_measurement: '°C',
    device_class: 'temperature',
    state_class: 'measurement',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  decimals: 1,
  valueAt(t) {
    const season = 10 - 11 * Math.cos((2 * Math.PI * (dayOfYear(t) - 20)) / 365);
    const daily = 4.5 * Math.sin((2 * Math.PI * (hourOfDay(t) - 9)) / 24);
    const weather = 4 * smooth(11, t, 3 * DAY) + 0.6 * smooth(12, t, 2 * HOUR);
    return season + daily + weather;
  },
};

const indoor: Scenario = {
  entity_id: 'sensor.living_room_temperature',
  name: 'Living room temperature',
  attributes: {
    friendly_name: 'Living room temperature',
    unit_of_measurement: '°C',
    device_class: 'temperature',
    state_class: 'measurement',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  decimals: 1,
  valueAt(t) {
    // heated 6–22 h to about 21 °C, night setback to about 18.5 °C, some sun in the afternoon
    const h = hourOfDay(t);
    const heated = h >= 6 && h < 22 ? 1 : 0;
    const sun = Math.max(0, Math.sin((Math.PI * (h - 11)) / 8)) * (1.5 + smooth(31, t, 2 * DAY));
    return 18.6 + 2.4 * heated + sun + 0.4 * smooth(32, t, 3 * HOUR);
  },
};

const power = (t: number): number => {
  const h = hourOfDay(t);
  const morning = Math.exp(-((h - 7) ** 2) / 1.5) * 1400;
  const evening = Math.exp(-((h - 19) ** 2) / 3) * 1800;
  const base = 180 + 60 * smooth(21, t, 6 * HOUR);
  const spike =
    noise(22, Math.floor(t / (10 * MIN))) > 0.93 ? 1500 + 1000 * noise(23, Math.floor(t / (10 * MIN))) : 0;
  const weekend = new Date(t).getUTCDay() % 6 === 0 ? 1.3 : 1;
  return Math.max(60, (base + morning + evening) * weekend + spike + 40 * smooth(24, t, 15 * MIN));
};

const powerScenario: Scenario = {
  entity_id: 'sensor.house_power',
  name: 'House power',
  attributes: {
    friendly_name: 'House power',
    unit_of_measurement: 'W',
    device_class: 'power',
    state_class: 'measurement',
  },
  sampleEvery: MIN,
  hasStatistics: true,
  decimals: 0,
  valueAt: power,
};

// Energy meter = integral of power in 5-minute slots, starting at a fixed origin.
const ENERGY_ORIGIN = Date.UTC(2023, 0, 1);
const energyPrefix: number[] = [0];
function energyAt(t: number): number {
  const slots = Math.max(0, Math.floor((t - ENERGY_ORIGIN) / SLOT));
  while (energyPrefix.length <= slots) {
    const i = energyPrefix.length - 1;
    energyPrefix.push(energyPrefix[i] + (power(ENERGY_ORIGIN + i * SLOT) * SLOT) / HOUR / 1000);
  }
  return 12000 + energyPrefix[slots];
}

const energyScenario: Scenario = {
  entity_id: 'sensor.house_energy',
  name: 'House energy',
  attributes: {
    friendly_name: 'House energy',
    unit_of_measurement: 'kWh',
    device_class: 'energy',
    state_class: 'total_increasing',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  meter: true,
  decimals: 3,
  valueAt: energyAt,
};

const door: Scenario = {
  entity_id: 'binary_sensor.front_door',
  name: 'Front door',
  attributes: { friendly_name: 'Front door', device_class: 'door' },
  sampleEvery: 5 * MIN,
  hasStatistics: false,
  valueAt(t) {
    const h = hourOfDay(t);
    const busy = h >= 6.5 && h <= 8.5 ? 0.35 : h >= 16 && h <= 20 ? 0.25 : h >= 9 && h <= 22 ? 0.06 : 0.005;
    return noise(31, Math.floor(t / SLOT)) < busy ? 'on' : 'off';
  },
};

const co2: Scenario = {
  entity_id: 'sensor.office_co2',
  name: 'Office CO₂',
  attributes: {
    friendly_name: 'Office CO₂',
    unit_of_measurement: 'ppm',
    device_class: 'carbon_dioxide',
    state_class: 'measurement',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  decimals: 0,
  valueAt(t) {
    // sensor drops out now and then
    if (noise(41, Math.floor(t / (3 * HOUR))) > 0.9) return null;
    const h = hourOfDay(t);
    const work = h >= 8 && h <= 18 ? 500 * Math.sin((Math.PI * (h - 8)) / 10) : 0;
    return 430 + work + 80 * smooth(42, t, 2 * HOUR);
  },
};

const humidity: Scenario = {
  entity_id: 'sensor.bathroom_humidity',
  name: 'Bathroom humidity',
  attributes: {
    friendly_name: 'Bathroom humidity',
    unit_of_measurement: '%',
    device_class: 'humidity',
    state_class: 'measurement',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  decimals: 0,
  valueAt(t) {
    const h = hourOfDay(t);
    // showers in the morning (and some evenings) push humidity up, then it decays
    const sinceShower = (start: number) => (h >= start ? h - start : Infinity);
    const evening = noise(51, Math.floor(t / DAY)) > 0.6 ? Math.exp(-sinceShower(21) / 0.8) : 0;
    const shower = Math.exp(-sinceShower(6.8) / 0.8) + evening;
    return Math.min(98, 44 + 8 * smooth(52, t, 2 * DAY) + 45 * shower);
  },
};

const battery: Scenario = {
  entity_id: 'sensor.phone_battery',
  name: 'Phone battery',
  attributes: {
    friendly_name: 'Phone battery',
    unit_of_measurement: '%',
    device_class: 'battery',
    state_class: 'measurement',
  },
  sampleEvery: 5 * MIN,
  hasStatistics: true,
  decimals: 0,
  valueAt(t) {
    // charged overnight (23–7 h), then drains during the day at a varying rate
    const h = hourOfDay(t);
    if (h >= 23 || h < 7) return Math.min(100, 30 + ((h + 1) % 24) * 12);
    const rate = 5 + 3 * noise(61, Math.floor(t / DAY));
    return Math.max(4, 100 - (h - 7) * rate);
  },
};

export const SCENARIOS: Scenario[] = [
  outdoor,
  indoor,
  powerScenario,
  energyScenario,
  door,
  co2,
  humidity,
  battery,
];

export function scenarioFor(entityId: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.entity_id === entityId);
}

export function formatState(s: Scenario, v: number | string | null): string {
  if (v === null) return 'unavailable';
  if (typeof v === 'string') return v;
  return v.toFixed(s.decimals ?? 2);
}
