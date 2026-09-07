VERDICT: BLOCK
HEADLINE: The journal fix is right for bowel, appetite, symptoms and weight — but its `!e.cancelled` term also hides the "Paracentesis removed" tombstone while nothing hides the paracentesis it removed, so a paracentesis removed today now sits in Home's journal as a standing "2:00 PM Paracentesis 3 L" row with a Remove button; v71 showed the same row with "Paracentesis removed" under it. Same shape as the first BLOCK (Home tells her something untrue about a record she removed), narrower, and a ~10-line fix: a `paraSuperseded(e)` mirroring `weightSuperseded` (key = paraId, else doc:id; stamp = loggedAt||ts) added to the same filter.
EVIDENCE: `harness/audit-v72-probe.mjs` case D (extended this pass, seeds a removed paracentesis): fixed build lists `["2:00 PM Paracentesis 3 L Remove"]` for a procedure whose tombstone is in state — FAIL; pre-fix mutant lists `[... "3 L Remove", "2:00 PM Paracentesis Paracentesis removed"]` — legible. Probe: 27/28 on the fixed build, the one failure is this row.
EVERYTHING ELSE HELD: (1) every path the first pass named is clean (probe cases A–C 19/19 unchanged); a plain weight shows once, a corrected weight shows once as the correction (142 lbs, never 141, never zero), a removed weight shows zero times; a weight-unhidden mutant fails exactly those three (24/27) so the checks can fail. (2) No Home number moves: `todayEntries` is consumed only by the journal render (index.html:4204); Tylenol total (`dailyDoseMg` → `entriesFor(state.entries)`), `dailyPills`, and `missedDosesFor` never read it — probe shows "500 mg / 2,500 mg" and the MISSED Protonix row with hidden rows present in state. (3) The three v72 changelog sentences are still true word for word; the note's silence about Home is acceptable once Home shows only what stands — no wording change needed after the fix. (4) The suite's journal case CAN fail: 38/39 on a hand-made no-filter mutant and on a tombstone-only mutant, both failing exactly that case; its remaining gap is that it asserts absence only (a filter that dropped every bowel row would pass it) — pair it with a presence check before the removal.
NOT NEW, FOR THE RECORD: a paracentesis CORRECTED today already listed twice ("4 L" and "4.5 L (corrected)", both with Remove) in v71 and still does; the same `paraSuperseded` term closes it. Remove on such a raw row goes to `removeEntry(e.id)` (a hard delete of the original document, <48h so it succeeds) — pre-existing since v67, figures unaffected because the tombstone still governs the group, but worth the same term in `removeBtn`.
CONTROL NOTE: my first "pre-fix" control (`git show HEAD~1:index.html`) already contained the filter — the parent committed 49a7031/8ce3d9c while this pass ran — so that 39/39 proved nothing; all falsification above uses mutants built by hand from the current file (scratchpad m1/m2/m3).
AUDITOR: Zero Day Auditor DELTA, 2026-09-07, ~12 min, Chromium + stubbed Firestore, no network; probe extended (uncommitted), index.html/patch/docs untouched, nothing committed.

---

## 1. The finding

`renderToday`'s filter now reads:

    && !e.cancelled && !dailySuperseded(e) && !symptomSuperseded(e) && !weightSuperseded(e)

`!e.cancelled` is generic: it hides EVERY tombstone kind. The three `*Superseded` terms are specific: they hide the
document a tombstone or correction out-ranks for bowel/appetite, symptoms and weight only. Paracentesis (v67+,
append-only, grouped by `paraId`) has no `paraSuperseded` helper anywhere in the file, so its tombstone vanishes
from the journal and its original stays. Cycle markers are excluded from the journal by medId, and appointment
documents do not appear in it on either build (probe: `[]`), so paracentesis is the only exposed kind.

