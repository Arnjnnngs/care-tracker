#!/usr/bin/env node
/**
 * medsync-test.mjs — verification suite for shared medication settings in care-tracker.
 *
 * SAFETY (non-negotiable; this app holds one cancer patient's real medication history):
 *   * ALL THREE gstatic Firebase modules are stubbed. One catch-all route aborts every request
 *     that is not 127.0.0.1 or one of the three stubs. NET-1 fails the run if anything escaped.
 *   * The service worker is deleted from the page before any script runs. NET-2 fails the run if
 *     sw.js was ever requested.
 *   * Fixtures only. The medications in them are invented ('Alpha Test Med', ids prefixed 'zz-')
 *     and are not this patient's medications.
 *
 * WHAT IT PROVES
 *   Two devices with different medication lists reproduce the live defect (the same dose reads
 *   "Available now" on one and "Next dose at ..." on the other), converge after one explicit
 *   choice, and cannot diverge again. The list that was not chosen is still recoverable, from
 *   Firestore and from that phone's own storage. Offline falls back to the local list and the app
 *   keeps working. Nothing is ever written to the append-only caretracker_entries collection.
 *
 * HOW TWO DEVICES ARE MODELLED
 *   Not with two live pages sharing a socket, but by THREADING THE REAL DOCUMENT: page A runs,
 *   its writes are merged into a prefs document with Firestore's own set(merge:true) semantics,
 *   and that document is handed to page B as its starting fixture. Every hop therefore goes
 *   through the same bytes the live app would exchange. The merge is recursive for maps, which is
 *   exactly why the config is stored as a JSON string — see MERGE-semantics.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node medsync-test.mjs \
 *       --file work/repo/index.html --base work/base-index.html
 *   ... node medsync-test.mjs --falsify        # break each guard in turn; the named check must go RED
 *   ... node medsync-test.mjs --falsify --batch 0-6
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const STREAM = argv.includes('--stream');
const ONLY = arg('--only');
const VP_ARG = arg('--vp') ? Number(arg('--vp')) : null;
const BATCH = arg('--batch') ? arg('--batch').split('-').map(Number) : null;
const APP_FILE = arg('--file') || path.join(HERE, 'work', 'repo', 'index.html');
// The UNPATCHED base. Used only for input-vs-output comparison. No check in this file asserts a
// version literal, a cache name or a build number — three earlier patches on this project were
// broken by suites that did.
const BASE_FILE = arg('--base') || path.join(HERE, 'work', 'base-index.html');
const BASE_SW_FILE = path.join(path.dirname(BASE_FILE), path.basename(BASE_FILE) === 'base-index.html' ? 'base-sw.js' : 'sw.js');
const OUT_SW_FILE = path.join(path.dirname(APP_FILE), 'sw.js');
const readOrNull = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch (e) { return null; } };
const BASE_HTML = readOrNull(BASE_FILE);
const BASE_SW = readOrNull(BASE_SW_FILE);
const OUT_SW = readOrNull(OUT_SW_FILE);
const md5 = (s) => crypto.createHash('md5').update(s, 'utf-8').digest('hex');

const ALL_VIEWPORTS = [{ w: 375, h: 812, name: 'iPhone-375x812' }, { w: 390, h: 844, name: 'iPhone-390x844' }];
const VIEWPORTS = VP_ARG ? ALL_VIEWPORTS.filter(v => v.w === VP_ARG) : (MODE_FALSIFY ? [ALL_VIEWPORTS[0]] : ALL_VIEWPORTS);

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the proxy.');
    process.exit(3);
  }
}

// =================================================================================================
// Firebase stubs
// =================================================================================================

const STUB_APP = `export function initializeApp(cfg) { return { name: '[DEFAULT]', options: cfg }; }`;

const STUB_MESSAGING = `
export function getMessaging() { throw new Error('messaging disabled in the test harness'); }
export async function getToken() { return null; }
export function onMessage() { return () => {}; }
`;

// set(..., { merge: true }) DEEP-MERGES maps in Firestore: a nested map is merged key by key, not
// replaced. Modelling that faithfully is the whole point — an implementation that stored the
// medication list as a nested object would look correct against a shallow Object.assign stub and
// would then silently fail to remove a deactivated medication on the live app.
const STUB_FIRESTORE = `
const fx = (globalThis.__MEDSYNC_FIXTURE__ || { entries: [], prefs: {} });
const store = { entries: (fx.entries || []).slice(), prefs: JSON.parse(JSON.stringify(fx.prefs || {})) };
const entryListeners = [];
const prefsListeners = [];
let autoId = 0;
const rec = { addDoc: [], deleteDoc: [], setDoc: [] };

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function mergeInto(target, data) {
  Object.keys(data).forEach((k) => {
    const v = data[k];
    if (isPlainObject(v)) {
      if (!isPlainObject(target[k])) target[k] = {};
      mergeInto(target[k], v);
    } else {
      target[k] = v;
    }
  });
  return target;
}

globalThis.__medsyncStub = {
  rec,
  prefs() { return JSON.parse(JSON.stringify(store.prefs)); },
  entryWrites() { return rec.addDoc.concat(rec.deleteDoc).filter(w => w.col === 'caretracker_entries'); },
  prefsWrites() { return rec.setDoc.filter(w => w.col === 'caretracker_prefs'); },
  reset() { rec.addDoc.length = 0; rec.deleteDoc.length = 0; rec.setDoc.length = 0; },
  // Deliver a prefs update from "the other phone" into a page that is already open.
  push(patch) { mergeInto(store.prefs, JSON.parse(JSON.stringify(patch))); emitPrefs(); }
};

function snapOf(list) {
  return { docs: list.map(e => ({ id: e.id, data: () => { const c = Object.assign({}, e); delete c.id; return c; } })) };
}
function emitEntries() {
  const sorted = store.entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const cb of entryListeners) cb(snapOf(sorted));
}
function emitPrefs() {
  for (const cb of prefsListeners) cb({ exists: () => true, data: () => JSON.parse(JSON.stringify(store.prefs)) });
}

export function getFirestore() { return { __db: true }; }
export function collection(db, name) { return { __kind: 'col', name }; }
export function doc(db, colName, id) { return { __kind: 'doc', col: colName, id }; }
export function query(col) { return { __kind: 'query', col }; }
export function orderBy(field, dir) { return { field, dir }; }
export function onSnapshot(target, cb) {
  if (target && target.__kind === 'doc') {
    // "Prefs never load" models an offline phone: the callback simply never runs, exactly as it
    // would with the connection down or a rules error.
    if (fx.prefsNever) return () => {};
    prefsListeners.push(cb);
    setTimeout(emitPrefs, 0);
    return () => {};
  }
  entryListeners.push(cb);
  setTimeout(emitEntries, 0);
  return () => {};
}
export async function addDoc(col, data) {
  rec.addDoc.push({ col: col && col.name, data: JSON.parse(JSON.stringify(data)) });
  if (fx.writesFail) throw new Error('offline: write rejected');
  store.entries.push(Object.assign({ id: 'added-' + (++autoId) }, data));
  emitEntries();
  return { id: 'added-' + autoId };
}
export async function deleteDoc(ref) {
  rec.deleteDoc.push({ col: ref && ref.col, id: ref && ref.id });
  if (fx.writesFail) throw new Error('offline: delete rejected');
  store.entries = store.entries.filter(e => e.id !== (ref && ref.id));
  emitEntries();
}
export async function setDoc(ref, data, opts) {
  rec.setDoc.push({ col: ref && ref.col, id: ref && ref.id, merge: !!(opts && opts.merge), data: JSON.parse(JSON.stringify(data)) });
  if (fx.writesFail) throw new Error('offline: write rejected');
  if (ref && ref.col === 'caretracker_prefs') {
    if (opts && opts.merge) mergeInto(store.prefs, JSON.parse(JSON.stringify(data)));
    else store.prefs = JSON.parse(JSON.stringify(data));
    emitPrefs();
  }
}
export async function getDocs() { return snapOf(store.entries); }
`;

const GSTATIC = {
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js': STUB_APP,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js': STUB_FIRESTORE,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js': STUB_MESSAGING
};

// =================================================================================================
// Fixtures — invented medications, not the patient's
// =================================================================================================

const MED_KEY = 'caretracker-medication-config-v1';
const DEVICE_KEY = 'caretracker-device-id-v1';
const PRECHOICE_KEY = 'caretracker-medication-config-prechoice-v1';
const DEV_A = 'dev-fixture-aaron-phone';
const DEV_B = 'dev-fixture-brandi-phone';

const NAME_ALPHA = 'Alpha Test Med';
const NAME_BETA = 'Beta Test Med';
const NAME_GAMMA = 'Gamma Test Med';
const NAME_DELTA = 'Delta Test Med';
const NAME_EPSILON = 'Epsilon Test Med';
const NAME_ZETA = 'Zeta Test Med';
const NAME_ETA = 'Eta Test Med';

function medFx(id, name, extra) {
  return Object.assign({
    id, name, sub: 'Fixture', type: 'gap', gapH: 0, quickLog: true,
    doses: [{ label: '1 pill', pills: 1, mg: 0 }]
  }, extra || {});
}

// Device A ("this phone" in every runtime check). Alpha has a SIX hour gap.
const CFG_A = {
  version: 1,
  meds: [
    medFx('zz-alpha', NAME_ALPHA, { gapH: 6 }),
    medFx('zz-beta', NAME_BETA),
    medFx('zz-delta', NAME_DELTA, { gapH: 4 }),
    medFx('zz-zeta', NAME_ZETA),
    medFx('zz-eta', NAME_ETA)
  ],
  archivedMeds: { 'zz-epsilon': { name: NAME_EPSILON, sub: '' } }
};

// Device B. Alpha has a FOUR hour gap — this is the live defect. Delta carries rollingCeilingH,
// which makes medState() return { locked: false } unconditionally, so that phone always says
// Available. Zeta is deactivated here and active on A; Epsilon is the other way round.
const CFG_B = {
  version: 1,
  meds: [
    medFx('zz-alpha', NAME_ALPHA, { gapH: 4 }),
    medFx('zz-gamma', NAME_GAMMA),
    medFx('zz-delta', NAME_DELTA, { gapH: 4, rollingCeilingH: 4 }),
    medFx('zz-epsilon', NAME_EPSILON)
  ],
  archivedMeds: { 'zz-zeta': { name: NAME_ZETA, sub: '' } }
};

// Differences A vs B, counted by hand so the suite is not marking its own homework:
//   only on A            : Beta, Zeta, Eta                    3
//   only on B            : Gamma, Epsilon                     2
//   deactivated on A only: Epsilon                            1
//   deactivated on B only: Zeta                               1
//   changed fields       : Alpha.gapH, Delta.rollingCeilingH  2
//                                                       total 9
const EXPECTED_DIFF_COUNT = 9;

const FIVE_HOURS = 5 * 3600000;

function baseEntries() {
  const t = Date.now() - FIVE_HOURS;
  const u = Date.now() - 3600000;
  return [
    // Five hours ago: inside a six-hour gap, outside a four-hour one. One dose, one timestamp,
    // two phones — the exact shape of what Aaron saw.
    { id: 'e-alpha', medId: 'zz-alpha', dose: '1 pill', pills: 1, mg: 0, ts: t, loggedAt: t },
    // One hour ago: inside the four-hour gap both phones agree on, so the only thing that can
    // unlock it is the rollingCeilingH early return in status().
    { id: 'e-delta', medId: 'zz-delta', dose: '1 pill', pills: 1, mg: 0, ts: u, loggedAt: u }
  ];
}

function localFor(cfg, deviceId, extra) {
  const out = { [MED_KEY]: JSON.stringify(cfg), [DEVICE_KEY]: deviceId };
  return Object.assign(out, extra || {});
}

// =================================================================================================
// Runner plumbing
// =================================================================================================

class Suite {
  constructor() { this.results = []; }
  async run(id, desc, fn) {
    if (ONLY && !id.includes(ONLY)) return;
    const t0 = Date.now();
    try { await fn(); this.results.push({ id, desc, ok: true }); }
    catch (err) { this.results.push({ id, desc, ok: false, err: String((err && err.message) || err) }); }
    const r = this.results[this.results.length - 1];
    if (STREAM) process.stderr.write('    ' + (r.ok ? 'ok   ' : 'FAIL ') + id + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)' + (r.ok ? '' : '\n         ' + r.err) + '\n');
  }
  failed() { return this.results.filter(r => !r.ok); }
}

const MEASURED = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertGte(actual, min, msg) {
  assert(typeof actual === 'number' && isFinite(actual) && actual >= min, msg + ' — measured ' + actual + ', floor ' + min);
}

function startServer(getHtml) {
  const server = http.createServer((req, res) => {
    const u = (req.url || '/').split('?')[0];
    if (u === '/' || u === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(getHtml());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + u);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function makeNetLog() { return { stubHits: new Set(), blocked: [], allowed: [], swRequested: false }; }

async function newPage(browser, url, vp, net, fixture) {
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: fixture.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });

  await context.addInitScript(({ fx, local }) => {
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
    window.open = () => null;
    globalThis.__MEDSYNC_FIXTURE__ = fx;
    try {
      localStorage.clear();
      Object.keys(local || {}).forEach((k) => localStorage.setItem(k, local[k]));
    } catch (e) {}
  }, { fx: { entries: fixture.entries || [], prefs: fixture.prefs || {}, prefsNever: !!fixture.prefsNever, writesFail: !!fixture.writesFail }, local: fixture.local || {} });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  // Every non-loopback request is ABORTED by this harness on purpose, and Chromium logs each abort
  // as a resource error. Those are the safety net working; they are not defects in the app.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

  await context.route('**/*', async (route) => {
    const u = route.request().url();
    if (GSTATIC[u]) {
      net.stubHits.add(u);
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GSTATIC[u] });
    }
    if (/\/sw\.js(\?|$)/.test(u) || /firebase-messaging-sw\.js/.test(u)) { net.swRequested = true; return route.abort(); }
    if (u.startsWith('http://127.0.0.1:')) { net.allowed.push(u); return route.continue(); }
    net.blocked.push(u);
    return route.abort();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // A build that fails to boot must produce FAILING CHECKS, not an exception that aborts the run
  // before a single one is recorded. Under --falsify a mutant is expected to break the app; the
  // named guard has to be seen going red, so the boot wait is swallowed here and every check that
  // needs the screen then fails on its own missing selector.
  try {
    await page.waitForFunction(() => !!document.querySelector('[data-cal-menu-button]'), null, { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('[data-tour-quicklog]'), null, { timeout: 15000 });
  } catch (err) {
    pageErrors.push('the app did not finish booting: ' + String((err && err.message) || err));
  }
  // Give the prefs snapshot and the candidate write a turn of the loop to land.
  await page.waitForTimeout(350);
  return { context, page, consoleErrors, pageErrors };
}

