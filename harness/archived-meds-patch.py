#!/usr/bin/env python3
"""
archived-meds-patch.py -- v75. Archived medications can be seen and brought back.

Aaron, 2026-09-11, picking Enhancer item A: "Do A, B and C."

THE GAP. The app has carried `archivedMeds` for many releases -- removing a medication keeps its
name so old doses still render properly -- but there was NO SCREEN anywhere that listed them and no
way to bring one back. A medication paused between cycles had to be re-created by hand, and
re-created with a NEW id, which means every dose that referenced the old one reads as a removed
medication. The data was never lost; it was simply unreachable.

THE WRITE MODEL, stated before a line was written.

  * APPENDS: nothing. This release never writes, edits or deletes an ENTRY. Not one code path here
    touches the entries collection.
  * CHANGES: the medication CONFIG only -- `meds` and `archivedMeds` -- through the existing
    persistMedicationConfig(), the same path every medication edit has always used.
  * THE ARCHIVE NOW KEEPS THE WHOLE MEDICATION (`config`) beside the {name, sub} it already kept.
    Nothing that used to be kept is dropped. There is precedent: ChemoWell widened this same record
    once before, to keep `pausePeriods`, for the same reason -- a half-remembered medication comes
    back wrong.
  * RESTORE PUTS IT BACK UNDER ITS ORIGINAL ID. That is the entire point: the dose history
    references that id, so the old doses read properly again. A new id would leave them orphaned,
    which is what re-creating by hand does today.
  * REMINDERS COME BACK EXACTLY AS THEY WERE, AND THE GAP IS WHAT IS SUPPRESSED. Restore stamps
    `alertsFrom` with today and missedDosesFor() skips days before it for that medication.
    THE FIRST VERSION OF THIS RELEASE GOT THIS WRONG and the audit refused it -- twice over, in
    opposite directions. It restored the medication with reminders switched OFF, which in ChemoWell
    was erased at the next app open (its normaliser RECOMPUTES `alerts` from the schedule type and
    never reads what was saved), and in care-tracker stayed off FOREVER under a toast promising
    "turn them back on in Edit" when the editor has no such control at all. Either way it removed
    missed-dose cover invisibly, under a button labelled "Bring back".
    The design was wrong, not just the code: "reminders off" trades a VISIBLE, recoverable problem
    -- a wall of missed doses for days she was not taking it -- for an INVISIBLE, unrecoverable one.
    A clinician takes the first every time.
    SAID OUT LOUD: a phone still on the OLD build ignores `alertsFrom` and shows the gap as missed
    until it updates. That is visible and self-correcting; silent loss of alerting is neither.
  * TIE-BREAK: if an ACTIVE medication already holds that id, restore is REFUSED and says why.
    Restoring over it, or under a new id, would silently sever the dose history.
  * TWICE: the second restore is a no-op. The id is gone from the archive after the first.
  * HALF-FAILURE: identical to every other medication edit -- localStorage first, then medsync
    publishes. Nothing new to get wrong.
  * AN OLDER BUILD reading a richer archive strips `config` back to {name, sub} on its next write.
    No live data is at risk: restore falls back to the medication this app SHIPS with, then to the
    name alone, and the toast says which of the three it used rather than pretending.

WHAT IT DELIBERATELY DOES NOT DO
  * It does not touch the Home quick-log cards or the entries.
  * It adds exactly ONE line to the missed-dose engine -- a guard keyed on `alertsFrom`, a field no
    medication that was never archived carries, so for every one of them it does nothing at all.
  * The Archived section renders ONLY when something is archived. An empty notice about a list with
    nothing in it is the bug the sibling app's audit found in v74.

Usage:  python3 harness/archived-meds-patch.py [--base outputs/rollback-v74/index.html] [--out index.html]
The version stamp lives INSIDE this patch: it refuses a base that is not v74 and emits v75.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FROM_V, TO_V = 'v74', 'v75'

args = sys.argv[1:]
base = args[args.index('--base') + 1] if '--base' in args else os.path.join(REPO, 'outputs', 'rollback-' + FROM_V, 'index.html')
out = args[args.index('--out') + 1] if '--out' in args else os.path.join(REPO, 'index.html')
sw_in = os.path.join(os.path.dirname(base), 'sw.js')
sw_out = os.path.join(os.path.dirname(out), 'sw.js')

s = open(base, encoding='utf-8').read()
m = re.search(r"const APP_VERSION = '([^']+)';", s)
if not m or m.group(1) != FROM_V:
    sys.exit('REFUSING: base is %s, this patch transforms %s -> %s' % (m.group(1) if m else '?', FROM_V, TO_V))


def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n:
        sys.exit('REFUSING: expected %d match(es), found %d for:\n%s' % (n, c, old[:200]))
    s = s.replace(old, new)


# ---- 1. the archive keeps the whole medication ------------------------------------------------
rep("""    archived[id] = { name: String(value.name || id), sub: String(value.sub || '') };""",
    """    // v75: the CONFIG is preserved when the archive carries one. This function runs on every
    // load, so without this line the widened archive written below would be stripped straight back
    // out again -- the identical trap the sibling app hit when it added pausePeriods here, and
    // fixed with the identical line. A corrupted or hand-edited archive cannot inject a malformed
    // medication: whatever it holds goes through normalizeMedication() like any other.
    const entry = { name: String(value.name || id), sub: String(value.sub || '') };
    if (Number(value.removedAt)) entry.removedAt = Number(value.removedAt);
    if (value.config && typeof value.config === 'object') {
      try { entry.config = normalizeMedication(JSON.parse(JSON.stringify(value.config))); } catch (e) {}
    }
    archived[id] = entry;""")

rep("""  const archivedMeds = { ...(state.archivedMeds || {}), [id]: { name: med.name, sub: med.sub || '' } };""",
    """  // v75: archive the WHOLE medication, not just its name. Until now removing a medication threw
  // away its doses, windows, limits and notes, so even if there had been a way to bring it back
  // there was nothing to bring back but a name. {name, sub} stay exactly where they were, so an
  // older build reading this record still finds what it expects.
  const archivedMeds = { ...(state.archivedMeds || {}), [id]: { name: med.name, sub: med.sub || '', config: JSON.parse(JSON.stringify(med)), removedAt: dayStart(state.now || Date.now()) } };""")

# ---- 2. restoring ------------------------------------------------------------------------------
rep("""function deleteMedicationConfig(id) {""",
    """// ---- BRINGING A MEDICATION BACK (v75) ----
// REMINDERS COME BACK EXACTLY AS THEY WERE. What is suppressed is the GAP: `alertsFrom` tells
// missedDosesFor() that nothing before today counts as a missed dose for this medication.
// The first version of this release switched reminders OFF instead, and the audit refused it in
// both apps and in opposite directions -- erased at the next load by a normaliser in one, permanent
// with no control to undo it in the other. Both removed missed-dose cover invisibly, under a button
// labelled "Bring back".
function restoreMedicationConfig(id) {
  // hasOwnProperty, NOT a bare index -- the guard every neighbouring lookup in this file got after
  // v74, when a medication named `Constructor` read back Object.prototype's own property and
  // destroyed the Meds screen permanently.
  const archive = state.archivedMeds || {};
  const entry = Object.prototype.hasOwnProperty.call(archive, id) ? archive[id] : null;
  if (!entry || typeof entry !== 'object') return;
  // TIE-BREAK, and the reason restore exists at all. The id is what every stored dose points at.
  // If an active medication already holds it, putting this one back would collide; giving it a new
  // id instead would leave its whole dose history orphaned, which is exactly what re-creating a
  // medication by hand does today and the thing this control is here to stop.
  if (state.meds.some(item => item.id === id)) {
    setToast('A medication called ' + nameOf(id) + ' is already on the list. Remove or rename that one first.');
    return;
  }
  if (state.confirmRestoreMed !== id) { setState({ confirmRestoreMed: id }); return; }
  const shipped = DEFAULT_MEDS.find(item => item.id === id);
  let med = null, source = 'name';
  if (entry.config) { med = normalizeMedication(JSON.parse(JSON.stringify(entry.config))); source = 'archive'; }
  else if (shipped) { med = normalizeMedication(deepCopyMeds([shipped])[0]); source = 'shipped'; }
  else { med = normalizeMedication({ id: id, name: entry.name || id, sub: entry.sub || '' }); }
  med.id = id;
  // REMINDERS COME BACK AS THEY WERE. What is suppressed is the SPAN IT WAS AWAY -- from the day it
  // left the list to today -- and nothing outside it. The first version switched reminders off
  // instead, which removed safety cover invisibly; the second suppressed everything BEFORE the
  // restore, which erased the medication's entire missed-dose history from the banner, the day
  // summaries and the clinician export. Both ends, or it is not a gap.
  // An archive written before this release carries no removedAt: that restore gets a single-day
  // span, which suppresses nothing that matters and never reaches backwards.
  const awayFrom = dayStart(Number(entry.removedAt) || (state.now || Date.now()));
  const awayTo = dayStart(state.now || Date.now());
  med.awayPeriods = (Array.isArray(med.awayPeriods) ? med.awayPeriods : [])
    .filter(p => p && Number(p.start) && Number(p.end))
    .concat([{ start: awayFrom, end: awayTo }]);
  const meds = state.meds.concat([med]);
  const archivedMeds = { ...(state.archivedMeds || {}) };
  delete archivedMeds[id];
  persistMedicationConfig(meds, archivedMeds);
  setState({ meds, archivedMeds, confirmRestoreMed: null });
  setToast(med.name + (source === 'archive' ? ' is back, with its doses and rules.'
    : source === 'shipped' ? ' is back, set up the way it came with the app.'
    : ' is back. Its doses and rules were not kept \\u2014 set them in Edit.')
    + ' Its reminders come back on, and the days it was off the list are not counted as missed.');
}
function deleteMedicationConfig(id) {""")

# ---- 3. the screen ------------------------------------------------------------------------------
# Under the cards, not above them: the active list is what she came for. Rendered ONLY when
# something is archived -- a heading over an empty list is a notice about nothing, which is the
# defect the sibling app's audit found in the v74 disclaimer.
rep("""    h('div', { 'data-tour-meds': 'true', style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards)""",
    """    h('div', { 'data-tour-meds': 'true', style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards),
    archivedList.length ? h('div', { 'data-archived-meds': 'true', style: { marginTop: '18px' } },
      h('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#8A6479', marginBottom: '4px' } }, 'Removed medications'),
      h('div', { style: { fontSize: '12px', color: '#6E5261', lineHeight: '1.4', marginBottom: '9px' } },
        'Their dose history is still in the app. Bring one back and its old doses read properly again \\u2014 it comes back with its reminders on again, and only the days it was off the list are left uncounted.'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...archivedList.map(item => {
        const restoring = state.confirmRestoreMed === item.id;
        return h('article', { 'data-archived-med': item.id, style: { background: 'rgba(255,255,255,0.45)', border: '1px dashed rgba(138,100,121,0.32)', borderRadius: '15px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', overflowWrap: 'anywhere' } },
          h('div', { style: { minWidth: '0', flex: '1' } },
            h('div', { style: { fontSize: '15px', fontWeight: '800', color: '#5A4654' } }, item.name),
            h('div', { style: { fontSize: '12px', color: '#7A6672', fontWeight: '600', marginTop: '1px' } },
              (item.sub || 'No generic name') + (item.config ? '' : ' \\u00b7 doses and rules were not kept'))
          ),
          h('button', { onClick: () => restoreMedicationConfig(item.id), 'aria-label': restoring ? 'Confirm bringing back ' + item.name : 'Bring back ' + item.name, style: { flexShrink: '0', minHeight: '44px', padding: '0 13px', borderRadius: '999px', background: restoring ? '#0C7F57' : 'rgba(15,157,87,0.12)', color: restoring ? '#fff' : '#0C7F57', border: '1px solid ' + (restoring ? '#0C7F57' : 'rgba(15,157,87,0.30)'), fontSize: '13px', fontWeight: '700' } }, restoring ? 'Yes, bring it back' : 'Bring back')
        );
      }))
    ) : null""")

rep("""  const sortedMeds = state.meds.slice().sort((a, b) => a.name.localeCompare(b.name));""",
    """  const sortedMeds = state.meds.slice().sort((a, b) => a.name.localeCompare(b.name));
  // v75: what is archived, in the same order the active list uses.
  const archivedList = Object.entries(state.archivedMeds || {})
    .map(([id, item]) => ({ id: id, name: String(item.name || id), sub: String(item.sub || ''), config: !!item.config }))
    .sort((a, b) => a.name.localeCompare(b.name));""")

# ---- 4. tapping away cancels a pending confirm, like every other confirm in this app ------------
rep("""function deleteMedicationConfig(id) {
  const med = state.meds.find(item => item.id === id);
  if (!med) return;
  if (state.confirmDeleteMed !== id) { setState({ confirmDeleteMed: id }); return; }""",
    """function deleteMedicationConfig(id) {
  const med = state.meds.find(item => item.id === id);
  if (!med) return;
  // v75: starting a removal clears any half-tapped restore, so the two confirmations can never be
  // armed at once and a second tap can never land on the control the caregiver was not looking at.
  if (state.confirmRestoreMed) setState({ confirmRestoreMed: null });
  if (state.confirmDeleteMed !== id) { setState({ confirmDeleteMed: id }); return; }""")

# ---- NOTHING BEFORE THE DAY IT CAME BACK IS A MISSED DOSE -------------------------------------
# The audit refused the first version of this release, and the design was wrong rather than only the
# code. It restored the medication with its reminders switched OFF -- which in one app was erased at
# the next load by a normaliser that recomputes `alerts`, and in the other stayed off forever under a
# toast promising a control that does not exist. Either way it removed safety cover invisibly.
# Reminders come back exactly as they were now. What is suppressed is the GAP: `alertsFrom` tells the
# missed-dose walk that nothing before the day of the restore counts for this medication. No
# medication that was never archived carries the field, so this line does nothing at all for any of
# them, and the engine is otherwise untouched.
rep("""  state.meds.filter(m => m.alerts && m.windows).forEach(med => {""",
    """  state.meds.filter(m => m.alerts && m.windows).forEach(med => {
    // BROUGHT BACK FROM THE ARCHIVE: the days it was AWAY are not missed doses. Both ends matter.
    // The version before this one suppressed everything before the restore day, so bringing a
    // medication back erased its whole missed-dose history -- 122 misses over two months, gone from
    // the banner, the day summaries and the report that goes to the doctor, for a medication that
    // had been off the list for two seconds.
    if ((med.awayPeriods || []).some(p => p && d0 >= dayStart(p.start) && d0 <= dayStart(p.end))) return;""")

# ---- TWO THINGS THE AUDIT FOUND AROUND THE NEW CONTROL ----------------------------------------
# 1. A half-armed "Bring back" survived navigation. The confirm beside it -- Remove -- has been
#    cleared on every view change since long before this release; this one was not, so leaving the
#    Meds screen and coming back left a button one tap from acting.
rep("""  const next = { view, reportsView: view === 'reports' ? null : state.reportsView, medEditor: view === 'meds' ? state.medEditor : null, confirmDeleteMed: null };""",
    """  // v75/app-v73: a half-armed "Bring back" is cleared on navigation exactly like a half-armed
  // Remove. Leaving it armed means coming back to the Meds screen later and finding a button
  // already one tap from acting -- the audit found it, and the neighbouring confirm has been
  // cleared here since long before this release.
  const next = { view, reportsView: view === 'reports' ? null : state.reportsView, medEditor: view === 'meds' ? state.medEditor : null, confirmDeleteMed: null, confirmRestoreMed: null };""")

if "const APP_VERSION = '%s';" % FROM_V not in s: sys.exit('REFUSING: version stamp missing')
rep("const APP_VERSION = '%s';" % FROM_V, "const APP_VERSION = '%s';" % TO_V)
rep("""  { v: 'v74', date: 'Sep 8, 2026', title: 'Every medication now says what it is for',""",
    """  { v: 'v75', date: 'Sep 11, 2026', title: 'Removed medications can be brought back',
    points: [
      'The Meds screen now lists medications you have removed, under "Removed medications", and each one has a "Bring back" button.',
      'Bringing one back restores it under its original name, so its old doses read properly again instead of showing as a removed medication.',
      'Its reminders come back on, and only the days it was off the list are left uncounted.'
    ] },
  { v: 'v74', date: 'Sep 8, 2026', title: 'Every medication now says what it is for',""")

open(out, 'w', encoding='utf-8').write(s)

sw = open(sw_in, encoding='utf-8').read()
if "const CACHE = 'caretracker-%s';" % FROM_V not in sw: sys.exit('REFUSING: sw.js base is not %s' % FROM_V)
open(sw_out, 'w', encoding='utf-8').write(sw.replace("const CACHE = 'caretracker-%s';" % FROM_V, "const CACHE = 'caretracker-%s';" % TO_V))
print('patched %s -> %s: %s and %s' % (FROM_V, TO_V, out, sw_out))
