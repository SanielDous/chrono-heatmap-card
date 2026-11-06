// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ChronoHeatmapCard } from '../src/chrono-heatmap-card';
import { createMockHass } from '../dev/mock-hass';

const NOW = Date.parse('2026-10-26T13:37:00Z');

async function settle(el: ChronoHeatmapCard): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (el.shadowRoot?.querySelector('svg.grid, .warning')) return;
  }
}

function makeCard(config: Record<string, unknown>): ChronoHeatmapCard {
  const el = document.createElement('chrono-heatmap-card') as ChronoHeatmapCard;
  el.now = NOW;
  el.setConfig({ type: 'custom:chrono-heatmap-card', ...config } as never);
  document.body.append(el);
  el.hass = createMockHass({ now: NOW, language: 'en', dark: false });
  return el;
}

describe('chrono-heatmap-card', () => {
  it('is registered with the card picker', () => {
    const cards = (window as unknown as { customCards: { type: string }[] }).customCards;
    expect(cards.some((c) => c.type === 'chrono-heatmap-card')).toBe(true);
  });

  it('throws a readable error for invalid config', () => {
    const el = document.createElement('chrono-heatmap-card') as ChronoHeatmapCard;
    expect(() =>
      el.setConfig({ type: 'x', entity: 'sensor.a', row_unit: 'day', column_unit: 'minute' }),
    ).toThrow(/not possible/);
  });

  it('shows a warning for a missing entity', async () => {
    const el = makeCard({ entity: 'sensor.nope' });
    await settle(el);
    expect(el.shadowRoot?.querySelector('.warning')?.textContent).toContain('sensor.nope');
  });

  it('renders a 14 × 24 grid for a temperature sensor, with DST day', async () => {
    const el = makeCard({ entity: 'sensor.outdoor_temperature' });
    await settle(el);
    const rects = el.shadowRoot!.querySelectorAll('rect.cell');
    // 13 normal days × 24 + DST day 25 (2026-10-25)
    expect(rects.length).toBe(13 * 24 + 25);
    const colored = [...rects].filter(
      (r) => !r.classList.contains('empty') && !r.classList.contains('future'),
    );
    expect(colored.length).toBeGreaterThan(300);
  });

  it('renders on/off ratio for a binary sensor from history', async () => {
    const el = makeCard({ entity: 'binary_sensor.front_door', rows: 3 });
    await settle(el);
    // Oct 24 (24 h) + Oct 25 (DST, 25 h) + Oct 26 (24 h)
    expect(el.shadowRoot!.querySelectorAll('rect.cell').length).toBe(73);
    expect(el.shadowRoot!.querySelector('.legend')?.textContent).toContain('100 %');
  });

  it('reloads after the throttle window when the state changes inside it', async () => {
    const el = makeCard({ entity: 'sensor.outdoor_temperature', rows: 1 });
    await settle(el);
    const hass = createMockHass({ now: NOW, language: 'en', dark: false });
    let calls = 0;
    const callWS = hass.callWS.bind(hass);
    hass.callWS = (<T>(msg: Record<string, unknown>) => {
      calls++;
      return callWS<T>(msg);
    }) as typeof hass.callWS;
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    try {
      // new state object inside the 60 s window → no immediate load …
      el.hass = { ...hass, locale: el.hass!.locale, states: { ...hass.states } };
      expect(calls).toBe(0);
      // … but a trailing one when the window ends
      await vi.advanceTimersByTimeAsync(61_000);
      expect(calls).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces config changes and ignores unchanged configs', async () => {
    const el = makeCard({ entity: 'sensor.outdoor_temperature', rows: 1 });
    await settle(el);
    let calls = 0;
    const hass = el.hass!;
    const callWS = hass.callWS.bind(hass);
    hass.callWS = (<T>(msg: Record<string, unknown>) => {
      calls++;
      return callWS<T>(msg);
    }) as typeof hass.callWS;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const base = { type: 'custom:chrono-heatmap-card', entity: 'sensor.outdoor_temperature' };
      el.setConfig({ ...base, rows: 1 } as never); // unchanged → nothing
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls).toBe(0);
      for (const rows of [2, 3, 4]) {
        el.setConfig({ ...base, rows } as never); // "typing"
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(calls).toBe(0);
      await vi.advanceTimersByTimeAsync(400);
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(3); // one load, not three
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an owed reload when removed from the page inside the throttle window', async () => {
    const el = makeCard({ entity: 'sensor.outdoor_temperature', rows: 1 });
    await settle(el);
    const hass = createMockHass({ now: NOW, language: 'en', dark: false });
    let calls = 0;
    const callWS = hass.callWS.bind(hass);
    hass.callWS = (<T>(msg: Record<string, unknown>) => {
      calls++;
      return callWS<T>(msg);
    }) as typeof hass.callWS;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      el.hass = { ...hass, locale: el.hass!.locale, states: { ...hass.states } }; // change → trailing load owed
      el.remove();
      await vi.advanceTimersByTimeAsync(10_000);
      document.body.append(el); // back after 10 s, still inside the window
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
      el.remove();
    }
  });

  it('getStubConfig prefers a temperature sensor', () => {
    const hass = createMockHass({ now: NOW, language: 'en', dark: false });
    expect(
      ChronoHeatmapCard.getStubConfig(hass, ['sensor.house_power', 'sensor.outdoor_temperature']),
    ).toEqual({
      entity: 'sensor.outdoor_temperature',
      show_legend: true,
      show_labels: true,
    });
  });
});
