# RENDER v74 — somebody looked at it

`harness/overflow-scan.mjs` on the FINAL build: **140 of 140 screen/width combinations CLEAN**, every
screen at all ten device widths (320 to 428). Re-run from scratch after the audit's copy changes,
because a record describing a file that is not the one shipping is worse than no record.

Looked at with my own eyes (`outputs/v74-shots/`, taken by the suite that asserts on the same run):

- `1-meds-screen.png` — the medication cards with their new line: *Buspirone / BuSpar / "Eases
  anxiety."*, *Compazine / Prochlorperazine / "Settles nausea and vomiting."* The disclaimer sits
  once above the list, not repeated under thirteen cards. **The first version of this screenshot was
  worthless** — it captured the top of the screen, which is the reorder list, not the part that
  changed. The suite scrolls to the first card before it shoots now.
- `2-typed-purpose.png` — a caregiver-typed line replacing the built-in one.

**Deliberately exempt, said out loud:**
- **The Home quick-log cards carry none of this**, and the suite ASSERTS that rather than skipping
  it. Home is the screen she taps at 2am; every extra line there sits between her and the dose button.
- **iPhone rendering.** Chromium only in this sandbox, so the iOS rows are Chromium at Apple viewport
  sizes, not Safari. The Meds cards are taller now, which is exactly the kind of change a real phone
  should confirm.

**Seen and left alone:** the reorder list at the top of the Meds screen shows medication names with
no purpose line. That list is about ordering the Home cards, not about the medications themselves,
and adding thirteen more lines would make the thing it exists for harder to use.
