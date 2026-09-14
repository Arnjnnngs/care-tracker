# RENDER v76 — somebody looked at it

`harness/overflow-scan.mjs` on the final build: **CLEAN**, every screen at all ten device widths
(320 to 428).

## What changed on screen

**Nothing moved, and that is the point of this release.** v76 changes which of two warning banners
is on the screen after a dose is logged. It adds no control, no card, no section and no new string
to any screen except the What's New pop-up.

The banner itself is the one the app has always drawn: a red or amber box at the top of Today with
an icon, a title, a body and a close control. Its markup, its padding and its colours are
untouched. What changed is which of the two the app puts in that box, and — the whole of the fix —
that an amber note no longer replaces a red one that is still on the screen.

## The one visible addition: the What's New pop-up

An entry titled **"A safety warning can no longer be pushed off the screen"** with three lines. It
renders in the same modal every previous release has used, and `harness/whatsnew-test.mjs` is
**30/30** on it, including the check that the pop-up names the version actually running — which is
how this entry came to be written at all: the suite went red at 29/30 the moment `APP_VERSION`
moved without a changelog row.

## What was read, and by whom

The **Voice**'s three questions, on the three new lines:

1. **Is it true?** Yes, and it is measured rather than asserted. `harness/warning-priority-test.mjs`
   drives the real screen — logs Tylenol past the ceiling through the app's own override, then taps
   the real "Take all" — and reads the banner out of the live DOM. 18/18 on this build, **15/18 on
   v75**, so the sentence "the red one stays" describes behaviour that is reproduced on the build
   currently live and reproduced as broken there.
2. **Would a tired person understand it at 2am?** The lines name what she sees — the red warning,
   the amber note, the Take all button — and never `state.warn`, `afterLog` or a batch token.
3. **Does a number about the patient belong on the screen?** There is no new number. The figures in
   the red banner (today's total, the daily limit) are the ones the app already printed, and a
   clinician uses both.

One further rule, from v64 and v65: **never promise a fix that has not been confirmed on her own
phone.** This entry promises nothing about her phone. It says what the app does now, and the phone
check is written down separately in `STATUS.md`.

## Deliberately exempt, said out loud

- **iPhone rendering.** This sandbox has **Chromium only**. The overflow scan's iOS rows are
  Chromium at Apple viewport sizes, not Safari, and its own summary line says so. Android rows are
  high fidelity because Chromium is Android's engine.
- **The scan measures WIDTH.** It has reported CLEAN over two visibly broken screens before, so it
  is evidence that nothing overflows and not evidence that nothing else moved. On this release the
  stronger evidence is that no render code changed at all: the diff is `afterLog`, one line in the
  "Take all" branch, and the changelog array.
- **The 320px Home overflow the sibling staging app is carrying** is not present here. Production's
  missed-dose banner already has `minWidth: 0` on its text column, from the v60 banner redesign, and
  its rows already wrap. The staging copy predates that redesign; its fix shipped as `beta-v64`.

## Needs her phone, after this ships

Log Tylenol past the daily limit through the override so the red banner appears, then tap **Take
all** on the evening meds within two hours of a Protonix dose, and confirm the **red** banner is
still the one on screen.
