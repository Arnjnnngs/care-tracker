#!/usr/bin/env python3
"""
export-patch.py — a real backup file, a real restore, and a concurrent-edit notice.

WHAT THIS ADDS TO care-tracker
------------------------------
1. A JSON BACKUP FILE that can actually be put back.  Before this patch "Save a copy" produced two
   files and NEITHER of them could be restored: the CSV is a twelve-column display flattening that
   drops the document id and mixes in derived missed-dose rows that are not documents at all, and
   the printable report is HTML for a doctor.  Losing the phone lost everything.

2. APPOINTMENTS IN THE BACKUP.  They were the one thing a restore could never bring back, because
   subscribeEntries() splits them out of state.entries and calResolveAppointments() then collapses
   their append-only history down to the live version.  The backup reads the COLLECTION, so it
   captures every appointment document including the superseded ones.

3. RESTORE.  setDoc() under each document's ORIGINAL id — a create under append-only rules.
   Therefore: ids are preserved, importing the same file twice adds nothing, and nothing is ever
   deleted or overwritten.  An id already present on this phone is skipped.

4. A CONCURRENT-EDIT NOTICE.  Brandi and Aaron both use this app.  The appointment sheet does not
   repaint while it is open, and saving from it APPENDS a document with a newer loggedAt — which
   wins.  So an edit made on the other phone while the sheet was open was silently thrown away.
   The sheet now compares what it was opened from against what is live, stops, says so in plain
   language and makes the person choose.  It never resolves itself.

WHAT THIS DOES NOT DO
---------------------
  * DOES NOT TOUCH APP_VERSION.  Asserted before and after: the version string is read out of the
    file rather than hardcoded, so this check keeps working at v43.5 and beyond.  (calendar-patch
    and reason-patch hardcode 'v43.3' and both therefore refuse to run on v43.4 — see the report.)
  * DOES NOT OPEN sw.js.  Asserted: the path is never passed to open().
  * DOES NOT CHANGE allExportEntries().  That function is the single seam keeping appointments and
    missed_reason documents out of the CSV and out of the printable record handed to an
    oncologist, and calendar-patch and reason-patch both assert it is byte-identical.  The backup
    reads Firestore directly with getDocs() instead, so the seam is preserved BY CONSTRUCTION
    rather than by anybody remembering.
  * DOES NOT CHANGE deliverFile().  See the report: that shared path is a bare <a download> with
    no failure detection, and this patch raises the cost of its failing.  Flagged, not touched.

REQUIRES calendar-patch.py TO HAVE BEEN APPLIED FIRST.  The appointment work and the
concurrent-edit notice are both about appointments; without that patch there are none.  This
script refuses with a clear message rather than half-applying.

USAGE
  python3 export-patch.py --repo /path/to/care-tracker      # apply
  python3 export-patch.py --repo /path/to/care-tracker --check   # report, write nothing

Idempotent: re-running on an already-patched file reports "already applied" and writes nothing.
Anchored: every edit matches an exact, unique string.  Any mismatch aborts before anything is
written; the file is never left half-patched.
"""

import argparse
import hashlib
import os
import re
import sys

SENTINEL = "BK_FORMAT"  # presence => this patch is already applied

# Recorded for information only.  The anchors below are the contract, not the digest.
BASE_MD5_V43_4 = "520a150aa4ef7d6a0bda5b3843355e62"

# Everything this patch introduces.  Duplicate object keys are legal JS — last one silently wins,
# no error — and duplicate function declarations are legal too.  This project has already been
# bitten by that, so every new name is checked for absence before a single byte is written.
NEW_IDENTIFIERS = [
    "BK_FORMAT", "BK_FORMAT_VERSION", "BK_MAX_BYTES",
    "bkCanonical", "bkById", "bkValidDocId", "bkCollect", "bkBuildPayload", "bkReadText",
    "bkReadIncoming", "bkRestore", "bkRestoreMedications", "bkRestorePrefs",
    "bkFileInput", "bkEnsureFileInput", "bkPickFile", "bkImportFile", "bkHasAnything",
    "downloadBackupFile", "renderRestoreRow", "bkNoticeStyle",
    "calApptStampFor", "calDetectApptConflict", "calKeepMine", "calUseTheirs",
    "bkRestore:", "emptyBackup", "backupNotice",
]

NEW_HOOKS = [
    "data-backup-file-input", "data-backup-restore", "data-backup-notice",
    "data-backup-restore-row", "data-backup-btn",
    "data-appt-conflict", "data-appt-conflict-keep", "data-appt-conflict-theirs",
]

# Names this patch depends on calendar-patch having created.
REQUIRED_FROM_CALENDAR = [
    "CAL_APPT_MED_ID",
    "function calOpenApptSheet(",
    "async function calSaveAppt()",
    "async function calRemoveAppt(",
    "function renderApptSheet()",
    "function calIsValidTs(",
    "state.appointments",
]


def fail(msg):
    bar = "!" * 86
    print("\n" + bar)
    print("REFUSING TO PATCH: " + msg)
    print("Nothing was written. index.html is untouched.")
    print(bar)
    sys.exit(2)


# =================================================================================================
# EDIT 1 — icon table gains the restore glyph, inserted as the FIRST key
# =================================================================================================
# Inserted immediately after the opening brace rather than beside `download`, because whether that
# line ends in a comma depends on whether calendar-patch has already appended its own three keys.
# First position needs no comma bookkeeping and applies identically in either order.
A1 = """  const paths = {
"""

B1 = """  const paths = {
    // Deliberately the mirror of `download` (same tray, arrow reversed) rather than a new shape:
    // save-a-copy and put-a-copy-back are one pair and read as one pair. Distinct from `history`,
    // which is already the Daily-log report card.
    bkRestore: '<path d="M12 14V3"/><path d="m7.5 7 4.5-4.5 4.5 4.5"/><path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
"""


# =================================================================================================
# EDIT 2 — state gains the two backup fields
# =================================================================================================
A2 = "confirmClearChemo: false, exporting: false"
B2 = "confirmClearChemo: false, exporting: false, restoring: false, backupNotice: null"


# =================================================================================================
# EDIT 3 — the save-a-copy card: busy also means restoring
# =================================================================================================
A3 = """  const empty = nLogged === 0;
  const busy = !!state.exporting;"""

