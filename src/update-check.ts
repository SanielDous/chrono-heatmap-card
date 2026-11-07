import type { HomeAssistant } from './hass-types';
import { localize } from './i18n';

/*
 * After an update through the Marketplace/HACS, HA points the dashboard resource at a new URL
 * (`…/chrono-heatmap-card.js?v=<id>-<version>`), but a page or companion app that is already open
 * keeps running the module it loaded before. Custom elements can't be redefined, so only a reload
 * helps. We compare the URL this module was loaded from with the resources HA serves now and offer
 * the reload in HA's own toast.
 */

const FILE = 'chrono-heatmap-card.js';
/** Minimum time between two resource checks (they run on page load, when the app comes back and hourly). */
const MIN_INTERVAL_MS = 10_000;
const HOURLY_MS = 60 * 60_000;
export const UPDATE_TOAST_ID = 'chrono-heatmap-card-update';

export type UpdateState = 'current' | 'outdated' | 'unknown';

function fileName(url: URL): string | undefined {
  return url.pathname.split('/').pop();
}

/**
 * `current`: a resource still points at the URL this module came from; `outdated`: resources for the
 * card exist, but all of them point somewhere else; `unknown`: the card was not loaded as a resource
 * (dev server, extra_module_url, renamed file).
 */
export function compareResources(
  loadedFrom: string,
  resources: { url: string }[],
  base: string,
): UpdateState {
  let loaded: URL;
  try {
    loaded = new URL(loadedFrom, base);
  } catch {
    return 'unknown';
  }
  if (fileName(loaded) !== FILE) return 'unknown';
  const ours = resources.flatMap((r) => {
    try {
      const url = new URL(r.url, base);
      return fileName(url) === FILE ? [url] : [];
    } catch {
      return [];
    }
  });
  if (ours.length === 0) return 'unknown';
  return ours.some((url) => url.href === loaded.href) ? 'current' : 'outdated';
}

let hass: HomeAssistant | undefined;
let loadedFrom: string | undefined;
let started = false;
let lastCheck = -Infinity;
let inFlight = false;
let notified = false;

function language(): string {
  return hass?.locale?.language ?? hass?.language ?? 'en';
}

function notify(): void {
  notified = true;
  const lang = language();
  const target = document.querySelector('home-assistant') ?? document.body;
  target.dispatchEvent(
    new CustomEvent('hass-notification', {
      bubbles: true,
      composed: true,
      detail: {
        id: UPDATE_TOAST_ID,
        message: localize(lang, 'ui.update_available'),
        action: { text: localize(lang, 'ui.reload'), action: () => location.reload() },
        duration: -1,
        dismissable: true,
      },
    }),
  );
}

export async function checkForUpdate(now = Date.now()): Promise<void> {
  if (!hass || !loadedFrom || inFlight || notified || now - lastCheck < MIN_INTERVAL_MS) return;
  inFlight = true;
  lastCheck = now;
  try {
    const resources = await hass.callWS<{ url: string }[]>({ type: 'lovelace/resources' });
    if (compareResources(loadedFrom, resources, location.href) === 'outdated') notify();
  } catch {
    // older HA, no connection: try again next time
  } finally {
    inFlight = false;
  }
}

/** Called with every new hass object; the first call of the page starts watching. */
export function trackUpdates(newHass: HomeAssistant, moduleUrl: string): void {
  hass = newHass;
  if (started) return;
  let url: URL;
  try {
    url = new URL(moduleUrl);
  } catch {
    return;
  }
  // only the released bundle loaded as a dashboard resource (not the dev server or tests)
  if (fileName(url) !== FILE || typeof document === 'undefined') return;
  started = true;
  loadedFrom = moduleUrl;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), HOURLY_MS);
  void checkForUpdate();
}

/** For tests. */
export function resetUpdateCheck(): void {
  hass = undefined;
  loadedFrom = undefined;
  started = false;
  lastCheck = -Infinity;
  inFlight = false;
  notified = false;
}
