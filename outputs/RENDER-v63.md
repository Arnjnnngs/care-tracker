# Render check — care-tracker v63

`harness/overflow-scan.mjs --shots` — **80 of 80 screen/width combinations, 0 overflowing
elements, CLEAN**, across 10 phone widths (320 → 428). Re-run after the failure banner grew a
"not due yet" tail, because that is the longest string this release can put on screen.

## Screenshots actually looked at

- **`320-whatsnew-popup.png`** at the narrowest phone. All four bullets of the v63 entry fit and
  are readable. The first draft was a paragraph and ran off the bottom of the screen — **and the
  scan reported 80/80 CLEAN for that version too.** It measures whether text fits its box, not
  whether a patient can read it. Second release running that opening the picture caught what the
  number could not.
- **`320-home.png`** — the Evening meds card and its **Take all** button, which is the control
  this release changes. Home renders complete: grouped cards, Quick Log cards, dose buttons.

## The longest thing this release can display

The write-failure banner is now assembled from up to three parts and can reach, in one alert:

> Evening A, Iron, Compazine were logged. Evening B, Evening C were NOT. Log only the missing
> ones again — the rest are already saved. Evening Locked was not due yet and was not attempted.

That is longer than anything the previous build could show there, and it is the reason the scan
and the screenshots were re-run after the copy was final rather than before. The banner is an
existing component given much more text, which is exactly the shape that overflows a 320px
phone.

## What changed in the app

`confirmTimeAndLog()`'s `multi` branch and the Take all button's `onClick`, plus a `groupIds`
field on the time modal. No new `h()` call and no layout change.
