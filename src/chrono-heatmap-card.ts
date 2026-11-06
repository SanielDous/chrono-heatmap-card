import { aggregateCells } from './buckets';
import {
  ConfigError,
  defaultAggregation,
  normalizeConfig,
  type Aggregation,
  type CardConfig,
  type NormalizedConfig,
} from './config';
import { hasStatistics, isNumericEntity, loadBuckets, type LoadResult, type ValueMode } from './data';
import { getConfigFormSchema } from './editor';
import { columnLabels, columnLabelWidth, formatPeriod, formatRowLabel, formatValue } from './format';
import { buildGrid, resolveTimeZone, resolveWeekStart, type Grid } from './grid';
import type { HassEntity, HomeAssistant } from './hass-types';
import { localize } from './i18n';
import { colorFor, legendGradient, resolveScale, type ResolvedScale } from './scale';
import { STYLES } from './styles';

export const CARD_TAG = 'chrono-heatmap-card';
const VERSION = typeof __CARD_VERSION__ === 'string' ? __CARD_VERSION__ : 'dev';

const RELOAD_THROTTLE_MS = 60_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;
/** Config changes (e.g. typing in the card editor) are loaded after this quiet time. */
const CONFIG_DEBOUNCE_MS = 300;

/** Escape text for use in HTML/SVG content and attribute values. */
const esc = (s: string | number): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

interface Layout {
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  gap: number;
  labelLeft: number;
  labelTop: number;
  vertical: boolean;
}

interface TooltipState {
  row: number;
  col: number;
  touch: boolean;
}

/**
 * Plain custom element (no framework): the grid is rendered as one SVG string whenever data or size
 * changes; the tooltip is a separate element so hovering never re-renders the grid.
 */
export class ChronoHeatmapCard extends HTMLElement {
  private _hass?: HomeAssistant;
  private _config?: NormalizedConfig;
  private _values?: (number | null)[][];
  private _error?: string;
  private _grid?: Grid;
  private _scale?: ResolvedScale;
  private _agg: Aggregation = 'mean';
  private _unit?: string;
  private _width = 0;
  private _tooltip?: TooltipState;
  private _lastLoad = 0;
  private _lastEntity?: HassEntity;
  private _loadSeq = 0;
  private _statsCache = new Map<string, boolean>();
  private _resizeObserver?: ResizeObserver;
  private _timer?: ReturnType<typeof setInterval>;
  private _pending?: ReturnType<typeof setTimeout>;
  private _configTimer?: ReturnType<typeof setTimeout>;
  /** A throttled reload was cancelled by a disconnect and is still owed. */
  private _dirty = false;
  /** Previous load, reused for incremental statistics loads. */
  private _lastResult?: LoadResult;
  private _pointerType = 'mouse';
  private _renderQueued = false;

  private readonly _root: ShadowRoot;
  private readonly _header: HTMLElement;
  private readonly _body: HTMLElement;
  private readonly _content: HTMLElement;
  private readonly _tooltipEl: HTMLElement;
  private readonly _legend: HTMLElement;

  /** Fixed "now" for tests and the dev page. */
  public now?: number;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = `<style>${STYLES}</style>
      <ha-card>
        <div class="header" part="header"></div>
        <div class="body"><div class="content"></div><div class="tooltip" hidden></div></div>
        <div class="legend" hidden></div>
      </ha-card>`;
    this._header = this._root.querySelector('.header')!;
    this._body = this._root.querySelector('.body')!;
    this._content = this._root.querySelector('.content')!;
    this._tooltipEl = this._root.querySelector('.tooltip')!;
    this._legend = this._root.querySelector('.legend')!;