B3 = """  const empty = nLogged === 0;
  // The backup covers strictly more than the spreadsheet does. allExportEntries() is
  // entries + chemoDates BY DESIGN -- that is what keeps appointments and missed-dose reasons out
  // of the spreadsheet and out of the printable record -- so a phone whose only content is
  // appointments has nLogged === 0. Gating "Save backup file" on that number would have greyed it
  // out on exactly the data the spreadsheet cannot hold. Counted separately.
  const emptyBackup = empty && !bkHasAnything();
  const nAppts = (state.appointments || []).length;
  const busy = !!state.exporting || !!state.restoring;"""


# =================================================================================================
# EDIT 4 — btn() gains an explicit off-condition
# =================================================================================================
# THE h() TRAP lives in this function. `disabled` is applied by SPREADING an object that is either
# {disabled:'disabled'} or {} -- never as `disabled: cond ? 'disabled' : null`, which renders
# disabled="null" and disables the control unconditionally. Two export buttons already shipped dead
# that way. The spread below is the existing v43 form and is left exactly as it is.
A4 = """  const btn = (kind, label, onClick, primary) => {
    const running = state.exporting === kind;
    const off = busy || empty;
    return h('button', {
      onClick,"""

B4 = """  const btn = (kind, label, onClick, primary, offWhen) => {
    const running = state.exporting === kind;
    const off = busy || (offWhen === undefined ? empty : offWhen);
    return h('button', {
      onClick,
      // A stable hook per button. Matching these on their visible label instead is what let an
      // earlier round test a button that had been renamed, against a screen that no longer had it.
      'data-backup-btn': kind,"""


# =================================================================================================
# EDIT 5 — the buttons row, the footer copy, and the restore row
# =================================================================================================
A5 = """      h('div', { style: { display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '13px', justifyContent: 'flex-start', maxWidth: '470px' } },
        btn('csv', 'Save spreadsheet', downloadEntriesCSV, true),
        btn('report', 'Save printable report', openPrintReport, false)
      ),
      h('div', { style: { fontSize: '11.5px', color: '#6E5261', marginTop: '10px', lineHeight: '1.45', maxWidth: '52ch' } },
        empty ? "Once you start logging, you'll be able to save or print your records here."
              : 'Keep the spreadsheet as your backup. Print the report to take to an appointment.')
    )
  );
}"""

B5 = """      h('div', { style: { display: 'flex', gap: '9px', flexWrap: 'wrap', marginTop: '13px', justifyContent: 'flex-start', maxWidth: '470px' } },
        btn('backup', 'Save backup file', downloadBackupFile, true, emptyBackup),
        btn('csv', 'Save spreadsheet', downloadEntriesCSV, false),
        btn('report', 'Save printable report', openPrintReport, false)
      ),
      // The card used to say "Keep the spreadsheet as your backup." It is not one and never was:
      // a CSV cannot be loaded back into this app, it has no document ids, and it deliberately
      // omits appointments. Telling her the wrong file is her backup is worse than telling her
      // nothing, because it stops her looking for the right one.
      h('div', { style: { fontSize: '11.5px', color: '#6E5261', marginTop: '10px', lineHeight: '1.45', maxWidth: '52ch' } },
        emptyBackup ? "Once you start logging, you'll be able to save or print your records here."
              : 'The backup file is the only one of these that can be put back. It holds everything — doses, temperatures, weights, symptoms, treatment dates and appointments. The spreadsheet and the printable report are for reading and for handing to a doctor; neither one can be loaded back into the app.'),
      renderRestoreRow()
    )
  );
}

// Put-a-backup-back. Its own row under a rule, not a fourth button in the save row: saving is
// routine and restoring is not, and a restore control sitting in the same row as the one she taps
// every week is a control she will eventually tap by accident.
//
// NOT gated on `empty`. A brand-new phone has nothing logged on it, and a brand-new phone is the
// entire reason this exists.
function renderRestoreRow() {
  const busy = !!state.exporting || !!state.restoring;
  const notice = state.backupNotice;
  return h('div', { 'data-backup-restore-row': 'true', style: { marginTop: '14px', paddingTop: '13px', borderTop: '1px solid rgba(212,104,138,0.16)' } },
    h('div', { style: { fontSize: '13px', fontWeight: '800', color: '#342530', letterSpacing: '-0.01em' } }, 'Put a backup back'),
    h('div', { style: { fontSize: '11.5px', color: '#6E5261', lineHeight: '1.45', marginTop: '3px', maxWidth: '52ch' } },
      'On a new phone, or if something has gone missing, load a backup file here. Anything already on this phone stays exactly as it is — nothing is deleted and nothing is written over. Loading the same file twice is safe.'),
    h('button', Object.assign({
      'data-backup-restore': 'true', type: 'button', onClick: bkPickFile,
      style: { marginTop: '10px', minHeight: '46px', padding: '0 16px', borderRadius: '13px', border: '1px solid rgba(212,104,138,0.32)', background: 'rgba(255,255,255,0.72)', color: '#8E3D61', fontSize: '14px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: busy ? 'default' : 'pointer' }
    // Spread, never `disabled: busy ? 'disabled' : null`. h() does a bare setAttribute, so the
    // string "null" would disable this button permanently.
    }, busy ? { disabled: 'disabled' } : {}),
      appIcon('bkRestore', 17),
      state.restoring ? 'Reading the file…' : 'Restore from a backup file'),
    // A failure gets role="alert" because she has to know. A success does NOT get a live-region
    // role: the toast already announces the same event, and two polite live regions firing on one
    // tap makes a screen reader read the whole thing twice. This panel is the persistent record of
    // what happened, there to be re-read, not to interrupt.
    notice ? h('div', Object.assign({
      'data-backup-notice': 'true',
      'data-backup-notice-kind': notice.kind,
      style: bkNoticeStyle(notice.kind)
    }, notice.kind === 'bad' ? { role: 'alert' } : {}), notice.message) : null
  );
}

function bkNoticeStyle(kind) {
  const bad = kind === 'bad';
  return {
    marginTop: '11px', padding: '11px 13px', borderRadius: '12px', fontSize: '12.5px',
    lineHeight: '1.45', fontWeight: '600', maxWidth: '52ch',
    background: bad ? 'rgba(192,69,59,0.10)' : 'rgba(58,132,94,0.10)',
    border: '1px solid ' + (bad ? 'rgba(192,69,59,0.32)' : 'rgba(58,132,94,0.30)'),
    color: bad ? '#96382F' : '#1F5A3D'
  };
}"""


