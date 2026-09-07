VERDICT: BLOCK
HEADLINE: Today's journal on Home was left behind — after she removes today's bowel answer, Home shows the end-of-day card asking again AND, right below it, an unlabelled "Bowel Movement / Normal" row with no Remove button plus a "Bowel movement removed" row; editing a symptom logged today lists it twice (old copy unlabelled, no Remove). v71 deleted these within 48 hours, so on the one screen she uses most this release is a visible regression, not a fix.
EVIDENCE: `harness/audit-v72-probe.mjs` (Chromium, stubbed Firestore, no network) — 16/19 on v72; the three failures are exactly these rows; the same checks go green on a copy of index.html whose journal skips cancelled/superseded rows (falsified), so the probe can pass and the fix is one filter.
FIX (small, ~1 line): in renderToday's `todayEntries` filter add `&& !e.cancelled && !dailySuperseded(e) && !symptomSuperseded(e)` (or give journal rows the same Superseded/Removed chip History got). Then add a journal case to daily-supersede-test.mjs — the suite never looks at Home's journal, which is why 37/37 passed with this on screen.
EVERYTHING ELSE HELD: every figure and decision reads the resolved maps (banner, streak, day-N, report meta, printable symptom table, dose counts); no resurrection path found; the stamp guard holds against a future stamp; a tombstone's old value drives nothing; a symptom type change groups correctly on the Symptoms tab, History and the write; a refused write behaves as v71 did; zero delete attempts.
COPY: the three v72 changelog sentences are true as written ("In History…" is true) — but the release note is silent on Home, where the same answer now reads wrong; re-read it after the fix.
SUITE: could not make it pass on a broken build I tried (medId-grouping mutant fails 2 checks); its gap is coverage — no Home-journal case, no type-change case — not a check that cannot fail.
LOW-RISK NOTES (not blocking): clock-skew re-answer window; legacy same-day ties show no chip on either row; banner falls back to an earlier issue day after a removal (v71 did the same).
PROBE: harness/audit-v72-probe.mjs — run with `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/audit-v72-probe.mjs [--file f]`.
AUDITOR: Zero Day Auditor, 2026-09-07, ~25 min, branch claude/caretracker-team-review-i83ik2, nothing committed, index.html/patch/docs untouched.

---

## 1. The blocking finding — Home's journal reads raw

`renderToday()` builds "Today's journal" from `state.entries` filtered only by day and a few marker
types (index.html ~line 4199). v72 made two kinds of row that did not exist before on a same-day
path: a superseded answer/symptom and a tombstone. History (line ~6905) got a Superseded/Removed
chip and `removeBtn()` hides on both. The journal got neither the chip nor the filter, but it DID
inherit the hidden Remove button (`removeBtn(e)` returns null for superseded/cancelled rows).

What she sees on the phone at 19:00 after answering "Normal" and then removing it from History:

    [ BOWEL MOVEMENT card: "Today's bowel movement hasn't been logged yet."  Select… | Log ]
    TODAY'S JOURNAL
      12:00 PM  Bowel Movement   Normal                       (no chip, no Remove)
      12:00 PM  Bowel Movement   Bowel movement removed       (no chip, no Remove)

Probe output (v72, `harness/audit-v72-probe.mjs` case A):

    journal rows: ["8:00 AM Protonix MISSED …","9:00 AM Nausea Remove","12:00 PM Bowel Movement Normal","12:00 PM Bowel Movement Bowel movement removed"]
    FAIL  Today's journal lists no bowel row for a day that reads unanswered (or labels every one it lists)

Case B, a symptom logged this morning and edited (note changed) from the Symptoms tab:

    journal rows: [… "9:00 AM Nausea", "9:00 AM Nausea Remove" …]
    FAIL  Today's journal shows the edited symptom ONCE, or labels the old copy  |  2 nausea row(s)

The old copy has no Remove and no label; the new one has Remove. A type change (nausea → vomiting)
would list "Nausea" and "Vomiting" both at 9:00 AM.

Why this is a regression and not "rows raw is fine": today's rows are inside the 48-hour window, so
in v71 the delete SUCCEEDED here and the journal was clean. v72 fixes the >48h path (real, and the
suite proves it) and breaks the <48h path on Home. The brief's rule was "numbers and decisions must
be resolved; rows raw is fine" — a raw row that contradicts the card directly above it, with the
Remove control removed so she cannot act on it, is not a fine raw row; it is the v66/v69 shape
("the app tells her something untrue") on the screen she opens first.