// ---- DOM readers. Scoped to rendered elements inside #root, NEVER document.body.textContent:
// this is a single-file app, so body text includes the inline <script> source and a check that
// reads it matches its own string literals and passes on a broken build.

async function readPrefsDoc(page) {
  return page.evaluate(() => globalThis.__medsyncStub.prefs());
}
async function writeAudit(page) {
  return page.evaluate(() => ({
    entryWrites: globalThis.__medsyncStub.entryWrites(),
    prefsWrites: globalThis.__medsyncStub.prefsWrites(),
    allSetDoc: globalThis.__medsyncStub.rec.setDoc.map(w => ({ col: w.col, id: w.id, merge: w.merge, keys: Object.keys(w.data) }))
  }));
}
async function resetAudit(page) { await page.evaluate(() => globalThis.__medsyncStub.reset()); }

async function goMeds(page) {
  await page.click('[data-cal-menu-button]');
  await page.waitForSelector('[data-cal-drawer]', { timeout: 8000 });
  await page.click('[data-cal-drawer-item="meds"]');
  await page.waitForSelector('[data-tour-meds]', { timeout: 8000 });
}

async function goHome(page) {
  await page.click('[data-cal-menu-button]');
  await page.waitForSelector('[data-cal-drawer]', { timeout: 8000 });
  await page.click('[data-cal-drawer-item="home"]');
  await page.waitForSelector('[data-tour-quicklog]', { timeout: 8000 });
}

async function openChooser(page) {
  await goMeds(page);
  await page.click('[data-medsync-open]');
  await page.waitForSelector('[data-medsync-title]', { timeout: 8000 });
}

async function medNames(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-tour-meds]');
    if (!root) return null;
    return Array.from(root.children).map((card) => {
      const n = card.querySelector(':scope > div > div > div');
      return n ? n.textContent.trim() : '';
    }).filter(Boolean);
  });
}

async function quickLogCards(page) {
  return page.evaluate(() => {
    const sec = document.querySelector('[data-tour-quicklog]');
    if (!sec) return null;
    const grid = sec.children[1];
    if (!grid) return [];
    return Array.from(grid.children).map((card) => {
      const n = card.querySelector(':scope > div > div > div');
      const t = card.textContent || '';
      // The status pill is the exact wording Aaron reported: "Waiting" when locked, "Available"
      // when not. "Limit" and "Restricted" are the other two locked states.
      return {
        name: n ? n.textContent.trim() : '',
        available: /Available/.test(t),
        waiting: /Waiting/.test(t),
        limit: /Limit|Restricted/.test(t)
      };
    });
  });
}

async function cardFor(page, name) {
  const cards = await quickLogCards(page);
  assert(Array.isArray(cards), 'the Quick Log section was not found');
  const found = cards.filter(c => c.name === name);
  assert(found.length === 1, 'expected exactly one Quick Log card named "' + name + '", found ' + found.length + ' of ' + cards.length);
  return found[0];
}

async function chooserText(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return main ? main.innerText : '';
  });
}

async function medsyncAttrDump(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const out = [];
    main.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) out.push({ tag: el.tagName, name: a.name, value: a.value });
    });
    return out;
  });
}

// =================================================================================================
// File checks — these read the FILE, never the screen.
// =================================================================================================

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

