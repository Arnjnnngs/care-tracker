#!/usr/bin/env python3
"""
daily-supersede-patch.py -- v72. Re-answering a day, or correcting a symptom, is an APPEND.

Aaron, 2026-09-07: "do all" -- v72 first on the standing queue, from Enhancer pass 03.

THE DEFECT, in three places, all the same shape as the one fixed in v52, v69 and v70:

  * submitBowelMovement / submitBowelBannerUpdate / submitAppetite did `removeEntryDB(existing.id)`
    and then appended. The Firestore rules refuse a delete by document AGE (STATUS.md, v52), and the
    banner's Update targets whichever day is driving the "issue active" streak -- routinely several
    days old. So the delete was refused, the new answer was added beside the old one, and BOTH
    documents carried the same `ts` (that day's noon). The reader then broke the tie with `>=` on
    `ts`, which with identical stamps means whichever document Firestore returned last. She could
    change the answer, see it change, and have it change back on the next load.
  * The symptom edit did the same delete-then-add from the Symptoms tab, which offers Edit at any
    age. Past 48 hours the delete was refused and the edit either failed outright or duplicated.
  * `removeSymptom()` was dead code; the tab's Remove went through the generic History delete, which
    the rules also refuse past 48 hours while the button stayed on screen.

THE FIX, fourth application of the model this app already ships for paracentesis, appointments,
weight and cycle markers:

  * A bowel or appetite answer is grouped by DAY. The newest `loggedAt || ts` wins; `cancelled:true`
    is a tombstone that reads as "unanswered" again. Every write stamps
    `loggedAt = Math.max(Date.now(), stamp(previous winner) + 1)` -- strictly newer than whatever it
    supersedes, so a clock-skewed phone cannot make the old answer keep winning.
  * A symptom is grouped by `symptomId`, falling back to the document's own id. Same rule.
  * Every legacy document has no `loggedAt`, so its `ts` stands in. Legacy same-day duplicates
    written before v72 therefore STILL tie exactly as they did -- that cannot be repaired
    retroactively and is said out loud in the release notes -- but the first v72 answer settles the
    day for good, because its stamp is a wall-clock time and theirs is that day's noon.
  * Rows raw, numbers resolved (the v69 lesson): History and the CSV keep every document and label
    the ones that no longer stand; every figure and every screen reads the resolved set.

NOTHING IN THIS PATCH CALLS removeEntryDB. pm.py's delete ratchet pins the remaining shapes.

Usage:  python3 harness/daily-supersede-patch.py [--base outputs/rollback-v71/index.html] [--out index.html]
The version stamp lives INSIDE this patch: it refuses a base that is not v71 and emits v72.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FROM_V, TO_V = 'v71', 'v72'

args = sys.argv[1:]
base = args[args.index('--base') + 1] if '--base' in args else os.path.join(REPO, 'outputs', 'rollback-' + FROM_V, 'index.html')
out = args[args.index('--out') + 1] if '--out' in args else os.path.join(REPO, 'index.html')
sw_in = os.path.join(os.path.dirname(base), 'sw.js') if '--base' in args else os.path.join(REPO, 'outputs', 'rollback-' + FROM_V, 'sw.js')
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

# ---- 1. the daily-answer resolver replaces both `>=`-on-ts day maps -------------------------
rep("""function bowelMovementEntriesByDay() {
  const map = new Map();
  state.entries.filter(e => e.medId === 'bowel_movement').forEach(e => {
    const d0 = dayStart(e.ts);
    const existing = map.get(d0);
    if (!existing || e.ts >= existing.ts) map.set(d0, e);
  });
  return map;
}
""", """// ---- DAILY ANSWERS (v72) ----
// One answer per day for bowel_movement and appetite. Same shape as paracentesisResolved(),
// weightResolved() and cycleResolved(): the newest document per group wins and cancelled:true is a
// tombstone -- here the group is the DAY. Before v72 the day map broke ties with `>=` on ts, and
// every answer for a day carries the same ts (that day's noon), so two documents for one day meant
// whichever Firestore returned last. A legacy document has no loggedAt and its ts stands in; any
// v72 write is stamped strictly newer than the winner it supersedes (dailyNextStamp), so the first
// new answer settles a day for good and nothing is ever deleted.
function dailyStamp(e) { return (e && (e.loggedAt || e.ts)) || 0; }
function dailySupersedes(a, b) { return dailyStamp(a) >= dailyStamp(b); }   // >= keeps v71's tie-break for legacy duplicates: the later document wins
function dailyNextStamp(prev) { return Math.max(Date.now(), dailyStamp(prev) + 1); }
function dailyEntriesByDay(medId) {
  const map = new Map();
  (state.entries || []).forEach(e => {
    if (!e || e.medId !== medId) return;
    if (!(typeof e.ts === 'number' && isFinite(e.ts) && e.ts > 0)) return;
    const d0 = dayStart(e.ts);
    const existing = map.get(d0);
    if (!existing || dailySupersedes(e, existing)) map.set(d0, e);
  });
  map.forEach((e, d0) => { if (e.cancelled) map.delete(d0); });   // a removed answer reads as unanswered
  return map;
}
// Is this exact document out-ranked by a newer one for its day? LABELLING only (History, CSV) --
// a figure never asks this, it reads the resolved map.
function dailySuperseded(e) {
  if (!e || (e.medId !== 'bowel_movement' && e.medId !== 'appetite') || e.cancelled) return false;
  if (!(typeof e.ts === 'number' && isFinite(e.ts) && e.ts > 0)) return false;
  const d0 = dayStart(e.ts), mine = dailyStamp(e);
  return (state.entries || []).some(d => d && d.medId === e.medId && String(d.id) !== String(e.id)
    && typeof d.ts === 'number' && dayStart(d.ts) === d0 && dailyStamp(d) > mine);
}
async function removeDailyAnswer(e) {
  const live = dailyEntriesByDay(e.medId).get(dayStart(e.ts));
  await addEntryDB({ medId: e.medId, value: e.value, dose: (e.medId === 'bowel_movement' ? 'Bowel movement' : 'Appetite') + ' removed',
                     mg: 0, ts: e.ts, cancelled: true, loggedAt: dailyNextStamp(live || e) });
}
function bowelMovementEntriesByDay() { return dailyEntriesByDay('bowel_movement'); }
""")

rep("""function appetiteEntriesByDay() {
  const map = new Map();
  state.entries.filter(e => e.medId === 'appetite').forEach(e => {
    const d0 = dayStart(e.ts);
    const existing = map.get(d0);
    if (!existing || e.ts >= existing.ts) map.set(d0, e);
  });
  return map;
}
""", """function appetiteEntriesByDay() { return dailyEntriesByDay('appetite'); }
""")

# ---- 2. every write is stamped; no submit deletes first --------------------------------------
rep("""  await addEntryDB({ medId: 'bowel_movement', value, dose: BOWEL_MOVEMENT_LABELS[value] || value, mg: 0, ts: dayStartTs + 12 * 3600000 });""",
    """  await addEntryDB({ medId: 'bowel_movement', value, dose: BOWEL_MOVEMENT_LABELS[value] || value, mg: 0, ts: dayStartTs + 12 * 3600000,
                     loggedAt: dailyNextStamp(bowelMovementFor(dayStartTs)) });""")
rep("""// Overwrites (rather than appends to) a given day's retrospective answer, so there's always at
// most one bowel_movement entry per day — keeps the "last daily answer wins" derivation above
// unambiguous even when the user changes their mind and hits Update.
""", """// APPENDS a new answer for the day; the resolver above keeps the newest one. v51 through v71
// deleted the old answer first, which the Firestore rules refuse past 48 hours, and the banner's
// Update below targets a day that is routinely older than that.
""")
rep("""    const existing = bowelMovementFor(dayStartTs);
    if (existing) await removeEntryDB(existing.id);
    await logBowelMovement(v, dayStartTs);""", """    await logBowelMovement(v, dayStartTs);""")
rep("""    const existing = bowelMovementFor(day);
    if (existing) await removeEntryDB(existing.id);
    await logBowelMovement(v, day);""", """    await logBowelMovement(v, day);""")
rep("""  const entry = { medId: 'appetite', value, dose: APPETITE_LABELS[value] || value, mg: 0, ts: dayStartTs + 12 * 3600000 };""",
    """  const entry = { medId: 'appetite', value, dose: APPETITE_LABELS[value] || value, mg: 0, ts: dayStartTs + 12 * 3600000,
                  loggedAt: dailyNextStamp(appetiteFor(dayStartTs)) };""")
rep("""    const existing = appetiteFor(dayStartTs);
    if (existing) await removeEntryDB(existing.id);
    await logAppetite(v, dayStartTs, state.appetiteNoteInput);""", """    await logAppetite(v, dayStartTs, state.appetiteNoteInput);""")
rep("""its own Reports tab rather than a Home card. At most one appetite entry per day — Update
// overwrites (rather than appends to) that day's answer, same pattern as Bowel Movement.""",
    """its own Reports tab rather than a Home card. One answer per day: a new answer is APPENDED and
// the newest wins (dailyEntriesByDay), same as Bowel Movement -- nothing is deleted.""")

