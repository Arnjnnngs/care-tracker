#!/usr/bin/env node
/**
 * export-test.mjs — verification suite for the care-tracker backup / restore patch.
 *
 * SAFETY (non-negotiable — this app holds one cancer patient's real medication history):
 *   * ALL THREE gstatic Firebase modules are stubbed. A single catch-all route aborts every
 *     request that is not 127.0.0.1 or one of those three stubs, and NET-1 fails the run if
 *     anything at all was refused. Nothing here can reach the real Firestore project.
 *   * The service worker is deleted from the page before any script runs (sw.js is cache-first and
 *     would serve a stale build between runs). NET-2 fails the run if sw.js was ever requested.
 *   * Fixtures only. No credentials, no network, no writes anywhere but the in-memory stub.
 *
 * WHAT IS ACTUALLY PROVEN, AND HOW
 *   * ROUND TRIP AT BYTE LEVEL, not field equality: save a backup, EMPTY the database, load the
 *     file back through the real <input type="file">, save a second backup, compare the md5 of
 *     the two downloaded files. The stub deliberately hands getDocs() the documents in reverse
 *     order the second time round, so a missing sort or a field-order difference shows up as a
 *     different digest rather than passing on a lenient comparison.
 *   * THE CSV / REPORT NON-LEAK IS PROVEN FROM DOWNLOADED BYTES, and it asserts on the things
 *     that actually leak: the medId, the dose label, the private note and the document id.
 *     Asserting on appointment TITLES would be worthless — neither file has a title column, so
 *     such a check stays green straight through a live leak. Every sentinel is also asserted
 *     PRESENT in the backup file produced in the same run, so the absence checks cannot pass
 *     because the fixture never reached the app.
 *
 * RUN
 *   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node export-test.mjs
 *   ... node export-test.mjs --falsify        # break each guarded thing, prove the check goes RED
 *   ... node export-test.mjs --file <path>    # verify a different patched index.html
 *   ... node export-test.mjs --only <substr>  # run a subset
 *
 * HTTPS_PROXY must be unset: it breaks Chromium against loopback. The suite refuses to start
 * otherwise rather than failing every check for the wrong reason.
 */

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/opt/pw-browsers/chromium';

const argv = process.argv.slice(2);
const MODE_FALSIFY = argv.includes('--falsify');
const FILE_ARG = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : null; })();
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
const APP_FILE = FILE_ARG || path.join(HERE, 'work', 'index.html');
const TMP = path.join(HERE, '.tmp');

for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
  if (process.env[v]) {
    console.error('REFUSING TO RUN: ' + v + ' is set. Chromium cannot reach 127.0.0.1 through the');
    console.error('proxy and every check would fail for the wrong reason. Re-run under:');
    console.error('  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node export-test.mjs');
    process.exit(3);
  }
}

// The clock is pinned so that the two backup files produced by the round trip carry the same
// `createdAt`. Everything else in the file is content; this is the one field that is a clock
// reading, and freezing it is what lets the comparison be a whole-file md5 rather than a
// comparison with an exception carved out of it.
const FIXED_NOW = new Date(2026, 7, 17, 15, 30, 0, 0).getTime();

// =================================================================================================
// Firebase stubs — three ES modules served in place of the three gstatic URLs
// =================================================================================================

const STUB_APP = `export function initializeApp(cfg) { return { name: '[DEFAULT]', options: cfg }; }`;

const STUB_MESSAGING = `
export function getMessaging() { throw new Error('messaging disabled in the test harness'); }
export async function getToken() { return null; }
export function onMessage() { return () => {}; }
`;

// A Firestore good enough for this app's exact surface, and hostile in the one way that matters:
// getDocs() alternates the order it hands documents back, so anything that depends on Firestore's
// ordering is caught rather than accommodated.
const STUB_FIRESTORE = `
const fx = (globalThis.__EXP_FIXTURE__ || { entries: [], prefs: null });
const store = {
  entries: JSON.parse(JSON.stringify(fx.entries)),
  prefs: fx.prefs ? JSON.parse(JSON.stringify(fx.prefs)) : {},
  prefsExists: !!fx.prefs
};
const entryListeners = [];
const prefsListeners = [];
let autoId = 0;
let getDocsCalls = 0;

const rec = { addDoc: [], deleteDoc: [], setDoc: [], setDocIds: [], snapshots: 0 };
globalThis.__bk = {
  rec,
  all() { return JSON.parse(JSON.stringify(store.entries)); },
  ids() { return store.entries.map(e => e.id); },
  count() { return store.entries.length; },
  prefs() { return JSON.parse(JSON.stringify(store.prefs)); },
  // Empty the database. Not a delete through the app -- the app has no such mechanism and must
  // not grow one -- this is "the phone was replaced" / "the project was wiped".
  wipe() { store.entries.length = 0; store.prefs = {}; store.prefsExists = false; emitEntries(); emitPrefs(); },
  // Edit a live document in place, keeping its id, the way another client would.
  setField(id, key, value) { const d = store.entries.find(e => e.id === id); if (d) { d[key] = value; emitEntries(); } return !!d; },
  // Push a document straight through onSnapshot, the way the OTHER phone syncing would.
  push(d) { store.entries.push(Object.assign({ id: 'pushed-' + (++autoId) }, JSON.parse(JSON.stringify(d)))); emitEntries(); },
  reset() { rec.addDoc.length = 0; rec.deleteDoc.length = 0; rec.setDoc.length = 0; rec.setDocIds.length = 0; }
};

function copyOf(e) { const c = JSON.parse(JSON.stringify(e)); delete c.id; return c; }
function snapOf(list) { return { docs: list.map(e => ({ id: e.id, data: () => copyOf(e) })) }; }
// Rotate by a different amount on every getDocs() call. Firestore promises no document order for
// a bare collection read, and a document rebuilt from a restored file has no reason to carry its
// fields in the order the original did. Rotating BOTH means the two exports of the round trip see
// genuinely different orderings, so a backup that only round-trips because the database happened
// to hand things back the same way twice fails instead of passing.
function rotate(arr, k) { if (arr.length < 2) return arr; const n = ((k % arr.length) + arr.length) % arr.length; return arr.slice(n).concat(arr.slice(0, n)); }
function rotateKeys(o, k) { const out = {}; rotate(Object.keys(o), k).forEach(x => { out[x] = o[x]; }); return out; }
function emitEntries() {
  const sorted = store.entries.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  rec.snapshots++;
  for (const cb of entryListeners) cb(snapOf(sorted));
}
function emitPrefs() {
  for (const cb of prefsListeners) cb({ exists: () => store.prefsExists, data: () => JSON.parse(JSON.stringify(store.prefs)) });
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
  const id = 'added-' + (++autoId);
  store.entries.push(Object.assign({ id }, JSON.parse(JSON.stringify(data))));
  emitEntries();
  return { id };
}
export async function deleteDoc(ref) {
  rec.deleteDoc.push({ col: ref && ref.col, id: ref && ref.id });
  store.entries = store.entries.filter(e => e.id !== (ref && ref.id));
  emitEntries();
}
export async function setDoc(ref, data, opts) {
  const payload = JSON.parse(JSON.stringify(data));
  rec.setDoc.push({ col: ref && ref.col, id: ref && ref.id, data: payload, merge: !!(opts && opts.merge) });
  if (ref && ref.col === 'caretracker_prefs') {
    if (opts && opts.merge) Object.assign(store.prefs, payload); else store.prefs = payload;
    store.prefsExists = true;
    emitPrefs();
    return;
  }
  if (ref && ref.col === 'caretracker_entries') {
    rec.setDocIds.push(ref.id);
    const i = store.entries.findIndex(e => e.id === ref.id);
    const next = Object.assign({}, payload, { id: ref.id });
    if (i >= 0) store.entries[i] = next; else store.entries.push(next);
    emitEntries();
    return;
  }
}
export async function getDocs(target) {
  if (target && target.name === 'caretracker_prefs') {
    return { docs: store.prefsExists ? [{ id: 'settings', data: () => JSON.parse(JSON.stringify(store.prefs)) }] : [] };
  }
  getDocsCalls++;
  const k = getDocsCalls;
  const list = rotate(store.entries.slice(), k);
  return { docs: list.map(e => ({ id: e.id, data: () => rotateKeys(copyOf(e), k) })) };
}
`;

const GSTATIC = {
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js': STUB_APP,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js': STUB_FIRESTORE,
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js': STUB_MESSAGING
};

// =================================================================================================
// Fixtures
// =================================================================================================

function atFixed(h, m) { const d = new Date(FIXED_NOW); d.setHours(h, m, 0, 0); return d.getTime(); }
const DAY = 86400000;

