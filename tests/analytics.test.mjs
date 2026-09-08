import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/analytics.ts', import.meta.url), 'utf8');
function harness({ hostname = 'umbra-eclipse.plhery.com', prod = true, dnt, gpc, disabled, storageThrows, ios, standalone } = {}) {
  const sent = [];
  const scripts = [];
  const timers = new Map();
  const history = { replaceState() {} };
  const window = {
    location: { hostname, origin: `https://${hostname}`, href: `https://${hostname}/?lat=47.3769&lon=8.5417#secret` },
    navigator: { language: 'en-US', doNotTrack: dnt, globalPrivacyControl: gpc, userAgent: ios ? 'iPhone' : 'Firefox', standalone },
    matchMedia: () => ({ matches: !!standalone }),
    screen: { width: 390, height: 844 },
    history,
    localStorage: { getItem() { if (storageThrows) throw Error('blocked'); return disabled; } },
  };
  const document = {
    referrer: 'https://example.com/private/path?token=secret#location',
    createElement: () => ({ dataset: {} }),
    head: { appendChild: (script) => scripts.push(script) },
  };
  let clock = 10_000;
  let timerId = 0;
  const exports = {};
  const context = vm.createContext({
    exports, window, document, URL,
    Date: { now: () => clock },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(ts.transpileModule(source.replaceAll('import.meta.env.PROD', String(prod)), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return {
    api: exports, sent, scripts, window, document,
    async load(track) {
      window.umami = { track: track ?? (async (payload) => { sent.push(JSON.parse(JSON.stringify(payload))); }) };
      scripts[0].onload();
      await new Promise(setImmediate);
    },
    advance(ms) { clock += ms; },
    async flushTimers() { for (const fn of timers.values()) fn(); timers.clear(); await new Promise(setImmediate); },
  };
}

test('queues early actions behind exactly one pageview and never captures map URLs or arbitrary properties', async () => {
  const h = harness();
  h.api.trackEvent('location_select', { source: 'map', lat: 47.3769, lon: 8.5417, name: 'Home' });
  h.api.initializeAnalytics();
  h.api.initializeAnalytics();
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].dataset.autoTrack, 'false');
  await h.load();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent.filter(p => !p.name).length, 1);
  assert.deepEqual(h.sent[1].data, { source: 'map' });
  for (const p of h.sent) {
    assert.equal(p.url, '/');
    assert.equal(p.referrer, 'https://example.com');
    assert.equal(p.tag, 'web');
    assert.doesNotMatch(JSON.stringify(p), /47\.3769|8\.5417|secret|Home|token|private/);
  }
  for (let i = 0; i < 10; i++) h.window.history.replaceState(null, '', `/?lat=${i}`);
  assert.equal(h.sent.length, 2);
});

test('suppresses local, preview, development and opted-out visits before loading Umami', () => {
  for (const options of [{hostname:'localhost'}, {hostname:'preview.example'}, {prod:false}, {dnt:'1'}, {dnt:'yes'}, {gpc:true}, {disabled:'1'}]) {
    const h = harness(options);
    h.api.initializeAnalytics();
    h.api.trackEvent('map_fit');
    assert.equal(h.scripts.length, 0, JSON.stringify(options));
  }
});

test('blocked storage does not break analytics or atlas actions; blocked script stops its queue', async () => {
  const h = harness({storageThrows:true});
  h.api.trackEvent('map_fit');
  h.scripts[0].onerror();
  assert.doesNotThrow(() => h.api.trackEvent('map_fit'));
  await h.load();
  assert.equal(h.sent.length, 0);
});

test('sending is sequential so events reuse the session established by the first request', async () => {
  const h = harness();
  h.api.trackEvent('layer_toggle', {layer:'path', enabled:false});
  let resolveFirst;
  let calls = 0;
  await h.load(async (payload) => {
    calls++;
    h.sent.push(payload);
    if (calls === 1) await new Promise(resolve => { resolveFirst = resolve; });
  });
  assert.equal(calls, 1);
  resolveFirst();
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test('bounds delayed-script queues and tolerates rejected SDK requests', async () => {
  const h = harness();
  for (let i = 0; i < 500; i++) h.api.trackEvent('map_fit');
  await h.load();
  assert.equal(h.sent.length, 100);
  const broken = harness();
  broken.api.initializeAnalytics();
  await broken.load(async () => { throw Error('blocked'); });
  assert.doesNotThrow(() => broken.api.trackEvent('map_fit'));
});

test('throttles map movement, debounces scrubbing, and separates iOS web from Home Screen visits', async () => {
  const h = harness({ios:true, standalone:true});
  h.api.initializeAnalytics();
  await h.load();
  h.api.trackThrottled('map_move', {action:'pan_zoom', zoom:3});
  h.api.trackThrottled('map_move', {action:'pan_zoom', zoom:4});
  h.advance(2000);
  h.api.trackThrottled('map_move', {action:'pan_zoom', zoom:5});
  for (let i=0;i<30;i++) h.api.trackDebounced('timeline_seek', {source:'slider', target:'custom'});
  await h.flushTimers();
  assert.equal(h.sent.filter(p => p.name === 'map_move').length, 2);
  assert.equal(h.sent.filter(p => p.name === 'timeline_seek').length, 1);
  assert.equal(h.sent[0].tag, 'ios_pwa');
  const web = harness({ios:true});
  web.api.initializeAnalytics();
  await web.load();
  assert.equal(web.sent[0].tag, 'ios_web');
});

test('excludes non-finite values and stops queued sends when the visitor opts out', async () => {
  const h = harness();
  h.api.trackEvent('catalog_result', {count:NaN, status:'success'});
  await h.load();
  assert.deepEqual(h.sent[1].data, {status:'success'});
  h.window.navigator.globalPrivacyControl = true;
  h.api.trackEvent('map_fit');
  assert.equal(h.sent.length, 2);
});


test('collects the verified Sites production alias', async () => {
  const h = harness({hostname:'umbra-eclipse-atlas.plhery.chatgpt.site'});
  h.api.initializeAnalytics();
  await h.load();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].hostname, 'umbra-eclipse-atlas.plhery.chatgpt.site');
});
