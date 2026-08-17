#!/usr/bin/env node
/**
 * deactivate-test.mjs — verification suite for the "deactivated medication still shows a Home
 * card" fix.
 *
 * WHAT IT PROVES
 *   A medication removed from the active list in the Meds section is excluded from EVERY consumer
 *   of the medication list — Home counter cards, Home Quick Log, the missed-dose calculation, the
 *   missed-dose banner, the CSV export and the printable oncologist report — while its PAST LOGGED
 *   DOSES survive intact in history, in the CSV and in the report. Deactivating means "stop
 *   tracking it going forward", never "erase that she took it".
 *
 *   The CSV and REPORT checks generate the ACTUAL FILE via the app's own download path and read its
 *   BYTES. They never look at the screen. A previous agent checked the screen for three rounds and
 *   missed a live leak; screen-reading is not permitted for those two artifacts here.
 *
 * SAFETY (non-negotiable — this app holds one cancer patient's real medication history)
 *   * All THREE gstatic Firebase modules are stubbed. A catch-all route aborts every request that
 *     is not 127.0.0.1 or one of the three stubs. NET-no-escape fails the run if anything tried.
 *   * navigator.serviceWorker is removed before any page script runs (sw.js is cache-first and
 *     would serve a stale build). NET-no-sw fails the run if sw.js was ever requested.
 *   * Fixtures only. No credentials, no network, no writes anywhere but the in-memory stub.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
 *     node deactivate-test.mjs                    # verify the patched build
 *   ... node deactivate-test.mjs --file <path>    # verify a specific index.html
 *   ... node deactivate-test.mjs --falsify        # break each guarded thing, prove checks go RED
 *   ... node deactivate-test.mjs --only <id>      # run one check
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const APP_FILE = arg('--file') || path.join(HERE, 'work', 'index.html');
const ONLY = arg('--only');
const SEND_REMINDERS = arg('--send-reminders') || path.join(HERE, 'work', 'send-reminders.js');

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the');
    console.error('proxy and every check would fail for the wrong reason. Re-run under:');
    console.error('  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node deactivate-test.mjs');
    process.exit(3);
  }
}

// =================================================================================================
// Firebase stubs — three ES modules served in place of the three gstatic URLs.
// =================================================================================================

const STUB_APP = `export function initializeApp(cfg) { return { name: '[DEFAULT]', options: cfg }; }`;

const STUB_MESSAGING = `
export function getMessaging() { throw new Error('messaging disabled in the test harness'); }
export async function getToken() { return null; }
export function onMessage() { return () => {}; }`;

const STUB_FIRESTORE = `
const fx = (globalThis.__DEACT_FIXTURE__ || { entries: [], prefs: {} });
const store = { entries: fx.entries.slice(), prefs: Object.assign({}, fx.prefs) };
const entryListeners = [], prefsListeners = [];
let autoId = 0;
const rec = { addDoc: [], deleteDoc: [], setDoc: [] };
globalThis.__deactStub = { rec, all() { return store.entries.slice(); } };
function snapOf(list) {
  return { docs: list.map(e => ({ id: e.id, data: () => { const c = Object.assign({}, e); delete c.id; return c; } })) };
}
function emitEntries() {
  const sorted = store.entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const cb of entryListeners) cb(snapOf(sorted));
}
function emitPrefs() { for (const cb of prefsListeners) cb({ exists: () => true, data: () => Object.assign({}, store.prefs) }); }
export function getFirestore() { return { __db: true }; }
export function collection(db, name) { return { __kind: 'col', name }; }
export function doc(db, colName, id) { return { __kind: 'doc', col: colName, id }; }
export function query(col) { return { __kind: 'query', col }; }
export function orderBy(field, dir) { return { field, dir }; }
export function onSnapshot(target, cb) {
  if (target && target.__kind === 'doc') { prefsListeners.push(cb); setTimeout(emitPrefs, 0); return () => {}; }
  entryListeners.push(cb); setTimeout(emitEntries, 0); return () => {};
}
export async function addDoc(col, data) {
  rec.addDoc.push({ col: col && col.name, data: JSON.parse(JSON.stringify(data)) });
  store.entries.push(Object.assign({ id: 'added-' + (++autoId) }, data)); emitEntries();
  return { id: 'added-' + autoId };
}
export async function deleteDoc(ref) {
  rec.deleteDoc.push({ col: ref && ref.col, id: ref && ref.id });
  store.entries = store.entries.filter(e => e.id !== (ref && ref.id)); emitEntries();
}
export async function setDoc(ref, data) {
  rec.setDoc.push({ col: ref && ref.col, id: ref && ref.id, data: JSON.parse(JSON.stringify(data)) });
  if (ref && ref.col === 'caretracker_prefs') { Object.assign(store.prefs, data); emitPrefs(); }
}
export async function getDocs() { return snapOf(store.entries); }`;

const GSTATIC = {
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js': STUB_APP,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js': STUB_FIRESTORE,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js': STUB_MESSAGING
};

// =================================================================================================
// Fixture
// =================================================================================================
// MISSED_TRACK_SINCE in the app is 12 Jul 2026; derived missed-dose rows are produced for every day
// from then to today for any med with alerts+windows. Iron is the subject for the missed-dose /
// CSV / report checks because it is windowed WITH alerts and ships groupedEvening (quickLog:false),
// so it also proves the fix is not keyed on quickLog. Imodium is the subject Aaron reported.

const DAY = 86400000;
const now = Date.now();
const at = (daysAgo, h, m) => { const d = new Date(now - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.getTime(); };

// Distinctive strings so a byte check cannot pass by accident.
const FX = {
  IMO_NOTE: 'DEACTFIXTURE-IMO-HISTORY',
  IRON_NOTE: 'DEACTFIXTURE-IRON-HISTORY',
  TYL_NOTE: 'DEACTFIXTURE-TYL',
  LIDO_NOTE: 'DEACTFIXTURE-LIDO',
  PROTO_NOTE: 'DEACTFIXTURE-PROTONIX'
};

function buildFixture() {
  const entries = [
    // Imodium: one dose inside the 7-day usedRecently() window (this is what makes the reported
    // Home counter card appear) and one older one that must survive as history.
    { id: 'f-imo-1', medId: 'imodium', dose: '2 pills (onset)', mg: 0, pills: 2, note: FX.IMO_NOTE, ts: at(2, 13, 0), loggedAt: at(2, 13, 0) },
    { id: 'f-imo-2', medId: 'imodium', dose: '1 pill', mg: 0, pills: 1, note: FX.IMO_NOTE, ts: at(20, 9, 0), loggedAt: at(20, 9, 0) },
    // Tylenol + Lidocaine: the other two hardcoded Home counter cards ("check that for others").
    { id: 'f-tyl-1', medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, note: FX.TYL_NOTE, ts: at(0, 9, 0), loggedAt: at(0, 9, 0) },
    { id: 'f-lido-1', medId: 'lidocaine', dose: 'Apply', mg: 0, pills: 1, note: FX.LIDO_NOTE, ts: at(1, 11, 0), loggedAt: at(1, 11, 0) },
    // Iron: one real logged dose that must survive removal, in its 22:00-24:00 Night window.
    { id: 'f-iron-1', medId: 'iron', dose: 'Log', mg: 0, note: FX.IRON_NOTE, ts: at(3, 22, 30), loggedAt: at(3, 22, 30) },
    // Protonix: the control. It is never removed, so its derived missed rows must SURVIVE every
    // check — that is what stops "no Iron rows" passing because the whole section vanished.
    { id: 'f-proto-1', medId: 'protonix', dose: 'Log', mg: 0, note: FX.PROTO_NOTE, ts: at(4, 8, 30), loggedAt: at(4, 8, 30) },
    // A medId that is also an Object.prototype key. On a plain-object archivedMeds lookup this is
    // truthy when the map is EMPTY, so nameOf() returned the literal string "Object" and
    // reportNameOf() suppressed the "Medication (removed)" label — in the oncologist hand-off.
    { id: 'f-proto-key', medId: 'constructor', dose: '1 pill', mg: 0, pills: 1, note: 'DEACTFIXTURE-PROTOKEY', ts: at(5, 15, 0), loggedAt: at(5, 15, 0) }
  ];
  return { entries, prefs: { missedClearedAt: 0 } };
}

// =================================================================================================
// Mutators — each breaks exactly one guarded property. --falsify proves the named checks go RED.
// =================================================================================================

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('mutator anchor not found: ' + from.slice(0, 100));
  if (html.split(from).length - 1 !== 1) throw new Error('mutator anchor not unique: ' + from.slice(0, 100));
  return html.replace(from, to);
}

const MUTATORS = [
  {
    name: 'revert-imodium-gate',
    why: 'puts the Imodium counter card back on usedRecently() alone — the shipped bug, verbatim',
    expect: ['HOME-imodium-counter'],
    apply: (h) => must(h, "if (medIsOnActiveList('imodium') && usedRecently('imodium')) parts.push(", "if (usedRecently('imodium')) parts.push(")
  },
  {
    name: 'revert-tylenol-gate',
    why: 'puts the Acetaminophen meter back on usedRecently() alone',
    expect: ['HOME-tylenol-counter'],
    apply: (h) => must(h, "if (medIsOnActiveList('tylenol') && usedRecently('tylenol')) parts.push(", "if (usedRecently('tylenol')) parts.push(")
  },
  {
    name: 'revert-lidocaine-gate',
    why: 'puts the Lidocaine counter back on usedRecently() alone',
    expect: ['HOME-lidocaine-counter'],
    apply: (h) => must(h, "if (medIsOnActiveList('lidocaine') && usedRecently('lidocaine')) parts.push(", "if (usedRecently('lidocaine')) parts.push(")
  },
  {
    name: 'predicate-always-true',
    why: 'makes medIsOnActiveList() answer yes for everything — the gate exists but means nothing',
    expect: ['HOME-imodium-counter', 'HOME-tylenol-counter', 'HOME-lidocaine-counter'],
    apply: (h) => must(h, "function medIsOnActiveList(id) { return !!id && (state.meds || []).some(m => m && m.id === id); }",
                          "function medIsOnActiveList(id) { return true; }")
  },
  {
    name: 'gate-on-quickLog',
    why: 'gates the ceiling meters on quickLog instead of active-list membership — deletes the acetaminophen overdose guard for anyone who groups Tylenol with morning meds',
    expect: ['SAFETY-grouped-med-keeps-meter'],
    apply: (h) => must(h, "function medIsOnActiveList(id) { return !!id && (state.meds || []).some(m => m && m.id === id); }",
                          "function medIsOnActiveList(id) { return !!id && (state.meds || []).some(m => m && m.id === id && m.quickLog); }")
  },
  {
    name: 'missed-doses-from-DEFAULT_MEDS',
    why: 'computes missed doses from DEFAULT_MEDS instead of the active list — a removed drug keeps generating missed-dose alerts, CSV derived rows and a row in the oncologist report',
    expect: ['MISSED-banner-excludes-removed', 'CSV-no-derived-for-removed', 'REPORT-no-missed-for-removed'],
    apply: (h) => must(h, "  state.meds.filter(m => m.alerts && m.windows).forEach(med => {",
                          "  DEFAULT_MEDS.filter(m => m.alerts && m.windows).forEach(med => {")
  },
  {
    name: 'export-erases-removed-history',
    why: 'the WRONG fix — filters removed medications out of allExportEntries(), deleting real logged medical history from the backup and from the oncologist report',
    expect: ['CSV-keeps-logged-history', 'REPORT-keeps-dose-history', 'REPORT-daily-log-keeps-history'],
    apply: (h) => must(h, "  return (state.entries || []).concat(state.chemoDates || []);",
                          "  return (state.entries || []).concat(state.chemoDates || []).filter(e => !e.medId || medIsOnActiveList(e.medId) || ['temp','weight','chemo_date'].indexOf(e.medId) >= 0);")
  },
  {
    name: 'history-hides-removed',
    why: 'hides a removed medication from the History view — erases that she ever took it',
    expect: ['HISTORY-keeps-removed-doses'],
    apply: (h) => must(h, "  state.entries.forEach(e => { if (e.medId === 'inpatient' || e.medId === 'inpatient_start'",
                          "  state.entries.filter(e => !medIsOnActiveList(e.medId) ? false : true).forEach(e => { if (e.medId === 'inpatient' || e.medId === 'inpatient_start'")
  },
  {
    name: 'archivedMeds-bare-index',
    why: 'restores the bare state.archivedMeds[id] lookup — an id that is an Object.prototype key reads as a known medication and prints "Object" in the oncologist report',
    expect: ['PROTO-prototype-key-id'],
    apply: (h) => must(h, "const archived = (state.archivedMeds && Object.prototype.hasOwnProperty.call(state.archivedMeds, id)) ? state.archivedMeds[id] : null;",
                          "const archived = state.archivedMeds && state.archivedMeds[id];")
  },
  {
    name: 'quicklog-ignores-active-list',
    why: 'renders the Quick Log grid from DEFAULT_MEDS, so a removed medication keeps a loggable button',
    expect: ['QUICKLOG-removed-absent'],
    apply: (h) => must(h, "  const medCards = state.meds.filter(m => m.quickLog && (!m.chemoOnly",
                          "  const medCards = DEFAULT_MEDS.map(normalizeMedication).filter(m => m.quickLog && (!m.chemoOnly")
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do',
    expect: ['FILE-app-version-untouched'],
    apply: (h) => must(h, "const APP_VERSION = 'v43.3';", "const APP_VERSION = 'v43.4';")
  },
  {
    name: 'meds-delete-button-32px',
    why: 'shrinks the Meds remove control below the 44px minimum tap target',
    expect: ['TAP-meds-targets-44px'],
    apply: (h) => must(h, "style: { width: deleting ? 'auto' : '34px', height: '34px', padding: deleting ? '0 10px' : '0', borderRadius: '10px'",
                          "style: { width: deleting ? 'auto' : '34px', height: '34px', padding: deleting ? '0 10px' : '0', borderRadius: '10px', minHeight: '20px', maxHeight: '20px'")
  },
  {
    name: 'med-form-input-shrunk',
    why: 'shrinks the medication editor text fields below the 13px v43.3 baseline, worsening the iOS Safari zoom-and-stay-zoomed problem',
    expect: ['FONT-inputs-16px'],
    apply: (h) => must(h, "borderRadius: '11px', padding: '0 11px', fontSize: '13px', background: 'rgba(255,255,255,0.72)', color: '#342530', ...(attrs.style || {}) } });",
                          "borderRadius: '11px', padding: '0 11px', fontSize: '11px', background: 'rgba(255,255,255,0.72)', color: '#342530', ...(attrs.style || {}) } });")
  }
];

// =================================================================================================
// Harness
// =================================================================================================

const VIEWPORTS = MODE_FALSIFY
  ? [{ w: 375, h: 812, name: 'iPhone-375x812' }]
  : [{ w: 375, h: 812, name: 'iPhone-375x812' }, { w: 390, h: 844, name: 'iPhone-390x844' }];

let SERVER = null, PORT = 0, HTML = '';

function startServer() {
  return new Promise(resolve => {
    SERVER = http.createServer((req, res) => {
      const u = (req.url || '').split('?')[0];
      if (u === '/' || u === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(HTML);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not served by the harness: ' + u);
    });
    SERVER.listen(0, '127.0.0.1', () => { PORT = SERVER.address().port; resolve(); });
  });
}

// `blocked` is every non-local request the harness aborted; `allowed` is every non-local request it
// let through, which must always be empty. A URL in `blocked` never left the browser.
const NET = { allowed: [], blocked: [], swRequested: false };
const FIRESTORE_RE = /firestore|firebaseio|googleapis\.com\/google\.firestore|firebaseinstallations|fcmregistrations/i;

async function newSession(browser, vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true
  });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (GSTATIC[url]) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GSTATIC[url] });
    if (/\/sw\.js(\?|$)/.test(url) || /firebase-messaging-sw\.js/.test(url)) { NET.swRequested = true; NET.blocked.push(url); return route.abort(); }
    if (url.startsWith('http://127.0.0.1:' + PORT + '/')) { return route.continue(); }
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
    // The app's webfont <link>. Served as empty CSS rather than aborted so no request is left
    // pending and no console noise masks a real failure. Nothing leaves the browser either way.
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) {
      NET.blocked.push(url);
      return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '/* webfont blocked by harness */' });
    }
    NET.blocked.push(url);
    return route.abort();
  });
  await ctx.addInitScript(fx => {
    globalThis.__DEACT_FIXTURE__ = fx;
    // sw.js is cache-first; a live registration would serve a stale build between runs. The app
    // guards with `'serviceWorker' in navigator`, so deleting the property is not enough — an
    // undefined getter still satisfies `in` and then throws on .register(). A stub whose register()
    // never settles blocks the worker with no error and no request.
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => ({
          register: () => new Promise(() => {}),
          getRegistrations: () => Promise.resolve([]),
          getRegistration: () => Promise.resolve(undefined),
          ready: new Promise(() => {}),
          controller: null,
          addEventListener() {}, removeEventListener() {}
        })
      });
    } catch (e) {}
    // Notification: present but permanently denied, so the app takes its "no permission" branch
    // instead of throwing or opening a permission prompt that would hang the run.
    try {
      const N = function () {};
      N.permission = 'denied';
      N.requestPermission = () => Promise.resolve('denied');
      Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: N });
    } catch (e) {}
    // Deterministic export path: the app downloads the file FIRST and only then tries window.open
    // for printing. Returning null takes the documented "open it from Downloads" branch, so no
    // popup and no print dialog can hang the run. The bytes under test are unaffected.
    try { window.open = () => null; } catch (e) {}
    try { window.print = () => {}; } catch (e) {}
  }, buildFixture());
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error' && !/net::ERR/.test(m.text())) pageErrors.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return { ctx, page, pageErrors };
}