# =================================================================================================
# EDIT 6 — calOpenApptSheet records what version the sheet was opened from
# =================================================================================================
A6 = """    apptSheet: {
      apptId: existing ? existing.apptId : null,
      title: existing ? String(existing.title || '') : '',"""

B6 = """    apptSheet: {
      apptId: existing ? existing.apptId : null,
      // The version this sheet is a view OF. Compared against the live one at save time; see
      // calDetectApptConflict(). A brand-new appointment has nothing to clash with.
      baseStamp: existing ? calApptStampFor(existing.apptId) : '',
      conflict: null,
      overwriteOk: false,
      title: existing ? String(existing.title || '') : '',"""


# =================================================================================================
# EDIT 7 — calSaveAppt stops rather than silently winning
# =================================================================================================
A7 = """  const wasEdit = !!s.apptId;
  const apptId = s.apptId || calNewApptId();"""

B7 = """  // CONCURRENT EDIT. Two people use this app. This sheet deliberately does not repaint while it
  // is open (subscribeEntries defers the snapshot so a half-typed note is not wiped), so a save
  // posted from here is written against whatever the appointment looked like when the sheet was
  // opened -- and because an edit is an APPEND carrying a newer loggedAt, it WINS. Aaron
  // reschedules the oncology appointment from his phone while Brandi has that same appointment
  // open on hers; she taps Save; his new time is gone and nothing anywhere said so.
  //
  // state.appointments is refreshed inside subscribeEntries BEFORE the deferral, so the live
  // version is available here even though the screen has not repainted. A difference stops the
  // write and asks. It is never resolved automatically in either direction.
  const clash = calDetectApptConflict(s);
  if (clash) { s.conflict = clash; s.error = ''; s.busy = false; setState({ apptSheet: s }); return; }
  const wasEdit = !!s.apptId;
  const apptId = s.apptId || calNewApptId();"""


# =================================================================================================
# EDIT 8 — calRemoveAppt gets the same rule
# =================================================================================================
A8 = """  const sheet = state.apptSheet;
  if (sheet && sheet.busy) return;"""

B8 = """  const sheet = state.apptSheet;
  if (sheet && sheet.busy) return;
  // Removal is a tombstone against whatever the appointment has BECOME, so removing a stale one
  // destroys a reschedule made on the other phone exactly as silently as saving over it does.
  if (sheet && sheet.apptId === apptId) {
    const clash = calDetectApptConflict(sheet);
    if (clash) { sheet.conflict = clash; sheet.confirmRemove = false; sheet.error = ''; sheet.busy = false; setState({ apptSheet: sheet }); return; }
  }"""


# =================================================================================================
# EDIT 9 — the notice itself, above the error slot in the appointment sheet
# =================================================================================================
A9 = """      s.error ? h('div', { 'data-cal-sheet-error': 'true', role: 'alert',"""

B9 = """      s.conflict ? h('div', { 'data-appt-conflict': 'true', role: 'alert', style: { background: 'rgba(154,100,25,0.10)', border: '1px solid rgba(154,100,25,0.34)', borderRadius: '12px', padding: '12px 13px', marginBottom: '14px' } },
        h('div', { style: { fontSize: '13.5px', fontWeight: '800', color: '#6E4A0F', marginBottom: '5px' } }, 'This changed while you had it open'),
        h('div', { style: { fontSize: '12.5px', lineHeight: '1.5', color: '#6E4A0F', fontWeight: '600' } }, s.conflict.message),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '11px' } },
          h('button', Object.assign({ 'data-appt-conflict-theirs': 'true', type: 'button', onClick: calUseTheirs,
            style: { flex: '1', minHeight: '44px', borderRadius: '11px', border: '1px solid rgba(154,100,25,0.34)', background: 'rgba(255,255,255,0.7)', color: '#6E4A0F', fontSize: '13.5px', fontWeight: '800' } },
            s.busy ? { disabled: 'disabled' } : {}),
            s.conflict.kind === 'removed' ? 'Leave it removed' : 'Use the newer one'),
          h('button', Object.assign({ 'data-appt-conflict-keep': 'true', type: 'button', onClick: calKeepMine,
            style: { flex: '1', minHeight: '44px', borderRadius: '11px', border: 'none', background: '#9A6419', color: '#FFFFFF', fontSize: '13.5px', fontWeight: '800' } },
            s.busy ? { disabled: 'disabled' } : {}),
            'Keep mine')
        )
      ) : null,
      s.error ? h('div', { 'data-cal-sheet-error': 'true', role: 'alert',"""


# =================================================================================================
# EDIT 10 — the block itself, inserted below the export block
# =================================================================================================
A10 = """

function renderHistory(now) {"""