// Every sentinel below is asserted PRESENT in the backup file and ABSENT from the spreadsheet and
// the printable report, in the same run, from downloaded bytes.
const SENT = {
  APPT_TITLE: 'Oncology review EXPFIX-APPT-TITLE',
  APPT_TITLE_OLD: 'Oncology review OLD EXPFIX-APPT-SUPERSEDED',
  APPT_NOTE: 'Ask about the port line EXPFIX-APPT-NOTE',
  APPT_CANCELLED_TITLE: 'Scan EXPFIX-APPT-CANCELLED',
  APPT_DOSE: 'Appointment',
  APPT_DOSE_REMOVED: 'Appointment removed',
  APPT_MEDID: 'appointment',
  APPT_DOC_1: 'expfix-appt-doc-1',
  APPT_DOC_2: 'expfix-appt-doc-2',
  APPT_DOC_3: 'expfix-appt-doc-3',
  APPT_DOC_PROTO: 'valueOf',
  REASON_MEDID: 'missed_reason',
  REASON_NOTE: 'Felt too sick EXPFIX-REASON-NOTE',
  REASON_LABEL: 'Too unwell EXPFIX-REASON-LABEL',
  REASON_DOSE: 'Missed-dose reason',
  REASON_DOC_1: 'expfix-reason-doc-1',
  REASON_DOC_PROTO: 'hasOwnProperty',
  REMOVED_MED_ID: 'expfix-removed-med',
  REMOVED_MED_NAME: 'Old Antinausea EXPFIX-ARCHIVED-NAME',
  REMOVED_MED_DOSE: '10 mg EXPFIX-REMOVED-DOSE',
  DOSE_DOC_PROTO_1: 'constructor',
  DOSE_DOC_PROTO_2: 'toString'
};

// Document ids that are inherited property names of Object.prototype. All four are legal Firestore
// document ids ('__proto__' is not — Firestore reserves __.*__ — which is exactly why the plain-{}
// bug is so easy to miss: the one id everybody tests with cannot occur, and these four can).
const PROTO_IDS = [SENT.DOSE_DOC_PROTO_1, SENT.DOSE_DOC_PROTO_2, SENT.APPT_DOC_PROTO, SENT.REASON_DOC_PROTO];

function buildFixture() {
  const entries = [
    // Ordinary logged documents, so the spreadsheet under test is not empty. An empty CSV would
    // let every "appointments are absent" check pass for the wrong reason.
    { id: 'expfix-dose-1', medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: atFixed(8, 0), loggedAt: atFixed(8, 0) },
    { id: 'expfix-dose-2', medId: 'tylenol', dose: '1000 mg', mg: 1000, pills: 2, ts: atFixed(12, 0), loggedAt: atFixed(12, 0) },
    { id: 'expfix-temp-1', medId: 'temp', temp: 99.4, dose: '99.4 °F', mg: 0, ts: atFixed(9, 0), loggedAt: atFixed(9, 0) },
    { id: 'expfix-sym-1', medId: 'symptom_nausea', dose: null, mg: 0, note: 'after breakfast', ts: atFixed(9, 30), loggedAt: atFixed(9, 30) },

    // Document ids that are Object.prototype property names.
    { id: SENT.DOSE_DOC_PROTO_1, medId: 'zofran', dose: '4 mg', mg: 4, ts: atFixed(10, 0), loggedAt: atFixed(10, 0) },
    { id: SENT.DOSE_DOC_PROTO_2, medId: 'temp', temp: 100.9, dose: '100.9 °F', mg: 0, ts: atFixed(11, 0), loggedAt: atFixed(11, 0) },

    // A chemo date and a cleared-chemo tombstone (ts:0). Both are real documents.
    { id: 'expfix-chemo-1', medId: 'chemo_date', dose: 'Chemo scheduled', mg: 0, ts: atFixed(9, 0) + 3 * DAY, loggedAt: atFixed(8, 30) },
    { id: 'expfix-chemo-0', medId: 'chemo_date', dose: 'Chemo date cleared', mg: 0, ts: 0, loggedAt: atFixed(8, 20) },

    // RULE 12 — a medication that has been REMOVED from the list. Its past doses are real medical
    // history. They must be in the backup and must come back out of it.
    { id: 'expfix-removed-dose-1', medId: SENT.REMOVED_MED_ID, dose: SENT.REMOVED_MED_DOSE, mg: 10, ts: atFixed(7, 0) - 2 * DAY, loggedAt: atFixed(7, 0) - 2 * DAY },
    { id: 'expfix-removed-dose-2', medId: SENT.REMOVED_MED_ID, dose: SENT.REMOVED_MED_DOSE, mg: 10, ts: atFixed(19, 0) - 2 * DAY, loggedAt: atFixed(19, 0) - 2 * DAY },

    // Appointments. Append-only history: a superseded version, its live replacement, a live one
    // carrying a private note, and a tombstoned pair.
    { id: SENT.APPT_DOC_1, medId: 'appointment', apptId: 'expfix-appt-a', title: SENT.APPT_TITLE_OLD, note: '', ts: atFixed(14, 0), cancelled: false, dose: SENT.APPT_DOSE, mg: 0, loggedAt: FIXED_NOW - 9000 },
    { id: SENT.APPT_DOC_2, medId: 'appointment', apptId: 'expfix-appt-a', title: SENT.APPT_TITLE, note: SENT.APPT_NOTE, ts: atFixed(14, 30), cancelled: false, dose: SENT.APPT_DOSE, mg: 0, loggedAt: FIXED_NOW - 8000 },
    { id: SENT.APPT_DOC_3, medId: 'appointment', apptId: 'expfix-appt-b', title: SENT.APPT_CANCELLED_TITLE, note: '', ts: atFixed(16, 0), cancelled: true, dose: SENT.APPT_DOSE_REMOVED, mg: 0, loggedAt: FIXED_NOW - 7000 },
    { id: SENT.APPT_DOC_PROTO, medId: 'appointment', apptId: 'expfix-appt-c', title: 'Bloods EXPFIX-APPT-PROTO', note: '', ts: atFixed(11, 15), cancelled: false, dose: SENT.APPT_DOSE, mg: 0, loggedAt: FIXED_NOW - 6000 },

    // Missed-dose reason documents. Entries-collection documents that are not doses.
    { id: SENT.REASON_DOC_1, medId: 'missed_reason', missMedId: 'protonix', missTs: atFixed(8, 0) - DAY, missWindow: 'Morning', reasonId: 'unwell', reasonLabel: SENT.REASON_LABEL, note: SENT.REASON_NOTE, ts: atFixed(8, 0) - DAY, mg: 0, dose: SENT.REASON_DOSE, loggedAt: FIXED_NOW - 5000 },
    { id: SENT.REASON_DOC_PROTO, medId: 'missed_reason', missMedId: 'iron', missTs: atFixed(22, 0) - DAY, missWindow: 'Night', reasonId: 'asleep', reasonLabel: SENT.REASON_LABEL, note: SENT.REASON_NOTE, ts: atFixed(22, 0) - DAY, mg: 0, dose: SENT.REASON_DOSE, loggedAt: FIXED_NOW - 4000 }
  ];
  return { entries, prefs: { missedClearedAt: atFixed(7, 0) } };
}

// A device medication list that has already had one medication REMOVED. Seeded into localStorage
// before boot so loadMedicationConfig() picks it up.
const MED_CONFIG_KEY = 'caretracker-medication-config-v1';
function buildMedConfig() {
  return {
    version: 1,
    meds: [{ id: 'tylenol', name: 'Tylenol', sub: 'Acetaminophen', type: 'gap', gapH: 4, doses: [{ label: '500 mg', mg: 500 }] }],
    archivedMeds: { [SENT.REMOVED_MED_ID]: { name: SENT.REMOVED_MED_NAME, sub: 'discontinued' } }
  };
}