Falsification: `S/fixed-journal.html` = index.html with the one-line filter above → probe 18/19
(the 19th was my own case-sensitive selector, since fixed → 19/19 on the fixed build, 16/19 on v72).

## 2. Attack targets, what was tried, what was found

1. **Readers.** Grepped every reader of `bowel_movement`, `appetite`, `symptom_`:
   `bowelMovementFor/latestBowelDay/bowelIssueActive/currentBowelIssueType/daysSinceBowelIssueStart/
   bowelMovementHistorySorted/appetiteFor/appetiteHistorySorted` all go through `dailyEntriesByDay`
   (tombstone days deleted from the map); Home banner + both end-of-day cards + `reportMeta` use
   them; `symptomEntries()` and the printable report's symptom table use `symptomResolvedFrom`;
   History "N doses" and the printable dose count exclude these types and tombstones; the printable
   report has no bowel/appetite section. CSV: rows raw, `exportDetailFor` labels — correct per model.
   Probe case C: removing D-1 from the Bowel report leaves the banner driven by D-2, streak Day 2 → Day 1,
   meta "Diarrhea most recent", banner label names D-2 — all PASS. **The only raw reader with a
   caregiver-facing consequence is Home's journal (above).**
2. **Resurrection.** `removeBtn` hides on cancelled/superseded rows in History, both reports, the
   Symptoms tab and the journal; every Remove on a standing row routes to a tombstone stamped
   `max(now, winner+1)`; no path deletes a superseding document. Symptom groups: legacy key
   `doc:<id>` is written into the correction and the tombstone (`corr.symptomId === 'doc:sym9'`
   PASS). Not found.
3. **Tie-break and clock.** Suite seeds a loggedAt five days in the future; the update wins (PASS).
   Same-ms two-device writes tie on `>=` → later Firestore document, benign. Symptoms cannot tie
   (each legacy doc is its own group; corrections are always prev+1). One theoretical hole, NOT
   blocking: a tombstone stamped from a future stamp (clock skew larger than the time until she
   re-answers) outranks a fresh answer stamped bare `Date.now()` (`dailyNextStamp(null)` after the
   map dropped the day). Needs skew > elapsed seconds on iPhones that NTP-sync; self-heals.
4. **Tombstone as data.** Carries `value`; nothing reads it: `dailyEntriesByDay` drops the day,
   `bowelIssueActive` etc. read the map, History/CSV print "Removed", counts skip `cancelled`.
   Probe C PASS. Journal prints its `dose` string ("Bowel movement removed") — part of finding 1.
5. **Symptom type change.** Probe B: nausea → vomiting at nine days: Symptoms tab 2 rows (not 3),
   D-9 row reads Vomiting, write is `symptom_vomiting` in group `doc:sym9`, History marks the old
   document Superseded. PASS. `symptomSuperseded` matches on key not medId. Journal: finding 1.
6. **Failure modes.** `addEntryDB` raises the red banner and rethrows. Banner/card submits keep their
   try/catch + toast (two messages, same as v71). Symptom modal closes before the await and has no
   catch — identical shape to v71 and to the marker path; banner covers it. `removeEntryFor` from the
   confirm button is unawaited — rejection reaches the banner, then an unhandled-rejection console
   line; v71's `removeEntry` had the same shape. Not new.
7. **Copy.** All three v72 points read true on the phone path: the banner Update >48h did fail with
   the connection toast in v71 (delete rejected before the add ran, so "the old answer stayed" is
   accurate); weight/cycle are append-corrected; History chips and dose count verified by the suite
   and by eye in the probe. No "fixed the flicker"-class promise. One thing to re-read after the
   fix: the note says nothing about Home, where the fix must now also apply.
8. **The suite.** Every check I read compares a DOM hook or the stub's store, none reads
   `document.body.textContent`, none pins a version, the Removed check `>= 1` is loose but is
   preceded by exact-count checks. Mutant "group symptoms by medId" → 35/37 (caught via the
   symptomId write and the History chip). Its blind spots are coverage: no Home-journal assertion,
   no type-change edit. Add both with the fix.

## 3. What I did not do
- No iPhone; Chromium only. No real Firestore (rules unreadable from here) — the new `symptomId`
  field name is a new key like `paraId`/`weightId`/`markerId` were, same risk class as v69/v70.
- Did not run overflow-scan on the journal with the extra rows (they are ordinary rows).
