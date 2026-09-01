# Render check — care-tracker v63

`harness/overflow-scan.mjs --shots` — **80 of 80 screen/width combinations, 0 overflowing
elements, CLEAN**, across 10 phone widths (320 → 428).

## Screenshots actually looked at

- **`320-whatsnew-popup.png`** at the narrowest phone. All four bullets of the v63 entry are
  present and readable. The first draft was a paragraph long and ran past the bottom of the
  screen; it was rewritten and re-rendered before this was recorded. **The scan said 80/80 CLEAN
  for the long version too** — it measures whether text fits its box, not whether a patient can
  read it. That is the second release running where opening the picture caught something the
  number could not.
- **`320-home.png`** — the Evening meds card and its **Take all** button are the control this
  release changes; Home renders complete, with the grouped cards, the Quick Log cards and their
  dose buttons all present.

## What changed and why the render matters here

The change is inside `confirmTimeAndLog()`'s `multi` branch and the `Take all` button's
`onClick`, plus a new `groupIds` field carried on the time modal. No new `h()` call and no
layout change — but the toast is now longer ("N meds logged at 1:20 AM · Iron not due yet") and
the write-failure banner can now be several sentences naming medications on both sides. Both are
existing components given more text, which is exactly the shape that overflows a 320px phone, so
the scan and the screenshots were re-run after the copy was finalised rather than before.
