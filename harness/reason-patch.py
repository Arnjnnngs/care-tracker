#!/usr/bin/env python3
"""
reason-patch.py — optional "why this dose was missed" reasons for care-tracker's index.html.

WHAT THIS IS A PORT OF.  ChemoWell has NO missed-dose reason picker; that was searched for and is
documented in REASON-REPORT.md.  What ChemoWell has is the optional "Reason for change" quick-select
on a WEIGHT log (`WEIGHT_REASONS`, app-v21, added "per Aaron's request") — a short tap-to-pick list,
always skippable, stored on the record and surfaced in History and in the Weight report.  THAT
interaction is what is ported here and attached to care-tracker's missed doses.  The ChemoWell list
itself is about weight and is useless for a missed dose, so the wording is new; every word of it is
justified in REASON-REPORT.md.

PROPERTIES THIS SCRIPT GUARANTEES
  * ANCHORED   — every edit is located by an exact substring that must appear EXACTLY ONCE.  Any
                 anchor missing, or appearing more than once, aborts the whole run with a non-zero
                 exit and NOTHING is written.
  * ATOMIC     — the new file is built entirely in memory.  The first failure aborts before any
                 write, so index.html is never left half-patched.
  * IDEMPOTENT — a second run detects the sentinel and exits 0 having changed nothing.
  * NON-COLLIDING — every identifier and data-hook it introduces is checked against the file first.
                 If one already exists the run aborts.  Duplicate object keys are legal JavaScript:
                 last one wins, no error, no warning, and another patch's feature quietly dies.
  * DOES NOT TOUCH APP_VERSION, and does not open sw.js at all.  Both verified after patching.
  * DOES NOT TOUCH THE CSV.  EXPORT_COLUMNS and allExportEntries() are verified byte-identical
                 afterwards, and reason documents are split out of state.entries at arrival so they
                 can never reach the export by any route.

ORDER RELATIVE TO THE OTHER PATCHES
  Every anchor here was chosen to be disjoint from calendar-patch.py's, so the two apply in EITHER
  order.  The one line both patches care about — the once-a-second repaint guard — is reached here
  through the `isEditing` line ABOVE it rather than through the `if` itself, precisely so that
  calendar-patch.py's anchor on that `if` survives this patch and vice versa.

Usage:
    python3 reason-patch.py [--repo /path/to/care-tracker] [--check]

    --check   verify only: report whether the patch is applied / appliable.  Writes nothing.
"""

import argparse
import hashlib
import os
import re
import sys

BASE_MD5 = "8136b7764f07865171c180212a4d5b09"          # care-tracker v43.3, commit 87e89bb
SENTINEL = "MR_MED_ID"                                  # presence => already applied

# Identifiers this patch introduces.  If ANY already exists in the file we abort rather than
# shadow, redeclare or silently override something another patch owns.
NEW_IDENTIFIERS = [
    "MR_MED_ID", "MR_NOTE_MAX", "MR_REASONS", "MR_NOTE_ONLY_LABEL",
    "mrLabelFor", "mrKey", "mrKeyOf", "mrSupersedes", "mrResolveReasons", "mrReasonFor",
    "mrOpenSheet", "mrCloseSheet", "mrSaveReason", "mrRemoveReason", "mrToggleReason",
    "mrChipStyle", "mrLabelStyle", "renderMissReasonSheet", "mrReportBlock", "mrReportDate",
    "mrClearToast",
    # state fields
    "missReasons", "missReasonSheet",
    # the Firestore medId namespace
    "missed_reason",
]

# Every test hook this patch emits.  All unique and descriptive: a hook reused across three sections
# makes querySelector silently return the first, and an auditor then measures a third of a feature
# and passes it.
NEW_HOOKS = [
    "data-mr-missed-row", "data-mr-row-button", "data-mr-row-reason", "data-mr-row-note",
    "data-mr-overlay", "data-mr-sheet", "data-mr-chip", "data-mr-note-input",
    "data-mr-save", "data-mr-cancel", "data-mr-remove", "data-mr-error", "data-mr-actions",
]


# =================================================================================================
# EDIT 1 — subscribeEntries: split reason documents out of state.entries at arrival
#
# Anchored on the `const all = ...` line ALONE.  calendar-patch.py rewrites the two lines directly
# below this one; keeping off them lets both patches apply in either order.
# =================================================================================================
A1 = "    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));\n"

B1 = """    const mrRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Missed-dose reasons are notes ABOUT a non-event, not doses.  They are split out of
    // state.entries here — before anything downstream can see them — exactly the way chemo_date is
    // split out on the next line.  That is what keeps them out of every dose count, out of the
    // daily log, out of the printable report's entry tables and out of the CSV BY CONSTRUCTION,
    // rather than by a dozen call sites each remembering to filter.  allExportEntries() is
    // entries + chemoDates and this patch deliberately does not change it.
    state.missReasons = mrResolveReasons(mrRaw);
    const all = mrRaw.filter((e) => !e || e.medId !== MR_MED_ID);
"""