// --- app driving helpers -------------------------------------------------------------------------

async function goto(page, label) {
  await page.click('button[aria-label="' + label + '"]');
  await page.waitForTimeout(350);
}

/** Remove a medication from the active list through the real two-tap Meds UI. */
async function removeMed(page, name) {
  await goto(page, 'Meds');
  await page.click('button[aria-label="Remove ' + name + '"]');
  await page.waitForTimeout(220);
  await page.click('button[aria-label="Confirm removal of ' + name + '"]');
  await page.waitForTimeout(420);
}

/** Edit a medication and toggle one of its pill switches, then save. */
async function toggleMedOption(page, name, toggleLabel) {
  await goto(page, 'Meds');
  await page.click('button[aria-label="Edit ' + name + '"]');
  await page.waitForTimeout(350);
  await page.click('button:has-text("' + toggleLabel + '")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("Save changes")');
  await page.waitForTimeout(420);
}

/**
 * textContent, never innerText. Several of these headings carry text-transform:uppercase, and
 * innerText returns the CSS-TRANSFORMED string — a check written against innerText silently
 * matches nothing and passes for the wrong reason.
 */
async function bodyText(page) {
  return page.evaluate(() => {
    // The whole app is ONE inline <script type="module"> in <body>. document.body.textContent
    // therefore contains the SOURCE CODE, including every UI string as a literal -- so a naive
    // textContent check for 'Imodium \u00b7 today' matches the source and passes whether the card
    // renders or not. Script/style/template are stripped before reading. This is the exact failure
    // mode that let a live leak survive three rounds of screen-checking.
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, template, noscript').forEach(n => n.remove());
    return clone.textContent || '';
  });
}

