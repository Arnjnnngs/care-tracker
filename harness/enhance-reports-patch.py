#!/usr/bin/env python3
"""
enhance-reports-patch.py — v66. Make the report screens able to do the whole job.

Aaron, 2026-09-06: "there isn't a way to add a para from the reports screen. there also a way to
edit cycles. these kind of things needs to be checked bc it's what makes sense for stuff like this.
someone should have suggested this fix from the team."

The Enhancer pass (outputs/ENHANCER-PASS-01.md) confirmed both and found a third. Before this patch:

    screen         add   add-for-another-day   edit   remove
    In-Patient     yes   yes                   yes    yes      <- the model
    Calendar       yes   yes                   yes    yes      <- the model
    Cycle          yes   yes                   NO     NO
    Paracentesis   NO    NO                    NO     yes      <- deletes but cannot create
    Weight         NO    NO                    NO     via History

This patch brings Paracentesis, Weight and Cycle up to the In-Patient standard.

WHY THE EDIT MECHANICS DIFFER BETWEEN THE TWO RECORD TYPES, deliberately:

  * PARACENTESIS records are append-only and grouped by `paraId`; paracentesisResolved() keeps the
    record with the newest `loggedAt` per group and treats `cancelled: true` as a tombstone. So an
    edit is simply ANOTHER record carrying the SAME paraId and a newer loggedAt. Nothing is
    deleted, nothing can be lost, and it works past the 48-hour delete window that the Firestore
    rules enforce. Same shape as the ChemoWell v70 treatment-date removal.

  * CYCLE markers are bare entries with no group id, so an edit is add-then-remove. THE ORDER IS
    LOAD-BEARING: add first. If the remove then fails, the caregiver is left with a visible
    duplicate she can delete. Reverse the order and a failed add silently destroys the marker. For
    a medical record the survivable failure is the duplicate, every time.

    Removing a cycle marker is permitted at any age -- 'cycle_start'/'cycle_end' are both in
    BYPASS_48H_IDS -- so this does not fight the security rules.

A Remove control is added to Cycle History rows as part of this. That is slightly beyond the four
items Aaron listed, and it is here for a specific reason: the edit's failure path tells the
caregiver to delete the leftover duplicate, and before this patch there was nowhere to do that. A
message that names an action the app does not offer is the kind of thing this release exists to fix.
SPELLING: this app says LITER, not litre. harness/para-test.mjs enforces one spelling across the
whole file and went red on the first run of this patch, which had introduced five British ones in
new UI strings and comments. ChemoWell says liter too -- an earlier version of this note claimed
the two apps deliberately differed, which was invented and wrong: ChemoWell has 75 "liter" and one
"litres", and that one is a Help SEARCH ALIAS so the British spelling still finds the answer.
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


# ---------------------------------------------------------------- 1. cyclePeriods carries ids
# Editing a period needs the underlying entry id. The pairing logic is NOT touched -- it encodes a
# QA finding (UC20: two back-to-back Period Starts leaving an un-closeable duplicate) and only the
# id bookkeeping is added alongside it.
sub("""      if (cur && cur.end === null) { cur.start = e.ts; }
      else { cur = { start: e.ts, end: null }; periods.push(cur); }""",
    """      if (cur && cur.end === null) { cur.start = e.ts; cur.startId = e.id; }
      else { cur = { start: e.ts, startId: e.id, end: null, endId: null }; periods.push(cur); }""",
    'cyclePeriods-start-ids')

sub("""    else if (e.medId === 'cycle_end' && cur && cur.end === null) { cur.end = e.ts; }""",
    """    else if (e.medId === 'cycle_end' && cur && cur.end === null) { cur.end = e.ts; cur.endId = e.id; }""",
    'cyclePeriods-end-id')


# ---------------------------------------------------------------- 2. modal titles say Edit
sub("""  } else if (m.type === 'marker') {
    title = 'Log ' + m.label;""",
    """  } else if (m.type === 'marker') {
    title = (m.editId ? 'Edit ' : 'Log ') + m.label;""",
    'title-marker')

sub("""  } else if (m.type === 'para') {
    title = 'Log Paracentesis · ' + paraFmtLiters(m.paraValue) + ' L';""",
    """  } else if (m.type === 'para') {
    // When editing, the liters are editable BELOW, so putting them in the heading too would show a
    // stale number the moment the caregiver typed. The heading states the action; the field states
    // the value.
    title = m.editId ? 'Edit Paracentesis' : ('Log Paracentesis · ' + paraFmtLiters(m.paraValue) + ' L');""",
    'title-para')


# ---------------------------------------------------------------- 3. liters field when editing
sub("""      h('div', null,
        h('div', { style: { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' } }, 'Date & Time'),""",
    """      // EDITING A PARACENTESIS CHANGES THE VOLUME AS WELL AS THE DATE. A wrong figure (4.5 typed
      // as 45) is at least as likely as a wrong day, and before this the only route to fixing one
      // was Remove-and-re-enter. 16px is the iOS floor pm.py enforces -- anything smaller makes
      // Safari zoom the page on focus.
      (m.type === 'para' && m.editId) ? h('div', { style: { marginBottom: '16px' } },
        h('div', { style: { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' } }, 'Liters drained'),
        h('input', { 'data-para-edit-liters': 'true', type: 'number', inputMode: 'decimal', step: '0.1', min: '0', max: String(PARA_MAX_LITERS),
          value: String(m.paraValue), onInput: (e) => { const n = parseFloat(e.target.value); state.timeModal.paraValue = isNaN(n) ? null : n; },
          className: 'mono', style: { width: '100%', minHeight: '52px', border: '1px solid rgba(212,104,138,0.2)', borderRadius: '13px', padding: '0 14px', fontSize: '16px', background: 'rgba(255,255,255,0.75)', color: '#3D2B3A' } })
      ) : null,
      h('div', null,
        h('div', { style: { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' } }, 'Date & Time'),""",
    'modal-liters-field')


# ---------------------------------------------------------------- 4. para branch handles an edit
sub("""  } else if (m.type === 'para') {
    const v = m.paraValue;
    const entry = { medId: PARA_MED_ID, paraId: paraNewId(), liters: v, dose: paraFmtLiters(v) + ' L',
                    mg: 0, ts, loggedAt: Date.now() };
    setState({ paraInput: '', timeModal: null });
    await addEntryDB(entry);
    setToast('Paracentesis ' + paraFmtLiters(v) + ' L logged at ' + fmtTime(ts));""",
    """  } else if (m.type === 'para') {
    const v = m.paraValue;
    // The liters are typed into the modal when editing, so they are re-validated HERE rather than
    // trusted from the caller. logParacentesis() validates its own input on the way in; that check
    // cannot cover a value the caregiver changed afterwards.
    if (!(typeof v === 'number' && isFinite(v) && v > 0 && v <= PARA_MAX_LITERS)) {
      setToast('Enter the liters drained (up to ' + PARA_MAX_LITERS + ')');
      return;
    }
    // AN EDIT IS A NEW RECORD CARRYING THE SAME paraId, NOT A DELETE AND RE-ADD.
    // paracentesisResolved() keeps the newest loggedAt per paraId, so this supersedes the old one
    // while leaving it in the record. Nothing can be lost if the write fails, and it works past
    // the 48-hour delete window the Firestore rules enforce.
    const editing = !!m.editId;
    // loggedAt MUST BEAT THE RECORD IT REPLACES, not merely be "now". paraSupersedes() falls back to
    // `ts` when loggedAt is absent, so a legacy record dated in the future -- or one written on a
    // device with a fast clock -- would keep winning and the edit would silently do nothing while
    // the toast said "updated". Found by the Zero Day Auditor.
    const prevRec = editing ? paracentesisResolved().find(x => x.paraId === m.editId) : null;
    const prevStamp = prevRec ? (prevRec.loggedAt || prevRec.ts || 0) : 0;
    const entry = { medId: PARA_MED_ID, paraId: editing ? m.editId : paraNewId(), liters: v, dose: paraFmtLiters(v) + ' L',
                    mg: 0, ts, loggedAt: Math.max(Date.now(), prevStamp + 1) };
    setState({ paraInput: '', timeModal: null });
    await addEntryDB(entry);
    setToast('Paracentesis ' + paraFmtLiters(v) + ' L ' + (editing ? 'updated' : 'logged') + ' at ' + fmtTime(ts));""",
    'confirm-para-edit')


# ---------------------------------------------------------------- 5. marker branch handles an edit
sub("""  } else if (m.type === 'marker') {
    setState({ timeModal: null });
    await addEntryDB({ medId: m.medId, dose: null, mg: 0, ts });
    setToast(m.label + ' logged for ' + new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + fmtTime(ts));""",
    """  } else if (m.type === 'marker') {
    const editId = m.editId;
    setState({ timeModal: null });
    // ADD FIRST, THEN REMOVE -- the order is the whole safety argument. If the remove fails the
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
    setToast(m.label + (editId ? ' moved to ' : ' logged for ') + new Date(ts).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + fmtTime(ts));""",
    'confirm-marker-edit')


# ---------------------------------------------------------------- 6. openers + shared add-row
sub("""async function removeParacentesis(paraId) {""",
    """// Opens the same time modal the Home card uses, carrying the existing paraId so the write
// supersedes rather than duplicates.
function paraEditOpen(p) {
  setState({ timeModal: { type: 'para', editId: p.paraId, paraValue: p.liters, timeValue: toLocalISO(p.ts) } });
}
// Moves one end of a period to another day. medId decides which marker is being moved.
function cycleEditOpen(entryId, medId, label, ts) {
  setState({ timeModal: { type: 'marker', editId: entryId, medId, label, timeValue: toLocalISO(ts) } });
}
// The add row that was missing from Paracentesis and Weight. One helper, so the two screens cannot
// drift apart the way they did in the first place. It deliberately reuses the SAME onLog handlers
// as the Home cards -- logParacentesis() and logWeight() -- so there is one code path per record
// type, not a second one that has to be kept in step.
function reportAddRow(opts) {
  return h('section', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '13px 14px' } },
    h('div', { style: { fontSize: '11.5px', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#8A6479', marginBottom: '8px' } }, opts.label),
    h('div', { style: { display: 'flex', gap: '8px' } },
      h('input', Object.assign({
        type: 'number', inputMode: 'decimal', step: '0.1', min: '0',
        placeholder: opts.placeholder, value: opts.value, onInput: opts.onInput, className: 'mono',
        style: { flex: '1', minWidth: '0', minHeight: '44px', border: '1px solid rgba(212,104,138,0.18)', borderRadius: '12px', padding: '0 13px', fontSize: '16px', background: 'rgba(255,255,255,0.7)', color: '#3D2B3A' }
      }, opts.max ? { max: String(opts.max) } : {}, opts.hook ? { [opts.hook]: 'true' } : {})),
      h('button', { onClick: opts.onLog, style: { flexShrink: '0', minHeight: '44px', padding: '0 18px', borderRadius: '12px', background: '#AA5375', color: '#fff', fontSize: '14px', fontWeight: '700' } }, 'Log')
    )
  );
}

async function removeParacentesis(paraId) {""",
    'openers')


# ---------------------------------------------------------------- 7. Paracentesis report
sub("""      'No paracentesis procedures logged yet.\\nLog the liters drained from the card on Today.')];""",
    """      'No paracentesis procedures logged yet.')];""",
    'para-empty-text')

sub("""function renderParacentesis(now) {
  const list = paracentesisResolved();
  if (!list.length) {
    return [""",
    """function renderParacentesis(now) {
  const list = paracentesisResolved();
  // THE ADD ROW COMES FIRST AND IS PRESENT WHETHER OR NOT ANYTHING IS LOGGED. The empty state used
  // to read "Log the liters drained from the card on Today" -- the app telling the caregiver this
  // screen could not do its own job.
  const addRow = reportAddRow({
    label: 'Log a paracentesis', placeholder: 'Liters', max: PARA_MAX_LITERS, hook: 'data-para-report-add',
    value: state.paraInput, onInput: (e) => { state.paraInput = e.target.value; }, onLog: logParacentesis
  });
  if (!list.length) {
    return [addRow,""",
    'para-add-row')

# REPLACE THE WHOLE EXPRESSION, not just its opening. The first version of this rewrote only the
# `: h('button', ...` prefix into `: h('div', ..., h('button', ...`, wrapping Remove in a container
# it never closed -- the button's own ")" closed the div and the argument list ran off the end.
# index.html stopped parsing and pm.py blocked the release. Splicing a prefix onto an expression
# whose tail you are not also rewriting is how you sever a chain.
REMOVE_BTN = ": h('button', { onClick: () => setState({ confirmRemovePara: p.paraId }), style: { flexShrink: '0', color: '#8E3D61', fontSize: '12.5px', fontWeight: '700', padding: '8px 10px', borderRadius: '9px', background: 'rgba(170,83,117,0.10)' } }, 'Remove')"
sub("        " + REMOVE_BTN,
    """        : h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', flexShrink: '0' } },
            h('button', { 'data-para-edit': 'true', onClick: () => paraEditOpen(p), style: { color: '#8E3D61', fontSize: '12.5px', fontWeight: '700', padding: '8px 10px', borderRadius: '9px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Edit'),
            // Six-second arm, then it disarms itself -- the same behaviour History's Remove has
            // always had. v68 shipped this control without it, so a red Delete stayed armed on a
            // procedure indefinitely. Fixed here rather than filed.
            h('button', { onClick: () => { setState({ confirmRemovePara: p.paraId }); setTimeout(() => { if (state.confirmRemovePara === p.paraId) setState({ confirmRemovePara: null }); }, 6000); }, style: { flexShrink: '0', color: '#8E3D61', fontSize: '12.5px', fontWeight: '700', padding: '8px 10px', borderRadius: '9px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Remove')
          )""",
    'para-edit-button')

sub("""  return [stats, note, rows];
}

function renderWeightTrend(now) {""",
    """  return [addRow, stats, note, rows];
}

function renderWeightTrend(now) {""",
    'para-return')


# ---------------------------------------------------------------- 8. Cycle history: edit + remove
# THE CONTROLS GO BELOW THE DATE, NOT BESIDE IT. Three buttons in the same row as the date left
# "8/27/2026 - 8/31/2026 (5 days)" wrapping across FOUR lines on a 360px phone -- and at 320px it is
# worse. overflow-scan reported 0 overflowing elements for that, because nothing overflowed: it was
# merely unreadable. Only opening the screenshot showed it. Third release running that the picture
# caught what the number could not.
sub("""      ...periods.map(p => h('div', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '15px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 24px rgba(180,130,150,0.10), inset 0 1px 0 rgba(255,255,255,0.7)' } },
        h('span', { style: { flexShrink: '0', width: '10px', height: '10px', borderRadius: '50%', background: p.end === null ? '#AA5375' : '#9B5B8A', display: 'inline-block' } }),
        h('div', { style: { fontSize: '15px', fontWeight: '700', color: '#3D2B3A' } }, fmtCyclePeriod(p))
      ))""",
    """      ...periods.map(p => h('div', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '16px', padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 4px 24px rgba(180,130,150,0.10), inset 0 1px 0 rgba(255,255,255,0.7)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
          h('span', { style: { flexShrink: '0', width: '10px', height: '10px', borderRadius: '50%', background: p.end === null ? '#AA5375' : '#9B5B8A', display: 'inline-block' } }),
          h('div', { style: { fontSize: '15px', fontWeight: '700', color: '#3D2B3A' } }, fmtCyclePeriod(p))
        ),
        // Each END of the period is moved separately, because that is how a mistake actually
        // happens -- the start was logged a day late, or the end was tapped early. One "edit the
        // period" control would have to invent an answer for which of the two the caregiver meant.
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
          p.startId ? h('button', { 'data-cycle-edit-start': 'true', onClick: () => cycleEditOpen(p.startId, 'cycle_start', 'Period Start', p.start), style: { color: '#8E3D61', fontSize: '13px', fontWeight: '700', padding: '0 14px', borderRadius: '10px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Move start') : null,
          p.endId ? h('button', { 'data-cycle-edit-end': 'true', onClick: () => cycleEditOpen(p.endId, 'cycle_end', 'Period End', p.end), style: { color: '#8E3D61', fontSize: '13px', fontWeight: '700', padding: '0 14px', borderRadius: '10px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Move end') : null,
          // THERE IS NO REMOVE HERE, AND THAT IS THE POINT.
          // v66 shipped one and it destroyed data on a single unconfirmed tap. Removing a period's
          // END reopens that period; cyclePeriods()'s UC20 rule then makes the NEXT cycle_start
          // update the reopened period instead of starting a new one, so two periods merge and one
          // row disappears. It could not be undone from the app either: after the merge
          // cycleActive() is false, so every control offers Period Start only and nothing anywhere
          // writes a cycle_end for a past day. Measured by the Zero Day Auditor: two seeded periods,
          // one tap, one period gone, toast said "Removed", no confirmation step -- while every
          // other destructive control in this app is two-step.
          //
          // Moving a date is safe because it is add-then-remove of a marker that is immediately
          // replaced. Deleting one outright is not, and a delete that can silently merge two months
          // of a patient's record does not belong behind a single tap. Withdrawn until it can be
          // done as "delete this period", closing the reopened period as part of the same action.
          null
        )
      ))""",
    'cycle-row-controls')

sub("""    h('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#8A6479', marginBottom: '10px' } }, 'Cycle History'),""",
    """    h('div', { style: { fontSize: '13px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: '#8A6479', marginBottom: '10px' } }, 'Cycle History'),
    h('div', { style: { fontSize: '12px', color: '#7D6974', marginBottom: '10px', lineHeight: '1.45' } }, 'Move start or Move end shifts that date to another day.'),""",
    'cycle-history-hint')


# ---------------------------------------------------------------- 9. Weight report add row
sub("""'No weight readings logged yet.\\nLog your first weight on the Today tab.\\n\\n'""",
    """'No weight readings logged yet.\\n\\n'""",
    'weight-empty-1')

sub("""'No weight readings logged yet.\\nLog your first weight on the Today tab.'""",
    """'No weight readings logged yet.'""",
    'weight-empty-2')

sub("""  // Range toggle
  const toggle = h('div',""",
    """  // Same reasoning as Paracentesis: the screen that shows weights could not record one, and its
  // empty state said so out loud. Reuses logWeight(), the Home card's own handler.
  const addRow = reportAddRow({
    label: 'Log a weight', placeholder: weightDefault() || '156.0', max: 999, hook: 'data-weight-report-add',
    value: state.weightInput, onInput: (e) => { state.weightInput = e.target.value; }, onLog: logWeight
  });

  // Range toggle
  const toggle = h('div',""",
    'weight-add-row')

# Every `return [...]` inside renderWeightTrend must lead with the add row. There are several
# (empty state, few-readings state, full chart), and missing one would leave the control on some
# paths and not others -- exactly the inconsistency this release exists to remove.
start = s.index('function renderWeightTrend(now) {')
end = s.index('\nfunction ', start + 10)
body = s[start:end]
before = body
body = re.sub(r"return \[toggle", "return [addRow, toggle", body)
body = re.sub(r"return \[h\('div',", "return [addRow, h('div',", body)
# The empty state opens `return [` on its own line with `toggle,` beneath it -- a shape neither
# regex above catches. It was missed on the first run and the count check below is what caught it.
# Emits `return [addRow,` on one line so it matches the same shape the count below looks for. The
# first attempt put a newline between `[` and `addRow`, the counter did not recognise it, and the
# check reported 1 of 2 -- the check catching its own author.
body = re.sub(r"return \[\n(\s+)toggle,", lambda mm: "return [addRow,\n" + mm.group(1) + "toggle,", body)
# THE PATH THAT ACTUALLY MATTERS. renderWeightTrend ends on a TERNARY return --
#   return paraLine ? [toggle, chart, ...] : [toggle, chart, ...]
# -- which no `return [` regex above can see, and which the count check below could not see either
# because it counted `return [` occurrences. So the check reported "2 of 2" and went green while
# the normal path -- readings exist, which is every real device -- had no add row at all. The
# feature shipped appearing ONLY when there were no readings: exactly backwards. Found by the Zero
# Day Auditor on the live v66 build.
body = re.sub(r"return paraLine \? \[toggle,", "return paraLine ? [addRow, toggle,", body)
body = re.sub(r": \[toggle, chart, stats, readings\];", ": [addRow, toggle, chart, stats, readings];", body)
# EVERY return path must lead with the add row, not merely one of them. The first run of this
# patch rewrote exactly one of the two and would have shipped a Weight screen where the new control
# appeared only once some readings existed -- the same "present on one path, absent on another"
# inconsistency the release exists to remove.
# COUNT EVERY `return`, NOT EVERY `return [`. The first version of this check counted only returns
# of an array literal, so a ternary return was outside the universe it compared against and it
# reported "2 of 2" while a third path had been missed entirely. A check is only as honest as the
# denominator it chooses.
n_returns = len(re.findall(r"\breturn\b", body))
n_fixed = len(re.findall(r"\[addRow,", body))
if n_fixed != n_returns:
    raise SystemExit('ANCHOR weight-returns: %d of %d return paths carry addRow' % (n_fixed, n_returns))
s = s[:start] + body + s[end:]




# THE FLOATING "Back" PILL SITS ON TOP OF THE LAST ROW. It is fixed near the bottom of the viewport,
# so whatever the report's final row happens to be is underneath it. That was survivable while the
# last row's only control was Remove at the far right edge; now Edit sits mid-row, exactly where the
# centred pill lands, and it cannot be tapped. Give every report detail enough tail room to scroll
# its last row clear.
sub("""    ...content
  ];
}""",
    """    ...content,
    // Tail room for the floating "Back" pill, which is position:fixed and otherwise covers whatever
    // the report's last row is. Found by opening the Paracentesis screenshot -- the pill was sitting
    // squarely on the bottom row's Edit button.
    h('div', { style: { height: '64px' } })
  ];
}""",
    'report-detail-tail-room')


# "Defaults to now" IS FALSE WHEN EDITING. An edit opens on the record's own date, not on now, and
# that helper line sat directly under a field showing 09/03 while telling the caregiver it showed
# the current time. Caught by opening the screenshot of the edit dialog -- every check was green.
sub("""        h('div', { style: { fontSize: '12px', color: '#7D6974', marginTop: '6px' } }, 'Defaults to now — pick a day above, or set the exact date and time in the field')""",
    """        h('div', { style: { fontSize: '12px', color: '#7D6974', marginTop: '6px' } }, m.editId
          ? 'Showing the date already recorded — pick a day above, or set an exact date and time in the field'
          : 'Defaults to now — pick a day above, or set the exact date and time in the field')""",
    'defaults-to-now-is-false-when-editing')

# "AVERAGING x L PER PROCEDURE" IS NOT A THING, AND IT IS REMOVED.
# Aaron, 2026-09-06: "we need to remove average of 5.6 L per procedure for para. this isn't an avg
# thing."
#
# He is right and the number was actively misleading. A paracentesis drains what has accumulated;
# how much comes off depends on how long it has been and how fast the fluid is reaccumulating. The
# mean of those volumes describes nothing a clinician would use and invites exactly the wrong
# reading -- "she is averaging 5.6, this one was 3, she is improving" -- when the interval is what
# carries the meaning, and that is already on the screen as "Since last".
#
# Arithmetically correct and clinically meaningless is still a false impression. The sentence about
# weight is kept: that one tells the caregiver something true and useful about where to look.
sub("""    'Averaging ' + paraFmtLiters(avg) + ' L per procedure. These are recorded separately from weight — the Weight report still shows what the scale actually said, with a marker on each drain date.');""",
    """    'These are recorded separately from weight — the Weight report still shows what the scale actually said, with a marker on each drain date.');""",
    'no-average-per-procedure')

# `avg` now has no reader. Left in place would be a dead calculation that the next person restores a
# use for.
sub("""  const avg = total / list.length;
""", "", 'drop-unused-avg')

# "TOTAL DRAINED" STAYS, AND THE FIRST DRAFT OF THIS PATCH WRONGLY REMOVED IT.
# The reasoning that killed the average -- a figure summarising volumes that each depend on elapsed
# time -- was carried over to the running total, which looks like the average's twin. It is not.
# STATUS.md records Aaron asking for exactly this: "there can be notes for weight that can add the
# para together to see how much was drained." The Paracentesis report's total, and the matching
# per-window line on the Weight report, are that request. Removing it would have deleted a feature
# he asked for, in the name of a rule he wrote about a different number.
#
# The distinction, for whoever reads this next: the AVERAGE invited a false comparison ("she is
# averaging 5.6, this one was 3, she is improving") when the interval carried the meaning. The TOTAL
# invites no comparison at all -- it is the plain sum of what came off, which is what was asked for.


# WEIGHT COULD ADD BUT NOT EDIT OR REMOVE -- THE EXACT INVERSE OF THE PARACENTESIS DEFECT THIS
# RELEASE SET OUT TO FIX. Found by the app-v71 audit's Enhancer note. A mistyped 1156.2 distorted
# the trend permanently from the screen that displays it.
#
# The Enhancer FOUND this while adding the add row and it was written to a backlog instead of being
# fixed. That was the real failure -- not the miss, the filing. Aaron: "don't tell me something is
# wrong and not fix it."
sub("""      h('div', { className: 'mono', style: { fontSize: '16px', fontWeight: '600', color: '#7B3F6B' } }, p.weight + ' lbs')
    );
  });""",
    """      h('div', { className: 'mono', style: { fontSize: '16px', fontWeight: '600', color: '#7B3F6B' } }, p.weight + ' lbs'),
      state.confirmRemoveWeight === p.weightId
        ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexShrink: '0' } },
            h('button', { onClick: () => removeWeightReading(p.weightId), style: { color: '#fff', background: '#C0453B', fontSize: '12.5px', fontWeight: '700', padding: '8px 12px', borderRadius: '9px', minHeight: '44px' } }, 'Delete'),
            h('button', { onClick: () => setState({ confirmRemoveWeight: null }), style: { color: '#7D6974', fontSize: '12.5px', padding: '8px 6px', fontWeight: '600', minHeight: '44px' } }, 'Keep')
          )
        : h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', flexShrink: '0' } },
            h('button', { 'data-weight-edit': 'true', onClick: () => weightEditOpen(p), style: { color: '#8E3D61', fontSize: '12.5px', fontWeight: '700', padding: '8px 10px', borderRadius: '9px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Edit'),
            // TWO-STEP, like every other destructive control here. v66 shipped a one-tap delete on
            // Cycle History and it destroyed a whole period.
            // ARMS FOR SIX SECONDS, then disarms itself -- copied from the History row's Remove,
            // which has always done this. Without it a red Delete sits armed on a medical record
            // through scrolling and through leaving the screen and coming back, and a mis-tap is
            // exactly what a two-step confirmation exists to prevent.
            h('button', { 'data-weight-remove': 'true', onClick: () => { setState({ confirmRemoveWeight: p.weightId }); setTimeout(() => { if (state.confirmRemoveWeight === p.weightId) setState({ confirmRemoveWeight: null }); }, 6000); }, style: { color: '#8E3D61', fontSize: '12.5px', fontWeight: '700', padding: '8px 10px', borderRadius: '9px', minHeight: '44px', background: 'rgba(170,83,117,0.10)' } }, 'Remove')
          )
    );
  });""",
    'weight-row-controls')

# CORRECTING A WEIGHT IS AN APPEND, NEVER A DELETE -- and the first version of this release got it
# wrong in exactly the way STATUS.md warned about seventeen releases ago. From the v52 section:
#
#     "The Firestore rules block deletes by document age, with no medId exemption. BYPASS_48H_IDS
#      only shows or hides a button; it cannot grant a delete the rules refuse."
#
# That is why removeParacentesis() appends a tombstone. The first draft of the weight edit called
# deleteDoc on every row with no age check, so on any reading older than two days the correction
# would have been ADDED and the old reading NOT removed: two weights for the same moment, forever,
# on the screen a clinician reads a trend off. The Zero Day Audit reproduced it -- 2 rows became 3.
#
# The rules are not in this repo and cannot be read from here, so the claim above cannot be settled
# either way. THAT IS THE ARGUMENT FOR THIS DESIGN, not against it: an append works whatever the
# rules say. Betting a patient's record on an unverifiable premise is the part that was wrong.
#
# Grouping is by `weightId`, falling back to the document's own id. Every weight already on Brandi's
# phone has no weightId, so each is its own group and the resolver returns them untouched -- this
# cannot disturb existing readings.
sub("""async function removeParacentesis(paraId) {""",
    """// ---- WEIGHT CORRECTIONS (v69) ----
// Same shape as PARACENTESIS above: the newest document per group wins and cancelled:true is a
// tombstone. A legacy reading carries no weightId and is its own group, so nothing changes for it
// until it is corrected. A Map, not a plain object, for the reason spelled out at
// paracentesisResolved(): an id of 'constructor' reads back a truthy inherited value.
function weightSupersedes(a, b) { return (a.loggedAt || a.ts || 0) > (b.loggedAt || b.ts || 0); }
function weightResolved() {
  const byGroup = new Map();
  for (const d of (state.entries || [])) {
    if (!d || d.medId !== 'weight') continue;
    const key = (typeof d.weightId === 'string' && d.weightId) ? d.weightId : ('doc:' + String(d.id));
    const prev = byGroup.get(key);
    if (!prev || weightSupersedes(d, prev)) byGroup.set(key, d);
  }
  const live = [];
  byGroup.forEach((w, key) => {
    if (w.cancelled) return;                                        // tombstone
    if (!(typeof w.ts === 'number' && isFinite(w.ts) && w.ts > 0)) return;
    const n = Number(w.weight);
    if (!isFinite(n) || n <= 0) return;                             // unusable reading, do not guess one
    live.push(Object.assign({}, w, { weightId: key, weight: n }));
  });
  return live.sort((a, b) => a.ts - b.ts);                          // oldest first, as the chart wants
}
function weightLatest() { const l = weightResolved(); return l.length ? l[l.length - 1] : null; }

function weightEditOpen(p) {
  // prevStamp travels with the modal so the correction can be stamped strictly newer than what it
  // supersedes. A legacy reading has no loggedAt, so its ts stands in -- the same fix v67 made for
  // paracentesis, where an edit silently no-opped on a record with no loggedAt while the toast
  // said "updated".
  setState({ timeModal: { type: 'weight', editId: p.weightId, weightValue: p.weight, timeValue: toLocalISO(p.ts), prevStamp: (p.loggedAt || p.ts || 0) } });
}
async function removeWeightReading(gid) {
  const p = weightResolved().find(x => x.weightId === gid);
  if (!p) return;
  try {
    await addEntryDB({ medId: 'weight', weightId: gid, weight: p.weight, dose: 'Weight removed', mg: 0,
                       ts: p.ts, cancelled: true, loggedAt: Math.max(Date.now(), (p.loggedAt || p.ts || 0) + 1) });
    setState({ confirmRemoveWeight: null });
    setToast('Weight reading removed');
  } catch (e) {
    console.warn('[weight] remove failed:', e);
    setToast('Could not remove — check connection and try again');
  }
}

async function removeParacentesis(paraId) {""",
    'weight-edit-helpers')

# The weight branch handles a correction by APPENDING a superseding document -- no delete, so it
# works at any age and cannot half-succeed. The add-before-remove dance the first draft used is gone
# with the delete it was protecting: there is now only one write, and if it fails addEntryDB's own
# red banner says so and the success toast never fires.
sub("""  } else if (m.type === 'weight') {
    const v = m.weightValue;
    const entry = { medId: 'weight', weight: v, dose: v + ' lbs', mg: 0, ts };
    setState({ weightInput: '', timeModal: null });
    await addEntryDB(entry);
    setToast('Weight ' + v + ' lbs logged at ' + fmtTime(ts));""",
    """  } else if (m.type === 'weight') {
    const v = m.weightValue;
    // Re-validated here because when editing the value is typed into the modal, after logWeight()'s
    // own check has already run on the way in.
    if (!(typeof v === 'number' && isFinite(v) && v > 0 && v <= 999)) { setToast('Enter a valid weight'); return; }
    const editId = m.editId;
    const entry = { medId: 'weight', weight: v, dose: v + ' lbs', mg: 0, ts };
    if (editId) {
      entry.weightId = editId;
      entry.loggedAt = Math.max(Date.now(), (m.prevStamp || 0) + 1);
    }
    setState({ weightInput: '', timeModal: null });
    await addEntryDB(entry);
    setToast('Weight ' + v + ' lbs ' + (editId ? 'updated' : 'logged') + ' at ' + fmtTime(ts));""",
    'weight-edit-confirm')

# The modal needs a weight field when editing, for the same reason the paracentesis one does.
sub("""      (m.type === 'para' && m.editId) ? h('div', { style: { marginBottom: '16px' } },""",
    """      (m.type === 'weight' && m.editId) ? h('div', { style: { marginBottom: '16px' } },
        h('div', { style: { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' } }, 'Weight (lbs)'),
        h('input', { 'data-weight-edit-value': 'true', type: 'number', inputMode: 'decimal', step: '0.1', min: '0', max: '999',
          value: String(m.weightValue), onInput: (e) => { const n = parseFloat(e.target.value); state.timeModal.weightValue = isNaN(n) ? null : n; },
          className: 'mono', style: { width: '100%', minHeight: '52px', border: '1px solid rgba(212,104,138,0.2)', borderRadius: '13px', padding: '0 14px', fontSize: '16px', background: 'rgba(255,255,255,0.75)', color: '#3D2B3A' } })
      ) : null,
      (m.type === 'para' && m.editId) ? h('div', { style: { marginBottom: '16px' } },""",
    'modal-weight-field')

sub("""  } else if (m.type === 'weight') {
    title = 'Log Weight · ' + m.weightValue + ' lbs';""",
    """  } else if (m.type === 'weight') {
    title = m.editId ? 'Edit Weight' : ('Log Weight · ' + m.weightValue + ' lbs');""",
    'title-weight-edit')

sub("""confirmRemovePara: null,""", """confirmRemovePara: null, confirmRemoveWeight: null,""", 'state-confirmRemoveWeight')

# A hook on the ROW, not only on its buttons. The v69 suite first counted weight rows by their Edit
# button; a row showing the Delete/Keep confirmation has no Edit button, so arming the confirmation
# looked exactly like a deletion that had not happened. Count the row, not the control.
sub("""    return h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', borderTop: i > 0 ? '1px solid rgba(212,104,138,0.08)' : 'none' } },""",
    """    return h('div', { 'data-weight-row': p.weightId, style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', borderTop: i > 0 ? '1px solid rgba(212,104,138,0.08)' : 'none' } },""",
    'weight-row-hook')

# EVERY SCREEN THAT READS A WEIGHT NOW READS THE RESOLVED ONE. Miss one of these and a corrected
# reading shows the OLD value on that screen while the Weight report shows the new -- two numbers for
# one weigh-in, which is worse than not offering the correction at all.
#
# Deliberately NOT changed, for consistency with how paracentesis and appointments already behave
# here: History, the CSV export and the printable report show raw documents, so a correction appears
# there as what it is -- the original reading, then the correction, then any removal. Those screens
# are the audit trail; hiding a superseded value from them would be the wrong kind of tidy.
sub("""function weightDefault() { const lw = latest('weight'); return lw ? String(lw.weight) : ''; }""",
    """function weightDefault() { const lw = weightLatest(); return lw ? String(lw.weight) : ''; }""",
    'reader-weightDefault')

sub("""  const weightLoggedToday = state.entries.some(e => e.medId === 'weight' && e.ts >= dayStart(now));""",
    """  const weightLoggedToday = weightResolved().some(w => w.ts >= dayStart(now));""",
    'reader-weightLoggedToday')

sub("""  const lastWeight = latest('weight');""",
    """  const lastWeight = weightLatest();""",
    'reader-home-card')

sub("""const latestWeight = latest('weight');""",
    """const latestWeight = weightLatest();""",
    'reader-report-card-meta')

# History shows the tombstone as what it is, the same way a removed paracentesis reads "Removed"
# rather than as a phantom reading of the old value.
sub("""  if (e.medId === 'weight') return e.dose || (e.weight !== undefined ? e.weight + ' lbs' : '');""",
    """  if (e.medId === 'weight') return e.cancelled ? 'Removed' : (e.dose || (e.weight !== undefined ? e.weight + ' lbs' : ''));""",
    'history-weight-tombstone')

sub("""  const weightEntries = state.entries.filter(e => e.medId === 'weight' && e.weight).sort((a, b) => a.ts - b.ts);""",
    """  const weightEntries = weightResolved();""",
    'reader-weight-report')

# The same row hook the Weight list gained, for the same reason. enhance-test counted paracentesis
# rows by their Edit button; a row showing the Delete/Keep confirmation has no Edit button, so the
# count would read a confirmation as a deletion. It has not bitten yet only because no para check
# happens to arm a confirmation -- the v69 audit named it, and a latent trap in a suite that guards
# a patient's record is worth ten seconds.
sub("""    ...list.map(p => h('div', { style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '14px', padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 3px 14px rgba(180,130,150,0.09), inset 0 1px 0 rgba(255,255,255,0.7)' } },""",
    """    ...list.map(p => h('div', { 'data-para-row': p.paraId, style: { background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.12)', borderRadius: '14px', padding: '13px 14px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 3px 14px rgba(180,130,150,0.09), inset 0 1px 0 rgba(255,255,255,0.7)' } },""",
    'para-row-hook')

# ---------------------------------------------------------------------------------------------
# THE RELEASE STAMP. Rule 0 says a release must be reproducible from the repo alone: base version
# plus the patches in harness/. Bumping the version by hand after applying the patch broke that --
# a rebuild came out stamped v65 and the difference had to be reconstructed from a diff. It is done
# here now, so outputs/rollback-v65/index.html + this file IS the shipped file.
sub("""const APP_VERSION = 'v65';""", """const APP_VERSION = 'v69';""", 'app-version')

sub("""const CHANGELOG = [
""", """const CHANGELOG = [
  { v: 'v69', date: 'Sep 6, 2026', title: 'Fix a weight you typed wrong',
    points: [
      'A weight reading can now be corrected or removed from the Weight report \\u2014 tap Edit to change the number or the time, or Remove to delete it. Before this, a weight typed wrong had to be deleted from History and typed in again.',
      'Removing asks twice, like everywhere else in the app: Remove, then Delete.'
    ] },
  { v: 'v68', date: 'Sep 6, 2026', title: 'Fix a mistake where you find it',
    points: [
      'The Paracentesis screen could delete a procedure but not add one, and could not correct a wrong amount. It can now do both.',
      'The Weight screen can now record a weight without going back to Today.',
      'A period logged on the wrong day can be moved \\u2014 tap Move start or Move end in Cycle History. Periods still cannot be deleted there, on purpose: deleting one could quietly merge it with another.',
      'The Paracentesis screen no longer shows an average per procedure. How much comes off depends on how long it has been, so an average of it was not telling you anything.'
    ] },
""", 'changelog-v68-v69')

open(TARGET, 'w', encoding='utf-8').write(s)
print('enhance-reports-patch applied: %d -> %d bytes' % (orig_len, len(s)))
