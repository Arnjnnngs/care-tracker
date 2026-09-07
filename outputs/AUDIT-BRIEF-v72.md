# Zero Day Audit brief — care-tracker v72

You are the Zero Day Auditor. Your job is to STOP this release, not to confirm it. Five of your
predecessors' blocks (v61, v66, v69 twice, v70) were correct and would have reached a real patient.
Find the sixth. If you cannot, say so plainly and show what you tried.

## The release

v72 makes every correction and removal of a **bowel movement answer**, an **appetite answer** and a
**symptom** an APPEND — a superseding document or a `cancelled: true` tombstone — instead of a delete.
The Firestore rules (not in this repo, cannot be read from here) refuse deletes past 48 hours; every
delete-based correction in this app has failed on the phone for that reason (v52, v69, v70).

- Base: `outputs/rollback-v71/index.html`. Patch: `harness/daily-supersede-patch.py`. Result: `index.html`.
- Suite: `harness/daily-supersede-test.mjs` — 37/37 on v72; 9/37 on v71; 32/37 on a mutant whose
  stamp guard is a bare `Date.now()`.
- Write model: bowel/appetite grouped by DAY (`dayStart(ts)`), symptoms by `symptomId` falling back
  to the document id. Newest `loggedAt || ts` wins; ties keep the LATER document (`>=`) to preserve
  v71's behaviour for legacy duplicates. Every write stamps `Math.max(Date.now(), stamp(prev) + 1)`.
- Readers: `dailyEntriesByDay`, `symptomResolvedFrom`. Labels only: `dailySuperseded`, `symptomSuperseded`.
- Remove: `removeEntryFor(e)` routes daily answers and symptoms to tombstones; everything else keeps
  the plain delete inside its 48-hour window. `removeBtn` hides on a cancelled or superseded row.
- History: rows stay raw with a Superseded / Removed chip; the "N doses" count now excludes daily
  answers, symptoms, tombstones. CSV `exportDetailFor` labels superseded/removed rows.

## What to attack, in order

1. **Every reader of these record types.** Find any code path that reads `bowel_movement`,
   `appetite` or `symptom_*` documents RAW where a figure or a decision comes out of it — the missed
   Home cards, `bowelIssueActive`, `daysSinceBowelIssueStart`, `latestBowelDay`, the end-of-day
   prompts, the reports' meta lines, the printable oncologist report (`buildReportHtml` / the symptom
   table around `allExportEntries().filter(symptom_)`), the CSV totals. v69 was blocked twice on a
   reader that was left behind. Rows raw is fine; numbers and decisions must be resolved.
2. **Resurrection.** Can any sequence of edit / remove / re-answer on any screen make an OLDER
   version of a record come back? Include History's Remove on a fresh superseding document, and the
   two report screens' per-row Remove.
3. **The tie-break and the clock.** Two devices answering the same day within the same millisecond;
   a device whose clock is behind; a legacy document with a FUTURE ts. Does the stamp guard hold? Is
   `>=` safe for symptoms (where the fallback key is the document id)?
4. **The tombstone as data.** A cancelled daily answer carries the old `value`. Does anything count
   it, chart it, export it as a live value, or trigger the "issue active" banner from it?
5. **The symptom type change on edit.** The modal lets the TYPE change (`symptom_nausea` →
   `symptom_vomiting`) while the group id stays. Does every reader group by `symptomId` and not by
   `medId`? Does the Symptoms tab, History and the export show the right type?
6. **Failure modes.** A refused write (offline): does any path show a success toast, close a modal,
   or leave state that lies? `addEntryDB` raises the red banner and rethrows — verify each new caller
   handles that as the old one did.
7. **The Voice.** Read the v72 CHANGELOG entry and every toast/label this diff touched. Is every
   sentence TRUE on the path a real phone takes? Would a tired person understand it at 2am?
8. **The suite.** Try to make `daily-supersede-test.mjs` pass on a broken build. Any check that
   cannot fail is a finding.

## Rules for you

- Report the headline finding FIRST, in one sentence, before anything else.
- Verdict line at the top: `VERDICT: SHIP` or `VERDICT: BLOCK`, then the evidence.
- Never touch the network. Every harness stubs Firebase; a real write to Firestore is a patient's
  medical record. Suites refuse to run with HTTPS_PROXY set — run them with
  `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/<suite>.mjs`.
- Version-agnostic assertions only; read APP_VERSION from the file under test.
- The h() trap: a conditional attribute passed as null/false renders as `disabled="null"`.
- Never assert on `document.body.textContent` — the source is in the body.
- If you write a probe, falsify it once: break the thing, watch it go red, restore.
- Write your report to `outputs/AUDIT-v72.md` and finish within about 25 minutes of work.
