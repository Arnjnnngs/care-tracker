AUDITED-COMMIT: a755845
VERDICT: DO NOT SHIP

# Zero Day Audit — care-tracker v63 ("Take all")

**In one line:** the fix itself is real and works — with a medication refused mid-way, every
other dose now saves and the message finally matches the record — but two things are still
wrong in the shipped app, and the new test cannot fail on the exact mistake this release
exists to prevent. All four items below are a handful of lines. **The core change is safer
than what is live today; it should ship as soon as they are closed.**

Everything below is a measurement from a run I actually did, in a browser, against stubbed
Firebase. Brandi's real Firestore was never reachable from any of it.

---

## What is genuinely fixed (verified)

| Scenario | Live build today | This build |
|---|---|---|
| One medication refused out of four | **1 dose written, 3 abandoned**, plus an uncaught page error | **3 written, 1 refused** — nothing behind the refusal is lost |
| The message in that case | *"That didn't save. Nothing was lost — log it again."* (a dose HAD saved) | *"Evening A, Evening C, Compazine were logged. Evening B was NOT. Log only the missing one again — the rest are already saved."* |
| Everything refused | Same wrong-in-context sentence | *"None of those saved. Nothing was lost…"* — the one case where it is true |
| A medication left off because it is not due | Silent | Named in the toast |

`harness/takeall-test.mjs` **19/19** on this build. Against the shipped v62 build in
`outputs/rollback-v62/` (md5 matches the one STATUS.md records for v62): **13 passed, 6 red**,
red on exactly the right checks. Adjacent suites re-run and unaffected: `logger-test` 19/19,
`whatsnew-test` 30/30, `missed-banner-test` 16/16. `pm.py` exits 2 — one warning, pinned
version literals in six OLDER suites, none of them touched by this release.

I could not find any way to lose or duplicate a dose in the new loop. Every medication is
written in its own try/catch; a refusal is recorded and the loop continues; nothing is
retried, so no double write. That was the main thing I was looking for and it holds.

---

## BLOCKER 1 — the new test passes with the message exactly backwards

This is the most serious finding, and it is in the test, not the app.

I took the correct build and swapped only which list of names goes where in the banner, so
that it names the medication that FAILED as saved and the three that SAVED as failed. The
banner then read:

> *"Evening B was logged. Evening A, Evening C, Compazine was NOT. Log only the missing one
> again — the rest are already saved."*

Three doses were in the record; the app told the caregiver to log all three again, and to
leave alone the one that never saved. That is a worse version of the harm this release was
written to remove. **The suite stayed 19/19 green.**

The reason is that section 3 asks whether the medication names appear *anywhere* in the
banner text, not whether they are on the right side of it. Both regexes match an inverted
message. The fix is to assert on position — that the failed name appears after "NOT", or
simply that the text before "logged." does not contain the refused medication's name.

Falsification evidence, all runs done today against a scratch copy outside the repo:

| Sabotage | Result | Right reason? |
|---|---|---|
| Restore the old bare `await` (no per-medication catch) | **14/19 RED** | Yes — "the refused medication did not cancel the ones after it" |
| Partial-failure banner made to say "Nothing was lost" | **18/19 RED** | Yes — the one sentence that caused the harm |
| Skipped medication dropped from the toast | **18/19 RED** | Yes |
| `groupIds` removed from the Take all button | **18/19 RED** | Yes — the new field is load-bearing |
| Every dose written twice | **18/19 RED** | Yes — duplicates are caught |
| **Saved and failed names swapped in the banner** | **19/19 GREEN** | **No — this is the hole** |
| `afterLog` guard removed | **19/19 GREEN** | No — never exercised (see Blocker 3) |

## BLOCKER 2 — "it says which one was skipped" is only true when nothing fails

The in-app What's new notice a patient reads says:

> *"And if something on the card is skipped because it isn't due yet, it says which one."*

The README row, STATUS.md and the commit message make the same unqualified claim. In the
code, `skippedNames` is computed once and then used in **only the all-saved branch**. On both
failure paths it is discarded.

