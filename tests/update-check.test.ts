// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '../src/hass-types';
import {
  checkForUpdate,
  compareResources,
  resetUpdateCheck,
  trackUpdates,
  UPDATE_TOAST_ID,
} from '../src/update-check';

const BASE = 'http://ha.local:8123/lovelace/0';
const LOADED = 'http://ha.local:8123/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.0';

describe('compareResources', () => {
  it('is current while a resource points at the loaded URL', () => {
    const res = [{ url: '/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.0' }];
    expect(compareResources(LOADED, res, BASE)).toBe('current');
  });

  it('is outdated when the resource moved on to a new version', () => {
    const res = [{ url: '/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.1' }];
    expect(compareResources(LOADED, res, BASE)).toBe('outdated');
  });

  it('is outdated after a move from the legacy /hacsfiles path', () => {
    const loaded = 'http://ha.local:8123/hacsfiles/chrono-heatmap-card/chrono-heatmap-card.js?hacstag=1';
    const res = [{ url: '/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.1' }];
    expect(compareResources(loaded, res, BASE)).toBe('outdated');
  });

  it('is current when one of several resources matches (leftover entries)', () => {
    const res = [
      { url: '/hacsfiles/ha-heatmap-card/chrono-heatmap-card.js' },
      { url: '/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.0' },
      { url: '/local/other-card.js' },
    ];
    expect(compareResources(LOADED, res, BASE)).toBe('current');
  });

  it('is unknown without a resource for the card or for other module URLs', () => {
    expect(compareResources(LOADED, [{ url: '/local/other-card.js' }], BASE)).toBe('unknown');
    expect(compareResources(LOADED, [], BASE)).toBe('unknown');
    expect(compareResources('http://localhost:5173/src/chrono-heatmap-card.ts', [], BASE)).toBe('unknown');
  });

  it('ignores unparsable URLs', () => {
    expect(compareResources('::nope', [{ url: '/x' }], 'not a url')).toBe('unknown');
  });
});

describe('checkForUpdate', () => {
  afterEach(() => resetUpdateCheck());

  const hassWith = (url: string) => {
    const callWS = vi.fn(async () => [{ url }]);
    return { hass: { locale: { language: 'de' }, callWS } as unknown as HomeAssistant, callWS };
  };
  const toasts = () => {
    const seen: { id: string; message: string; action: { text: string } }[] = [];
    document.body.addEventListener('hass-notification', (e) => seen.push((e as CustomEvent).detail));
    return seen;
  };

  it('shows one reload toast when the resource changed', async () => {
    const seen = toasts();
    const { hass, callWS } = hassWith(
      '/local/community/chrono-heatmap-card/chrono-heatmap-card.js?v=123-0.4.1',
    );
    trackUpdates(hass, LOADED);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(callWS).toHaveBeenCalledWith({ type: 'lovelace/resources' });
    expect(seen[0]).toMatchObject({ id: UPDATE_TOAST_ID, action: { text: 'Neu laden' } });
    expect(seen[0].message).toContain('aktualisiert');
    await checkForUpdate(Date.now() + 60_000);
    expect(seen).toHaveLength(1); // only once per page
  });

  it('stays quiet while the resource is unchanged and checks again when the app comes back', async () => {
    const seen = toasts();
    const { hass, callWS } = hassWith(LOADED);
    trackUpdates(hass, LOADED);
    await vi.waitFor(() => expect(callWS).toHaveBeenCalledTimes(1));
    await checkForUpdate(Date.now() + 1_000); // too soon
    expect(callWS).toHaveBeenCalledTimes(1);
    await checkForUpdate(Date.now() + 60_000);
    expect(callWS).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(0);
  });

  it('does nothing for modules that are not the released bundle (dev server, tests)', async () => {
    const { hass, callWS } = hassWith('/x');
    trackUpdates(hass, 'http://localhost:5173/src/chrono-heatmap-card.ts');
    await checkForUpdate(Date.now() + 60_000);
    expect(callWS).not.toHaveBeenCalled();
  });

  it('survives a failing resources call', async () => {
    const callWS = vi.fn(async () => {
      throw new Error('unknown command');
    });
    trackUpdates({ locale: { language: 'en' }, callWS } as unknown as HomeAssistant, LOADED);
    await vi.waitFor(() => expect(callWS).toHaveBeenCalledTimes(1));
  });
});