# ---- 3. symptoms: grouped by symptomId, edit and remove are appends --------------------------
rep("""function symptomEntries() { return state.entries.filter(e => e.medId && e.medId.indexOf('symptom_') === 0).sort((a, b) => b.ts - a.ts); }
async function logSymptom(type, ts, opts) {
  const entry = { medId: 'symptom_' + type, symptomType: type, ts, note: (opts && opts.note) || '', dose: null, mg: 0 };
  await addEntryDB(entry);
}
// Opens the shared time modal in 'symptom' mode. Pass an existing entry to edit it in place
// (edits are implemented as remove-old + add-new, same pattern used elsewhere in the app).
function openSymptomModal(entry) {
  setState({ timeModal: entry
    ? { type: 'symptom', editId: entry.id, symptomType: entry.symptomType, freq: entry.freq || null, note: entry.note || '', timeValue: toLocalISO(entry.ts) }
    : { type: 'symptom', symptomType: '', freq: null, note: '', timeValue: nowLocalISO() }
  });
}""", """// ---- SYMPTOM CORRECTIONS (v72) ----
// Grouped by symptomId (falling back to the document's own id, so every legacy symptom is its own
// group and is untouched until corrected). Newest loggedAt||ts wins; cancelled:true is a tombstone.
// Before v72 an edit was delete-then-add, and the Symptoms tab offers Edit at any age while the
// rules refuse the delete past 48 hours.
function symptomKey(d) { return (typeof d.symptomId === 'string' && d.symptomId) ? d.symptomId : ('doc:' + String(d.id)); }
function symptomResolvedFrom(source) {
  const byGroup = new Map();
  for (const d of (source || [])) {
    if (!d || !d.medId || d.medId.indexOf('symptom_') !== 0) continue;
    const key = symptomKey(d);
    const prev = byGroup.get(key);
    if (!prev || dailySupersedes(d, prev)) byGroup.set(key, d);
  }
  const live = [];
  byGroup.forEach((x, key) => { if (x.cancelled) return; live.push(Object.assign({}, x, { symptomId: key })); });
  return live.sort((a, b) => b.ts - a.ts);
}
function symptomEntries() { return symptomResolvedFrom(state.entries); }
// Labelling only, never a figure -- see dailySuperseded().
function symptomSuperseded(e) {
  if (!e || !e.medId || e.medId.indexOf('symptom_') !== 0 || e.cancelled) return false;
  const key = symptomKey(e), mine = dailyStamp(e);
  return (state.entries || []).some(d => d && d.medId && d.medId.indexOf('symptom_') === 0
    && String(d.id) !== String(e.id) && symptomKey(d) === key && dailyStamp(d) > mine);
}
async function logSymptom(type, ts, opts) {
  const entry = { medId: 'symptom_' + type, symptomType: type, ts, note: (opts && opts.note) || '', dose: null, mg: 0, loggedAt: Date.now() };
  if (opts && opts.symptomId) {
    // A correction: same group, stamped strictly newer than what it supersedes.
    entry.symptomId = opts.symptomId;
    entry.loggedAt = Math.max(Date.now(), (opts.prevStamp || 0) + 1);
  }
  await addEntryDB(entry);
}
// Opens the shared time modal in 'symptom' mode. Pass a RESOLVED entry (from symptomEntries()) to
// edit it: the edit appends a superseding document, it does not delete.
function openSymptomModal(entry) {
  setState({ timeModal: entry
    ? { type: 'symptom', editId: entry.symptomId || symptomKey(entry), prevStamp: dailyStamp(entry), symptomType: entry.symptomType, freq: entry.freq || null, note: entry.note || '', timeValue: toLocalISO(entry.ts) }
    : { type: 'symptom', symptomType: '', freq: null, note: '', timeValue: nowLocalISO() }
  });
}""")
rep("""async function removeSymptom(id) { await removeEntryDB(id); }""",
    """// A tombstone, so it works at any age and can never resurrect an earlier version of the group.
async function removeSymptom(sid) {
  const x = symptomEntries().find(y => y.symptomId === sid);
  if (!x) return;
  await addEntryDB({ medId: x.medId, symptomType: x.symptomType, ts: x.ts, note: x.note || '', dose: null, mg: 0,
                     symptomId: sid, cancelled: true, loggedAt: dailyNextStamp(x) });
}""")
rep("""    const editId = m.editId;
    setState({ timeModal: null });
    if (editId) await removeEntryDB(editId);
    await logSymptom(m.symptomType, ts, { note: (m.note || '').trim() });""",
    """    const editId = m.editId;
    setState({ timeModal: null });
    await logSymptom(m.symptomType, ts, { note: (m.note || '').trim(), symptomId: editId || null, prevStamp: m.prevStamp || 0 });""")