# =================================================================================================
# EDIT 2 — state: two new fields
#
# Anchored mid-literal, away from the tail of the same line that calendar-patch.py appends to.
# =================================================================================================
A2 = "missedClearedAt: 0, confirmClearChemo: false"

B2 = ("missedClearedAt: 0, missReasons: new Map(), missReasonSheet: null, "
      "confirmClearChemo: false")


# =================================================================================================
# EDIT 3 — the feature block, and missedRow() rebuilt around it
# =================================================================================================
A3 = """function missedRow(e, i) {
  return h('div', { onClick: () => logMissedDose(e), style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderTop: i > 0 ? '1px solid rgba(192,69,59,0.2)' : 'none', background: 'rgba(192,69,59,0.10)', borderLeft: '4px solid #C0453B', cursor: 'pointer' } },
    h('div', { className: 'mono', style: { fontSize: '13px', color: '#C0453B', fontWeight: '700', minWidth: '66px' } }, fmtTime(e.ts)),
    h('div', { style: { flex: '1' } },
      h('div', { style: { fontSize: '15px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', color: '#C0453B' } },
        nameOf(e.medId),
        h('span', { style: { fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', background: '#C0453B', borderRadius: '6px', padding: '2px 7px' } }, 'Missed')
      ),
      h('div', { style: { fontSize: '12.5px', color: '#C0453B', fontWeight: '600' } }, e.windowName + ' window closed — tap to log')
    ),
    h('span', { style: { flexShrink: '0', fontSize: '11.5px', fontWeight: '800', color: '#C0453B', opacity: '0.7' } }, '›')
  );
}
"""