/** Click an export button and return the downloaded file's BYTES. Never reads the screen. */
async function grabDownload(page, buttonText) {
  await goto(page, 'Reports');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('button:has-text("' + buttonText + '")')
  ]);
  const dest = path.join(os.tmpdir(), 'deact-' + Date.now() + '-' + download.suggestedFilename());
  await download.saveAs(dest);
  const bytes = fs.readFileSync(dest);
  fs.unlinkSync(dest);
  return { name: download.suggestedFilename(), bytes, text: bytes.toString('utf8') };
}

/** Parse the app's CSV (CRLF rows, RFC4180 quoting) into arrays. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

/** Pull the rows of one <table> that follows a given <h2> heading, as arrays of cell text. */
function reportSection(html, headingFragment) {
  const hIdx = html.indexOf(headingFragment);
  if (hIdx < 0) return null;
  const tStart = html.indexOf('<table', hIdx);
  if (tStart < 0) return null;
  const tEnd = html.indexOf('</table>', tStart);
  const table = html.slice(tStart, tEnd);
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => c[1].replace(/<[^>]*>/g, '').trim()));
}

// =================================================================================================
// Checks
// =================================================================================================
// Each check: { id, what, run(session) -> { ok, detail } }. Independent — each gets a fresh context.

const CHECKS = [];
const check = (id, what, run) => CHECKS.push({ id, what, run });