// An OLD backup file: format v1 with NO appointments section at all, the way one written before
// appointments were captured looks. It must import cleanly.
function buildLegacyBackup() {
  return {
    format: 'care-tracker-backup',
    formatVersion: 1,
    app: 'v43.4',
    patient: 'Brandi',
    createdAt: FIXED_NOW - 400000,
    entries: [
      { id: 'expfix-legacy-1', medId: 'tylenol', dose: '500 mg', mg: 500, ts: atFixed(6, 0) - 5 * DAY, loggedAt: atFixed(6, 0) - 5 * DAY },
      { id: 'expfix-legacy-2', medId: 'weight', weight: 141, dose: '141 lbs', mg: 0, ts: atFixed(6, 30) - 5 * DAY, loggedAt: atFixed(6, 30) - 5 * DAY }
    ],
    prefs: null,
    medications: null
  };
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
    name: 'here-map-is-plain-object',
    why: 'restores the plain {} membership map — every record whose document id is an Object.prototype name is silently skipped while the screen reports a clean restore',
    expect: ['PROTO-ids-restore', 'ROUNDTRIP-bytes'],
    apply: (h) => must(h, 'const here = Object.create(null);', 'const here = {};')
  },
  {
    name: 'appointments-dropped-from-backup',
    why: 'drops the appointments section from the backup file — the original defect',
    // NOT ROUNDTRIP-bytes. Dropping a whole section is SYMMETRIC: both exports omit it, so the
    // two files still match byte for byte. A round trip proves nothing is lost BETWEEN the file
    // and the database; it cannot prove the file is COMPLETE. That takes a separate assertion,
    // which is what BACKUP-has-appointments is for. Recorded here rather than papered over.
    expect: ['BACKUP-has-appointments', 'BACKUP-has-sentinels', 'RESTORE-keeps-ids'],
    apply: (h) => must(h, '    appointments: bundle.appointments,', '    appointments: [],')
  },
  {
    name: 'appointments-leak-into-export',
    why: 'widens allExportEntries() to include appointments — they reach the spreadsheet and the record handed to an oncologist',
    expect: ['CSV-no-appointment-leak', 'REPORT-no-appointment-leak', 'FILE-allExportEntries'],
    apply: (h) => must(h, 'return (state.entries || []).concat(state.chemoDates || []);',
                          'return (state.entries || []).concat(state.chemoDates || []).concat(state.appointments || []);')
  },
  {
    name: 'reasons-leak-into-export',
    why: 'stops splitting missed_reason documents out of state.entries — they reach the spreadsheet and the report',
    expect: ['CSV-no-reason-leak', 'REPORT-no-reason-leak'],
    apply: (h) => must(h, '    const all = mrRaw.filter((e) => !e || e.medId !== MR_MED_ID);', '    const all = mrRaw.slice();')
  },
  {
    name: 'no-canonical-key-order',
    why: 'stops sorting object keys, so the same records serialise to different bytes depending on field order',
    expect: ['ROUNDTRIP-bytes', 'BACKUP-format'],
    apply: (h) => must(h, '    Object.keys(v).sort().forEach((k) => { out[k] = bkCanonical(v[k]); });',
                          '    Object.keys(v).forEach((k) => { out[k] = bkCanonical(v[k]); });')
  },
  {
    name: 'no-document-sort',
    why: 'stops sorting documents by id, so the file depends on the order Firestore happened to return',
    expect: ['ROUNDTRIP-bytes'],
    apply: (h) => must(h, '  const appointments = docs.filter((d) => d.medId === CAL_APPT_MED_ID).sort(bkById);\n  const entries = docs.filter((d) => d.medId !== CAL_APPT_MED_ID).sort(bkById);',
                          '  const appointments = docs.filter((d) => d.medId === CAL_APPT_MED_ID);\n  const entries = docs.filter((d) => d.medId !== CAL_APPT_MED_ID);')
  },
  {
    name: 'restore-mints-new-ids',
    why: 'restores with addDoc instead of setDoc under the original id — importing twice duplicates everything',
    expect: ['RESTORE-idempotent', 'RESTORE-keeps-ids', 'ROUNDTRIP-bytes'],
    apply: (h) => must(h, '      await setDoc(doc(db, COL_NAME, id), fields);', '      await addEntryDB(fields);')
  },
  {
    name: 'restore-overwrites-whats-here',
    why: 'stops skipping ids already on this phone, so a restore writes over the live record',
    expect: ['RESTORE-never-overwrites', 'RESTORE-idempotent'],
    apply: (h) => must(h, '    if (here[id]) { res.already++; continue; }', '    if (false) { res.already++; continue; }')
  },
  {
    name: 'legacy-file-rejected',
    why: 'requires an appointments array, so a backup written before appointments existed fails to import',
    expect: ['BACKCOMPAT-old-file'],
    apply: (h) => must(h, '  take(parsed.appointments);', '  if (!Array.isArray(parsed.appointments)) throw new Error(\'not-a-backup\');\n  take(parsed.appointments);')
  },
  {
    name: 'removed-med-history-dropped',
    why: 'filters the backup to medications currently on the list — a removed medication\'s dose history disappears from the backup',
    // Symmetric omission again — see the note on 'appointments-dropped-from-backup'.
    expect: ['BACKUP-keeps-removed-med-history', 'BACKUP-has-sentinels', 'RESTORE-removed-med-name-comes-back'],
    apply: (h) => must(h, '  const entries = docs.filter((d) => d.medId !== CAL_APPT_MED_ID).sort(bkById);',
                          '  const entries = docs.filter((d) => d.medId !== CAL_APPT_MED_ID && (state.meds || []).some((m) => m.id === d.medId)).sort(bkById);')
  },
  {
    name: 'conflict-check-removed',
    why: 'removes the concurrent-edit check from Save — the other phone\'s edit is silently overwritten',
    expect: ['CONFLICT-save-stops', 'CONFLICT-no-write'],
    apply: (h) => must(h, '  const clash = calDetectApptConflict(s);\n  if (clash) { s.conflict = clash; s.error = \'\'; s.busy = false; setState({ apptSheet: s }); return; }\n  const wasEdit',
                          '  const clash = null;\n  if (clash) { s.conflict = clash; s.error = \'\'; s.busy = false; setState({ apptSheet: s }); return; }\n  const wasEdit')
  },
  {
    name: 'spreadsheet-called-a-backup',
    why: 'restores the old card copy that told her to keep the spreadsheet as her backup',
    expect: ['COPY-spreadsheet-not-a-backup'],
    apply: (h) => must(h, "        emptyBackup ? \"Once you start logging, you'll be able to save or print your records here.\"\n              : 'The backup file is the only one of these that can be put back.",
                          "        emptyBackup ? \"Once you start logging, you'll be able to save or print your records here.\"\n              : 'Keep the spreadsheet as your backup. The backup file is the only one of these that can be put back.")
  },
  {
    name: 'restore-button-gated-on-empty',
    why: 'disables the restore button when nothing is logged — dead on exactly the phone restore exists for',
    expect: ['RESTORE-enabled-when-empty'],
    apply: (h) => must(h, "    }, busy ? { disabled: 'disabled' } : {}),\n      appIcon('bkRestore', 17),",
                          "    }, (busy || !bkHasAnything()) ? { disabled: 'disabled' } : {}),\n      appIcon('bkRestore', 17),")
  },
  {
    name: 'h-null-attribute-trap',
    why: 'passes the restore button\'s disabled attribute as a ternary ending in null — h() renders disabled="null" and the button is dead',
    expect: ['TRAP-no-null-attributes', 'FILE-no-null-attr-literals', 'UI-restore-button-live'],
    apply: (h) => must(h, "    }, busy ? { disabled: 'disabled' } : {}),\n      appIcon('bkRestore', 17),",
                          "    }, { disabled: busy ? 'disabled' : null }),\n      appIcon('bkRestore', 17),")
  },
  {
    name: 'backup-button-gated-on-nLogged',
    why: 'gates the backup button on allExportEntries() again, so a phone holding only appointments cannot save one',
    expect: ['BACKUP-enabled-with-only-appointments'],
    apply: (h) => must(h, '  const emptyBackup = empty && !bkHasAnything();', '  const emptyBackup = empty;')
  },
  {
    name: 'card-copy-omits-appointments',
    why: 'restores the card description from before appointments were in any file',
    expect: ['COPY-spreadsheet-not-a-backup'],
    apply: (h) => must(h, '"Everything you\'ve logged — doses, temperatures, weights, symptoms, treatment dates and appointments. The files save to this phone. Nothing is sent anywhere."',
                          '"Everything you\'ve logged — doses, temperatures, weights, symptoms and treatment dates. The file saves to this phone. Nothing is sent anywhere."')
  },
  {
    name: 'app-version-bumped',
    why: 'touches APP_VERSION, which this patch must never do',
    expect: ['FILE-app-version'],
    apply: (h) => {
      const m = h.match(/const APP_VERSION = '([^']*)';/);
      if (!m) throw new Error('mutator: APP_VERSION declaration not found');
      return must(h, m[0], "const APP_VERSION = 'MUTATED';");
    }
  },
  {
    name: 'file-input-inside-root',
    why: 'moves the file input inside #root, where the once-a-second repaint destroys it while the OS picker is open',
    expect: ['FILE-input-outside-root', 'UI-file-input-survives-repaint'],
    apply: (h) => must(h, '  document.body.appendChild(el);\n  bkFileInput = el;',
                          '  (document.getElementById(\'root\') || document.body).appendChild(el);\n  bkFileInput = el;')
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
function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

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

function makeNetLog() { return { stubHits: new Set(), blocked: [], swRequested: false }; }

async function newPage(browser, url, net, opts) {
  const options = opts || {};
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });

  await context.addInitScript(({ fixture, fixedNow, medConfig, medKey }) => {
    // sw.js is cache-first and would serve a stale build across runs. Deleting the property makes
    // `'serviceWorker' in navigator` false, so the app's own guard skips registration.
    try { delete Navigator.prototype.serviceWorker; } catch (e) {}
    // The printable report opens a popup and calls print(), which never returns headless. The
    // downloaded file is still produced, and that is the branch under test.
    window.open = () => null;
    globalThis.__EXP_FIXTURE__ = fixture;
    // Pinned so the two backup files of the round trip carry the same createdAt.
    const realNow = Date.now;
    Date.now = () => fixedNow;
    globalThis.__realNow = realNow;
    try {
      localStorage.clear();
      if (medConfig) localStorage.setItem(medKey, JSON.stringify(medConfig));
    } catch (e) {}
  }, {
    fixture: options.fixture || buildFixture(),
    fixedNow: FIXED_NOW,
    medConfig: options.medConfig === undefined ? buildMedConfig() : options.medConfig,
    medKey: MED_CONFIG_KEY
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

  // ONE catch-all route with explicit dispatch, so there is no doubt about handler ordering.
  await context.route('**/*', async (route) => {
    const u = route.request().url();
    if (GSTATIC[u]) {
      net.stubHits.add(u);
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GSTATIC[u] });
    }
    if (/\/sw\.js(\?|$)/.test(u) || /firebase-messaging-sw\.js/.test(u)) { net.swRequested = true; return route.abort(); }
    if (u.startsWith('http://127.0.0.1:')) return route.continue();
    net.blocked.push(u);
    return route.abort();
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting...'), null, { timeout: 20000 });
  return { context, page, consoleErrors, pageErrors };
}

// Everything below drives the app through its real controls. The app is one <script type="module">,
// so NONE of its functions or its `state` are reachable from page.evaluate() — module scope is not
// the global object. Only globalThis.__bk (which the Firestore stub installs deliberately) is.
// That constraint is a feature here: it means these checks cannot pass by poking at internals a
// user has no access to.
async function openReports(page) {
  await page.click('nav button[aria-label="Reports"]');
  await page.waitForSelector('[data-backup-restore-row]', { timeout: 10000 });
}

async function openCalendar(page) {
  await page.click('[data-cal-menu-button]');
  await page.waitForSelector('[data-cal-drawer]', { timeout: 10000 });
  await page.click('[data-cal-drawer-item="calendar"]');
  await page.waitForSelector('[data-cal-month-grid]', { timeout: 10000 });
}

async function grabDownload(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()]);
  const p = await dl.path();
  return { buf: fs.readFileSync(p), name: dl.suggestedFilename() };
}

