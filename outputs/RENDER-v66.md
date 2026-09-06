# Render check — care-tracker v66

`harness/overflow-scan.mjs` — **80 of 80 combinations, 0 overflowing, CLEAN** across 10 phone
widths (320 → 428).

## Four things the screenshots caught that every check passed

The scan was CLEAN and all fifteen new checks were green for each of these. None of them is an
overflow; all four are the screen being wrong in a way only a person looking at it can see.

1. **The Cycle history date wrapped across four lines.** Three buttons sharing the row with
   `8/27/2026 – 8/31/2026 (5 days)` squeezed it to nothing at 360px, and 320px is narrower still.
   The controls now sit on their own row beneath the date.
2. **The floating "Back" pill sat on top of the last row's Edit button** on Paracentesis. It is
   `position: fixed`, so whatever the last row happens to be is underneath it — survivable while
   the only control was Remove at the far right edge, not once Edit occupied the middle. Every
   report detail now ends with tail room so the last row scrolls clear.
3. **The hint said "Tap Start or End" while the buttons said "Move start" and "Move end".** Text
   naming controls that do not exist under that name — the same class of defect this release fixes.
4. **"Defaults to now" was false when editing.** The edit dialog opens on the record's own date, and
   that line sat directly beneath a field reading 09/03 while claiming to show the current time.

## Screenshots actually looked at

- **`v66-paracentesis.png`** — the add row at the top, Edit and Remove on every procedure.
- **`v66-para-edit.png`** — the edit dialog: Liters drained, Date & Time, quick-day shortcuts.
- **`v66-cycle.png`** — date on its own line, Move start / Move end / Remove beneath it.
- **`v66-weight.png`** — the add row on the empty state, which is the path the first draft of the
  patch missed entirely (it rewrote one of the two return paths; the count check caught it).