# ---- 4. the Remove button routes append-only records to their tombstone -----------------------
rep("""function removeBtn(e) {
  if (!bypasses48h(e.medId) && state.now - e.ts > 48 * 3600000) return null; // entries older than 48h are permanent history
""", """// Append-only record types remove by TOMBSTONE, never by delete: a delete is refused by the rules
// past 48 hours, and deleting the newest document of a corrected group would resurrect the one it
// superseded. Everything else (doses, temperatures) keeps the plain delete inside its 48-hour window.
async function removeEntryFor(e) {
  if (e.medId === 'bowel_movement' || e.medId === 'appetite') return removeDailyAnswer(e);
  if (e.medId && e.medId.indexOf('symptom_') === 0) return removeSymptom(symptomKey(e));
  return removeEntry(e.id);
}
function removeBtn(e) {
  if (!bypasses48h(e.medId) && state.now - e.ts > 48 * 3600000) return null; // entries older than 48h are permanent history
  if (e.cancelled || dailySuperseded(e) || symptomSuperseded(e)) return null; // a row that no longer stands has nothing to remove
""")
rep("""      h('button', { onClick: () => { setState({ confirmRemove: null }); removeEntry(e.id); }, style: { color: '#fff', background: '#C0453B'""",
    """      h('button', { onClick: () => { setState({ confirmRemove: null }); removeEntryFor(e); }, style: { color: '#fff', background: '#C0453B'""")

