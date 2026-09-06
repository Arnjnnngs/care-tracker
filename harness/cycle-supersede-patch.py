#!/usr/bin/env python3
"""
cycle-supersede-patch.py -- v70. Moving a period date is an APPEND, not a delete.

Aaron, 2026-09-06: "fix period things that needs fixed."

THE DEFECT, live since v68. Moving a period's start or end did add-then-removeEntryDB. STATUS.md's
v52 section states the Firestore rules refuse a delete by document AGE with no medId exemption --
BYPASS_48H_IDS only shows or hides a button, it cannot grant a delete the rules refuse. So on any
marker older than two days -- which is every period a caregiver would notice was on the wrong day --
the move ADDED the corrected date and left the original in place. Two starts, one period duplicated
or merged, and the failure toast told her to "move it again to the date you want", which fails the
same way. An instruction that cannot succeed is worse than no instruction.

THE FIX is the one v69 proved on weight, third application of a model this app has shipped twice
before (paracentesis v52, appointments, weight v69):

  * Markers are grouped by `markerId`, falling back to the document's own id. The newest
    loggedAt||ts per group wins. cancelled:true is a tombstone.
  * A move APPENDS a document carrying the same markerId and a newer loggedAt. Nothing is deleted,
    so it works at any age and cannot half-succeed.
  * Every marker already on Brandi's phone has no markerId, so each is its own group and
    cycleResolved() returns them untouched. This CANNOT disturb existing periods.

WHY cycleEntries() IS THE SEAM. cycleActive(), cyclePeriods() and daysSinceCycleStart() all read
through it, so resolving there fixes every consumer at once instead of five call sites that can
drift apart. lastCycleStart() went its own way through entriesFor() and is redirected here.

UC20 IS UNCHANGED AND THAT MATTERS. cyclePeriods()'s rule -- a second cycle_start while one is open
UPDATES the open period rather than orphaning a permanently-"Active" duplicate -- operates on
whatever cycleEntries() returns. With legacy data the resolver is the identity function, so the rule
sees exactly what it saw before. What changes is that a MOVE no longer presents itself to that rule
as a second start, because the superseded document is gone from the list.

v66 shipped a Remove on this screen that destroyed a whole period on one unconfirmed tap. It stays
withdrawn. This patch adds no destructive control.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'index.html')
s = open(TARGET, encoding='utf-8').read()
orig_len = len(s)


def sub(old, new, why):
    """Replace exactly once. A missed anchor must fail loudly, not silently no-op."""
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit('ANCHOR %s matched %d times (need exactly 1): %s' % (why, n, old[:90]))
    s = s.replace(old, new)


# ---------------------------------------------------------------- the resolver
sub("""function cycleEntries() { return state.entries.filter(e => e.medId === 'cycle_start' || e.medId === 'cycle_end').sort((a, b) => a.ts - b.ts); }""",
    """// ---- CYCLE MARKERS: corrected by appending, never by deleting (v70) ----
