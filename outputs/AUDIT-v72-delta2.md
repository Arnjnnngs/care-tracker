VERDICT: SHIP
HEADLINE: `paraSuperseded` is correct for every paracentesis document shape the app has written (legacy no-paraId, corrected sharing a paraId, tombstone) because it keys and stamps documents with code textually identical to `paracentesisResolved()`'s, so anything the resolver out-ranks the journal now hides — a paracentesis corrected today shows exactly once on Home as the correction, a removed one zero times, and disabling the helper drops the probe to 27/28 on exactly that row.
EVIDENCE: `harness/audit-v72-probe.mjs` on the current index.html: 28/28; journal lists `"1:00 PM Paracentesis 4.5 L (corrected) Remove"` once, no `4 L`, no `3 L`, no tombstone (INFO lines: removed-today `[]`, corrected-today `1`). Hand-made mutant (`paraSuperseded` returns false, scratchpad `m-nopara.html`): 27/28, the one FAIL is the removed-paracentesis case, and the journal shows `4 L`, `4.5 L (corrected)` AND `3 L` all with Remove — so the check can fail and the term is what makes it pass. `harness/enhance-test.mjs` 37/37 and `harness/para-test.mjs` 16/16 on the current file: the Weight and Paracentesis REPORT screens' Edit/Remove are unaffected, and could not be — `removeBtn()` is called from Home's journal, History, Appetite, Bowel and Symptoms only (index.html:4226, 6942, 7026, 7046, 7111); both reports render `paracentesisResolved()` / weight-resolved rows with their own buttons keyed by `paraId` / `weightId` (7329–7344, 7522–7534) and never call `removeBtn` or read the History `stale` chip.
SHAPES, ONE BY ONE: (a) legacy document with no `paraId` → key `doc:<id>`, nothing else shares it, never superseded, shows as before; if it is later edited from the report, `paraEditOpen` carries `p.paraId` which the resolver set to that same `doc:<id>` string (5110), so the correction and the legacy original land in one group in BOTH functions. (b) correction sharing a `paraId` → original has the older `loggedAt||ts`, hidden; correction stands. (c) tombstone (`cancelled:true`, written 5221 with the group's `paraId` and `loggedAt: Date.now()`) → `paraSuperseded` returns false for it by the `e.cancelled` guard, History labels it "Removed" (the `e.cancelled` branch runs first), the journal hides it by `!e.cancelled`, and the procedure it removed is hidden by the term. (d) ties on `loggedAt||ts` → strict `>` in both functions, neither hides; unreachable in practice because the edit path stamps `Math.max(Date.now(), stamp(previous)+1)` (2033). (e) CSV: `exportDetailFor` labels a superseded original " (superseded)" and a tombstone "Removed"; `allExportEntries()` is `state.entries` + chemo dates, the same list `paraSuperseded` reads, so the label cannot disagree with the History chip.
STILL STANDS, NOT NEW, SAID OUT LOUD: (1) The correction row on Home and History keeps a Remove button, and `removeEntryFor` (3563) routes paracentesis to `removeEntry(e.id)` — a hard delete of the CORRECTION document, which within 48h succeeds and resurrects the original 4 L in every figure. Pre-existing since v67, named in AUDIT-v72-delta.md and in Enhancer pass 04 (route History's Remove on corrected weight/period/paracentesis rows to their tombstones, S); the report screen's Remove is the safe path today. Not a regression of this delta and not widened by it; it belongs in the next small release, not this one. (2) History's Remove on a superseded weight ORIGINAL is likewise not hidden — `weightSuperseded` was added to the chip but not to `removeBtn`; same pre-existing item, same queue. (3) The probe's corrected-paracentesis line is INFORMATIONAL (printed, not asserted) — I asserted it by eye above and by the mutant; a one-line `t()` on it would make the record permanent, no code change needed for this ship.
AUDITOR: Zero Day Auditor DELTA 2, 2026-09-07, ~7 min, Chromium + stubbed Firestore, no network; index.html, the patch and every other doc untouched; nothing committed.

---

## Scope

`git diff HEAD~1 -- index.html harness/daily-supersede-patch.py` only: the new `paraSuperseded(e)` (index.html 5084–5091, patch section 5d) and its four call sites — Home journal filter (4200), `removeBtn` (3567), History's Superseded chip (6931, which also gained `weightSuperseded`), and the CSV label in `exportDetailFor` (5781).

## Runs

| Suite | File | Result |
|---|---|---|
| audit-v72-probe | current index.html | 28/28 |
| audit-v72-probe | mutant, `paraSuperseded` → `false` | 27/28, FAIL = removed paracentesis standing on Home |
| enhance-test | current | 37/37 |
| para-test | current | 16/16 |

All run with the proxy variables unset; the probe refuses to start if any is set.

## Why the helper is correct by construction

`paraSuperseded` and `paracentesisResolved` compute the group key with the same expression
(`typeof d.paraId === 'string' && d.paraId ? d.paraId : 'doc:' + String(d.id)`) and rank with the same stamp
(`d.loggedAt || d.ts || 0`, strict `>`). Any document the resolver drops as out-ranked, the helper reports as
superseded, and vice versa. The helper deliberately excludes tombstones (`e.cancelled`) so they keep their
"Removed" label rather than being called "Superseded".