# ---- 5. rows raw, numbers resolved: labels in the CSV and History, an honest doses count -------
rep("""  if (e.medId === 'bowel_movement') return BOWEL_MOVEMENT_LABELS[e.value] || e.dose || e.value || '';
  if (e.medId === 'appetite') return APPETITE_LABELS[e.value] || e.dose || e.value || '';""",
    """  if (e.medId === 'bowel_movement') return e.cancelled ? 'Removed' : ((BOWEL_MOVEMENT_LABELS[e.value] || e.dose || e.value || '') + (dailySuperseded(e) ? ' (superseded)' : ''));
  if (e.medId === 'appetite') return e.cancelled ? 'Removed' : ((APPETITE_LABELS[e.value] || e.dose || e.value || '') + (dailySuperseded(e) ? ' (superseded)' : ''));""")
rep("""  if (e.missed) d += (d ? ', ' : '') + 'not logged' + (e.windowName ? ' (' + e.windowName + ' window)' : '');
  return d;
}""", """  if (e.missed) d += (d ? ', ' : '') + 'not logged' + (e.windowName ? ' (' + e.windowName + ' window)' : '');
  if (e.medId && e.medId.indexOf('symptom_') === 0) {
    if (e.cancelled) return 'Removed';
    if (symptomSuperseded(e)) d += (d ? ' ' : '') + '(superseded)';
  }
  return d;
}""")
rep("""    const doses = items.filter(e => e.medId !== 'temp' && e.medId !== 'weight' && e.medId !== 'paracentesis' && e.medId !== 'cycle_start' && e.medId !== 'cycle_end' && !e.missed).length;""",
    """    // A COUNT MUST BE TRUE. A bowel answer, an appetite answer or a symptom note is not a dose,
    // and a tombstone or a superseded document is not anything.
    const doses = items.filter(e => e.medId !== 'temp' && e.medId !== 'weight' && e.medId !== 'paracentesis' && e.medId !== 'cycle_start' && e.medId !== 'cycle_end'
      && e.medId !== 'bowel_movement' && e.medId !== 'appetite' && !(e.medId && e.medId.indexOf('symptom_') === 0) && !e.cancelled && !e.missed).length;""")
