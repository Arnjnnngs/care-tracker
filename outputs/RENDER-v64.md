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