async function importFile(page, filePath) {
  // Through the REAL control: tap the button, the button opens the picker, the picker returns a
  // file. Nothing here reaches into the app's state or calls its functions directly.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('[data-backup-restore]')
  ]);
  await chooser.setFiles(filePath);
  await page.waitForSelector('[data-backup-notice]', { timeout: 30000 });
  return await page.textContent('[data-backup-notice]');
}

// =================================================================================================
// Static checks (source level)
// =================================================================================================

async function runFileChecks(suite, html) {
  const bStart = html.indexOf('const BK_FORMAT =');
  const bEnd = html.indexOf('function renderHistory(now) {');
  const block = (bStart >= 0 && bEnd > bStart) ? html.slice(bStart, bEnd) : '';

  await suite.run('FILE-app-version', 'APP_VERSION is declared exactly once and matches the build', () => {
    // Version-agnostic. This was pinned to the literal 'v43.4' and went red the moment the
    // version was legitimately bumped at ship time. What matters is that the declaration exists
    // and is unique -- the patch not touching it is enforced by the patch's own post-condition.
    const all = html.match(/const APP_VERSION = '[^']*';/g) || [];
    assert(all.length === 1, 'expected exactly one APP_VERSION declaration, found ' + all.length);
    assert(html.split('const APP_VERSION').length === 2, 'APP_VERSION declared more than once');
  });

  await suite.run('FILE-allExportEntries', 'allExportEntries() still returns only entries + chemoDates', () => {
    assert(html.includes('return (state.entries || []).concat(state.chemoDates || []);'),
      'allExportEntries() body changed — appointments and reasons could reach the CSV and the report');
    assert(html.split('function allExportEntries()').length === 2, 'allExportEntries() declared more than once');
  });

  await suite.run('FILE-block-present', 'the backup block landed and is substantial', () => {
    assert(bStart > 0, 'backup block not found');
    assert(bEnd > bStart, 'backup block is not above renderHistory');
    assert(block.length > 8000, 'backup block is suspiciously small: ' + block.length + ' chars');
  });

  await suite.run('FILE-proto-safe-map', 'the restore membership map is Object.create(null), never {}', () => {
    assert(block.includes('const here = Object.create(null);'), 'the `here` map is not Object.create(null)');
    assert(!/const here\s*=\s*\{\s*\}/.test(block), 'a plain-object membership map is present');
  });

  await suite.run('FILE-append-only', 'the backup block never deletes and never updates', () => {
    const code = block.replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['deleteDoc', 'removeEntryDB', 'updateDoc', 'clearAllDB']) {
      assert(!code.includes(bad), 'the backup block references ' + bad + ' — restore must never remove anything');
    }
    assert(code.split('setDoc(').length - 1 === 2, 'expected exactly two setDoc calls (records, prefs)');
  });

  await suite.run('FILE-no-null-attr-literals', 'no conditional attribute is passed as null (the h() trap)', () => {
    // Whole-line // comments are stripped first: the trap is worth documenting in prose right
    // beside the code that avoids it, and a checker that cannot tell prose from code punishes
    // exactly the comment you want written.
    const code = html.replace(/^[ \t]*\/\/.*$/gm, '');
    for (const bad of ['disabled: null', 'checked: null', 'selected: null', 'readonly: null', 'hidden: null']) {
      assert(!code.includes(bad), 'found the h() null-attribute trap: ' + bad);
    }
    const re = /\b'?(disabled|checked|selected|readonly|hidden|inert|aria-pressed|aria-current)'?\s*:\s*[^,}\n]*\b(null|undefined)\b/g;
    const hits = (code.match(re) || []).filter(s => !/:\s*(null|undefined)\s*(===|!==|==|!=)/.test(s));
    assert(hits.length === 0, 'a conditional attribute can evaluate to null/undefined and h() will setAttribute it: ' + hits.join(' | '));
  });

  await suite.run('FILE-no-setState-in-onInput', 'no onInput handler calls setState', () => {
    for (const hnd of html.match(/onInput:\s*\([^)]*\)\s*=>\s*\{[^}]*\}/g) || []) {
      assert(!hnd.includes('setState'), 'onInput calls setState (destroys the field being typed into): ' + hnd.slice(0, 90));
    }
  });

  await suite.run('FILE-input-outside-root', 'the file input is appended to document.body, never inside #root', () => {
    assert(block.includes('document.body.appendChild(el);'), 'the file input is not appended to document.body');
    assert(!/getElementById\('root'\)[^\n]*appendChild\(el\)/.test(block), 'the file input is mounted inside #root, which render() wipes every tick');
  });

  await suite.run('FILE-no-chemowell-keys', 'care-tracker never references ChemoWell storage keys', () => {
    for (const bad of ['chemowell', 'ChemoWell', 'CHEMOWELL']) {
      assert(!block.includes(bad), 'the backup block references ' + bad);
    }
  });
}

// =================================================================================================
// Live checks
// =================================================================================================

