/**
 * Prepares a fresh Home Assistant (e2e-ha/compose.yaml) for the end-to-end test:
 * onboarding, long-term statistics, some history, the card as dashboard resource and a test dashboard.
 *
 * Run after `pnpm build` and starting the container: `node e2e-ha/setup.ts` (Node's type stripping, no deps).
 * Writes e2e-ha-run/storage-state.json (logged-in browser state for Playwright) and e2e-ha-run/session.json.
 * Safe to run again against an already prepared instance.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HA_URL = (process.env.HA_URL ?? 'http://localhost:8123').replace(/\/$/, '');
const CLIENT_ID = `${HA_URL}/`;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = join(ROOT, 'e2e-ha-run');
const USER = { name: 'E2E Tester', username: 'e2e', password: 'e2e-password-1234', language: 'en' };
const TIME_ZONE = 'Europe/Berlin';
const DASHBOARD = 'chrono-e2e';
const RESOURCE_URL = '/local/chrono-heatmap-card.js';
const HOUR = 3_600_000;
const STAT_DAYS = 40;

const TEMPERATURE = 'sensor.outdoor_temperature';
const ENERGY = 'sensor.energy_meter';
const DOOR = 'binary_sensor.front_door';

const CARDS = [
  { entity: TEMPERATURE, title: 'Temperature by hour', row_unit: 'day', rows: 14 },
  { entity: ENERGY, title: 'Energy per day', row_unit: 'week', column_unit: 'day', rows: 5 },
  { entity: DOOR, title: 'Front door open', row_unit: 'hour', column_unit: '5minute', rows: 2 },
  { entity: TEMPERATURE, title: 'Temperature by day', row_unit: 'month', rows: 2, orientation: 'vertical' },
].map((c) => ({ type: 'custom:chrono-heatmap-card', ...c }));

const log = (msg: string) => console.log(`[setup ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns a value other than undefined (errors count as "not yet"). */
async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}${lastError ? `: ${String(lastError)}` : ''}`);
    }
    await sleep(1000);
  }
}

// ---- REST ------------------------------------------------------------------------------------------

async function http<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (typeof init.body === 'string' && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const res = await fetch(`${HA_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const post = <T>(path: string, body: unknown, token?: string) =>
  http<T>(path, { method: 'POST', body: JSON.stringify(body), token });

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function exchangeCode(code: string): Promise<Tokens> {
  return http<Tokens>('/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CLIENT_ID }).toString(),
  });
}

/** Log in through the login flow API (used when the user already exists, e.g. a second run). */
async function loginFlow(): Promise<Tokens> {
  const redirect_uri = `${HA_URL}/?auth_callback=1`;
  const flow = await post<{ flow_id: string }>('/auth/login_flow', {
    client_id: CLIENT_ID,
    handler: ['homeassistant', null],
    redirect_uri,
  });
  const result = await post<{ type: string; result?: string }>(`/auth/login_flow/${flow.flow_id}`, {
    client_id: CLIENT_ID,
    username: USER.username,
    password: USER.password,
  });
  if (result.type !== 'create_entry' || !result.result)
    throw new Error(`Login failed: ${JSON.stringify(result)}`);
  return exchangeCode(result.result);
}

type Steps = Record<string, boolean>;

async function onboard(): Promise<Tokens> {
  const status = await waitFor(
    'Home Assistant HTTP server',
    async () => {
      const steps = await http<{ step: string; done: boolean }[]>('/api/onboarding');
      return Object.fromEntries(steps.map((s) => [s.step, s.done])) as Steps;
    },
    300_000,
  );
  log(`HTTP up, onboarding steps: ${JSON.stringify(status)}`);

  let tokens: Tokens;
  if (!status.user) {
    const { auth_code } = await post<{ auth_code: string }>('/api/onboarding/users', {
      client_id: CLIENT_ID,
      ...USER,
    });
    tokens = await exchangeCode(auth_code);
    log('user created');
  } else {
    tokens = await loginFlow();
    log('logged in as existing user');
  }

  const ws = await connect(tokens.access_token);
  try {
    await ws.call({
      type: 'config/core/update',
      time_zone: TIME_ZONE,
      country: 'DE',
      currency: 'EUR',
      unit_system: 'metric',
      latitude: 52.52,
      longitude: 13.405,
      elevation: 34,
    });
  } finally {
    ws.close();
  }
  if (!status.core_config) await post('/api/onboarding/core_config', {}, tokens.access_token);
  if (!status.analytics) await post('/api/onboarding/analytics', {}, tokens.access_token);
  if (!status.integration) {
    await post(
      '/api/onboarding/integration',
      { client_id: CLIENT_ID, redirect_uri: `${HA_URL}/?auth_callback=1` },
      tokens.access_token,
    );
  }
  log('onboarding done');
  return tokens;
}

