# Render check — care-tracker v65

`harness/overflow-scan.mjs` — **80 of 80 combinations, 0 overflowing, CLEAN** across 10 phone
widths (320 → 428).

## What this release changes, and why a layout scan cannot see it

v65 removes 52 of the app's 56 live `backdrop-filter` blurs. A layout scan measures whether text
fits its box; it cannot see a dropped frame, and it cannot see whether the app still *looks* like
itself. Both of those needed different checks.

## Screenshots actually looked at

- **`v65-drawer.png`** — opened beside the v64 shot and compared. **The menu panel is pixel-for-
  pixel what it was**, and the screen behind it is still softly blurred, because the four scrims
  keep their blur. This was not the first attempt: with the scrim blur removed and the scrim
  darkened to 0.62 instead, the red "MISSED DOSES" text behind the menu was still plainly legible
  and the menu stopped reading as a layer floating over the app. **The screenshot caught that; no
  number did.**
- **`v65-home.png`** — Home renders complete. The first pass left the bottom navigation bar at
  0.985 opacity, and with no blur behind it the list text bled visibly through. Header and nav are
  now opaque. Again: visible in the picture, invisible to every check.

## The measurement, on Aaron's actual screen size

360×780 CSS at 3× (his Galaxy is 1080×2340), scrolling for 3 seconds with the menu open:

| build | frames rendered | frames over 32ms |
|---|---|---|
| v64 (what he has) | **134** | **47** |
| v65 | **181** | **0** |

## What was kept

The four modal/drawer **scrims** keep `blur(8px)`. Measured with only those restored: 181 frames,
0 janky — they are cheap because a scrim's backdrop is a static screen, not fifty scrolling cards.
Everything else sat on the page's smooth pink gradient, and blurring a smooth gradient returns the
same gradient, so removing those blurs is visually a no-op.

## An honest limit of the new suite

`harness/glass-test.mjs` is 7/7 here and 4/7 against v64. But **its Home jank check passes on v64
too** — headless Chromium's software compositor does not reproduce what Aaron's phone does while
scrolling Home. Home is therefore guarded by the *layer count* check (18 blurred elements on v64,
0 on v65), not by a frame measurement. That is a real gap and it is written down rather than
papered over.