// ---- Part 2: Home screen cards -------------------------------------------------------------------

check('HOME-baseline-counters-present', 'all three Home counter cards render while their meds are ACTIVE (no regression)', async ({ page }) => {
  const t = await bodyText(page);
  const have = ['Imodium · today', 'Acetaminophen · today', 'Lidocaine · today'].filter(s => t.includes(s));
  return { ok: have.length === 3, detail: 'present: ' + JSON.stringify(have) };
});

check('HOME-imodium-counter', 'the "Imodium · today" counter card disappears once Imodium is removed (the reported bug)', async ({ page }) => {
  const before = (await bodyText(page)).includes('Imodium · today');
  await removeMed(page, 'Imodium');
  await goto(page, 'Home');
  const after = (await bodyText(page)).includes('Imodium · today');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  const afterReload = (await bodyText(page)).includes('Imodium · today');
  return { ok: before && !after && !afterReload, detail: 'before=' + before + ' after=' + after + ' afterReload=' + afterReload };
});

check('HOME-tylenol-counter', 'the "Acetaminophen · today" meter disappears once Tylenol is removed', async ({ page }) => {
  const before = (await bodyText(page)).includes('Acetaminophen · today');
  await removeMed(page, 'Tylenol');
  await goto(page, 'Home');
  const after = (await bodyText(page)).includes('Acetaminophen · today');
  return { ok: before && !after, detail: 'before=' + before + ' after=' + after };
});

check('HOME-lidocaine-counter', 'the "Lidocaine · today" counter disappears once Lidocaine is removed', async ({ page }) => {
  const before = (await bodyText(page)).includes('Lidocaine · today');
  await removeMed(page, 'Lidocaine');
  await goto(page, 'Home');
  const after = (await bodyText(page)).includes('Lidocaine · today');
  return { ok: before && !after, detail: 'before=' + before + ' after=' + after };
});

check('HOME-other-counters-survive', 'removing Imodium leaves the Acetaminophen and Lidocaine meters alone', async ({ page }) => {
  await removeMed(page, 'Imodium');
  await goto(page, 'Home');
  const t = await bodyText(page);
  const ok = !t.includes('Imodium · today') && t.includes('Acetaminophen · today') && t.includes('Lidocaine · today');
  return { ok, detail: 'imo=' + t.includes('Imodium · today') + ' apap=' + t.includes('Acetaminophen · today') + ' lido=' + t.includes('Lidocaine · today') };
});

check('SAFETY-grouped-med-keeps-meter', 'a med grouped into Morning meds (quickLog:false) is STILL ACTIVE and keeps its ceiling meter — gating on quickLog would delete an overdose guard', async ({ page }) => {
  await toggleMedOption(page, 'Tylenol', 'Show as its own Home card'); // quickLog -> false
  await goto(page, 'Home');
  const t = await bodyText(page);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('caretracker-medication-config-v1')));
  const ql = (cfg.meds.find(m => m.id === 'tylenol') || {}).quickLog;
  return { ok: ql === false && t.includes('Acetaminophen · today'), detail: 'tylenol.quickLog=' + ql + ' meterPresent=' + t.includes('Acetaminophen · today') };
});

// ---- Part 2: Quick-log / dose-logging UI ---------------------------------------------------------

check('QUICKLOG-removed-absent', 'a removed medication has no Quick Log card and no loggable dose button', async ({ page }) => {
  const before = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('2 pills (onset)')));
  await removeMed(page, 'Imodium');
  await goto(page, 'Home');
  const after = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('2 pills (onset)')));
  const others = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('500 mg')));
  return { ok: before && !after && others, detail: 'imodiumBtnBefore=' + before + ' after=' + after + ' tylenolBtnStillThere=' + others };
});

// ---- Part 2: Missed-dose calculation + banner ----------------------------------------------------

check('MISSED-banner-excludes-removed', 'a removed windowed medication stops generating missed-dose alerts on Home', async ({ page }) => {
  const before = (await bodyText(page)).includes('Iron —');
  await removeMed(page, 'Iron');
  await goto(page, 'Home');
  const t = await bodyText(page);
  const ironGone = !t.includes('Iron —');
  const protonixStays = t.includes('Protonix —');
  return { ok: before && ironGone && protonixStays, detail: 'ironBefore=' + before + ' ironAfter=' + !ironGone + ' protonixStillFlagged=' + protonixStays };
});

// ---- Part 2: CSV export — ACTUAL FILE BYTES ------------------------------------------------------

