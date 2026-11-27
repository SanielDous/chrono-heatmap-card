import { parse, stringify } from 'yaml';
import '../src/chrono-heatmap-card';
import type { ChronoHeatmapCard } from '../src/chrono-heatmap-card';
import type { CardConfig } from '../src/config';
import { getConfigFormSchema } from '../src/editor';
import { TRANSLATIONS } from '../src/i18n';
import { GALLERY } from './gallery';
import { THEME_CSS } from './ha-shim';
import { createMockHass } from './mock-hass';
import { createPlaygroundForm, type PlaygroundForm } from './playground';

// URL parameters (used by Playwright): ?now=ISO&theme=dark&lang=de&only=<gallery id>&playground=0
const params = new URLSearchParams(location.search);
const state = {
  now: params.has('now') ? Date.parse(params.get('now')!) : Date.now(),
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
  lang: params.get('lang') && params.get('lang')! in TRANSLATIONS ? params.get('lang')! : 'en',
  only: params.get('only'),
  playground: params.get('playground') !== '0',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$('theme').textContent = THEME_CSS;

const DEFAULT_YAML = `type: custom:chrono-heatmap-card
entity: sensor.outdoor_temperature
`;
const STORAGE_KEY = 'chrono-heatmap-dev-yaml';
let form: PlaygroundForm | undefined;

const cards: { el: ChronoHeatmapCard; config: CardConfig }[] = [];

function hass() {
  return createMockHass({ now: state.now, language: state.lang, dark: state.theme === 'dark' });
}

function applyGlobals(): void {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.lang = state.lang;
  $<HTMLSelectElement>('theme-select').value = state.theme;
  $<HTMLSelectElement>('lang-select').value = state.lang;
  const local = new Date(state.now - new Date(state.now).getTimezoneOffset() * 60_000);
  $<HTMLInputElement>('now-input').value = local.toISOString().slice(0, 16);
  $('playground').style.display = state.playground ? '' : 'none';
}

function mount(container: HTMLElement, config: CardConfig): ChronoHeatmapCard {
  const el = document.createElement('chrono-heatmap-card');
  el.now = state.now;
  el.setConfig(config);
  el.hass = hass();
  container.append(el);
  cards.push({ el, config });
  return el;
}

function renderGallery(): void {
  const gallery = $('gallery');
  gallery.replaceChildren();
  for (const item of GALLERY) {
    if (state.only && item.id !== state.only) continue;
    const wrap = document.createElement('div');
    wrap.className = 'item';
    wrap.dataset.id = item.id;
    const label = document.createElement('div');
    label.className = 'id';
    label.textContent = item.id;
    wrap.append(label);
    gallery.append(wrap);
    const config = { type: 'custom:chrono-heatmap-card', ...item.config };
    const tryIt = document.createElement('button');
    tryIt.type = 'button';
    tryIt.className = 'try';
    tryIt.textContent = 'Edit in playground ↑';
    tryIt.addEventListener('click', () => {
      setYaml(config);
      $('playground').scrollIntoView({ behavior: 'smooth' });
    });
    label.append(tryIt);
    mount(wrap, config);
  }
}

function playgroundConfig(): Record<string, unknown> | undefined {
  try {
    const config = parse($<HTMLTextAreaElement>('yaml').value) as unknown;
    return config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Write a config to the YAML (type and entity first) and redraw the card; the form follows unless it was the source. */
function setYaml(config: Record<string, unknown>, fromForm = false): void {
  const { type, entity, ...rest } = config;
  const ordered = { type: type ?? 'custom:chrono-heatmap-card', entity, ...rest };
  $<HTMLTextAreaElement>('yaml').value = stringify(ordered);
  saveYaml();
  if (!fromForm) form?.setConfig(ordered);
  updateFormNote();
  renderPlayground();
}

function buildForm(): void {
  form = createPlaygroundForm($('form'), state.lang, playgroundConfig() ?? {}, (c) => setYaml(c, true));
  updateFormNote();
}

/** Custom color steps are YAML only, as in Home Assistant's editor. */
function updateFormNote(): void {
  const note = $('form-note');
  note.textContent = '';
  const config = playgroundConfig();
  if (!config) {
    note.textContent = 'Fix the YAML to use the form again.';
    return;
  }
  try {
    getConfigFormSchema(state.lang).assertConfig(config as unknown as CardConfig);
  } catch (e) {
    note.textContent = e instanceof Error ? e.message : String(e);
  }
}

function saveYaml(): void {
  try {
    localStorage.setItem(STORAGE_KEY, $<HTMLTextAreaElement>('yaml').value);
  } catch {
    /* ignore */
  }
}

function renderPlayground(): void {
  const container = $('playground-card');
  container.replaceChildren();
  const errorEl = $('yaml-error');
  errorEl.textContent = '';
  try {
    const config = parse($<HTMLTextAreaElement>('yaml').value) as CardConfig;
    mount(container, config);
  } catch (e) {
    errorEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

function rerenderAll(): void {
  cards.length = 0;
  applyGlobals();
  renderGallery();
  if (state.playground) renderPlayground();
}

// --- controls -------------------------------------------------------------------
const textarea = $<HTMLTextAreaElement>('yaml');
try {
  textarea.value = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_YAML;
} catch {
  textarea.value = DEFAULT_YAML;
}
let debounce: ReturnType<typeof setTimeout> | undefined;
textarea.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    saveYaml();
    const config = playgroundConfig();
    if (config) form?.setConfig(config);
    updateFormNote();
    renderPlayground();
  }, 300);
});
$<HTMLSelectElement>('theme-select').addEventListener('change', (e) => {
  state.theme = (e.target as HTMLSelectElement).value;
  applyGlobals();
});
$<HTMLSelectElement>('lang-select').addEventListener('change', (e) => {
  state.lang = (e.target as HTMLSelectElement).value;
  applyGlobals();
  buildForm();
  const h = hass();
  for (const c of cards) c.el.hass = h;
});
$<HTMLInputElement>('now-input').addEventListener('change', (e) => {
  const v = (e.target as HTMLInputElement).value;
  if (v) {
    state.now = new Date(v).getTime();
    rerenderAll();
  }
});
$<HTMLInputElement>('playground-toggle').addEventListener('change', (e) => {
  state.playground = (e.target as HTMLInputElement).checked;
  rerenderAll();
});
$<HTMLInputElement>('playground-toggle').checked = state.playground;

window.addEventListener('hass-more-info', (e) => {
  const id = (e as CustomEvent<{ entityId: string }>).detail.entityId;
  $('event-log').textContent = `hass-more-info → ${id}`;
});

$('reset-yaml').addEventListener('click', () => setYaml(parse(DEFAULT_YAML) as Record<string, unknown>));
$('copy-yaml').addEventListener('click', () => void navigator.clipboard?.writeText(textarea.value));
$<HTMLSelectElement>('lang-select').replaceChildren(
  ...Object.keys(TRANSLATIONS).map((l) => new Option(l, l)),
);

rerenderAll();
buildForm();