function collectionTargets(src) {
  return new Set([
    ...src.matchAll(/collection\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/g),
    ...src.matchAll(/doc\(db,\s*([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")/g)
  ].map(m => m[1]));
}

async function runFileChecks(suite, html) {
  const code = stripComments(html);
  const start = html.indexOf('MEDSYNC-PATCH-MARK');
  const end = html.indexOf("const CONFIG = { patientName:", start);
  const module = (start >= 0 && end > start) ? html.slice(start, end) : '';
  const moduleCode = stripComments(module);

  await suite.run('FILE-module-present', 'the shared-settings module landed exactly once, as one block above CONFIG', () => {
    assert(html.split('MEDSYNC-PATCH-MARK').length === 2, 'the module mark is missing or duplicated');
    assert(module.length > 5000, 'the module block could not be delimited (found ' + module.length + ' chars)');
  });

  await suite.run('FILE-app-version', 'APP_VERSION is byte-identical to the base build (compared, never asserted as a literal)', () => {
    assert(BASE_HTML, 'the base build was not readable at ' + BASE_FILE + ' — pass --base');
    const a = /const APP_VERSION = '([^']+)';/.exec(BASE_HTML);
    const b = /const APP_VERSION = '([^']+)';/.exec(html);
    assert(a && b, 'APP_VERSION declaration missing');
    assert(a[1] === b[1], 'APP_VERSION changed: ' + a[1] + ' -> ' + b[1] + ' — this patch must never touch it');
    assert(html.match(/const APP_VERSION = '[^']+';/g).length === 1, 'APP_VERSION is declared more than once');
  });

  await suite.run('FILE-sw-untouched', 'sw.js is byte-identical to the base build', () => {
    assert(BASE_SW !== null, 'base sw.js not readable at ' + BASE_SW_FILE);
    assert(OUT_SW !== null, 'sw.js not readable at ' + OUT_SW_FILE);
    assert(md5(BASE_SW) === md5(OUT_SW), 'sw.js changed: ' + md5(BASE_SW) + ' -> ' + md5(OUT_SW));
  });

  await suite.run('FILE-version-label-derived', 'the UI version label is derived from APP_VERSION and no build number was hardcoded', () => {
    assert(code.includes("'CareTracker ' + APP_VERSION"), 'the version label is not derived from APP_VERSION');
    assert(html.split('data-app-version').length === 2, 'expected exactly one version label hook');
    const added = [...new Set([...code.matchAll(/'v\d+(?:\.\d+)*'/g)].map(m => m[0]))]
      .filter(s => code.split(s).length !== stripComments(BASE_HTML).split(s).length);
    assert(added.length === 0, 'a version literal was introduced: ' + added.join(', '));
  });

  await suite.run('FILE-no-new-collection', 'no new Firestore collection was introduced', () => {
    const before = collectionTargets(stripComments(BASE_HTML));
    const after = collectionTargets(code);
    const added = [...after].filter(x => !before.has(x));
    assert(added.length === 0, 'new collection target(s): ' + added.join(', ') + ' — the published rules match named collections; a new one fails silently on the live app');
  });

  await suite.run('FILE-nothing-added-to-entries', 'the append-only entries collection gained no new writer', () => {
    const before = stripComments(BASE_HTML);
    assert(code.split('caretracker_entries').length === before.split('caretracker_entries').length,
      'references to caretracker_entries changed: ' + (before.split('caretracker_entries').length - 1) + ' -> ' + (code.split('caretracker_entries').length - 1));
    assert(code.split('addDoc(').length === before.split('addDoc(').length, 'an addDoc call was added');
    assert(code.split('deleteDoc(').length === before.split('deleteDoc(').length, 'a deleteDoc call was added');
    // addEntryDB/removeEntryDB are the WRAPPERS around those two. A new caller of the wrapper adds
    // neither an addDoc( nor a caretracker_entries literal, so it has to be counted separately.
    assert(code.split('addEntryDB(').length === before.split('addEntryDB(').length, 'a new caller of addEntryDB was added — configuration must never reach the append-only collection');
    assert(code.split('removeEntryDB(').length === before.split('removeEntryDB(').length, 'a new caller of removeEntryDB was added');
  });

  await suite.run('FILE-shared-write-is-merged-prefs', 'every write the module makes is the merged write onto the existing prefs document', () => {
    const setDocs = [...moduleCode.matchAll(/setDoc\([^;]*?\)/gs)].map(m => m[0]);
    assert(setDocs.length >= 1, 'the module makes no setDoc call at all');
    for (const s of setDocs) {
      assert(s.includes('PREFS_DOC'), 'a setDoc in the module does not target PREFS_DOC: ' + s.slice(0, 90));
      assert(s.includes('merge: true'), 'a setDoc in the module is not a merged write: ' + s.slice(0, 90));
    }
  });

  await suite.run('FILE-one-choice-writer', 'the shared list is written by exactly one code path a person can reach', () => {
    assert(moduleCode.split('medsyncCommitChoice(').length === 3,
      'medsyncCommitChoice appears ' + (moduleCode.split('medsyncCommitChoice(').length - 1) + ' times; expected its declaration plus exactly one call site');
    assert(/data-medsync-confirm-yes/.test(moduleCode), 'the confirm button hook is missing');
    const commit = /function medsyncCommitChoice\([\s\S]*?\n\}/.exec(moduleCode);
    assert(commit && commit[0].includes('medsyncBusy'), 'medsyncCommitChoice is not re-entrancy guarded');
  });

  await suite.run('FILE-no-auto-merge', 'nothing picks a winner by timestamp or by list length', () => {
    assert(!/newer|newest|winner|lastWriteWins/i.test(moduleCode), 'the module contains auto-merge language in code');
    const onPrefs = /function medsyncOnPrefs\([\s\S]*?\n\}/.exec(moduleCode);
    assert(onPrefs, 'medsyncOnPrefs not found');
    assert(!onPrefs[0].includes('MEDSYNC_SHARED_FIELD] ='), 'the prefs handler writes the shared field — adoption must never publish');
  });

  await suite.run('FILE-no-disabled-attr', 'THE h() TRAP: the module passes no `disabled` and no nullish attribute', () => {
    assert(!/\bdisabled\s*:/.test(moduleCode), 'the module passes a `disabled` attribute — h() calls setAttribute, and ANY value disables the control');
    const nullish = [...moduleCode.matchAll(/'?(aria-[a-z]+|hidden|readonly|checked)'?\s*:\s*[^,}\n]*\bnull\b/g)].map(m => m[0]);
    assert(nullish.length === 0, 'a nullish attribute is passed to h(): ' + nullish.join(', '));
  });

  await suite.run('FILE-null-prototype-maps', 'every id-keyed lookup the module builds has a null prototype', () => {
    for (const name of ['medsyncMedMap', 'medsyncReadDevices', 'medsyncCandidates']) {
      const fn = new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}').exec(moduleCode);
      assert(fn, name + '() not found');
      assert(fn[0].includes('Object.create(null)'), name + '() uses a plain {} as an id-keyed map — obj["constructor"] is truthy when EMPTY');
    }
    assert(moduleCode.includes('MEDSYNC_FIELD_INFO = Object.assign(Object.create(null)'),
      'the field-label table is a plain {}, so a medication carrying a "constructor" key would resolve to Object.prototype.constructor');
  });

  await suite.run('FILE-no-setState-in-onInput', 'no onInput handler calls setState', () => {
    for (const m of code.matchAll(/onInput:\s*\([^)]*\)\s*=>\s*\{([^}]*)\}/g)) {
      assert(!m[1].includes('setState('), 'setState() is called from an onInput handler: ' + m[0].slice(0, 90));
    }
  });

  await suite.run('FILE-tick-guard-untouched', 'the composed one-second tick guard is byte-identical to the base build', () => {
    const line = 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();';
    assert(BASE_HTML.split(line).length === html.split(line).length, 'the composed tick guard changed — four earlier patches each own a term of it');
  });

  await suite.run('FILE-empty-config-refused', 'a shared document with an empty medication list can never be adopted', () => {
    const parse = /function medsyncParseConfig\([\s\S]*?\n\}/.exec(moduleCode);
    assert(parse, 'medsyncParseConfig not found');
    assert(parse[0].includes('!raw.meds.length'), 'an empty meds array would be accepted, which could wipe a phone');
  });

  await suite.run('FILE-snapshot-before-adopt', 'the local list is snapshotted before anything can overwrite it, and never overwritten twice', () => {
    const adopt = /function medsyncAdopt\([\s\S]*?\n\}/.exec(moduleCode);
    assert(adopt, 'medsyncAdopt not found');
    const firstLine = adopt[0].split('\n')[1].trim();
    assert(firstLine.startsWith('medsyncBackupLocalOnce()'), 'medsyncAdopt does not snapshot first; first statement is: ' + firstLine);
    const backup = /function medsyncBackupLocalOnce\([\s\S]*?\n\}/.exec(moduleCode);
    assert(backup && backup[0].includes('if (medsyncLsGet(MEDSYNC_PRECHOICE_KEY)) return false;'),
      'the pre-share snapshot can be overwritten');
  });

  await suite.run('FILE-no-render-path-blocks', 'no render function awaits or writes to the network', () => {
    for (const name of ['renderMedsyncCard', 'renderMedsyncScreen', 'renderMedsyncPanel', 'renderMedsyncConfirm', 'renderMedsyncDiffBlock']) {
      const fn = new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}').exec(moduleCode);
      assert(fn, name + '() not found');
      assert(!fn[0].includes('await '), name + '() awaits on a render path');
      assert(!fn[0].includes('setDoc('), name + '() writes to Firestore from a render path');
    }
  });

  await suite.run('FILE-no-placeholders', 'no TODO, FIXME or placeholder in the new module', () => {
    assert(!/TODO|FIXME|placeholder|XXX/i.test(module), 'the module contains a placeholder');
  });

  await suite.run('FILE-no-hardcoded-med-names', 'the module hardcodes no medication name', () => {
    const names = [...stripComments(BASE_HTML).matchAll(/\{ id:'[a-z-]+', name:'([^']+)'/g)].map(m => m[1]);
    assert(names.length >= 10, 'could not read DEFAULT_MEDS names from the base build');
    const leaked = names.filter(n => moduleCode.includes("'" + n + "'"));
    assert(leaked.length === 0, 'the module hardcodes medication name(s): ' + leaked.join(', '));
  });

  await suite.run('FILE-dose-write-path-untouched', 'the dose-logging write path is byte-identical to the base build', () => {
    const grab = (src) => /async function confirmTimeAndLog\(\)[\s\S]*?\n\}/.exec(src);
    const a = grab(BASE_HTML), b = grab(html);
    assert(a && b, 'confirmTimeAndLog() not found');
    assert(a[0] === b[0], 'confirmTimeAndLog() changed — dosing must not be altered by a configuration patch');
    const la = /async function logMed\([\s\S]*?\n\}/.exec(BASE_HTML);
    const lb = /async function logMed\([\s\S]*?\n\}/.exec(html);
    assert(la && lb && la[0] === lb[0], 'logMed() changed');
  });

  await suite.run('FILE-v434-and-home-gates', 'medIsOnActiveList and the three Home counter-card gates are unchanged', () => {
    const before = stripComments(BASE_HTML);
    for (const frag of ['function medIsOnActiveList(id)', "medIsOnActiveList('tylenol')", "medIsOnActiveList('imodium')", "medIsOnActiveList('lidocaine')"]) {
      assert(before.split(frag).length === code.split(frag).length, 'changed: ' + frag);
    }
  });
}

// =================================================================================================
// Runtime — the two-device sequence
// =================================================================================================