FEATURE_BLOCK = r"""

// =================================================================================================
// BACKUP & RESTORE
//
// WHY THIS EXISTS. "Save a copy" produced two files and NEITHER of them could be put back. The
// spreadsheet is a report ABOUT the data, not the data: twelve display columns, no way to tell a
// document from a derived missed-dose row, and appointments deliberately absent. The printable
// report is HTML for an oncologist. If this phone is lost, or the Firestore project is emptied,
// neither file restores a single record. This block is the file that does.
//
// WHAT IT READS, AND WHY IT DOES NOT GO THROUGH allExportEntries(). subscribeEntries() fans one
// snapshot out into state.entries, state.chemoDates, state.appointments and state.missReasons, and
// the last two are then COLLAPSED to their live versions with the superseded history thrown away.
// Every one of those splits is right for the screen and wrong for a backup. getDocs(col) reads the
// collection itself, so appointment edit history and missed-dose reason documents are all captured
// as written. It also has a second property that matters more than convenience: allExportEntries()
// is not touched. That one function is the seam that keeps appointments and reason documents out
// of the spreadsheet and out of the record handed to a doctor. A backup routed through it would
// have had to widen it, and the leak would have been one careless edit away forever after.
//
// WHAT IT WRITES ON RESTORE. setDoc(doc(db, COL_NAME, <the document's original id>), fields).
// That is a CREATE at a known id, which is an append under append-only rules -- no updateDoc, no
// deleteDoc, nothing removed. Consequences, all deliberate:
//   * document ids are preserved, so a record restored twice is the same record, not a duplicate;
//   * restore is IDEMPOTENT -- importing the same file a second time adds nothing;
//   * an id already present on this phone is SKIPPED, never written over. If both phones have the
//     record, the one already here wins, because it is the one Firestore has been serving.
// The only write that is not a create is the prefs high-water mark, and it only ever moves
// forward; see bkRestorePrefs().
// =================================================================================================

const BK_FORMAT = 'care-tracker-backup';
const BK_FORMAT_VERSION = 1;
// A guard on the file picker, not on the export. Whole-of-history for this patient is a few
// hundred kB; anything past 40 MB is somebody having selected a video, and JSON.parse on it would
// lock the phone up before it failed.
const BK_MAX_BYTES = 40 * 1024 * 1024;

// Canonical JSON: object keys sorted at every depth, document arrays sorted by document id. The
// same set of records therefore always serialises to the same BYTES, whatever order Firestore
// handed them back in and whatever order the fields happen to sit in on any given document. That
// is what makes "export, empty the database, import, export again, compare the md5" an actual
// test of the round trip instead of a field-by-field opinion about it.
function bkCanonical(v) {
  if (Array.isArray(v)) return v.map(bkCanonical);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = bkCanonical(v[k]); });
    return out;
  }
  // JSON has no NaN and no Infinity: JSON.stringify silently emits `null` for both. Doing it here
  // instead means the value that comes back out of a restored file is the same value that went in,
  // so a corrupt ts does not change shape between one export and the next.
  if (typeof v === 'number' && !isFinite(v)) return null;
  return v;
}

function bkById(a, b) {
  const x = String((a && a.id) || '');
  const y = String((b && b.id) || '');
  return x < y ? -1 : x > y ? 1 : 0;
}

// Firestore's own rules for a document id. An id that breaks one of these cannot be written, so it
// is counted and reported rather than thrown at setDoc to fail one at a time.
// `__.*__` is reserved by Firestore -- which is also why '__proto__' can never arrive here as an
// id, and why the membership map below is still Object.create(null): 'constructor', 'toString',
// 'valueOf' and 'hasOwnProperty' are all perfectly legal Firestore document ids.
function bkValidDocId(id) {
  if (typeof id !== 'string') return false;
  if (!id.length || id.length > 1500) return false;
  if (id.indexOf('/') >= 0) return false;
  if (id === '.' || id === '..') return false;
  if (/^__.*__$/.test(id)) return false;
  return true;
}

function bkHasAnything() {
  return (state.entries || []).length > 0 || (state.chemoDates || []).length > 0 || (state.appointments || []).length > 0;
}

// Read everything, as written. The document id is applied LAST so that identity always wins: a
// document carrying its own field called `id` would otherwise overwrite the thing needed to put it
// back. (No document this app writes has such a field; this is about a file that arrives later.)
async function bkCollect() {
  const snap = await getDocs(col);
  const docs = snap.docs.map((d) => Object.assign({}, d.data(), { id: d.id }));
  const appointments = docs.filter((d) => d.medId === CAL_APPT_MED_ID).sort(bkById);
  const entries = docs.filter((d) => d.medId !== CAL_APPT_MED_ID).sort(bkById);
  // Preferences are one small document in a different collection. A failure to read them must not
  // cost the entries their backup, so it is caught here and the section is simply absent.
  let prefs = null;
  try {
    const psnap = await getDocs(collection(db, PREFS_COL_NAME));
    psnap.docs.forEach((d) => { if (d.id === 'settings') prefs = d.data(); });
  } catch (err) {
    console.error('[backup:prefs]', err);
  }
  return { entries: entries, appointments: appointments, prefs: prefs };
}

// The medication list is device-local (localStorage), not a Firestore document, so it is read from
// state rather than from the collection. archivedMeds is the load-bearing half: every dose ever
// logged against a medication that has since been removed is still a real document in
// caretracker_entries and still restores, but WITHOUT the archived name those rows come back as a
// bare id and the printable record reads "Medication (removed)" where a drug name belongs.
function bkBuildPayload(bundle, atMs) {
  return bkCanonical({
    format: BK_FORMAT,
    formatVersion: BK_FORMAT_VERSION,
    app: APP_VERSION,
    patient: String(CONFIG.patientName || ''),
    createdAt: atMs,
    entries: bundle.entries,
    // Its own section, not folded in with the entries. Two reasons: it makes the presence of
    // appointments in the file auditable at a glance, and it lets a file written BEFORE
    // appointments existed be recognised as complete rather than as damaged -- a missing section
    // means none, see bkReadIncoming().
    appointments: bundle.appointments,
    prefs: bundle.prefs,
    medications: { version: 1, meds: state.meds || [], archivedMeds: state.archivedMeds || {} }
  });
}

async function downloadBackupFile() {
  if (state.exporting || state.restoring) return;
  setState({ exporting: 'backup', backupNotice: null });
  try {
    await yieldFrame();
    const bundle = await bkCollect();
    const n = bundle.entries.length + bundle.appointments.length;
    if (!n) {
      setToast('Nothing to back up yet.');
      return;
    }
    const text = JSON.stringify(bkBuildPayload(bundle, simNow()), null, 2);
    await deliverFile(new Blob([text], { type: 'application/json' }), exportFilename('backup', 'json'));
    const nAppt = bundle.appointments.length;
    setState({
      backupNotice: {
        kind: 'ok',
        message: 'Backup saved — ' + n + ' record' + (n === 1 ? '' : 's') +
          (nAppt ? ', including ' + nAppt + ' appointment record' + (nAppt === 1 ? '' : 's') : '') +
          '. Check it landed in your Files app, then load it back here once to be sure it opens.'
      }
    });
    setToast(n + ' record' + (n === 1 ? '' : 's') + ' saved to your backup file.');
  } catch (err) {
    // The raw message is a browser string ("The operation is insecure.") that reads like the app
    // broke in a way that might have damaged her records. It goes to the console.
    console.error('[backup:save]', err);
    setState({ backupNotice: { kind: 'bad', message: "Couldn't make the backup file. Nothing was changed — please try again." } });
    setToast("Couldn't save the backup file. Your records are safe.");
  } finally {
    setState({ exporting: false });
  }
}

// ------------------------------------------------------------------------------------------------
// Restore
// ------------------------------------------------------------------------------------------------

function bkReadText(file) {
  if (file && typeof file.text === 'function') return file.text();
  // Older iOS Safari has no Blob.text(). Without this the restore button did nothing at all there.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('could not read the file'));
    r.readAsText(file);
  });
}

// Validate and flatten. Throws a short machine token; bkImportFile turns it into a sentence.
function bkReadIncoming(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not-a-backup');
  if (parsed.format !== BK_FORMAT) throw new Error('not-a-backup');
  const fv = Number(parsed.formatVersion);
  if (!isFinite(fv) || fv < 1) throw new Error('not-a-backup');
  // A file from a NEWER build may carry sections this build does not understand. Importing the
  // parts it does recognise would look like a complete restore and quietly not be one.
  if (fv > BK_FORMAT_VERSION) throw new Error('newer-format');
  const records = [];
  const take = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((r) => {
      if (r && typeof r === 'object' && !Array.isArray(r)) records.push(r);
    });
  };
  take(parsed.entries);
  // BACKWARD COMPATIBILITY, and the whole reason appointments sit in their own section: a backup
  // written before this existed has no `appointments` key at all. Absent means none, not broken.
  // Array.isArray() above is what makes `undefined` a no-op instead of a throw.
  take(parsed.appointments);
  return {
    records: records,
    prefs: (parsed.prefs && typeof parsed.prefs === 'object' && !Array.isArray(parsed.prefs)) ? parsed.prefs : null,
    medications: (parsed.medications && typeof parsed.medications === 'object' && !Array.isArray(parsed.medications)) ? parsed.medications : null
  };
}

async function bkRestore(bundle) {
  const snap = await getDocs(col);
  // Object.create(null). NEVER {}. These keys are Firestore document ids, and a document id is
  // free to be the string "constructor", "toString", "valueOf" or "hasOwnProperty" -- all four are
  // legal ids. Against a plain object literal the membership test `here[id]` is TRUTHY on an
  // EMPTY map, because it finds Object.prototype.constructor. Those records would have been
  // counted as "already on this phone", skipped, and never written, while the screen reported a
  // clean successful restore. Silent medical-record loss with a green tick on it. This is the
  // same class of bug v43.4 fixed in nameOf()/reportNameOf(), and export-test.mjs pins it.
  const here = Object.create(null);
  snap.docs.forEach((d) => { here[d.id] = 1; });

  const res = { added: 0, already: 0, unusable: 0, failed: 0, appointments: 0 };
  for (const rec of bundle.records) {
    const id = rec.id;
    if (!bkValidDocId(id)) { res.unusable++; continue; }
    if (here[id]) { res.already++; continue; }
    const fields = {};
    Object.keys(rec).forEach((k) => { if (k !== 'id') fields[k] = rec[k]; });
    try {
      // A create at a known id. Never updateDoc, never deleteDoc: the rules forbid both, and a
      // restore that could delete is not a restore.
      await setDoc(doc(db, COL_NAME, id), fields);
      here[id] = 1;
      res.added++;
      if (fields.medId === CAL_APPT_MED_ID) res.appointments++;
    } catch (err) {
      // One document failing must not abandon the other four hundred.
      console.error('[restore:doc]', id, err);
      res.failed++;
    }
  }
  return res;
}

// The medication list is per-device and the person holding this phone is the one who set it up, so
// it is NOT overwritten by a file. Two cases:
//   * this phone has never saved a configuration -- a new phone, which is the case restore exists
//     for -- so the backup's list is adopted whole;
//   * this phone has its own list, which is left alone. The one thing merged in either way is the
//     set of ARCHIVED names, because those are what stop a removed medication's restored dose
//     history from printing as a bare id in a document handed to an oncologist.
function bkRestoreMedications(medBlock) {
  const out = { mode: 'none', archivedAdded: 0 };
  if (!medBlock || typeof medBlock !== 'object') return out;
  const incomingMeds = Array.isArray(medBlock.meds) ? medBlock.meds : null;
  const incomingArchived = normalizeArchivedMeds(medBlock.archivedMeds);
  let hasLocal = true;
  try {
    hasLocal = (typeof localStorage !== 'undefined') && !!localStorage.getItem(MED_CONFIG_STORAGE_KEY);
  } catch (err) {
    // Storage unreadable (private mode, quota): assume there IS a local list rather than
    // clobbering whatever is in memory.
    hasLocal = true;
  }
  if (!hasLocal && incomingMeds && incomingMeds.length) {
    const meds = mergeMissingDefaultMeds(incomingMeds.map(normalizeMedication).map(migrateSenokotV37), incomingArchived);
    persistMedicationConfig(meds, incomingArchived);
    setState({ meds: meds, archivedMeds: incomingArchived });
    out.mode = 'restored';
    return out;
  }
  const archived = Object.assign({}, state.archivedMeds || {});
  const known = new Set((state.meds || []).map((m) => m.id));
  Object.keys(incomingArchived).forEach((id) => {
    if (known.has(id)) return;
    // hasOwnProperty, not a bare index -- `archived['constructor']` is truthy on an empty map and
    // would drop the archived name of a medication with an unlucky id. Same trap as `here` above.
    if (Object.prototype.hasOwnProperty.call(archived, id)) return;
    archived[id] = incomingArchived[id];
    out.archivedAdded++;
  });
  if (out.archivedAdded) {
    persistMedicationConfig(state.meds, archived);
    setState({ archivedMeds: archived });
    out.mode = 'merged';
  }
  return out;
}

// missedClearedAt is a HIGH-WATER MARK: the moment the missed-dose banner was last dismissed.
// Restoring an older value would resurface months of already-dismissed warnings on a phone that
// had moved past them, so it only ever moves forward. This is the one write in this block that is
// not a create, and it is the same setDoc(..., {merge:true}) the app already uses on this document.
async function bkRestorePrefs(prefs) {
  if (!prefs || typeof prefs !== 'object') return false;
  const incoming = Number(prefs.missedClearedAt);
  const current = Number(state.missedClearedAt) || 0;
  if (!isFinite(incoming) || incoming <= current) return false;
  await setDoc(PREFS_DOC, { missedClearedAt: incoming }, { merge: true });
  return true;
}

// The file input is created ONCE and appended to document.body -- NOT returned from render().
// render() does root.innerHTML = '' on every repaint and the clock tick repaints once a second, so
// an <input type="file"> living inside #root is destroyed while the operating system's file picker
// is still open. Its change event then fires on a node that is no longer in the document, the
// chosen file is dropped, and nothing anywhere reports a failure. Outside #root it survives every
// repaint, and no repaint guard has to be added to the tick to protect it.
let bkFileInput = null;

function bkEnsureFileInput() {
  if (bkFileInput && bkFileInput.isConnected) return bkFileInput;
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = '.json,application/json';
  el.setAttribute('data-backup-file-input', 'true');
  // Off-screen rather than display:none: iOS Safari will not open a picker for a control it
  // considers unrendered.
  el.style.position = 'fixed';
  el.style.left = '-10000px';
  el.style.top = '0';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.opacity = '0';
  // 16px even though it is off-screen and never typed into: iOS Safari zooms the page in when a
  // focused field is under 16px and does not zoom back out, and a file input DOES take focus when
  // its picker opens. The one under-16px control on the page is not worth the risk of leaving the
  // app stuck at 1.3x with the nav off-screen.
  el.style.fontSize = '16px';
  el.addEventListener('change', () => {
    const f = el.files && el.files[0];
    // Cleared so that choosing the SAME file again still fires a change event. The File reference
    // is already held, so clearing here does not lose it.
    el.value = '';
    if (f) bkImportFile(f);
  });
  document.body.appendChild(el);
  bkFileInput = el;
  return el;
}

function bkPickFile() {
  if (state.restoring || state.exporting) return;
  try {
    bkEnsureFileInput().click();
  } catch (err) {
    console.error('[restore:pick]', err);
    setState({ backupNotice: { kind: 'bad', message: "This phone wouldn't open the file picker. Nothing was changed." } });
  }
}

async function bkImportFile(file) {
  if (state.restoring || state.exporting) return;
  setState({ restoring: true, backupNotice: null });
  try {
    if (file && typeof file.size === 'number' && file.size > BK_MAX_BYTES) {
      setState({ backupNotice: { kind: 'bad', message: "That file is far too big to be a CareTracker backup. Nothing was changed." } });
      return;
    }
    let text = '';
    try {
      text = await bkReadText(file);
    } catch (err) {
      console.error('[restore:read]', err);
      setState({ backupNotice: { kind: 'bad', message: "Couldn't read that file. Nothing was changed — try choosing it again." } });
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setState({ backupNotice: { kind: 'bad', message: "That doesn't look like a CareTracker backup. Choose the file whose name ends in .json — the spreadsheet and the printable report can't be loaded back." } });
      return;
    }
    let bundle = null;
    try {
      bundle = bkReadIncoming(parsed);
    } catch (err) {
      const msg = (err && err.message === 'newer-format')
        ? 'This backup was made by a newer version of CareTracker than the one on this phone. Update the app first — loading it here could leave part of it out without saying so.'
        : "That doesn't look like a CareTracker backup. Choose the file whose name ends in .json — the spreadsheet and the printable report can't be loaded back.";
      setState({ backupNotice: { kind: 'bad', message: msg } });
      return;
    }
    if (!bundle.records.length && !bundle.medications) {
      setState({ backupNotice: { kind: 'bad', message: 'That backup file is empty. Nothing was changed.' } });
      return;
    }

    const res = await bkRestore(bundle);
    const med = bkRestoreMedications(bundle.medications);
    let prefsMoved = false;
    try {
      prefsMoved = await bkRestorePrefs(bundle.prefs);
    } catch (err) {
      // Settings are not records. Failing to move the high-water mark is worth a console line and
      // nothing else; the records are already in.
      console.error('[restore:prefs]', err);
    }

    // Every number here is counted from what actually happened, not from what was attempted.
    const bits = [];
    bits.push(res.added === 0
      ? 'Nothing new to add — everything in that file was already on this phone.'
      : ('Restored ' + res.added + ' record' + (res.added === 1 ? '' : 's') +
         (res.appointments ? ', including ' + res.appointments + ' appointment record' + (res.appointments === 1 ? '' : 's') : '') + '.'));
    if (res.already) bits.push(res.already + ' ' + (res.already === 1 ? 'was' : 'were') + ' already here and ' + (res.already === 1 ? 'was' : 'were') + ' left alone.');
    if (med.mode === 'restored') bits.push('Your medication list came back too.');
    else if (med.archivedAdded) bits.push('Added ' + med.archivedAdded + ' medication name' + (med.archivedAdded === 1 ? '' : 's') + ' so older doses still read properly.');
    if (prefsMoved) bits.push('Your settings were brought forward.');
    if (res.unusable) bits.push(res.unusable + ' ' + (res.unusable === 1 ? 'line' : 'lines') + " in the file couldn't be read and " + (res.unusable === 1 ? 'was' : 'were') + ' left out.');
    if (res.failed) bits.push(res.failed + ' ' + (res.failed === 1 ? "couldn't" : "couldn't") + ' be written — check your connection and load the file again; loading it twice is safe.');
    bits.push('Nothing was removed.');

    setState({ backupNotice: { kind: (res.failed || res.unusable) ? 'bad' : 'ok', message: bits.join(' ') } });
    setToast(res.added ? ('Restored ' + res.added + ' record' + (res.added === 1 ? '' : 's') + '.') : 'Nothing new to restore.');
  } catch (err) {
    console.error('[restore]', err);
    setState({ backupNotice: { kind: 'bad', message: "Something went wrong loading that file. Nothing was removed. Please try again." } });
  } finally {
    setState({ restoring: false });
  }
}

// ------------------------------------------------------------------------------------------------
// Concurrent edit — "this changed while you had it open"
// ------------------------------------------------------------------------------------------------

// A stable fingerprint of the version of an appointment that is live RIGHT NOW. Document id and
// loggedAt alone would be enough for two copies of this app, but the visible fields are folded in
// as well so that a document written by anything else -- a repair script, a restore, a future
// build -- still registers as a change instead of slipping past on a matching timestamp.
function calApptStampFor(apptId) {
  const live = (state.appointments || []).find((a) => a.apptId === apptId);
  if (!live) return 'gone';
  return [String(live.id || ''), String(live.loggedAt || 0), String(live.ts || 0), String(live.title || ''), String(live.note || '')].join('|');
}

function calDetectApptConflict(s) {
  // A brand-new appointment has nothing to clash with. overwriteOk is set only by the person
  // pressing "Keep mine" on the notice, which is the informed choice this whole thing exists for.
  if (!s || !s.apptId || s.overwriteOk) return null;
  if (calApptStampFor(s.apptId) === s.baseStamp) return null;
  const live = (state.appointments || []).find((a) => a.apptId === s.apptId);
  if (!live) {
    return { kind: 'removed', message: 'Someone else removed this appointment from another phone while you had it open. Nothing has been saved yet.' };
  }
  const when = calIsValidTs(live.ts) ? (new Date(live.ts).toLocaleDateString() + ' at ' + fmtTime(live.ts)) : '';
  const note = String(live.note || '').trim();
  return {
    kind: 'changed',
    message: 'Someone else changed this appointment from another phone while you had it open. It now says “' + String(live.title || '') + '”' +
      (when ? ', ' + when : '') + (note ? ' — ' + note : '') + '. Nothing has been saved yet.',
    theirs: { title: String(live.title || ''), when: toLocalISO(live.ts), note: note }
  };
}

// "Keep mine" is the ONLY route to writing over the other phone's version, and it is reached by
// reading what the other version says and then pressing a button. Nothing here happens on its own.
function calKeepMine() {
  const c = state.apptSheet;
  if (!c || c.busy) return;
  c.overwriteOk = true;
  c.conflict = null;
  c.error = '';
  setState({ apptSheet: c });
  calSaveAppt();
}

function calUseTheirs() {
  const c = state.apptSheet;
  if (!c || c.busy || !c.conflict) return;
  if (c.conflict.kind === 'removed') {
    calSheetNeedsFocus = false;
    setState({ apptSheet: null, apptConfirmDelete: null });
    setToast('Left as removed. Nothing was changed.');
    return;
  }
  const t = c.conflict.theirs || {};
  c.title = String(t.title || '');
  c.when = String(t.when || c.when);
  c.note = String(t.note || '');
  c.conflict = null;
  c.error = '';
  // Re-based on what is live now, so the next Save is measured against the version on screen.
  c.baseStamp = calApptStampFor(c.apptId);
  setState({ apptSheet: c });
}

function renderHistory(now) {"""