    this._header.addEventListener('click', () => this._openMoreInfo());
    this._content.addEventListener('pointerdown', (ev) => (this._pointerType = ev.pointerType || 'mouse'));
    this._content.addEventListener('pointermove', (ev) => this._onPointerMove(ev));
    this._content.addEventListener('pointerleave', (ev) => this._onPointerLeave(ev));
    this._content.addEventListener('click', (ev) => this._onClick(ev));
  }

  // ---- HA card API -------------------------------------------------------

  static getConfigForm() {
    return getConfigFormSchema();
  }

  static getStubConfig(hass: HomeAssistant, entities: string[] = [], entitiesFallback: string[] = []) {
    const all = [...entities, ...entitiesFallback];
    const pick =
      all.find((e) => e.startsWith('sensor.') && hass.states[e]?.attributes.device_class === 'temperature') ??
      all.find((e) => e.startsWith('sensor.') && hass.states[e]?.attributes.state_class !== undefined) ??
      all.find((e) => e.startsWith('sensor.')) ??
      all[0] ??
      Object.keys(hass.states).find((e) => e.startsWith('sensor.')) ??
      'sun.sun';
    return { entity: pick };
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: 'auto' as const };
  }

  getCardSize(): number {
    const rows = this._config?.rows ?? 7;
    return Math.max(2, Math.ceil((rows * 16 + 80) / 50));
  }

  setConfig(config: CardConfig): void {
    let normalized: NormalizedConfig;
    try {
      normalized = normalizeConfig(config);
    } catch (e) {
      if (e instanceof ConfigError) throw new Error(localize(this._lang, e.key, e.params));
      throw e;
    }
    if (this._config && JSON.stringify(normalized) === JSON.stringify(this._config)) return;
    const reconfigure = this._config !== undefined;
    this._config = normalized;
    this._values = undefined;
    this._error = undefined;
    this._tooltip = undefined;
    this._lastResult = undefined;
    if (this._configTimer) clearTimeout(this._configTimer);
    this._configTimer = undefined;
    if (reconfigure && this._hass) {
      // editor: wait until typing pauses instead of querying the recorder on every keystroke
      this._configTimer = setTimeout(() => {
        this._configTimer = undefined;
        this._scheduleLoad(true);
      }, CONFIG_DEBOUNCE_MS);
    } else {
      this._scheduleLoad(true);
    }
    this._queueRender();
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    const localeChanged = !first && hass.locale !== this._hass?.locale;
    this._hass = hass;
    const entity = this._config ? hass.states[this._config.entity] : undefined;
    const changed = entity !== this._lastEntity;
    this._lastEntity = entity;
    if (first || localeChanged) {
      this._lastResult = undefined;
      this._scheduleLoad(true);
      this._queueRender();
    } else if (changed) {
      // throttled: a change inside the window is loaded when the window ends, never dropped
      this._scheduleLoad(false);
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  // ---- lifecycle ----------------------------------------------------------

  connectedCallback(): void {
    this._timer = setInterval(() => this._scheduleLoad(true), REFRESH_INTERVAL_MS);
    if (typeof ResizeObserver !== 'undefined' && !this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        const w = Math.floor(entries[0].contentRect.width);
        if (w > 0 && w !== this._width) {
          this._width = w;
          this._queueRender();
        }
      });
      this._resizeObserver.observe(this._body);
    }
    // back on screen after a while (e.g. view switch): data may be stale
    if (
      this._hass &&
      this._config &&
      (!this._values || this._dirty || Date.now() - this._lastLoad > RELOAD_THROTTLE_MS)
    ) {
      this._scheduleLoad(true);
    }
    this._queueRender();
  }

  disconnectedCallback(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = undefined;
    if (this._pending) {
      clearTimeout(this._pending);
      this._dirty = true;
    }
    this._pending = undefined;
    if (this._configTimer) {
      clearTimeout(this._configTimer);
      this._dirty = true;
    }
    this._configTimer = undefined;
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  private get _lang(): string {
    return (
      this._hass?.locale?.language ??
      this._hass?.language ??
      (typeof document !== 'undefined' ? document.documentElement.lang : '') ??
      'en'
    );
  }

  // ---- data -----------------------------------------------------------------

  private _scheduleLoad(force: boolean): void {
    if (!this._hass || !this._config) return;
    const elapsed = Date.now() - this._lastLoad;
    if (!force && elapsed < RELOAD_THROTTLE_MS) {
      // trailing load at the end of the throttle window
      this._pending ??= setTimeout(() => {
        this._pending = undefined;
        this._scheduleLoad(true);
      }, RELOAD_THROTTLE_MS - elapsed);
      return;
    }
    if (this._pending) clearTimeout(this._pending);
    this._pending = undefined;
    this._dirty = false;
    this._lastLoad = Date.now();
    void this._load();
  }

  private async _load(): Promise<void> {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config) return;
    const seq = ++this._loadSeq;
    const entity = hass.states[config.entity];
    if (!entity) {
      this._error = localize(this._lang, 'ui.entity_not_found', { entity: config.entity });
      this._values = undefined;
      this._queueRender();
      return;
    }

    const now = this.now ?? Date.now();
    const tz = resolveTimeZone(hass.locale?.time_zone, hass.config?.time_zone);
    const weekStart = resolveWeekStart(hass.locale?.first_weekday, this._lang);
    const grid = buildGrid(config.row_unit, config.column_unit, config.rows, now, tz, weekStart);
    const unit = entity.attributes.unit_of_measurement;
    const numeric = isNumericEntity(config.entity, entity.state, unit, entity.attributes.state_class);
    const requested = config.aggregation ?? defaultAggregation(entity.attributes.state_class, numeric);
    const mode: ValueMode = requested === 'on_ratio' || !numeric ? 'binary' : 'numeric';
    // on/off data has a single meaningful aggregation
    const agg: Aggregation = mode === 'binary' ? 'on_ratio' : requested;

    try {
      let statsAvailable = this._statsCache.get(config.entity);
      if (statsAvailable === undefined && mode === 'numeric') {
        try {
          statsAvailable = await hasStatistics(hass, config.entity);
          this._statsCache.set(config.entity, statsAvailable);
        } catch {
          statsAvailable = false; // not cached: retried on the next load
        }
      }
      const result = await loadBuckets(hass, {
        config,
        grid,
        now,
        mode,
        statisticsAvailable: statsAvailable ?? false,
        stateClass: entity.attributes.state_class,
        previous: this._lastResult,
      });
      if (seq !== this._loadSeq) return;
      this._lastResult = result;
      const { buckets } = result;
      const values = aggregateCells(grid, buckets, agg);
      this._grid = grid;
      this._agg = agg;
      this._unit = agg === 'on_ratio' ? undefined : unit;
      this._scale = resolveScale(config.scale, {
        unit,
        deviceClass: entity.attributes.device_class,
        values: values.flat().filter((v): v is number => v !== null),
        isRatio: agg === 'on_ratio',
        aggregation: agg,
      });
      this._error = undefined;
      this._values = values;
    } catch (e) {
      if (seq !== this._loadSeq) return;
      const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e));
      this._error = localize(this._lang, 'ui.load_failed', { message });
    }
    this._queueRender();
  }

  // ---- interaction -------------------------------------------------------------

  private _openMoreInfo(): void {
    if (!this._config) return;
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId: this._config.entity },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cellFromEvent(ev: Event): { row: number; col: number } | undefined {
    const el = (ev.target as Element | null)?.closest?.('[data-r]');
    if (!el) return undefined;
    return { row: Number(el.getAttribute('data-r')), col: Number(el.getAttribute('data-c')) };
  }

  private _onPointerMove(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') return;
    const hit = this._cellFromEvent(ev);
    if (!hit) {
      if (this._tooltip && !this._tooltip.touch) this._setTooltip(undefined);
      return;
    }
    if (this._tooltip?.row !== hit.row || this._tooltip?.col !== hit.col) {
      this._setTooltip({ ...hit, touch: false });
    }
  }

  private _onPointerLeave(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' && this._tooltip && !this._tooltip.touch) this._setTooltip(undefined);
  }

  private _onClick(ev: MouseEvent): void {
    const hit = this._cellFromEvent(ev);
    if (!hit) {
      this._setTooltip(undefined);
      return;
    }
    if (this._pointerType === 'touch') {
      if (this._tooltip?.touch && this._tooltip.row === hit.row && this._tooltip.col === hit.col) {
        this._setTooltip(undefined);
        this._openMoreInfo();
      } else {
        this._setTooltip({ ...hit, touch: true });
      }
      return;
    }
    this._openMoreInfo();
  }

  private _setTooltip(t: TooltipState | undefined): void {
    this._tooltip = t;
    this._renderTooltip();
  }

  // ---- rendering --------------------------------------------------------------

  private _queueRender(): void {
    if (this._renderQueued) return;
    this._renderQueued = true;
    queueMicrotask(() => {
      this._renderQueued = false;
      this._render();
    });
  }

  private _render(): void {
    const cfg = this._config;
    if (!cfg) return;
    const entity = this._hass?.states[cfg.entity];
    this._header.textContent =
      cfg.title ||
      (entity ? this._hass?.formatEntityName?.(entity) || entity.attributes.friendly_name : undefined) ||
      cfg.entity;
    this._header.title = cfg.entity;

    if (this._error) {
      this._content.innerHTML = `<div class="warning">${esc(this._error)}</div>`;
    } else if (!this._values || !this._grid || !this._scale) {
      this._content.innerHTML = `<div class="loading">${esc(localize(this._lang, 'ui.loading'))}</div>`;
    } else {
      this._content.innerHTML = this._gridSvg(this._grid, this._values, this._scale, cfg);
    }

    const showLegend = cfg.show_legend && !this._error && this._values && this._scale;
    this._legend.hidden = !showLegend;
    this._legend.innerHTML = showLegend ? this._legendHtml(this._scale!) : '';
    this._renderTooltip();
  }

  private _layout(grid: Grid, cfg: NormalizedConfig): Layout {
    const width = Math.max(this._width || 300, 120);
    const vertical = cfg.orientation === 'vertical';
    const labels = cfg.show_labels;
    const nAcross = vertical ? grid.rows.length : grid.columns;
    const nDown = vertical ? grid.columns : grid.rows.length;
    const labelLeft = labels ? (vertical ? 34 : rowLabelWidth(cfg.row_unit)) : 0;
    const labelTop = labels ? 16 : 0;
    const raw = (width - labelLeft) / nAcross;
    const gap = raw >= 8 ? 2 : raw >= 4 ? 1 : 0;
    const cellW = raw - gap;
    const cellH = Math.min(Math.max(cellW, vertical ? 6 : 10), 28);
    const height = labelTop + nDown * (cellH + gap);
    return { width, height, cellW, cellH, gap, labelLeft, labelTop, vertical };
  }

  private _gridSvg(
    grid: Grid,
    values: (number | null)[][],
    scale: ResolvedScale,
    cfg: NormalizedConfig,
  ): string {
    const L = this._layout(grid, cfg);
    const now = this.now ?? Date.now();
    const pitchX = L.cellW + L.gap;
    const pitchY = L.cellH + L.gap;
    const r = (n: number) => Math.round(n * 100) / 100;
    const rx = r(Math.min(2, L.cellW / 4));
    const parts: string[] = [];

    if (cfg.show_labels) {
      const lang = this._lang;
      const rowLabels = grid.rows.map((row) =>
        formatRowLabel(row, cfg.row_unit, lang, grid.timeZone, L.vertical),
      );
      // side by side (vertical) labels need roughly 6 px per character; stacked labels need one line
      const needed = L.vertical ? Math.max(...rowLabels.map((t) => t.length)) * 6 + 6 : 12;
      const rowStep = Math.max(1, Math.ceil(needed / (L.vertical ? pitchX : pitchY)));
      grid.rows.forEach((_row, ri) => {
        if ((grid.rows.length - 1 - ri) % rowStep !== 0) return;
        const text = esc(rowLabels[ri]);
        parts.push(
          L.vertical
            ? `<text class="label" x="${r(L.labelLeft + ri * pitchX + L.cellW / 2)}" y="${L.labelTop - 4}" text-anchor="middle">${text}</text>`
            : `<text class="label" x="${L.labelLeft - 6}" y="${r(L.labelTop + ri * pitchY + L.cellH / 2)}" text-anchor="end" dominant-baseline="central">${text}</text>`,
        );
      });
      const spacing = L.vertical ? 12 / pitchY : columnLabelWidth(cfg.column_unit, cfg.row_unit) / pitchX;
      columnLabels(grid, lang, spacing).forEach((label, ci) => {
        if (!label) return;
        // keep top labels inside the card
        if (!L.vertical && L.labelLeft + ci * pitchX + label.length * 6 > L.width) return;
        const text = esc(label);
        parts.push(
          L.vertical
            ? `<text class="label" x="${L.labelLeft - 6}" y="${r(L.labelTop + ci * pitchY + L.cellH / 2)}" text-anchor="end" dominant-baseline="central">${text}</text>`
            : `<text class="label" x="${r(L.labelLeft + ci * pitchX)}" y="${L.labelTop - 5}" text-anchor="start">${text}</text>`,
        );
      });
    }

    grid.rows.forEach((row, ri) => {
      row.cells.forEach((cell, ci) => {
        if (!cell) return;
        const v = values[ri]?.[ci] ?? null;
        const x = L.labelLeft + (L.vertical ? ri : ci) * pitchX;
        const y = L.labelTop + (L.vertical ? ci : ri) * pitchY;
        const cls = v === null ? (cell.start > now ? 'cell future' : 'cell empty') : 'cell';
        const style = v === null ? '' : ` style="fill:${esc(colorFor(scale, v))}"`;
        parts.push(
          `<rect class="${cls}" data-r="${ri}" data-c="${ci}" x="${r(x)}" y="${r(y)}" width="${r(L.cellW)}" height="${r(L.cellH)}" rx="${rx}"${style}></rect>`,
        );
      });
    });

    return `<svg class="grid" xmlns="http://www.w3.org/2000/svg" width="${r(L.width)}" height="${r(L.height)}" viewBox="0 0 ${r(L.width)} ${r(L.height)}" role="img">${parts.join('')}</svg>`;
  }

  private _renderTooltip(): void {
    const t = this._tooltip;
    const grid = this._grid;
    const cell = t && grid ? grid.rows[t.row]?.cells[t.col] : undefined;
    const rect = t ? this._content.querySelector(`rect[data-r="${t.row}"][data-c="${t.col}"]`) : null;
    if (!t || !grid || !cell || !rect || !this._values) {
      this._tooltipEl.hidden = true;
      return;
    }
    const lang = this._lang;
    const v = this._values[t.row]?.[t.col] ?? null;
    const value = v === null ? localize(lang, 'ui.no_data') : formatValue(v, this._agg, this._unit, lang);
    this._tooltipEl.innerHTML = `<div class="tt-period">${esc(formatPeriod(cell, grid.columnUnit, lang, grid.timeZone, grid.weekStartsOn))}</div><div class="tt-value">${esc(value)}</div>`;
    const b = this._body.getBoundingClientRect();
    const c = rect.getBoundingClientRect();
    const half = 80;
    const x = Math.min(Math.max(c.left - b.left + c.width / 2, half), Math.max(half, b.width - half));
    this._tooltipEl.style.left = `${x}px`;
    this._tooltipEl.style.top = `${c.top - b.top}px`;
    this._tooltipEl.hidden = false;
  }

  private _legendHtml(scale: ResolvedScale): string {
    const lang = this._lang;
    const fmt = (v: number) =>
      this._agg === 'on_ratio'
        ? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(v * 100)} %`
        : formatValue(v, this._agg, this._unit, lang);
    return `<span class="legend-label">${esc(fmt(scale.min))}</span><span class="legend-bar" style="background:${esc(legendGradient(scale))}"></span><span class="legend-label">${esc(fmt(scale.max))}</span>`;
  }
}

function rowLabelWidth(unit: NormalizedConfig['row_unit']): number {
  switch (unit) {
    case 'hour':
      return 62;
    case 'day':
      return 58;
    case 'week':
      return 40;
    case 'month':
      return 48;
    case 'year':
      return 36;
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, ChronoHeatmapCard);
  const w = window as unknown as { customCards?: unknown[] };
  w.customCards = w.customCards || [];
  const lang = document.documentElement.lang || navigator.language;
  w.customCards.push({
    type: CARD_TAG,
    name: localize(lang, 'card.name'),
    description: localize(lang, 'card.description'),
    preview: true,
    documentationURL: 'https://github.com/SanielDous/chrono-heatmap-card',
  });
  console.info(
    `%c CHRONO-HEATMAP-CARD %c ${VERSION} `,
    'background:#21918c;color:#fff;font-weight:700',
    'background:#444;color:#fff',
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'chrono-heatmap-card': ChronoHeatmapCard;
  }
}