async function runRuntimeChecks(suite, browser, url, vp, net) {
  const tag = '@' + vp.name;
  const rt = (id, desc, fn) => suite.run(id + tag, '[' + vp.name + '] ' + desc, fn);

  // ---------- hop 1: device A boots alone ----------
  let prefsAfterA = null;
  {
    const { context, page, pageErrors, consoleErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: {}, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('BOOT-publishes-candidate', 'a phone with no shared list publishes its own list as a candidate, and writes nothing else', async () => {
        const audit = await writeAudit(page);
        assert(audit.entryWrites.length === 0, 'the boot wrote to caretracker_entries: ' + JSON.stringify(audit.entryWrites));
        assert(audit.prefsWrites.length === 1, 'expected exactly one prefs write on boot, got ' + audit.prefsWrites.length);
        const w = audit.prefsWrites[0];
        assert(w.merge === true, 'the candidate write is not a merged write');
        assert(Object.keys(w.data).length === 1 && w.data.medConfigDevices, 'the candidate write carries unexpected fields: ' + Object.keys(w.data).join(', '));
        assert(w.data.medConfigDevices[DEV_A], 'the candidate is not keyed by this device id');
        assert(typeof w.data.medConfigDevices[DEV_A].json === 'string', 'the candidate list is not stored as a string — a nested map would be DEEP-MERGED by Firestore and a removed medication would never be removed');
        assert(w.data.medConfigDevices[DEV_A].frozen === false, 'the candidate is frozen before any choice has been made');
      });

      await rt('BOOT-no-shared-field', 'booting never writes the shared field — only the confirm button may', async () => {
        const p = await readPrefsDoc(page);
        assert(!p.medConfigJson, 'the shared field was written without anybody choosing');
      });

      await rt('CARD-alone-has-no-button', 'with only one phone checked in, the notice appears with NO action button (never a dead one)', async () => {
        await goMeds(page);
        const kind = await page.getAttribute('[data-medsync-card]', 'data-medsync-card');
        assert(kind === 'alone', 'expected the "alone" notice, got ' + kind);
        const btn = await page.$('[data-medsync-open]');
        assert(btn === null, 'a button is rendered with nothing to choose — a disabled-until-ready button is exactly the h() trap');
      });

      await rt('BUG-A-says-waiting', 'THE LIVE DEFECT, half one: on the six-hour phone the dose reads "Next dose at ..."', async () => {
        await goHome(page);
        const c = await cardFor(page, NAME_ALPHA);
        assert(c.waiting && !c.available, 'device A does not show the dose as Waiting; the fixture gap is six hours and the dose was five hours ago');
      });

      await rt('BOOT-console-clean', 'no console errors and no uncaught exceptions', async () => {
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
        assert(consoleErrors.length === 0, 'console errors: ' + consoleErrors.join(' | '));
      });

      prefsAfterA = await readPrefsDoc(page);
    } finally { await context.close(); }
  }

  // ---------- hop 2: device B boots and sees A's candidate ----------
  let prefsAfterB = null;
  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterA, local: localFor(CFG_B, DEV_B),
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36'
    });
    try {
      await rt('MERGE-semantics', "device B's candidate is merged in alongside A's rather than replacing it", async () => {
        const p = await readPrefsDoc(page);
        assert(p.medConfigDevices && p.medConfigDevices[DEV_A], "device A's candidate was lost by the merged write");
        assert(p.medConfigDevices[DEV_B], "device B's candidate was not written");
        assert(p.medConfigDevices[DEV_A].json !== p.medConfigDevices[DEV_B].json, 'the two candidates are identical; the fixtures differ, so something normalised them together');
      });

      await rt('BUG-B-says-available', 'THE LIVE DEFECT, half two: the SAME dose at the SAME timestamp reads "Available now" on the four-hour phone', async () => {
        const c = await cardFor(page, NAME_ALPHA);
        assert(c.available && !c.waiting, 'device B does not show the dose as Available; the defect is not reproduced and the convergence check below would prove nothing');
      });

      await rt('BUG-B-rolling-unlocked', 'the second path: a medication carrying rollingCeilingH on one phone only always reads Available there', async () => {
        const c = await cardFor(page, NAME_DELTA);
        assert(c.available && !c.waiting, 'the rolling-window medication is not unconditionally Available on device B — the second defect path is not reproduced');
      });

      await rt('CARD-diverged-counts', 'the Medications notice states how many differences there are, and offers the chooser', async () => {
        await goMeds(page);
        const kind = await page.getAttribute('[data-medsync-card]', 'data-medsync-card');
        assert(kind === 'diverged', 'expected the "diverged" notice, got ' + kind);
        const n = Number(await page.getAttribute('[data-medsync-diffcount]', 'data-medsync-diffcount'));
        assert(n === EXPECTED_DIFF_COUNT, 'expected ' + EXPECTED_DIFF_COUNT + ' differences (counted by hand from the fixtures), the app reports ' + n);
        assert(await page.$('[data-medsync-open]'), 'the chooser cannot be reached');
      });

      await rt('BOOT-B-console-clean', 'no uncaught exceptions on the second device', async () => {
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
      });

      prefsAfterB = await readPrefsDoc(page);
    } finally { await context.close(); }
  }

  // ---------- hop 3: Aaron looks at the difference on device A and chooses ----------
  let prefsAfterChoice = null;
  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterB, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('DIFF-names-what-differs', 'the chooser names every medication that differs, in both directions, before anything is committed', async () => {
        await openChooser(page);
        const t = await chooserText(page);
        assert(t.includes('On this phone only'), 'the diff does not say what is on this phone only');
        assert(t.includes(NAME_BETA) && t.includes(NAME_ETA), 'medications present only on this phone are not named');
        assert(/On .* only/.test(t), 'the diff does not say what is on the other phone only');
        assert(t.includes(NAME_GAMMA), 'a medication present only on the other phone is not named');
      });

      await rt('DIFF-names-settings', 'the chooser names the SETTINGS that differ, in plain words, and flags the ones that change when a dose is allowed', async () => {
        const t = await chooserText(page);
        assert(t.includes('Smallest gap between doses'), 'the gap difference is not reported');
        assert(t.includes('6 hours') && t.includes('4 hours'), 'the two gap values are not both shown: ' + t.slice(0, 0));
        assert(t.includes('Rolling limit window'), 'the rolling-window difference is not reported');
        assert(t.includes('This one changes when a dose is allowed.'), 'no difference is flagged as affecting dose timing');
      });

      await rt('DIFF-archived', 'deactivated medications are reported as differences too, in both directions', async () => {
        const t = await chooserText(page);
        assert(t.includes('Deactivated on this phone only'), 'archived-only-here is not reported');
        assert(t.includes(NAME_EPSILON), 'the medication deactivated only on this phone is not named');
        assert(/Deactivated on .* only/.test(t), 'archived-only-there is not reported');
        assert(t.includes(NAME_ZETA), 'the medication deactivated only on the other phone is not named');
      });

      await rt('PANELS-enough-to-choose-by', 'each phone is shown with its medication count, its deactivated count and its full list of names', async () => {
        const panels = await page.$$('[data-medsync-panel]');
        assert(panels.length === 2, 'expected two phones on the chooser, found ' + panels.length);
        const a = Number(await page.getAttribute('[data-medsync-panel="' + DEV_A + '"] [data-medsync-count]', 'data-medsync-count'));
        const b = Number(await page.getAttribute('[data-medsync-panel="' + DEV_B + '"] [data-medsync-count]', 'data-medsync-count'));
        assert(a > 0 && b > 0 && a !== b, 'the two phones report medication counts of ' + a + ' and ' + b + '; they must differ for this fixture');
        const panelA = await page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.innerText : ''; }, '[data-medsync-panel="' + DEV_A + '"]');
        const panelB = await page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.innerText : ''; }, '[data-medsync-panel="' + DEV_B + '"]');
        assert(panelA.includes('deactivated') && panelB.includes('deactivated'), 'the deactivated count is not shown on a panel');
        // Scoped to the panel: the difference block above also names medications, so an unscoped
        // assertion would pass on a build whose panels are a bare count and a button.
        assert(panelA.includes(NAME_BETA) && panelA.includes(NAME_ETA), 'this phone\'s panel does not list its medication names');
        assert(panelB.includes(NAME_GAMMA), "the other phone's panel does not list its medication names");
        assert(panelA.includes(NAME_EPSILON), 'the panel does not list the deactivated medications');
        assert(await page.$('[data-medsync-choose="' + DEV_A + '"]'), "no way to choose this phone's list");
        assert(await page.$('[data-medsync-choose="' + DEV_B + '"]'), "no way to choose the other phone's list");
      });

      await rt('CONFIRM-wording', 'the confirm step names what will be used, what will be replaced, and that the replaced list is kept', async () => {
        await page.click('[data-medsync-choose="' + DEV_A + '"]');
        await page.waitForSelector('[data-medsync-confirm]', { timeout: 8000 });
        const t = await chooserText(page);
        assert(/Use this phone.s list on both phones\?/.test(t), 'the confirm heading does not name which list is being adopted');
        assert(/will be replaced/.test(t), 'the confirm step does not say the other list will be replaced');
        assert(/It is kept/.test(t), 'the confirm step does not say the replaced list is kept');
        assert(/switch back to it/.test(t), 'the confirm step does not say the replaced list can be brought back');
        assert(/Nothing you have already logged changes/.test(t), 'the confirm step does not reassure that logged data is untouched');
        assert(await page.$('[data-medsync-confirm-no]'), 'there is no way out of the confirm step');
      });

      await rt('CONFIRM-no-dead-controls', 'THE h() TRAP: nothing on the chooser renders a null-valued or disabled attribute', async () => {
        const attrs = await medsyncAttrDump(page);
        assert(Array.isArray(attrs) && attrs.length > 0, 'no attributes were dumped');
        const bad = attrs.filter(a => a.value === 'null' || a.value === 'undefined' || a.name === 'disabled');
        assert(bad.length === 0, 'dead or nullish attributes: ' + JSON.stringify(bad.slice(0, 4)));
      });

      await rt('TAP-chooser-buttons-44', 'every button on the chooser is at least 44px tall — MEASURED', async () => {
        const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('main button')).map((b) => {
          const r = b.getBoundingClientRect();
          return { label: (b.textContent || '').trim().slice(0, 34), w: r.width, h: r.height };
        }).filter(b => b.w > 0));
        assert(boxes.length >= 3, 'expected several buttons on the chooser, found ' + boxes.length);
        const worst = boxes.slice().sort((x, y) => x.h - y.h)[0];
        MEASURED.push('[' + vp.name + '] ' + boxes.length + ' chooser buttons measured; shortest "' + worst.label + '" ' + worst.h.toFixed(2) + 'px');
        for (const b of boxes) assertGte(b.h, 44, 'chooser button "' + b.label + '" height');
      });

      await rt('CANCEL-changes-nothing', '"Not yet" closes the confirm step and writes nothing', async () => {
        await resetAudit(page);
        await page.click('[data-medsync-confirm-no]');
        await page.waitForFunction(() => !document.querySelector('[data-medsync-confirm]'), null, { timeout: 6000 });
        const audit = await writeAudit(page);
        assert(audit.prefsWrites.length === 0 && audit.entryWrites.length === 0, 'backing out of the confirm step wrote something: ' + JSON.stringify(audit.allSetDoc));
      });

      await rt('CHOOSE-writes-only-prefs', 'confirming writes the shared list onto the prefs document and nothing to caretracker_entries', async () => {
        await resetAudit(page);
        await page.click('[data-medsync-choose="' + DEV_A + '"]');
        await page.waitForSelector('[data-medsync-confirm]', { timeout: 8000 });
        await page.click('[data-medsync-confirm-yes]');
        await page.waitForSelector('[data-medsync-card="shared"]', { timeout: 10000 });
        const audit = await writeAudit(page);
        assert(audit.entryWrites.length === 0, 'the choice wrote to the append-only entries collection: ' + JSON.stringify(audit.entryWrites));
        const shared = audit.prefsWrites.filter(w => w.data.medConfigJson);
        assert(shared.length === 1, 'expected exactly one shared-list write, got ' + shared.length);
        assert(shared[0].merge === true, 'the shared-list write is not a merged write');
        assert(typeof shared[0].data.medConfigJson === 'string', 'the shared list is not stored as a string');
        assert(audit.allSetDoc.every(w => w.col === 'caretracker_prefs'), 'a write went to a collection other than caretracker_prefs: ' + JSON.stringify(audit.allSetDoc));
      });

      await rt('CHOOSE-freezes-candidates', "the phones' original lists are frozen, not overwritten, once a choice exists", async () => {
        const p = await readPrefsDoc(page);
        assert(p.medConfigDevices[DEV_A].json === prefsAfterB.medConfigDevices[DEV_A].json, "device A's original candidate was rewritten after the choice");
        assert(p.medConfigDevices[DEV_B].json === prefsAfterB.medConfigDevices[DEV_B].json, "device B's original candidate was rewritten after the choice");
      });

      await rt('CHOOSE-backs-up-locally', 'the choosing phone keeps its own pre-share list in local storage, written once', async () => {
        const raw = await page.evaluate((k) => localStorage.getItem(k), PRECHOICE_KEY);
        assert(raw, 'no pre-share snapshot was written on the choosing phone');
        const parsed = JSON.parse(raw);
        assert(typeof parsed.config === 'string', 'the snapshot does not hold a config');
        assert(parsed.config.includes(NAME_ETA), "the snapshot does not hold this phone's own list");
      });

      prefsAfterChoice = await readPrefsDoc(page);
      await rt('CHOOSE-console-clean', 'no uncaught exceptions through the whole choice', async () => {
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
      });
    } finally { await context.close(); }
  }

  // ---------- hop 4: device B picks the choice up ----------
  let prefsAfterEdit = null;
  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterChoice, local: localFor(CFG_B, DEV_B),
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36'
    });
    try {
      await rt('CONVERGE-dose-timing', 'THE FIX: the other phone now reads the SAME dose the same way — "Next dose at ...", not "Available now"', async () => {
        const c = await cardFor(page, NAME_ALPHA);
        assert(c.waiting && !c.available, 'the two phones still disagree about this dose after the choice was made');
      });

      await rt('CONVERGE-rolling-path', 'the always-unlocked rolling-window path is gone from the phone that had it', async () => {
        const c = await cardFor(page, NAME_DELTA);
        assert(c.waiting && !c.available, 'the rolling-window medication is still unconditionally Available on the second phone');
      });

      await rt('CONVERGE-active-list', "the second phone's active medication list is now the chosen one", async () => {
        await goMeds(page);
        const names = await medNames(page);
        assert(names && names.length, 'the medication list could not be read');
        assert(names.includes(NAME_BETA), 'a medication only the chosen phone had did not arrive');
        assert(names.includes(NAME_ETA), 'a medication only the chosen phone had did not arrive');
        assert(!names.includes(NAME_GAMMA), 'a medication only this phone had is still on the active list');
      });

      await rt('ARCHIVED-syncs', 'deactivated medications sync in BOTH directions, not just the active list', async () => {
        const names = await medNames(page);
        // Epsilon was deactivated on the chosen phone and active here: it must go.
        assert(!names.includes(NAME_EPSILON), 'a medication deactivated on the chosen phone is still active here — archivedMeds did not sync');
        // Zeta was deactivated HERE and active on the chosen phone: it must come back.
        assert(names.includes(NAME_ZETA), 'a medication deactivated on this phone did not come back — archivedMeds did not sync');
        const cached = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), MED_KEY));
        assert(cached.archivedMeds && cached.archivedMeds['zz-epsilon'], 'the shared archived map was not cached locally');
        assert(!cached.archivedMeds['zz-zeta'], "this phone's own archived entry was not cleared by the shared map");
        assert(cached.archivedMeds['zz-epsilon'].name === NAME_EPSILON, 'the archived NAME was lost — restored dose history would print a bare id in a document handed to an oncologist');
      });

      await rt('RECOVER-firestore', 'the list that was NOT chosen is still on the chooser, with a button, and still says what it always said', async () => {
        await openChooser(page);
        const panel = await page.$('[data-medsync-panel="' + DEV_B + '"]');
        assert(panel, "the non-chosen phone's original list is no longer shown");
        const n = Number(await page.getAttribute('[data-medsync-panel="' + DEV_B + '"] [data-medsync-count]', 'data-medsync-count'));
        const chosenN = Number(await page.getAttribute('[data-medsync-panel="' + DEV_A + '"] [data-medsync-count]', 'data-medsync-count'));
        assert(n !== chosenN, 'the non-chosen list has been overwritten with the chosen one');
        assert(await page.$('[data-medsync-choose="' + DEV_B + '"]'), 'the non-chosen list cannot be switched back to');
        const t = await chooserText(page);
        assert(t.includes('Saved before sharing'), 'the frozen lists are not labelled as pre-share snapshots');
        assert(t.includes(NAME_GAMMA), "the non-chosen list no longer contains the medication only that phone had");
        // The document itself, not just what the screen happens to be showing: BOTH pre-share
        // candidates must still be byte-identical to what they were before the choice.
        const doc = await readPrefsDoc(page);
        assert(doc.medConfigDevices[DEV_B].json === prefsAfterB.medConfigDevices[DEV_B].json,
          "the non-chosen phone's frozen candidate was rewritten after the choice — it can no longer be recovered");
        assert(doc.medConfigDevices[DEV_A].json === prefsAfterB.medConfigDevices[DEV_A].json,
          "the chosen phone's frozen candidate was rewritten after the choice");
      });

      await rt('RECOVER-local', "the phone's own pre-share list is in its own storage too, independent of the network", async () => {
        const raw = await page.evaluate((k) => localStorage.getItem(k), PRECHOICE_KEY);
        assert(raw, 'no pre-share snapshot on this phone');
        const cfg = JSON.parse(JSON.parse(raw).config);
        const ids = cfg.meds.map(m => m.id);
        assert(ids.includes('zz-gamma'), "the snapshot is not this phone's own pre-share list");
        assert(!ids.includes('zz-eta'), 'the snapshot was taken after adoption, not before it');
      });

      await rt('RECOVER-is-one-tap', 'switching back to the other list is the same confirmed choice, and it writes the shared field again', async () => {
        await resetAudit(page);
        const snapshotBefore = await page.evaluate((k) => localStorage.getItem(k), PRECHOICE_KEY);
        await page.click('[data-medsync-choose="' + DEV_B + '"]');
        await page.waitForSelector('[data-medsync-confirm]', { timeout: 8000 });
        await page.click('[data-medsync-confirm-yes]');
        await page.waitForSelector('[data-medsync-card="shared"]', { timeout: 10000 });
        const names = await medNames(page);
        assert(names.includes(NAME_GAMMA), 'switching back did not restore the other list');
        const audit = await writeAudit(page);
        assert(audit.entryWrites.length === 0, 'switching back wrote to the entries collection');
        // Written once, never overwritten: a SECOND adoption must not rewrite the pre-share
        // snapshot with whatever this phone happened to be holding at the time.
        const snapshotAfter = await page.evaluate((k) => localStorage.getItem(k), PRECHOICE_KEY);
        assert(snapshotAfter === snapshotBefore, 'the pre-share snapshot was rewritten by a second adoption — the original is gone');
      });

      await rt('CONVERGE-console-clean', 'no uncaught exceptions on the adopting phone', async () => {
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
      });
    } finally { await context.close(); }
  }

  // ---------- hop 5: a later edit on one phone must reach the other ----------
  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterChoice, local: localFor(CFG_B, DEV_B),
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36'
    });
    try {
      await rt('EDIT-propagates', 'a later edit on this phone is written to the SHARED list, not just to this phone', async () => {
        await goMeds(page);
        await resetAudit(page);
        // Removing a medication is the shortest real edit that goes through
        // persistMedicationConfig() and changes BOTH meds and archivedMeds.
        const idx = await page.evaluate((name) => {
          const root = document.querySelector('[data-tour-meds]');
          const cards = Array.from(root.children);
          return cards.findIndex((c) => { const n = c.querySelector(':scope > div > div > div'); return n && n.textContent.trim() === name; });
        }, NAME_BETA);
        assert(idx >= 0, 'the medication to remove is not on the list');
        await page.evaluate((i) => {
          const root = document.querySelector('[data-tour-meds]');
          const btns = root.children[i].querySelectorAll('button');
          btns[btns.length - 1].click();
        }, idx);
        await page.waitForTimeout(150);
        await page.evaluate((i) => {
          const root = document.querySelector('[data-tour-meds]');
          const btns = root.children[i].querySelectorAll('button');
          for (const b of btns) if ((b.textContent || '').indexOf('Confirm delete') >= 0) { b.click(); return; }
        }, idx);
        await page.waitForFunction((name) => {
          const root = document.querySelector('[data-tour-meds]');
          if (!root) return false;
          return !Array.from(root.children).some((c) => { const n = c.querySelector(':scope > div > div > div'); return n && n.textContent.trim() === name; });
        }, NAME_BETA, { timeout: 8000 });
        const audit = await writeAudit(page);
        assert(audit.entryWrites.length === 0, 'the edit wrote to the append-only entries collection');
        const shared = audit.prefsWrites.filter(w => w.data.medConfigJson);
        assert(shared.length >= 1, 'the edit was not published to the shared list — the two phones can diverge again');
        const cfg = JSON.parse(shared[shared.length - 1].data.medConfigJson);
        assert(!cfg.meds.some(m => m.id === 'zz-beta'), 'the published shared list still contains the removed medication');
        assert(cfg.archivedMeds && cfg.archivedMeds['zz-beta'], 'the removal was not published into the shared archived map');
        prefsAfterEdit = await readPrefsDoc(page);
      });
    } finally { await context.close(); }
  }

  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterEdit, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('EDIT-lands-on-other-phone', 'the other phone shows the edit without anybody choosing anything again', async () => {
        await goMeds(page);
        const names = await medNames(page);
        assert(!names.includes(NAME_BETA), 'the medication removed on the other phone is still on this one');
        assert(names.includes(NAME_ETA), 'the rest of the shared list did not survive the edit');
        const kind = await page.getAttribute('[data-medsync-card]', 'data-medsync-card');
        assert(kind === 'shared', 'the phone no longer reports the settings as shared');
      });
      await rt('EDIT-no-second-choice', 'adopting an edit asks for no confirmation and writes nothing back', async () => {
        assert((await page.$('[data-medsync-confirm]')) === null, 'adopting an edit put a confirmation in the way');
        const audit = await writeAudit(page);
        assert(audit.prefsWrites.filter(w => w.data.medConfigJson).length === 0, 'adopting an edit published it straight back — that is a write loop');
        assert(audit.entryWrites.length === 0, 'adopting an edit wrote to the entries collection');
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
      });
    } finally { await context.close(); }
  }

  // ---------- the medication editor must not be clobbered by an incoming shared list ----------
  {
    const { context, page, pageErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterChoice, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('EDITOR-not-clobbered', 'a shared list arriving while the medication editor is open does not destroy what is being typed', async () => {
        await goMeds(page);
        const opened = await page.evaluate((name) => {
          const root = document.querySelector('[data-tour-meds]');
          const card = Array.from(root.children).find((c) => { const n = c.querySelector(':scope > div > div > div'); return n && n.textContent.trim() === name; });
          if (!card) return false;
          card.querySelectorAll('button')[0].click();
          return true;
        }, NAME_ETA);
        assert(opened, 'the medication to edit was not found');
        await page.waitForSelector('main input', { timeout: 8000 });
        await page.fill('main input', 'Half typed name');
        const changed = JSON.parse(prefsAfterChoice.medConfigJson);
        changed.meds = changed.meds.filter(m => m.id !== 'zz-zeta');
        await page.evaluate((j) => globalThis.__medsyncStub.push({ medConfigJson: j, medConfigSetAt: Date.now(), medConfigSetBy: 'Other phone' }), JSON.stringify(changed));
        await page.waitForTimeout(500);
        const v = await page.inputValue('main input');
        assert(v === 'Half typed name', 'the half-typed medication name was destroyed by an incoming shared list; found "' + v + '"');
        // The definition of the deferral: the list the edit is being computed against must not
        // change underneath an open editor. The removed medication is still there until it closes.
        const behind = await medNames(page);
        assert(behind.includes(NAME_ZETA), 'the medication list changed underneath the open editor — the incoming shared list was applied mid-edit');
      });

      await rt('EDITOR-applies-on-close', 'the deferred shared list is applied the moment the editor closes', async () => {
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('main button'));
          const cancel = btns.find(b => /Cancel/i.test(b.textContent || ''));
          if (cancel) cancel.click();
        });
        await page.waitForFunction((name) => {
          const root = document.querySelector('[data-tour-meds]');
          if (!root) return false;
          return !Array.from(root.children).some((c) => { const n = c.querySelector(':scope > div > div > div'); return n && n.textContent.trim() === name; });
        }, NAME_ZETA, { timeout: 8000 });
        assert(pageErrors.length === 0, 'uncaught: ' + pageErrors.join(' | '));
      });
    } finally { await context.close(); }
  }

  // ---------- the menu version label ----------
  {
    const { context, page } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsAfterChoice, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('VERSION-in-menu', 'the build number is visible in the menu footer and matches the constant in the file', async () => {
        await page.click('[data-cal-menu-button]');
        await page.waitForSelector('[data-app-version]', { timeout: 8000 });
        const shown = (await page.textContent('[data-app-version]')).trim();
        const m = /const APP_VERSION = '([^']+)';/.exec(fs.readFileSync(APP_FILE, 'utf-8'));
        assert(m, 'APP_VERSION not found in the file under test');
        assert(shown === 'CareTracker ' + m[1], 'the menu shows "' + shown + '" but the file says ' + m[1]);
      });
    } finally { await context.close(); }
  }
}