B3 = r"""// =================================================================================================
// MISSED-DOSE REASONS   (the ChemoWell "Reason for change" interaction, attached to missed doses)
//
// WHAT WAS PORTED.  ChemoWell has no missed-dose reason picker — its missed doses are resolved with
// "Took later", "Skipped" and "Clear", and none of the three records why.  What it does have is the
// optional "Reason for change" quick-select on a WEIGHT log: a short tap-to-pick list that can
// always be skipped, stored on the record, shown back in History and summarised in the Weight
// report.  That is the interaction being ported.  The list of reasons is new — ChemoWell's is about
// fluid and appetite — and the wording is argued line by line in REASON-REPORT.md.
//
// WHAT A REASON IS ATTACHED TO.  A missed dose in care-tracker is not a document.  missedDosesFor()
// recomputes it from the medication schedule on every single render, so there is no id to hang a
// reason from.  Identity here is `medication id + window-start timestamp` — the exact pair the miss
// object already carries and the banner already prints.  It is stable across re-derivation because
// the window start is dayStart(day) + startHour: a pure function of the day and the saved schedule.
// The consequences, stated here rather than discovered later:
//   * Change a window's START HOUR in the medication editor and reasons recorded against the old
//     window stop matching.  That is correct — the window they described no longer exists.
//   * RENAME a window and the reason survives, because the name is not part of the key.  Renaming
//     is common; re-timing is not.  That is the trade the key is making.
//   * Two windows on one medication that start at the same hour share one key.  They are already
//     indistinguishable to the banner and to the CSV, and one reason covering both is the
//     least-wrong answer available.
//   * Log the dose late, the window becomes covered, the miss disappears — and the reason goes with
//     it, because a reason is only ever read through a currently-derived miss.  The document stays
//     in Firestore (nothing here deletes anything) and reappears if the miss ever does.
//
// WHY EVERY CHANGE IS AN INSERT.  This project's Firestore rules are append-only: existing documents
// cannot be edited, and deletes are refused after 48 hours.  So changing an answer APPENDS a new
// document for the same key and the newest loggedAt wins (mrSupersedes); removing an answer APPENDS
// one with an empty reasonId.  Nothing in this block calls updateDoc, setDoc or deleteDoc.  People
// mis-tap, and a mis-tap must be fixable on a screen where nothing can be un-said.
//
// WHY IT IS NOT IN THE CSV.  Reason documents are removed from state.entries the moment they arrive
// (see subscribeEntries), so allExportEntries() — and therefore the CSV — never sees one, and the
// export's byte format is untouched.  That is deliberate and it is a trade-off, stated loudly in
// REASON-REPORT.md: the CSV is the backup, and reasons are currently not in it.
//
// TONE.  Recording a reason is optional everywhere and blocks nothing.  There is no prompt, no
// badge, no count, no red, no "1 of 3 explained" and no unfinished-business styling anywhere in
// this block.  The only way to reach it is to deliberately tap one quiet button on a missed row.  A
// patient on chemotherapy does not have to justify a missed dose to use her own app.
// =================================================================================================

// Its own medId namespace inside caretracker_entries.  A NEW collection was the tidier option and
// was rejected: the published security rules match named collections, and a client write to an
// unmatched path is refused — the feature would fail silently on the live build and work perfectly
// in every harness.  It must never be a real medication's id: missedDosesFor() counts any same-day
// entry under a medication's own id as covering a window, so a reason filed under 'protonix' would
// erase the very miss it describes.
const MR_MED_ID = 'missed_reason';
const MR_NOTE_MAX = 140;

// THE WORDING.  Nine options, ordered illness-first.  Every one is a plain statement of what
// happened with no evaluation attached: nothing here calls anyone forgetful, careless, or
// non-compliant, and there is no option a person would be ashamed to tap.  "Lost track of the time"
// carries the same information as "Forgot" without the verdict.  "Care team said to hold it" is
// here because a held dose is clinically the opposite of a missed one and an oncologist needs to
// see it separated from the rest.  "Something else" replaces "Other", which reads like a form.
const MR_REASONS = [
  { id: 'nausea',  label: 'Felt too nauseous' },
  { id: 'unwell',  label: 'Felt too unwell' },
  { id: 'vomited', label: "Couldn't keep it down" },
  { id: 'asleep',  label: 'Was asleep' },
  { id: 'time',    label: 'Lost track of the time' },
  { id: 'away',    label: "Didn't have it with me" },
  { id: 'ranout',  label: 'Ran out of it' },
  { id: 'held',    label: 'Care team said to hold it' },
  { id: 'other',   label: 'Something else' }
];
const MR_NOTE_ONLY_LABEL = 'Described in the note';

// Resolves an id to its label.  A document written by an older build carries the label it was shown
// at the time, so an id this build no longer knows still prints as words rather than as a slug.
function mrLabelFor(id, fallbackLabel) {
  const found = MR_REASONS.find((r) => r.id === id);
  if (found) return found.label;
  const fb = String(fallbackLabel || '').trim();
  return fb || MR_NOTE_ONLY_LABEL;
}

// The identity of a missed dose.  See the block comment above for why it is this pair and what that
// costs.  Number() and String() are not decoration: these two values come back off the wire.
function mrKey(medId, ts) { return String(medId) + '|' + Number(ts); }
function mrKeyOf(miss) { return miss ? mrKey(miss.medId, miss.ts) : ''; }

// Append-only supersede: newest loggedAt wins.  The document-id tie-break makes the winner
// deterministic when two writes land in the same millisecond, so two devices resolving the same
// pair of documents cannot disagree about which one is current.
function mrSupersedes(next, prev) {
  const a = (typeof next.loggedAt === 'number' && isFinite(next.loggedAt)) ? next.loggedAt : 0;
  const b = (typeof prev.loggedAt === 'number' && isFinite(prev.loggedAt)) ? prev.loggedAt : 0;
  if (a !== b) return a > b;
  return String(next.id || '') > String(prev.id || '');
}

// Collapses every reason document down to one winner per missed-dose key.  A Map, not an object
// literal: the key contains a medication id, medication ids are user-supplied, and a medication
// named "constructor" or "toString" against a plain {} yields an inherited function where a record
// should be — truthy, not a record, and every read downstream breaks in a different place.
function mrResolveReasons(docs) {
  const out = new Map();
  (docs || []).forEach((d) => {
    if (!d || d.medId !== MR_MED_ID) return;
    if (typeof d.missMedId !== 'string' || !d.missMedId) return;
    const ts = Number(d.missTs);
    if (!isFinite(ts) || ts <= 0) return;
    const rec = {
      id: d.id,
      key: mrKey(d.missMedId, ts),
      missMedId: d.missMedId,
      missTs: ts,
      missWindow: String(d.missWindow || ''),
      reasonId: String(d.reasonId || ''),
      reasonLabel: String(d.reasonLabel || ''),
      note: String(d.note || ''),
      loggedAt: d.loggedAt
    };
    const prev = out.get(rec.key);
    if (!prev || mrSupersedes(rec, prev)) out.set(rec.key, rec);
  });
  return out;
}

// The current reason for one missed dose, or null.  A record whose reasonId and note are both empty
// is a removal — it exists only because nothing can be deleted, and it reads as "no reason".
function mrReasonFor(miss) {
  const map = state.missReasons;
  if (!miss || !map || typeof map.get !== 'function') return null;
  const rec = map.get(mrKeyOf(miss));
  if (!rec) return null;
  if (!rec.reasonId && !rec.note) return null;
  return rec;
}

function mrOpenSheet(miss) {
  if (!miss) return;
  const existing = mrReasonFor(miss);
  setState({ missReasonSheet: {
    medId: miss.medId,
    ts: miss.ts,
    windowName: String(miss.windowName || ''),
    reasonId: existing ? existing.reasonId : '',
    note: existing ? existing.note : '',
    hadSaved: !!existing,
    busy: false,
    error: ''
  } });
}

function mrCloseSheet() { setState({ missReasonSheet: null }); }

// Chip taps go through setState because they change what is drawn.  The note field never does —
// setState rebuilds the whole tree and would destroy the textarea being typed into, taking the
// caret and the IME composition with it.  The draft is written straight onto the state object and
// is read back by the next render, which is what makes the sheet survive a repaint intact.
function mrToggleReason(id) {
  const s = state.missReasonSheet;
  if (!s || s.busy) return;
  setState({ missReasonSheet: Object.assign({}, s, { reasonId: s.reasonId === id ? '' : id, error: '' }) });
}

async function mrSaveReason() {
  const s = state.missReasonSheet;
  if (!s || s.busy) return;
  const reasonId = String(s.reasonId || '');
  const note = String(s.note || '').slice(0, MR_NOTE_MAX).trim();
  // Save with nothing chosen is not an error and does not scold: it means "never mind".  If there
  // was a saved reason it is removed, otherwise the sheet simply closes.
  if (!reasonId && !note) { await mrRemoveReason(); return; }
  setState({ missReasonSheet: Object.assign({}, s, { busy: true, error: '' }) });
  try {
    await addEntryDB({
      medId: MR_MED_ID,
      missMedId: String(s.medId),
      missTs: Number(s.ts),
      missWindow: String(s.windowName || ''),
      reasonId: reasonId,
      // A snapshot of the words shown when it was tapped, so a future edit to MR_REASONS cannot
      // retroactively change what a past record says.
      reasonLabel: reasonId ? mrLabelFor(reasonId, '') : '',
      note: note,
      // ts mirrors the window it describes so a raw dump of the collection still sorts sensibly.
      ts: Number(s.ts),
      mg: 0,
      dose: 'Missed-dose reason',
      loggedAt: Date.now()
    });
    setState({ missReasonSheet: null });
    setToast('Saved. You can change it any time.');
  } catch (err) {
    console.error('[missed-reason:save]', err);
    const cur = state.missReasonSheet;
    if (cur) setState({ missReasonSheet: Object.assign({}, cur, { busy: false, error: "Couldn't save that just now — your records are safe. Please try again." }) });
  }
}

// Removal is an append, not a delete.  The rules refuse a delete after 48 hours, and a reason
// recorded last week must still be retractable.
async function mrRemoveReason() {
  const s = state.missReasonSheet;
  if (!s || s.busy) return;
  if (!s.hadSaved) { mrCloseSheet(); return; }
  setState({ missReasonSheet: Object.assign({}, s, { busy: true, error: '' }) });
  try {
    await addEntryDB({
      medId: MR_MED_ID,
      missMedId: String(s.medId),
      missTs: Number(s.ts),
      missWindow: String(s.windowName || ''),
      reasonId: '',
      reasonLabel: '',
      note: '',
      ts: Number(s.ts),
      mg: 0,
      dose: 'Missed-dose reason removed',
      loggedAt: Date.now()
    });
    setState({ missReasonSheet: null });
    setToast('Removed.');
  } catch (err) {
    console.error('[missed-reason:remove]', err);
    const cur = state.missReasonSheet;
    if (cur) setState({ missReasonSheet: Object.assign({}, cur, { busy: false, error: "Couldn't save that just now — your records are safe. Please try again." }) });
  }
}

function mrChipStyle(active) {
  return {
    minHeight: '44px', padding: '0 15px', borderRadius: '999px',
    border: active ? '1px solid #8E3D61' : '1px solid rgba(212,104,138,0.28)',
    background: active ? '#8E3D61' : 'rgba(255,255,255,0.78)',
    color: active ? '#FFFFFF' : '#5C4553',
    fontSize: '14.5px', fontWeight: active ? '800' : '600',
    lineHeight: '1.2', textAlign: 'left'
  };
}

function mrLabelStyle() {
  return { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' };
}

// The sheet.  Opened only by an explicit tap on a missed row; dismissed by the overlay, by Cancel,
// or by saving.  Nothing anywhere opens it on the patient's behalf.
function renderMissReasonSheet() {
  const s = state.missReasonSheet;
  if (!s) return null;
  const when = new Date(s.ts);
  const dateLine = (isFinite(s.ts) && s.ts > 0)
    ? when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + fmtTime(s.ts)
    : '';
  const busyAttr = s.busy ? { disabled: 'disabled' } : {};
  return h('div', { 'data-mr-overlay': 'true', onClick: (ev) => { if (ev.target === ev.currentTarget && !s.busy) mrCloseSheet(); }, style: { position: 'fixed', inset: '0', background: 'rgba(60,30,50,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '62', padding: '18px' } },
    h('div', { 'data-mr-sheet': 'true', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add a reason', style: { background: 'rgba(255,245,248,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(212,104,138,0.18)', borderRadius: '22px', padding: '22px 20px', width: '340px', maxWidth: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(120,60,90,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.7)' } },
      h('div', { style: { fontSize: '11.5px', fontWeight: '800', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A6479' } }, nameOf(s.medId) + (s.windowName ? ' · ' + s.windowName : '')),
      dateLine ? h('div', { className: 'mono', style: { fontSize: '12.5px', color: '#7D6974', marginTop: '2px' } }, dateLine) : null,
      h('div', { style: { fontSize: '18px', fontWeight: '800', letterSpacing: '-0.01em', color: '#3D2B3A', marginTop: '10px' } }, 'Add a reason'),
      // The whole justification for the feature, in one line, in the only place it needs saying.
      h('div', { style: { fontSize: '13.5px', lineHeight: '1.5', color: '#6B5563', marginTop: '5px', marginBottom: '18px' } }, 'Completely optional — it just gives the care team the context. Skip it, change it or remove it whenever you like.'),
      h('div', { style: mrLabelStyle() }, 'What happened'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
        ...MR_REASONS.map((r) => h('button', Object.assign({
          'data-mr-chip': r.id,
          'aria-pressed': s.reasonId === r.id ? 'true' : 'false',
          onClick: () => mrToggleReason(r.id),
          style: mrChipStyle(s.reasonId === r.id)
        }, busyAttr), r.label))
      ),
      h('div', { style: Object.assign(mrLabelStyle(), { marginTop: '20px' }) }, 'Anything else worth remembering'),
      h('textarea', Object.assign({
        'data-mr-note-input': 'true',
        value: s.note || '',
        // NEVER setState from onInput — it rebuilds the tree and destroys the field being typed in.
        onInput: (ev) => { if (state.missReasonSheet) state.missReasonSheet.note = ev.target.value; },
        rows: 3,
        maxlength: String(MR_NOTE_MAX),
        placeholder: 'Optional, in your own words',
        // 16px, not 14: below 16 iOS Safari zooms the page in on focus and never zooms back out.
        style: { width: '100%', boxSizing: 'border-box', border: '1px solid rgba(212,104,138,0.2)', borderRadius: '13px', padding: '10px 13px', fontSize: '16px', lineHeight: '1.45', background: 'rgba(255,255,255,0.7)', color: '#3D2B3A', resize: 'vertical', fontFamily: 'inherit' }
      }, busyAttr)),
      s.error ? h('div', { 'data-mr-error': 'true', role: 'alert', style: { marginTop: '14px', background: 'rgba(192,69,59,0.12)', border: '1px solid rgba(192,69,59,0.3)', borderRadius: '12px', padding: '11px 13px', fontSize: '13px', lineHeight: '1.45', color: '#A13830', fontWeight: '600' } }, s.error) : null,
      // The action row is STICKY inside the scrolling panel. Nine chips plus a note field are
      // taller than a 375x812 phone, and with a statically-positioned footer the primary action sat
      // below the fold: the patient had to scroll past the whole list to find Save. Sticky keeps it
      // on screen from the first frame. The negative bottom/margin cancels the panel's own 22px
      // padding so the strip sits flush with the bottom edge when it is pinned.
      h('div', { 'data-mr-actions': 'true', style: { position: 'sticky', bottom: '-22px', marginTop: '20px', marginBottom: '-22px', paddingTop: '12px', paddingBottom: '22px', background: '#FFF5F8', borderTop: '1px solid rgba(212,104,138,0.14)' } },
      h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', Object.assign({ 'data-mr-cancel': 'true', onClick: mrCloseSheet, style: { flex: '1', minHeight: '50px', borderRadius: '13px', border: '1px solid rgba(212,104,138,0.22)', background: 'rgba(255,255,255,0.55)', color: '#7D6974', fontSize: '15px', fontWeight: '700' } }, busyAttr), 'Cancel'),
        h('button', Object.assign({ 'data-mr-save': 'true', onClick: mrSaveReason, style: { flex: '1', minHeight: '50px', borderRadius: '13px', background: '#AA5375', color: '#fff', fontSize: '15px', fontWeight: '700', boxShadow: 'inset 0 -2px 0 rgba(150,60,90,0.35)' } }, busyAttr), s.busy ? 'Saving…' : 'Save')
      ),
      s.hadSaved ? h('button', Object.assign({ 'data-mr-remove': 'true', onClick: mrRemoveReason, style: { display: 'block', width: '100%', minHeight: '44px', marginTop: '8px', borderRadius: '13px', background: 'transparent', color: '#8A6479', fontSize: '13.5px', fontWeight: '700' } }, busyAttr), 'Remove this reason') : null
      )
    )
  );
}

// The report subsection.  Summarised by reason, the way the table above it is summarised by
// medication, and gated on the same "only when something was actually logged" rule — a document
// built purely from non-events is never emitted.  Kept visibly separate from the dose data: this is
// what the patient said, not what the schedule computed.
function mrReportDate(ts) { return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }

function mrReportBlock(derivedRows) {
  const map = state.missReasons;
  if (!map || typeof map.get !== 'function' || !map.size) return '';
  const groups = new Map();
  const noteRows = [];
  (derivedRows || []).forEach((r) => {
    const medId = r[5];
    const t = r[2] ? new Date(r[2]).getTime() : 0;
    if (!medId || !t || !isFinite(t)) return;
    const rec = map.get(mrKey(medId, t));
    if (!rec || (!rec.reasonId && !rec.note)) return;
    const label = rec.reasonId ? mrLabelFor(rec.reasonId, rec.reasonLabel) : MR_NOTE_ONLY_LABEL;
    let g = groups.get(label);
    if (!g) { g = { n: 0, first: Infinity, last: 0, meds: [] }; groups.set(label, g); }
    g.n++;
    if (t < g.first) g.first = t;
    if (t > g.last) g.last = t;
    const medName = reportNameOf(medId);
    if (g.meds.indexOf(medName) < 0) g.meds.push(medName);
    if (rec.note) noteRows.push({ t: t, med: medName, win: rec.missWindow || String(r[3] || ''), note: rec.note });
  });
  if (!groups.size) return '';
  const who = escHtml(CONFIG.patientName);
  const rows = Array.from(groups.keys())
    .sort((a, b) => groups.get(b).n - groups.get(a).n || (a < b ? -1 : 1))
    .map((label) => {
      const g = groups.get(label);
      const span = (g.first === Infinity) ? '—' : (mrReportDate(g.first) + (g.last !== g.first ? ' – ' + mrReportDate(g.last) : ''));
      return '<tr><td>' + escHtml(label) + '</td><td class="num">' + g.n + '</td><td>' + escHtml(g.meds.sort().join(', ')) + '</td><td>' + escHtml(span) + '</td></tr>';
    }).join('');
  const notes = noteRows.sort((a, b) => a.t - b.t)
    .map((n) => '<tr><td>' + escHtml(mrReportDate(n.t)) + '</td><td>' + escHtml(n.med + (n.win ? ' · ' + n.win : '')) + '</td><td>' + escHtml(n.note) + '</td></tr>').join('');
  return '<h3>What ' + who + ' recorded about these</h3>' +
    '<div class="lead">Recording a reason is optional in the app, so a window with nothing against it means nothing was entered — not that a dose was refused. These are ' + who + '’s own words at the time and are not a clinical assessment.</div>' +
    '<table><thead><tr><th>Reason recorded</th><th class="num" style="width:70px">Windows</th><th style="width:32%">Medications</th><th style="width:150px">Dates</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    (notes ? '<h3>Notes ' + who + ' added</h3>' +
      '<table><thead><tr><th style="width:90px">Date</th><th style="width:32%">Medication</th><th>Note</th></tr></thead><tbody>' + notes + '</tbody></table>' : '');
}

function missedRow(e, i) {
  const saved = mrReasonFor(e);
  // The row splits in two: the original tap-to-log strip, byte-for-byte the same interaction it has
  // always been, and a quiet second line underneath it that is the ONLY entry point to this
  // feature.  It is not red, not badged and not counted, because a running total of unexplained
  // doses is a guilt meter.
  // The hook carries the identity, not a boolean: it is the one place the derived key is visible
  // from outside, which is what lets a test assert that a reason attached to THIS window and to no
  // other, and what makes a mis-attached reason findable in the DOM rather than only in Firestore.
  return h('div', { 'data-mr-missed-row': mrKeyOf(e), style: { borderTop: i > 0 ? '1px solid rgba(192,69,59,0.2)' : 'none', background: 'rgba(192,69,59,0.10)', borderLeft: '4px solid #C0453B' } },
    h('div', { onClick: () => logMissedDose(e), style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', cursor: 'pointer' } },
      h('div', { className: 'mono', style: { fontSize: '13px', color: '#C0453B', fontWeight: '700', minWidth: '66px' } }, fmtTime(e.ts)),
      h('div', { style: { flex: '1' } },
        h('div', { style: { fontSize: '15px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap', color: '#C0453B' } },
          nameOf(e.medId),
          h('span', { style: { fontSize: '10.5px', fontWeight: '800', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#fff', background: '#C0453B', borderRadius: '6px', padding: '2px 7px' } }, 'Missed')
        ),
        h('div', { style: { fontSize: '12.5px', color: '#C0453B', fontWeight: '600' } }, e.windowName + ' window closed — tap to log')
      ),
      h('span', { style: { flexShrink: '0', fontSize: '11.5px', fontWeight: '800', color: '#C0453B', opacity: '0.7' } }, '›')
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '0 14px 9px' } },
      saved ? h('span', { 'data-mr-row-reason': 'true', style: { display: 'inline-block', maxWidth: '100%', padding: '5px 11px', borderRadius: '999px', background: 'rgba(255,255,255,0.72)', border: '1px solid rgba(142,61,97,0.22)', color: '#6B4257', fontSize: '13px', fontWeight: '700' } }, saved.reasonId ? mrLabelFor(saved.reasonId, saved.reasonLabel) : MR_NOTE_ONLY_LABEL) : null,
      // stopPropagation, or this tap also fires the row's log flow underneath it.
      h('button', { 'data-mr-row-button': 'true', 'aria-label': (saved ? 'Change the reason recorded for ' : 'Add a reason for ') + nameOf(e.medId) + (e.windowName ? ' ' + e.windowName + ' window' : ''), onClick: (ev) => { ev.stopPropagation(); mrOpenSheet(e); }, style: { minHeight: '44px', padding: '0 13px', borderRadius: '11px', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(192,69,59,0.28)', color: '#A13830', fontSize: '13.5px', fontWeight: '700' } }, saved ? 'Change' : 'Add a reason')
    ),
    (saved && saved.note) ? h('div', { 'data-mr-row-note': 'true', style: { padding: '0 14px 10px', fontSize: '12.5px', lineHeight: '1.45', color: '#6B4257' } }, saved.note) : null
  );
}
"""


