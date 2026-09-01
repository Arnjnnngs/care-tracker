AUDITED-COMMIT: 0b79027
VERDICT: SHIP

# Zero Day Audit — care-tracker v63, second pass

**In one line:** all three blockers are genuinely fixed, and — the part that matters — each one
is now guarded by a check I broke myself and watched go red for the right reason. Nothing in
this build tells a caregiver anything untrue about the medication record. What is left is two
checks that still cannot fail and one half-finished documentation correction. Neither is a
defect in the app; both are the "hypothetical future regression" category, and I am saying so
plainly rather than dressing them up as blockers.

## First, a correction to my own last report

My round-1 advisory A5 said the release "exists only in a sandbox" because `origin/main` was
still on the previous commit. That was wrong. The work is pushed — to
`origin/claude/caretracker-chemowell-updates-k80ydk`, which is in sync with its remote. Rule 0
durability is satisfied; the commits are on GitHub. What is true is only that they are not on
`main` yet, so the live site still serves the previous release, which is what a pre-ship audit
should expect. `pm.py`'s unpushed-commit check reads the branch's real upstream and is working
correctly — I checked, because a dark check there would have been serious.

## The three blockers, re-broken and re-measured

Every number below is from a run I did in this tree today. Sabotage was applied only to copies
outside the repo and each one was diffed against the original to prove it applied before I drew
any conclusion from a result.

| What I broke | Suite | Red on |
|---|---|---|
| Swap which name list is reported as saved (round-1 Blocker 1) | **22/25** | All three side-checks — the failed name on the wrong side, the saved names on the wrong side, and the count |
| Drop the skipped tail from both failure paths (Blocker 2) | **24/25** | The named failure-path check |
| Revert the advisory to "something saved AND iron attempted" (Blocker 3) | **24/25** | "no Iron advisory is raised about a dose that was refused" |
| Record `savedIds` *before* the write instead of after | **24/25** | Same check — the ordering is guarded too, which was not claimed |
| Restore the old loop with no per-medication catch | **18/25** | Seven checks, including the banner sides collapsing to empty |
| The shipped v62 build | **17 passed / 8 red** | Exactly as stated |

The banner parse is correct. I pushed on the shapes you asked about: the saved side is taken
from the text before the first "were/was logged.", the failed side from there to "were/was
NOT", and I confirmed the skipped tail lands well past both, so "Evening Locked" can never be
counted as a failed medication even though it matches the counting pattern. On the swap it went
red on all three, not one.

I also confirmed the three fixture repairs genuinely fire rather than being asserted:

- **Wall-clock dependence is gone.** The skipped medication is now a gap-locked one with a dose
  seeded in the store, so it is locked at every hour. Last round I ran the suite with the clock
  fixed at 22:30 and the *correct* build failed; that is no longer possible.
- **The advisory check can now fire.** Reverting the guard makes the Iron + Protonix advisory
  actually appear and the check actually fails. Without the seeded Protonix dose it could not
  have.
- **Iron is genuinely attempted.** The button reads `Take all (5)` and Iron appears in the
  writes when nothing is refused, so refusing it is a real refusal and not a no-op.
- **The fixture trap is closed.** I listed every grouped card and checked each for Iron:
  `MORNING MEDS` does not contain it, `EVENING MEDS` does. `backfillDefaultMedFlags` copies
  only keys the saved medication does not already have, and the fixture names `groupedMorning`
  and `windows` explicitly, so it cannot pull either in.

## Two checks that still cannot fail

Both are gaps in the suite. **The shipped app is correct in both cases** — I am reporting what
would not be caught if it stopped being correct.

**1. The skipped tail can name medications that were just logged, and the suite stays green.**
I changed `groupIds.filter(id => ids.indexOf(id) < 0)` to `groupIds.map(...)`, so the tail names
everything on the card. The toast became:

> *"5 meds logged at 2:13 AM · Evening A, Evening B, Evening C, Evening Locked, Iron, Compazine
> not due yet"*

— five logged, six named as not due, in one sentence. The banner did the same, naming four
medications as logged and then saying those same four "were not due yet and were not attempted."
**25/25 green.** This is the same shape as the round-1 blocker: the check asks whether the right
name is *present*, not whether wrong names are *absent*. One clause on the existing assertion
closes it — that no medication named in the logged side also appears in the skipped tail.

**2. The stale-banner fix has no test at all.** Removing `setState({ writeError: null })` from
the success branch leaves the suite **25/25 green**. That line is a real behaviour change in this
commit — it is what stops a red banner from surviving a successful retry and telling a caregiver
to re-log doses that are now in the record — and nothing in the suite would notice it going away.
The scenario needs a second Take all in the same page with the refusal lifted; I built exactly
that as a probe last round, so it is a known-workable shape.

## Prose

- **The README correction is half done.** Line 52 now points at the `CACHE` constant instead of
  naming a version, and explains why. But line 119 still reads *"bump the `CACHE` constant in
  `sw.js` (currently `caretracker-v40`)"* — the second stale instance from my last report,
  twenty-three releases out of date, sitting a few lines below text that says the audit caught
  this. Same one-line fix as line 52.
- **The numbers now match.** "17 passed / 8 red against the live v62 build" — I measured 17/25
  with 8 failures. `takeall` 25/25, `whatsnew` 30/30, `missed-banner` 16/16, `settings` 11/11,
  `para` 16/16, `eod` 11/11, `logger` 19/19 all confirmed. `overflow-scan` 80/80 CLEAN, which I
  re-ran myself because this commit made the banner longer. `pm.py` clear with the one
  pre-existing warning about pinned version literals in six older suites. STATUS.md's md5 for
  `index.html` matches the file.
- **`outputs/RENDER-v63.md` was not regenerated.** Its screenshots and its description of the
  message text are from the previous commit, before the skipped tail was appended to the banner.
  The scan result still holds — I re-ran it — but the file describes shorter copy than the one
  that ships.

## One pre-existing limit worth stating, not a blocker

The banner tells the caregiver to re-log whatever the client saw rejected. If a write is
committed by the server but the acknowledgement is lost on the way back, the app records it as
failed and the instruction to log it again would produce a duplicate. That is inherent to a
write without an idempotency key, it is unchanged by this release, and it is far narrower than
the defect being fixed — but it is the one remaining path to a double-logged dose.

## Method

Seven sabotages, each applied to a copy under a scratch directory outside the repo and run with
`--file`, each verified applied by diffing the changed block before any conclusion was drawn
from a green. The repo working tree is unmodified apart from this report: `git status` clean,
`index.html` md5 `14376a57…` matching STATUS.md, and a search for every sabotage string finds
nothing in the tree. No commits, no pushes, nothing outside this repository touched.
