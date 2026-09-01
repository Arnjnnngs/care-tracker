#!/usr/bin/env node
/**
 * tour-test.mjs — verification suite for the care-tracker v44 guided tour.
 *
 * SAFETY (non-negotiable; this app holds one cancer patient's real medication history):
 *   * ALL THREE gstatic Firebase modules are stubbed. One catch-all route aborts every request
 *     that is not 127.0.0.1 or one of the three stubs. NET-1 fails the run if anything escaped.
 *   * The service worker is deleted from the page before any script runs. NET-2 fails the run if
 *     sw.js was ever requested.
 *   * Fixtures only. No credentials, no network, no writes anywhere but the in-memory stub — and
 *     TOUR-no-writes asserts the tour itself never issues one.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node tour-test.mjs
 *   ... node tour-test.mjs --falsify           # break each guard in turn; the named check must go RED
 *   ... node tour-test.mjs --file <index.html> # verify a different build
 *   ... node tour-test.mjs --falsify --batch 0-6
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback. The suite refuses to start
 * rather than failing every check for the wrong reason.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const FILE_ARG = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : null; })();
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
const STREAM = argv.includes('--stream');
const VP_ARG = (() => { const i = argv.indexOf('--vp'); return i >= 0 ? Number(argv[i + 1]) : null; })();
const BATCH = (() => { const i = argv.indexOf('--batch'); return i >= 0 ? argv[i + 1].split('-').map(Number) : null; })();
const APP_FILE = FILE_ARG || path.join(HERE, 'work', 'repo', 'index.html');
// The UNPATCHED base, used only for input-vs-output comparisons (APP_VERSION, sw.js). Never used
// to assert a version literal — see FILE-app-version.
const BASE_ARG = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : null; })();
const BASE_FILE = BASE_ARG || path.join(HERE, 'work', 'base-index.html');
const BASE_SW_FILE = path.join(path.dirname(BASE_FILE), path.basename(BASE_FILE) === 'base-index.html' ? 'base-sw.js' : 'sw.js');
const OUT_SW_FILE = path.join(path.dirname(APP_FILE), 'sw.js');
const readOrNull = (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch (e) { return null; } };
const BASE_HTML = readOrNull(BASE_FILE) || '';
const BASE_SW = readOrNull(BASE_SW_FILE);
const OUT_SW = readOrNull(OUT_SW_FILE);
const md5 = (s) => crypto.createHash('md5').update(s, 'utf-8').digest('hex');

const ALL_VIEWPORTS = [{ w: 375, h: 812, name: 'iPhone-375x812' }, { w: 390, h: 844, name: 'iPhone-390x844' }];
// Falsification proves the CHECK works, not the layout, so it runs on the narrowest phone only.
// Verification always runs both, and every tap target is MEASURED at both.
const VIEWPORTS = VP_ARG ? ALL_VIEWPORTS.filter(v => v.w === VP_ARG) : (MODE_FALSIFY ? [ALL_VIEWPORTS[0]] : ALL_VIEWPORTS);

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the proxy.');
    console.error('  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node tour-test.mjs');
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

const STUB_FIRESTORE = `
const fx = (globalThis.__TOUR_FIXTURE__ || { entries: [], prefs: {} });
const store = { entries: (fx.entries || []).slice(), prefs: Object.assign({}, fx.prefs || {}) };
const entryListeners = [];
const prefsListeners = [];
let autoId = 0;
const rec = { addDoc: [], deleteDoc: [], setDoc: [], snapshots: 0 };

globalThis.__tourStub = {
  rec,
  writes() { return rec.addDoc.length + rec.deleteDoc.length + rec.setDoc.length; },
  reset() { rec.addDoc.length = 0; rec.deleteDoc.length = 0; rec.setDoc.length = 0; },
  push(d) { store.entries.push(Object.assign({ id: 'pushed-' + (++autoId) }, d)); emitEntries(); }
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
  if (target && target.__kind === 'doc') {
    // "Prefs failed to load" is modelled by never calling back at all -- the app's callback that
    // sets missedClearedAt simply never runs, exactly as it would with a rules error offline.
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
export async function setDoc(ref, data) {
  rec.setDoc.push({ col: ref && ref.col, id: ref && ref.id, data: JSON.parse(JSON.stringify(data)) });
  if (fx.writesFail) throw new Error('offline: write rejected');
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

function atToday(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }
const T0 = Date.now();

function fixtureNormal() {
  return {
    entries: [
      { id: 'e-tyl-1', medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: atToday(8, 0), loggedAt: atToday(8, 0) },
      { id: 'e-temp-1', medId: 'temp', temp: 99.4, dose: '99.4 °F', mg: 0, ts: atToday(9, 0), loggedAt: atToday(9, 0) },
      { id: 'e-wt-1', medId: 'weight', weight: 141, dose: '141 lbs', mg: 0, ts: atToday(7, 30), loggedAt: atToday(7, 30) },
      { id: 'a-normal', medId: 'appointment', apptId: 'appt-fx-1', title: 'Oncology review TOURFIXTURE', note: 'Bring the pill diary', ts: atToday(14, 0), cancelled: false, dose: 'Appointment', mg: 0, loggedAt: T0 - 9000 }
    ],
    prefs: { missedClearedAt: 0 }
  };
}

// "Firestore offline, prefs never load, every write rejected, nothing recorded yet." The whole
// tour must still run end to end, and every step whose anchor does not exist must centre rather
// than break.
function fixtureOffline() {
  return { entries: [], prefs: {}, prefsNever: true, writesFail: true };
}

// Steps whose anchor is guaranteed to exist on any build, empty or not. The missed-dose step is
// NOT in this list: on a day with nothing missed it legitimately has nothing to point at.
const ANCHORED_STEPS = ['menu', 'logging', 'calendar', 'meds', 'reports', 'backup', 'finish'];
const STEP_KEYS = ['welcome', 'menu', 'logging', 'missed', 'calendar', 'meds', 'reports', 'backup', 'finish'];

// =================================================================================================
// Mutators — each breaks exactly one guarded property; --falsify proves the named checks go RED.
// =================================================================================================

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('mutator anchor not found: ' + from.slice(0, 100));
  if (html.split(from).length > 2) throw new Error('mutator anchor is ambiguous: ' + from.slice(0, 100));
  return html.replace(from, to);
}

const TICK_LINE = 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();';

const MUTATORS = [
  {
    name: 'tick-drops-tour',
    why: 'removes !state.tour from the shared clock-tick guard — the spotlight jumps once a second',
    expect: ['FILE-tick-guard-composed', 'TICK-no-repaint-under-tour'],
    apply: (h) => must(h, TICK_LINE, 'if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();')
  },
  {
    name: 'tick-clobbers-appt-sheet',
    why: 'the exact regression the brief warns about: overwriting the guard instead of composing, dropping the calendar patch term',
    expect: ['FILE-tick-guard-composed', 'TYPE-appt-sheet-survives'],
    apply: (h) => must(h, TICK_LINE, 'if (!state.timeModal && !state.drawerOpen && !state.tour && !isEditing) render();')
  },
  {
    name: 'tick-clobbers-drawer',
    why: 'drops the drawer term, so a tick destroys the menu under the finger',
    expect: ['FILE-tick-guard-composed', 'TICK-drawer-survives'],
    apply: (h) => must(h, TICK_LINE, 'if (!state.timeModal && !state.apptSheet && !state.tour && !isEditing) render();')
  },
  {
    name: 'reflow-branch-removed',
    why: 'drops the else-branch, so the spotlight stays on stale coordinates when the page reflows without a repaint',
    expect: ['FILE-tick-guard-composed', 'SPOT-follows-reflow'],
    apply: (h) => must(h, '  else if (state.tour) positionTour(false);', '  else if (false) positionTour(false);')
  },
  {
    name: 'back-button-disabled-null',
    why: 'THE h() TRAP: renders Back always, with disabled passed as a nullish ternary — disabled="null" disables it forever',
    expect: ['TRAP-no-null-attributes'],
    apply: (h) => must(h,
      "      i > 0 ? h('button', { 'data-tour-back': 'true', type: 'button', onClick: () => tourGo(i - 1), style:",
      "      h('button', { 'data-tour-back': 'true', type: 'button', disabled: i > 0 ? null : 'disabled', onClick: () => tourGo(i - 1), style:")
      .replace("color: '#8E3D61' } }, 'Back') : null,", "color: '#8E3D61' } }, 'Back'),")
  },
  {
    name: 'aria-current-not-spread',
    why: 'passes aria-current as a nullish ternary instead of spreading it — every progress dot claims to be the current step',
    expect: ['TRAP-no-null-attributes'],
    apply: (h) => must(h, "      }, k === i ? { 'aria-current': 'step' } : {})))", "      }, { 'aria-current': k === i ? 'step' : null })))")
  },
  {
    name: 'tour-auto-starts',
    why: 'starts the tour on load — the ChemoWell behaviour Aaron explicitly refused',
    expect: ['FILE-no-auto-start', 'BOOT-no-tour-on-load'],
    apply: (h) => must(h, "// Init\nunsubPrefs = subscribePrefs((prefs) => {", "// Init\nsetTimeout(() => tourStart(), 30);\nunsubPrefs = subscribePrefs((prefs) => {")
  },
  {
    name: 'skip-does-nothing',
    why: 'wires Skip to a no-op — the patient is stuck behind the tour',
    expect: ['EXIT-skip-every-step'],
    apply: (h) => must(h, "h('button', { 'data-tour-skip': 'true', type: 'button', onClick: () => tourEnd()", "h('button', { 'data-tour-skip': 'true', type: 'button', onClick: () => {}")
  },
  {
    name: 'escape-ignored',
    why: 'removes the Escape exit',
    expect: ['EXIT-escape'],
    apply: (h) => must(h, "  if (e.key === 'Escape' || e.key === 'Esc') {", "  if (false) {")
  },
  {
    name: 'backdrop-tap-ignored',
    why: 'removes the backdrop exit',
    expect: ['EXIT-backdrop'],
    apply: (h) => must(h, "    onClick: (e) => { if (e.target === e.currentTarget) tourEnd(); },\n    style: { position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', background: 'rgba(52,26,44,0.5)' }",
                          "    onClick: (e) => { if (false) tourEnd(); },\n    style: { position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', background: 'rgba(52,26,44,0.5)' }")
  },
  {
    name: 'tour-calls-calCloseDrawer',
    why: 'lesson 5: calCloseDrawer() queues a focus handoff that lands after the tour has taken focus and pulls it back out',
    expect: ['FILE-no-calCloseDrawer-in-tour'],
    apply: (h) => must(h, '  state.drawerOpen = !!(step && step.drawer);', '  calCloseDrawer();\n  state.drawerOpen = !!(step && step.drawer);')
  },
  {
    name: 'duplicate-icon-key',
    why: 'lesson 3: a duplicate object key is legal JS — last wins, silently, and anchor-uniqueness is blind to it',
    expect: ['FILE-no-duplicate-icon-keys'],
    apply: (h) => must(h, "    calMenu: '<path d=\"M4 7h16\"/>", "    tourHelp: '<path d=\"M4 4h16\"/>',\n    calMenu: '<path d=\"M4 7h16\"/>")
  },
  {
    name: 'header-second-button',
    why: 'lesson 4: puts the tour trigger in the header, where ~128px of space has to hold a ~150px title',
    expect: ['FILE-header-one-button', 'HEADER-one-button'],
    apply: (h) => must(h, "      h('div', { style: { minWidth: '0', flex: '1' } },\n        h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', color: '#AA5375', marginBottom: '4px' } },",
      "      h('button', { type: 'button', onClick: () => tourStart(), 'aria-label': 'Take a tour', style: { flexShrink: '0', width: '44px', height: '44px' } }, appIcon('tourHelp', 21)),\n      h('div', { style: { minWidth: '0', flex: '1' } },\n        h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', color: '#AA5375', marginBottom: '4px' } },")
  },
  {
    name: 'seventh-drawer-item',
    why: 'puts the tour into CAL_DRAWER_ITEMS, whose entries are view keys fed straight to navigateTo()',
    expect: ['FILE-drawer-items-6'],
    apply: (h) => must(h, "  { view: 'symptoms', label: 'Symptoms', icon: 'notes', blurb: 'How she is feeling' }\n];",
                          "  { view: 'symptoms', label: 'Symptoms', icon: 'notes', blurb: 'How she is feeling' },\n  { view: 'tour', label: 'Tour', icon: 'tourHelp', blurb: 'A look around' }\n];")
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do (mutator is version-agnostic: it reads whatever the base says and changes it)',
    expect: ['FILE-app-version'],
    apply: (h) => {
      const m = /const APP_VERSION = '([^']+)';/.exec(h);
      if (!m) throw new Error('mutator anchor not found: APP_VERSION declaration');
      return must(h, m[0], "const APP_VERSION = '" + m[1] + ".tourbump';");
    }
  },
  {
    name: 'sw-registration-touched',
    why: 'edits the service-worker registration block, which this patch must never do',
    expect: ['FILE-sw-block-untouched'],
    apply: (h) => must(h, "  navigator.serviceWorker.register('sw.js').then(reg => {", "  navigator.serviceWorker.register('sw.js?v44').then(reg => {")
  },
  {
    name: 'tour-writes-to-firestore',
    why: 'makes the tour write a document — a tour must never touch patient data',
    expect: ['TOUR-no-writes'],
    apply: (h) => must(h, '  state.tour = { i: 0, retView: state.view, retReports: state.reportsView || null };',
                          "  addEntryDB({ medId: 'tour_started', dose: null, mg: 0, ts: Date.now() });\n  state.tour = { i: 0, retView: state.view, retReports: state.reportsView || null };")
  },
  {
    name: 'backup-copy-buried',
    why: 'moves the only-restorable fact out of the lead — the one thing Aaron asked to lead with',
    expect: ['COPY-backup-leads'],
    apply: (h) => must(h, "    body: 'The backup file is the only one of these that can be put back. Save it somewhere safe",
                          "    body: 'Save the backup file somewhere safe. It is the only one of these that can be put back")
  },
  {
    name: 'tour-inside-root',
    why: 'mounts the tour inside #root, where render() destroys it on the next Firestore snapshot',
    expect: ['SYNC-tour-survives-snapshot'],
    apply: (h) => must(h, "  document.body.appendChild(tourEl);", "  (document.getElementById('root') || document.body).appendChild(tourEl);")
  },
  {
    name: 'tap-targets-shrunk',
    why: 'drops the tour buttons below the 44px floor — MEASURED at both phone widths, not eyeballed',
    expect: ['TAP-tour-buttons-44'],
    apply: (h) => must(h, "  const btnBase = { minHeight: '44px',", "  const btnBase = { minHeight: '36px',")
  },
  {
    name: 'view-not-restored',
    why: 'leaves the patient wherever the tour stopped instead of putting the screen back',
    expect: ['EXIT-restores-view'],
    apply: (h) => must(h, "    state.view = t.retView || 'home';\n    state.reportsView = t.retReports || null;", "    state.reportsView = null;")
  },
  {
    name: 'setState-in-onInput',
    why: 'regression guard for the other four patches: setState from onInput destroys the field being typed into',
    expect: ['FILE-no-setState-in-onInput'],
    apply: (h) => must(h, "onInput: (e) => { if (state.apptSheet) state.apptSheet.note = e.target.value; }",
                          "onInput: (e) => { setState({ apptSheet: Object.assign({}, state.apptSheet, { note: e.target.value }) }); }")
  }
];

// =================================================================================================
// Runner plumbing
// =================================================================================================

class Suite {
  constructor() { this.results = []; }
  async run(id, desc, fn) {
    if (ONLY && !id.includes(ONLY)) return;
    const t0 = Date.now();
    try { await fn(); this.results.push({ id, desc, ok: true }); }
    catch (err) { this.results.push({ id, desc, ok: false, err: String(err && err.message || err) }); }
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
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });

  await context.addInitScript(({ fx }) => {
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
    window.open = () => null;
    globalThis.__TOUR_FIXTURE__ = fx;
    try { localStorage.clear(); } catch (e) {}
  }, { fx: fixture });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

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
  await page.waitForFunction(() => !!document.querySelector('[data-cal-menu-button]'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting...'), null, { timeout: 15000 });
  return { context, page, consoleErrors, pageErrors };
}

// The app script is a <script type="module">, so nothing internal is reachable from evaluate().
// Reset is therefore done the way a person would: press the controls that are on screen. Called
// before every runtime check so a failure in one cannot leave a scrim over the next thirteen.
async function hardReset(page) {
  for (let i = 0; i < 8; i++) {
    const clean = await page.evaluate(() => {
      const sk = document.querySelector('[data-tour-skip]');
      if (sk) { sk.click(); return false; }
      const sc = document.querySelector('[data-cal-sheet-cancel]');
      if (sc) { sc.click(); return false; }
      const dc = document.querySelector('[data-cal-drawer-close]');
      if (dc) { dc.click(); return false; }
      return true;
    });
    if (clean) break;
    await page.waitForTimeout(90);
  }
  if (!(await page.$('[data-tour-quicklog]'))) {
    await page.click('[data-cal-menu-button]');
    await page.waitForSelector('[data-cal-drawer]', { timeout: 5000 });
    await page.click('[data-cal-drawer-item="home"]');
    await page.waitForSelector('[data-tour-quicklog]', { timeout: 5000 });
  }
  await page.evaluate(() => { window.scrollTo(0, 0); const s = document.getElementById('reflow-shove'); if (s) s.remove(); });
  const stuck = await page.$('[data-tour-root]');
  if (stuck) throw new Error('hardReset could not clear an open tour');
}

async function openDrawer(page) {
  await page.click('[data-cal-menu-button]');
  await page.waitForSelector('[data-cal-drawer]', { timeout: 8000 });
}

async function startTour(page) {
  await openDrawer(page);
  await page.click('[data-tour-drawer-item]');
  await page.waitForSelector('[data-tour-card]', { timeout: 8000 });
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-tour-card]'), null, { timeout: 4000 }).catch(() => {});
}

async function stepIndex(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-tour-card]');
    return c ? Number(c.getAttribute('data-tour-step')) : -1;
  });
}

async function advanceTo(page, target) {
  for (let guard = 0; guard < 30; guard++) {
    const i = await stepIndex(page);
    if (i < 0) throw new Error('tour closed unexpectedly while advancing to step ' + target);
    if (i >= target) return;
    await page.click('[data-tour-next]');
    await page.waitForFunction((t) => {
      const c = document.querySelector('[data-tour-card]');
      return c && Number(c.getAttribute('data-tour-step')) >= t;
    }, i + 1, { timeout: 6000 });
  }
  throw new Error('could not reach step ' + target);
}

// Every attribute in the tour subtree, so a nullish-ternary attribute cannot hide.
async function tourAttrDump(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-tour-root]');
    if (!root) return null;
    const out = [];
    root.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) {
        out.push({ tag: el.tagName, name: a.name, value: a.value });
      }
    });
    return out;
  });
}

// =================================================================================================
// File checks — these read the FILE, never the screen.
// =================================================================================================

// Strips full-line // comments and /* */ blocks. Without this the suite greps its own warnings:
// the base file carries the literal text `disabled: busy ? 'disabled' : null` inside a comment
// explaining why that must never be written, and the tour block says in prose that it calls
// neither calCloseDrawer() nor localStorage. Checks must read the CODE.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

