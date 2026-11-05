import { css, html, LitElement, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { aggregateCells } from './buckets';
import {
  ConfigError,
  defaultAggregation,
  normalizeConfig,
  type Aggregation,
  type CardConfig,
  type NormalizedConfig,
} from './config';
import { hasStatistics, isNumericEntity, loadBuckets, type ValueMode } from './data';
import { getConfigFormSchema } from './editor';
import { columnLabels, columnLabelWidth, formatPeriod, formatRowLabel, formatValue } from './format';
import { buildGrid, resolveTimeZone, resolveWeekStart, type Cell, type Grid } from './grid';
import type { HassEntity, HomeAssistant } from './hass-types';
import { localize } from './i18n';
import { colorFor, legendGradient, resolveScale, type ResolvedScale } from './scale';

export const CARD_TAG = 'chrono-heatmap-card';
const VERSION = typeof __CARD_VERSION__ === 'string' ? __CARD_VERSION__ : 'dev';

const RELOAD_THROTTLE_MS = 60_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;

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
  x: number;
  y: number;
  touch: boolean;
}

export class ChronoHeatmapCard extends LitElement {
  static override properties = {
    _config: { state: true },
    _values: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _width: { state: true },
    _tooltip: { state: true },
  };

  private _hass?: HomeAssistant;
  declare private _config?: NormalizedConfig;
  declare private _values?: (number | null)[][];
  declare private _error?: string;
  declare private _loading: boolean;
  declare private _width: number;
  declare private _tooltip?: TooltipState;

  private _grid?: Grid;
  private _scale?: ResolvedScale;
  private _agg: Aggregation = 'mean';
  private _unit?: string;
  private _lastLoad = 0;
  private _lastEntity?: HassEntity;
  private _loadSeq = 0;
  private _statsCache = new Map<string, boolean>();
  private _resizeObserver?: ResizeObserver;
  private _timer?: ReturnType<typeof setInterval>;
  private _pointerType = 'mouse';
  /** Fixed "now" for tests and the dev page. */
  public now?: number;

  constructor() {
    super();
    this._loading = false;
    this._width = 0;
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
    try {
      this._config = normalizeConfig(config);
    } catch (e) {
      if (e instanceof ConfigError) throw new Error(localize(this._lang, e.key, e.params));
      throw e;
    }
    this._values = undefined;
    this._lastLoad = 0;
    this._scheduleLoad(true);
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    const localeChanged = !first && hass.locale !== this._hass?.locale;
    this._hass = hass;
    const entity = this._config ? hass.states[this._config.entity] : undefined;
    const changed = entity !== this._lastEntity;
    this._lastEntity = entity;
    if (first || localeChanged) this._scheduleLoad(true);
    else if (changed && Date.now() - this._lastLoad > RELOAD_THROTTLE_MS) this._scheduleLoad(false);
    else if (changed) this.requestUpdate();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  // ---- lifecycle ----------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    this._timer = setInterval(() => this._scheduleLoad(true), REFRESH_INTERVAL_MS);
    if (this._hass && this._config && !this._values) this._scheduleLoad(true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer) clearInterval(this._timer);
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this._observeSize();
  }

  protected override updated(_changed: PropertyValues): void {
    this._observeSize();
  }