What she sees on Home at 19:00 after logging a 3 L paracentesis at 2 PM and removing it from the report:

    v71:   2:00 PM  Paracentesis  3 L                  Remove
           2:00 PM  Paracentesis  Paracentesis removed
    v72:   2:00 PM  Paracentesis  3 L                  Remove       <- reads as standing

The Paracentesis report, "Since last", and the resolved figures are all correct (they read `paracentesisResolved()`);
only the journal is wrong, and it is wrong in the direction of showing a removed procedure as real.

Fix (small): add next to `weightSuperseded` —

    function paraSuperseded(e) {
      if (!e || e.medId !== PARA_MED_ID || e.cancelled) return false;
      const keyOf = (d) => (typeof d.paraId === 'string' && d.paraId) ? d.paraId : ('doc:' + String(d.id));
      const key = keyOf(e), mine = (e.loggedAt || e.ts || 0);
      return (state.entries || []).some(d => d && d.medId === PARA_MED_ID && String(d.id) !== String(e.id)
        && keyOf(d) === key && (d.loggedAt || d.ts || 0) > mine);
    }

and `&& !paraSuperseded(e)` in the journal filter (patch section 5c). Then case D's paracentesis check goes green
and the "corrected twice" INFO line drops to one row. Re-run: probe (expect 28/28), suite (39/39).

## 2. The four questions

**(1) Does the fix hold; is anything else hidden that should be there?** Probe cases A–C: unchanged, 19/19 on the
fixed file, 16/19 on a hand-made no-filter mutant (the same three failures as the first pass). Case D, weights:
`["8:00 AM Weight 140 lbs Remove", "10:00 AM Weight 142 lbs (corrected) Remove"]` — plain once, corrected once as the
correction, removed zero times, two rows total. `weightSuperseded(original)` is true for both a correction and a
tombstone in its group because the cancelled early-return applies to the row being asked about, not the newer
document, so a removed weight's original is hidden too. Mutant m3 (weight term dropped) lists 141, 142 and 143 → the
three weight checks fail, so they can fail. Nothing that should be there is hidden: Tylenol dose, missed row,
today's symptom (once), standing weights are all listed. What should NOT be there and is: the removed paracentesis
above.

**(2) Any number on Home?** No. `grep todayEntries` → two lines, 4199 (definition) and 4204 (journal bucketing).
`tylenolMg → dailyGroupMg/dailyDoseMg → entriesFor(id)` over `state.entries`; `dailyPills` and `missedDosesFor`
likewise. Probe: "500 mg" / "/ 2,500 mg" / "Last dose … 500 mg" on Home and the "8:00 AM Protonix MISSED" row present
while the state holds a bowel tombstone, a symptom correction, a weight correction and a weight tombstone.

**(3) Changelog.** "Updating a bowel movement answer from the banner now sticks … more than two days old" — true, the
fix did not touch it. "Editing or removing a symptom works at any age … the same way a corrected weight or period
date already works" — true. "In History, … Superseded … Removed … dose count no longer counts them" — true, suite
section 6. The fix changed nothing the note describes. Silence about Home is acceptable once Home shows only what
stands (that is v71's behaviour restored, not a new one to announce); with the paracentesis row it is not yet right,
but the note needs no new sentence after the fix.

**(4) Can the suite's journal case pass on a build that shows the rows?** No. m1 (no filter) → 38/39, m2 (hides
tombstones only, old "Normal" still listed) → 38/39, both failing exactly "Home's journal lists neither the removed
bowel answer nor its tombstone". `journal !== null` guards the heading lookup, so a renamed heading fails loudly
rather than passing. Gap (not a defect): the case asserts absence only — a filter that dropped every bowel row would
pass it. Add "journal lists Bowel Movement Normal" right after the Log tap, before the removal.

## 3. What I did not do
- No iPhone; Chromium only, stubbed Firestore. Did not run overflow-scan or scrolllock (no layout change).
- Did not test appointment corrections in the journal beyond confirming appointments are not listed there.