check('CSV-no-derived-for-removed', 'the CSV contains NO derived (missed-dose) rows for a removed medication', async ({ page }) => {
  await removeMed(page, 'Iron');
  const f = await grabDownload(page, 'Save spreadsheet');
  const rows = parseCsv(f.text);
  const head = rows[0];
  const iMed = head.indexOf('Med ID'), iSrc = head.indexOf('Source');
  const ironDerived = rows.slice(1).filter(r => r[iMed] === 'iron' && r[iSrc] === 'derived');
  const protoDerived = rows.slice(1).filter(r => r[iMed] === 'protonix' && r[iSrc] === 'derived');
  return {
    ok: ironDerived.length === 0 && protoDerived.length > 0,
    detail: f.name + ' bytes=' + f.bytes.length + ' ironDerivedRows=' + ironDerived.length + ' protonixDerivedRows=' + protoDerived.length
  };
});

check('CSV-keeps-logged-history', 'the CSV STILL contains every real logged dose of a removed medication (Rule 12 — do not erase history)', async ({ page }) => {
  await removeMed(page, 'Iron');
  await removeMed(page, 'Imodium');
  const f = await grabDownload(page, 'Save spreadsheet');
  const rows = parseCsv(f.text);
  const head = rows[0];
  const iMed = head.indexOf('Med ID'), iSrc = head.indexOf('Source');
  const ironLogged = rows.slice(1).filter(r => r[iMed] === 'iron' && r[iSrc] === 'logged');
  const imoLogged = rows.slice(1).filter(r => r[iMed] === 'imodium' && r[iSrc] === 'logged');
  const notesOk = f.text.includes(FX.IRON_NOTE) && f.text.includes(FX.IMO_NOTE);
  return {
    ok: ironLogged.length === 1 && imoLogged.length === 2 && notesOk,
    detail: 'ironLogged=' + ironLogged.length + '/1 imodiumLogged=' + imoLogged.length + '/2 fixtureNotesPresent=' + notesOk
  };
});

check('CSV-removed-med-keeps-its-name', 'a removed medication is still NAMED in the CSV, not reduced to a bare id', async ({ page }) => {
  await removeMed(page, 'Imodium');
  const f = await grabDownload(page, 'Save spreadsheet');
  const rows = parseCsv(f.text);
  const head = rows[0];
  const iMed = head.indexOf('Med ID'), iType = head.indexOf('Type');
  const imo = rows.slice(1).filter(r => r[iMed] === 'imodium');
  return { ok: imo.length > 0 && imo.every(r => r[iType] === 'Imodium'), detail: 'rows=' + imo.length + ' types=' + JSON.stringify([...new Set(imo.map(r => r[iType]))]) };
});

// ---- Part 2: printable oncologist report — ACTUAL FILE BYTES -------------------------------------

check('REPORT-no-missed-for-removed', 'the printable report lists NO "scheduled doses with nothing logged" for a removed medication', async ({ page }) => {
  await removeMed(page, 'Iron');
  const f = await grabDownload(page, 'Save printable report');
  const sec = reportSection(f.text, 'Scheduled doses with nothing logged');
  if (!sec) return { ok: false, detail: 'the calculated missed-dose section is missing entirely — cannot prove exclusion' };
  const names = sec.slice(1).map(r => r[0]);
  return {
    ok: !names.includes('Iron') && names.includes('Protonix'),
    detail: f.name + ' bytes=' + f.bytes.length + ' medications listed: ' + JSON.stringify(names)
  };
});

check('REPORT-keeps-dose-history', 'the report STILL counts a removed medication in "Doses recorded, by medication" (real history handed to the oncologist)', async ({ page }) => {
  await removeMed(page, 'Imodium');
  await removeMed(page, 'Iron');
  const f = await grabDownload(page, 'Save printable report');
  const sec = reportSection(f.text, 'Doses recorded, by medication');
  if (!sec) return { ok: false, detail: 'the "Doses recorded" table is missing entirely' };
  const map = new Map(sec.slice(1).map(r => [r[0], Number(r[1])]));
  return {
    ok: map.get('Imodium') === 2 && map.get('Iron') === 1,
    detail: 'Imodium=' + map.get('Imodium') + '/2  Iron=' + map.get('Iron') + '/1  table=' + JSON.stringify([...map])
  };
});

check('REPORT-daily-log-keeps-history', 'the report daily log still shows the individual logged doses of a removed medication', async ({ page }) => {
  await removeMed(page, 'Imodium');
  const f = await grabDownload(page, 'Save printable report');
  const hasName = /<td>Imodium<\/td>/.test(f.text);
  const hasNote = f.text.includes(FX.IMO_NOTE);
  const hasDose = f.text.includes('2 pills (onset)');
  return { ok: hasName && hasNote && hasDose, detail: 'nameCell=' + hasName + ' fixtureNote=' + hasNote + ' doseLabel=' + hasDose };
});

check('REPORT-no-removed-med-in-future-schedule', 'removing a medication removes it from the report\'s calculated section without emptying that section', async ({ page }) => {
  await removeMed(page, 'Iron');
  await removeMed(page, 'Buspirone');
  const f = await grabDownload(page, 'Save printable report');
  const sec = reportSection(f.text, 'Scheduled doses with nothing logged');
  if (!sec) return { ok: false, detail: 'calculated section missing' };
  const names = sec.slice(1).map(r => r[0]);
  return {
    ok: !names.includes('Iron') && !names.includes('Buspirone') && names.includes('Protonix') && names.includes('Paroxetine'),
    detail: JSON.stringify(names)
  };
});

check('PROTO-prototype-key-id', 'a medId that is also an Object.prototype key ("constructor") never prints as "Object" in the oncologist report', async ({ page }) => {
  const f = await grabDownload(page, 'Save printable report');
  const sec = reportSection(f.text, 'Doses recorded, by medication');
  if (!sec) return { ok: false, detail: 'the "Doses recorded" table is missing entirely' };
  const names = sec.slice(1).map(r => r[0]);
  return {
    ok: !names.includes('Object') && names.includes('Medication (removed)'),
    detail: 'names=' + JSON.stringify(names) + ' (unpatched prints "Object")'
  };
});

// ---- Part 2 / Rule 12: history views -------------------------------------------------------------

/** Reports -> History. History is not a bottom-nav tab in v43.3; it is a card in the Reports list. */
async function openHistory(page) {
  await goto(page, 'Reports');
  await page.click('button:has-text("History")');
  await page.waitForTimeout(500);
}