async function runLiveChecks(suite, browser, url, net) {
  // -------------------------------------------------------------------------------------------
  // Session A — the round trip, the non-leak proof, idempotence, backward compatibility
  // -------------------------------------------------------------------------------------------
  const A = await newPage(browser, url, net);
  const page = A.page;
  await openReports(page);

  // 1. The three files, downloaded, in one session, from one fixture.
  const backup1 = await grabDownload(page, () => page.click('[data-backup-btn="backup"]'));
  const csv = await grabDownload(page, () => page.click('[data-backup-btn="csv"]'));
  const report = await grabDownload(page, () => page.click('[data-backup-btn="report"]'));

  const backupText = backup1.buf.toString('utf-8');
  const csvText = csv.buf.toString('utf-8');
  const reportText = report.buf.toString('utf-8');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'backup-1.json'), backup1.buf);
  fs.writeFileSync(path.join(TMP, 'records.csv'), csv.buf);
  fs.writeFileSync(path.join(TMP, 'report.html'), report.buf);

  await suite.run('FILES-downloaded', 'all three files actually downloaded with sane names', () => {
    assert(/-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backup1.name), 'backup filename looks wrong: ' + backup1.name);
    assert(/-records-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), 'csv filename looks wrong: ' + csv.name);
    assert(/-report-\d{4}-\d{2}-\d{2}\.html$/.test(report.name), 'report filename looks wrong: ' + report.name);
    assert(backup1.buf.length > 1000, 'backup file is tiny: ' + backup1.buf.length + ' bytes');
    assert(csv.buf.length > 200, 'csv file is tiny');
    assert(report.buf.length > 1000, 'report file is tiny');
  });

  let parsed = null;
  await suite.run('BACKUP-format', 'the backup file is valid JSON with the declared shape', () => {
    parsed = JSON.parse(backupText);
    assert(parsed.format === 'care-tracker-backup', 'wrong format marker: ' + parsed.format);
    assert(parsed.formatVersion === 1, 'wrong formatVersion');
    // The backup must RECORD whatever version produced it, not a hardcoded one.
    const built = (fs.readFileSync(APP_FILE, 'utf-8').match(/const APP_VERSION = '([^']*)';/) || [])[1];
    assert(parsed.app === built,
      'backup recorded app version ' + parsed.app + ' but the build is ' + built);
    assert(Array.isArray(parsed.entries), 'entries is not an array');
    assert(Array.isArray(parsed.appointments), 'appointments is not an array');
    assert(parsed.medications && Array.isArray(parsed.medications.meds), 'medications.meds missing');
    // Canonical key order, asserted on the actual serialisation.
    const keys = Object.keys(parsed);
    assert(JSON.stringify(keys) === JSON.stringify(keys.slice().sort()), 'top-level keys are not sorted: ' + keys.join(','));
  });

  await suite.run('BACKUP-has-appointments', 'every appointment document is in the backup, history included', () => {
    const ids = parsed.appointments.map(a => a.id).sort();
    for (const want of [SENT.APPT_DOC_1, SENT.APPT_DOC_2, SENT.APPT_DOC_3, SENT.APPT_DOC_PROTO]) {
      assert(ids.includes(want), 'appointment document missing from backup: ' + want + ' (have ' + ids.join(',') + ')');
    }
    // The superseded version and the tombstone are documents too. calResolveAppointments() hides
    // both from the screen; a backup that only held what is on screen could not reconstruct the
    // append-only history it depends on.
    const superseded = parsed.appointments.find(a => a.id === SENT.APPT_DOC_1);
    assert(superseded && superseded.title === SENT.APPT_TITLE_OLD, 'the superseded appointment version was dropped');
    const tomb = parsed.appointments.find(a => a.id === SENT.APPT_DOC_3);
    assert(tomb && tomb.cancelled === true, 'the appointment tombstone was dropped');
    assert(parsed.entries.every(e => e.medId !== 'appointment'), 'appointments also leaked into the entries section');
  });

  await suite.run('BACKUP-has-reasons', 'missed_reason documents are in the backup', () => {
    const ids = parsed.entries.filter(e => e.medId === 'missed_reason').map(e => e.id).sort();
    assert(ids.includes(SENT.REASON_DOC_1), 'missed_reason document missing: ' + SENT.REASON_DOC_1);
    assert(ids.includes(SENT.REASON_DOC_PROTO), 'missed_reason document missing: ' + SENT.REASON_DOC_PROTO);
  });

  await suite.run('BACKUP-keeps-removed-med-history', 'a removed medication\'s past doses and its name are in the backup', () => {
    const doses = parsed.entries.filter(e => e.medId === SENT.REMOVED_MED_ID);
    assert(doses.length === 2, 'expected 2 doses of the removed medication, found ' + doses.length);
    assert(doses.every(d => d.dose === SENT.REMOVED_MED_DOSE), 'the removed medication\'s dose labels were lost');
    const arch = parsed.medications && parsed.medications.archivedMeds;
    assert(arch && arch[SENT.REMOVED_MED_ID] && arch[SENT.REMOVED_MED_ID].name === SENT.REMOVED_MED_NAME,
      'the removed medication\'s NAME is not in the backup — its restored history would print as a bare id');
  });

  // POSITIVE CONTROL for the two non-leak checks below. Without this, "the CSV does not contain X"
  // would pass just as happily if X had never reached the app at all.
  await suite.run('BACKUP-has-sentinels', 'every leak sentinel IS present in the backup file (positive control)', () => {
    const wanted = [SENT.APPT_TITLE, SENT.APPT_NOTE, SENT.APPT_DOC_1, SENT.APPT_DOC_2, SENT.APPT_DOC_PROTO,
      SENT.REASON_NOTE, SENT.REASON_LABEL, SENT.REASON_DOC_1, SENT.REASON_DOC_PROTO,
      SENT.REMOVED_MED_DOSE, SENT.REMOVED_MED_NAME, '"appointment"', '"missed_reason"'];
    for (const w of wanted) assert(backupText.includes(w), 'sentinel missing from the BACKUP file: ' + w);
  });

  // The actual non-leak proof, on downloaded bytes. Asserting on appointment TITLES would be
  // worthless: neither file has a title column, so such a check stays green through a live leak.
  // What leaks is the medId, the dose label, the private note and the document id.
  const LEAK_APPT = [SENT.APPT_MEDID, 'Appointment', SENT.APPT_NOTE, SENT.APPT_TITLE,
    SENT.APPT_DOC_1, SENT.APPT_DOC_2, SENT.APPT_DOC_3, 'expfix-appt-c', 'expfix-appt-a'];
  // missed_reason is a slightly different case from appointments, and getting it wrong in either
  // direction is easy. reason-patch DELIBERATELY prints a summary of the patient's own words in a
  // labelled subsection under "Scheduled doses with nothing logged" — that is a designed clinical
  // feature, not a leak. What must never appear is the DOCUMENT: its medId, its dose label, its
  // document id, or the note showing up as an entry row in the daily log, the totals or the
  // symptom table. The narrowed check below is what distinguishes the two; asserting simply that
  // the report does not contain the note text would fail against the shipped design.
  const LEAK_REASON = [SENT.REASON_MEDID, SENT.REASON_DOSE, SENT.REASON_DOC_1];

  await suite.run('CSV-no-appointment-leak', 'the downloaded spreadsheet contains no appointment medId, dose label, note or doc id', () => {
    for (const s of LEAK_APPT) assert(!csvText.includes(s), 'APPOINTMENT LEAK into the spreadsheet: ' + JSON.stringify(s));
    assert(!csvText.includes(SENT.APPT_DOC_PROTO + ','), 'appointment doc id leaked as a CSV cell');
  });

  await suite.run('CSV-no-reason-leak', 'the downloaded spreadsheet contains no missed_reason document at all', () => {
    for (const s of LEAK_REASON.concat([SENT.REASON_NOTE, SENT.REASON_DOC_PROTO + ','])) {
      assert(!csvText.includes(s), 'MISSED_REASON LEAK into the spreadsheet: ' + JSON.stringify(s));
    }
  });

  await suite.run('REPORT-no-appointment-leak', 'the downloaded printable report contains no appointment data', () => {
    for (const s of LEAK_APPT) assert(!reportText.includes(s), 'APPOINTMENT LEAK into the clinical report: ' + JSON.stringify(s));
    assert(!/appointment/i.test(reportText), 'the word "appointment" appears in the report handed to a doctor');
  });

  await suite.run('REPORT-no-reason-leak', 'no missed_reason DOCUMENT reaches the report, and its text stays in its own subsection', () => {
    for (const s of LEAK_REASON) assert(!reportText.includes(s), 'MISSED_REASON LEAK into the clinical report: ' + JSON.stringify(s));
    // reason-patch prints the patient's own words in a labelled subsection beneath the calculated
    // missed-dose table, on purpose. Everything ABOVE that heading — the daily log, the totals,
    // the symptom table — is entries, and a reason document must never appear there.
    const marker = '<h2>Scheduled doses with nothing logged';
    const cut = reportText.indexOf(marker);
    assert(cut > 0, 'the missed-dose section is not in the report; this check would be vacuous');
    const entriesHalf = reportText.slice(0, cut);
    assert(!entriesHalf.includes(SENT.REASON_NOTE),
      'a missed_reason document reached the report as an ENTRY row (its note appears above the missed-dose heading)');
    assert(reportText.slice(cut).includes(SENT.REASON_NOTE),
      'the deliberate reason subsection is missing — this check would be passing for the wrong reason');
  });

  await suite.run('CSV-still-has-real-doses', 'the spreadsheet still contains the real dose rows (the non-leak checks are not vacuous)', () => {
    assert(csvText.includes('expfix-dose-1'), 'the spreadsheet lost a real dose document');
    assert(csvText.includes(SENT.REMOVED_MED_DOSE), 'the spreadsheet lost the removed medication\'s history');
    assert(csvText.includes(SENT.DOSE_DOC_PROTO_1), 'the spreadsheet lost the doc whose id is "constructor"');
  });

  // ---- the round trip, at byte level ---------------------------------------------------------
  const idsBefore = await page.evaluate(() => globalThis.__bk.ids().slice().sort());

  await suite.run('ROUNDTRIP-bytes', 'export -> empty the database -> import through the real file input -> export: md5 identical', async () => {
    await page.evaluate(() => {
      globalThis.__bk.wipe();
      try { localStorage.removeItem('caretracker-medication-config-v1'); } catch (e) {}
    });
    await page.waitForFunction(() => globalThis.__bk.count() === 0, null, { timeout: 10000 });
    await page.waitForTimeout(200);

    const msg = await importFile(page, path.join(TMP, 'backup-1.json'));
    assert(/Restored \d+ record/.test(msg), 'restore did not report records: ' + msg);
    assert(/Nothing was removed/.test(msg), 'the restore notice does not say nothing was removed: ' + msg);

    const backup2 = await grabDownload(page, () => page.click('[data-backup-btn="backup"]'));
    fs.writeFileSync(path.join(TMP, 'backup-2.json'), backup2.buf);
    const a = md5(backup1.buf), b = md5(backup2.buf);
    assert(a === b, 'ROUND TRIP LOST DATA — md5 differs.\n           before: ' + a + '\n           after : ' + b +
      '\n           sizes : ' + backup1.buf.length + ' vs ' + backup2.buf.length +
      '\n           files kept at ' + TMP);
  });

  await suite.run('RESTORE-keeps-ids', 'every document came back under its ORIGINAL Firestore id', async () => {
    const after = await page.evaluate(() => globalThis.__bk.ids().slice().sort());
    assert(JSON.stringify(after) === JSON.stringify(idsBefore),
      'document ids changed across the restore.\n           before: ' + idsBefore.join(',') + '\n           after : ' + after.join(','));
  });

  await suite.run('PROTO-ids-restore', 'documents whose id is an Object.prototype name are restored, not skipped', async () => {
    const after = await page.evaluate(() => globalThis.__bk.ids());
    for (const id of PROTO_IDS) {
      assert(after.includes(id), 'a document with id "' + id + '" was NOT restored — the membership map is a plain object');
    }
  });

  await suite.run('RESTORE-no-deletes', 'the restore issued zero deleteDoc calls', async () => {
    const n = await page.evaluate(() => globalThis.__bk.rec.deleteDoc.length);
    assert(n === 0, 'restore called deleteDoc ' + n + ' times');
  });

  await suite.run('RESTORE-uses-setDoc-not-addDoc', 'records were written with setDoc under a known id, not appended with addDoc', async () => {
    const r = await page.evaluate(() => ({ set: globalThis.__bk.rec.setDocIds.length, add: globalThis.__bk.rec.addDoc.length }));
    assert(r.set >= 14, 'expected at least 14 setDoc writes into caretracker_entries, saw ' + r.set);
    assert(r.add === 0, 'restore used addDoc ' + r.add + ' times — that mints new ids and duplicates on re-import');
  });

  await suite.run('RESTORE-idempotent', 'importing the same file a second time adds nothing', async () => {
    const before = await page.evaluate(() => globalThis.__bk.count());
    await page.evaluate(() => globalThis.__bk.reset());
    const msg = await importFile(page, path.join(TMP, 'backup-1.json'));
    const after = await page.evaluate(() => globalThis.__bk.count());
    const writes = await page.evaluate(() => globalThis.__bk.rec.setDocIds.length);
    assert(after === before, 'a second import changed the record count: ' + before + ' -> ' + after);
    assert(writes === 0, 'a second import wrote ' + writes + ' documents');
    assert(/already/i.test(msg), 'the notice does not say the records were already here: ' + msg);
  });

  await suite.run('RESTORE-never-overwrites', 'an id already on this phone is left exactly as it is', async () => {
    // Edit one live document in place behind the app's back, keeping its id, then import the same
    // file again. The FILE's version of that id carries the original dose; if restore overwrote
    // instead of skipping, the local edit would be gone.
    const SENTINEL_DOSE = 'LOCAL EDIT MUST SURVIVE A RESTORE';
    await page.evaluate(([id, val]) => globalThis.__bk.setField(id, 'dose', val), ['expfix-dose-1', SENTINEL_DOSE]);
    await page.evaluate(() => globalThis.__bk.reset());
    const countBefore = await page.evaluate(() => globalThis.__bk.count());
    await importFile(page, path.join(TMP, 'backup-1.json'));
    const after = await page.evaluate((id) => {
      const d = globalThis.__bk.all().find(e => e.id === id);
      return { dose: d ? d.dose : null, count: globalThis.__bk.count(), writes: globalThis.__bk.rec.setDocIds.length };
    }, 'expfix-dose-1');
    assert(after.count === countBefore, 'the record count changed across a re-import: ' + countBefore + ' -> ' + after.count);
    assert(after.dose === SENTINEL_DOSE,
      'restore WROTE OVER a record that was already on this phone (dose is now ' + JSON.stringify(after.dose) + ')');
    assert(after.writes === 0, 'restore wrote ' + after.writes + ' documents that were already here');
    // Put it back so later checks see the fixture value.
    await page.evaluate(([id, val]) => globalThis.__bk.setField(id, 'dose', val), ['expfix-dose-1', '500 mg']);
  });

  await suite.run('BACKCOMPAT-old-file', 'a backup with NO appointments section imports cleanly', async () => {
    const p = path.join(TMP, 'legacy-backup.json');
    fs.writeFileSync(p, JSON.stringify(buildLegacyBackup(), null, 2));
    await page.evaluate(() => globalThis.__bk.reset());
    const msg = await importFile(page, p);
    const ids = await page.evaluate(() => globalThis.__bk.ids());
    assert(!/doesn't look like/i.test(msg), 'an old backup was rejected: ' + msg);
    assert(ids.includes('expfix-legacy-1') && ids.includes('expfix-legacy-2'),
      'the old backup\'s records were not restored: ' + msg);
    assert(/Restored 2 record/.test(msg), 'expected exactly 2 records restored, got: ' + msg);
  });

  await suite.run('REJECT-not-a-backup', 'the spreadsheet and a random file are refused in plain language', async () => {
    const p = path.join(TMP, 'records.csv');
    await page.evaluate(() => globalThis.__bk.reset());
    const before = await page.evaluate(() => globalThis.__bk.count());
    const msg = await importFile(page, p);
    const after = await page.evaluate(() => globalThis.__bk.count());
    assert(/doesn't look like a CareTracker backup/i.test(msg), 'unhelpful message for a non-backup file: ' + msg);
    assert(!/undefined|null|\[object|Error:/.test(msg), 'raw technical detail shown to the user: ' + msg);
    assert(after === before, 'a rejected file still changed the database');
  });

  await suite.run('REJECT-newer-format', 'a backup from a newer build is refused rather than half-imported', async () => {
    const p = path.join(TMP, 'future-backup.json');
    const f = buildLegacyBackup();
    f.formatVersion = 99;
    f.entries = [{ id: 'expfix-future-1', medId: 'tylenol', dose: '500 mg', mg: 500, ts: FIXED_NOW - DAY }];
    fs.writeFileSync(p, JSON.stringify(f, null, 2));
    const before = await page.evaluate(() => globalThis.__bk.count());
    const msg = await importFile(page, p);
    const after = await page.evaluate(() => globalThis.__bk.count());
    assert(/newer version/i.test(msg), 'wrong message for a newer-format file: ' + msg);
    assert(after === before, 'a newer-format file was partially imported: ' + before + ' -> ' + after);
  });

  await suite.run('COPY-spreadsheet-not-a-backup', 'the card does not call the spreadsheet a backup', async () => {
    const text = await page.textContent('[data-backup-restore-row]');
    const card = await page.evaluate(() => {
      const el = document.querySelector('[data-backup-restore-row]');
      return el && el.parentElement ? el.parentElement.innerText : '';
    });
    assert(!/spreadsheet as your backup/i.test(card), 'the card still calls the spreadsheet a backup');
    assert(/only one of these that can be put back/i.test(card), 'the card does not say which file is restorable');
    assert(/neither one can be loaded back/i.test(card), 'the card does not say the other two cannot be restored');
    assert(/nothing is deleted/i.test(text), 'the restore row does not promise nothing is deleted');
    assert(/appointments/i.test(card), 'the card still lists what is saved without mentioning appointments');
    assert(!/The file saves to this phone/.test(card), 'the card still says "the file" when it offers three');
    // Two live appointments in the fixture: the superseded version and the tombstoned one are
    // correctly not counted on screen, even though all four documents are in the backup.
    assert(/2 appointments/.test(card), 'the counter line does not count the appointments the backup holds: ' + card.slice(0, 400));
  });

  await suite.run('UI-restore-button-live', 'the restore button is enabled and is a real 44px target', async () => {
    const r = await page.evaluate(() => {
      const b = document.querySelector('[data-backup-restore]');
      if (!b) return null;
      const rect = b.getBoundingClientRect();
      return { disabled: b.disabled, attr: b.getAttribute('disabled'), h: rect.height, w: rect.width };
    });
    assert(r, 'the restore button is not in the DOM');
    assert(!r.disabled, 'the restore button is disabled');
    assert(r.attr === null, 'the restore button carries disabled="' + r.attr + '" — the h() trap');
    assert(r.h >= 44, 'restore button is ' + r.h + 'px tall, floor is 44');
  });

  await suite.run('TRAP-no-null-attributes', 'no element anywhere rendered an attribute with the string "null"', async () => {
    const bad = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('*').forEach((el) => {
        for (const a of el.attributes) {
          if (a.value === 'null' || a.value === 'undefined') out.push(el.tagName + '[' + a.name + '="' + a.value + '"]');
        }
      });
      return out;
    });
    assert(bad.length === 0, 'the h() trap fired: ' + bad.join(', '));
  });

  await suite.run('FONT-16px-inputs', 'every input on screen is at least 16px (iOS zoom floor)', async () => {
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, textarea, select').forEach((el) => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) out.push((el.getAttribute('data-backup-file-input') ? 'file-input' : el.tagName) + '@' + fs);
      });
      return out;
    });
    assert(small.length === 0, 'inputs under 16px: ' + small.join(', '));
  });

  await suite.run('UI-file-input-survives-repaint', 'the file input survives full re-renders driven from the UI', async () => {
    // Tag the live node, then force real repaints by navigating away and back. render() does
    // root.innerHTML = '' every time; an input mounted inside #root would be a DIFFERENT element
    // afterwards, and the OS file picker's change event would fire on the detached original.
    const tagged = await page.evaluate(() => {
      const el = document.querySelector('[data-backup-file-input]');
      if (!el) return false;
      el.setAttribute('data-harness-identity', 'original');
      return true;
    });
    assert(tagged, 'the file input is not in the DOM (it is created on first use — was the button tapped?)');
    await page.click('nav button[aria-label="Home"]');
    await page.waitForTimeout(60);
    await page.click('nav button[aria-label="Reports"]');
    await page.waitForSelector('[data-backup-restore-row]', { timeout: 10000 });
    const state = await page.evaluate(() => {
      const el = document.querySelector('[data-backup-file-input]');
      if (!el) return 'input destroyed by render()';
      if (el.getAttribute('data-harness-identity') !== 'original') return 'input was replaced by render()';
      if (document.getElementById('root').contains(el)) return 'input lives inside #root, which render() wipes';
      return 'ok';
    });
    assert(state === 'ok', state);
  });

  await suite.run('NO-CONSOLE-ERRORS', 'no unexpected page errors during the whole session', () => {
    assert(A.pageErrors.length === 0, 'page errors: ' + A.pageErrors.join(' | '));
  });

  await A.context.close();

  // -------------------------------------------------------------------------------------------
  // Session B — a phone with ONLY appointments on it
  // -------------------------------------------------------------------------------------------
  const fxAppts = {
    entries: buildFixture().entries.filter(e => e.medId === 'appointment'),
    prefs: null
  };
  const B = await newPage(browser, url, net, { fixture: fxAppts, medConfig: null });
  await openReports(B.page);

  await suite.run('BACKUP-enabled-with-only-appointments', 'a phone holding only appointments can still save a backup', async () => {
    const r = await B.page.evaluate(() => {
      const b = document.querySelector('[data-backup-btn="backup"]');
      return b ? { disabled: b.disabled, attr: b.getAttribute('disabled') } : null;
    });
    assert(r, 'the backup button is not in the DOM');
    assert(!r.disabled, 'the backup button is disabled on a phone whose only content is appointments — exactly the data the spreadsheet cannot hold');
    const dl = await grabDownload(B.page, () => B.page.click('[data-backup-btn="backup"]'));
    const j = JSON.parse(dl.buf.toString('utf-8'));
    assert(j.appointments.length === 4, 'expected 4 appointment documents, got ' + j.appointments.length);
  });

  await B.context.close();

  // -------------------------------------------------------------------------------------------
  // Session C — an EMPTY phone: restore must work with nothing logged
  // -------------------------------------------------------------------------------------------
  const C = await newPage(browser, url, net, { fixture: { entries: [], prefs: null }, medConfig: null });
  await openReports(C.page);

  await suite.run('RESTORE-enabled-when-empty', 'the restore control works on a phone with nothing on it', async () => {
    const r = await C.page.evaluate(() => {
      const b = document.querySelector('[data-backup-restore]');
      return b ? { disabled: b.disabled, attr: b.getAttribute('disabled') } : null;
    });
    assert(r, 'the restore button is not in the DOM on an empty phone');
    assert(!r.disabled && r.attr === null, 'the restore button is disabled on an empty phone — the one phone it exists for');
    const msg = await importFile(C.page, path.join(TMP, 'backup-1.json'));
    const n = await C.page.evaluate(() => globalThis.__bk.count());
    assert(n >= 16, 'a full restore onto an empty phone produced only ' + n + ' records');
    assert(/Restored/.test(msg), 'restore onto an empty phone did not report success: ' + msg);
  });

  await suite.run('RESTORE-removed-med-name-comes-back', 'a removed medication\'s doses AND its name survive onto a fresh phone', async () => {
    const doses = await C.page.evaluate((med) => globalThis.__bk.all().filter(e => e.medId === med).length, SENT.REMOVED_MED_ID);
    assert(doses === 2, 'the removed medication\'s dose history did not restore: ' + doses + ' of 2');
    // Proven from the bytes of the printable record, not from an internal field: this is the
    // document that goes to an oncologist, and the failure mode being guarded against is it
    // reading "Medication (removed)" where a drug name belongs.
    const rep = await grabDownload(C.page, () => C.page.click('[data-backup-btn="report"]'));
    const text = rep.buf.toString('utf-8');
    fs.writeFileSync(path.join(TMP, 'report-after-restore.html'), rep.buf);
    assert(text.includes(SENT.REMOVED_MED_NAME),
      'the removed medication\'s NAME did not restore — the record handed to a doctor names it "' +
      (/Medication \(removed\)/.test(text) ? 'Medication (removed)' : '(unknown)') + '"');
    assert(text.includes(SENT.REMOVED_MED_DOSE), 'the removed medication\'s dose detail is missing from the report');
    assert(!text.includes(SENT.REMOVED_MED_ID + '<'), 'the removed medication printed as a bare id');
  });

  await C.context.close();

  // -------------------------------------------------------------------------------------------
  // Session D — concurrent edit
  // -------------------------------------------------------------------------------------------
  const D = await newPage(browser, url, net);
  const d = D.page;

  await openCalendar(d);

  // Through the real controls: the calendar's day panel, the row's own edit button.
  async function openApptSheet() {
    if (await d.$('[data-cal-sheet]')) {
      await d.click('[data-cal-sheet-cancel]');
      await d.waitForSelector('[data-cal-sheet]', { state: 'detached', timeout: 5000 });
    }
    if (!(await d.$('[data-cal-month-grid]'))) await openCalendar(d);
    await d.waitForSelector('[data-cal-appt-edit="expfix-appt-a"]', { timeout: 10000 });
    await d.click('[data-cal-appt-edit="expfix-appt-a"]');
    await d.waitForSelector('[data-cal-sheet]', { timeout: 10000 });
  }

  await suite.run('CONFLICT-save-stops', 'a save posted from a stale sheet is stopped and explained', async () => {
    await openApptSheet();
    await d.evaluate(() => globalThis.__bk.reset());
    // The OTHER phone reschedules the same appointment while this sheet is open.
    await d.evaluate((now) => globalThis.__bk.push({
      medId: 'appointment', apptId: 'expfix-appt-a', title: 'Oncology review MOVED BY AARON',
      note: 'moved to the afternoon', ts: now + 3600000, cancelled: false, dose: 'Appointment', mg: 0, loggedAt: now + 1
    }), FIXED_NOW);
    await d.waitForTimeout(150);
    await d.click('[data-cal-sheet-save]');
    await d.waitForSelector('[data-appt-conflict]', { timeout: 10000 });
    const text = await d.textContent('[data-appt-conflict]');
    assert(/changed while you had it open/i.test(text), 'the notice does not say what happened: ' + text);
    assert(/MOVED BY AARON/.test(text), 'the notice does not show what the other phone now says: ' + text);
    assert(/Nothing has been saved yet/i.test(text), 'the notice does not say nothing was saved: ' + text);
    assert(!/conflict|stale|revision|merge|version mismatch/i.test(text), 'jargon in a notice for a non-technical user: ' + text);
    assert(await d.isVisible('[data-appt-conflict-keep]'), 'no "keep mine" choice');
    assert(await d.isVisible('[data-appt-conflict-theirs]'), 'no "use theirs" choice');
  });

  await suite.run('CONFLICT-no-write', 'nothing at all was written while the notice was showing', async () => {
    const n = await d.evaluate(() => globalThis.__bk.rec.addDoc.length + globalThis.__bk.rec.setDoc.length);
    assert(n === 0, 'the stale save still wrote ' + n + ' documents');
  });

  await suite.run('CONFLICT-use-theirs', '"use the newer one" loads the other phone\'s version into the sheet', async () => {
    await d.click('[data-appt-conflict-theirs]');
    await d.waitForTimeout(150);
    const v = await d.evaluate(() => {
      const el = document.querySelector('[data-cal-sheet-title-input]');
      return { title: el ? el.value : null, conflict: !!document.querySelector('[data-appt-conflict]') };
    });
    assert(v.title === 'Oncology review MOVED BY AARON', 'the sheet did not adopt the newer version: ' + v.title);
    assert(!v.conflict, 'the notice is still showing after choosing');
    const n = await d.evaluate(() => globalThis.__bk.rec.addDoc.length + globalThis.__bk.rec.setDoc.length);
    assert(n === 0, 'choosing "use the newer one" wrote ' + n + ' documents; it must write nothing');
  });

  await suite.run('CONFLICT-keep-mine-writes', '"keep mine" is the only route to overwriting, and it does write', async () => {
    await openApptSheet();
    await d.evaluate(() => globalThis.__bk.reset());
    await d.evaluate((now) => globalThis.__bk.push({
      medId: 'appointment', apptId: 'expfix-appt-a', title: 'Second change from the other phone',
      note: '', ts: now + 7200000, cancelled: false, dose: 'Appointment', mg: 0, loggedAt: now + 2
    }), FIXED_NOW);
    await d.waitForTimeout(150);
    await d.click('[data-cal-sheet-save]');
    await d.waitForSelector('[data-appt-conflict]', { timeout: 10000 });
    await d.click('[data-appt-conflict-keep]');
    await d.waitForTimeout(400);
    const adds = await d.evaluate(() => globalThis.__bk.rec.addDoc.length);
    assert(adds === 1, 'expected exactly one append after "keep mine", saw ' + adds);
    const wrote = await d.evaluate(() => globalThis.__bk.rec.addDoc[0].data);
    assert(wrote.apptId === 'expfix-appt-a', 'the append lost the appointment identity');
    assert(wrote.cancelled === false, 'the append was written as a tombstone');
  });

  await suite.run('CONFLICT-removal-stops-too', 'removing a stale appointment is stopped as well', async () => {
    await openApptSheet();
    await d.evaluate(() => globalThis.__bk.reset());
    await d.evaluate((now) => globalThis.__bk.push({
      medId: 'appointment', apptId: 'expfix-appt-a', title: 'Third change from the other phone',
      note: '', ts: now + 10800000, cancelled: false, dose: 'Appointment', mg: 0, loggedAt: now + 3
    }), FIXED_NOW);
    await d.waitForTimeout(150);
    await d.click('[data-cal-sheet-remove]');
    await d.waitForSelector('[data-cal-sheet-remove-confirm]', { timeout: 5000 });
    await d.click('[data-cal-sheet-remove-confirm]');
    await d.waitForSelector('[data-appt-conflict]', { timeout: 10000 });
    const n = await d.evaluate(() => globalThis.__bk.rec.addDoc.length);
    assert(n === 0, 'a stale removal still wrote ' + n + ' documents — it would have erased the other phone\'s reschedule');
  });

  await suite.run('CONFLICT-clean-save-unaffected', 'a save with no concurrent edit still works normally', async () => {
    await openApptSheet();
    await d.evaluate(() => globalThis.__bk.reset());
    await d.click('[data-cal-sheet-save]');
    await d.waitForTimeout(400);
    const n = await d.evaluate(() => globalThis.__bk.rec.addDoc.length);
    const stillOpen = await d.evaluate(() => !!document.querySelector('[data-cal-sheet]'));
    assert(n === 1, 'an uncontested save wrote ' + n + ' documents, expected 1');
    assert(!stillOpen, 'the sheet stayed open after an uncontested save');
  });

  await suite.run('CONFLICT-tap-targets', 'both conflict choices are at least 44px tall', async () => {
    await openApptSheet();
    await d.evaluate((now) => globalThis.__bk.push({
      medId: 'appointment', apptId: 'expfix-appt-a', title: 'Fourth change', note: '',
      ts: now + 14400000, cancelled: false, dose: 'Appointment', mg: 0, loggedAt: now + 9
    }), FIXED_NOW);
    await d.waitForTimeout(150);
    await d.click('[data-cal-sheet-save]');
    await d.waitForSelector('[data-appt-conflict]', { timeout: 10000 });
    const sizes = await d.evaluate(() => ['[data-appt-conflict-keep]', '[data-appt-conflict-theirs]'].map((s) => {
      const el = document.querySelector(s);
      return el ? el.getBoundingClientRect().height : 0;
    }));
    for (const hgt of sizes) assert(hgt >= 44, 'a conflict choice is ' + hgt + 'px tall, floor is 44');
  });

  await suite.run('NO-CONSOLE-ERRORS-D', 'no page errors during the concurrent-edit session', () => {
    assert(D.pageErrors.length === 0, 'page errors: ' + D.pageErrors.join(' | '));
  });

  await D.context.close();
}

