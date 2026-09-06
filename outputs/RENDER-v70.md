# RENDER v70 — somebody looked at it

Two screenshots in `outputs/render-v70/`, at 390 x 844 (iPhone 14/15 class), 2x, from the shipping
`index.html` with two closed periods seeded.

- **`v70-cycle-history.png`** — Cycle History with two periods, each carrying **Move start** and
  **Move end**. No Remove: v66 shipped one and a single unconfirmed tap destroyed a whole period.
- **`v70-move-refused.png`** — **the guard, seen.** The newest period's start is dragged onto a date
  inside the older period. The dialog **stays open with the date still in it** and says, in words:
  *"That date falls inside another period. Moving it there would merge the two into one, and the
  later period would be lost. Pick a date outside it."*

## The screenshot that changed the build

**The first capture of `v70-move-refused.png` is why this file matters.** The guard worked — the move
was refused, both periods survived — but the explanation was a **toast**, and a toast fires *behind*
the dialog's scrim and its blur. The image showed a correctly-refused move and an **unreadable smear**
at the foot of the screen. From the caregiver's side that is a Confirm button that does nothing.

The message moved inside the dialog, beside the field she has to change, modelled on the future-time
warning that was already there. `enhance-test` now asserts the text is present in the dialog, and
that check goes red when the element is removed.

**No suite would have caught this.** Every assertion about the guard passed on the toast build: the
move was refused, the periods survived, the dialog stayed open. Only looking at it found the problem.

## The 14 pixels, before and after

| | 320px viewport |
|---|---|
| v69 and back to at least v65 | `scrollWidth` **334** vs `clientWidth` 320 — the page scrolls sideways |
| v70 | **320 / 320**, with and without the What's New pop-up |

One label did it: the missed-dose chip reading *"Morning + Evening missed"*, 165px wide, with
`white-space: nowrap` and `flex-shrink: 0` — it could neither wrap nor give ground. It shows whenever
a medication misses **both** of its windows, which on Brandi's Protonix schedule is a real state.

**And the reason it survived: `overflow-scan.mjs` was blindfolded.** It passed
`Math.max(dev.w, layout.inner)` as the screen width, and under mobile emulation Chromium reports
`window.innerWidth` as the *layout* viewport, which it widens the moment a page overflows — so as
soon as anything overflowed, the scanner was told the screen had grown to fit it, and the
"off the right edge" rule could never fire. Proven rather than argued: a deliberately 400px-wide
element injected into the app shell was named **zero** times by the old scanner and on every screen
by the fixed one.

## Gates

| Suite | Result |
|---|---|
| `enhance-test` | **37/37** — 31/37 against v69, 35/37 with the guard removed, 35/37 with the in-dialog message removed |
| `overflow-scan` | **110/110 CLEAN** — NOT CLEAN against v69, and it can now name the element |
| `cycle-merge-probe` | 24/24 (the auditor's own repro) |
| `export-test` | 49/49 |
| `audit-v69-weightreport` | 11/11 |
| `para-test` | 16/16 |
| `whatsnew-test` | 30/30 |
| `takeall-test` | 29/29 |
| `glass-test` | 7/7 |
| `repaint-test` | 17/17 |