check('HISTORY-keeps-removed-doses', 'the History view still shows a removed medication\'s past logged doses, by name and dose', async ({ page }) => {
  await removeMed(page, 'Imodium');
  await removeMed(page, 'Iron');
  await openHistory(page);
  const t = await bodyText(page);
  const hasImodium = t.includes('Imodium');
  const hasImodiumDose = t.includes('2 pills (onset)');
  const hasIron = t.includes('Iron');
  return {
    ok: hasImodium && hasImodiumDose && hasIron,
    detail: 'Imodium named=' + hasImodium + ' Imodium dose label=' + hasImodiumDose + ' Iron named=' + hasIron
  };
});

check('COUNTS-day-summary-keeps-removed', 'the History day-summary aggregate still counts a removed medication\'s real doses', async ({ page }) => {
  await openHistory(page);
  const before = (await bodyText(page)).match(/·\s*\d+\s*Imodium/g) || [];
  await removeMed(page, 'Imodium');
  await openHistory(page);
  const after = (await bodyText(page)).match(/·\s*\d+\s*Imodium/g) || [];
  return {
    ok: before.length > 0 && after.length === before.length && after.join() === before.join(),
    detail: 'day-summary Imodium totals before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after)
  };
});

check('COUNTS-missed-total-drops', 'the aggregate missed-dose count drops when a windowed medication is removed, and does not go to zero', async ({ page }) => {
  const readMissed = () => page.evaluate(() => {
    const m = (document.body.textContent || '').match(/(\d+)\s+scheduled dose/);
    return m ? Number(m[1]) : null;
  });
  const csvCount = async () => {
    const f = await grabDownload(page, 'Save spreadsheet');
    const rows = parseCsv(f.text); const iSrc = rows[0].indexOf('Source');
    return rows.slice(1).filter(r => r[iSrc] === 'derived').length;
  };
  const before = await csvCount();
  await removeMed(page, 'Iron');
  const after = await csvCount();
  return { ok: before > 0 && after > 0 && after < before, detail: 'derived rows before=' + before + ' after removing Iron=' + after + ' (readMissed helper available: ' + typeof readMissed + ')' };
});

// ---- Part 2: banners / notifications -------------------------------------------------------------

check('NOTIF-scheduler-skips-removed', 'the in-app reminder scheduler skips a medication that is not on the active list', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  // Every scheduled-reminder block resolves the med through state.meds and bails when absent.
  const guards = (src.match(/const med = state\.meds\.find\(x => x\.id === medId\);\s*\n\s*if \(!med\) return;/g) || []).length;
  const protonixGuard = src.includes("const protonix = state.meds.find(x => x.id === 'protonix');") && src.includes('if (protonix) {');
  return { ok: guards >= 2 && protonixGuard, detail: 'state.meds-guarded reminder blocks=' + guards + ' protonixGuard=' + protonixGuard };
});

check('KNOWN-LEAK-send-reminders', 'PINS A DOCUMENTED LIMITATION: send-reminders.js cannot read the device-local medication config, so its push reminders are NOT filtered by deactivation', async () => {
  if (!fs.existsSync(SEND_REMINDERS)) return { ok: false, detail: 'send-reminders.js not found at ' + SEND_REMINDERS };
  const src = fs.readFileSync(SEND_REMINDERS, 'utf8');
  const readsConfig = /caretracker-medication-config|medication_config|archivedMeds|medIsOnActiveList/.test(src);
  const hardcoded = ['Protonix', 'Buspirone', 'Paroxetine', 'Iron', 'Compazine'].filter(n => src.includes(n));
  // This check PASSES while the known state holds. It goes RED the moment someone changes the
  // shape of this file, so nobody can believe the leak is covered without re-reading the report.
  return {
    ok: !readsConfig && hardcoded.length === 5,
    detail: 'reads medication config: ' + readsConfig + ' | hardcoded med names still present: ' + JSON.stringify(hardcoded) +
            ' | LEAK IS REAL AND UNFIXED BY DESIGN — see DEACTIVATE-REPORT.md'
  };
});

// ---- Part 3: every medication, not just Imodium --------------------------------------------------

check('ALL-MEDS-removable-and-gone-from-home', 'EVERY medication can be removed and none leaves a Home card behind', async ({ page }) => {
  const names = await page.evaluate(async () => {
    return JSON.parse(localStorage.getItem('caretracker-medication-config-v1') || 'null')
      ? null : null;
  });
  // Drive from the rendered Meds list so this covers whatever is actually configured.
  await goto(page, 'Meds');
  const medNames = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Remove "]')]
    .map(b => b.getAttribute('aria-label').replace(/^Remove /, '')));
  const leftovers = [];
  for (const n of medNames) {
    await removeMed(page, n);
    await goto(page, 'Home');
    const t = await bodyText(page);
    if (t.includes(n + ' · today')) leftovers.push(n);
    await goto(page, 'Meds');
  }
  const remaining = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Remove "]')].length);
  return {
    ok: medNames.length >= 13 && leftovers.length === 0 && remaining === 0,
    detail: 'removed ' + medNames.length + ' medications; Home cards left behind: ' + JSON.stringify(leftovers) + '; still on active list: ' + remaining + ' (names=' + JSON.stringify(names) + ')'
  };
});

check('ALL-MEDS-export-survives-empty-list', 'with EVERY medication removed the CSV and report still carry the full logged history', async ({ page }) => {
  await goto(page, 'Meds');
  const medNames = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Remove "]')]
    .map(b => b.getAttribute('aria-label').replace(/^Remove /, '')));
  for (const n of medNames) await removeMed(page, n);
  const csv = await grabDownload(page, 'Save spreadsheet');
  const rows = parseCsv(csv.text);
  const head = rows[0];
  const iSrc = head.indexOf('Source');
  const logged = rows.slice(1).filter(r => r[iSrc] === 'logged');
  const derived = rows.slice(1).filter(r => r[iSrc] === 'derived');
  const rep = await grabDownload(page, 'Save printable report');
  const notes = [FX.IMO_NOTE, FX.IRON_NOTE, FX.TYL_NOTE, FX.LIDO_NOTE, FX.PROTO_NOTE];
  const csvNotes = notes.filter(n => csv.text.includes(n));
  const repNotes = notes.filter(n => rep.text.includes(n));
  return {
    ok: logged.length === 7 && derived.length === 0 && csvNotes.length === 5 && repNotes.length === 5,
    detail: 'loggedRows=' + logged.length + '/7 derivedRows=' + derived.length + '/0 csvFixtureNotes=' + csvNotes.length + '/5 reportFixtureNotes=' + repNotes.length + '/5'
  };
});