// =================================================================================================
// Offline — the app must keep working, on its own list, with nothing blocked
// =================================================================================================

async function runOfflineChecks(suite, browser, url, vp, net, prefsWithChoice) {
  const tag = '@offline';
  const rt = (id, desc, fn) => suite.run(id + tag, '[offline] ' + desc, fn);

  {
    const { context, page, pageErrors, consoleErrors } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: {}, prefsNever: true, writesFail: true, local: localFor(CFG_B, DEV_B)
    });
    try {
      await rt('OFFLINE-falls-back-to-local', 'with the shared list unreadable the phone runs on its own list and every screen works', async () => {
        const c = await cardFor(page, NAME_ALPHA);
        assert(c.available && !c.waiting, 'the phone is not using its own local list (its own gap is four hours and the dose was five hours ago)');
        await goMeds(page);
        const names = await medNames(page);
        assert(names.includes(NAME_GAMMA), "the phone's own medication list is not on screen");
      });

      await rt('OFFLINE-no-notice', 'nothing nags about sharing when there is no way to act on it', async () => {
        assert((await page.$('[data-medsync-card]')) === null, 'a sharing notice is shown on a phone that cannot reach the shared document');
      });

      await rt('OFFLINE-dosing-not-blocked', 'logging a dose still goes straight out, and the failure is not swallowed into a hang', async () => {
        await goHome(page);
        await resetAudit(page);
        const clicked = await page.evaluate((name) => {
          const sec = document.querySelector('[data-tour-quicklog]');
          const grid = sec && sec.children[1];
          if (!grid) return false;
          const card = Array.from(grid.children).find((c) => { const n = c.querySelector(':scope > div > div > div'); return n && n.textContent.trim() === name; });
          if (!card) return false;
          const b = Array.from(card.querySelectorAll('button')).find(x => /1 pill/.test(x.textContent || ''));
          if (!b) return false;
          b.click();
          return true;
        }, NAME_ALPHA);
        assert(clicked, 'the dose button could not be reached offline');
        // logMed() opens the time confirmation modal; the write happens on Confirm.
        await page.waitForTimeout(250);
        const confirmed = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent || '').trim() === 'Confirm');
          if (!b) return false;
          b.click();
          return true;
        });
        assert(confirmed, 'the dose time confirmation could not be reached offline');
        await page.waitForTimeout(500);
        const audit = await writeAudit(page);
        assert(audit.entryWrites.length === 1, 'expected exactly one attempted dose write, got ' + audit.entryWrites.length);
        assert(audit.entryWrites[0].col === 'caretracker_entries', 'the dose did not go to the entries collection');
      });

      await rt('OFFLINE-no-errors', 'no uncaught page error offline beyond the base build\'s own dose-write rejection', async () => {
        // The one uncaught rejection an offline phone produces belongs to the BASE build:
        // confirmTimeAndLog() does `await addEntryDB(entry)` with no catch, so a refused dose write
        // is an unhandled rejection and the patient is told nothing at all. Reproduced identically
        // on the unpatched v45 build. It is pre-existing, it is not what this patch is for, and
        // FILE-dose-write-path-untouched proves this patch neither introduced nor moved it.
        const own = pageErrors.filter(e => !/offline: (write|delete) rejected/.test(e));
        assert(own.length === 0, 'uncaught: ' + own.join(' | '));
        assert(consoleErrors.length === 0, 'console errors: ' + consoleErrors.join(' | '));
      });
    } finally { await context.close(); }
  }

  // A phone that CAN read the shared document but cannot write: choosing must change nothing.
  {
    const { context, page } = await newPage(browser, url, vp, net, {
      entries: baseEntries(), prefs: prefsWithChoice.beforeChoice, writesFail: true, local: localFor(CFG_A, DEV_A)
    });
    try {
      await rt('OFFLINE-failed-choice-changes-nothing', 'if the choice cannot be saved, nothing on either phone is changed', async () => {
        await openChooser(page);
        await page.click('[data-medsync-choose="' + DEV_B + '"]');
        await page.waitForSelector('[data-medsync-confirm]', { timeout: 8000 });
        await page.click('[data-medsync-confirm-yes]');
        await page.waitForTimeout(600);
        const p = await readPrefsDoc(page);
        assert(!p.medConfigJson, 'the shared field was set despite the write failing');
        await goMeds(page);
        const names = await medNames(page);
        assert(names.includes(NAME_ETA), "this phone's own list was replaced even though the write failed");
        assert(!names.includes(NAME_GAMMA), "the other phone's list was adopted even though the write failed");
      });
    } finally { await context.close(); }
  }
}