# =================================================================================================
# EDIT 4 — render(): mount the sheet
#
# Mounted before renderBottomNav() rather than next to renderTimeModal(), which calendar-patch.py
# anchors on.  Position in the tree is irrelevant: the overlay is position:fixed at z-index 62.
# =================================================================================================
A4 = "    renderBottomNav(),\n"

B4 = """    renderMissReasonSheet(),
    renderBottomNav(),
"""


# =================================================================================================
# EDIT 5 — the once-a-second repaint must not run underneath the open sheet
#
# Folded into the `isEditing` line ABOVE the guard, NOT into the `if` itself — calendar-patch.py
# rewrites that `if`, and going through this line lets the two patches apply in either order.
# =================================================================================================
A5 = "  const isEditing = activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA';\n"

B5 = """  // A repaint rebuilds the entire tree.  If one lands between the touchstart and the touchend of a
  // tap, the element under the finger is replaced and the click never fires — a chip that silently
  // does nothing roughly one tap in twelve.  The open reason sheet is folded into this existing
  // guard rather than into the `if` below it, so this patch and the calendar patch (which rewrites
  // that `if`) can be applied in either order.
  const isEditing = activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA' || !!state.missReasonSheet;
"""


# =================================================================================================
# EDIT 6 — printable report: the reasons subsection, inside the calculated missed-dose section
# =================================================================================================
A6 = """      '<table><thead><tr><th>Medication</th><th class="num" style="width:110px">Not logged</th><th style="width:190px">Date range</th></tr></thead><tbody>' + missedRows + '</tbody></table>' : '') +
"""

