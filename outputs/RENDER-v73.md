# RENDER v73 — somebody looked at it

`harness/overflow-scan.mjs` on the FINAL build: **140 of 140 screen/width combinations CLEAN**, every
screen at all ten device widths (320 to 428). Re-run from scratch after each copy change, because a
record describing a file that is not the one shipping is worse than no record.

Looked at with my own eyes:

- `outputs/v73-shots/1-history-corrected-weight.png` (390 x 844, taken by the suite that asserts on the
  same run, so the picture and the check cannot describe different builds) — a weigh-in typed as 156.2
  and corrected to 142, and a paracentesis logged at 4.0 L and corrected to 4.5. **Both replaced rows
  are dimmed, marked SUPERSEDED, and carry no Remove**; only the corrections do. The day summary reads
  *1 dose · 1 wt · 1 MISSED* — the weigh-in counts once, not twice.
- `2-weight-report-after-remove.png` / `3-para-report-after-remove.png` — after Remove on the
  correction, both reports are empty. **156.2 did not take its place.** On v72 it did.
- `render-v73/320-whatsnew-popup.png` — the note Brandi reads, at the smallest phone size.
  **Two rewrites.** The audit's Voice pass killed *"always takes effect now"* (untrue offline); the
  replacement then crammed three facts into one bullet that ran five lines at 320px, which only
  reading the screenshot caught. It is three short bullets now, one idea each.

**Deliberately exempt, said out loud:** iPhone rendering. This sandbox has Chromium only, so the iOS
rows are Chromium at Apple viewport sizes, not Safari.

**Seen and left alone:** after a removal, History shows the old rows chipped SUPERSEDED and the
tombstone chipped REMOVED. Accurate but noisy — "Superseded" is the wrong word once the whole reading
is gone. Fixing it needs a group-is-cancelled helper across four record types, which is widening a
patient's app beyond what this release is for. It is on the list as a proposal for Aaron.
