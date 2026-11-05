# Chrono Heatmap Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Home Assistant custom card `chrono-heatmap-card` that renders one entity's history as a configurable time-grid heatmap, plus a mock-data dev page and GitHub CI/release pipeline.

**Architecture:** Pure, unit-tested core (config normalization → grid layout → base buckets from statistics/history → cell aggregation → color scale) feeding a thin Lit element that renders SVG inside `ha-card`. A Vite dev page supplies a mock `hass` that answers the same WebSocket calls with seeded data; Playwright screenshots that page in CI.

**Tech Stack:** TypeScript (strict), Lit, Vite (library mode), pnpm, date-fns + @date-fns/tz, Vitest, Playwright, ESLint + Prettier, semantic-release, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-chrono-heatmap-card-design.md`

## Global Constraints

- Element/type: `chrono-heatmap-card`; YAML `type: custom:chrono-heatmap-card`; bundle `dist/chrono-heatmap-card.js` (single ES module, Lit bundled).
- No `ha-*` elements except `ha-card`.
- Only latest HA; no backwards compatibility code.
- UI strings in English and German; fallback English.
- Times follow `hass.locale` (time_zone `local`/`server`, `first_weekday`, language); fallback `hass.config.time_zone`.
- Empty/no-data/future cells never get a scale color.
- Base buckets never overlap (no double counting).
- Releases: semantic-release on push to `main`, no commit back to `main`, start at `0.x` (tag `v0.0.0` on initial commit).
- Dev runs on WSL2/Windows without Docker.

## Review Focus

1. DST days (23/25 h) in `day × hour` – expect 23 filled + 1 empty / 25 columns, no value lost.
2. Entity without statistics (no `state_class`) on `source: auto` – expect history fallback, not an empty card.
3. Non-numeric states (`unavailable`, `unknown`) in numeric history – expect them to be gaps, not zeros.
4. `total_increasing` meter reset (value drops) within a bucket – expect `change` not to go hugely negative (treat drop as reset: count new value from 0).
5. Entity missing from `hass.states` (renamed/deleted) – expect a readable warning in the card, not an exception.

Each item has a test in the owning task (Tasks 3, 4, 4, 4, 7).

---

## File Structure

```
src/
  chrono-heatmap-card.ts   Lit element, registration, data loading lifecycle
  config.ts                types, defaults, validation (normalizeConfig)
  grid.ts                  buildGrid(): rows × columns with [start,end) per cell, tz/DST aware
  buckets.ts               base buckets from statistics + history, aggregation into cells
  data.ts                  WebSocket fetch (statistics, history, list_statistic_ids)
  scale.ts                 presets, resolveScale(), colorFor()
  render.ts                SVG grid, labels, legend templates
  editor.ts                getConfigForm() schema
  i18n.ts                  en/de strings + localize()
  hass-types.ts            minimal HomeAssistant typings
dev/
  index.html, main.ts      gallery + YAML playground, theme/lang toggles
  mock-hass.ts             mock hass with callWS for the 3 WS commands
  scenarios.ts             seeded generators
  ha-shim.ts               ha-card shim + HA theme CSS variables