async function runNetworkChecks(suite, net) {
  await suite.run('NET-1-no-real-firestore', 'the only requests ALLOWED out were loopback; every external one was refused', () => {
    const escaped = net.allowed.filter(u => !u.startsWith('http://127.0.0.1:'));
    assert(escaped.length === 0, 'requests were allowed out to: ' + [...new Set(escaped)].join(', '));
    const dangerous = [...net.allowed, ...net.blocked].filter(u => /firestore|firebaseio|googleapis\.com\/v1|identitytoolkit/.test(u));
    const reached = dangerous.filter(u => net.allowed.includes(u));
    assert(reached.length === 0, 'a Firestore/identity host was reached: ' + reached.join(', '));
    for (const u of Object.keys(GSTATIC)) assert(net.stubHits.has(u), 'stub was never loaded (the real module may have been used): ' + u);
    assert(net.blocked.every(u => !u.startsWith('http://127.0.0.1:')), 'a loopback request was refused');
  });
  await suite.run('NET-2-no-service-worker', 'the service worker was never requested or registered', () => {
    assert(net.swRequested === false, 'sw.js was requested — the cache-first worker must stay out of the harness');
  });
}

// =================================================================================================
// Mutators — each breaks exactly one guarded property; --falsify proves the named checks go RED.
// =================================================================================================

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('mutator anchor not found: ' + from.slice(0, 110));
  if (html.split(from).length > 2) throw new Error('mutator anchor is ambiguous: ' + from.slice(0, 110));
  return html.replace(from, to);
}