B6 = """      '<table><thead><tr><th>Medication</th><th class="num" style="width:110px">Not logged</th><th style="width:190px">Date range</th></tr></thead><tbody>' + missedRows + '</tbody></table>' +
      // Patient-recorded reasons, in their own labelled subsection UNDER the calculated table and
      // never mixed into it. "Three missed doses, all nausea" is worth a great deal to an
      // oncologist; three blank rows are worth nothing. It shares this section's suppression rule,
      // so it cannot appear in a report that has no logged entries behind it.
      mrReportBlock(derived) : '') +
"""


# =================================================================================================
# EDIT 7 — a toast clearing itself must not repaint underneath the open sheet
#
# setToast() schedules a repaint 4.5s later. render() rebuilds the entire tree, so a toast raised
# moments before the sheet was opened destroys the sheet under the patient's finger — the same
# failure mode the clock-tick guard exists to prevent, just rarer. Deferred, never cancelled.
# =================================================================================================
A7 = "  toastTimer = setTimeout(() => setState({ toast: null }), 4500);\n"

B7 = """  // A toast clears itself by repainting, and render() rebuilds the whole tree — so a toast raised
  // just before the reason sheet was opened can destroy that sheet mid-tap. The clear is DEFERRED,
  // not cancelled: it re-arms every 600ms and fires the moment the sheet closes, so the toast still
  // goes away on its own and no state is left stuck.
  toastTimer = setTimeout(function mrClearToast() {
    if (state.missReasonSheet) { toastTimer = setTimeout(mrClearToast, 600); return; }
    setState({ toast: null });
  }, 4500);
"""