tests/                     vitest unit tests
e2e/screenshots.spec.ts    Playwright screenshots
.github/workflows/ci.yml, release.yml
```

### Task 1: Scaffold, tooling, CI skeleton

**Files:** package.json, tsconfig.json, vite.config.ts, vitest config (in vite.config.ts), eslint.config.js, .prettierrc.json, .gitignore, hacs.json, .releaserc.json, .github/workflows/ci.yml, release.yml, src/chrono-heatmap-card.ts (stub)

- [ ] `pnpm init`, add deps: lit, date-fns, @date-fns/tz; dev: typescript, vite, vitest, @playwright/test, eslint, typescript-eslint, prettier, semantic-release.
- [ ] Scripts: `dev`, `build`, `test`, `lint`, `typecheck`, `format`, `screenshots`.
- [ ] Vite lib build → `dist/chrono-heatmap-card.js`, inject `__VERSION__` from env `RELEASE_VERSION` (default `dev`).
- [ ] hacs.json: `{ "name": "Chrono Heatmap Card", "filename": "chrono-heatmap-card.js", "render_readme": true }`.
- [ ] ci.yml: lint, typecheck, test, build, PR-title conventional check, HACS validation (allowed to soft-fail while repo private), screenshots job (added in Task 9).
- [ ] release.yml: on push main → build with version → semantic-release (github plugin, asset upload).
- [ ] Verify: `pnpm lint && pnpm typecheck && pnpm build` succeed. Commit `chore: scaffold project`.

### Task 2: Config normalization

**Files:** src/config.ts, tests/config.test.ts

**Produces:**

```ts
type RowUnit = 'hour' | 'day' | 'week' | 'month' | 'year';
type ColumnUnit = 'minute' | '5minute' | 'hour' | 'day' | 'week' | 'month';
type Aggregation = 'mean' | 'min' | 'max' | 'sum' | 'last' | 'change' | 'on_ratio';
interface CardConfig {
  type: string;
  entity: string;
  title?: string;
  row_unit?: RowUnit;
  column_unit?: ColumnUnit;
  rows?: number;
  orientation?: 'horizontal' | 'vertical';
  source?: 'auto' | 'statistics' | 'history';
  aggregation?: Aggregation;
  on_states?: string[];
  scale?: ScaleConfig;
  show_legend?: boolean;
  show_labels?: boolean;
}
interface ScaleConfig {
  preset?: 'temperature' | 'viridis' | 'mono';
  type?: 'absolute' | 'relative';
  min?: number;
  max?: number;
  steps?: { value: number; color: string }[];
}
interface NormalizedConfig {
  /* all required, aggregation may be 'auto' until entity known */
}
const ALLOWED_COLUMNS: Record<RowUnit, ColumnUnit[]>; // first = default
const DEFAULT_ROWS: Record<RowUnit, number>; // hour 12, day 14, week 8, month 6, year 2
function normalizeConfig(c: CardConfig): NormalizedConfig; // throws ConfigError(key, params)
```

- [ ] Tests: missing entity throws; `day`+`minute` throws; defaults applied; `rows` < 1 throws; relative steps outside 0–1 throw; `type: absolute` with viridis w/o steps throws; custom steps default absolute.
- [ ] Implement, pass, commit `feat: config normalization`.

### Task 3: Grid layout

**Files:** src/grid.ts, tests/grid.test.ts

**Produces:**

```ts
interface Cell { start: number; end: number; row: number; col: number } // epoch ms, [start,end)
interface Grid { rows: { start:number; end:number; cells: (Cell|null)[] }[]; columns: number }
function buildGrid(rowUnit, colUnit, rowCount, now: number, tz: string, weekStartsOn: 0..6): Grid
```

Column index rules: minute/5minute = minutes since row start / size; hour = ordinal hour since row start (so DST days give 23/25); day in week = days since week start; day in month = date−1; month in year = month; week in year = spec 4.10 #3. Grid width = max cells over rows; shorter rows padded with `null`.

- [ ] Tests: day×hour on Europe/Berlin 2026-03-29 has 23 cells + null; 2026-10-25 has 25; month×day Feb has 28 + 3 null; week starts Monday vs Sunday; year×week: 2026 with Monday start → week 0 starts 2026-01-05, Jan 1–4 belong to 2025's last column; hour×5minute has 12 cols; last row contains `now`.
- [ ] Implement with `TZDate` + date-fns, pass, commit `feat: tz-aware grid layout`.

### Task 4: Base buckets & aggregation

**Files:** src/buckets.ts, tests/buckets.test.ts

**Produces:**

```ts
interface BaseBucket {
  start: number;
  end: number;
  mean: number;
  min: number;
  max: number;
  last: number;
  change: number;
  onRatio?: number;
  coverage: number;
}
interface StatRow {
  start: number;
  end: number;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  state?: number | null;
  sum?: number | null;
  change?: number | null;
}
interface HistPoint {
  t: number;
  s: string;
}
function bucketsFromStatistics(rows: StatRow[]): BaseBucket[];
function bucketsFromHistory(
  points: HistPoint[],
  from: number,
  to: number,
  sizeMs: number,
  mode: 'numeric' | 'binary',
  onStates: string[],
  now: number,
): BaseBucket[];
function mergeBuckets(stat: BaseBucket[], hist: BaseBucket[]): BaseBucket[]; // hist only where no stat bucket covers
function aggregateCells(grid: Grid, buckets: BaseBucket[], agg: Aggregation): (number | null)[][];
```

Base bucket size: minute → 1 min, 5minute → 5 min, otherwise 1 h. History: step function; time-weighted mean; non-numeric states in numeric mode are gaps; change = last − first with drops treated as reset (add new value); future part excluded. `sum` = sum of bucket means.

- [ ] Tests: time-weighted mean; `unavailable` gap not zero; binary on_ratio 0.25; meter reset; merge prefers statistics, no overlap; aggregateCells mean weights by coverage, `change` sums, empty cell → null.
- [ ] Implement, pass, commit `feat: base buckets and cell aggregation`.

### Task 5: Color scale

**Files:** src/scale.ts, tests/scale.test.ts

**Produces:** `PRESETS`, `resolveScale(cfg: NormalizedConfig['scale'], unit: string|undefined, values: number[], isRatio: boolean): ResolvedScale` with `{ stops:{value:number;color:string}[], min:number, max:number }` (stops in raw units), `colorFor(scale, v): string`.

- [ ] Tests: temperature preset °F conversion (20 °C stop → 68); relative with data min/max; on_ratio fixed 0..1; interpolation midpoint; clamp outside range; all-equal values do not divide by zero.
- [ ] Implement, pass, commit `feat: color scales`.

### Task 6: i18n + editor schema

**Files:** src/i18n.ts, src/editor.ts, tests/i18n.test.ts, tests/editor.test.ts

**Produces:** `localize(lang: string, key: string, params?: Record<string,string|number>): string`; `getConfigFormSchema()` returning `{ schema, computeLabel, computeHelper, assertConfig }`.

- [ ] Tests: every en key exists in de; unknown lang → en; assertConfig throws when `scale.steps` set; schema field names ⊆ CardConfig keys.
- [ ] Implement, pass, commit `feat: i18n and visual editor schema`.

### Task 7: Data fetching + card element

**Files:** src/data.ts, src/render.ts, src/chrono-heatmap-card.ts, src/hass-types.ts, tests/card.test.ts (happy-dom)

- [ ] data.ts: `loadBuckets(hass, cfg, grid, now)` – `recorder/list_statistic_ids` decides auto; `recorder/statistics_during_period` (period `5minute`/`hour`, types mean,min,max,state,change, units none); history `history/history_during_period` (minimal_response, no_attributes) for gap after last stat or whole range.
- [ ] Element: setConfig→normalize; hass setter only triggers reload when entity state object changes (throttled 60 s) or config changes; `getGridOptions`, `getCardSize`, `getConfigForm`, `getStubConfig`; `window.customCards` entry; console banner with version.
- [ ] render.ts: SVG cells sized to container (ResizeObserver), row/col labels thinned, legend gradient, tooltip div; pointer rules spec 4.10 #4; fire `hass-more-info`.
- [ ] Tests: missing entity → warning text; setConfig invalid → throws localized error.
- [ ] Commit `feat: heatmap card element`.

### Task 8: Dev page with mock hass

**Files:** dev/*, vite.config.ts (dev root)

- [ ] Mock hass answering the 3 WS commands from seeded scenarios (temperature, power, energy meter, binary door, gaps); fixed `now` via `?now=` query param; theme/lang toggles; gallery + YAML playground; `ha-card` shim with HA-like CSS variables.
- [ ] Verify manually via Playwright screenshot locally. Commit `feat: dev page with mock data`.

### Task 9: Screenshots in CI + docs

**Files:** playwright.config.ts, e2e/screenshots.spec.ts, ci.yml, README.md

- [ ] Screenshot each gallery card, light+dark, en+de, fixed now; upload artifact; sticky PR comment with artifact URL.
- [ ] README: install (HACS custom repo / manual), config reference, dev workflow.
- [ ] Commit `ci: playwright screenshots`, `docs: readme`.