async function runFileChecks(suite, html) {
  const modStart = html.indexOf('// ---------------- Guided tour (v44) ----------------');
  const modEnd = html.indexOf('\n// Init\nunsubPrefs = subscribePrefs');
  const block = (modStart >= 0 && modEnd > modStart) ? html.slice(modStart, modEnd) : '';
  const code = stripComments(html);
  const blockCode = stripComments(block);

  await suite.run('FILE-tour-block-present', 'the tour module landed as one block above the init section', () => {
    assert(modStart > 0, 'tour module not found');
    assert(modEnd > modStart, 'tour module is not above the init section');
    assert(block.includes('TOUR-PATCH-MARK'), 'idempotency marker missing');
    assertGte(block.length, 8000, 'tour block is suspiciously small');
  });

  // VERSION-AGNOSTIC BY CONSTRUCTION. Three earlier patches in this project pinned a version
  // literal here and every one of them went red the moment the version was legitimately bumped at
  // ship time. This compares INPUT to OUTPUT instead: whatever the unpatched base says, the
  // patched build must say the same thing. It is correct at v44, at v45, and at any version after.
  await suite.run('FILE-app-version', 'APP_VERSION in the patched build equals APP_VERSION in the unpatched base', () => {
    assert(BASE_HTML.length > 0, 'the unpatched base file was not readable at ' + BASE_FILE +
      ' — this check cannot be done against a literal, so it refuses to guess');
    const re = /const APP_VERSION = '([^']+)';/g;
    const inV = [...BASE_HTML.matchAll(re)].map(m => m[1]);
    const outV = [...html.matchAll(re)].map(m => m[1]);
    assert(inV.length === 1, 'the base declares APP_VERSION ' + inV.length + ' times, expected 1');
    assert(outV.length === 1, 'the patched build declares APP_VERSION ' + outV.length + ' times, expected 1');
    assert(inV[0] === outV[0], 'APP_VERSION was changed by the patch: ' + inV[0] + ' -> ' + outV[0] +
      ' — this patch must never touch it, it is set at ship time');
  });

  await suite.run('FILE-sw-js-byte-identical', 'sw.js is byte-identical to the unpatched base', () => {
    assert(BASE_SW !== null, 'the unpatched base sw.js was not readable at ' + BASE_SW_FILE);
    assert(OUT_SW !== null, 'the patched build has no sw.js next to index.html at ' + OUT_SW_FILE);
    assert(BASE_SW === OUT_SW, 'sw.js changed (' + md5(BASE_SW) + ' -> ' + md5(OUT_SW) +
      ') — this patch must never touch it');
    const cache = /const CACHE = '([^']+)'/.exec(OUT_SW);
    assert(!!cache, 'CACHE name not found in sw.js');
    // Reported, never asserted against a literal, for the same reason as APP_VERSION above.
    MEASURED.push('sw.js untouched: md5 ' + md5(OUT_SW) + ', CACHE ' + cache[1]);
  });

  await suite.run('FILE-sw-block-untouched', 'the service-worker registration block is byte-identical', () => {
    const expected = "  navigator.serviceWorker.register('sw.js').then(reg => {";
    assert(html.includes(expected), 'the sw.js registration line changed — this patch must not touch it');
    assert(html.split("register('sw.js')").length === 2, 'sw.js is registered more than once');
    assert(!blockCode.includes('serviceWorker'), 'the tour module references the service worker');
  });

  await suite.run('FILE-tick-guard-composed', 'the 1s tick guard is COMPOSED from all five terms, plus the reflow branch', () => {
    assert(html.includes(TICK_LINE), 'the composed tick guard is not present verbatim. Expected:\n      ' + TICK_LINE);
    assert(html.split(TICK_LINE).length === 2, 'the composed tick guard appears more than once');
    assert(html.includes('else if (state.tour) positionTour(false);'),
      'the reflow branch is missing — the spotlight would sit on stale coordinates');
    // No OTHER form of the guard may survive anywhere: a leftover overwrites the composed one.
    const others = code.match(/if \(!state\.timeModal && [^)]*\) render\(\);/g) || [];
    assert(others.length === 1, 'found ' + others.length + ' tick guards, expected exactly 1: ' + JSON.stringify(others));
    for (const term of ['!state.timeModal', '!state.apptSheet', '!state.drawerOpen', '!state.tour', '!isEditing']) {
      assert(others[0].includes(term), 'the tick guard has lost the term ' + term);
    }
    assert(html.includes("!!state.missReasonSheet"), 'isEditing has lost the reason-sheet term from the reason patch');
  });

  await suite.run('FILE-no-calCloseDrawer-in-tour', 'no tour function calls calCloseDrawer()', () => {
    assert(blockCode.length > 0, 'tour block not found');
    assert(!blockCode.includes('calCloseDrawer('),
      'a tour function calls calCloseDrawer(); its focus handoff lands after the tour has taken focus and pulls it back out');
  });

  await suite.run('FILE-no-duplicate-icon-keys', 'the icon table has no duplicate keys and `help` is still free', () => {
    const m = /const paths = \{([\s\S]*?)\n  \};/.exec(html);
    assert(!!m, 'icon table not found');
    const keys = (m[1].match(/^\s{4}([A-Za-z_$][\w$]*)\s*:/gm) || []).map(s => s.trim().replace(':', ''));
    const dupes = [...new Set(keys.filter(k => keys.filter(x => x === k).length > 1))];
    assert(dupes.length === 0, 'duplicate icon key(s): ' + dupes.join(', ') + ' — legal JS, last wins, silent');
    assert(keys.includes('tourHelp'), 'tourHelp icon missing');
    for (const free of ['help', 'menu', 'calendar', 'close', 'gear']) {
      assert(!keys.includes(free), 'icon key `' + free + '` was deliberately left free and is now taken');
    }
  });

  await suite.run('FILE-header-one-button', 'renderHeader() still contains exactly one button', () => {
    const m = /function renderHeader\(now\) \{[\s\S]*?\n\}/.exec(html);
    assert(!!m, 'renderHeader() not found');
    const n = m[0].split("h('button'").length - 1;
    assert(n === 1, 'renderHeader() has ' + n + ' buttons, expected exactly 1 — the tour trigger belongs in the drawer');
  });

  await suite.run('FILE-drawer-items-6', 'CAL_DRAWER_ITEMS still holds its original six navigation rows', () => {
    const m = /const CAL_DRAWER_ITEMS = \[([\s\S]*?)\n\];/.exec(html);
    assert(!!m, 'CAL_DRAWER_ITEMS not found');
    const n = m[1].split('{ view:').length - 1;
    assert(n === 6, 'CAL_DRAWER_ITEMS has ' + n + ' rows, expected the original 6');
    assert(!m[1].includes('tour'), 'the tour was added to CAL_DRAWER_ITEMS, whose entries are view keys fed to navigateTo()');
    assert(html.split("'data-tour-drawer-item'").length === 2, 'expected exactly one tour drawer row');
  });

  await suite.run('FILE-no-auto-start', 'nothing can start the tour except the menu row', () => {
    // tourStart appears exactly twice: its own declaration and the drawer row's onClick.
    const hits = (code.match(/tourStart/g) || []).length;
    assert(hits === 2, 'tourStart is referenced ' + hits + ' times, expected 2 (declaration + drawer row)');
    assert(/'data-tour-drawer-item': 'true', type: 'button', onClick: \(\) => tourStart\(\)/.test(html),
      'the drawer row is not the thing that calls tourStart()');
    assert(!/setTimeout\(\s*\(?\)?\s*=>?\s*tourStart/.test(code), 'tourStart is scheduled on a timer');
    assert(!blockCode.includes('localStorage'), 'the tour reads or writes localStorage — a first-run flag can auto-start it');
    assert(!blockCode.includes('subscribePrefs') && !blockCode.includes('setDoc') && !blockCode.includes('addEntryDB'),
      'the tour touches prefs or Firestore; it must depend on neither');
  });

  await suite.run('FILE-no-plain-object-step-map', 'no plain {} is used as a lookup keyed by step or view key', () => {
    assert(/const TOUR_STEPS = \[/.test(html), 'TOUR_STEPS is not an array');
    assert(!/TOUR_STEPS\s*=\s*\{/.test(html), 'TOUR_STEPS is a plain object keyed by step key');
    assert(!/const TOUR_[A-Z_]+ = \{\s*$/m.test(blockCode), 'a plain {} lookup was introduced in the tour block');
  });

  await suite.run('FILE-no-setState-in-onInput', 'no onInput handler calls setState (regression guard for the other patches)', () => {
    const bad = code.match(/onInput:\s*\([^)]*\)\s*=>\s*\{[^}]*setState\(/g) || [];
    assert(bad.length === 0, 'setState called from onInput: ' + bad.join(' | '));
  });

  await suite.run('FILE-no-null-attr-literals', 'no conditional attribute is passed as a nullish ternary', () => {
    const risky = ['disabled', 'checked', 'selected', 'readonly', 'aria-current', 'hidden'];
    for (const a of risky) {
      const re = new RegExp("'?" + a + "'?\\s*:\\s*[^,}]*\\?[^,}:]*:\\s*(null|undefined|false)", 'g');
      const hits = code.match(re) || [];
      assert(hits.length === 0, 'nullish conditional attribute `' + a + '`: ' + hits.join(' | '));
    }
  });

  await suite.run('FILE-sibling-hooks-untouched', "no sibling patch's data-* hook is emitted or referenced more than once", () => {
    // The calendar, reason and export suites each assert their own hooks appear exactly once in
    // the whole source. A tour SELECTOR that merely reads one counts as an occurrence and turns
    // their check red, which is how this patch regressed cal-test once. The tour owns
    // data-tour-* hooks on the same elements instead.
    const statics = ['data-cal-menu-button', 'data-cal-drawer-overlay', "data-cal-drawer'", 'data-cal-drawer-close',
      'data-cal-view-header', 'data-cal-add-button', 'data-cal-month-section', 'data-cal-month-grid',
      'data-cal-month-label', 'data-cal-prev-month', 'data-cal-next-month', 'data-cal-weekday-row',
      "data-cal-day-panel'", 'data-cal-day-panel-label', 'data-cal-day-add-button', 'data-cal-day-empty',
      "data-cal-sheet'", 'data-cal-sheet-title-input', 'data-cal-sheet-when-input', 'data-cal-sheet-note-input',
      'data-cal-sheet-save', 'data-cal-sheet-cancel', "data-cal-sheet-remove'", 'data-cal-sheet-error',
      'data-mr-row-button', 'data-mr-missed-row', "data-mr-sheet'", 'data-mr-overlay', 'data-mr-note-input',
      'data-backup-btn', 'data-backup-restore-row', 'data-backup-file-input'];
    for (const hook of statics) {
      const n = html.split(hook).length - 1;
      assert(n === 1, 'hook ' + hook + ' appears ' + n + ' times in the source, expected exactly 1');
    }
  });

  await suite.run('COPY-backup-leads', 'the backup step LEADS with the fact that the backup file is the only restorable one', () => {
    const m = /key: 'backup',[\s\S]*?body: '([^']*)'/.exec(html);
    assert(!!m, 'backup step copy not found');
    const body = m[1];
    assert(/^The backup file is the only one of these that can be put back\./.test(body),
      'the backup step does not lead with the only-restorable fact. It starts: "' + body.slice(0, 70) + '"');
    assert(/spreadsheet|printable/.test(body), 'the backup step does not say what the other two files are for');
  });

  await suite.run('COPY-no-guilt', 'no tour copy scolds, blames or nags the patient', () => {
    const bodies = [...html.matchAll(/\n    body: '([^']*)'/g)].map(m => m[1]);
    assertGte(bodies.length, 9, 'expected at least 9 tour step bodies');
    const banned = /\b(you (should|must|need to|failed|forgot)|don'?t forget|make sure you|remember to|be sure to|always remember)\b/i;
    for (const b of bodies) assert(!banned.test(b), 'guilt/nag phrasing in tour copy: "' + b.slice(0, 90) + '"');
    for (const b of bodies) assertGte(280 - b.length, -60, 'a tour step body is over-long at ' + b.length + ' chars: "' + b.slice(0, 60) + '"');
  });
}

// =================================================================================================
// Runtime checks
// =================================================================================================

let HTML_UNDER_TEST = '';

async function runRuntimeChecks(suite, browser, url, vp, net) {
  const tag = '@' + vp.name;
  const { context, page, pageErrors } = await newPage(browser, url, vp, net, fixtureNormal());
  const rt = (id, desc, fn) => suite.run(id, desc, async () => { await hardReset(page); await fn(); });

  try {
    await rt('BOOT-no-tour-on-load' + tag, 'the app opens with no tour anywhere, on first load and on reload', async () => {
      assert(await page.$('[data-tour-root]') === null, 'a tour was on screen at first load');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!document.querySelector('[data-cal-menu-button]'), null, { timeout: 10000 });
      await page.waitForTimeout(600);
      assert(await page.$('[data-tour-root]') === null, 'a tour appeared after a reload');
      // And the app is immediately usable: a dose-logging control is hittable at the top of Home.
      const hit = await page.evaluate(() => {
        const s = document.querySelector('[data-tour-quicklog]');
        if (!s) return 'no quick-log section';
        const r = s.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + 8), Math.round(r.top + 8));
        return el && el.closest('[data-tour-root]') ? 'blocked by tour' : 'clear';
      });
      assert(hit === 'clear', 'the app was not immediately usable: ' + hit);
    });

    await rt('HARNESS-page-is-the-file' + tag, 'the browser is running the exact file the FILE checks read', async () => {
      // This project has shipped a check that read the screen instead of the file for three
      // rounds. The inverse is just as bad: a runtime check that passes because the browser is
      // running a stale or cached build. Compare the served module source against the file.
      const served = await page.evaluate(() => {
        const sc = document.querySelector('script[type="module"]');
        return sc ? sc.textContent.length : -1;
      });
      const onDisk = (/<script type="module">([\s\S]*?)<\/script>/.exec(HTML_UNDER_TEST) || [null, ''])[1].length;
      assert(served > 1000, 'no module script in the page');
      assert(served === onDisk, 'the page is running a different build: served ' + served + ' chars, file has ' + onDisk);
    });

    await rt('HEADER-one-button' + tag, 'the header still has exactly one button and the drawer has 6 nav rows + 1 tour row', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('header button').length);
      assert(n === 1, 'the header has ' + n + ' buttons, expected 1');
      await openDrawer(page);
      const counts = await page.evaluate(() => ({
        nav: document.querySelectorAll('[data-cal-drawer-item]').length,
        tour: document.querySelectorAll('[data-tour-drawer-item]').length
      }));
      assert(counts.nav === 6, 'drawer navigation rows: ' + counts.nav + ', expected 6 (unchanged)');
      assert(counts.tour === 1, 'tour rows in the drawer: ' + counts.tour + ', expected 1');
      await page.keyboard.press('Escape').catch(() => {});
      await page.click('[data-cal-drawer-close]');
      await page.waitForSelector('[data-cal-drawer]', { state: 'detached', timeout: 5000 });
    });

    await rt('TAP-tour-row-44' + tag, 'the drawer tour row is at least 44px tall (measured)', async () => {
      await openDrawer(page);
      const box = await (await page.$('[data-tour-drawer-item]')).boundingBox();
      assertGte(box.height, 44, 'drawer tour row height' + tag);
      MEASURED.push('drawer tour row ' + tag + ': ' + box.height.toFixed(1) + 'px tall, ' + box.width.toFixed(1) + 'px wide');
      await page.click('[data-cal-drawer-close]');
      await page.waitForSelector('[data-cal-drawer]', { state: 'detached', timeout: 5000 });
    });

    await rt('FOCUS-tour-wins' + tag, 'the tour takes focus from the open drawer and keeps it', async () => {
      // Lesson 6: wait for the APP's own focus handoff to land FIRST, so this cannot pass while
      // disarmed. The drawer focuses itself on a rAF; only then do we open the tour.
      await page.click('[data-cal-menu-button]');
      await page.waitForFunction(() => document.activeElement === document.querySelector('[data-cal-drawer]'), null, { timeout: 5000 });
      await page.click('[data-tour-drawer-item]');
      await page.waitForSelector('[data-tour-card]', { timeout: 5000 });
      await page.waitForTimeout(250);
      const who = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return 'none';
        if (a.closest && a.closest('[data-tour-card]')) return 'tour';
        return (a.tagName || '?') + ' ' + (a.getAttribute('data-cal-drawer') ? 'drawer' : a.getAttribute('data-cal-menu-button') ? 'menu-button' : '');
      });
      assert(who === 'tour', 'focus landed on ' + who + ', not the tour card — something yanked it back');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('STEPS-run-through' + tag, 'all 9 steps render, in order, on screen, with a live spotlight where one is expected', async () => {
      await startTour(page);
      const seen = [];
      for (let i = 0; i < 40; i++) {
        const info = await page.evaluate((vpArg) => {
          const card = document.querySelector('[data-tour-card]');
          if (!card) return null;
          const ring = document.querySelector('[data-tour-ring]');
          const cr = card.getBoundingClientRect();
          const rr = ring.getBoundingClientRect();
          return {
            i: Number(card.getAttribute('data-tour-step')),
            key: card.getAttribute('data-tour-key'),
            count: (card.querySelector('[data-tour-count]') || {}).textContent || '',
            title: (card.querySelector('[data-tour-title]') || {}).textContent || '',
            body: (card.querySelector('[data-tour-body]') || {}).textContent || '',
            next: (card.querySelector('[data-tour-next]') || {}).textContent || '',
            hasBack: !!card.querySelector('[data-tour-back]'),
            ringVisible: ring.style.opacity === '1' && rr.width > 0 && rr.height > 0,
            card: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom },
            vw: window.innerWidth, vh: window.innerHeight
          };
        }, vp);
        assert(info, 'the tour closed on its own at step ' + seen.length);
        seen.push(info);
        assert(info.title.length > 3, 'step ' + info.key + ' has no title');
        assertGte(info.body.length, 40, 'step ' + info.key + ' body is too short to be useful');
        assert(info.count === 'Step ' + (info.i + 1) + ' of 9', 'wrong step counter on ' + info.key + ': ' + info.count);
        assert(info.hasBack === (info.i > 0), 'Back button presence wrong on step ' + info.i);
        assert(info.card.l >= 0 && info.card.t >= 0 && info.card.r <= info.vw + 0.5 && info.card.b <= info.vh + 0.5,
          'the tour card is off screen on step ' + info.key + ': ' + JSON.stringify(info.card) + ' in ' + info.vw + 'x' + info.vh);
        if (ANCHORED_STEPS.includes(info.key)) {
          assert(info.ringVisible, 'no spotlight on step ' + info.key + ', whose anchor must exist');
        }
        if (info.i === 8) { assert(info.next === 'Done', 'the last step says "' + info.next + '", expected Done'); break; }
        assert(info.next === 'Next', 'step ' + info.key + ' says "' + info.next + '", expected Next');
        await page.click('[data-tour-next]');
        await page.waitForFunction((prev) => {
          const c = document.querySelector('[data-tour-card]');
          return c && Number(c.getAttribute('data-tour-step')) === prev + 1;
        }, info.i, { timeout: 6000 });
      }
      assert(seen.length === 9, 'saw ' + seen.length + ' steps, expected 9');
      assert(JSON.stringify(seen.map(s => s.key)) === JSON.stringify(STEP_KEYS),
        'step order changed: ' + seen.map(s => s.key).join(','));
      // Done ends it, and puts the app back.
      await page.click('[data-tour-next]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('TAP-tour-buttons-44' + tag, 'every button in the tour card is at least 44px, on every step (measured)', async () => {
      await startTour(page);
      const worst = { h: 1e9, where: '' };
      for (let i = 0; i < 9; i++) {
        const boxes = await page.evaluate(() => {
          const card = document.querySelector('[data-tour-card]');
          return Array.from(card.querySelectorAll('button')).map(b => ({
            k: b.getAttribute('data-tour-skip') ? 'skip' : b.getAttribute('data-tour-back') ? 'back'
               : b.getAttribute('data-tour-next') ? 'next' : b.getAttribute('data-tour-close') ? 'close' : '?',
            h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width
          }));
        });
        for (const b of boxes) {
          assertGte(b.h, 44, 'tour "' + b.k + '" button height on step ' + i + tag);
          assertGte(b.w, 44, 'tour "' + b.k + '" button width on step ' + i + tag);
          if (b.h < worst.h) { worst.h = b.h; worst.where = b.k + ' @step' + i; }
        }
        if (i < 8) { await page.click('[data-tour-next]'); await page.waitForTimeout(80); }
      }
      MEASURED.push('smallest tour button ' + tag + ': ' + worst.h.toFixed(1) + 'px (' + worst.where + ')');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('TRAP-no-null-attributes' + tag, 'no attribute in the tour renders as "null"/"false"/"undefined", and every button is live', async () => {
      await startTour(page);
      for (let i = 0; i < 9; i++) {
        const attrs = await tourAttrDump(page);
        assert(attrs, 'tour root missing on step ' + i);
        for (const a of attrs) {
          assert(!['null', 'undefined'].includes(a.value),
            'step ' + i + ': <' + a.tag.toLowerCase() + ' ' + a.name + '="' + a.value + '"> — THE h() TRAP');
          assert(!(a.name === 'disabled' || a.name === 'checked' || a.name === 'selected' || a.name === 'hidden'),
            'step ' + i + ': a `' + a.name + '` attribute reached the DOM at all (value "' + a.value + '") — any value disables the control');
        }
        const cur = attrs.filter(a => a.name === 'aria-current');
        assert(cur.length === 1, 'step ' + i + ': ' + cur.length + ' elements carry aria-current, expected exactly 1');
        assert(cur[0].value === 'step', 'aria-current is "' + cur[0].value + '"');
        // Live, not just present: every button must respond.
        const live = await page.evaluate(() => {
          const card = document.querySelector('[data-tour-card]');
          return Array.from(card.querySelectorAll('button')).every(b => !b.disabled && b.getBoundingClientRect().height > 0);
        });
        assert(live, 'step ' + i + ': a tour button is disabled or invisible');
        if (i < 8) { await page.click('[data-tour-next]'); await page.waitForTimeout(80); }
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('A11Y-dialog' + tag, 'the tour card is a labelled dialog and holds no text input', async () => {
      await startTour(page);
      const a = await page.evaluate(() => {
        const c = document.querySelector('[data-tour-card]');
        const lab = document.getElementById(c.getAttribute('aria-labelledby'));
        const desc = document.getElementById(c.getAttribute('aria-describedby'));
        return {
          role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'),
          lab: lab ? lab.textContent.trim() : '', desc: desc ? desc.textContent.trim() : '',
          inputs: document.querySelectorAll('[data-tour-root] input, [data-tour-root] select, [data-tour-root] textarea').length,
          focused: document.activeElement === c
        };
      });
      assert(a.role === 'dialog' && a.modal === 'true', 'the tour card is not an aria dialog');
      assertGte(a.lab.length, 5, 'aria-labelledby resolves to nothing useful');
      assertGte(a.desc.length, 20, 'aria-describedby resolves to nothing useful');
      assert(a.inputs === 0, 'the tour contains ' + a.inputs + ' form fields — it must never raise a keyboard');
      assert(a.focused, 'focus is not on the tour card');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('SPOT-follows-reflow' + tag, 'the spotlight re-glues to its target after a reflow with NO repaint (within 3px)', async () => {
      await startTour(page);
      await advanceTo(page, 7); // "backup" -- a small button in Reports, so the ring is never clamped
      const SEL = '[data-tour-backup]';
      const RING_PAD = 6; // positionTour() insets the ring by 6px on every side
      // WAIT FOR THE TOUR'S OWN POSITIONING TO SETTLE FIRST. A step change schedules positionTour
      // across two animation frames; advanceTo() returns as soon as the step attribute appears,
      // which can be before those frames have run. Shoving the page while one is still pending
      // lets that leftover frame re-glue the spotlight -- and the check then passes with the
      // clock-tick branch deleted, proving nothing. Require two identical samples 150ms apart.
      let stable = null;
      for (let k = 0; k < 20; k++) {
        await page.waitForTimeout(150);
        const now = await page.evaluate(() => {
          const r = document.querySelector('[data-tour-ring]');
          return r ? r.style.top + '|' + r.style.left : '';
        });
        if (stable !== null && now === stable) break;
        stable = now;
      }
      const before = await page.evaluate((sel) => {
        const a = document.querySelector(sel).getBoundingClientRect();
        const r = document.querySelector('[data-tour-ring]').getBoundingClientRect();
        return { at: a.top, al: a.left, ab: a.bottom, rt: r.top, rl: r.left, vh: window.innerHeight, vw: window.innerWidth };
      }, SEL);
      // A clamped ring would make the arithmetic below meaningless, so require the target to be
      // comfortably inside the viewport first.
      assert(before.at > 8 && before.ab < before.vh - 8 && before.al > 8,
        'the target is not fully on screen to begin with: ' + JSON.stringify(before));
      assert(Math.abs(before.rt - (before.at - RING_PAD)) <= 3 && Math.abs(before.rl - (before.al - RING_PAD)) <= 3,
        'the spotlight was not on its target to begin with, so "it followed" would prove nothing: ring ' +
        before.rt.toFixed(1) + '/' + before.rl.toFixed(1) + ' vs target ' + before.at.toFixed(1) + '/' + before.al.toFixed(1));
      // Reflow WITHOUT going through the app: a tall node injected straight into #root. No
      // setState, no render(), no scroll event and no resize event -- so the ONLY thing that can
      // re-glue the spotlight is the else-branch on the one-second tick.
      await page.evaluate(() => {
        const main = document.querySelector('#root main');
        // A canary on a node inside #root. render() does root.innerHTML = '', so if this attribute
        // is still here at the end then no repaint happened -- and the tail of render() cannot be
        // the thing that re-glued the spotlight. Without this the check passes while disarmed.
        main.setAttribute('data-spot-canary', 'alive');
        const shove = document.createElement('div');
        shove.id = 'reflow-shove';
        shove.style.cssText = 'height:190px';
        main.insertBefore(shove, main.firstChild);
      });
      const moved = await page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, SEL);
      const delta = moved - before.at;
      assertGte(Math.abs(delta), 40, 'THE TARGET DID NOT MOVE, so this check proves nothing (moved ' + delta.toFixed(1) + 'px)');
      // Still on screen after the shove, or the ring would legitimately clamp.
      const onScreen = await page.evaluate((sel) => {
        const a = document.querySelector(sel).getBoundingClientRect();
        return a.top > 8 && a.bottom < window.innerHeight - 8;
      }, SEL);
      assert(onScreen, 'the target left the viewport after the shove; the ring would clamp and the check would be meaningless');
      // Poll for up to 2.5s. The good build re-glues on the next one-second tick; a build with the
      // else-branch removed never converges, however long we wait.
      let settled = false;
      for (let k = 0; k < 25 && !settled; k++) {
        await page.waitForTimeout(100);
        settled = await page.evaluate((sel) => {
          const a = document.querySelector(sel).getBoundingClientRect();
          const r = document.querySelector('[data-tour-ring]').getBoundingClientRect();
          return Math.abs(r.top - (a.top - 6)) <= 3 && Math.abs(r.left - (a.left - 6)) <= 3;
        }, SEL);
      }
      const after = await page.evaluate((sel) => {
        const a = document.querySelector(sel).getBoundingClientRect();
        const r = document.querySelector('[data-tour-ring]').getBoundingClientRect();
        const m = document.querySelector('#root main');
        return { at: a.top, al: a.left, rt: r.top, rl: r.left, sy: window.scrollY,
                 canary: !!m && m.getAttribute('data-spot-canary') === 'alive' };
      }, SEL);
      assert(after.canary, 'the app repainted during the wait, so the tail of render() could have re-glued the ' +
        'spotlight and this check would prove nothing about the clock-tick branch');
      const dy = Math.abs(after.rt - (after.at - RING_PAD));
      const dx = Math.abs(after.rl - (after.al - RING_PAD));
      MEASURED.push('spotlight after a ' + delta.toFixed(0) + 'px reflow ' + tag + ': dy ' + dy.toFixed(2) + 'px, dx ' + dx.toFixed(2) + 'px (tolerance 3px)');
      assert(dy <= 3 && dx <= 3, 'the spotlight did not follow the reflow: dy ' + dy.toFixed(2) + 'px, dx ' + dx.toFixed(2) + 'px');
      await page.evaluate(() => { const s = document.getElementById('reflow-shove'); if (s) s.remove(); });
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('TICK-no-repaint-under-tour' + tag, 'the 1s tick does not repaint #root while a tour is open', async () => {
      await startTour(page);
      await advanceTo(page, 2);
      await page.evaluate(() => {
        const s = document.querySelector('[data-tour-quicklog]');
        s.setAttribute('data-repaint-canary', 'alive');
      });
      await page.waitForTimeout(2300);
      const alive = await page.evaluate(() => {
        const s = document.querySelector('[data-tour-quicklog]');
        return !!s && s.getAttribute('data-repaint-canary') === 'alive';
      });
      assert(alive, 'the tree under the tour was rebuilt by the clock tick — the spotlight jumps and taps get eaten');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('TICK-drawer-survives' + tag, 'the calendar patch term still holds: a tick does not rebuild the open drawer', async () => {
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('[data-cal-drawer]').setAttribute('data-canary', 'alive'));
      await page.waitForTimeout(2300);
      const alive = await page.evaluate(() => {
        const d = document.querySelector('[data-cal-drawer]');
        return !!d && d.getAttribute('data-canary') === 'alive';
      });
      assert(alive, 'the tick rebuilt the drawer — a composed term was lost');
      await page.click('[data-cal-drawer-close]');
      await page.waitForSelector('[data-cal-drawer]', { state: 'detached', timeout: 5000 });
    });

    await rt('TYPE-appt-sheet-survives' + tag, 'the calendar patch term still holds: a tick does not rebuild the appointment sheet', async () => {
      // DISARMING THE OTHER GUARD ON PURPOSE. If focus sits in a text field, `isEditing` already
      // suppresses the repaint and this check would pass with !state.apptSheet deleted. So: wait
      // for the app's OWN focus handoff to land on the sheet container, then blur to <body>, so
      // isEditing is false and only !state.apptSheet can be doing the work.
      await openDrawer(page);
      await page.click('[data-cal-drawer-item="calendar"]');
      await page.waitForSelector('[data-cal-month-grid]', { timeout: 8000 });
      await page.click('[data-cal-add-button]');
      await page.waitForSelector('[data-cal-sheet]', { timeout: 8000 });
      await page.waitForFunction(() => document.activeElement === document.querySelector('[data-cal-sheet]'), null, { timeout: 5000 });
      await page.fill('[data-cal-sheet-title-input]', 'Half typed TOURFIXTURE');
      await page.evaluate(() => {
        document.activeElement && document.activeElement.blur();
        document.body.focus();
        document.querySelector('[data-cal-sheet]').setAttribute('data-canary', 'alive');
      });
      const tagNow = await page.evaluate(() => (document.activeElement && document.activeElement.tagName) || 'NONE');
      assert(!['INPUT', 'SELECT', 'TEXTAREA'].includes(tagNow),
        'focus is on ' + tagNow + ', so isEditing would carry this check and it would pass while disarmed');
      await page.waitForTimeout(2300);
      const state = await page.evaluate(() => {
        const s = document.querySelector('[data-cal-sheet]');
        const t = document.querySelector('[data-cal-sheet-title-input]');
        return { alive: !!s && s.getAttribute('data-canary') === 'alive', value: t ? t.value : null };
      });
      assert(state.alive, 'the tick rebuilt the appointment sheet with focus OUTSIDE a text field — !state.apptSheet was lost');
      assert(state.value === 'Half typed TOURFIXTURE', 'the half-typed title was lost: ' + JSON.stringify(state.value));
      await page.click('[data-cal-sheet-cancel]');
      await page.waitForSelector('[data-cal-sheet]', { state: 'detached', timeout: 5000 });
      await page.evaluate(() => { window.scrollTo(0, 0); });
    });

    // POSITIVE CONTROL, ADDED IN v64, AND THE THREE CHECKS ABOVE NEED IT.
    //
    // Each of those waits ~2.3 seconds and asserts a canary survived, to prove the tick did not
    // rebuild an open drawer, sheet or tour. Until v64 that was a real test: the app rebuilt the
    // whole screen once a second, so 2.3 seconds guaranteed at least two repaints to survive.
    //
    // v64 stops the repaints that change nothing a person could see, which THINS that margin —
    // but does not remove it, and the first version of this comment claimed it did. IT WAS WRONG,
    // and the correction is the point of writing it down: deleting !state.drawerOpen from the tick
    // guard on the v64 build still turns TICK-drawer-survives red (0/2, "the tick rebuilt the
    // drawer"), reproduced four times, and TYPE-appt-sheet-survives and TICK-no-repaint-under-tour
    // with it. The "0 rebuilds in 2.3s" figure is real but comes from a FROZEN clock; this suite
    // runs on the real one, where a minute turns inside the window often enough that a repaint
    // lands. So all three checks still fail when they should. A comment telling the next reader
    // that three working checks cannot fail is an invitation to delete them.
    //
    // What IS true is that the margin is now weather, not physics: those three depend on a real
    // minute happening to turn. So the BEHAVIOUR is carried by FILE-tick-guard-composed here and by
    // the identical byte-exact assertion in pm.py — the guard line cannot change without both going
    // red — and this control adds the part that can be had cheaply and deterministically: proof
    // that the app still repaints at all. A screen that never repaints would make every "survives
    // the tick" check above vacuous AND would be a far worse defect than the one v64 fixed.
    //
    // It measures the DISPLAYED CLOCK, not "some element was replaced". The equivalent control in
    // cal-test was first written the second way and PASSED against a build sabotaged to freeze the
    // screen permanently, because something else repaints during the wait.
    await rt('TICK-positive-control' + tag, 'the app still repaints: the displayed clock advances across a minute boundary', async () => {
      const readClock = () => page.evaluate(() => {
        const h = document.querySelector('header');
        return h ? ((h.innerText || '').match(/\d{1,2}:\d{2}\s*(AM|PM)?/i) || [''])[0] : 'NO HEADER';
      });
      const before = await readClock();
      assert(/\d/.test(before), 'no clock in the header to measure: ' + before);
      await page.waitForTimeout(60000 - (Date.now() % 60000) + 2500);
      const after = await readClock();
      assert(after !== before,
        'the displayed clock did not move across a minute boundary (' + before + ' -> ' + after +
        ') — the screen is stale, and every "survives the tick" check above is vacuous');
    });

    await rt('SCRIM-blocks-app' + tag, 'the backdrop stops taps reaching the app underneath', async () => {
      await startTour(page);
      await advanceTo(page, 2);
      const probe = await page.evaluate(() => {
        const s = document.querySelector('[data-tour-quicklog]');
        const r = s.getBoundingClientRect();
        // A point that is inside both the target AND the viewport, so elementFromPoint is meaningful.
        const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 4), window.innerWidth - 4));
        const y = Math.round(Math.min(Math.max(r.top + 8, 4), window.innerHeight - 4));
        const inside = y > r.top - 1 && y < r.bottom + 1;
        const el = document.elementFromPoint(x, y);
        return { inside, x, y, hit: el ? (el.closest('[data-tour-root]') ? 'tour' : el.tagName) : 'none' };
      });
      assert(probe.inside, 'the probe point fell outside the target, so this check would prove nothing: ' + JSON.stringify(probe));
      assert(probe.hit === 'tour', 'a tap over the app at ' + probe.x + ',' + probe.y + ' landed on ' + probe.hit + ' — a patient could log a real dose by touching the highlight');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('EXIT-skip-every-step' + tag, 'Skip works from all 9 steps and leaves the app fully usable', async () => {
      for (let i = 0; i < 9; i++) {
        await startTour(page);
        await advanceTo(page, i);
        assert(await stepIndex(page) === i, 'did not reach step ' + i);
        await page.click('[data-tour-skip]');
        await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
        // Usable, not merely gone: the menu button must be reachable and openable again.
        await page.click('[data-cal-menu-button]');
        await page.waitForSelector('[data-cal-drawer]', { timeout: 5000 });
        await page.click('[data-cal-drawer-close]');
        await page.waitForSelector('[data-cal-drawer]', { state: 'detached', timeout: 5000 });
      }
    });

    await rt('EXIT-back-then-skip' + tag, 'Back walks all the way to step 1 and Skip still works there', async () => {
      await startTour(page);
      await advanceTo(page, 8);
      for (let i = 8; i > 0; i--) {
        await page.click('[data-tour-back]');
        await page.waitForFunction((t) => {
          const c = document.querySelector('[data-tour-card]');
          return c && Number(c.getAttribute('data-tour-step')) === t;
        }, i - 1, { timeout: 6000 });
      }
      assert(await stepIndex(page) === 0, 'Back did not reach step 0');
      assert(await page.$('[data-tour-back]') === null, 'a Back button is present on step 0');
      await page.click('[data-tour-skip]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('EXIT-escape' + tag, 'Escape closes the tour from a mid step', async () => {
      await startTour(page);
      await advanceTo(page, 4);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('EXIT-backdrop' + tag, 'a tap on the dimmed backdrop closes the tour', async () => {
      await startTour(page);
      await advanceTo(page, 1);
      const pt = await page.evaluate(() => {
        const card = document.querySelector('[data-tour-card]').getBoundingClientRect();
        const ring = document.querySelector('[data-tour-ring]').getBoundingClientRect();
        // A point that is on neither the card nor the highlighted target.
        for (let y = window.innerHeight - 20; y > 20; y -= 10) {
          for (let x = 20; x < window.innerWidth - 20; x += 30) {
            const onCard = x >= card.left && x <= card.right && y >= card.top && y <= card.bottom;
            const onRing = x >= ring.left && x <= ring.right && y >= ring.top && y <= ring.bottom;
            if (!onCard && !onRing) return { x, y };
          }
        }
        return null;
      });
      assert(pt, 'could not find a backdrop point clear of the card and the highlight');
      await page.mouse.click(pt.x, pt.y);
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('EXIT-close-x' + tag, 'the X in the card closes the tour', async () => {
      await startTour(page);
      await advanceTo(page, 6);
      await page.click('[data-tour-close]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('EXIT-restores-view' + tag, 'leaving the tour puts the screen back where it was started from', async () => {
      // From Home.
      await startTour(page);
      await advanceTo(page, 7); // sits in Reports
      await page.click('[data-tour-skip]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
      await page.waitForSelector('[data-tour-quicklog]', { timeout: 5000 });
      // From a report detail: the exact report must come back, not just the Reports menu.
      await openDrawer(page);
      await page.click('[data-cal-drawer-item="reports"]');
      await page.waitForSelector('[data-tour-reports]', { timeout: 8000 });
      await page.click('[data-tour-reports] button');
      await page.waitForTimeout(300);
      const beforeText = await page.evaluate(() => !!document.querySelector('[data-tour-reports]'));
      assert(beforeText === false, 'expected to be inside a report detail, not the reports menu');
      await startTour(page);
      await advanceTo(page, 3);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
      const back = await page.evaluate(() => ({
        onMenu: !!document.querySelector('[data-tour-reports]'),
        onHome: !!document.querySelector('[data-tour-quicklog]')
      }));
      assert(!back.onHome && !back.onMenu, 'the report detail was not restored (home=' + back.onHome + ', menu=' + back.onMenu + ')');
      // Put the app back on Home for the checks that follow.
      await openDrawer(page);
      await page.click('[data-cal-drawer-item="home"]');
      await page.waitForSelector('[data-tour-quicklog]', { timeout: 5000 });
    });

    await rt('STUCK-double-taps-and-restarts' + tag, 'double-tapping Skip, the X and the menu row never leaves anything stuck', async () => {
      for (const sel of ['[data-tour-skip]', '[data-tour-close]']) {
        await startTour(page);
        await advanceTo(page, 3);
        await page.evaluate((s) => { const b = document.querySelector(s); b.click(); b.click(); }, sel);
        await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
        assert(await page.$('[data-tour-root]') === null, 'a tour root survived a double ' + sel);
      }
      // Double-tap the drawer row itself.
      await openDrawer(page);
      await page.evaluate(() => { const b = document.querySelector('[data-tour-drawer-item]'); b.click(); b.click(); });
      await page.waitForSelector('[data-tour-card]', { timeout: 5000 });
      const roots = await page.evaluate(() => document.querySelectorAll('[data-tour-root]').length);
      assert(roots === 1, 'a double tap on the menu row produced ' + roots + ' tour overlays');
      assert(await stepIndex(page) === 0, 'a double tap on the menu row skipped a step');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
      // And it re-runs cleanly a third time.
      await startTour(page);
      assert(await stepIndex(page) === 0, 'the re-run did not start at step 1');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('SYNC-tour-survives-snapshot' + tag, 'a Firestore snapshot mid-tour rebuilds the app without destroying the tour or its focus', async () => {
      await startTour(page);
      await advanceTo(page, 2);
      await page.evaluate(() => document.querySelector('[data-tour-next]').focus());
      await page.evaluate(() => {
        globalThis.__tourStub.push({ medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: Date.now(), loggedAt: Date.now() });
      });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const card = document.querySelector('[data-tour-card]');
        if (!card) return { gone: true };
        const a = document.querySelector('[data-tour-quicklog]');
        const r = document.querySelector('[data-tour-ring]').getBoundingClientRect();
        const ar = a.getBoundingClientRect();
        return {
          gone: false,
          step: Number(card.getAttribute('data-tour-step')),
          insideRoot: !!card.closest('#root'),
          focusInTour: !!(document.activeElement && document.activeElement.closest('[data-tour-card]')),
          anchorTop: ar.top, anchorLeft: ar.left,
          dy: Math.abs(r.top - (ar.top - 6)), dx: Math.abs(r.left - (ar.left - 6))
        };
      });
      assert(!after.gone, 'a live snapshot destroyed the tour');
      assert(!after.insideRoot, 'the tour is mounted inside #root, which render() wipes');
      assert(after.step === 2, 'the tour jumped to step ' + after.step);
      assert(after.focusInTour, 'the repaint pulled focus out of the tour');
      // The ring insets by 6px and clamps at the viewport edge, so a clamped target would make
      // the arithmetic meaningless. Require the target's top-left to be genuinely on screen.
      assert(after.anchorTop > 8 && after.anchorLeft > 8,
        'the target was clamped against the viewport edge (' + after.anchorTop.toFixed(1) + ',' +
        after.anchorLeft.toFixed(1) + '), so this check would prove nothing');
      assert(after.dy <= 3 && after.dx <= 3, 'the spotlight did not re-glue after the repaint: dy ' + after.dy.toFixed(1) + ', dx ' + after.dx.toFixed(1));
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
    });

    await rt('TOUR-no-writes' + tag, 'a full run of the tour issues zero Firestore writes', async () => {
      await page.evaluate(() => globalThis.__tourStub.reset());
      await startTour(page);
      for (let i = 0; i < 8; i++) { await page.click('[data-tour-next]'); await page.waitForTimeout(90); }
      await page.click('[data-tour-next]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
      const rec = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__tourStub.rec)));
      assert(rec.addDoc.length === 0, 'the tour wrote ' + rec.addDoc.length + ' document(s): ' + JSON.stringify(rec.addDoc));
      assert(rec.deleteDoc.length === 0, 'the tour deleted ' + rec.deleteDoc.length + ' document(s)');
      assert(rec.setDoc.length === 0, 'the tour wrote prefs: ' + JSON.stringify(rec.setDoc));
    });

    await rt('ERR-no-page-errors' + tag, 'no uncaught page error during any of the above', () => {
      assert(pageErrors.length === 0, 'uncaught page errors: ' + pageErrors.join(' | '));
    });
  } finally {
    await context.close();
  }
}

// A separate page: Firestore offline, prefs never resolve, every write rejected, nothing logged.
async function runOfflineChecks(suite, browser, url, vp, net) {
  const tag = '@offline-' + vp.name;
  const { context, page, pageErrors } = await newPage(browser, url, vp, net, fixtureOffline());
  const rt = (id, desc, fn) => suite.run(id, desc, async () => { await hardReset(page); await fn(); });
  try {
    await rt('OFFLINE-full-run' + tag, 'the whole tour runs with prefs never loading, writes rejected and nothing logged', async () => {
      assert(await page.$('[data-tour-root]') === null, 'a tour appeared on its own on an offline build');
      await startTour(page);
      for (let i = 0; i < 9; i++) {
        const info = await page.evaluate(() => {
          const c = document.querySelector('[data-tour-card]');
          if (!c) return null;
          const cr = c.getBoundingClientRect();
          return {
            i: Number(c.getAttribute('data-tour-step')), key: c.getAttribute('data-tour-key'),
            title: (c.querySelector('[data-tour-title]') || {}).textContent || '',
            l: cr.left, t: cr.top, r: cr.right, b: cr.bottom, vw: window.innerWidth, vh: window.innerHeight
          };
        });
        assert(info, 'the tour vanished at step ' + i + ' on an offline build');
        assert(info.i === i, 'step index ' + info.i + ', expected ' + i);
        assertGte(info.title.length, 4, 'step ' + info.key + ' lost its title offline');
        assert(info.l >= 0 && info.t >= 0 && info.r <= info.vw + 0.5 && info.b <= info.vh + 0.5,
          'the card fell off screen offline on step ' + info.key);
        if (i < 8) { await page.click('[data-tour-next]'); await page.waitForTimeout(120); }
      }
      await page.click('[data-tour-next]');
      await page.waitForSelector('[data-tour-root]', { state: 'detached', timeout: 5000 });
      await page.click('[data-cal-menu-button]');
      await page.waitForSelector('[data-cal-drawer]', { timeout: 5000 });
    });

    await rt('OFFLINE-no-errors' + tag, 'no uncaught page error on the offline build', () => {
      assert(pageErrors.length === 0, 'uncaught page errors offline: ' + pageErrors.join(' | '));
    });
  } finally {
    await context.close();
  }
}

async function runNetworkChecks(suite, net) {
  await suite.run('NET-1-no-real-firestore', 'the only requests ALLOWED out were loopback; every external one was refused', () => {
    // `blocked` is the list of requests that were REFUSED, which is the safe outcome -- the base
    // app links Google Fonts and that link is aborted every run. What must be true is that nothing
    // was ever ALLOWED to leave except loopback, and that the three Firebase modules were served
    // from the stubs rather than from gstatic.
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
// main
// =================================================================================================

function report(title, suite) {
  const failed = suite.failed();
  console.log('\n' + '='.repeat(96));
  console.log(title);
  console.log('='.repeat(96));
  for (const r of suite.results) console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + '  —  ' + r.desc + (r.ok ? '' : '\n          ' + r.err));
  console.log('-'.repeat(96));
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
  HTML_UNDER_TEST = html;
  const server = await startServer(() => html);
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  try {
    await runFileChecks(suite, html);
    for (const vp of VIEWPORTS) await runRuntimeChecks(suite, browser, url, vp, net);
    await runOfflineChecks(suite, browser, url, VIEWPORTS[0], net);
    await runNetworkChecks(suite, net);
  } finally {
    await new Promise(r => server.close(r));
  }
  return suite;
}

async function main() {
  const html = fs.readFileSync(APP_FILE, 'utf-8');
  console.log('tour-test.mjs');
  console.log('  app file : ' + APP_FILE);
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
        if (process.env.DUMP_MUTANTS) fs.writeFileSync('/tmp/dump-' + m.name + '.html', mutated);
        const s = await runSuite(browser, mutated);
        const failedIds = s.failed().map(r => r.id);
        const missing = m.expect.filter(e => !failedIds.some(id => id === e || id.startsWith(e + '@')));
        rows.push({ m, ok: missing.length === 0, failedIds, missing });
      }
      console.log('\n' + '='.repeat(96));
      console.log('FALSIFICATION — break it, confirm RED, restore');
      console.log('='.repeat(96));
      for (const r of rows) {
        console.log((r.ok ? '  RED (good)  ' : '  NOT RED     ') + r.m.name);
        console.log('               ' + r.m.why);
        console.log('               expected to fail: ' + r.m.expect.join(', '));
        if (r.note) console.log('               ' + r.note);
        else console.log('               actually failed: ' + (r.failedIds.length ? r.failedIds.join(', ') : '(nothing — the check does not work)'));
        if (!r.ok && r.missing && r.missing.length) console.log('               DID NOT GO RED: ' + r.missing.join(', '));
      }
      const bad = rows.filter(r => !r.ok);
      console.log('-'.repeat(96));
      console.log('  ' + (rows.length - bad.length) + '/' + rows.length + ' guards proved falsifiable' + (BATCH ? '  (batch ' + BATCH.join('-') + ' of ' + MUTATORS.length + ')' : ''));
      exit = bad.length ? 1 : 0;
    }
  } finally {
    await browser.close();
  }
  return exit;
}

main().then(c => process.exit(c)).catch(e => { console.error(e); process.exit(2); });