const MUTATORS = [
  {
    name: 'auto-merge-newest-wins',
    why: 'THE FORBIDDEN SHORTCUT: adopt whichever candidate is newest, with nobody choosing. On a chemotherapy app that silently overwrites the correct list with the damaged one.',
    expect: ['BOOT-no-shared-field'],
    apply: (h) => must(h, '  medsyncPublishCandidate(devices, sharedJson);\n}',
      "  medsyncPublishCandidate(devices, sharedJson);\n  const auto = Object.keys(devices).map(function (k) { return devices[k]; }).sort(function (a, b) { return b.at - a.at; })[0];\n  if (!sharedJson && auto) { const p = {}; p[MEDSYNC_SHARED_FIELD] = auto.json; medsyncWritePrefs(p); }\n}")
  },
  {
    name: 'candidate-stored-as-object',
    why: 'stores the list as a nested map instead of a string, so Firestore DEEP-MERGES it and a removed medication is never removed on the other phone',
    expect: ['BOOT-publishes-candidate'],
    apply: (h) => must(h, 'entry[id] = { label: medsyncDeviceLabel(), json: json, at: Date.now(), frozen: !!frozen, app: APP_VERSION };',
      'entry[id] = { label: medsyncDeviceLabel(), json: JSON.parse(json), at: Date.now(), frozen: !!frozen, app: APP_VERSION };')
  },
  {
    name: 'archived-not-synced',
    why: 'syncs only the active list and drops archivedMeds — Aaron reported the deactivated medications differ between the phones too',
    expect: ['ARCHIVED-syncs'],
    apply: (h) => must(h, '  const archivedMeds = normalizeArchivedMeds(cfg.archivedMeds);\n  // mergeMissingDefaultMeds is kept',
      '  const archivedMeds = normalizeArchivedMeds(state.archivedMeds);\n  // mergeMissingDefaultMeds is kept')
  },
  {
    name: 'candidate-overwritten-after-choice',
    why: "unfreezes the device snapshots — each phone's candidate is refreshed to the list it just adopted, so the list that was not chosen is destroyed and can never be recovered",
    expect: ['RECOVER-firestore'],
    apply: (h) => must(h, '  medsyncCacheLocal(meds, archivedMeds);\n  medsyncAppliedJson = json;',
      '  medsyncCacheLocal(meds, archivedMeds);\n  medsyncAppliedJson = json;\n  medsyncWriteCandidate(json, true);')
  },
  {
    name: 'backup-overwritten',
    why: 'lets the pre-share snapshot be rewritten, so the second adoption destroys the original',
    expect: ['FILE-snapshot-before-adopt', 'RECOVER-is-one-tap'],
    apply: (h) => must(h, '  if (medsyncLsGet(MEDSYNC_PRECHOICE_KEY)) return false;\n  return medsyncLsSet(MEDSYNC_PRECHOICE_KEY',
      '  return medsyncLsSet(MEDSYNC_PRECHOICE_KEY')
  },
  {
    name: 'no-backup-before-adopt',
    why: 'adopts a shared list without snapshotting what this phone had first',
    expect: ['FILE-snapshot-before-adopt', 'CHOOSE-backs-up-locally'],
    apply: (h) => must(h, 'function medsyncAdopt(cfg, json) {\n  medsyncBackupLocalOnce();', 'function medsyncAdopt(cfg, json) {')
  },
  {
    name: 'edit-not-published',
    why: 'a later edit stays on the phone that made it — the two lists start drifting apart again from day two',
    expect: ['EDIT-propagates', 'EDIT-lands-on-other-phone'],
    apply: (h) => must(h, '  medsyncPublishLocalChange(meds, archivedMeds);\n}', '}')
  },
  {
    name: 'confirm-button-disabled-until-chosen',
    why: 'THE h() TRAP, in exactly the place the brief warns about: a confirm button carrying a nullish `disabled`. h() calls setAttribute, so disabled="null" is disabled forever.',
    expect: ['CONFIRM-no-dead-controls', 'FILE-no-disabled-attr'],
    apply: (h) => must(h, "h('button', { 'data-medsync-confirm-yes': 'true', type: 'button',",
      "h('button', { 'data-medsync-confirm-yes': 'true', type: 'button', disabled: confirm.json ? null : 'disabled',")
  },
  {
    name: 'dead-button-when-alone',
    why: 'renders the chooser button with nothing to choose instead of omitting it',
    expect: ['CARD-alone-has-no-button'],
    apply: (h) => must(h, "        'Each phone is keeping its own medication list, so the two can disagree about when a dose is due. Only this phone has checked in so far — open CareTracker on the other phone once, then come back here.')\n    );",
      "        'Each phone is keeping its own medication list, so the two can disagree about when a dose is due. Only this phone has checked in so far — open CareTracker on the other phone once, then come back here.'),\n      h('button', { 'data-medsync-open': 'true', type: 'button', onClick: medsyncGoChooser, style: Object.assign({}, MEDSYNC_BTN_STYLE, { marginTop: '11px' }) }, 'See what is different')\n    );")
  },
  {
    name: 'diff-hides-settings',
    why: 'shows only which medications differ and not WHICH SETTINGS — Aaron said he does not want to do manual matching',
    expect: ['DIFF-names-settings'],
    apply: (h) => must(h, '    const fields = medsyncFieldDiffs(a, b);\n    if (fields.length) out.changed.push({ id: id, name: a.name, fields: fields });',
      '    const fields = [];\n    if (fields.length) out.changed.push({ id: id, name: a.name, fields: fields });')
  },
  {
    name: 'diff-hides-archived',
    why: 'leaves deactivated medications out of the difference report',
    expect: ['DIFF-archived'],
    apply: (h) => must(h, "  Object.keys(aa).forEach(function (id) { if (!medsyncOwn(ab, id)) out.archivedOnlyA.push(String(aa[id].name || id)); });",
      "  Object.keys(aa).forEach(function (id) { if (false) out.archivedOnlyA.push(String(aa[id].name || id)); });")
  },
  {
    name: 'confirm-omits-what-is-replaced',
    why: 'drops the sentence naming the list that will be replaced and the fact that it is kept',
    expect: ['CONFIRM-wording'],
    apply: (h) => must(h, "      replacedLine + ' It is kept — saved on that phone and in your CareTracker records — and you can switch back to it from this screen.') : null,",
      "      '') : null,")
  },
  {
    name: 'panels-hide-the-names',
    why: 'shows a count and a button but not the medication names, so there is no way to tell which list is which',
    expect: ['PANELS-enough-to-choose-by'],
    apply: (h) => must(h, '    medsyncListLine(\'Medications\', info.names),\n    medsyncListLine(\'Deactivated\', info.archivedNames),',
      '    null,\n    null,')
  },
  {
    name: 'offline-blocks-on-prefs',
    why: 'makes the medication list wait for the shared document, so an offline phone shows nothing to dose from',
    expect: ['OFFLINE-falls-back-to-local'],
    apply: (h) => must(h, '  const medCards = state.meds.filter(m => m.quickLog', '  const medCards = (state.medsync && state.medsync.devices ? state.meds : []).filter(m => m.quickLog')
  },
  {
    name: 'offline-nags',
    why: 'shows the sharing notice on a phone that cannot reach the shared document',
    expect: ['OFFLINE-no-notice'],
    apply: (h) => must(h, '  const m = state.medsync || {};\n  if (!m.devices) return null;', '  const m = state.medsync || {};\n  if (false) return null;')
  },
  {
    name: 'failed-write-still-adopts',
    why: 'applies the choice locally even when saving it failed, so one phone silently moves and the other does not',
    expect: ['OFFLINE-failed-choice-changes-nothing'],
    apply: (h) => must(h, "      setToast('Could not save — check the connection and try again. Nothing was changed.');\n      return;",
      "      setToast('Could not save — check the connection and try again. Nothing was changed.');")
  },
  {
    name: 'adoption-publishes-back',
    why: 'republishes every adopted list, which is a write loop between the two phones',
    expect: ['EDIT-no-second-choice'],
    apply: (h) => must(h, '        const applied = medsyncAdopt(cfg, sharedJson);\n        patch.meds = applied.meds;',
      '        const applied = medsyncAdopt(cfg, sharedJson);\n        const echo = {}; echo[MEDSYNC_SHARED_FIELD] = medsyncConfigJson(applied.meds, applied.archivedMeds); medsyncWritePrefs(echo);\n        patch.meds = applied.meds;')
  },
  {
    name: 'editor-clobbered',
    why: 'applies an incoming shared list straight through the open medication editor, destroying what is being typed',
    expect: ['EDITOR-not-clobbered'],
    apply: (h) => must(h, '      if (state.medEditor) {\n        medsyncPendingShared = { cfg: cfg, json: sharedJson };\n      } else {', '      if (false) {\n      } else {')
  },
  {
    name: 'config-written-to-entries',
    why: 'puts the configuration into the APPEND-ONLY entries collection',
    expect: ['FILE-nothing-added-to-entries', 'CHOOSE-writes-only-prefs'],
    apply: (h) => must(h, '  medsyncWritePrefs(payload).then(function (ok) {\n    medsyncBusy = false;',
      "  addEntryDB({ medId: 'med_config', dose: json, mg: 0, ts: Date.now() });\n  medsyncWritePrefs(payload).then(function (ok) {\n    medsyncBusy = false;")
  },
  {
    name: 'new-collection',
    why: 'THE MISTAKE ALREADY MADE ON THIS PROJECT: a new collection, which the published rules do not match, so it fails silently on the live app and passes in every harness',
    expect: ['FILE-no-new-collection'],
    apply: (h) => must(h, "const MEDSYNC_SHARED_FIELD = 'medConfigJson';",
      "const MEDSYNC_SHARED_FIELD = 'medConfigJson';\nconst MEDSYNC_DOC = doc(db, 'caretracker_medconfig', 'shared');")
  },
  {
    name: 'plain-object-id-map',
    why: 'lesson from restore: a plain {} keyed by medication ids answers truthy for "constructor" even when EMPTY',
    expect: ['FILE-null-prototype-maps'],
    apply: (h) => must(h, 'function medsyncMedMap(cfg) {\n  const map = Object.create(null);', 'function medsyncMedMap(cfg) {\n  const map = {};')
  },
  {
    name: 'empty-shared-config-accepted',
    why: 'lets a truncated shared document wipe a phone\'s medication list',
    expect: ['FILE-empty-config-refused'],
    apply: (h) => must(h, '  if (!raw || typeof raw !== \'object\' || !Array.isArray(raw.meds) || !raw.meds.length) return null;',
      '  if (!raw || typeof raw !== \'object\' || !Array.isArray(raw.meds)) return null;')
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do (version-agnostic mutator: it reads whatever the file says and changes it)',
    expect: ['FILE-app-version'],
    apply: (h) => {
      const m = /const APP_VERSION = '([^']+)';/.exec(h);
      if (!m) throw new Error('mutator anchor not found: APP_VERSION declaration');
      return must(h, m[0], "const APP_VERSION = '" + m[1] + ".medsyncbump';");
    }
  },
  {
    name: 'version-label-hardcoded',
    why: 'writes the build number into the UI as a literal, so the menu lies the next time the version changes',
    expect: ['FILE-version-label-derived', 'VERSION-in-menu'],
    apply: (h) => {
      const m = /const APP_VERSION = '([^']+)';/.exec(h);
      if (!m) throw new Error('mutator anchor not found: APP_VERSION declaration');
      return must(h, "'CareTracker ' + APP_VERSION)", "'CareTracker " + m[1] + "-stale')");
    }
  },
  {
    name: 'tick-guard-touched',
    why: 'edits the composed one-second tick guard, which belongs to four earlier patches',
    expect: ['FILE-tick-guard-untouched'],
    apply: (h) => must(h, 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();',
      'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !state.medsync.confirm && !isEditing) render();')
  },
  {
    name: 'hardcoded-med-name',
    why: 'hardcodes a real medication name into the shared-settings module',
    expect: ['FILE-no-hardcoded-med-names'],
    apply: (h) => must(h, "  if (/iPad/i.test(ua)) return 'iPad';", "  if (ua === 'Morphine') return 'Morphine';\n  if (/iPad/i.test(ua)) return 'iPad';")
  },
  {
    name: 'tap-targets-shrunk',
    why: 'drops the chooser buttons below the 44px floor — MEASURED at both phone widths, not eyeballed',
    expect: ['TAP-chooser-buttons-44'],
    apply: (h) => must(h, "const MEDSYNC_BTN_STYLE = { width: '100%', minHeight: '48px'", "const MEDSYNC_BTN_STYLE = { width: '100%', minHeight: '30px'")
  }
];