// Same shape as paracentesisResolved() and weightResolved(). See this patch's header for why a
// delete cannot be relied on. A Map, not a plain object: markerId comes out of the database and on
// a plain object an id of 'constructor' reads back a truthy INHERITED value, which would silently
// drop the first record carrying it.
function markerSupersedes(a, b) { return (a.loggedAt || a.ts || 0) > (b.loggedAt || b.ts || 0); }
function cycleResolved() {
  const byGroup = new Map();
  for (const d of (state.entries || [])) {
    if (!d || (d.medId !== 'cycle_start' && d.medId !== 'cycle_end')) continue;
    const key = (typeof d.markerId === 'string' && d.markerId) ? d.markerId : ('doc:' + String(d.id));
    const prev = byGroup.get(key);
    if (!prev || markerSupersedes(d, prev)) byGroup.set(key, d);
  }
  const live = [];
  byGroup.forEach((m, key) => {
    if (m.cancelled) return;                                        // tombstone
    if (!(typeof m.ts === 'number' && isFinite(m.ts) && m.ts > 0)) return;
    live.push(Object.assign({}, m, { markerId: key }));
  });
  return live.sort((a, b) => a.ts - b.ts);
}
// THE SEAM. cycleActive(), cyclePeriods() and daysSinceCycleStart() all read through this one
// function, so resolving here fixes every consumer at once rather than five call sites that drift.
function cycleEntries() { return cycleResolved(); }
// Is this exact document superseded by a newer one in its group? Labelling only -- the CSV keeps
// every document, because it is the audit trail, but an unlabelled duplicate is not an audit trail.
function markerSuperseded(e) {
  if (!e || (e.medId !== 'cycle_start' && e.medId !== 'cycle_end') || e.cancelled) return false;
  const keyOf = (d) => (typeof d.markerId === 'string' && d.markerId) ? d.markerId : ('doc:' + String(d.id));
  const key = keyOf(e);
  const mine = (e.loggedAt || e.ts || 0);
  return (state.entries || []).some(d => d && (d.medId === 'cycle_start' || d.medId === 'cycle_end')
    && String(d.id) !== String(e.id) && keyOf(d) === key && (d.loggedAt || d.ts || 0) > mine);
}""",
    'cycle-resolver')

# lastCycleStart() bypassed cycleEntries() through entriesFor(), so a moved start would have been
# read from the ORIGINAL document here while every other screen used the correction -- the exact
# "reader left behind" class of bug the v69 delta audit blocked that release on.
sub("""function lastCycleStart() {
  const es = entriesFor('cycle_start');
  return es.length ? es.reduce((a, b) => a.ts > b.ts ? a : b) : null;
}""",
    """function lastCycleStart() {
  const es = cycleResolved().filter(e => e.medId === 'cycle_start');
  return es.length ? es.reduce((a, b) => a.ts > b.ts ? a : b) : null;
}""",
    'lastCycleStart-resolved')

# The period now carries the GROUP id, so a second move edits the same group rather than starting a
# new one. Before this, moving a start twice would have written two independent corrections.
sub("""      if (cur && cur.end === null) { cur.start = e.ts; cur.startId = e.id; }
      else { cur = { start: e.ts, startId: e.id, end: null, endId: null }; periods.push(cur); }
    }
    else if (e.medId === 'cycle_end' && cur && cur.end === null) { cur.end = e.ts; cur.endId = e.id; }""",
    """      if (cur && cur.end === null) { cur.start = e.ts; cur.startId = e.markerId; }
      else { cur = { start: e.ts, startId: e.markerId, end: null, endId: null }; periods.push(cur); }
    }
    else if (e.medId === 'cycle_end' && cur && cur.end === null) { cur.end = e.ts; cur.endId = e.markerId; }""",
    'periods-carry-group-ids')

# ---------------------------------------------------------------- the move itself
sub("""function cycleEditOpen(entryId, medId, label, ts) {
  setState({ timeModal: { type: 'marker', editId: entryId, medId, label, timeValue: toLocalISO(ts) } });
}""",
    """function cycleEditOpen(markerId, medId, label, ts) {
  // prevStamp travels with the modal so the correction is stamped strictly newer than the document
  // it supersedes. A legacy marker carries no loggedAt, so its ts stands in -- v67 fixed exactly
  // this for paracentesis, where an edit silently no-opped on a record with no loggedAt while the
  // toast said "updated".
  const m = cycleResolved().find(x => x.markerId === markerId);
  setState({ timeModal: { type: 'marker', editId: markerId, medId, label, timeValue: toLocalISO(ts),
                          prevStamp: m ? (m.loggedAt || m.ts || 0) : 0 } });
}""",
    'cycleEditOpen-group')

sub("""  } else if (m.type === 'marker') {
    const editId = m.editId;
    setState({ timeModal: null });""",
    """  } else if (m.type === 'marker') {
    const editId = m.editId;
    setState({ timeModal: null });
    // ONE WRITE. The add-then-remove dance is gone with the delete it was protecting: a move now
    // APPENDS a document that supersedes the old date, so it works at any age and cannot leave the
    // record half-corrected. If the write fails, addEntryDB's own red banner says so and the
    // success toast never fires.
    const markerEntry = { medId: m.medId, dose: null, mg: 0, ts };
    if (editId) {
      markerEntry.markerId = editId;
      markerEntry.loggedAt = Math.max(Date.now(), (m.prevStamp || 0) + 1);
    }
    await addEntryDB(markerEntry);
    setToast(m.label + (editId ? ' moved to ' : ' logged for ') + new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + fmtTime(ts));
    return;""",
    'marker-append')

# The old body is now unreachable and must not be left behind for someone to "restore a use for".
sub("""    // ADD FIRST, THEN REMOVE -- the order is the whole safety argument. If the remove fails the
    // caregiver is left with a visible duplicate she can delete from Cycle History. Reverse it and
    // a failed add silently destroys the marker with nothing on screen to say so. For a medical
    // record the survivable failure is the duplicate.
    await addEntryDB({ medId: m.medId, dose: null, mg: 0, ts });
    if (editId) {
      try {
        await removeEntryDB(editId);
      } catch (err) {
        console.warn('[marker] moved but old entry not removed:', err);
        // NOT "remove it from Cycle History". That instruction was only correct when the date moved
        // EARLIER: move a start LATER and p.startId points at the new entry, so following it would
        // delete the correction and silently restore the original date. There is also no Remove on
        // that screen any more. Say what happened and what to do that actually works.
        setToast(m.label + ' moved, but the old date is still recorded — move it again to the date you want');
        return;
      }
    }
    setToast(m.label + (editId ? ' moved to ' : ' logged for ') + new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + fmtTime(ts));
""", "", 'drop-dead-marker-branch')

# ---------------------------------------------------------------- the audit trail stays legible
sub("""  if (e.medId === 'chemo_date') return e.dose || 'Chemo date';""",
    """  if (e.medId === 'cycle_start' || e.medId === 'cycle_end') {
    // The spreadsheet keeps every document -- that is the audit trail -- but a moved date would
    // otherwise print as two identical-looking marker rows with nothing saying which one stands.
    return (e.medId === 'cycle_start' ? 'Period Start' : 'Period End') + (markerSuperseded(e) ? ' (moved — superseded)' : '');
  }
  if (e.medId === 'chemo_date') return e.dose || 'Chemo date';""",
    'export-marker-superseded')

# ---------------------------------------------------------------------------------------------
# THE RELEASE STAMP. Rule 0: a release must be reproducible from the repo alone. This patch applies
# to outputs/rollback-v69/index.html, and stamping the version here rather than by hand afterwards
# is what makes that true -- a hand bump once left a rebuild stamped with the old version.
sub("""const APP_VERSION = 'v69';""", """const APP_VERSION = 'v70';""", 'app-version')

sub("""const CHANGELOG = [
""", """const CHANGELOG = [
  { v: 'v70', date: 'Sep 6, 2026', title: 'Moving a period date now actually works',
    points: [
      'Moving a period start or end only worked if the date was less than two days old. Older than that, the app said it had moved the date and quietly kept the old one as well. It works at any age now.',
      'Nothing is deleted when you move a date \\u2014 the correction is recorded on top of the old one, the same way a corrected paracentesis or weight already worked.'
    ] },
""", 'changelog-v70')

open(TARGET, 'w', encoding='utf-8').write(s)
print('cycle-supersede-patch applied: %d -> %d bytes' % (orig_len, len(s)))
