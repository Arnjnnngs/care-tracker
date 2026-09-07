# RENDER v72 — somebody looked at it, on the three screens this release changes

`harness/overflow-scan.mjs`: **140/140 CLEAN** — every screen at all ten device widths (320 to 428), and for the
first time the scan opens **History, Bowel Movement and Appetite**, which had no per-row hooks until v72 gave them
some. Its seed now carries a superseded bowel answer, so the new *Superseded* chip is on screen at every width.

Looked at with my own eyes (`outputs/v72-shots/`, 390 × 844, sent to Aaron as they were produced):

- `1-home-banner-before.png` / `2-home-banner-after.png` — the Bowel Issue Active banner for a day three days old;
  after Update it is gone and the end-of-day card says today is still unanswered, which is true.
- `5-history-labels.png` — two replaced answers for one day dimmed and marked SUPERSEDED, the live one carrying the
  only Remove. The chip sits inline with the name and wraps cleanly at 390.
- `4-symptoms-after-edit.png` — one row after an edit at nine days old, note corrected, no duplicate.
- `3-report-bowel.png` — the corrected day appears once on the Bowel Movement report.

**Deliberately exempt, said out loud:** iPhone rendering. This sandbox has Chromium only; the iOS rows of the scan
are Chromium at Apple viewport sizes, not Safari. Needs Brandi's phone: the History chips and the banner update.

**Seen and left alone:** a toast overlaps the floating Back pill for its three seconds on History. It did before v72
and it is a toast; Rule 5.5's exemption for toasts stands.