// =================================================================================================
// main
// =================================================================================================

function report(title, suite) {
  const failed = suite.failed();
  console.log('\n' + '='.repeat(100));
  console.log(title);
  console.log('='.repeat(100));
  for (const r of suite.results) console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + '  —  ' + r.desc + (r.ok ? '' : '\n          ' + r.err));
  console.log('-'.repeat(100));
  console.log('  ' + (suite.results.length - failed.length) + '/' + suite.results.length + ' checks passed');
  if (MEASURED.length && !MODE_FALSIFY) {
    console.log('\n  MEASURED (not eyeballed):');
    for (const m of MEASURED) console.log('    ' + m);
  }
  return failed;
}

// The offline "failed choice" check needs a prefs document that already has both candidates but no
// choice. Built once, from the real hop-2 output, and reused.
async function buildPreChoicePrefs(browser, url, vp, net) {
  let prefs = {};
  for (const [cfg, dev, ua] of [[CFG_A, DEV_A, null], [CFG_B, DEV_B, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Mobile Safari/537.36']]) {
    const { context, page } = await newPage(browser, url, vp, net, { entries: baseEntries(), prefs, local: localFor(cfg, dev), ua });
    try { prefs = await readPrefsDoc(page); } finally { await context.close(); }
  }
  return prefs;
}

async function runSuite(browser, html) {
  const suite = new Suite();
  const net = makeNetLog();
  const server = await startServer(() => html);
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  try {
    await runFileChecks(suite, html);
    for (const vp of VIEWPORTS) {
      try { await runRuntimeChecks(suite, browser, url, vp, net); }
      catch (err) { await suite.run('RUNTIME-fatal@' + vp.name, 'the runtime sequence ran to completion', () => { throw err; }); }
    }
    let beforeChoice = {};
    try { beforeChoice = await buildPreChoicePrefs(browser, url, VIEWPORTS[0], net); } catch (e) { beforeChoice = {}; }
    try { await runOfflineChecks(suite, browser, url, VIEWPORTS[0], net, { beforeChoice }); }
    catch (err) { await suite.run('OFFLINE-fatal', 'the offline sequence ran to completion', () => { throw err; }); }
    await runNetworkChecks(suite, net);
  } finally {
    await new Promise(r => server.close(r));
  }
  return suite;
}

async function main() {
  const html = fs.readFileSync(APP_FILE, 'utf-8');
  console.log('medsync-test.mjs');
  console.log('  app file : ' + APP_FILE + '  (md5 ' + md5(html) + ')');
  console.log('  base file: ' + BASE_FILE + (BASE_HTML ? '  (md5 ' + md5(BASE_HTML) + ')' : '  MISSING'));
  console.log('  mode     : ' + (MODE_FALSIFY ? 'FALSIFY (each guard is broken in turn; the named check must go RED)' : 'VERIFY'));
  console.log('  viewports: ' + VIEWPORTS.map(v => v.w + 'x' + v.h).join(', '));

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let exit = 0;
  try {
    if (!MODE_FALSIFY) {
      const suite = await runSuite(browser, html);
      exit = report('VERIFY — patched build', suite).length ? 1 : 0;
    } else {
      const base = await runSuite(browser, html);
      const baseFailed = report('FALSIFY baseline — the unmutated build must be green', base);
      if (baseFailed.length) { console.log('\nBaseline is not green; falsification results would be meaningless.'); return 1; }

      const rows = [];
      const chosen = BATCH ? MUTATORS.slice(BATCH[0], BATCH[1]) : MUTATORS;
      for (const m of chosen) {
        let mutated;
        try { mutated = m.apply(html); } catch (err) { rows.push({ m, ok: false, note: 'mutator failed to apply: ' + err.message }); continue; }
        if (mutated === html) { rows.push({ m, ok: false, note: 'mutator changed nothing' }); continue; }
        if (process.env.DUMP_MUTANTS) fs.writeFileSync('/tmp/medsync-mutant-' + m.name + '.html', mutated);
        const s = await runSuite(browser, mutated);
        const failedIds = s.failed().map(r => r.id);
        const missing = m.expect.filter(e => !failedIds.some(id => id === e || id.startsWith(e + '@')));
        rows.push({ m, ok: missing.length === 0, failedIds, missing });
      }
      console.log('\n' + '='.repeat(100));
      console.log('FALSIFICATION — break it, confirm RED, restore');
      console.log('='.repeat(100));
      for (const r of rows) {
        console.log((r.ok ? '  RED (good)  ' : '  NOT RED     ') + r.m.name);
        console.log('               ' + r.m.why);
        console.log('               expected to fail: ' + r.m.expect.join(', '));
        if (r.note) console.log('               ' + r.note);
        else console.log('               actually failed: ' + (r.failedIds.length ? r.failedIds.join(', ') : '(nothing — the check does not work)'));
        if (!r.ok && r.missing && r.missing.length) console.log('               DID NOT GO RED: ' + r.missing.join(', '));
      }
      const bad = rows.filter(r => !r.ok);
      console.log('-'.repeat(100));
      console.log('  ' + (rows.length - bad.length) + '/' + rows.length + ' guards proved falsifiable' + (BATCH ? '  (batch ' + BATCH.join('-') + ' of ' + MUTATORS.length + ')' : ''));
      exit = bad.length ? 1 : 0;
    }
  } finally {
    await browser.close();
  }
  return exit;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