EDITS = [
    ("1: subscribeEntries splits reason documents out of state.entries", A1, B1),
    ("2: state gains missReasons + missReasonSheet", A2, B2),
    ("3: the feature block, and missedRow() rebuilt around it", A3, B3),
    ("4: render() mounts the reason sheet", A4, B4),
    ("5: the clock tick does not repaint underneath the open sheet", A5, B5),
    ("6: printable report gains the reasons subsection", A6, B6),
    ("7: a clearing toast does not repaint underneath the open sheet", A7, B7),
]


def die(msg):
    sys.stderr.write("\n*** reason-patch.py REFUSED TO RUN ***\n" + msg.rstrip() + "\n\n")
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    path = os.path.join(args.repo, "index.html")
    if not os.path.isfile(path):
        die("No index.html at %s\nPass --repo /path/to/care-tracker." % path)

    with open(path, "r", encoding="utf-8") as fh:
        src = fh.read()

    digest = hashlib.md5(src.encode("utf-8")).hexdigest()
    pristine = digest == BASE_MD5

    if SENTINEL in src:
        print("reason-patch: already applied (sentinel %s present). Nothing to do." % SENTINEL)
        return 0

    if not pristine:
        print("reason-patch: note — index.html is not the pristine v43.3 base")
        print("  expected md5 %s" % BASE_MD5)
        print("  found    md5 %s" % digest)
        print("  (expected when another patch has already been applied; every anchor below is")
        print("   still required to match exactly, so a real mismatch still aborts.)")

    # --- collision check -------------------------------------------------------------------
    clashes = [tok for tok in NEW_IDENTIFIERS + NEW_HOOKS if tok in src]
    if clashes:
        die("These identifiers/hooks already exist in index.html and would collide:\n  "
            + "\n  ".join(clashes)
            + "\n\nDuplicate object keys and redeclared functions fail SILENTLY in JavaScript.\n"
              "Rename before proceeding.")

    # --- anchor check ----------------------------------------------------------------------
    problems = []
    for name, a, _b in EDITS:
        n = src.count(a)
        if n != 1:
            problems.append("EDIT %s\n    anchor occurs %d time(s), expected exactly 1\n    anchor: %s"
                            % (name, n, (a[:150] + ("..." if len(a) > 150 else "")).replace("\n", "\\n")))
    if problems:
        die("ANCHOR MISMATCH — nothing was written.\n\n" + "\n\n".join(problems)
            + "\n\nThe base file is not what this patch was written against, or another patch has\n"
              "already rewritten one of these lines. Do not force it.")

    if args.check:
        print("reason-patch: not applied; all %d anchors match. Safe to apply." % len(EDITS))
        return 0

    # --- apply -----------------------------------------------------------------------------
    out = src
    for name, a, b in EDITS:
        if out.count(a) != 1:
            die("EDIT %s stopped matching mid-run. Nothing written." % name)
        out = out.replace(a, b, 1)

    # --- post-conditions -------------------------------------------------------------------
    def post(cond, msg):
        if not cond:
            die("POST-CONDITION FAILED: " + msg + "\nNothing was written.")

    # Version-agnostic: pinning this to a literal made the patch fail as soon as the version was
    # legitimately bumped at ship time. Compare input to output instead.
    _v_in  = re.search(r"const APP_VERSION = '([^']*)';", src)
    _v_out = re.search(r"const APP_VERSION = '([^']*)';", out)
    post(bool(_v_in) and bool(_v_out), "APP_VERSION declaration not found. The base file has moved.")
    post(_v_in.group(1) == _v_out.group(1),
         "APP_VERSION was altered. This patch must never touch it.")
    post(src.count("APP_VERSION") == out.count("APP_VERSION"), "APP_VERSION occurrences changed.")
    post("const EXPORT_COLUMNS = ['Date', 'Time', 'Timestamp', 'Time of day', 'Type', 'Med ID', "
         "'Detail', 'Amount (mg)', 'Note', 'Source', 'Entry ID', 'Logged at'];" in out,
         "EXPORT_COLUMNS changed. The CSV format is regression-tested for byte equality.")
    post("return (state.entries || []).concat(state.chemoDates || []);" in out,
         "allExportEntries() changed. Reason documents must never reach the CSV.")
    post("updateDoc(" not in out, "a call to updateDoc appeared. The Firestore rules are append-only.")
    post(out.count("deleteDoc(") == src.count("deleteDoc("),
         "a new deleteDoc call appeared. Reasons are superseded by appending, never deleted.")
    post(out.count("await removeEntryDB") == src.count("await removeEntryDB"),
         "a new delete appeared. Reasons are superseded by appending, never deleted.")
    post("onInput: (ev) => { if (state.missReasonSheet) state.missReasonSheet.note = ev.target.value; }" in out,
         "the note field's onInput is not the non-setState form.")

    # No onInput handler anywhere may call setState: it rebuilds the tree and destroys the field
    # being typed into. Checked over the WHOLE file, so this also catches a regression elsewhere.
    idx = out.find("onInput:")
    while idx >= 0:
        if "setState" in out[idx:idx + 160]:
            die("POST-CONDITION FAILED: an onInput handler calls setState (offset %d).\n"
                "Nothing was written." % idx)
        idx = out.find("onInput:", idx + 1)

    # THE h() TRAP: h() does el.setAttribute(k, v), so `disabled: null` renders disabled="null" and
    # disables the control. Conditional attributes must be spread, never passed as null.
    for lineno, line in enumerate(out.split("\n"), 1):
        # "disabled: " with the space is the JS object-literal form; CSS's "button:disabled:active"
        # and prose in comments are excluded by the space and the // test respectively.
        if "disabled: " not in line or line.strip().startswith("//"):
            continue
        for frag in line.split("disabled: ")[1:]:
            val = frag.lstrip()
            ok = val.startswith("'disabled'") or val.startswith('"disabled"') or val.startswith("true")
            post(ok, "line %d passes a conditional/falsy value to the disabled attribute — h() does\n"
                     "    setAttribute, so null and false both render as a string and DISABLE the control.\n"
                     "    Spread the attribute instead: ...(cond ? { disabled: 'disabled' } : {})\n"
                     "    %s" % (lineno, line.strip()[:160]))

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(out)

    sw = os.path.join(args.repo, "sw.js")
    print("reason-patch: applied %d edits to %s" % (len(EDITS), path))
    print("  APP_VERSION untouched, sw.js untouched (%s not opened)" % sw)
    print("  new md5: %s" % hashlib.md5(out.encode("utf-8")).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
