// Public website ID, not a credential. Analytics are enabled only on the live atlas.
export const ANALYTICS_WEBSITE_ID = 'bc9f8fd4-11b5-4597-ba36-86232932e930';
const ANALYTICS_ORIGIN = 'https://u.plhery.com';
const PRODUCTION_HOSTS = [
  'umbra-eclipse.plhery.com',
  'umbra-eclipse-atlas.plhery.chatgpt.site',
];

// Explicit property allowlists prevent coordinates, search text, and error messages
// from accidentally reaching analytics when a call site is extended later.
const EVENT_PROPERTIES = {
  eclipse_select: ['eclipse', 'source'],
  eclipse_loaded: ['eclipse', 'kind', 'duration_ms'],
  panel_view: ['panel'],
  panel_close: ['panel'],
  location_select: ['source'],
  location_request: [],
  location_result: ['status'],
  location_save: ['action', 'count'],
  location_elevation: [],
  location_timezone: [],
  place_search: ['mode'],
  place_search_result: ['status', 'count'],
  catalog_search: ['from_year', 'to_year', 'types', 'visible_here', 'central_only', 'min_duration', 'sort', 'saros'],
  catalog_result: ['status', 'count', 'duration_ms'],
  comparison_change: ['action', 'eclipse', 'count'],
  map_ready: ['duration_ms'],
  map_move: ['action', 'zoom'],
  map_fit: [],
  map_style: ['style'],
  map_fullscreen: ['enabled'],
  layer_toggle: ['layer', 'enabled'],
  layer_preset: ['preset'],
  layer_opacity: ['opacity'],
  timeline_playback: ['action'],
  timeline_seek: ['source', 'target'],
  presentation: ['enabled'],
  sheet_resize: ['size', 'source'],
  preference_change: ['preference', 'value'],
  detail_toggle: ['section', 'open'],
  share: ['method', 'status'],
  copy: ['kind', 'status'],
  export: ['format', 'status', 'eclipse', 'has_location'],
  outbound_link: ['destination'],
  service_error: ['service', 'reason'],
} as const;

export type AnalyticsEvent = keyof typeof EVENT_PROPERTIES;
type EventData = Record<string, string | number | boolean>;
type Payload = Record<string, unknown>;
type UmamiWindow = Window & {
  umami?: { track: (payload: Payload) => Promise<unknown> };
};

let started = false;
let unavailable = false;
let draining = false;
const queue: Payload[] = [];
const lastSent = new Map<string, number>();
const debounces = new Map<string, ReturnType<typeof setTimeout>>();

function enabled() {
  if (typeof window === 'undefined' || !import.meta.env.PROD || unavailable) return false;
  if (!PRODUCTION_HOSTS.includes(window.location.hostname)) return false;
  const navigator = window.navigator as Navigator & { globalPrivacyControl?: boolean };
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || navigator.globalPrivacyControl) return false;
  try {
    return !window.localStorage.getItem('umami.disabled');
  } catch {
    return true;
  }
}

function basePayload(): Payload {
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    !!(window.navigator as Navigator & { standalone?: boolean }).standalone;
  const ios = /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  let referrer = '';
  try {
    const origin = new URL(document.referrer).origin;
    if (origin !== window.location.origin) referrer = origin;
  } catch { /* An empty referrer is normal for a direct visit. */ }
  return {
    website: ANALYTICS_WEBSITE_ID,
    hostname: window.location.hostname,
    url: '/', // Map state contains precise coordinates. Never send search/hash.
    title: 'Umbra — Solar eclipse atlas',
    referrer,
    language: window.navigator.language,
    screen: `${window.screen.width}x${window.screen.height}`,
    tag: ios ? (standalone ? 'ios_pwa' : 'ios_web') : (standalone ? 'pwa' : 'web'),
  };
}

async function drain() {
  const umami = (window as UmamiWindow).umami;
  if (draining || !umami) return;
  draining = true;
  try {
    while (queue.length && enabled()) {
      // Serialize sends so the SDK's session cache is established by the pageview.
      await umami.track(queue.shift()!);
    }
  } catch { /* Analytics must never interrupt an atlas action. */ }
  finally {
    draining = false;
    if (!enabled()) queue.length = 0;
  }
}

export function initializeAnalytics() {
  if (!enabled() || started) return;
  started = true;
  queue.push(basePayload()); // Exactly one pageview, including under React Strict Mode.
  const script = document.createElement('script');
  script.src = `${ANALYTICS_ORIGIN}/script.js`;
  script.async = true;
  script.dataset.websiteId = ANALYTICS_WEBSITE_ID;
  script.dataset.autoTrack = 'false'; // History changes describe map state, not pages.
  script.dataset.excludeSearch = 'true';
  script.dataset.excludeHash = 'true';
  script.dataset.doNotTrack = 'true';
  script.referrerPolicy = 'no-referrer';
  script.onload = () => { void drain(); };
  script.onerror = () => {
    unavailable = true;
    queue.length = 0;
  };
  document.head.appendChild(script);
}

export function trackEvent(name: AnalyticsEvent, data: EventData = {}) {
  if (!enabled()) return;
  initializeAnalytics();
  const safeData: EventData = {};
  for (const key of EVENT_PROPERTIES[name]) {
    const value = data[key];
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      safeData[key] = value;
    } else if (typeof value === 'string') {
      safeData[key] = value.slice(0, 80);
    }
  }
  if (queue.length < 100) queue.push({ ...basePayload(), name, data: safeData });
  void drain();
}

export function trackThrottled(name: AnalyticsEvent, data: EventData = {}, interval = 1500) {
  if (!enabled()) return;
  const now = Date.now();
  const key = `${name}:${data.service ?? ''}`;
  if (now - (lastSent.get(key) ?? -Infinity) < interval) return;
  lastSent.set(key, now);
  trackEvent(name, data);
}

export function trackDebounced(name: AnalyticsEvent, data: EventData = {}) {
  if (!enabled()) return;
  clearTimeout(debounces.get(name));
  debounces.set(name, setTimeout(() => {
    debounces.delete(name);
    trackEvent(name, data);
  }, 600));
}