  private _observeSize(): void {
    if (this._resizeObserver || typeof ResizeObserver === 'undefined') return;
    const el = this.renderRoot.querySelector('.body');
    if (!el) return;
    this._resizeObserver = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0 && w !== this._width) this._width = w;
    });
    this._resizeObserver.observe(el);
  }

  private get _lang(): string {
    return this._hass?.locale?.language ?? this._hass?.language ?? document.documentElement.lang ?? 'en';
  }

  // ---- data -----------------------------------------------------------------

  private _scheduleLoad(force: boolean): void {
    if (!this._hass || !this._config) return;
    if (!force && Date.now() - this._lastLoad < RELOAD_THROTTLE_MS) return;
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
      return;
    }

    const now = this.now ?? Date.now();
    const tz = resolveTimeZone(hass.locale?.time_zone, hass.config?.time_zone);
    const weekStart = resolveWeekStart(hass.locale?.first_weekday, this._lang);
    const grid = buildGrid(config.row_unit, config.column_unit, config.rows, now, tz, weekStart);
    const unit = entity.attributes.unit_of_measurement;
    const numeric = isNumericEntity(config.entity, entity.state, unit);
    const agg = config.aggregation ?? defaultAggregation(entity.attributes.state_class, numeric);
    const mode: ValueMode = agg === 'on_ratio' || !numeric ? 'binary' : 'numeric';

    this._loading = !this._values;
    try {
      let statsAvailable = this._statsCache.get(config.entity);
      if (statsAvailable === undefined && mode === 'numeric') {
        statsAvailable = await hasStatistics(hass, config.entity).catch(() => false);
        this._statsCache.set(config.entity, statsAvailable);
      }
      const { buckets } = await loadBuckets(hass, {
        config,
        grid,
        now,
        mode,
        statisticsAvailable: statsAvailable ?? false,
      });
      if (seq !== this._loadSeq) return;
      const values = aggregateCells(grid, buckets, mode === 'binary' && agg !== 'on_ratio' ? 'on_ratio' : agg);
      const flat = values.flat().filter((v): v is number => v !== null);
      this._grid = grid;
      this._agg = mode === 'binary' && agg !== 'on_ratio' ? 'on_ratio' : agg;
      this._unit = this._agg === 'on_ratio' ? undefined : unit;
      this._scale = resolveScale(config.scale, {
        unit,
        deviceClass: entity.attributes.device_class,
        values: flat,
        isRatio: this._agg === 'on_ratio',
      });
      this._error = undefined;
      this._values = values;
    } catch (e) {
      if (seq !== this._loadSeq) return;
      const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? String(e));
      this._error = localize(this._lang, 'ui.load_failed', { message });
    } finally {
      if (seq === this._loadSeq) this._loading = false;
    }
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

  private _cellFromEvent(ev: Event): { row: number; col: number; el: Element } | undefined {
    const el = (ev.target as Element | null)?.closest?.('[data-r]');
    if (!el) return undefined;
    return { row: Number(el.getAttribute('data-r')), col: Number(el.getAttribute('data-c')), el };
  }

  private _showTooltip(row: number, col: number, el: Element, touch: boolean): void {
    const body = this.renderRoot.querySelector('.body');
    if (!body) return;
    const b = body.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this._tooltip = { row, col, x: r.left - b.left + r.width / 2, y: r.top - b.top, touch };
  }

  private _onPointerDown = (ev: PointerEvent): void => {
    this._pointerType = ev.pointerType || 'mouse';
  };

  private _onPointerMove = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    const hit = this._cellFromEvent(ev);
    if (!hit) {
      if (this._tooltip && !this._tooltip.touch) this._tooltip = undefined;
      return;
    }
    if (this._tooltip?.row !== hit.row || this._tooltip?.col !== hit.col) {
      this._showTooltip(hit.row, hit.col, hit.el, false);
    }
  };

  private _onPointerLeave = (ev: PointerEvent): void => {
    if (ev.pointerType !== 'touch' && this._tooltip && !this._tooltip.touch) this._tooltip = undefined;
  };

  private _onClick = (ev: MouseEvent): void => {
    const hit = this._cellFromEvent(ev);
    if (!hit) {
      this._tooltip = undefined;
      return;
    }
    if (this._pointerType === 'touch') {
      if (this._tooltip?.touch && this._tooltip.row === hit.row && this._tooltip.col === hit.col) {
        this._tooltip = undefined;
        this._openMoreInfo();
      } else {
        this._showTooltip(hit.row, hit.col, hit.el, true);
      }
      return;
    }
    this._openMoreInfo();
  };

  // ---- rendering --------------------------------------------------------------

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

  private _renderGrid(grid: Grid, values: (number | null)[][], scale: ResolvedScale, cfg: NormalizedConfig) {
    const L = this._layout(grid, cfg);
    const now = this.now ?? Date.now();
    const pitchX = L.cellW + L.gap;
    const pitchY = L.cellH + L.gap;
    const cells: TemplateResult[] = [];
    grid.rows.forEach((row, ri) => {
      row.cells.forEach((cell, ci) => {
        if (!cell) return;
        const v = values[ri]?.[ci] ?? null;
        const across = L.vertical ? ri : ci;
        const down = L.vertical ? ci : ri;
        const x = L.labelLeft + across * pitchX;
        const y = L.labelTop + down * pitchY;
        const cls = v === null ? (cell.start > now ? 'cell future' : 'cell empty') : 'cell';
        const style = v === null ? '' : `fill:${colorFor(scale, v)}`;
        cells.push(
          svg`<rect class=${cls} data-r=${ri} data-c=${ci} x=${x} y=${y} width=${L.cellW} height=${L.cellH} rx=${Math.min(2, L.cellW / 4)} style=${style}></rect>`,
        );
      });
    });

    const labels: TemplateResult[] = [];
    if (cfg.show_labels) {
      const lang = this._lang;
      // time-period labels (one per grid row)
      const rowStep = Math.max(1, Math.ceil((L.vertical ? 34 : 12) / (L.vertical ? pitchX : pitchY)));
      grid.rows.forEach((row, ri) => {
        if ((grid.rows.length - 1 - ri) % rowStep !== 0) return;
        const text = formatRowLabel(row, cfg.row_unit, lang, grid.timeZone);
        if (L.vertical) {
          labels.push(
            svg`<text class="label" x=${L.labelLeft + ri * pitchX + L.cellW / 2} y=${L.labelTop - 4} text-anchor="middle">${text}</text>`,
          );
        } else {
          labels.push(
            svg`<text class="label" x=${L.labelLeft - 6} y=${L.labelTop + ri * pitchY + L.cellH / 2} text-anchor="end" dominant-baseline="central">${text}</text>`,
          );
        }
      });
      // sub-period labels (one per grid column)
      const spacing = L.vertical ? 12 / pitchY : columnLabelWidth(cfg.column_unit, cfg.row_unit) / pitchX;
      columnLabels(grid, lang, spacing).forEach((text, ci) => {
        if (!text) return;
        if (L.vertical) {
          labels.push(
            svg`<text class="label" x=${L.labelLeft - 6} y=${L.labelTop + ci * pitchY + L.cellH / 2} text-anchor="end" dominant-baseline="central">${text}</text>`,
          );
        } else {
          labels.push(
            svg`<text class="label" x=${L.labelLeft + ci * pitchX} y=${L.labelTop - 5} text-anchor="start">${text}</text>`,
          );
        }
      });
    }

    return html`<svg
      class="grid"
      width=${L.width}
      height=${L.height}
      viewBox="0 0 ${L.width} ${L.height}"
      role="img"
      @pointerdown=${this._onPointerDown}
      @pointermove=${this._onPointerMove}
      @pointerleave=${this._onPointerLeave}
      @click=${this._onClick}
    >
      ${labels}${cells}
    </svg>`;
  }

  private _renderTooltip() {
    const t = this._tooltip;
    const grid = this._grid;
    if (!t || !grid || !this._values || !this._config) return nothing;
    const cell: Cell | null | undefined = grid.rows[t.row]?.cells[t.col];
    if (!cell) return nothing;
    const lang = this._lang;
    const v = this._values[t.row]?.[t.col] ?? null;
    const value = v === null ? localize(lang, 'ui.no_data') : formatValue(v, this._agg, this._unit, lang);
    const left = Math.min(Math.max(t.x, 70), Math.max(70, this._width - 70));
    return html`<div class="tooltip" style="left:${left}px;top:${t.y}px">
      <div class="tt-period">${formatPeriod(cell, grid.columnUnit, lang, grid.timeZone)}</div>
      <div class="tt-value">${value}</div>
    </div>`;
  }

  private _renderLegend(scale: ResolvedScale) {
    const lang = this._lang;
    const fmt = (v: number) =>
      this._agg === 'on_ratio'
        ? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(v * 100)} %`
        : formatValue(v, this._agg, this._unit, lang);
    return html`<div class="legend">
      <span class="legend-label">${fmt(scale.min)}</span>
      <span class="legend-bar" style="background:${legendGradient(scale)}"></span>
      <span class="legend-label">${fmt(scale.max)}</span>
    </div>`;
  }

  protected override render() {
    const cfg = this._config;
    if (!cfg) return nothing;
    const entity = this._hass?.states[cfg.entity];
    const title =
      cfg.title ??
      (entity ? (this._hass?.formatEntityName?.(entity) ?? entity.attributes.friendly_name) : undefined) ??
      cfg.entity;

    let body: unknown;
    if (this._error) body = html`<div class="warning">${this._error}</div>`;
    else if (!this._values || !this._grid || !this._scale)
      body = html`<div class="loading">${localize(this._lang, 'ui.loading')}</div>`;
    else body = this._renderGrid(this._grid, this._values, this._scale, cfg);

    return html`<ha-card>
      <div class="header" @click=${this._openMoreInfo} title=${cfg.entity}>${title}</div>
      <div class="body">${body}${this._renderTooltip()}</div>
      ${cfg.show_legend && this._scale && this._values && !this._error ? this._renderLegend(this._scale) : nothing}
    </ha-card>`;
  }

  static override styles = css`
    :host {
      display: block;
      --chm-empty: color-mix(in srgb, var(--primary-text-color, #212121) 9%, transparent);
      --chm-future: color-mix(in srgb, var(--primary-text-color, #212121) 3%, transparent);
    }
    ha-card {
      padding: 12px 16px 16px;
      overflow: hidden;
      height: 100%;
      box-sizing: border-box;
    }
    .header {
      font-size: var(--ha-card-header-font-size, 1.25rem);
      font-weight: 500;
      color: var(--ha-card-header-color, var(--primary-text-color));
      line-height: 1.6;
      margin-bottom: 8px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .body {
      position: relative;
      width: 100%;
      min-height: 40px;
    }
    svg.grid {
      display: block;
      overflow: visible;
      touch-action: manipulation;
    }
    .cell {
      cursor: pointer;
    }
    .cell.empty {
      fill: var(--chm-empty);
    }
    .cell.future {
      fill: var(--chm-future);
    }
    .cell:hover {
      stroke: var(--primary-text-color, #212121);
      stroke-width: 1;
    }
    .label {
      font-size: 10px;
      fill: var(--secondary-text-color, #727272);
      font-family: inherit;
      user-select: none;
    }
    .tooltip {
      position: absolute;
      transform: translate(-50%, calc(-100% - 6px));
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      line-height: 1.4;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      white-space: nowrap;
      z-index: 2;
    }
    .tt-value {
      font-weight: 600;
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      font-size: 11px;
      color: var(--secondary-text-color, #727272);
    }
    .legend-bar {
      flex: 1;
      height: 8px;
      border-radius: 4px;
    }
    .warning {
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent);
      color: var(--primary-text-color);
    }
    .loading {
      color: var(--secondary-text-color);
      font-size: 14px;
    }
  `;
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
    documentationURL: 'https://github.com/SanielDous/ha-heatmap-card',
  });
  console.info(`%c CHRONO-HEATMAP-CARD %c ${VERSION} `, 'background:#21918c;color:#fff;font-weight:700', 'background:#444;color:#fff');
}

declare global {
  interface HTMLElementTagNameMap {
    'chrono-heatmap-card': ChronoHeatmapCard;
  }
}