Measured: with Iron on the Evening card and not due, and one medication refused, the banner
was *"Evening A, Evening C, Compazine were logged. Evening B was NOT…"* — Iron is not
mentioned anywhere. So on the failure path the app is back to the silent skip that this
release names as defect (3), and the caregiver sees four medications on the card and three in
the message with no explanation for the fourth. That is the "it only logged some of them"
confusion Aaron reported, surviving in the case the release is actually about.

One line: append the same `· X not due yet` clause to both failure branches, or narrow the
notice copy.

## BLOCKER 3 — a clinical warning can now fire for a dose that was refused

New in this commit. The follow-up call is guarded by
`if (savedNames.length && ids.includes('iron'))` — "something saved" and "Iron was *attempted*",
not "Iron saved". `savedNames` holds display names, so it cannot answer the question that is
actually being asked.

Measured, with Iron due and Iron's write refused while the others succeeded: Iron is absent
from the writes, the banner correctly says Iron was NOT logged — **and the Iron follow-up
still ran.** In practice that can raise the amber *"Iron + Protonix timing"* advice, or a
daily-limit warning, about a dose that is not in the record. No data is written and no dose is
lost, but it is a false statement about the record in a release whose whole subject is not
making false statements about the record. On the live build this could not happen: the throw
skipped that line entirely.

Fix: collect saved **ids** alongside the names and test `savedIds.includes('iron')`.

---

## Advisories (not blockers)

**A1 — the skipped-medication check goes red for two hours a day on a healthy build.** It
depends on the app's own Iron riding into the fixture through the defaults and not being due
at the moment the suite runs. Iron's window is 22:00–24:00, so I re-ran the suite with the
page clock fixed at 22:30 and the correct build failed that check — no medication was left
out, so nothing was named, and the assertion cannot tell that from a regression. It is also
coupled to a default medication the suite's own header warns against seeding. Pin the clock,
or seed a medication that is deterministically not due and assert on that name.

**A2 — a red banner survives a successful retry, still telling the caregiver to log again.**
Pre-existing, not introduced here, and one line from being fixed. Measured: all writes
refused → *"None of those saved… log them again."* The caregiver retries, all four doses save,
the success toast appears and fades — and the red banner is still on screen saying to log them
again. A third attempt duplicates. The success branches never clear `writeError`. Given this
release is specifically about not telling a caregiver to re-log a saved dose, it belongs with
this change: `setState({ writeError: null })` next to the success toast.

**A3 — "13/19 RED against the live v62 build" reads as thirteen failures.** It is thirteen
passes and six failures. STATUS.md's phrasing ("red at 13/19") is fine; the README row and the
commit message are not.

**A4 — pre-existing doc rot, unrelated to this release.** README still names the service worker
cache as `caretracker-v41` in one place and `caretracker-v40` in another; both are many
releases stale. `CARETRACKER_HANDOFF.md` still says "Last updated: August 16, 2026" while its
version line was updated in this commit.

**A5 — process.** The release commit is not on the remote: `origin/main` is still the previous
commit. Under Rule 0 this work exists only in a sandbox that has rolled back nine times.

## Things I attacked that turned out fine

- `groupIds` missing from an older modal — guarded by `Array.isArray`, falls back to the
  attempted list, and the time modal is in-memory only, so there is no restored-state path.
- A medication named as skipped that was actually logged — not reachable; anything in the
  attempted list is filtered out of the skipped list.
- A medication with no dose defined (Compazine) — writes cleanly with a null dose.
- Duplicate writes — the suite does catch these; I broke it and it went red.
- Whether the banner set inside the write helper fights the one set by the caller — the
  caller's runs last and wins in every case, and the survivor is the honest one.

## Method

All sabotage was applied to copies under a scratch directory outside the repo and run with
`--file`. Each sabotage was verified applied by re-reading the changed block before drawing any
conclusion from a green. The repo working tree is unmodified: `git status` clean, `index.html`
md5 `c5826e5b…` matching what STATUS.md records, and a grep for every sabotage string finds
nothing in the tree.
