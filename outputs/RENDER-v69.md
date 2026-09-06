# RENDER v69 — somebody looked at it

Four screenshots in `outputs/render-v69/`, captured at 390 x 844 (iPhone 14/15 class) at 2x, from
the shipping `index.html` with three weight readings and two paracentesis procedures seeded.

## What was looked at, and what it showed

- **`v69-weight-report.png`** — the Weight report, populated. Each row now reads
  `Fri, 9/4 · 6:46 PM · 156.2 lbs · [Edit] [Remove]`. Both buttons clear the 44px tap-target floor
  and neither crowds the weight value. This is the screen that could add a reading but not fix one.
- **`v69-weight-remove-armed.png`** — Remove tapped on the newest row: it becomes a red **Delete**
  beside **Keep**, and the other two rows are untouched. **The armed state now expires by itself
  after six seconds**, which it did not in the first build of this release.
  Worth noting where the buttons land: the caregiver taps **Remove** on the right, and the right
  position then becomes **Keep**. A reflex second tap in the same place is the safe one.
- **`v69-weight-edit-modal.png`** — the edit dialog: **Edit Weight**, a prefilled `Weight (lbs)`
  field at 16px (the iOS zoom floor), the date already recorded, and the quick-day row correctly
  highlighting *2 days ago* for a reading two days old. The hint reads *"Showing the date already
  recorded"* — true of what is on screen, which is not something this project can take for granted:
  v66 shipped a hint reading *"Defaults to now"* above a field showing a date three days old.
- **`v69-paracentesis-report.png`** — **Total drained is still there.** This release nearly deleted
  it; the screenshot is the proof it did not.

## What the second audit changed after these images were taken

The readings list used to be built from whatever the Weeks/Months toggle was showing, so a reading
older than the window had **no Edit and no Remove at all** — the correction feature had an invisible
horizon, under a heading reading *"All Readings"* that was not true. The chart stays windowed; the
list now shows every reading. The screenshots were **retaken from the final build** rather than left
as they were: all three seeded readings fall inside four weeks, so the screen looks the same, but a
render doc showing a screen that no longer exists is the exact kind of false claim this project
keeps paying for.

## Two things seen and deliberately NOT changed

1. **The Weight report carries an "Average" stat card.** Having just retired the paracentesis
   average, the reflex is to retire this one too. **The reflex is wrong, and it is the same reflex
   that nearly deleted Total drained this morning.** A paracentesis volume depends on how long fluid
   has been accumulating, so averaging those volumes describes nothing. Weights are repeated
   measurements of the same quantity — a mean over a stated window is a real central tendency and
   invites no false comparison. It stays. Flagging it here rather than acting on it.
2. **The "Back" pill and the bottom nav appear over the paracentesis line in these images.** That is
   a full-page-capture artifact: both are `position: fixed`, so a stitched full-page screenshot draws
   them at their viewport offset. In the viewport they sit at the bottom, and `overflow-scan` walks
   the real viewport at ten widths.

## Gates

| Suite | Result |
|---|---|
| `enhance-test` | **27/27** — every new check falsified against a mutant first |
| `audit-v69-weightreport` | **11/11** — and **7 passed / 4 failed** against the build it blocked, so all four of its checks are proven able to fail |
| `overflow-scan` | **110/110 CLEAN** — now including the Weight, Paracentesis and Cycle report *detail* screens |
| `export-test` | **49/49** — this suite had been dead since v64 and nobody had run it |
| `para-test` | 16/16 |
| `whatsnew-test` | 30/30 |
| `takeall-test` | 29/29 |
| `glass-test` | 7/7 |
| `repaint-test` | 17/17 |

`overflow-scan` was 80/110 on its first run with the new report passes — thirty combinations
unreachable, reported NOT CLEAN. That is the new passes proving they can fail, observed rather than
asserted; the cause was an earlier pass reloading the page and emptying the seeded records.
