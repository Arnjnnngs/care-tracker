# RENDER v73 — somebody looked at it

`harness/overflow-scan.mjs`: **140 of 140 screen/width combinations CLEAN**, every screen at all ten
device widths (320 to 428), History, Bowel Movement and Appetite included.

Looked at with my own eyes (`outputs/v73-shots/`, 390 × 844, taken by the suite that asserts on the
same run, so the picture and the check cannot describe different builds — sent to Aaron as produced):

- `1-history-corrected-weight.png` — a weigh-in typed as 156.2 and corrected to 142, and a
  paracentesis logged at 4.0 L and corrected to 4.5. **Both replaced rows are dimmed, marked
  SUPERSEDED, and carry no Remove**; only the two corrections do. The chips sit inline with the
  name and do not wrap. The day summary reads *1 dose · 1 wt · 1 MISSED* — one dose is right
  (the Compazine), and the weigh-in counts once rather than twice.
- `2-weight-report-after-remove.png` — after Remove on the correction, the Weight report is empty.
  **156.2 did not take its place.** On v72 it did, and the suite prints that row.
- `3-para-report-after-remove.png` — the same for the paracentesis.

**Deliberately exempt, said out loud:** iPhone rendering. This sandbox has Chromium only, so the iOS
rows of the scan are Chromium at Apple viewport sizes, not Safari.

**Seen and left alone:** the scan's seed shows a medication as its raw id (`children-s-liquid-tylenol`)
because that seeded id is not in the default medication list. That is `nameOf`'s documented fallback
for an unknown medication, unchanged by this release, and it is an artefact of the test seed rather
than anything a real device shows.