// =================================================================================================
// Main
// =================================================================================================

async function verify(browser, html, label) {
  const net = makeNetLog();
  const server = await startServer(() => html);
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const suite = new Suite();
  try {
    await runFileChecks(suite, html);
    await runLiveChecks(suite, browser, url, net);
    await suite.run('NET-1-no-real-firebase', 'nothing outside 127.0.0.1 and the three stubs was reached', () => {
      assert(net.stubHits.size === 3, 'expected all three gstatic modules to be served from stubs, saw ' + net.stubHits.size);
      // Every non-loopback, non-stub request is aborted by the catch-all route, so nothing can
      // reach the real project regardless. This asserts the stronger thing: that the only requests
      // refused were the base build's Google Fonts <link>, and that nothing Firebase-shaped was
      // ever attempted. A new outbound request appearing here is a finding, not noise.
      const unexpected = net.blocked.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
      assert(unexpected.length === 0, 'the page tried to reach: ' + unexpected.slice(0, 5).join(', '));
      const firebaseish = net.blocked.filter(u => /firestore|firebase|fuelforge|identitytoolkit|firebaseio/i.test(u));
      assert(firebaseish.length === 0, 'A REQUEST TOWARDS REAL FIREBASE WAS ATTEMPTED: ' + firebaseish.join(', '));
    });
    await suite.run('NET-2-no-service-worker', 'the service worker was never requested', () => {
      assert(!net.swRequested, 'sw.js was requested — a stale cached build could have been served');
    });
  } finally {
    server.close();
  }
  return suite;
}

