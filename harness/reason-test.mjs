#!/usr/bin/env node
/**
 * reason-test.mjs — verification suite for the care-tracker missed-dose reason patch.
 *
 * SAFETY (non-negotiable — this app holds one cancer patient's real medication history):
 *   * ALL THREE gstatic Firebase modules are stubbed. Nothing this suite runs can reach the real
 *     Firestore project. A catch-all route aborts every request that is not 127.0.0.1 or one of the
 *     three stubs, and check NET-1 fails the run if anything tried.
 *   * The service worker is stripped from the page before any script runs (sw.js is cache-first and
 *     would serve a stale build between runs). NET-2 fails the run if sw.js was ever requested.
 *   * Fixtures only. No credentials, no network, no writes anywhere but the in-memory stub.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
 *     node reason-test.mjs                  # verify the patched build (all checks must pass)
 *   ... node reason-test.mjs --falsify      # break each guarded thing in turn, prove it goes RED
 *   ... node reason-test.mjs --file <path>  # verify a different patched index.html
 *   ... node reason-test.mjs --only ID      # run one check
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback. The suite refuses to start
 * otherwise rather than producing a confusing failure.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const FILE_ARG = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : null; })();
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
// Falsification launches a whole browser session per mutator. --batch a-b runs a slice of the
// mutator list so the sweep can be done in sittings instead of one very long run.
const BATCH = (() => { const i = argv.indexOf('--batch'); return i >= 0 ? argv[i + 1].split('-').map(Number) : null; })();
const APP_FILE = FILE_ARG || path.join(HERE, 'work', 'index.html');
const VIEWPORT = { w: 375, h: 812 };

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the');
    console.error('proxy and every check would fail for the wrong reason. Re-run under:');
    console.error('  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node reason-test.mjs');
    process.exit(3);
  }
}

// The Overnight fixture window closes at 01:00 local. Between midnight and 01:00 it is not yet a
// missed dose and half this suite would fail for a reason that has nothing to do with the patch.
{
  const hr = new Date().getHours();
  if (hr === 0) {
    console.error('REFUSING TO RUN between 00:00 and 01:00 local time: the fixture\'s Overnight');
    console.error('window has not closed yet, so today has no derived missed dose to test against.');
    process.exit(3);
  }
}

// =================================================================================================
// Firebase stubs — three ES modules served in place of the three gstatic URLs
// =================================================================================================

const STUB_APP = `
export function initializeApp(cfg) { return { name: '[DEFAULT]', options: cfg }; }
`;

const STUB_MESSAGING = `
export function getMessaging() { throw new Error('messaging disabled in the test harness'); }
export async function getToken() { return null; }
export function onMessage() { return () => {}; }
`;

const STUB_FIRESTORE = `
const fx = (globalThis.__MR_FIXTURE__ || { entries: [], prefs: {} });
const store = { entries: fx.entries.slice(), prefs: Object.assign({}, fx.prefs) };
const entryListeners = [];
const prefsListeners = [];
let autoId = 0;

const rec = { addDoc: [], deleteDoc: [], setDoc: [], snapshots: 0 };
globalThis.__mrStub = {
  rec,
  all() { return store.entries.slice(); },
  push(d) { store.entries.push(Object.assign({ id: 'pushed-' + (++autoId) }, d)); emitEntries(); },
  reset() { rec.addDoc.length = 0; rec.deleteDoc.length = 0; rec.setDoc.length = 0; },
  // Makes the next addDoc reject, so the save path's error branch can be exercised without
  // touching anything real.
  failNextAdd() { store.failNext = true; }
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
  if (store.failNext) { store.failNext = false; throw new Error('stub: write refused'); }
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

const MED_CONFIG_KEY = 'caretracker-medication-config-v1';

// Every default medication except Protonix is archived, so mergeMissingDefaultMeds() does not put
// them back. That leaves a small, fully predictable derived-miss surface.
const DEFAULT_IDS = ['dexamethasone', 'tylenol', 'tylenol-liquid', 'zofran', 'compazine', 'morphine',
  'lidocaine', 'protonix', 'buspirone', 'paroxetine', 'iron', 'senokot', 'imodium'];

function medConfig() {
  const archivedMeds = {};
  DEFAULT_IDS.filter(id => id !== 'protonix').forEach(id => { archivedMeds[id] = { name: id, sub: '' }; });
  return {
    version: 1,
    archivedMeds,
    meds: [
      // Overnight closes at 01:00 and Morning at 12:00, so every past day yields two misses
      // regardless of the hour the suite runs at.
      { id: 'protonix', name: 'Protonix', sub: 'Pantoprazole', type: 'win', alerts: true,
        windows: [{ start: 0, end: 1, name: 'Overnight' }, { start: 8, end: 12, name: 'Morning' }] },
      // id 'constructor' is an inherited property of Object.prototype. Against a plain-object
      // lookup a reason filed under it reads back as a function, which is truthy and is not a
      // record. safeMedicationId() produces exactly this id from a medication named "Constructor",
      // so it is reachable by a real user, not a synthetic case.
      { id: 'constructor', name: 'Constructor', sub: 'Proto trap', type: 'win', alerts: true,
        windows: [{ start: 2, end: 3, name: 'Night' }] }
    ]
  };
}

function dayStart(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
// Walk back one local day at a time through dayStart(), the DST-safe idiom the app itself uses.
function backDays(n) {
  let d = dayStart(Date.now());
  for (let i = 0; i < n; i++) d = dayStart(d - 43200000);
  return d;
}
function at(dayTs, hours) { return dayTs + hours * 3600000; }

const T0 = Date.now();

// Distinctive strings so a check cannot pass because some unrelated text happened to match.
const FX = {
  NOTE_SAVED: 'MRFIXTURE-note-kept-down-until-lunch',
  NOTE_TYPED: 'MRFIXTURE-typed-in-the-sheet',
  NOTE_ORPHAN: 'MRFIXTURE-orphan-must-not-render'
};

// Days the fixture pins reasons to. All are in the past, so their windows have certainly closed.
const DAY_SUPERSEDE = backDays(3);   // protonix Overnight — two docs, newer must win
const DAY_PROTO = backDays(4);       // constructor Night  — Object.prototype id
const DAY_REMOVED = backDays(5);     // protonix Morning   — reason then removal
const DAY_COVERED = backDays(6);     // protonix Morning covered by a real dose; its reason orphans
const DAY_UI = backDays(9);          // protonix Overnight — left empty for the UI to drive
// A reason written by an older build under an id this build no longer knows, whose SNAPSHOTTED
// LABEL is an Object.prototype property name. The label is a wire value and it is what the report
// groups by, so this is the one place the prototype hazard is genuinely reachable.
const DAY_LABEL = backDays(13);

const KEY_SUPERSEDE = 'protonix|' + at(DAY_SUPERSEDE, 0);
const KEY_PROTO = 'constructor|' + at(DAY_PROTO, 2);
const KEY_REMOVED = 'protonix|' + at(DAY_REMOVED, 8);
const KEY_UI = 'protonix|' + at(DAY_UI, 0);
const KEY_LABEL = 'protonix|' + at(DAY_LABEL, 0);

function reasonDoc(missMedId, missTs, missWindow, reasonId, reasonLabel, note, loggedAt, id) {
  return { id, medId: 'missed_reason', missMedId, missTs, missWindow, reasonId, reasonLabel,
    note: note || '', ts: missTs, mg: 0, dose: 'Missed-dose reason', loggedAt };
}

function buildFixture(opts) {
  const withReasons = !opts || opts.withReasons !== false;
  const entries = [
    // Real logged documents. Without them the report suppresses its whole calculated section and
    // the CSV checks would pass against an empty file.
    { id: 'e-prot-1', medId: 'protonix', dose: '1 tablet', mg: 0, pills: 1, ts: at(DAY_COVERED, 8.5), loggedAt: at(DAY_COVERED, 8.5) },
    { id: 'e-prot-2', medId: 'protonix', dose: '1 tablet', mg: 0, pills: 1, ts: at(backDays(2), 8.5), loggedAt: at(backDays(2), 8.5) },
    { id: 'e-temp-1', medId: 'temp', temp: 99.4, dose: '99.4 °F', mg: 0, ts: at(backDays(2), 9), loggedAt: at(backDays(2), 9) },
    { id: 'e-wt-1', medId: 'weight', weight: 141.2, dose: '141.2 lbs', mg: 0, ts: at(backDays(2), 9.5), loggedAt: at(backDays(2), 9.5) }
  ];
  // renderHistory() groups by the days that have LOGGED documents and derives misses only for
  // those days — a day with nothing logged at all never renders a row, in the base app and in the
  // patched one alike. Each pinned day therefore gets one innocuous temperature so its missed rows
  // are on screen to be tested. (This is a property of the base History screen, not of the patch;
  // see REASON-REPORT.md.)
  [DAY_SUPERSEDE, DAY_PROTO, DAY_REMOVED, DAY_UI, DAY_LABEL, backDays(11)].forEach((d, i) => {
    entries.push({ id: 'e-anchor-' + i, medId: 'temp', temp: 98.6, dose: '98.6 °F', mg: 0, ts: at(d, 7), loggedAt: at(d, 7) });
  });
  if (withReasons) {
    entries.push(
      // Superseded pair on one key: the older answer must vanish everywhere.
      reasonDoc('protonix', at(DAY_SUPERSEDE, 0), 'Overnight', 'asleep', 'Was asleep', '', T0 - 90000, 'r-sup-old'),
      reasonDoc('protonix', at(DAY_SUPERSEDE, 0), 'Overnight', 'nausea', 'Felt too nauseous', FX.NOTE_SAVED, T0 - 80000, 'r-sup-new'),
      // Object.prototype id.
      reasonDoc('constructor', at(DAY_PROTO, 2), 'Night', 'unwell', 'Felt too unwell', '', T0 - 70000, 'r-proto'),
      // Recorded, then retracted by an append. Must read as no reason at all.
      reasonDoc('protonix', at(DAY_REMOVED, 8), 'Morning', 'ranout', 'Ran out of it', 'gone by then', T0 - 60000, 'r-rem-old'),
      reasonDoc('protonix', at(DAY_REMOVED, 8), 'Morning', '', '', '', T0 - 50000, 'r-rem-new'),
      // Attached to a window that a real dose later covered: the miss no longer exists, so this
      // must not surface in the UI or in the report.
      reasonDoc('protonix', at(DAY_COVERED, 8), 'Morning', 'nausea', 'Felt too nauseous', FX.NOTE_ORPHAN, T0 - 40000, 'r-orphan'),
      reasonDoc('protonix', at(DAY_LABEL, 0), 'Overnight', 'retired-id-from-an-older-build', 'constructor', '', T0 - 30000, 'r-label-proto'),
      // Junk shapes that a corrupted or half-written document could produce. None may throw.
      { id: 'r-junk-1', medId: 'missed_reason', missMedId: '', missTs: at(DAY_SUPERSEDE, 0), reasonId: 'nausea', loggedAt: T0 },
      { id: 'r-junk-2', medId: 'missed_reason', missMedId: 'protonix', missTs: 'not-a-number', reasonId: 'nausea', loggedAt: T0 },
      { id: 'r-junk-3', medId: 'missed_reason', missMedId: 'protonix', missTs: 0, reasonId: 'nausea', loggedAt: T0 },
      { id: 'r-junk-4', medId: 'missed_reason', loggedAt: T0 }
    );
  }
  return { entries, prefs: { missedClearedAt: 0 } };
}

// =================================================================================================
// Mutators — each breaks exactly one guarded property. --falsify proves the named checks go RED.
// =================================================================================================

function must(html, from, to) {
  if (!html.includes(from)) throw new Error('mutator anchor not found: ' + from.slice(0, 100));
  return html.replace(from, to);
}

const MUTATORS = [
  {
    name: 'reasons-leak-into-entries',
    why: 'stops splitting reason documents out of state.entries — they reach the CSV and the report',
    expect: ['CSV-byte-identical', 'CSV-no-reason-strings', 'FILE-split-at-arrival'],
    apply: (h) => must(h, "const all = mrRaw.filter((e) => !e || e.medId !== MR_MED_ID);", "const all = mrRaw.slice();")
  },
  {
    name: 'plain-object-report-grouping',
    why: 'groups the report by reason label in a plain {} — a label of "constructor" reads back as a function and the whole report dies',
    expect: ['REPORT-carries-reasons'],
    apply: (h) => must(h, "  const groups = new Map();\n  const noteRows = [];",
      "  const groups = { _o: {}, get(k) { return this._o[k]; }, set(k, v) { this._o[k] = v; }, keys() { return Object.keys(this._o); }, get size() { return Object.keys(this._o).length; } };\n  const noteRows = [];")
  },
  {
    name: 'oldest-answer-wins',
    why: 'inverts the supersede rule, so changing an answer leaves the old one showing',
    expect: ['SUPERSEDE-newest-wins'],
    apply: (h) => must(h, "  if (a !== b) return a > b;\n  return String(next.id || '') > String(prev.id || '');",
      "  if (a !== b) return a < b;\n  return String(next.id || '') > String(prev.id || '');")
  },
  {
    name: 'removal-not-honoured',
    why: 'makes an empty reasonId read as a reason, so a retracted answer keeps showing',
    expect: ['REMOVE-reads-as-none'],
    apply: (h) => must(h, "  if (!rec.reasonId && !rec.note) return null;\n  return rec;", "  return rec;")
  },
  {
    name: 'key-ignores-window',
    why: 'drops the window timestamp from the identity, so one reason smears across every window of that medication',
    expect: ['IDENTITY-one-window-only'],
    apply: (h) => must(h, "function mrKey(medId, ts) { return String(medId) + '|' + Number(ts); }",
      "function mrKey(medId, ts) { return String(medId); }")
  },
  {
    name: 'change-uses-delete',
    why: 'removes a reason with a real delete, which the append-only rules refuse after 48 hours',
    expect: ['APPEND-only-no-deletes'],
    apply: (h) => must(h, "  if (!s.hadSaved) { mrCloseSheet(); return; }",
      "  if (!s.hadSaved) { mrCloseSheet(); return; }\n  await removeEntryDB('r-sup-new');")
  },
  {
    name: 'setState-in-onInput',
    why: 'calls setState from the note field\'s onInput, which destroys the field being typed into',
    expect: ['FILE-no-setState-in-onInput', 'TYPE-note-survives'],
    apply: (h) => must(h, "onInput: (ev) => { if (state.missReasonSheet) state.missReasonSheet.note = ev.target.value; }",
      "onInput: (ev) => { setState({ missReasonSheet: Object.assign({}, state.missReasonSheet, { note: ev.target.value }) }); }")
  },
  {
    name: 'tick-repaints-under-sheet',
    why: 'removes the open sheet from the clock-tick repaint guard — a tap landing across a repaint is swallowed',
    expect: ['TICK-sheet-survives'],
    apply: (h) => must(h, "activeTag === 'TEXTAREA' || !!state.missReasonSheet;", "activeTag === 'TEXTAREA';")
  },
  {
    name: 'toast-repaints-under-sheet',
    why: 'lets a clearing toast repaint underneath the open sheet, destroying it mid-tap',
    expect: ['TICK-sheet-survives'],
    apply: (h) => must(h, "    if (state.missReasonSheet) { toastTimer = setTimeout(mrClearToast, 600); return; }", "")
  },
  {
    name: 'h-null-attribute-trap',
    why: 'passes the busy flag as a null-valued attribute — h() renders disabled="null" and disables Save forever',
    expect: ['TRAP-no-null-attributes'],
    apply: (h) => must(h, "  const busyAttr = s.busy ? { disabled: 'disabled' } : {};",
      "  const busyAttr = { disabled: s.busy ? 'disabled' : null };")
  },
  {
    name: 'note-field-14px',
    why: 'drops the note field to 14px — the size that makes iOS Safari zoom in and never back',
    expect: ['FONT-16px-note'],
    apply: (h) => must(h, "borderRadius: '13px', padding: '10px 13px', fontSize: '16px', lineHeight: '1.45', background: 'rgba(255,255,255,0.7)'",
      "borderRadius: '13px', padding: '10px 13px', fontSize: '14px', lineHeight: '1.45', background: 'rgba(255,255,255,0.7)'")
  },
  {
    name: 'chip-tap-target-32px',
    why: 'shrinks the reason chips below the 44px minimum tap target',
    expect: ['TAP-44px-targets'],
    apply: (h) => must(h, "    minHeight: '44px', padding: '0 15px', borderRadius: '999px',", "    minHeight: '32px', padding: '0 15px', borderRadius: '999px',")
  },
  {
    // In the shipped structure the reason strip is a SIBLING of the clickable strip, so the log
    // handler is not on the button's ancestor path at all and stopPropagation is belt-and-braces.
    // Removing stopPropagation alone therefore changes nothing — verified, and it is why this
    // mutator also restores the whole-row click target the base had. That pair is the realistic
    // regression: someone re-flattens the row and the guard is not there to catch it.
    name: 'row-logs-again-without-guard',
    why: 'puts the log handler back on the whole row AND drops stopPropagation — tapping "Add a reason" would then also log a dose',
    expect: ['ROW-button-does-not-log'],
    apply: (h) => {
      h = must(h, "onClick: (ev) => { ev.stopPropagation(); mrOpenSheet(e); }", "onClick: (ev) => { mrOpenSheet(e); }");
      return must(h, "return h('div', { 'data-mr-missed-row': mrKeyOf(e), style: { borderTop:",
                     "return h('div', { 'data-mr-missed-row': mrKeyOf(e), onClick: () => logMissedDose(e), style: { borderTop:");
    }
  },
  {
    name: 'row-logs-again-guard-kept',
    why: 'puts the log handler back on the whole row but KEEPS stopPropagation — this must stay green, or the check is not testing the guard',
    expectGreen: true,
    expect: [],
    apply: (h) => must(h, "return h('div', { 'data-mr-missed-row': mrKeyOf(e), style: { borderTop:",
                          "return h('div', { 'data-mr-missed-row': mrKeyOf(e), onClick: () => logMissedDose(e), style: { borderTop:")
  },
  {
    name: 'reason-absent-from-report',
    why: 'drops the reasons subsection from the printable report',
    expect: ['REPORT-carries-reasons'],
    apply: (h) => must(h, "      mrReportBlock(derived) : '') +", "      '' : '') +")
  },
  {
    name: 'reasons-in-daily-log',
    why: 'lets reason documents into allExportEntries(), so they print as rows of the clinical daily log',
    expect: ['REPORT-reasons-not-in-log', 'CSV-byte-identical', 'CSV-no-reason-strings'],
    apply: (h) => must(h, "  return (state.entries || []).concat(state.chemoDates || []);",
      "  return (state.entries || []).concat(state.chemoDates || []).concat(Array.from((state.missReasons || new Map()).values()).map(r => ({ id: r.id, medId: 'missed_reason', ts: r.missTs, note: r.note, dose: r.reasonLabel, mg: 0 })));")
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do',
    expect: ['FILE-app-version'],
    apply: (h) => must(h, "const APP_VERSION = 'v43.3';", "const APP_VERSION = 'v43.4';")
  },
  {
    name: 'auto-opens-the-sheet',
    why: 'opens the reason sheet on its own — the nagging, blocking behaviour this feature must never have',
    expect: ['OPTIONAL-nothing-auto-opens'],
    apply: (h) => must(h, "function missedRow(e, i) {\n  const saved = mrReasonFor(e);",
      "function missedRow(e, i) {\n  const saved = mrReasonFor(e);\n  if (!saved && !state.missReasonSheet) setTimeout(() => mrOpenSheet(e), 0);")
  },
  {
    name: 'judgmental-wording',
    why: 'restores the wording the design bar rules out — a verdict instead of a description',
    expect: ['COPY-no-judgment'],
    apply: (h) => must(h, "  { id: 'time',    label: 'Lost track of the time' },", "  { id: 'time',    label: 'Forgot / careless' },")
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
    catch (err) { this.results.push({ id, desc, ok: false, err: String((err && err.message) || err) }); }
  }
  failed() { return this.results.filter(r => !r.ok); }
  ids() { return this.results.map(r => r.id); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertGte(actual, min, msg) {
  assert(typeof actual === 'number' && actual >= min, msg + ' — measured ' + actual + ', floor ' + min);
}

function startServer(getHtml) {
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      const body = getHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// fonts.googleapis.com / fonts.gstatic.com are requested by the BASE build's own <link> tags. They
// are still blocked — nothing leaves this machine — but they are not evidence of a leak introduced
// by this patch, so they are tallied separately from anything unexpected.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NET = { offSite: [], sw: [], fonts: [] };

async function withPage(html, fixture, fn, extra) {
  const server = await startServer(() => html);
  const port = server.address().port;
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-dl-'));
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: VIEWPORT.w, height: VIEWPORT.h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    acceptDownloads: true,
    serviceWorkers: 'block'
  });
  const page = await ctx.newPage();
  const downloads = [];
  page.on('download', async (d) => {
    const file = path.join(downloadDir, String(downloads.length) + '-' + d.suggestedFilename());
    try { await d.saveAs(file); downloads.push({ name: d.suggestedFilename(), file }); }
    catch (err) { downloads.push({ name: d.suggestedFilename(), file: null, err: String(err) }); }
  });

  // Serve the three Firebase modules from memory; abort everything else off-origin.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (GSTATIC[url]) {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GSTATIC[url] });
      return;
    }
    if (url.includes('/sw.js')) { NET.sw.push(url); await route.abort(); return; }
    if (url.startsWith('http://127.0.0.1:')) { await route.continue(); return; }
    if (FONT_HOSTS.some(hst => url.includes(hst))) { NET.fonts.push(url); await route.abort(); return; }
    NET.offSite.push(url);
    await route.abort();
  });

  await page.addInitScript(({ fx, cfg, key }) => {
    globalThis.__MR_FIXTURE__ = fx;
    try { localStorage.setItem(key, JSON.stringify(cfg)); } catch (e) {}
    // Belt and braces on top of serviceWorkers:'block' — the page calls register() directly, so the
    // property must exist and refuse, not vanish ('serviceWorker' in navigator would still be true
    // and the call would throw a page error that has nothing to do with the patch).
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => ({
          register: () => Promise.reject(new Error('service worker blocked by the harness')),
          addEventListener: () => {},
          ready: new Promise(() => {})
        })
      });
    } catch (e) {}
    try { Notification.requestPermission = () => Promise.resolve('denied'); } catch (e) {}
  }, { fx: fixture, cfg: medConfig(), key: MED_CONFIG_KEY });

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err && err.message || err)));

  try {
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('nav[aria-label="Primary navigation"]'), null, { timeout: 15000 });
    return await fn({ page, downloads, consoleErrors, port });
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    server.close();
    if (extra && extra.keepDownloads) return;
    try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch (e) {}
  }
}

// ---- page helpers -------------------------------------------------------------------------------

// The app repaints once a second and replaces the whole tree, so Playwright's actionability check
// ("element is stable") can never settle. tap() waits for the node, then dispatches a real click on
// it — which still bubbles, so stopPropagation is still exercised.
async function tap(page, sel) {
  await page.waitForSelector(sel, { timeout: 20000 });
  await page.$eval(sel, (el) => el.click());
}

async function gotoHistory(page) {
  if (await page.$('[data-mr-sheet]')) { await tap(page, '[data-mr-cancel]'); await page.waitForTimeout(150); }
  await tap(page, 'nav[aria-label="Primary navigation"] button[aria-label="Reports"]');
  await page.waitForTimeout(200);
  const onMenu = await page.$('button:has-text("Review dose, symptom, and vital logs")');
  if (onMenu) await tap(page, 'button:has-text("Review dose, symptom, and vital logs")');
  await page.waitForSelector('[data-mr-missed-row]', { timeout: 20000 });
}

async function gotoReportsMenu(page) {
  if (await page.$('[data-mr-sheet]')) { await tap(page, '[data-mr-cancel]'); await page.waitForTimeout(150); }
  await tap(page, 'nav[aria-label="Primary navigation"] button[aria-label="Reports"]');
  await page.waitForTimeout(200);
  const back = await page.$('button:has-text("Back")');
  if (back) { await tap(page, 'button:has-text("Back")'); await page.waitForTimeout(200); }
  await page.waitForSelector('button:has-text("Save spreadsheet")', { timeout: 10000 });
}

async function openSheetFor(page, key) {
  await tap(page, '[data-mr-missed-row="' + key + '"] [data-mr-row-button]');
  await page.waitForSelector('[data-mr-sheet]', { timeout: 8000 });
}

async function chooseAndSave(page, reasonId, note) {
  await tap(page, '[data-mr-chip="' + reasonId + '"]');
  if (note !== undefined && note !== null) {
    await page.fill('[data-mr-note-input]', note);
  }
  await tap(page, '[data-mr-save]');
  await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
}

async function rowReasonText(page, key) {
  return page.$eval('[data-mr-missed-row="' + key + '"]', (el) => {
    const chip = el.querySelector('[data-mr-row-reason]');
    return chip ? chip.textContent.trim() : '';
  });
}

async function saveCSV(page, downloads) {
  await gotoReportsMenu(page);
  const before = downloads.length;
  await tap(page, 'button:has-text("Save spreadsheet")');
  const deadline = Date.now() + 20000;
  while (downloads.length === before && Date.now() < deadline) await page.waitForTimeout(150);
  assert(downloads.length > before, 'no CSV download was produced');
  const d = downloads[downloads.length - 1];
  assert(d.file, 'CSV download failed: ' + (d.err || 'no file'));
  return fs.readFileSync(d.file);
}

async function saveReport(page, downloads) {
  await gotoReportsMenu(page);
  const before = downloads.length;
  await tap(page, 'button:has-text("Save printable report")');
  const deadline = Date.now() + 20000;
  while (downloads.length === before && Date.now() < deadline) await page.waitForTimeout(150);
  assert(downloads.length > before, 'no report download was produced');
  const d = downloads[downloads.length - 1];
  assert(d.file, 'report download failed: ' + (d.err || 'no file'));
  return fs.readFileSync(d.file, 'utf-8');
}

// =================================================================================================
// The checks
// =================================================================================================

async function runChecks(html) {
  const S = new Suite();
  NET.offSite.length = 0;
  NET.sw.length = 0;

  // ---- static checks on the file itself ---------------------------------------------------
  await S.run('FILE-patch-applied', 'the patch is present in the file under test', async () => {
    assert(html.includes("const MR_MED_ID = 'missed_reason';"), 'MR_MED_ID missing — the patch is not applied');
    assert(html.includes('function renderMissReasonSheet()'), 'renderMissReasonSheet missing');
    assert(html.includes('function mrReportBlock('), 'mrReportBlock missing');
  });

  await S.run('FILE-app-version', 'APP_VERSION is untouched at v43.3', async () => {
    assert(html.includes("const APP_VERSION = 'v43.3';"), 'APP_VERSION is not v43.3');
  });

  await S.run('FILE-allExportEntries', 'allExportEntries() still returns entries + chemoDates only', async () => {
    assert(html.includes('return (state.entries || []).concat(state.chemoDates || []);'),
      'allExportEntries() was changed — reason documents could reach the CSV');
  });

  await S.run('FILE-export-columns', 'the CSV column list is unchanged', async () => {
    assert(html.includes("const EXPORT_COLUMNS = ['Date', 'Time', 'Timestamp', 'Time of day', 'Type', 'Med ID', 'Detail', 'Amount (mg)', 'Note', 'Source', 'Entry ID', 'Logged at'];"),
      'EXPORT_COLUMNS changed');
  });

  await S.run('FILE-split-at-arrival', 'reason documents are removed from state.entries on arrival', async () => {
    assert(html.includes('const all = mrRaw.filter((e) => !e || e.medId !== MR_MED_ID);'),
      'the split in subscribeEntries is missing or altered');
  });

  await S.run('FILE-no-setState-in-onInput', 'no onInput handler anywhere calls setState', async () => {
    let idx = html.indexOf('onInput:');
    while (idx >= 0) {
      const window_ = html.slice(idx, idx + 160);
      assert(!window_.includes('setState'), 'an onInput handler calls setState: ' + window_.slice(0, 110));
      idx = html.indexOf('onInput:', idx + 1);
    }
  });

  await S.run('FILE-append-only-source', 'the feature never calls updateDoc or deleteDoc', async () => {
    const block = html.slice(html.indexOf('const MR_MED_ID'), html.indexOf('function missedRow(e, i)'));
    assert(!block.includes('updateDoc'), 'updateDoc appears in the reason block');
    assert(!block.includes('deleteDoc'), 'deleteDoc appears in the reason block');
    assert(!block.includes('removeEntryDB'), 'removeEntryDB appears in the reason block');
    assert((block.match(/addEntryDB\(/g) || []).length === 2, 'expected exactly two appends (save + remove)');
  });

  await S.run('FILE-namespace-isolation', 'no ChemoWell storage keys or collections are referenced', async () => {
    // The word "ChemoWell" appears in this file's comments and in the base's, which is fine and is
    // how a port should be attributed. What must never appear is one of ChemoWell's STORAGE
    // identifiers — a shared key or collection name would wire two unrelated patients' apps
    // together.
    for (const k of ['dismissedMisses', 'chemowell_', 'cw_profile', 'chemowell-app',
      'WEIGHT_REASONS', 'SUPPORT_LINK', 'MISSED_TRACK_SINCE = Date.now()']) {
      assert(!html.includes(k), 'a ChemoWell identifier leaked into care-tracker: ' + k);
    }
    assert(html.includes("const COL_NAME = 'caretracker_entries'") || html.includes("caretracker_entries"),
      'care-tracker no longer names its own collection');
    assert(html.includes("const MR_MED_ID = 'missed_reason';"), 'the reason namespace changed');
  });

  await S.run('COPY-no-judgment', 'no reason option assigns blame', async () => {
    const block = html.slice(html.indexOf('const MR_REASONS = ['), html.indexOf('const MR_NOTE_ONLY_LABEL'));
    for (const word of ['Forgot', 'forgot', 'careless', 'Careless', 'lazy', 'failed', 'Failed',
      'non-compliant', 'noncompliant', 'refused', 'Refused', 'neglect']) {
      assert(!block.includes(word), 'judgmental wording in the reason list: "' + word + '"');
    }
    // And the list is actually the ported one, not an empty array that trivially passes.
    for (const label of ['Felt too nauseous', 'Was asleep', 'Care team said to hold it', 'Something else']) {
      assert(block.includes(label), 'expected reason missing: ' + label);
    }
  });

  // ---- live checks -------------------------------------------------------------------------
  await withPage(html, buildFixture(), async ({ page, downloads, consoleErrors }) => {

    await S.run('OPTIONAL-nothing-auto-opens', 'nothing opens the reason sheet on its own', async () => {
      await page.waitForTimeout(1200);
      assert(await page.$('[data-mr-sheet]') === null, 'the reason sheet opened without being asked for');
      await gotoHistory(page);
      await page.waitForTimeout(1200);
      assert(await page.$('[data-mr-sheet]') === null, 'the reason sheet opened on its own in History');
    });

    await S.run('BANNER-unchanged', 'the missed-dose banner gained no reason prompt, badge or count', async () => {
      await tap(page, 'nav[aria-label="Primary navigation"] button[aria-label="Home"]');
      await page.waitForTimeout(400);
      const bannerText = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('div'));
        const b = nodes.find(n => /MISSED DOSE/i.test(n.textContent || '') && n.textContent.length < 4000);
        return b ? b.textContent : '';
      });
      assert(bannerText.length > 0, 'no missed-dose banner rendered — the fixture is wrong, not the patch');
      assert(!/reason/i.test(bannerText), 'the banner now asks for a reason: ' + bannerText.slice(0, 160));
    });

    await S.run('ROW-affordance', 'every missed row offers a quiet, optional way in', async () => {
      await gotoHistory(page);
      const n = await page.$$eval('[data-mr-missed-row]', els => els.length);
      assertGte(n, 10, 'too few derived missed rows for a meaningful test');
      const buttons = await page.$$eval('[data-mr-missed-row]', els =>
        els.map(el => { const b = el.querySelector('[data-mr-row-button]'); return b ? b.textContent.trim() : null; }));
      assert(buttons.every(t => t === 'Add a reason' || t === 'Change'),
        'a missed row has no reason button, or unexpected label: ' + JSON.stringify(buttons.slice(0, 6)));
    });

    await S.run('SUPERSEDE-newest-wins', 'the newest answer for a key wins and the older one vanishes', async () => {
      await gotoHistory(page);
      const txt = await rowReasonText(page, KEY_SUPERSEDE);
      assert(txt === 'Felt too nauseous', 'expected the newer answer, got "' + txt + '"');
      const all = await page.$$eval('[data-mr-row-reason]', els => els.map(e => e.textContent.trim()));
      assert(!all.includes('Was asleep'), 'the superseded answer is still on screen');
    });

    await S.run('NOTE-round-trips', 'a saved note is shown back on the row and in the sheet', async () => {
      await gotoHistory(page);
      const note = await page.$eval('[data-mr-missed-row="' + KEY_SUPERSEDE + '"]',
        el => { const n = el.querySelector('[data-mr-row-note]'); return n ? n.textContent.trim() : ''; });
      assert(note.includes('MRFIXTURE-note-kept-down-until-lunch'), 'the saved note is not shown on the row: "' + note + '"');
      await openSheetFor(page, KEY_SUPERSEDE);
      const inSheet = await page.$eval('[data-mr-note-input]', el => el.value);
      assert(inSheet.includes('MRFIXTURE-note-kept-down-until-lunch'), 'the sheet did not reload the saved note');
      const pressed = await page.$eval('[data-mr-chip="nausea"]', el => el.getAttribute('aria-pressed'));
      assert(pressed === 'true', 'the sheet did not reload the saved selection');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('PROTO-labels-survive', 'a snapshotted reason label that is an Object.prototype name does not break anything', async () => {
      await gotoHistory(page);
      const txt = await rowReasonText(page, KEY_LABEL);
      assert(txt === 'constructor', 'a legacy label did not round-trip to the row: "' + txt + '"');
    });

    await S.run('PROTO-ids-survive', 'a reason filed under an Object.prototype medication id round-trips', async () => {
      await gotoHistory(page);
      const txt = await rowReasonText(page, KEY_PROTO);
      assert(txt === 'Felt too unwell', 'a reason on medication id "constructor" did not survive, got "' + txt + '"');
    });

    await S.run('REMOVE-reads-as-none', 'an appended empty answer reads as no reason at all', async () => {
      await gotoHistory(page);
      const txt = await rowReasonText(page, KEY_REMOVED);
      assert(txt === '', 'a retracted reason is still showing: "' + txt + '"');
      const label = await page.$eval('[data-mr-missed-row="' + KEY_REMOVED + '"] [data-mr-row-button]', el => el.textContent.trim());
      assert(label === 'Add a reason', 'the button did not return to its empty state: "' + label + '"');
    });

    await S.run('ORPHAN-hidden', 'a reason whose window was later covered surfaces nowhere', async () => {
      await gotoHistory(page);
      const body = await page.evaluate(() => document.body.innerText);
      assert(!body.includes('MRFIXTURE-orphan-must-not-render'),
        'a reason attached to a window that is no longer missed is being rendered');
    });

    await S.run('JUNK-tolerated', 'malformed reason documents throw nothing and render nothing', async () => {
      assert(consoleErrors.length === 0, 'page errors: ' + consoleErrors.join(' | '));
    });

    await S.run('IDENTITY-one-window-only', 'a new reason attaches to exactly one derived window', async () => {
      await gotoHistory(page);
      const before = await page.$$eval('[data-mr-row-reason]', els => els.length);
      await openSheetFor(page, KEY_UI);
      await chooseAndSave(page, 'asleep', null);
      await page.waitForTimeout(400);
      const after = await page.$$eval('[data-mr-row-reason]', els => els.length);
      assert(after === before + 1, 'expected exactly one new reason chip, went from ' + before + ' to ' + after);
      const txt = await rowReasonText(page, KEY_UI);
      assert(txt === 'Was asleep', 'the reason did not land on the row it was recorded against: "' + txt + '"');
    });

    await S.run('APPEND-only-no-deletes', 'saving, changing and removing are all inserts', async () => {
      const rec0 = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__mrStub.rec)));
      await gotoHistory(page);
      // change the answer
      await openSheetFor(page, KEY_UI);
      await chooseAndSave(page, 'ranout', null);
      await page.waitForTimeout(300);
      assert(await rowReasonText(page, KEY_UI) === 'Ran out of it', 'changing the answer did not take effect');
      // remove it
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-remove]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
      await page.waitForTimeout(300);
      assert(await rowReasonText(page, KEY_UI) === '', 'removing the answer did not take effect');

      const rec = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__mrStub.rec)));
      assert(rec.deleteDoc.length === 0, 'a delete was issued: ' + JSON.stringify(rec.deleteDoc));
      const setToEntries = rec.setDoc.filter(s => s.col !== 'caretracker_prefs' && s.col !== 'fcm_tokens');
      assert(setToEntries.length === 0, 'an existing document was overwritten: ' + JSON.stringify(setToEntries));
      const adds = rec.addDoc.slice(rec0.addDoc.length).filter(a => a.data && a.data.medId === 'missed_reason');
      assert(adds.length === 2, 'expected 2 appends (change + remove), got ' + adds.length);
      assert(adds[0].data.reasonId === 'ranout', 'the change append carried the wrong reason');
      assert(adds[1].data.reasonId === '', 'the removal append is not an empty answer');
      for (const a of adds) {
        assert(a.col === 'caretracker_entries', 'a reason was written to the wrong collection: ' + a.col);
        assert(a.data.missMedId === 'protonix', 'missMedId wrong: ' + a.data.missMedId);
        assert(a.data.missTs === at(DAY_UI, 0), 'missTs is not the window start: ' + a.data.missTs);
        assert(typeof a.data.loggedAt === 'number' && a.data.loggedAt > 0, 'loggedAt missing — supersede would be undecidable');
      }
    });

    await S.run('ROW-button-does-not-log', 'the reason button does not fire the row\'s log-a-dose flow', async () => {
      await gotoHistory(page);
      await tap(page, '[data-mr-missed-row="' + KEY_PROTO + '"] [data-mr-row-button]');
      await page.waitForSelector('[data-mr-sheet]', { timeout: 8000 });
      const modal = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('div'));
        return nodes.some(n => /Date & Time/.test(n.textContent || '') && n.querySelector('input[type="datetime-local"]'));
      });
      assert(!modal, 'tapping "Change" also opened the log-a-dose modal underneath');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('ROW-still-logs', 'the row itself still opens the backfill log flow', async () => {
      await gotoHistory(page);
      await tap(page, '[data-mr-missed-row="' + KEY_PROTO + '"] > div:first-child');
      await page.waitForTimeout(500);
      const modal = await page.evaluate(() => !!document.querySelector('input[type="datetime-local"]'));
      assert(modal, 'tapping the missed row no longer opens the log flow — the original behaviour regressed');
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Cancel');
        if (b) b.click();
      });
      await page.waitForTimeout(300);
    });

    await S.run('TAP-44px-targets', 'every control in the sheet and on the row is at least 44px', async () => {
      await gotoHistory(page);
      const rowBtn = await page.$eval('[data-mr-row-button]', el => el.getBoundingClientRect().height);
      assertGte(Math.round(rowBtn), 44, 'row reason button height');
      await openSheetFor(page, KEY_PROTO);
      const chips = await page.$$eval('[data-mr-chip]', els => els.map(e => e.getBoundingClientRect().height));
      assert(chips.length === 9, 'expected 9 reason chips, found ' + chips.length);
      chips.forEach((hgt, i) => assertGte(Math.round(hgt), 44, 'chip ' + i + ' height'));
      for (const sel of ['[data-mr-save]', '[data-mr-cancel]', '[data-mr-remove]']) {
        const el = await page.$(sel);
        if (!el) continue;
        const box = await el.boundingBox();
        assertGte(Math.round(box.height), 44, sel + ' height');
      }
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('FONT-16px-note', 'the note field is at least 16px so iOS does not zoom in', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_PROTO);
      const size = await page.$eval('[data-mr-note-input]', el => parseFloat(getComputedStyle(el).fontSize));
      assertGte(size, 16, 'note field font size');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('SHEET-fits-viewport', 'the sheet fits a 375x812 phone with nothing clipped off-screen', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_PROTO);
      const box = await page.$eval('[data-mr-sheet]', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, sh: el.scrollHeight, ch: el.clientHeight };
      });
      assert(box.left >= 0 && box.right <= VIEWPORT.w, 'the sheet overflows horizontally: ' + JSON.stringify(box));
      assert(box.top >= 0 && box.bottom <= VIEWPORT.h + 1, 'the sheet overflows vertically: ' + JSON.stringify(box));
      // Anything taller than the panel must be reachable by scrolling, not cut off.
      assert(box.sh <= box.ch + 1 || (await page.$eval('[data-mr-sheet]', el => getComputedStyle(el).overflowY)) === 'auto',
        'the sheet is taller than its box and does not scroll');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('TRAP-no-null-attributes', 'no control is disabled by a stringified null/false attribute', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_PROTO);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('*').forEach(el => {
          for (const a of Array.from(el.attributes)) {
            if (a.value === 'null' || a.value === 'undefined' || (a.name === 'disabled' && a.value === 'false')) {
              out.push(el.tagName + '[' + a.name + '="' + a.value + '"]');
            }
          }
        });
        return out;
      });
      assert(bad.length === 0, 'null-valued attributes rendered: ' + bad.join(', '));
      const saveDisabled = await page.$eval('[data-mr-save]', el => el.disabled);
      assert(saveDisabled === false, 'the Save button is disabled when it should not be');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('A11Y-dialog-semantics', 'the sheet is a labelled modal dialog and the chips report their state', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_PROTO);
      const attrs = await page.$eval('[data-mr-sheet]', el => ({
        role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'), label: el.getAttribute('aria-label')
      }));
      assert(attrs.role === 'dialog' && attrs.modal === 'true' && attrs.label, 'sheet semantics: ' + JSON.stringify(attrs));
      const pressed = await page.$$eval('[data-mr-chip]', els => els.map(e => e.getAttribute('aria-pressed')));
      assert(pressed.every(p => p === 'true' || p === 'false'), 'a chip has no aria-pressed state');
      assert(pressed.filter(p => p === 'true').length === 1, 'exactly one chip should be selected for a saved reason');
      const rowLabel = await page.$eval('[data-mr-missed-row="' + KEY_PROTO + '"] [data-mr-row-button]', el => el.getAttribute('aria-label'));
      assert(rowLabel && rowLabel.includes('Constructor'), 'the row button has no medication-specific accessible name');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('TICK-sheet-survives', 'no repaint rebuilds the open sheet — not the clock tick, not a clearing toast', async () => {
      await gotoHistory(page);
      // Raise a toast first, so the 4.5s toast-clear repaint is armed and pending while the sheet
      // is open. This is the realistic sequence: save one reason, then immediately open the next.
      await openSheetFor(page, KEY_UI);
      await chooseAndSave(page, 'asleep', null);
      await page.waitForTimeout(250);
      await openSheetFor(page, KEY_SUPERSEDE);
      await page.evaluate(() => {
        document.querySelector('[data-mr-sheet]').__mrMark = 'alive';
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      });
      // Past five clock ticks AND past the 4.5s toast deadline.
      await page.waitForTimeout(5600);
      const alive = await page.evaluate(() => {
        const el = document.querySelector('[data-mr-sheet]');
        return !!el && el.__mrMark === 'alive';
      });
      assert(alive, 'the sheet node was rebuilt under the patient — a tap spanning a repaint is swallowed');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
      // ...and the toast must still clear once the sheet is gone, not stick forever.
      await page.waitForTimeout(1400);
      const toast = await page.evaluate(() => {
        const el = document.querySelector('[role="status"]');
        return el ? el.textContent.trim() : '';
      });
      assert(toast === '', 'the deferred toast never cleared after the sheet closed: "' + toast + '"');
      // put KEY_UI back to empty for the checks that follow
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-remove]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
    });

    await S.run('TYPE-note-survives', 'typing in the note field is not destroyed mid-keystroke', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-note-input]');
      await page.focus('[data-mr-note-input]');
      await page.keyboard.type(FX.NOTE_TYPED, { delay: 12 });
      await page.waitForTimeout(1600);
      const val = await page.$eval('[data-mr-note-input]', el => el.value);
      assert(val === FX.NOTE_TYPED, 'the typed note was mangled: "' + val + '"');
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-mr-note-input'));
      assert(focused, 'focus left the note field while typing');
      await tap(page, '[data-mr-cancel]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached' });
    });

    await S.run('SAVE-note-only', 'a note with no chip chosen is still saved', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_UI);
      await page.fill('[data-mr-note-input]', 'MRFIXTURE-note-without-a-chip');
      await tap(page, '[data-mr-save]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
      await page.waitForTimeout(300);
      const note = await page.$eval('[data-mr-missed-row="' + KEY_UI + '"]',
        el => { const n = el.querySelector('[data-mr-row-note]'); return n ? n.textContent.trim() : ''; });
      assert(note === 'MRFIXTURE-note-without-a-chip', 'a note-only answer was not kept: "' + note + '"');
      // ...and put it back to empty so the export checks below see a clean slate.
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-remove]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
    });

    await S.run('SAVE-empty-is-not-an-error', 'saving with nothing chosen closes quietly and records nothing', async () => {
      await gotoHistory(page);
      const rec0 = await page.evaluate(() => globalThis.__mrStub.rec.addDoc.length);
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-save]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
      const rec1 = await page.evaluate(() => globalThis.__mrStub.rec.addDoc.length);
      assert(rec1 === rec0, 'an empty save wrote a document');
      assert(await page.$('[data-mr-error]') === null, 'an empty save produced an error message');
    });

    await S.run('ERROR-is-recoverable', 'a failed write leaves the sheet open, usable and honest', async () => {
      await gotoHistory(page);
      await openSheetFor(page, KEY_UI);
      await page.evaluate(() => globalThis.__mrStub.failNextAdd());
      await tap(page, '[data-mr-chip="nausea"]');
      await tap(page, '[data-mr-save]');
      await page.waitForSelector('[data-mr-error]', { timeout: 8000 });
      const msg = await page.$eval('[data-mr-error]', el => el.textContent);
      assert(/records are safe/i.test(msg), 'the error message does not reassure about the data: ' + msg);
      const stillEnabled = await page.$eval('[data-mr-save]', el => el.disabled === false);
      assert(stillEnabled, 'the Save button stayed disabled after a failed write');
      await tap(page, '[data-mr-save]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
      await page.waitForTimeout(300);
      assert(await rowReasonText(page, KEY_UI) === 'Felt too nauseous', 'the retry did not save');
      await openSheetFor(page, KEY_UI);
      await tap(page, '[data-mr-remove]');
      await page.waitForSelector('[data-mr-sheet]', { state: 'detached', timeout: 8000 });
    });

    await S.run('SYNC-second-device', 'a reason written on another device appears without a reload', async () => {
      await gotoHistory(page);
      const key = 'protonix|' + at(backDays(11), 0);
      assert(await page.$('[data-mr-missed-row="' + key + '"]') !== null, 'fixture row missing: ' + key);
      await page.evaluate(({ k, ts, t0 }) => {
        globalThis.__mrStub.push({ medId: 'missed_reason', missMedId: 'protonix', missTs: ts,
          missWindow: 'Overnight', reasonId: 'held', reasonLabel: 'Care team said to hold it',
          note: '', ts: ts, mg: 0, dose: 'Missed-dose reason', loggedAt: t0 });
      }, { k: key, ts: at(backDays(11), 0), t0: Date.now() });
      await page.waitForTimeout(600);
      const txt = await rowReasonText(page, key);
      assert(txt === 'Care team said to hold it', 'a synced reason did not appear: "' + txt + '"');
    });

    await S.run('REPORT-carries-reasons', 'the printable report carries the reasons, separated from the dose data', async () => {
      const doc = await saveReport(page, downloads);
      assert(doc.includes('Scheduled doses with nothing logged'), 'the calculated missed section is missing');
      assert(doc.includes('recorded about these'), 'the reasons subsection is missing from the report');
      assert(doc.includes('Felt too nauseous'), 'a recorded reason is missing from the report');
      assert(doc.includes('Felt too unwell'), 'the Object.prototype-id reason is missing from the report');
      assert(/<td>constructor<\/td>/.test(doc), 'the Object.prototype-named label is missing from the report grouping');
      assert(doc.includes('MRFIXTURE-note-kept-down-until-lunch'), 'the note is missing from the report');
      assert(!doc.includes('Was asleep'), 'a superseded reason reached the report');
      assert(!doc.includes('Ran out of it'), 'a retracted reason reached the report');
      assert(!doc.includes('MRFIXTURE-orphan-must-not-render'), 'an orphaned reason reached the report');
      // Ordering: reasons sit UNDER the calculated table, not above the daily log.
      assert(doc.indexOf('Daily log') < doc.indexOf('recorded about these'),
        'the reasons subsection was placed above the daily log');
      assert(doc.indexOf('Scheduled doses with nothing logged') < doc.indexOf('recorded about these'),
        'the reasons subsection is not inside the calculated section');
    });

    await S.run('REPORT-reasons-not-in-log', 'no reason document appears as a row of the clinical daily log', async () => {
      const doc = await saveReport(page, downloads);
      assert(!doc.includes('Missed-dose reason'), 'a reason document printed as a log row');
      assert(!doc.includes('missed_reason'), 'the reason medId leaked into the report');
      const daily = doc.slice(doc.indexOf('Daily log'), doc.indexOf('Scheduled doses with nothing logged'));
      assert(!daily.includes('Felt too nauseous'), 'a reason leaked into the daily log table');
    });

    await S.run('CSV-no-reason-strings', 'the CSV contains no reason document and no reason wording', async () => {
      const csv = (await saveCSV(page, downloads)).toString('utf-8');
      assert(csv.includes('Med ID'), 'the CSV header is missing — the export did not run');
      assert(!csv.includes('missed_reason'), 'the reason medId is in the CSV');
      assert(!csv.includes('Missed-dose reason'), 'a reason document is in the CSV');
      for (const one of ['Felt too nauseous', 'Felt too unwell', 'MRFIXTURE-note-kept-down-until-lunch']) {
        assert(!csv.includes(one), 'reason wording leaked into the CSV: ' + one);
      }
    });

    await S.run('NET-1', 'nothing reached the network beyond the three stubbed modules', async () => {
      assert(NET.offSite.length === 0, 'unexpected off-site requests were attempted: ' + NET.offSite.slice(0, 5).join(', '));
      const firebaseish = NET.fonts.filter(u => /firestore|firebase|googleapis\.com\/v1/.test(u));
      assert(firebaseish.length === 0, 'a Firebase endpoint was contacted: ' + firebaseish.join(', '));
    });

    await S.run('NET-2', 'the service worker was never fetched', async () => {
      assert(NET.sw.length === 0, 'sw.js was requested: ' + NET.sw.join(', '));
    });
  });

  // ---- the CSV must be byte-identical with and without reason documents --------------------
  await S.run('CSV-byte-identical', 'reason documents do not change the CSV by a single byte', async () => {
    const withOut = await withPage(html, buildFixture({ withReasons: false }), async ({ page, downloads }) => saveCSV(page, downloads));
    const withIn = await withPage(html, buildFixture({ withReasons: true }), async ({ page, downloads }) => saveCSV(page, downloads));
    assert(withOut.length > 200, 'the control CSV is suspiciously small: ' + withOut.length + ' bytes');
    assert(withOut.equals(withIn),
      'the CSV changed when reason documents were present: ' + withOut.length + ' vs ' + withIn.length + ' bytes');
  });

  // ---- and the report must NOT invent a reasons section when there are none ----------------
  await S.run('REPORT-absent-without-reasons', 'no reasons recorded means no reasons subsection', async () => {
    const doc = await withPage(html, buildFixture({ withReasons: false }), async ({ page, downloads }) => saveReport(page, downloads));
    assert(doc.includes('Scheduled doses with nothing logged'), 'the calculated section vanished');
    assert(!doc.includes('recorded about these'), 'an empty reasons subsection was printed');
  });

  return S;
}

// =================================================================================================
// Main
// =================================================================================================

async function main() {
  if (!fs.existsSync(APP_FILE)) {
    console.error('No file at ' + APP_FILE + ' — apply reason-patch.py into ./work first, or pass --file.');
    process.exit(3);
  }
  const html = fs.readFileSync(APP_FILE, 'utf-8');

  if (!MODE_FALSIFY) {
    console.log('reason-test — verifying ' + APP_FILE);
    console.log('  viewport ' + VIEWPORT.w + 'x' + VIEWPORT.h + ', downloads captured, all Firebase stubbed\n');
    const S = await runChecks(html);
    for (const r of S.results) console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + ' — ' + r.desc + (r.ok ? '' : '\n          ' + r.err));
    const bad = S.failed();
    console.log('\n' + (S.results.length - bad.length) + '/' + S.results.length + ' checks passed');
    process.exit(bad.length ? 1 : 0);
  }

  // --falsify: break one guarded property at a time and prove the named checks go RED.
  const slice = BATCH ? MUTATORS.slice(BATCH[0], BATCH[1]) : MUTATORS;
  console.log('reason-test --falsify — ' + slice.length + ' of ' + MUTATORS.length + ' mutators'
    + (BATCH ? ' (batch ' + BATCH[0] + '-' + BATCH[1] + ')' : '') + '\n');
  let allGood = true;
  for (const m of slice) {
    let mutated;
    try { mutated = m.apply(html); }
    catch (err) { console.log('  ERROR ' + m.name + ' — ' + err.message); allGood = false; continue; }
    if (mutated === html) { console.log('  ERROR ' + m.name + ' — mutator changed nothing'); allGood = false; continue; }
    const S = await runChecks(mutated);
    const failedIds = S.failed().map(r => r.id);
    // A control mutator asserts the opposite: this change must NOT break anything, which is what
    // proves the neighbouring check is testing the guard rather than the guard's surroundings.
    if (m.expectGreen) {
      const ok = failedIds.length === 0;
      if (!ok) allGood = false;
      console.log((ok ? '  GREEN ' : '  RED   ') + m.name + '   [control — expected to stay green]');
      console.log('         ' + m.why);
      if (!ok) console.log('         *** unexpectedly went red: ' + failedIds.join(', '));
      continue;
    }
    const missed = m.expect.filter(id => !failedIds.includes(id));
    const ok = missed.length === 0;
    if (!ok) allGood = false;
    console.log((ok ? '  RED   ' : '  GREEN ') + m.name);
    console.log('         ' + m.why);
    console.log('         expected RED: ' + m.expect.join(', '));
    console.log('         actually RED: ' + (failedIds.length ? failedIds.join(', ') : '(nothing)'));
    if (!ok) console.log('         *** these did not go red: ' + missed.join(', '));
  }
  console.log('\n' + (allGood ? 'every mutator was caught' : 'SOME MUTATORS WERE NOT CAUGHT'));
  process.exit(allGood ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(4); });
