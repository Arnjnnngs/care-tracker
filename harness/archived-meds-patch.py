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
  * RESTORE ALWAYS COMES BACK WITH REMINDERS OFF, whatever the archive says, and the app says so on
    screen. THIS IS THE TRAP THIS RELEASE EXISTS TO AVOID. missedDosesFor() walks every day since
    MISSED_TRACK_SINCE and asks `state.meds.filter(m => m.alerts && m.windows)`. Restore a tracked
    medication with alerts on and every dose window during the weeks it was archived is instantly
    flagged as missed -- the exact flood that ending a hospital stay produced once already, and the
    reason per-window suppression was built. Reminders off means the gap is silent, and the
    caregiver turns them back on in Edit when she is ready.
  * TIE-BREAK: if an ACTIVE medication already holds that id, restore is REFUSED and says why.
    Restoring over it, or under a new id, would silently sever the dose history.
  * TWICE: the second restore is a no-op. The id is gone from the archive after the first.
  * HALF-FAILURE: identical to every other medication edit -- localStorage first, then medsync
    publishes. Nothing new to get wrong.
  * AN OLDER BUILD reading a richer archive strips `config` back to {name, sub} on its next write.
    No live data is at risk: restore falls back to the medication this app SHIPS with, then to the
    name alone, and the toast says which of the three it used rather than pretending.

WHAT IT DELIBERATELY DOES NOT DO
  * It does not restore reminders. See above -- that is the whole safety argument.
  * It does not touch the Home quick-log cards, the entries, or the missed-dose engine. Not one
    line of missedDosesFor() changes.
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
    if (value.config && typeof value.config === 'object') {
      try { entry.config = normalizeMedication(JSON.parse(JSON.stringify(value.config))); } catch (e) {}
    }
    archived[id] = entry;""")

rep("""  const archivedMeds = { ...(state.archivedMeds || {}), [id]: { name: med.name, sub: med.sub || '' } };""",
    """  // v75: archive the WHOLE medication, not just its name. Until now removing a medication threw
  // away its doses, windows, limits and notes, so even if there had been a way to bring it back
  // there was nothing to bring back but a name. {name, sub} stay exactly where they were, so an
  // older build reading this record still finds what it expects.
  const archivedMeds = { ...(state.archivedMeds || {}), [id]: { name: med.name, sub: med.sub || '', config: JSON.parse(JSON.stringify(med)) } };""")

# ---- 2. restoring ------------------------------------------------------------------------------
rep("""function deleteMedicationConfig(id) {""",
    """// ---- BRINGING A MEDICATION BACK (v75) ----
// REMINDERS COME BACK OFF, ALWAYS, WHATEVER THE ARCHIVE SAYS. missedDosesFor() walks every day
// since MISSED_TRACK_SINCE and reads `state.meds.filter(m => m.alerts && m.windows)`. Restore a
// tracked medication with alerts on and EVERY dose window during the weeks it was archived is
// flagged as missed the moment the screen redraws -- a wall of red for days nobody was ever meant
// to take it. That is the same flood ending a hospital stay produced once already. The medication
// comes back silent and the caregiver turns reminders on again in Edit when she wants them.
function restoreMedicationConfig(id) {
  const entry = (state.archivedMeds || {})[id];
  if (!entry) return;
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
  med.alerts = false;
  const meds = state.meds.concat([med]);
  const archivedMeds = { ...(state.archivedMeds || {}) };
  delete archivedMeds[id];
  persistMedicationConfig(meds, archivedMeds);
  setState({ meds, archivedMeds, confirmRestoreMed: null });
  setToast(med.name + (source === 'archive' ? ' is back, with its doses and rules.'
    : source === 'shipped' ? ' is back, set up the way it came with the app.'
    : ' is back. Its doses and rules were not kept \\u2014 set them in Edit.')
    + ' Reminders are off so the days it was away are not counted as missed.');
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
        'Their dose history is still in the app. Bring one back and its old doses read properly again \\u2014 it returns with reminders off, so the days it was away are not counted as missed.'),
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

if "const APP_VERSION = '%s';" % FROM_V not in s: sys.exit('REFUSING: version stamp missing')
rep("const APP_VERSION = '%s';" % FROM_V, "const APP_VERSION = '%s';" % TO_V)
rep("""  { v: 'v74', date: 'Sep 8, 2026', title: 'Every medication now says what it is for',""",
    """  { v: 'v75', date: 'Sep 11, 2026', title: 'Removed medications can be brought back',
    points: [
      'The Meds screen now lists medications you have removed, under "Removed medications", and each one has a "Bring back" button.',
      'Bringing one back restores it under its original name, so its old doses read properly again instead of showing as a removed medication.',
      'It comes back with reminders OFF, so the days it was away are not counted as missed doses. Turn them back on in Edit when you are ready.'
    ] },
  { v: 'v74', date: 'Sep 8, 2026', title: 'Every medication now says what it is for',""")

open(out, 'w', encoding='utf-8').write(s)

sw = open(sw_in, encoding='utf-8').read()
if "const CACHE = 'caretracker-%s';" % FROM_V not in sw: sys.exit('REFUSING: sw.js base is not %s' % FROM_V)
open(sw_out, 'w', encoding='utf-8').write(sw.replace("const CACHE = 'caretracker-%s';" % FROM_V, "const CACHE = 'caretracker-%s';" % TO_V))
print('patched %s -> %s: %s and %s' % (FROM_V, TO_V, out, sw_out))