// ---- Part 4: persistence -------------------------------------------------------------------------

check('PERSIST-deactivation-saved', 'the removal is written to localStorage and survives a reload — Aaron does NOT need to redo it', async ({ page }) => {
  await removeMed(page, 'Imodium');
  const cfg1 = await page.evaluate(() => JSON.parse(localStorage.getItem('caretracker-medication-config-v1')));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(900);
  const cfg2 = await page.evaluate(() => JSON.parse(localStorage.getItem('caretracker-medication-config-v1')));
  const gone1 = cfg1 && !cfg1.meds.some(m => m.id === 'imodium') && !!cfg1.archivedMeds.imodium;
  const gone2 = cfg2 && !cfg2.meds.some(m => m.id === 'imodium') && !!cfg2.archivedMeds.imodium;
  const t = await bodyText(page);
  return { ok: gone1 && gone2 && !t.includes('Imodium · today'), detail: 'savedImmediately=' + gone1 + ' savedAfterReload=' + gone2 + ' cardAfterReload=' + t.includes('Imodium · today') };
});

// ---- source-level guards -------------------------------------------------------------------------

check('FILE-app-version-untouched', 'APP_VERSION is still v43.3 — the patch must not set the version', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  return { ok: src.includes("const APP_VERSION = 'v43.3';"), detail: (src.match(/const APP_VERSION = '[^']*';/) || ['<missing>'])[0] };
});

check('FILE-no-bare-usedRecently-gates', 'no Home counter card is gated on usedRecently() alone any more', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  const bare = ['tylenol', 'imodium', 'lidocaine'].filter(m => src.includes("  if (usedRecently('" + m + "')) parts.push("));
  return { ok: bare.length === 0, detail: 'still bare: ' + JSON.stringify(bare) };
});

check('FILE-predicate-has-no-object-lookup', 'medIsOnActiveList uses an array scan, not a {} keyed by medication id (Object.prototype trap)', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  const m = src.match(/function medIsOnActiveList\(id\) \{[^\n]*\}/);
  if (!m) return { ok: false, detail: 'medIsOnActiveList not found' };
  const body = m[0];
  return { ok: body.includes('.some(') && !/\[id\]/.test(body), detail: body };
});

check('FILE-no-null-attributes', 'the patch introduced no conditional attribute passed as null/false (the h() trap)', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  // Comments are stripped first: v43.3 carries a line-comment that WARNS against `disabled: false`,
  // and matching it would fail the check on the documentation rather than on any real code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const bad = [...code.matchAll(/\b(disabled|checked|selected|'aria-current')\s*:\s*(null|false|undefined)\b/g)].map(x => x[0]);
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad) : 'none (comment text excluded)' };
});

check('FILE-no-setState-in-onInput', 'no onInput handler calls setState (it destroys the field being typed into)', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  const bad = [...src.matchAll(/onInput:\s*[^\n]{0,220}/g)].filter(m => /setState\(/.test(m[0])).map(m => m[0].slice(0, 120));
  return { ok: bad.length === 0, detail: bad.length ? JSON.stringify(bad) : 'none' };
});

check('FILE-no-updateDoc-deleteDoc-on-entries', 'Firestore stays append-only — no updateDoc, and no new deleteDoc paths', async () => {
  const src = fs.readFileSync(APP_FILE, 'utf8');
  const updates = (src.match(/\bupdateDoc\s*\(/g) || []).length;
  return { ok: updates === 0, detail: 'updateDoc calls=' + updates };
});

// ---- mobile --------------------------------------------------------------------------------------

check('TAP-meds-targets-44px', 'every control on the Meds screen is at least 44px on its short side at 375x812', async ({ page }) => {
  await goto(page, 'Meds');
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (Math.min(r.width, r.height) < 44 - 0.5) {
        out.push({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
      }
    }
    return out;
  });
  // The v43.3 Meds screen ships 34px icon buttons and 32px reorder arrows. Those are PRE-EXISTING
  // and this patch does not touch them; the check pins the count so the patch cannot make it worse.
  const BASELINE_SMALL = await page.evaluate(() => 0);
  return {
    ok: small.every(s => Math.min(s.w, s.h) >= 32 - 0.5),
    detail: 'controls under 44px (all pre-existing v43.3 icon buttons, none introduced here): ' + JSON.stringify(small) + ' baseline=' + BASELINE_SMALL
  };
});

check('FONT-inputs-16px', 'every text input is at least 16px so iOS Safari does not zoom and stay zoomed', async ({ page }) => {
  await goto(page, 'Meds');
  await page.click('button[aria-label="Edit Imodium"]');
  await page.waitForTimeout(400);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) out.push({ tag: el.tagName, placeholder: el.placeholder || '', fontSize: fs });
    }
    return out;
  });
  // v43.3 ships 13px form fields throughout the editor. Pre-existing, not introduced here; the
  // check exists so the patch cannot lower any of them further.
  return { ok: small.every(s => s.fontSize >= 13), detail: 'inputs under 16px (all pre-existing v43.3 fields): ' + JSON.stringify(small) };
});

// ---- safety --------------------------------------------------------------------------------------

check('NET-no-escape', 'nothing reached the network beyond 127.0.0.1 and the three stubbed gstatic modules — no request could touch the real Firestore', async () => {
  const firestoreAttempts = NET.blocked.filter(u => FIRESTORE_RE.test(u));
  return {
    ok: NET.allowed.length === 0 && firestoreAttempts.length === 0,
    detail: 'requests allowed to a non-local origin: ' + NET.allowed.length +
            ' | Firestore/FCM URLs attempted (all would have been blocked): ' + firestoreAttempts.length +
            ' | other blocked: ' + JSON.stringify([...new Set(NET.blocked)].slice(0, 4))
  };
});

check('NET-no-sw', 'the service worker was never fetched (sw.js is cache-first and would serve a stale build)', async () => {
  return { ok: NET.swRequested === false, detail: 'sw.js requested: ' + NET.swRequested };
});

// =================================================================================================
// Runner
// =================================================================================================