rep("""            rows.push(h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderTop: newGroup ? 'none' : '1px solid rgba(212,104,138,0.08)' } },
              h('div', { className: 'mono', style: { fontSize: '13px', color: '#8A6479', minWidth: '66px' } }, fmtTime(e.ts)),
              h('div', { style: { flex: '1' } },
                h('div', { style: { fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' } },
                  nameOf(e.medId),""",
    """            const stale = e.cancelled ? 'Removed' : ((dailySuperseded(e) || symptomSuperseded(e)) ? 'Superseded' : null);
            rows.push(h('div', { 'data-history-row': String(e.id), style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderTop: newGroup ? 'none' : '1px solid rgba(212,104,138,0.08)', opacity: stale ? '0.72' : '1' } },
              h('div', { className: 'mono', style: { fontSize: '13px', color: '#8A6479', minWidth: '66px' } }, fmtTime(e.ts)),
              h('div', { style: { flex: '1' } },
                h('div', { style: { fontSize: '15px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' } },
                  nameOf(e.medId),
                  stale ? h('span', { 'data-history-stale': stale.toLowerCase(), style: { fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#7D6974', background: 'rgba(125,105,116,0.10)', border: '1px solid rgba(125,105,116,0.28)', borderRadius: '6px', padding: '2px 6px' } }, stale) : null,""")

# ---- 5a. the printable oncologist report lists symptoms RESOLVED (v69's lesson: a list a clinician
# reads is a figure, not an audit trail; the CSV keeps every document, this table keeps the truth)
rep("""  const symptoms = allExportEntries().filter(e => e.medId && e.medId.indexOf('symptom_') === 0)
    .sort((a, b) => usableTs(a.ts) - usableTs(b.ts))""",
    """  const symptoms = symptomResolvedFrom(allExportEntries())
    .sort((a, b) => usableTs(a.ts) - usableTs(b.ts))""")

# ---- 5b. data- hooks so the suite counts ROWS, never text (Rule 5) ----------------------------
def rep_in(section_start, old, new):
    global s
    i = s.index(section_start)
    j = s.index('\n}\n', i) + 3
    seg = s[i:j]
    if seg.count(old) != 1: sys.exit('REFUSING: hook anchor not unique inside ' + section_start)
    s = s[:i] + seg.replace(old, new) + s[j:]
ROW = "...entries.map(e => h('div', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '13px 15px', display: 'flex', alignItems: 'flex-start', gap: '12px'"
rep_in('function renderAppetite(now) {', ROW, "...entries.map(e => h('div', { 'data-appetite-row': String(dayStart(e.ts)), 'data-answer': String(e.value), style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '13px 15px', display: 'flex', alignItems: 'flex-start', gap: '12px'")
rep_in('function renderBowelMovementReport(now) {', ROW, "...entries.map(e => h('div', { 'data-bowel-row': String(dayStart(e.ts)), 'data-answer': String(e.value), style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '13px 15px', display: 'flex', alignItems: 'flex-start', gap: '12px'")
rep_in('function symptomRow(e) {', "return h('div', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.16)'", "return h('div', { 'data-symptom-row': e.symptomId || String(e.id), style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.16)'")

# ---- 6. version and the note she reads ----------------------------------------------------------
rep("const APP_VERSION = '%s';" % FROM_V, "const APP_VERSION = '%s';" % TO_V)
rep("""  { v: 'v71', date: 'Sep 7, 2026', title: 'The screen stays put behind the menu',""",
    """  { v: 'v72', date: 'Sep 7, 2026', title: 'A changed answer now stays changed',
    points: [
      'Updating a bowel movement answer from the Bowel Issue Active banner now sticks, even when the day it is about is more than two days old. Before, it could fail with a message blaming your connection, and the old answer stayed.',
      'Editing or removing a symptom works at any age now. Nothing is deleted \\u2014 the correction is recorded on top of the old one, the same way a corrected weight or period date already works.',
      'In History, an answer that was replaced is marked Superseded and one that was removed is marked Removed, and the day\\u2019s dose count no longer counts them as doses.'
    ] },
  { v: 'v71', date: 'Sep 7, 2026', title: 'The screen stays put behind the menu',""")

# nothing in the finished file may still delete a daily answer or a symptom
for bad in ("removeEntryDB(existing.id)", "removeEntryDB(editId)"):
    if bad in s: sys.exit('REFUSING: %s survived the patch' % bad)
if "const APP_VERSION = '%s';" % TO_V not in s: sys.exit('REFUSING: version stamp missing')

open(out, 'w', encoding='utf-8').write(s)

sw = open(sw_in, encoding='utf-8').read()
if "const CACHE = 'caretracker-%s';" % FROM_V not in sw: sys.exit('REFUSING: sw.js base is not %s' % FROM_V)
open(sw_out, 'w', encoding='utf-8').write(sw.replace("const CACHE = 'caretracker-%s';" % FROM_V, "const CACHE = 'caretracker-%s';" % TO_V))
print('patched %s -> %s: %s and %s' % (FROM_V, TO_V, out, sw_out))