// ---- WebSocket -------------------------------------------------------------------------------------

interface Socket {
  call<T = unknown>(msg: Record<string, unknown>): Promise<T>;
  close(): void;
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${HA_URL.replace(/^http/, 'ws')}/api/websocket`);
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let nextId = 1;
    const api: Socket = {
      call: <T>(msg: Record<string, unknown>) =>
        new Promise<T>((res, rej) => {
          const id = nextId++;
          pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
          socket.send(JSON.stringify({ ...msg, id }));
        }),
      close: () => socket.close(),
    };
    socket.addEventListener('error', () => reject(new Error('WebSocket error')));
    socket.addEventListener('close', () => {
      for (const p of pending.values()) p.reject(new Error('WebSocket closed'));
      pending.clear();
    });
    socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') resolve(api);
      else if (msg.type === 'auth_invalid') reject(new Error(`WebSocket auth failed: ${msg.message}`));
      else if (msg.type === 'result') {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.success) p?.resolve(msg.result);
        else p?.reject(new Error(`${msg.error?.code}: ${msg.error?.message}`));
      }
    });
  });
}

// ---- test data -------------------------------------------------------------------------------------

/** Starts (UTC, ms) of the last `days` × 24 complete hours, oldest first. */
function pastHours(days: number): number[] {
  const lastComplete = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return Array.from({ length: days * 24 }, (_, i) => lastComplete - (days * 24 - 1 - i) * HOUR);
}

const round = (v: number, digits = 3) => Number(v.toFixed(digits));
const berlinHour = (t: number) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(t),
  );

async function importStatistics(ws: Socket, meterNow: number): Promise<void> {
  const hours = pastHours(STAT_DAYS);

  // temperature: daily cycle (min at 4:00, max at 16:00) plus a drift over the days
  const temperature = hours.map((t, i) => {
    const day = i / 24;
    const mean =
      10 +
      7 * Math.sin(((berlinHour(t) - 10) / 24) * 2 * Math.PI) +
      6 * Math.sin(day / 4) +
      3 * Math.sin(day * 1.9);
    return {
      start: new Date(t).toISOString(),
      mean: round(mean, 2),
      min: round(mean - 0.8, 2),
      max: round(mean + 0.9, 2),
    };
  });
  await ws.call({
    type: 'recorder/import_statistics',
    metadata: {
      statistic_id: TEMPERATURE,
      source: 'recorder',
      name: null,
      unit_of_measurement: '°C',
      unit_class: 'temperature',
      has_sum: false,
      mean_type: 1, // arithmetic
    },
    stats: temperature,
  });

  // energy: hourly consumption (more in the evening and on weekends); state ends at the current meter value
  const usage = hours.map((t, i) => {
    const h = berlinHour(t);
    const weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 1.4 : 1;
    const dayFactor = 1 + 0.35 * Math.sin(Math.floor(i / 24) * 2.3);
    const base = 0.15 + (h >= 7 && h < 22 ? 0.35 : 0) + (h >= 18 && h < 21 ? 0.6 : 0);
    return round(base * weekend * dayFactor);
  });
  const total = usage.reduce((a, b) => a + b, 0);
  let sum = 0;
  const energy = hours.map((t, i) => {
    sum += usage[i];
    return { start: new Date(t).toISOString(), state: round(meterNow - total + sum), sum: round(sum) };
  });
  await ws.call({
    type: 'recorder/import_statistics',
    metadata: {
      statistic_id: ENERGY,
      source: 'recorder',
      name: null,
      unit_of_measurement: 'kWh',
      unit_class: 'energy',
      has_sum: true,
      mean_type: 0, // none
    },
    stats: energy,
  });

  // the import is queued in the recorder: wait until it is readable
  const from = new Date(hours[0]).toISOString();
  await waitFor('imported statistics', async () => {
    const res = await ws.call<Record<string, unknown[]>>({
      type: 'recorder/statistics_during_period',
      start_time: from,
      statistic_ids: [TEMPERATURE, ENERGY],
      period: 'hour',
      types: ['mean', 'sum'],
    });
    const counts = [TEMPERATURE, ENERGY].map((id) => res[id]?.length ?? 0);
    return counts.every((c) => c >= hours.length) ? counts : undefined;
  });
  log(`imported ${hours.length} hourly statistics each for ${TEMPERATURE} and ${ENERGY}`);
}

async function createHistory(ws: Socket): Promise<void> {
  const start = new Date(Date.now() - 5_000).toISOString();
  for (const value of [11.8, 12.6, 13.1]) {
    await ws.call({
      type: 'call_service',
      domain: 'input_number',
      service: 'set_value',
      service_data: { value },
      target: { entity_id: 'input_number.outdoor_temperature' },
    });
  }
  for (let i = 0; i < 4; i++) {
    await ws.call({
      type: 'call_service',
      domain: 'input_boolean',
      service: i % 2 === 0 ? 'turn_on' : 'turn_off',
      target: { entity_id: 'input_boolean.front_door_open' },
    });
    await sleep(1500);
  }
  // leave the door open so the current period has some "on" time, then wait for the recorder to commit
  await ws.call({
    type: 'call_service',
    domain: 'input_boolean',
    service: 'turn_on',
    target: { entity_id: 'input_boolean.front_door_open' },
  });
  await waitFor('recorded history', async () => {
    const res = await ws.call<Record<string, unknown[]>>({
      type: 'history/history_during_period',
      start_time: start,
      entity_ids: [DOOR, TEMPERATURE],
      minimal_response: true,
      no_attributes: true,
    });
    return (res[DOOR]?.length ?? 0) >= 5 && (res[TEMPERATURE]?.length ?? 0) >= 3 ? true : undefined;
  });
  log('history recorded');
}

async function installCard(ws: Socket): Promise<void> {
  mkdirSync(join(RUN_DIR, 'config', 'www'), { recursive: true });
  copyFileSync(
    join(ROOT, 'dist', 'chrono-heatmap-card.js'),
    join(RUN_DIR, 'config', 'www', 'chrono-heatmap-card.js'),
  );
  await waitFor('card served under /local', async () => {
    const res = await fetch(`${HA_URL}${RESOURCE_URL}`);
    return res.ok ? true : undefined;
  });

  const resources = await ws.call<{ url: string }[]>({ type: 'lovelace/resources' });
  if (!resources.some((r) => r.url.startsWith(RESOURCE_URL))) {
    await ws.call({ type: 'lovelace/resources/create', url: RESOURCE_URL, res_type: 'module' });
  }

  const dashboards = await ws.call<{ url_path: string }[]>({ type: 'lovelace/dashboards/list' });
  if (!dashboards.some((d) => d.url_path === DASHBOARD)) {
    await ws.call({
      type: 'lovelace/dashboards/create',
      url_path: DASHBOARD,
      title: 'Chrono E2E',
      icon: 'mdi:grid',
      show_in_sidebar: true,
      require_admin: false,
      mode: 'storage',
    });
  }
  await ws.call({
    type: 'lovelace/config/save',
    url_path: DASHBOARD,
    config: { title: 'Chrono E2E', views: [{ title: 'Heatmaps', path: 'heatmaps', cards: CARDS }] },
  });
  log(`resource ${RESOURCE_URL} and dashboard /${DASHBOARD} ready`);
}

function writeBrowserState(tokens: Tokens): void {
  mkdirSync(RUN_DIR, { recursive: true });
  // the frontend keeps its tokens in localStorage["hassTokens"]
  const hassTokens = {
    ...tokens,
    hassUrl: HA_URL,
    clientId: CLIENT_ID,
    expires: Date.now() + tokens.expires_in * 1000,
  };
  const state = {
    cookies: [],
    origins: [{ origin: HA_URL, localStorage: [{ name: 'hassTokens', value: JSON.stringify(hassTokens) }] }],
  };
  writeFileSync(join(RUN_DIR, 'storage-state.json'), JSON.stringify(state, null, 2));
  writeFileSync(
    join(RUN_DIR, 'session.json'),
    JSON.stringify(
      { username: USER.username, password: USER.password, dashboard: `/${DASHBOARD}/heatmaps` },
      null,
      2,
    ),
  );
}

// ---- main ------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const started = Date.now();
  const tokens = await onboard();
  const ws = await connect(tokens.access_token);
  try {
    const config = await waitFor('Home Assistant running', async () => {
      const c = await ws.call<{ state: string; version: string; time_zone: string }>({ type: 'get_config' });
      return c.state === 'RUNNING' ? c : undefined;
    });
    log(`Home Assistant ${config.version} running, time zone ${config.time_zone}`);
    if (process.env.GITHUB_OUTPUT)
      writeFileSync(process.env.GITHUB_OUTPUT, `ha_version=${config.version}\n`, { flag: 'a' });

    const states = await waitFor('test entities', async () => {
      const all = await ws.call<{ entity_id: string; state: string }[]>({ type: 'get_states' });
      const found = [TEMPERATURE, ENERGY, DOOR].map((id) => all.find((s) => s.entity_id === id));
      return found.every((s) => s && s.state !== 'unavailable' && s.state !== 'unknown') ? found : undefined;
    });
    await importStatistics(ws, Number(states[1]!.state));
    await createHistory(ws);
    await installCard(ws);
  } finally {
    ws.close();
  }
  writeBrowserState(tokens);
  log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

// exit right away: idle keep-alive connections would keep the process alive for a while
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
