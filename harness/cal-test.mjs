#!/usr/bin/env node
/**
 * cal-test.mjs — verification suite for the care-tracker Calendar patch.
 *
 * SAFETY (non-negotiable, this app holds one cancer patient's real medication history):
 *   * ALL THREE gstatic Firebase modules are stubbed. Nothing this suite runs can reach the real
 *     Firestore project. A catch-all route aborts every request that is not 127.0.0.1 or one of
 *     the three stubs, and check NET-1 fails the run if anything tried.
 *   * The service worker is removed from the page before any script runs (sw.js is cache-first and
 *     would serve a stale build between runs). NET-2 fails the run if sw.js was ever requested.
 *   * Fixtures only. No credentials, no network, no writes anywhere but the in-memory stub.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
 *     node cal-test.mjs                 # verify the patched build (all checks must pass)
 *   ... node cal-test.mjs --falsify     # break each guarded thing in turn, prove the check goes RED
 *   ... node cal-test.mjs --file <path> # verify a different patched index.html
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback. The suite refuses to start
 * otherwise rather than producing a confusing failure.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Playwright's location is environment-specific: the old sandbox kept it under a user-global npm
// prefix, this one ships it alongside node. Resolving a LIST of candidates instead of one pinned
// absolute path is what lets the same suite run in both. The pinned path made all 39 browser
// suites in these three repos unrunnable the moment the environment changed -- a gate that cannot
// start is indistinguishable from a gate that passes, which is the failure Rule 5 is about.
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright',
    '/home/claude/.npm-global/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found; tried:\n  ' + tries.join('\n  '));
})();

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Was hardcoded to /home/claude/wm, a sandbox directory destroyed by a rollback, so this check
// could never pass again on a fresh clone. Derived from the suite's own location instead.
const REPO_DIR = path.resolve(HERE, '..');
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const FILE_ARG = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : null; })();
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
const APP_FILE = FILE_ARG || path.join(HERE, 'work', 'index.html');
// Read once at module scope. The drawer-item count below needs the source, and reaching for the
// `html` local inside main() put a ReferenceError INSIDE the assert -- so the gate went from
// "pinned to a stale 6" to "throws before it measures anything", which is the same dead check
// wearing a different hat. It reported a plausible-looking red either way.
const APP_SRC = fs.existsSync(APP_FILE) ? fs.readFileSync(APP_FILE, 'utf-8') : '';
const ALL_VIEWPORTS = [{ w: 375, h: 812, name: 'iPhone-375x812' }, { w: 390, h: 844, name: 'iPhone-390x844' }];
// Falsification proves the CHECK works, not the layout; it runs on the narrowest phone only so a
// 14-mutator sweep finishes in one sitting. Verification always runs both.
const VIEWPORTS = MODE_FALSIFY ? [ALL_VIEWPORTS[0]] : ALL_VIEWPORTS;
const BATCH = (() => { const i = argv.indexOf('--batch'); return i >= 0 ? argv[i + 1].split('-').map(Number) : null; })();

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the');
    console.error('proxy and every check would fail for the wrong reason. Re-run under:');
    console.error('  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node cal-test.mjs');
    process.exit(3);
  }
}

// =================================================================================================
// Firebase stubs. Three ES modules, served in place of the three gstatic URLs.
// =================================================================================================

const STUB_APP = `
export function initializeApp(cfg) { return { name: '[DEFAULT]', options: cfg }; }
`;

const STUB_MESSAGING = `
export function getMessaging() { throw new Error('messaging disabled in the test harness'); }
export async function getToken() { return null; }
export function onMessage() { return () => {}; }
`;

// A Firestore good enough for this app's exact surface: one collection listened to with
// onSnapshot(query(col, orderBy('ts'))), one prefs document, addDoc / deleteDoc / setDoc.
// Every write is recorded so the suite can assert what the app actually sent.
const STUB_FIRESTORE = `
const fx = (globalThis.__CAL_FIXTURE__ || { entries: [], prefs: {} });
const store = { entries: fx.entries.slice(), prefs: Object.assign({}, fx.prefs) };
const entryListeners = [];
const prefsListeners = [];
let autoId = 0;

const rec = { addDoc: [], deleteDoc: [], setDoc: [], snapshots: 0 };
globalThis.__calStub = {
  rec,
  all() { return store.entries.slice(); },
  // Push a document straight through onSnapshot, the way a second device syncing would.
  push(d) { store.entries.push(Object.assign({ id: 'pushed-' + (++autoId) }, d)); emitEntries(); },
  reset() { rec.addDoc.length = 0; rec.deleteDoc.length = 0; rec.setDoc.length = 0; }
};

function snapOf(list) {
  return { docs: list.map(e => ({ id: e.id, data: () => { const c = Object.assign({}, e); delete c.id; return c; } })) };
}
function emitEntries() {
  const sorted = store.entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  rec.snapshots++;
  for (const cb of entryListeners) cb(snapOf(sorted));
}
function emitPrefs() {
  for (const cb of prefsListeners) cb({ exists: () => true, data: () => Object.assign({}, store.prefs) });
}

export function getFirestore() { return { __db: true }; }
export function collection(db, name) { return { __kind: 'col', name }; }
export function doc(db, colName, id) { return { __kind: 'doc', col: colName, id }; }
export function query(col) { return { __kind: 'query', col }; }
export function orderBy(field, dir) { return { field, dir }; }
export function onSnapshot(target, cb) {
  if (target && target.__kind === 'doc') { prefsListeners.push(cb); setTimeout(emitPrefs, 0); return () => {}; }
  entryListeners.push(cb);
  setTimeout(emitEntries, 0);
  return () => {};
}
export async function addDoc(col, data) {
  rec.addDoc.push({ col: col && col.name, data: JSON.parse(JSON.stringify(data)) });
  store.entries.push(Object.assign({ id: 'added-' + (++autoId) }, data));
  emitEntries();
  return { id: 'added-' + autoId };
}
export async function deleteDoc(ref) {
  rec.deleteDoc.push({ col: ref && ref.col, id: ref && ref.id });
  store.entries = store.entries.filter(e => e.id !== (ref && ref.id));
  emitEntries();
}
export async function setDoc(ref, data) {
  rec.setDoc.push({ col: ref && ref.col, id: ref && ref.id, data: JSON.parse(JSON.stringify(data)) });
  if (ref && ref.col === 'caretracker_prefs') { Object.assign(store.prefs, data); emitPrefs(); }
}
export async function getDocs() { return snapOf(store.entries); }
`;

const GSTATIC = {
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js': STUB_APP,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js': STUB_FIRESTORE,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js': STUB_MESSAGING
};

// =================================================================================================
// Fixtures
// =================================================================================================

function pad2(n) { return String(n).padStart(2, '0'); }
function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function atToday(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }

const TODAY_KEY = keyOf(new Date());
const T0 = Date.now();

// Appointment titles are distinctive strings so the export checks cannot pass by accident.
const FX = {
  APPT_NORMAL: 'Oncology review CALFIXTURE-A',
  APPT_EDITED_OLD: 'Bloods old CALFIXTURE-B-OLD',
  APPT_EDITED_NEW: 'Bloods CALFIXTURE-B',
  APPT_CANCELLED: 'Cancelled scan CALFIXTURE-C',
  APPT_PROTO_1: 'Proto trap constructor CALFIXTURE-D',
  APPT_PROTO_2: 'Proto trap proto CALFIXTURE-E',
  APPT_PROTO_3: 'Proto trap toString CALFIXTURE-F',
  APPT_LEGACY: 'Legacy no-apptId CALFIXTURE-G',
  APPT_BADTS: 'Broken date CALFIXTURE-H'
};

function appt(id, apptId, title, ts, loggedAt, extra) {
  return Object.assign({ id, medId: 'appointment', apptId, title, note: '', ts, cancelled: false, dose: 'Appointment', mg: 0, loggedAt }, extra || {});
}

function buildFixture() {
  const entries = [
    // Real dose/vital documents, so the CSV under test is not empty (an empty CSV would let the
    // "appointments are absent" check pass for the wrong reason).
    { id: 'e-tyl-1', medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: atToday(8, 0), loggedAt: atToday(8, 0) },
    { id: 'e-tyl-2', medId: 'tylenol', dose: '1000 mg', mg: 1000, pills: 2, ts: atToday(12, 0), loggedAt: atToday(12, 0) },
    { id: 'e-temp-1', medId: 'temp', temp: 99.4, dose: '99.4 °F', mg: 0, ts: atToday(9, 0), loggedAt: atToday(9, 0) },

    appt('a-normal', 'appt-fixture-normal', FX.APPT_NORMAL, atToday(14, 0), T0 - 9000, { note: 'Bring the pill diary' }),

    // Superseded pair: same apptId, the newer loggedAt must win and the older must vanish.
    appt('a-edit-v1', 'appt-fixture-edited', FX.APPT_EDITED_OLD, atToday(10, 0), T0 - 8000),
    appt('a-edit-v2', 'appt-fixture-edited', FX.APPT_EDITED_NEW, atToday(10, 30), T0 - 7000),

    // Tombstoned pair: must not render at all.
    appt('a-cancel-v1', 'appt-fixture-cancelled', FX.APPT_CANCELLED, atToday(16, 0), T0 - 6000),
    appt('a-cancel-v2', 'appt-fixture-cancelled', FX.APPT_CANCELLED, atToday(16, 0), T0 - 5000, { cancelled: true }),

    // Ids that are inherited properties of Object.prototype. On a plain-object lookup these are
    // truthy when empty, and '__proto__' is not even storable as an own key. All three must survive.
    appt('a-proto-1', 'constructor', FX.APPT_PROTO_1, atToday(8, 0), T0 - 4000),
    appt('a-proto-2', '__proto__', FX.APPT_PROTO_2, atToday(8, 15), T0 - 3900),
    appt('a-proto-3', 'toString', FX.APPT_PROTO_3, atToday(8, 30), T0 - 3800),

    // Written before apptId existed: identity falls back to the document id, still editable.
    { id: 'a-legacy', medId: 'appointment', title: FX.APPT_LEGACY, note: '', ts: atToday(17, 0), cancelled: false, dose: 'Appointment', mg: 0, loggedAt: T0 - 3000 },

    // Unusable date: dropped rather than guessed at.
    appt('a-badts', 'appt-fixture-badts', FX.APPT_BADTS, 0, T0 - 2000)
  ];
  return { entries, prefs: { missedClearedAt: 0 } };
}

// Appointments that must be visible on today, in time order.
const EXPECTED_TODAY = [FX.APPT_PROTO_1, FX.APPT_PROTO_2, FX.APPT_PROTO_3, FX.APPT_EDITED_NEW, FX.APPT_NORMAL, FX.APPT_LEGACY];
const EXPECTED_HIDDEN = [FX.APPT_EDITED_OLD, FX.APPT_CANCELLED, FX.APPT_BADTS];

// =================================================================================================
// Mutators — each one breaks exactly one guarded property. --falsify proves the named checks go RED.
// =================================================================================================

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('mutator anchor not found: ' + from.slice(0, 90));
  return html.replace(from, to);
}

const MUTATORS = [
  {
    name: 'day-cells-43.6px',
    why: 'restores the grid padding/gap that produced 43.57px day cells on a 375px phone',
    expect: ['TAP-day-cells'],
    apply: (h) => {
      h = must(h, "borderRadius: '18px', padding: '12px 0 10px' }", "borderRadius: '18px', padding: '12px 10px 10px' }");
      return must(h, "'data-cal-month-grid': 'true', role: 'grid', 'aria-label': monthLabel, style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px' }",
                     "'data-cal-month-grid': 'true', role: 'grid', 'aria-label': monthLabel, style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '3px' }");
    }
  },
  {
    name: 'note-field-14px',
    why: 'drops the note field to 14px — the size that makes iOS Safari zoom in and never back',
    expect: ['FONT-16px-inputs'],
    apply: (h) => must(h, "calFieldStyle({ minHeight: '84px', resize: 'vertical' })", "calFieldStyle({ minHeight: '84px', resize: 'vertical', fontSize: '14px' })")
  },
  {
    name: 'duplicate-test-hook',
    why: 'puts the same hook on all three calendar sections, the way data-cal-ui="calendar" was',
    expect: ['HOOK-unique-sections'],
    apply: (h) => must(must(h, "'data-cal-month-section': 'true'", "'data-cal-view-header': 'true'"), "'data-cal-day-panel': 'true'", "'data-cal-view-header': 'true'")
  },
  {
    name: 'plain-object-grouping',
    why: 'swaps the Map for a plain {} keyed by apptId — Object.prototype ids stop round-tripping',
    expect: ['PROTO-ids-survive'],
    apply: (h) => must(h, 'const byGroup = new Map();',
      "const byGroup = { _o: {}, get(k) { return this._o[k]; }, set(k, v) { this._o[k] = v; }, forEach(f) { for (const k of Object.keys(this._o)) f(this._o[k], k); } };")
  },
  {
    name: 'appointments-leak-into-export',
    why: 'adds appointments to allExportEntries() — they would reach the CSV and the oncologist report',
    expect: ['FILE-allExportEntries', 'EXPORT-csv-clean', 'EXPORT-report-clean'],
    apply: (h) => must(h, 'return (state.entries || []).concat(state.chemoDates || []);',
                          'return (state.entries || []).concat(state.chemoDates || []).concat(state.appointments || []);')
  },
  {
    name: 'h-null-attribute-trap',
    why: 'passes a conditional attribute as null — renders disabled="null", which disables the control',
    expect: ['TRAP-no-null-attributes', 'FILE-no-null-attr-literals'],
    apply: (h) => must(h, "          s.busy ? { disabled: 'disabled' } : {}), 'Cancel'),",
                          "          { disabled: s.busy ? 'disabled' : null }), 'Cancel'),")
  },
  {
    name: 'tick-repaints-under-sheet',
    why: 'removes the appointment sheet from the clock-tick guard',
    expect: ['TICK-sheet-survives'],
    apply: (h) => must(h, 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();',
                          'if (!state.timeModal && !isEditing) render();')
  },
  {
    name: 'tick-repaints-under-drawer',
    why: 'removes the drawer from the clock-tick guard',
    expect: ['TICK-drawer-survives'],
    apply: (h) => must(h, 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();',
                          'if (!state.timeModal && !state.apptSheet && !isEditing) render();')
  },
  {
    name: 'snapshot-destroys-sheet',
    why: 'removes the appointment sheet from the live-snapshot deferral',
    expect: ['SYNC-sheet-survives'],
    apply: (h) => must(h, 'if (state.timeModal || state.apptSheet) {', 'if (state.timeModal) {')
  },
  {
    name: 'edit-forgets-apptId',
    why: 'makes an edit mint a new apptId, so editing duplicates instead of superseding',
    expect: ['EDIT-supersedes'],
    apply: (h) => must(h, 'const apptId = s.apptId || calNewApptId();', 'const apptId = calNewApptId();')
  },
  {
    name: 'setState-in-onInput',
    why: 'calls setState from onInput, which rebuilds the tree and destroys the field being typed into',
    expect: ['FILE-no-setState-in-onInput', 'TYPE-note-survives'],
    apply: (h) => must(h, 'onInput: (e) => { if (state.apptSheet) state.apptSheet.note = e.target.value; }',
                          "onInput: (e) => { setState({ apptSheet: Object.assign({}, state.apptSheet, { note: e.target.value }) }); }")
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do',
    expect: ['FILE-app-version'],
    apply: (h) => must(h, "const APP_VERSION = 'v43.3';", "const APP_VERSION = 'v43.4';")
  },
  {
    name: 'title-validation-removed',
    why: 'lets a nameless appointment save, putting an unidentifiable row on the calendar',
    expect: ['VALIDATE-title-required'],
    apply: (h) => must(h, "  if (!title) { s.error =", "  if (false) { s.error =")
  },
  {
    name: 'delete-uses-deleteDoc',
    why: 'removes an appointment with a real delete, which Firestore rules refuse after 48 hours',
    expect: ['APPEND-only-no-deletes'],
    apply: (h) => must(h, "    await addEntryDB({ medId: CAL_APPT_MED_ID, apptId: apptId, title: String(appt.title || ''), note: String(appt.note || ''), ts: appt.ts, cancelled: true,",
                          "    await removeEntryDB(appt.id); if (false) await addEntryDB({ medId: CAL_APPT_MED_ID, apptId: apptId, title: String(appt.title || ''), note: String(appt.note || ''), ts: appt.ts, cancelled: true,")
  }
];

// =================================================================================================
// Runner plumbing
// =================================================================================================

class Suite {
  constructor() { this.results = []; }
  async run(id, desc, fn) {
    if (ONLY && !id.includes(ONLY)) return;
    try { await fn(); this.results.push({ id, desc, ok: true }); }
    catch (err) { this.results.push({ id, desc, ok: false, err: String(err && err.message || err) }); }
  }
  failed() { return this.results.filter(r => !r.ok); }
  ids() { return this.results.map(r => r.id); }
}

const MEASURED = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertGte(actual, min, msg) {
  assert(typeof actual === 'number' && actual >= min, msg + ' — measured ' + actual + ', floor ' + min);
}

function startServer(getHtml) {
  const server = http.createServer((req, res) => {
    const u = (req.url || '/').split('?')[0];
    if (u === '/' || u === '/index.html') {
      const body = getHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found: ' + u);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Everything the page tried to reach, and everything it was refused.
function makeNetLog() { return { stubHits: new Set(), blocked: [], swRequested: false }; }

async function newPage(browser, url, vp, net) {
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });

  await context.addInitScript(({ fixture }) => {
    // Remove the service worker entirely: sw.js is cache-first and would serve a stale build
    // across runs. Deleting it from the prototype makes `'serviceWorker' in navigator` false, so
    // the app's own guard skips registration rather than throwing.
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
    // The printable report opens a popup and calls print(), which never returns headless. The file
    // is still produced and downloaded — that is the branch under test.
    window.open = () => null;
    globalThis.__CAL_FIXTURE__ = fixture;
    // A clean slate every run: the medication list is device-local and must not leak between runs.
    try { localStorage.clear(); } catch (e) {}
  }, { fixture: buildFixture() });

  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  // ONE catch-all handler. Playwright resolves the most recently registered matching route first,
  // so a single handler with explicit dispatch removes any doubt about ordering.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (GSTATIC[url]) {
      net.stubHits.add(url);
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GSTATIC[url] });
    }
    if (/\/sw\.js(\?|$)/.test(url) || /firebase-messaging-sw\.js/.test(url)) {
      net.swRequested = true;
      return route.abort();
    }
    if (url.startsWith('http://127.0.0.1:')) return route.continue();
    // Fonts and anything else external: refused, and recorded.
    net.blocked.push(url);
    return route.abort();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('[data-cal-menu-button]'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting...'), null, { timeout: 15000 });
  return { context, page, consoleErrors, pageErrors };
}

async function openCalendar(page) {
  await page.click('[data-cal-menu-button]');
  await page.waitForSelector('[data-cal-drawer]');
  await page.click('[data-cal-drawer-item="calendar"]');
  await page.waitForSelector('[data-cal-month-grid]');
}

async function readDownload(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const p = await dl.path();
  return fs.readFileSync(p, 'utf-8');
}

// =================================================================================================
// The checks
// =================================================================================================

async function runFileChecks(suite, html) {
  const featureStart = html.indexOf('// CALENDAR & APPOINTMENTS  (ported from ChemoWell)');
  const featureEnd = html.indexOf('// EXPORT — CSV + printable report (v43)');
  const block = (featureStart >= 0 && featureEnd > featureStart) ? html.slice(featureStart, featureEnd) : '';

  await suite.run('FILE-app-version', 'APP_VERSION is declared exactly once and looks like a version', () => {
    // VERSION-AGNOSTIC. This asserted the literal 'v43.3' and so went red on every release after
    // v43.3 -- for no defect. pm.py has warned about it on every run since, and the PM counted it
    // among six red suites while noting five of those reds were stale rather than real. A gate that
    // cries on every release is a gate people learn to scroll past.
    // The intent was never the number: it was that the patch leaves APP_VERSION alone and does not
    // duplicate it. That is what is checked now.
    const decls = html.match(/const APP_VERSION = '[^']*';/g) || [];
    assert(decls.length === 1, 'APP_VERSION declared ' + decls.length + ' times, expected once');
    assert(/const APP_VERSION = 'v[0-9][0-9.]*';/.test(decls[0]), 'APP_VERSION is not a version string: ' + decls[0]);
  });

  await suite.run('FILE-allExportEntries', 'allExportEntries() still returns only entries + chemoDates', () => {
    assert(html.includes('return (state.entries || []).concat(state.chemoDates || []);'),
      'allExportEntries() body changed — appointments could reach the CSV and the report');
    assert(!/function allExportEntries\(\)[\s\S]{0,300}appointments/.test(html),
      'allExportEntries() mentions appointments');
  });

  await suite.run('FILE-feature-block-present', 'the feature block landed above the export block', () => {
    assert(featureStart > 0, 'calendar feature block not found');
    assert(featureEnd > featureStart, 'calendar block is not above the export block');
    assert(block.length > 8000, 'calendar block is suspiciously small: ' + block.length + ' chars');
  });

  await suite.run('FILE-no-null-attr-literals', 'no conditional attribute is passed as null (the h() trap)', () => {
    // Whole-line comments are stripped first. The trap is worth documenting in prose right next to
    // the code that avoids it, and a checker that cannot tell prose from code punishes exactly the
    // comment you want written. Only whole-line // comments go, so `https://` is untouched.
    const code = html.replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['disabled: null', 'checked: null', 'selected: null', 'readonly: null', 'hidden: null', "'aria-current': null", "'aria-pressed': null"]) {
      assert(!code.includes(bad), 'found the h() null-attribute trap: ' + bad);
    }
    // The literal form above is the easy half. In real code the trap almost always arrives as a
    // ternary -- `disabled: busy ? 'disabled' : null` -- which renders disabled="null" and disables
    // the control just as thoroughly. Both forms are rejected.
    const re = /\b'?(disabled|checked|selected|readonly|hidden|aria-current|aria-pressed|inert)'?\s*:\s*[^,}\n]*\b(null|undefined)\b/g;
    const hits = (code.match(re) || []).filter(s => !/:\s*(null|undefined)\s*(===|!==|==|!=)/.test(s));
    assert(hits.length === 0, 'a conditional attribute can evaluate to null/undefined and h() will setAttribute it: ' + hits.join(' | '));
  });

  await suite.run('FILE-no-setState-in-onInput', 'no onInput handler in the calendar block calls setState', () => {
    const handlers = block.match(/onInput:\s*\([^)]*\)\s*=>\s*\{[^}]*\}/g) || [];
    assert(handlers.length >= 3, 'expected at least 3 onInput handlers, found ' + handlers.length);
    for (const hnd of handlers) {
      assert(!hnd.includes('setState'), 'onInput calls setState (destroys the field being typed into): ' + hnd);
    }
  });

  await suite.run('FILE-16px-inputs-in-source', 'every field in the calendar block declares at least 16px', () => {
    const sizes = (block.match(/fontSize:\s*'(\d+(?:\.\d+)?)px'/g) || []);
    assert(block.includes("fontSize: '16px'"), 'the shared field style does not declare 16px');
    // Any font-size under 16px must not be attached to calFieldStyle (the only field styler).
    const badField = /calFieldStyle\(\{[^}]*fontSize:\s*'(?:[0-9]|1[0-5])(?:\.\d+)?px'/.test(block);
    assert(!badField, 'a field overrides the shared style with a size under 16px');
    assert(sizes.length > 0, 'no font sizes found in the block at all');
  });

  await suite.run('FILE-hooks-unique', 'every static data-cal-* hook appears exactly once in the source', () => {
    const statics = ['data-cal-menu-button', 'data-cal-drawer-overlay', 'data-cal-drawer\'', 'data-cal-drawer-close',
      'data-cal-view-header', 'data-cal-add-button', 'data-cal-month-section', 'data-cal-month-grid',
      'data-cal-month-label', 'data-cal-prev-month', 'data-cal-next-month', 'data-cal-weekday-row',
      'data-cal-day-panel\'', 'data-cal-day-panel-label', 'data-cal-day-add-button', 'data-cal-day-empty',
      'data-cal-sheet\'', 'data-cal-sheet-title-input', 'data-cal-sheet-when-input', 'data-cal-sheet-note-input',
      'data-cal-sheet-save', 'data-cal-sheet-cancel', 'data-cal-sheet-remove\'', 'data-cal-sheet-error'];
    for (const hook of statics) {
      const n = html.split(hook).length - 1;
      assert(n === 1, 'hook ' + hook + ' is emitted ' + n + ' times in the source, expected exactly 1');
    }
  });

  await suite.run('FILE-no-chemowell-storage', 'no ChemoWell localStorage key or collection is referenced', () => {
    // Comments are stripped first: the block header legitimately explains what ChemoWell did and
    // why care-tracker must not copy it. What matters is the code.
    const code = block.replace(/^\s*\/\/.*$/gm, '');
    const banned = ['chemowell', 'ChemoWell_', 'cw_appointments', 'cw-appointments', 'APPTS_KEY', 'loadAppointments', 'persistAppointments', 'cw_notes'];
    for (const b of banned) {
      assert(!code.toLowerCase().includes(b.toLowerCase()), 'the calendar block references ChemoWell storage: ' + b);
    }
    assert(!/localStorage\s*[.\[]/.test(code), 'the calendar block reads or writes localStorage; appointments belong in Firestore');
    assert(code.includes("const CAL_APPT_MED_ID = 'appointment';"), 'appointments are not stored as caretracker_entries documents');
  });

  await suite.run('FILE-no-placeholders', 'no TODO / FIXME / stub text in the calendar block', () => {
    // 'placeholder' is excluded deliberately: it is a real HTML attribute used on the fields.
    const code = block.replace(/placeholder:/g, '');
    for (const b of ['TODO', 'FIXME', 'XXX', 'HACK:', 'lorem ipsum', 'coming soon', 'not implemented', 'dummy', 'temporary hack']) {
      assert(!code.toLowerCase().includes(b.toLowerCase()), 'placeholder text in a production path: ' + b);
    }
  });

  await suite.run('FILE-grouping-uses-map', 'appointment grouping is keyed by a Map, never a plain object', () => {
    const fn = block.slice(block.indexOf('function calResolveAppointments'), block.indexOf('function calApptsByDay'));
    assert(fn.includes('new Map()'), 'calResolveAppointments does not use a Map');
    assert(!/=\s*\{\s*\}\s*;/.test(fn), 'calResolveAppointments contains a plain-object lookup');
    const byDay = block.slice(block.indexOf('function calApptsByDay'), block.indexOf('// ---- Menu drawer ----'));
    assert(byDay.includes('new Map()'), 'calApptsByDay does not use a Map');
  });

  await suite.run('FILE-patch-writes-one-file', 'the patch script writes index.html and nothing else', () => {
    const src = fs.readFileSync(path.join(HERE, 'calendar-patch.py'), 'utf-8');
    const writes = src.match(/open\([^)]*["']w["'][^)]*\)/g) || [];
    assert(writes.length === 1, 'expected exactly one write-open in the patch, found ' + writes.length);
    assert(/sw\.js/.test(src) === false || !/open\([^)]*sw\.js/.test(src), 'the patch opens sw.js');
  });

  await suite.run('FILE-sw-untouched', 'sw.js in the repo is byte-identical to the committed blob, whatever release that is', () => {
    const out = execSync('git -C ' + REPO_DIR + ' status --porcelain -- sw.js', { encoding: 'utf-8' }).trim();
    assert(out === '', 'sw.js is modified in the working tree: ' + out);
  });
}

async function runRuntimeChecks(suite, browser, url, vp, net) {
  const tag = '[' + vp.name + '] ';
  const { context, page, consoleErrors, pageErrors } = await newPage(browser, url, vp, net);
  try {
    // ---- header / drawer ----------------------------------------------------------------------
    await suite.run('TAP-menu-button' + '@' + vp.name, tag + 'header menu button is at least 44x44', async () => {
      const box = await page.locator('[data-cal-menu-button]').boundingBox();
      assert(box, 'menu button not found');
      assertGte(box.width, 44, tag + 'menu button width');
      assertGte(box.height, 44, tag + 'menu button height');
    });

    await suite.run('NAV-drawer-opens@' + vp.name, tag + 'the menu opens a drawer containing Calendar', async () => {
      await page.click('[data-cal-menu-button]');
      await page.waitForSelector('[data-cal-drawer]', { timeout: 5000 });
      const n = await page.locator('[data-cal-drawer-item="calendar"]').count();
      assert(n === 1, 'expected exactly one Calendar item, found ' + n);
      const expanded = await page.getAttribute('[data-cal-menu-button]', 'aria-expanded');
      assert(expanded === 'true', 'aria-expanded is ' + expanded);
    });

    await suite.run('TAP-drawer-items@' + vp.name, tag + 'every drawer item is at least 44px tall', async () => {
      const boxes = await page.$$eval('[data-cal-drawer-item]', els => els.map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, v: e.getAttribute('data-cal-drawer-item') }; }));
      // COUNTED FROM THE APP, not pinned. This said 6; the menu has had 9 since v58, so the assert
      // threw BEFORE the 44px loop it exists for -- the tap-target gate has not actually run since
      // then, and its red looked like a real failure rather than a dead check. Found by the PM.
      const expectedItems = (APP_SRC.match(/\{ view: '[a-z]+', label: /g) || []).length;
      assert(boxes.length === expectedItems, 'expected ' + expectedItems + ' drawer items, found ' + boxes.length);
      for (const b of boxes) { assertGte(b.h, 44, tag + 'drawer item "' + b.v + '" height'); assertGte(b.w, 44, tag + 'drawer item "' + b.v + '" width'); }
    });

    await suite.run('TICK-drawer-survives@' + vp.name, tag + 'the once-a-second repaint does not tear the drawer down', async () => {
      const focused = await page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        document.querySelector('[data-cal-drawer]').__calTick = 'drawer';
        return document.activeElement && document.activeElement.tagName;
      });
      assert(!['INPUT', 'SELECT', 'TEXTAREA'].includes(focused), 'precondition failed: a field has focus (' + focused + ')');
      await page.waitForTimeout(2600);
      const alive = await page.evaluate(() => { const el = document.querySelector('[data-cal-drawer]'); return el ? el.__calTick : 'GONE'; });
      assert(alive === 'drawer', 'the drawer was rebuilt by the clock tick (probe: ' + alive + ')');
    });

    await suite.run('NAV-drawer-overlay-closes@' + vp.name, tag + 'tapping the overlay closes the drawer', async () => {
      await page.mouse.click(vp.w - 12, Math.round(vp.h / 2));
      await page.waitForSelector('[data-cal-drawer]', { state: 'detached', timeout: 5000 });
    });

    await openCalendar(page);

    // ---- the defect that shipped last time ------------------------------------------------------
    await suite.run('TAP-day-cells@' + vp.name, tag + 'every day cell is at least 44x44', async () => {
      const boxes = await page.$$eval('[data-cal-day-cell]', els => els.map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, d: e.getAttribute('data-cal-day-cell') }; }));
      assert(boxes.length >= 28, 'expected at least 28 day cells, found ' + boxes.length);
      const minW = Math.min(...boxes.map(b => b.w)), minH = Math.min(...boxes.map(b => b.h));
      MEASURED.push(tag + boxes.length + ' day cells measured; narrowest ' + minW.toFixed(2) + 'px x ' + minH.toFixed(2) + 'px (floor 44)');
      assertGte(Number(minW.toFixed(2)), 44, tag + 'narrowest day cell width');
      assertGte(Number(minH.toFixed(2)), 44, tag + 'shortest day cell height');
    });

    await suite.run('HOOK-unique-sections@' + vp.name, tag + 'each calendar section hook matches exactly one element', async () => {
      for (const hook of ['data-cal-view-header', 'data-cal-month-section', 'data-cal-month-grid', 'data-cal-day-panel', 'data-cal-sheet']) {
        const n = await page.locator('[' + hook + ']').count();
        const expected = hook === 'data-cal-sheet' ? 0 : 1;   // the sheet is closed right now
        assert(n === expected, 'selector [' + hook + '] matched ' + n + ' elements, expected ' + expected +
          ' — a hook on more than one element makes querySelector measure the wrong thing and pass');
      }
    });

    await suite.run('LAYOUT-no-h-overflow@' + vp.name, tag + 'the calendar view does not scroll sideways', async () => {
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert(o.sw <= o.cw, 'horizontal overflow: scrollWidth ' + o.sw + ' > clientWidth ' + o.cw);
    });

    await suite.run('LAYOUT-wide-font-stress@' + vp.name, tag + 'header and grid still fit when the font is much wider than the fallback', async () => {
      // Google Fonts is refused in this harness, so the page renders in the system fallback while
      // the patient's phone renders Hanken Grotesk. Rather than leave that gap open, everything is
      // re-measured in Courier New, which is materially WIDER than either. If it fits here it fits
      // in production. The new 44px header menu button is what makes this worth checking.
      await page.addStyleTag({ content: '*{font-family:"Courier New",monospace !important;}' });
      await page.waitForTimeout(120);
      const o = await page.evaluate(() => {
        const row = document.querySelector('header > div');
        return {
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
          hsw: row ? row.scrollWidth : 0,
          hcw: row ? row.clientWidth : 0,
          minCell: Math.min(...[...document.querySelectorAll('[data-cal-day-cell]')].map(e => e.getBoundingClientRect().width))
        };
      });
      assert(o.sw <= o.cw, 'page overflows sideways in a wide font: ' + o.sw + ' > ' + o.cw);
      assert(o.hsw <= o.hcw + 0.5, 'the header row overflows in a wide font: ' + o.hsw + ' > ' + o.hcw);
      assertGte(Number(o.minCell.toFixed(2)), 44, tag + 'narrowest day cell in a wide font');
      await page.evaluate(() => { const s = [...document.querySelectorAll('style')].pop(); if (s && s.textContent.includes('Courier New')) s.remove(); });
      await page.waitForTimeout(120);
    });

    // ---- data correctness ----------------------------------------------------------------------
    await suite.run('DATA-today-selected@' + vp.name, tag + 'today is selected by default and the panel says so', async () => {
      const pressed = await page.getAttribute('[data-cal-day-cell="' + TODAY_KEY + '"]', 'aria-pressed');
      assert(pressed === 'true', "today's cell aria-pressed is " + pressed);
      const label = await page.textContent('[data-cal-day-panel-label]');
      assert(label.includes('Today'), 'day panel label does not mention Today: ' + label);
    });

    await suite.run('PROTO-ids-survive@' + vp.name, tag + "appointments whose id is 'constructor', '__proto__' or 'toString' all render", async () => {
      const titles = await page.$$eval('[data-cal-appt-row] [data-cal-appt-row], [data-cal-appt-row]', els => els.map(e => e.textContent));
      const text = titles.join('\n');
      for (const t of [FX.APPT_PROTO_1, FX.APPT_PROTO_2, FX.APPT_PROTO_3]) {
        assert(text.includes(t), 'appointment dropped from the day panel: ' + t);
      }
      for (const id of ['constructor', '__proto__', 'toString']) {
        const n = await page.locator('[data-cal-appt-row="' + id + '"]').count();
        assert(n === 1, 'expected exactly one row for apptId ' + id + ', found ' + n);
      }
    });

    await suite.run('DATA-supersede-and-tombstone@' + vp.name, tag + 'the newest version wins and cancelled ones do not render', async () => {
      const text = await page.textContent('[data-cal-day-panel]');
      for (const t of EXPECTED_TODAY) assert(text.includes(t), 'missing from the day panel: ' + t);
      for (const t of EXPECTED_HIDDEN) assert(!text.includes(t), 'should NOT be on the calendar: ' + t);
    });

    await suite.run('DATA-day-count@' + vp.name, tag + "today's cell reports the right number of appointments", async () => {
      const c = await page.getAttribute('[data-cal-day-cell="' + TODAY_KEY + '"]', 'data-cal-day-count');
      assert(c === String(EXPECTED_TODAY.length), "today's day-count is " + c + ', expected ' + EXPECTED_TODAY.length);
    });

    await suite.run('TAP-appt-row-buttons@' + vp.name, tag + 'every edit/remove button on an appointment row is 44x44', async () => {
      const boxes = await page.$$eval('[data-cal-appt-edit], [data-cal-appt-delete]', els => els.map(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
      assert(boxes.length === EXPECTED_TODAY.length * 2, 'expected ' + (EXPECTED_TODAY.length * 2) + ' row buttons, found ' + boxes.length);
      for (const b of boxes) { assertGte(b.w, 44, tag + 'row button width'); assertGte(b.h, 44, tag + 'row button height'); }
    });

    // ---- month navigation ----------------------------------------------------------------------
    await suite.run('NAV-month-paging@' + vp.name, tag + 'paging months changes the grid and keeps the selected day', async () => {
      const before = await page.textContent('[data-cal-month-label]');
      await page.click('[data-cal-next-month]');
      const after = await page.textContent('[data-cal-month-label]');
      assert(before !== after, 'the month label did not change: ' + before);
      const panel = await page.textContent('[data-cal-day-panel-label]');
      assert(panel.includes('Today'), 'paging a month lost the selected day: ' + panel);
      await page.click('[data-cal-prev-month]');
      const back = await page.textContent('[data-cal-month-label]');
      assert(back === before, 'paging back landed on ' + back + ', expected ' + before);
      const boxes = await page.$$eval('[data-cal-day-cell]', els => els.map(e => e.getBoundingClientRect().width));
      assertGte(Number(Math.min(...boxes).toFixed(2)), 44, tag + 'day cell width after paging');
    });

    // ---- the appointment sheet -------------------------------------------------------------------
    await suite.run('FONT-16px-inputs@' + vp.name, tag + 'every field in the sheet computes to at least 16px', async () => {
      await page.click('[data-cal-add-button]');
      await page.waitForSelector('[data-cal-sheet]');
      const sizes = await page.$$eval('[data-cal-sheet] input, [data-cal-sheet] textarea, [data-cal-sheet] select',
        els => els.map(e => ({ tag: e.tagName, hook: e.getAttribute('data-cal-sheet-title-input') ? 'title' : e.getAttribute('data-cal-sheet-when-input') ? 'when' : e.getAttribute('data-cal-sheet-note-input') ? 'note' : e.tagName, px: parseFloat(getComputedStyle(e).fontSize) })));
      assert(sizes.length === 3, 'expected 3 fields in the sheet, found ' + sizes.length);
      MEASURED.push(tag + 'sheet field font sizes: ' + sizes.map(s => s.hook + '=' + s.px + 'px').join(', ') + ' (floor 16)');
      for (const s of sizes) {
        assertGte(s.px, 16, tag + 'field "' + s.hook + '" font-size (under 16px makes iOS Safari zoom in and never back)');
      }
    });

    await suite.run('TRAP-no-null-attributes@' + vp.name, tag + 'no rendered attribute has the literal value "null"', async () => {
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          for (const a of el.attributes) {
            if (a.value === 'null' || a.value === 'undefined') out.push(el.tagName + '[' + a.name + '="' + a.value + '"]');
          }
        }
        return out;
      });
      assert(bad.length === 0, 'attributes rendered from a nullish value: ' + bad.join(', '));
    });

    await suite.run('VALIDATE-title-required@' + vp.name, tag + 'saving with no name is refused and writes nothing', async () => {
      await page.evaluate(() => window.__calStub.reset());
      await page.click('[data-cal-sheet-save]');
      await page.waitForSelector('[data-cal-sheet-error]', { timeout: 5000 });
      const writes = await page.evaluate(() => window.__calStub.rec.addDoc.length);
      assert(writes === 0, 'a nameless appointment was written to the database (' + writes + ' writes)');
      const stillOpen = await page.locator('[data-cal-sheet]').count();
      assert(stillOpen === 1, 'the sheet closed on an invalid save');
    });

    await suite.run('TYPE-note-survives@' + vp.name, tag + 'typing into the note does not destroy the field', async () => {
      // Typed one key at a time, and the probe is planted on the note element BEFORE the first
      // keystroke. An earlier version filled the note first and only planted the probe afterwards,
      // so it was really watching what the TITLE handler did and stayed green when the note
      // handler was broken. Real per-keystroke typing is also what exposes the failure: a
      // setState per keystroke blows the field away, the caret goes with it, and every character
      // after the first lands nowhere.
      const probe = 'note typed one key at a time';
      await page.click('[data-cal-sheet-note-input]');
      await page.evaluate(() => { document.querySelector('[data-cal-sheet-note-input]').__calProbe = 'alive'; });
      const loc = page.locator('[data-cal-sheet-note-input]');
      if (typeof loc.pressSequentially === 'function') await loc.pressSequentially(probe, { delay: 25 });
      else await loc.type(probe, { delay: 25 });
      const noteState = await page.evaluate(() => {
        const el = document.querySelector('[data-cal-sheet-note-input]');
        return { value: el ? el.value : null, alive: el ? el.__calProbe : null };
      });
      assert(noteState.alive === 'alive', 'the note field was destroyed and recreated while it was being typed into');
      assert(noteState.value === probe, 'the note lost characters while typing: ' + JSON.stringify(noteState.value));

      // Same treatment for the title field.
      await page.click('[data-cal-sheet-title-input]');
      await page.evaluate(() => { document.querySelector('[data-cal-sheet-title-input]').__calProbe = 'alive'; });
      const tloc = page.locator('[data-cal-sheet-title-input]');
      const tprobe = 'Typed title';
      if (typeof tloc.pressSequentially === 'function') await tloc.pressSequentially(tprobe, { delay: 25 });
      else await tloc.type(tprobe, { delay: 25 });
      const titleState = await page.evaluate(() => {
        const el = document.querySelector('[data-cal-sheet-title-input]');
        return { value: el ? el.value : null, alive: el ? el.__calProbe : null };
      });
      assert(titleState.alive === 'alive', 'the title field was destroyed and recreated while it was being typed into');
      assert(titleState.value === tprobe, 'the title lost characters while typing: ' + JSON.stringify(titleState.value));
    });

    await suite.run('TICK-sheet-survives@' + vp.name, tag + 'the once-a-second repaint does not tear the sheet down', async () => {
      // PRECONDITION, asserted rather than assumed. The clock tick already skips a repaint while a
      // field has focus (`isEditing`), so running this check with the cursor still in the title
      // input passes no matter what the dialog guard does. An earlier version of this check did
      // exactly that and stayed green when the guard was deleted. Focus is dropped first and the
      // precondition is verified, so the check can never go vacuous again.
      const focused = await page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        const t = document.activeElement && document.activeElement.tagName;
        document.querySelector('[data-cal-sheet]').__calTick = 'sheet';
        return t;
      });
      assert(!['INPUT', 'SELECT', 'TEXTAREA'].includes(focused),
        'precondition failed: a field still has focus (' + focused + '), so the isEditing guard would mask the result');
      await page.waitForTimeout(2600);
      const alive = await page.evaluate(() => { const el = document.querySelector('[data-cal-sheet]'); return el ? el.__calTick : 'GONE'; });
      assert(alive === 'sheet', 'the appointment sheet was rebuilt by the clock tick (probe: ' + alive + ')');
    });

    await suite.run('SYNC-sheet-survives@' + vp.name, tag + 'a live sync landing does not tear the sheet down', async () => {
      await page.evaluate(() => {
        document.querySelector('[data-cal-sheet]').__calSync = 'sheet';
        window.__calStub.push({ medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: Date.now(), loggedAt: Date.now() });
      });
      await page.waitForTimeout(400);
      const alive = await page.evaluate(() => { const el = document.querySelector('[data-cal-sheet]'); return el ? el.__calSync : 'GONE'; });
      assert(alive === 'sheet', 'a snapshot from another device destroyed the open sheet (probe: ' + alive + ')');
    });

    await suite.run('SAVE-appends-appointment@' + vp.name, tag + 'saving appends one appointment document with the right shape', async () => {
      const title = 'Harness appointment ' + vp.w;
      await page.evaluate(() => window.__calStub.reset());
      await page.fill('[data-cal-sheet-title-input]', title);
      await page.fill('[data-cal-sheet-note-input]', 'harness note');
      await page.fill('[data-cal-sheet-when-input]', TODAY_KEY + 'T11:45');
      await page.click('[data-cal-sheet-save]');
      await page.waitForSelector('[data-cal-sheet]', { state: 'detached', timeout: 8000 });
      const rec = await page.evaluate(() => window.__calStub.rec);
      assert(rec.addDoc.length === 1, 'expected 1 write, got ' + rec.addDoc.length);
      assert(rec.deleteDoc.length === 0, 'a delete was issued on save');
      const d = rec.addDoc[0].data;
      assert(rec.addDoc[0].col === 'caretracker_entries', 'wrote to collection ' + rec.addDoc[0].col);
      assert(d.medId === 'appointment', 'medId is ' + d.medId);
      assert(d.title === title, 'title is ' + d.title);
      assert(d.note === 'harness note', 'note is ' + d.note);
      assert(typeof d.apptId === 'string' && d.apptId.startsWith('appt_'), 'apptId is ' + d.apptId);
      assert(d.cancelled === false, 'cancelled is ' + d.cancelled);
      assert(typeof d.ts === 'number' && d.ts > 0, 'ts is ' + d.ts);
      assert(typeof d.loggedAt === 'number' && d.loggedAt > 0, 'loggedAt is ' + d.loggedAt);
      const shown = await page.textContent('[data-cal-day-panel]');
      assert(shown.includes(title), 'the saved appointment is not on the calendar');
    });

    await suite.run('EDIT-supersedes@' + vp.name, tag + 'an edit appends a new version under the SAME apptId', async () => {
      await page.evaluate(() => window.__calStub.reset());
      const before = await page.locator('[data-cal-appt-row]').count();
      await page.click('[data-cal-appt-edit="appt-fixture-normal"]');
      await page.waitForSelector('[data-cal-sheet="edit"]');
      const prefill = await page.inputValue('[data-cal-sheet-title-input]');
      assert(prefill === FX.APPT_NORMAL, 'the edit sheet did not prefill the title: ' + prefill);
      await page.fill('[data-cal-sheet-title-input]', 'Oncology review RESCHEDULED');
      await page.click('[data-cal-sheet-save]');
      await page.waitForSelector('[data-cal-sheet]', { state: 'detached', timeout: 8000 });
      const rec = await page.evaluate(() => window.__calStub.rec);
      assert(rec.addDoc.length === 1, 'expected 1 append, got ' + rec.addDoc.length);
      assert(rec.deleteDoc.length === 0, 'an edit issued a delete — Firestore rules refuse that after 48h');
      assert(rec.addDoc[0].data.apptId === 'appt-fixture-normal', 'the edit minted a new apptId: ' + rec.addDoc[0].data.apptId);
      const after = await page.locator('[data-cal-appt-row]').count();
      assert(after === before, 'editing changed the row count ' + before + ' -> ' + after + ' (it duplicated instead of superseding)');
      const text = await page.textContent('[data-cal-day-panel]');
      assert(text.includes('Oncology review RESCHEDULED'), 'the new version is not showing');
      assert(!text.includes(FX.APPT_NORMAL), 'the old version is still showing');
    });

    await suite.run('APPEND-only-no-deletes@' + vp.name, tag + 'removing appends a tombstone and never calls delete', async () => {
      await page.evaluate(() => window.__calStub.reset());
      await page.click('[data-cal-appt-delete="appt-fixture-edited"]');
      await page.waitForSelector('[data-cal-appt-delete-confirm="appt-fixture-edited"]');
      await page.click('[data-cal-appt-delete-confirm="appt-fixture-edited"]');
      await page.waitForSelector('[data-cal-appt-row="appt-fixture-edited"]', { state: 'detached', timeout: 8000 });
      const rec = await page.evaluate(() => window.__calStub.rec);
      assert(rec.deleteDoc.length === 0, 'removal called deleteDoc ' + rec.deleteDoc.length + ' time(s); the rules block deletes after 48h');
      assert(rec.addDoc.length === 1, 'expected 1 tombstone append, got ' + rec.addDoc.length);
      assert(rec.addDoc[0].data.cancelled === true, 'the tombstone does not carry cancelled:true');
      assert(rec.addDoc[0].data.apptId === 'appt-fixture-edited', 'the tombstone has the wrong apptId');
      const text = await page.textContent('[data-cal-day-panel]');
      assert(!text.includes(FX.APPT_EDITED_NEW), 'the removed appointment is still on the calendar');
    });

    // ---- the invariant this whole feature is judged on ------------------------------------------
    await suite.run('EXPORT-csv-clean@' + vp.name, tag + 'no appointment reaches the CSV, and the CSV is not empty', async () => {
      await page.click('[data-cal-menu-button]');
      await page.click('[data-cal-drawer-item="reports"]');
      // The stable data-backup-btn hook, NOT the visible label. These two lines matched on
      // "Save spreadsheet" and broke the moment v54 renamed the buttons to say what they are FOR --
      // testing a button that no longer exists, against a screen that still worked perfectly. The
      // hook exists in the source precisely so a copy change cannot do this.
      await page.waitForSelector('[data-backup-btn="csv"]', { timeout: 8000 });
      const csv = await readDownload(page, () => page.click('[data-backup-btn="csv"]'));
      assert(csv.includes('tylenol'), 'the CSV has no medication rows — the check would pass vacuously');
      for (const t of Object.values(FX)) assert(!csv.includes(t), 'an appointment reached the CSV: ' + t);
      assert(!csv.includes('appt-fixture'), 'an apptId reached the CSV');
      const rows = csv.split('\r\n').slice(1).map(r => r.split(','));
      const medIdCol = rows.map(r => (r[5] || '').replace(/"/g, ''));
      assert(!medIdCol.includes('appointment'), "a row with Med ID 'appointment' is in the CSV");
      // Titles alone are not enough. A leaked appointment does not print its title anywhere -- it
      // prints as a row whose type is derived from medId. A clean CSV contains the substring
      // 'ppointment' exactly zero times, so absence is the exact test.
      const n = (csv.match(/ppointment/gi) || []).length;
      assert(n === 0, "the CSV contains 'ppointment' " + n + ' time(s); an appointment row is in the spreadsheet');
    });

    await suite.run('EXPORT-report-clean@' + vp.name, tag + 'no appointment reaches the printable oncologist report', async () => {
      const doc = await readDownload(page, () => page.click('[data-backup-btn="report"]'));
      assert(doc.length > 2000, 'the report is suspiciously short: ' + doc.length + ' chars');
      assert(doc.toLowerCase().includes('tylenol'), 'the report has no medication content — vacuous');
      for (const t of Object.values(FX)) assert(!doc.includes(t), 'an appointment reached the printable report: ' + t);
      // The decisive assertion, and the one an earlier version of this suite was missing. A leaked
      // appointment never prints its title -- the report has no title column. It prints as a row
      // reading "Medication (removed) | Appointment", which is exactly the sort of thing that
      // reads to an oncologist as a discontinued drug. A clean report contains the substring
      // 'ppointment' zero times, so absence is exact rather than approximate.
      const n = (doc.match(/ppointment/gi) || []).length;
      assert(n === 0, "the printable report contains 'ppointment' " + n + " time(s) — an appointment row is in the clinical hand-off, most likely labelled 'Medication (removed)'");
      assert(!/Medication \(removed\)/.test(doc), 'the report contains a "Medication (removed)" row, which is what a leaked appointment renders as');
    });

    // ---- positive control: the repaint really is running ----------------------------------------
    await suite.run('TICK-positive-control@' + vp.name, tag + 'with no dialog open the app DOES repaint every second', async () => {
      await page.evaluate(() => { const el = document.querySelector('header'); if (el) el.__calTick = 'header'; });
      await page.waitForTimeout(2600);
      const alive = await page.evaluate(() => { const el = document.querySelector('header'); return el ? el.__calTick : 'MISSING'; });
      assert(alive !== 'header', 'the clock tick never repainted — every "survives the tick" check above would be vacuous');
    });

    await suite.run('CONSOLE-clean@' + vp.name, tag + 'no console errors and no uncaught exceptions', async () => {
      assert(pageErrors.length === 0, 'uncaught exceptions: ' + pageErrors.join(' | '));
      const real = consoleErrors.filter(e => !/Failed to load resource/.test(e));
      assert(real.length === 0, 'console errors: ' + real.join(' | '));
    });
  } finally {
    await context.close();
  }
}

async function runNetworkChecks(suite, net) {
  await suite.run('NET-1-no-real-firestore', 'nothing reached a real host; all three Firebase modules were stubbed', () => {
    for (const u of Object.keys(GSTATIC)) assert(net.stubHits.has(u), 'stub never used, real module may have loaded: ' + u);
    // The base HTML links two Google Fonts stylesheets. Those are refused like everything else;
    // what must be true is that NOTHING that could carry patient data was ever contacted, and that
    // the only external requests attempted at all were those inert stylesheets.
    const dataHosts = /firestore|firebaseio|firebasedatabase|googleapis\.com\/(v1|google\.firestore)|identitytoolkit|fcmregistrations/i;
    const offenders = net.blocked.filter(u => dataHosts.test(u));
    assert(offenders.length === 0, 'the page tried to reach a Firebase DATA endpoint: ' + offenders.join(', '));
    const allowed = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
    const unexpected = net.blocked.filter(u => !allowed.test(u));
    assert(unexpected.length === 0, 'unexpected external request (refused, but it should not have been attempted): ' + unexpected.slice(0, 6).join(', '));
    assert(net.blocked.every(u => allowed.test(u)), 'blocked list is not font-only');
  });
  await suite.run('NET-2-no-service-worker', 'the service worker was never requested or registered', () => {
    assert(net.swRequested === false, 'sw.js was requested — the cache-first worker must stay out of the harness');
  });
}

// =================================================================================================
// main
// =================================================================================================

function report(title, suite) {
  const failed = suite.failed();
  console.log('\n' + '='.repeat(90));
  console.log(title);
  console.log('='.repeat(90));
  for (const r of suite.results) console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + '  —  ' + r.desc + (r.ok ? '' : '\n          ' + r.err));
  console.log('-'.repeat(90));
  console.log('  ' + (suite.results.length - failed.length) + '/' + suite.results.length + ' checks passed');
  if (MEASURED.length && !MODE_FALSIFY) {
    console.log('\n  MEASURED (not eyeballed):');
    for (const m of MEASURED) console.log('    ' + m);
  }
  return failed;
}

async function runSuite(browser, html) {
  const suite = new Suite();
  const net = makeNetLog();
  const server = await startServer(() => html);
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  try {
    await runFileChecks(suite, html);
    for (const vp of VIEWPORTS) await runRuntimeChecks(suite, browser, url, vp, net);
    await runNetworkChecks(suite, net);
  } finally {
    await new Promise(r => server.close(r));
  }
  return suite;
}

async function main() {
  const html = fs.readFileSync(APP_FILE, 'utf-8');
  console.log('cal-test.mjs');
  console.log('  app file : ' + APP_FILE);
  console.log('  mode     : ' + (MODE_FALSIFY ? 'FALSIFY (each guard is broken in turn; the named check must go RED)' : 'VERIFY'));
  console.log('  viewports: ' + VIEWPORTS.map(v => v.w + 'x' + v.h).join(', '));

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let exit = 0;
  try {
    if (!MODE_FALSIFY) {
      const suite = await runSuite(browser, html);
      const failed = report('VERIFY — patched build', suite);
      exit = failed.length ? 1 : 0;
    } else {
      // Baseline first: a falsification run means nothing unless the unmutated build is green.
      const base = await runSuite(browser, html);
      const baseFailed = report('FALSIFY baseline — unmutated build must be green', base);
      if (baseFailed.length) { console.log('\nBaseline is not green; falsification results would be meaningless.'); return 1; }

      const rows = [];
      const chosen = BATCH ? MUTATORS.slice(BATCH[0], BATCH[1]) : MUTATORS;
      for (const m of chosen) {
        let mutated;
        try { mutated = m.apply(html); } catch (err) { rows.push({ m, ok: false, note: 'mutator failed to apply: ' + err.message }); continue; }
        if (mutated === html) { rows.push({ m, ok: false, note: 'mutator changed nothing' }); continue; }
        const s = await runSuite(browser, mutated);
        const failedIds = s.failed().map(r => r.id);
        const missing = m.expect.filter(e => !failedIds.some(id => id === e || id.startsWith(e + '@')));
        rows.push({ m, ok: missing.length === 0, failedIds, missing });
      }
      console.log('\n' + '='.repeat(90));
      console.log('FALSIFICATION — break it, confirm RED, restore');
      console.log('='.repeat(90));
      for (const r of rows) {
        console.log((r.ok ? '  RED (good)  ' : '  NOT RED     ') + r.m.name);
        console.log('               ' + r.m.why);
        console.log('               expected to fail: ' + r.m.expect.join(', '));
        if (r.note) console.log('               ' + r.note);
        else console.log('               actually failed: ' + (r.failedIds.length ? r.failedIds.join(', ') : '(nothing — the check does not work)'));
        if (!r.ok && r.missing && r.missing.length) console.log('               DID NOT GO RED: ' + r.missing.join(', '));
      }
      const bad = rows.filter(r => !r.ok);
      console.log('-'.repeat(90));
      console.log('  ' + (rows.length - bad.length) + '/' + rows.length + ' guards proved falsifiable' + (BATCH ? '  (batch ' + BATCH.join('-') + ' of ' + MUTATORS.length + ')' : ''));
      exit = bad.length ? 1 : 0;
    }
  } finally {
    await browser.close();
  }
  return exit;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
