# RENDER v71 — somebody looked at it, and this time somebody dragged a finger

Four screenshots in `outputs/render-v71/`, at 390 x 844, 2x, with sixty days of doses seeded so the
page behind the menu is genuinely long.

## Measured, not described

Same script, same seed, same drag — the menu opened at a scroll offset of 600, then the page was
dragged another 700:

| Build | After dragging with the menu open |
|---|---|
| **v70** (what is live now) | `scrollY` **1300** — the page slid 700px behind the open menu |
| **v71** | `scrollY` **0**, body pinned at `top: -600px` — **it did not move** |

- **`v70-before-menu-open-before-drag.png` / `-after-drag.png`** — the bug Aaron reported. The blurred
  content behind the panel is in a different place in the second image. Because four of the five
  overlays sit on a blurred scrim, what he actually sees is the smear moving, which reads as the app
  coming apart.
- **`v71-menu-open-before-drag.png` / `-after-drag.png`** — identical. The page holds still, and
  closing the menu returns to exactly 600.

## What is deliberately NOT locked, said out loud

**The toast.** A toast says *"Tylenol logged at 6:04 PM"* and disappears; freezing the page for
three seconds after every dose would be its own defect. Aaron named it in the same breath as the
menu, so it was checked rather than assumed — it has no scrim and no blur, and the page moving under
it is what a toast is for. `scrolllock-test` asserts the toast does **not** lock, so this exemption
is a decision on the record rather than an oversight.

**The tour**, for the same kind of reason: it walks the caregiver around the app and needs the page
to move.

## The regression this caused, and why it was the test's fault rather than the app's

`para-test` dropped from 16/16 to 15/16 the moment the lock went in. It found the dialog's Confirm
button by asking for the nearest ancestor whose style attribute contained `position: fixed` — and
the lock puts `position: fixed` on the **body**, so that ancestor became the whole document and the
search started returning the Home card's own *Log* button. **The app was correct; the selector was
never safe.** Rule 5 has said so for months: elements by explicit `data-` hooks, never by text or a
style substring. The dialog now carries `data-time-modal`, the suite uses it, and it still passes
16/16 against v70 through a fallback, so it is not pinned to this release.

## Gates

| Suite | Result |
|---|---|
| `scrolllock-test` | **23/23** — **12/20 of the comparable checks against v70**, including `400 -> 1000`, the drag itself |
| `enhance-test` | 37/37 |
| `overflow-scan` | 110/110 CLEAN |
| `export-test` | 49/49 |
| `para-test` | 16/16 (and 16/16 against v70) |
| `cycle-merge-probe` | 24/24 |
| `audit-v69-weightreport` | 11/11 |
| `whatsnew-test` | 30/30 |
| `takeall-test` | 29/29 |
| `glass-test` | 7/7 |
| `repaint-test` | 17/17 |
