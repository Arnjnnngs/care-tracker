# Render check — care-tracker v64

`harness/overflow-scan.mjs --shots` — **80 of 80 combinations, 0 overflowing, CLEAN** across 10
phone widths (320 → 428).

## Screenshots actually looked at

- **`320-whatsnew-popup.png`** — all three bullets fit the narrowest phone without scrolling. The
  first draft was longer and ran off the bottom, **and the scan reported 80/80 CLEAN for it**.
  Third release running that opening the picture caught what the number could not: the scan
  measures whether text fits its box, not whether a patient can read it.
- **`320-home.png`** — Home renders complete. This is the release that changes when Home is
  redrawn at all, so a missing card here would be the failure that matters.

## The thing this release changes, and why a render check is not enough on its own

The screen used to be rebuilt once a second forever. It is now rebuilt only when something a
person could see would differ. **The danger in that fix is the opposite defect — a screen that
goes stale** — and a layout scan cannot see stale: it screenshots one moment and measures boxes.

That is what `harness/repaint-test.mjs` is for, and it drives the app's own clock rather than
waiting on the wall clock. It asserts both halves: no rebuild during four idle seconds inside one
minute, and the clock moving the moment the minute turns, an hour later, and a medication
unlocking mid-minute at the second it is actually due. Falsified three ways — gate removed (4
idle rebuilds), signature frozen (clock stuck at 10:00), and minute-only (medication does not
unlock until the minute turns).

`harness/cal-test.mjs`'s `TICK-positive-control` was rewritten rather than deleted: it asserted
"the app DOES repaint every second", which this release deliberately makes false. Its purpose —
proving the "survives the tick" checks are not vacuous — is unchanged, but it now measures the
**displayed clock** across a minute boundary. A first rewrite marked the header element and
checked it had been replaced, and **that passed against a build sabotaged to freeze the screen
permanently**, because some other path repaints during the wait. Vacuous is the one thing a
positive control may not be.

## After the audit — three additions, none of them layout

The Zero Day Audit returned **SHIP** and then named three things worth folding in. All three are
in the shipped file, and each was falsified before being believed.

1. **The tick is wrapped in `try/finally`.** If `render()` ever threw, the exception escaped the
   interval callback and left the repaint flag stuck on — after which every render, including the
   one a caregiver's tap triggers, went through the signature gate. Measured with a forced throw:
   the next tap inside the same minute painted **nothing at all**. It self-healed on the following
   tick and the auditor found no reachable way to make `render()` throw today, but the class costs
   one line to remove. Falsified by taking the `try/finally` back out: `repaint-test` drops to
   **15/16**.
2. **The seconds countdown is now tested.** It was the one branch of the signature that worked and
   was guarded by nothing. Real build: the *"Opens in …"* prompt counts `35s -> 32s`. Frozen
   signature: `35s -> 35s`.
3. **`tour-test` got its own `TICK-positive-control`.** Same reasoning as `cal-test`'s: without it,
   its "survives the tick" checks could pass on an app that never repaints at all.

`repaint-test.mjs` is now **16/16**, and `tour-test --file` **60/70** — the two added checks pass,
and the ten failures are the same pre-existing `--file` artefacts, identical on the shipped v63
build.

## The re-verify found two more, both in the test files

`index.html` changed after the audit said SHIP, so the auditor went back over the delta only. It
returned **SHIP** again, having reproduced every number in these notes itself rather than taking
them — 16/16, 15/16 without the `try/finally`, `35s -> 32s`, `35s -> 35s`, and the ten `tour-test`
`--file` failures byte-identical to the shipped v63 build. It also found two things worth fixing,
neither of them in the app:

**`repaint-test` §5 could not tell a live hook from a dead one.** The section forces `render()` to
throw and checks the next tap still paints. Rename the injected flag so the app never throws, run
against a build with the `try/finally` **removed**, and the whole suite went green — nothing
asserted that the throw had actually happened. Now it does. Reproduced both ways here: real hook
**17/17**; dead hook against the no-fix build **16/17**, with only the new assertion red.

**A comment in `tour-test` stated something false, and it was my number.** It told the next reader
that three "survives the tick" checks could no longer fail after v64. Measured: all three still go
red when the guard term is deleted — `TICK-drawer-survives` 0/2, reproduced four times, plus
`TYPE-appt-sheet-survives` and `TICK-no-repaint-under-tour`. The "0 rebuilds" figure is real but
comes from a **frozen** clock; `tour-test` runs on the real one, where a minute turns inside its
window often enough that a repaint lands. The comment is corrected, and the control stays — what
is true is that those three now depend on a real minute happening to turn, which is weather rather
than physics. A comment telling the next reader that three working checks cannot fail is an
invitation to delete them.

**Cost note:** `tour-test` now waits to a real minute boundary once per viewport — up to ~2 minutes
added to a full run.