# =================================================================================================
# EDIT 11 — the card's own description, which no longer describes what the card does
# =================================================================================================
# It listed five things and stopped short of appointments (they were not in any file), and it said
# "The file" when the card now offers three. The counter line under it read "2 entries" on a phone
# holding two entries and an appointment, under a button that saves all three.
A11 = """          h('span', { style: { display: 'block', fontSize: '12px', color: '#6E5261', lineHeight: '1.35', marginTop: '2px', maxWidth: '52ch' } }, "Everything you've logged — doses, temperatures, weights, symptoms and treatment dates. The file saves to this phone. Nothing is sent anywhere."),
          h('span', { className: 'mono', style: { display: 'block', fontSize: '10.5px', color: '#8E3D61', fontWeight: '700', marginTop: '5px' } },
            empty ? 'Nothing logged yet' : (nLogged + ' entr' + (nLogged === 1 ? 'y' : 'ies') + (lastTs ? ' · last logged ' + new Date(lastTs).toLocaleDateString() : '')))"""

B11 = """          h('span', { style: { display: 'block', fontSize: '12px', color: '#6E5261', lineHeight: '1.35', marginTop: '2px', maxWidth: '52ch' } }, "Everything you've logged — doses, temperatures, weights, symptoms, treatment dates and appointments. The files save to this phone. Nothing is sent anywhere."),
          h('span', { className: 'mono', style: { display: 'block', fontSize: '10.5px', color: '#8E3D61', fontWeight: '700', marginTop: '5px' } },
            emptyBackup ? 'Nothing saved yet' : [
              nLogged ? (nLogged + ' entr' + (nLogged === 1 ? 'y' : 'ies')) : '',
              nAppts ? (nAppts + ' appointment' + (nAppts === 1 ? '' : 's')) : '',
              lastTs ? ('last logged ' + new Date(lastTs).toLocaleDateString()) : ''
            ].filter(Boolean).join(' · '))"""