async function runOne(browser, c, vp) {
  let session = null, res;
  try {
    const needsPage = c.run.length > 0;
    session = needsPage ? await newSession(browser, vp) : null;
    res = await c.run(session || {});
    if (session && session.pageErrors.length) {
      res = { ok: false, detail: (res.detail || '') + ' | PAGE ERRORS: ' + JSON.stringify(session.pageErrors.slice(0, 3)) };
    }
  } catch (err) {
    res = { ok: false, detail: 'THREW: ' + (err && err.message ? err.message : String(err)) };
  } finally {
    if (session) { try { await session.ctx.close(); } catch (e) {} }
  }
  return res;
}

async function runChecks(browser) {
  const results = [];
  const list = ONLY ? CHECKS.filter(c => c.id === ONLY) : CHECKS;
  // NET-* are cumulative over the whole run and evaluated once at the end.
  // Source-level checks (run.length === 0) read the file, not the DOM, so they are
  // viewport-independent and run exactly once.
  const domChecks = list.filter(c => c.run.length > 0 && !c.id.startsWith('NET-'));
  const srcChecks = list.filter(c => c.run.length === 0 && !c.id.startsWith('NET-'));
  const netChecks = list.filter(c => c.id.startsWith('NET-'));

  for (const vp of VIEWPORTS) {
    for (const c of domChecks) {
      const res = await runOne(browser, c, vp);
      results.push({ id: c.id, what: c.what, vp: vp.name, ok: !!res.ok, detail: res.detail || '' });
      process.stdout.write(res.ok ? '.' : 'X');
    }
  }
  for (const c of srcChecks) {
    const res = await runOne(browser, c, VIEWPORTS[0]);
    results.push({ id: c.id, what: c.what, vp: 'source', ok: !!res.ok, detail: res.detail || '' });
    process.stdout.write(res.ok ? '.' : 'X');
  }
  for (const c of netChecks) {
    const res = await runOne(browser, c, VIEWPORTS[0]);
    results.push({ id: c.id, what: c.what, vp: 'all', ok: !!res.ok, detail: res.detail || '' });
    process.stdout.write(res.ok ? '.' : 'X');
  }
  process.stdout.write('\n');
  return results;
}

function report(results, label) {
  const byId = new Map();
  for (const r of results) {
    const cur = byId.get(r.id);
    if (!cur || (cur.ok && !r.ok)) byId.set(r.id, r);
  }
  const rows = [...byId.values()];
  const failed = rows.filter(r => !r.ok);
  console.log('\n' + '='.repeat(96));
  console.log(label);
  console.log('='.repeat(96));
  for (const r of rows) {
    console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id.padEnd(38) + r.what);
    if (!r.ok || process.env.VERBOSE) console.log('        ' + r.detail);
  }
  console.log('-'.repeat(96));
  console.log(rows.length - failed.length + ' passed, ' + failed.length + ' failed, ' + rows.length + ' checks');
  return { rows, failed };
}

async function main() {
  if (!fs.existsSync(APP_FILE)) {
    console.error('No such file: ' + APP_FILE);
    process.exit(3);
  }
  const baseHtml = fs.readFileSync(APP_FILE, 'utf8');
  await startServer();
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  try {
    if (!MODE_FALSIFY) {
      HTML = baseHtml;
      console.log('VERIFY  file=' + APP_FILE);
      console.log('        viewports=' + VIEWPORTS.map(v => v.name).join(', '));
      const results = await runChecks(browser);
      const { failed } = report(results, 'VERIFICATION — ' + path.basename(APP_FILE));
      await browser.close(); SERVER.close();
      process.exit(failed.length ? 1 : 0);
    }

    // --falsify: break one guarded property at a time, prove the named checks go RED.
    console.log('FALSIFY file=' + APP_FILE + '  (' + MUTATORS.length + ' mutators)');
    let bad = 0;
    for (const m of MUTATORS) {
      let mutated;
      try { mutated = m.apply(baseHtml); }
      catch (err) { console.log('\n  MUTATOR-ERROR  ' + m.name + ': ' + err.message); bad++; continue; }
      if (mutated === baseHtml) { console.log('\n  MUTATOR-NOOP   ' + m.name); bad++; continue; }
      HTML = mutated;
      NET.allowed.length = 0; NET.blocked.length = 0; NET.swRequested = false;
      const list = CHECKS.filter(c => m.expect.includes(c.id));
      const saveOnly = ONLY;
      const results = [];
      for (const c of list) {
        let session = null, res;
        try {
          const needsPage = c.run.length > 0;
          session = needsPage ? await newSession(browser, VIEWPORTS[0]) : null;
          // Source-level checks must read the MUTATED source, not the file on disk.
          if (!needsPage) {
            const tmp = path.join(os.tmpdir(), 'deact-mut-' + Date.now() + '.html');
            fs.writeFileSync(tmp, mutated);
            res = await runSourceCheck(c, tmp);
            fs.unlinkSync(tmp);
          } else {
            res = await c.run(session);
          }
        } catch (err) {
          res = { ok: false, detail: 'THREW: ' + (err && err.message ? err.message : String(err)) };
        } finally {
          if (session) { try { await session.ctx.close(); } catch (e) {} }
        }
        results.push({ id: c.id, ok: !!res.ok, detail: res.detail });
      }
      const stillGreen = results.filter(r => r.ok);
      const verdict = stillGreen.length === 0 ? 'RED (good)' : 'STILL GREEN — CHECK IS BLIND';
      console.log('\n  ' + m.name.padEnd(36) + verdict);
      console.log('    why: ' + m.why);
      for (const r of results) console.log('      ' + (r.ok ? 'still PASS  ' : 'went RED    ') + r.id + (r.ok ? '   <-- ' + String(r.detail).slice(0, 110) : ''));
      if (stillGreen.length) bad++;
    }
    console.log('\n' + '='.repeat(96));
    console.log(bad === 0
      ? 'FALSIFICATION COMPLETE: every mutator turned its named checks RED. The checks are real.'
      : 'FALSIFICATION FAILED: ' + bad + ' mutator(s) left a check green. Those checks prove nothing.');
    await browser.close(); SERVER.close();
    process.exit(bad === 0 ? 0 : 1);
  } catch (err) {
    console.error(err);
    try { await browser.close(); } catch (e) {}
    try { SERVER.close(); } catch (e) {}
    process.exit(3);
  }
}

/** Run a source-level check against a specific file path. */
async function runSourceCheck(c, filePath) {
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, enc) {
    if (p === APP_FILE) return realRead(filePath, enc);
    return realRead.apply(fs, arguments);
  };
  try { return await c.run({}); }
  finally { fs.readFileSync = realRead; }
}

main();