async function main() {
  if (!fs.existsSync(APP_FILE)) {
    console.error('No such file: ' + APP_FILE);
    process.exit(3);
  }
  fs.mkdirSync(TMP, { recursive: true });
  const html = fs.readFileSync(APP_FILE, 'utf-8');
  console.log('export-test.mjs');
  console.log('  file : ' + APP_FILE);
  console.log('  md5  : ' + md5(Buffer.from(html, 'utf-8')));
  console.log('  mode : ' + (MODE_FALSIFY ? 'FALSIFY' : 'VERIFY'));
  console.log('');

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  let exitCode = 0;
  try {
    if (!MODE_FALSIFY) {
      const suite = await verify(browser, html, 'patched');
      for (const r of suite.results) {
        console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.id + ' — ' + r.desc + (r.ok ? '' : '\n          ' + r.err));
      }
      const failed = suite.failed();
      console.log('\n  ' + (suite.results.length - failed.length) + '/' + suite.results.length + ' checks passed.');
      exitCode = failed.length ? 1 : 0;
    } else {
      // Prove each check can go RED. A check that cannot fail is decoration.
      const baseline = await verify(browser, html, 'baseline');
      const baseFailed = baseline.failed();
      if (baseFailed.length) {
        console.log('  BASELINE IS NOT GREEN — falsification is meaningless until it is:');
        for (const r of baseFailed) console.log('    ' + r.id + ': ' + r.err);
        process.exit(1);
      }
      console.log('  baseline: ' + baseline.results.length + '/' + baseline.results.length + ' green.\n');
      let bad = 0;
      for (const m of MUTATORS) {
        let mutated;
        try { mutated = m.apply(html); }
        catch (err) { console.log('  ERROR   ' + m.name + ' — ' + err.message); bad++; continue; }
        const suite = await verify(browser, mutated, m.name);
        const failedIds = suite.failed().map(r => r.id);
        const missed = m.expect.filter(id => !failedIds.includes(id));
        if (missed.length) {
          console.log('  NOT RED ' + m.name);
          console.log('          ' + m.why);
          console.log('          expected these to fail and they did not: ' + missed.join(', '));
          console.log('          actually failed: ' + (failedIds.join(', ') || '(nothing)'));
          bad++;
        } else {
          console.log('  RED     ' + m.name + ' -> ' + failedIds.join(', '));
        }
      }
      console.log('\n  ' + (MUTATORS.length - bad) + '/' + MUTATORS.length + ' mutators produced the expected RED.');
      exitCode = bad ? 1 : 0;
    }
  } finally {
    await browser.close();
  }
  process.exit(exitCode);
}

main();
