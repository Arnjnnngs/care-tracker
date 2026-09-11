# RENDER v75 — somebody looked at it

`harness/overflow-scan.mjs` on the FINAL build: **CLEAN**, every screen at all ten device widths
(320 to 428).

## What changed on screen

A **"Removed medications"** section at the foot of the Meds screen, below the active cards. Each row
is the medication's name, its generic name, and a **Bring back** button that arms to **Yes, bring it
back** before it does anything.

**It renders only when something has actually been removed.** With nothing in the archive there is
no heading, no explanatory sentence, nothing — and the suite asserts that rather than skipping it.
A notice about an empty list is the defect the sibling app's audit found in the v74 disclaimer, and
this screen is where that lesson applies next.

Each row carries `overflowWrap: 'anywhere'`, because the medication name is text the caregiver typed
and pass 7 of the v74 audit measured a pasted pharmacy name pushing Home to 1019px and carrying the
bottom tab bar off the screen. The scan is CLEAN, and the scan measures WIDTH only — it said CLEAN
over two visibly broken screens once already, so it is not evidence that nothing else moved.

**Deliberately exempt, said out loud:**

- **iPhone rendering.** Chromium only in this sandbox, so the iOS rows are Chromium at Apple
  viewport sizes, not Safari. Unchanged from every release before this one.
- **The Home screen is untouched.** Nothing about removed medications appears there. Home is what
  she taps at 2am; a list of things that are not being taken has no business on it.
- **The missed-dose engine is untouched.** Not one line of `missedDosesFor()` changes. The safety
  argument for this release is that a restored medication comes back with reminders OFF, which is
  handled where the medication is restored rather than by teaching the engine a new rule.