EDITS = [
    ("1: icon table gains the restore glyph", A1, B1),
    ("2: state gains restoring / backupNotice", A2, B2),
    ("3: save-a-copy card counts the backup separately", A3, B3),
    ("4: btn() takes an explicit off-condition", A4, B4),
    ("5: buttons row, honest copy, and the restore row", A5, B5),
    ("6: calOpenApptSheet records the version it opened", A6, B6),
    ("7: calSaveAppt stops on a concurrent edit", A7, B7),
    ("8: calRemoveAppt stops on a concurrent edit", A8, B8),
    ("9: the concurrent-edit notice in the appointment sheet", A9, B9),
    ("10: the backup & restore block", A10, FEATURE_BLOCK),
    ("11: the card describes what the card now does", A11, B11),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".", help="path to the care-tracker checkout")
    ap.add_argument("--check", action="store_true", help="report only; write nothing")
    args = ap.parse_args()

    target = os.path.join(args.repo, "index.html")
    if not os.path.isfile(target):
        fail("no index.html at " + target)

    with open(target, "r", encoding="utf-8") as fh:
        src = fh.read()

    digest = hashlib.md5(src.encode("utf-8")).hexdigest()
    print("export-patch.py")
    print("  target : " + target)
    print("  md5    : " + digest + ("  (pristine v43.4 base)" if digest == BASE_MD5_V43_4 else ""))

    # ---- APP_VERSION is read out of the file, never assumed. calendar-patch and reason-patch both
    # ---- hardcode 'v43.3' in this same check and both therefore refuse to run on v43.4.
    versions = re.findall(r"const APP_VERSION = '([^']*)';", src)
    if len(versions) != 1:
        fail("expected exactly one APP_VERSION declaration, found %d" % len(versions))
    app_version = versions[0]
    version_line = "const APP_VERSION = '%s';" % app_version
    version_count = src.count("APP_VERSION")
    print("  version: " + app_version + " (this patch must leave it exactly as it is)")

    # ---- idempotence -------------------------------------------------------------------------
    if SENTINEL in src:
        print("  status : ALREADY APPLIED (found " + SENTINEL + "). Nothing to do.")
        return

    # ---- dependency: calendar-patch --------------------------------------------------------------
    missing_dep = [n for n in REQUIRED_FROM_CALENDAR if n not in src]
    if missing_dep:
        bar = "!" * 86
        print("\n" + bar)
        print("REFUSING TO PATCH: calendar-patch.py has not been applied to this file.")
        print("")
        print("This patch puts APPOINTMENTS into the backup and adds the concurrent-edit notice to")
        print("the appointment sheet. Without calendar-patch there are no appointments in this")
        print("build at all, so both of those would silently do nothing.")
        print("")
        print("Missing from index.html:")
        for n in missing_dep:
            print("    " + n)
        print("")
        print("Apply the patches in this order:")
        print("    python3 cleanup-patch.py  --repo <repo>")
        print("    python3 calendar-patch.py --repo <repo>")
        print("    python3 reason-patch.py   --repo <repo>")
        print("    python3 export-patch.py   --repo <repo>      <-- this one, last")
        print("")
        print("Nothing was written. index.html is untouched.")
        print(bar)
        sys.exit(2)
    print("  depends: calendar-patch detected (%d markers)." % len(REQUIRED_FROM_CALENDAR))

    # ---- preflight: no collisions ----------------------------------------------------------------
    # Duplicate object keys and duplicate function declarations are both LEGAL JavaScript. The last
    # one wins, silently, with no error anywhere. This project has already lost a day to that.
    clashes = [n for n in NEW_IDENTIFIERS if n in src]
    clashes += [n for n in NEW_HOOKS if n in src]
    if clashes:
        fail("these names already exist in index.html and would silently collide:\n           " +
             "\n           ".join(sorted(set(clashes))))
    print("  preflight: %d identifiers and %d data-hooks checked, none already present."
          % (len(NEW_IDENTIFIERS), len(NEW_HOOKS)))

    # ---- anchors: all must match, exactly once, BEFORE anything is written ------------------------
    for name, anchor, _ in EDITS:
        n = src.count(anchor)
        if n == 0:
            fail("anchor for edit %s did not match.\n"
                 "           The file this patch was written against has moved. Re-derive the\n"
                 "           anchor against this exact build; do not loosen it.\n"
                 "           Anchor began: %r" % (name, anchor[:110]))
        if n > 1:
            fail("anchor for edit %s matched %d times and must match exactly once.\n"
                 "           Anchor began: %r" % (name, n, anchor[:110]))

    out = src
    for name, anchor, repl in EDITS:
        out = out.replace(anchor, repl, 1)
        print("  ok  edit " + name)

    # ---- post-conditions -------------------------------------------------------------------------
    def post(cond, msg):
        if not cond:
            fail("POST-CONDITION FAILED: " + msg)

    post(version_line in out, "APP_VERSION was altered. This patch must never touch it.")
    post(out.count("APP_VERSION") == version_count + 1,
         "APP_VERSION occurrences changed by something other than the one read in the backup file.")

    post("return (state.entries || []).concat(state.chemoDates || []);" in out,
         "allExportEntries() was modified. It is the seam that keeps appointments and\n"
         "           missed_reason documents out of the spreadsheet and out of the record handed\n"
         "           to an oncologist, and calendar-patch and reason-patch both assert on it.")
    post(out.count("function allExportEntries()") == 1, "allExportEntries() is declared more than once.")
    post(out.count("const EXPORT_COLUMNS =") == 1 and src[src.index("const EXPORT_COLUMNS ="):src.index("const EXPORT_COLUMNS =") + 400]
         == out[out.index("const EXPORT_COLUMNS ="):out.index("const EXPORT_COLUMNS =") + 400],
         "EXPORT_COLUMNS changed. The spreadsheet's shape is not this patch's business.")

    post("const here = Object.create(null);" in out,
         "the restore membership map is not Object.create(null). With a plain {} an id such as\n"
         "           'constructor' tests TRUTHY on an EMPTY map and that record is silently skipped\n"
         "           while the screen reports a successful restore.")
    post("const here = {}" not in out, "a plain-object membership map was introduced.")

    # Whole-line // comments are removed before every mechanical check below. The traps these
    # checks guard against are worth documenting in prose right next to the code that avoids them,
    # and a checker that cannot tell prose from code punishes exactly the comment you want written.
    code = re.sub(r"^[ \t]*//.*$", "", out, flags=re.M)
    block = code[code.index("const BK_FORMAT ="):code.index("function renderHistory(now) {")]

    post("deleteDoc" not in block, "the backup block references deleteDoc. Restore must never delete.")
    post("removeEntryDB" not in block, "the backup block references removeEntryDB. Restore must never delete.")
    post("updateDoc" not in code, "updateDoc appeared. Firestore rules here are append-only.")
    post(block.count("setDoc(") == 2,
         "the backup block makes %d setDoc calls; expected exactly two (records, prefs)."
         % block.count("setDoc("))

    # THE h() TRAP. h() does a bare el.setAttribute(k, v), so `disabled: cond ? 'disabled' : null`
    # renders disabled="null" and ANY value disables the control. Two export buttons already
    # shipped dead exactly this way -- this patch's own area.
    trap = re.compile(r"\b'?(disabled|checked|selected|readonly|hidden|inert|aria-pressed|aria-current)'?\s*:\s*[^,}\n]*\b(null|undefined)\b")
    hits = [m.group(0) for m in trap.finditer(code)
            if not re.search(r":\s*(null|undefined)\s*(===|!==|==|!=)", m.group(0))]
    post(not hits, "a conditional attribute can evaluate to null/undefined and h() will\n"
                   "           setAttribute it, disabling the control: " + " | ".join(hits))

    # setState from onInput rebuilds the tree and destroys the field being typed into.
    for handler in re.findall(r"onInput:\s*\([^)]*\)\s*=>\s*\{[^}]*\}", out):
        post("setState" not in handler, "an onInput handler calls setState: " + handler[:90])

    if args.check:
        print("\n  --check: anchors and post-conditions all pass. Nothing written.")
        return

    with open(target, "w", encoding="utf-8") as fh:
        fh.write(out)

    new_digest = hashlib.md5(out.encode("utf-8")).hexdigest()
    print("")
    print("  written: " + target)
    print("  new md5: " + new_digest)
    print("  status : APPLIED — %d anchored edits, %+d bytes." % (len(EDITS), len(out) - len(src)))
    print("  note   : sw.js was not opened. APP_VERSION left at " + app_version + ".")


if __name__ == "__main__":
    main()
