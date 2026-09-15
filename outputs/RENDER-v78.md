# RENDER — v78, the password box on a protected backup

**Run:** `node harness/overflow-scan.mjs` against the v78 build in this tree, 2026-09-15.

```
140 of 140 screen/width combinations scanned, 0 overflowing element(s).
every screen clean at all 10 device widths (iOS and Android)
CLEAN — Android rows are high fidelity (Chromium is Android's engine); iOS rows are Chromium at
Apple viewport sizes, not Safari.
```

## What v78 changes on screen, and it is close to nothing

One keystroke handler:

```
-  onInput: (e) => setState({ bkUnlockPw: e.target.value, backupNotice: null }),
+  onInput: (e) => { state.bkUnlockPw = e.target.value; },
```

No element is added, removed, resized, restyled or moved. Nothing in the layout can have changed,
and the scan above is the evidence rather than the argument: every screen at every width is
unchanged and clean.

**The one visible difference is not layout, it is duration.** The message about a failed unlock
(*"That password did not open the file."*) now stays on screen while the password is retyped,
instead of vanishing on the first keystroke. It occupies the space it already occupied.
`bkUnlock()` clears it on the way in, so it disappears when a new attempt is actually made, which
is the moment it stops being true.

## SAID OUT LOUD: WHAT THIS SCAN DOES NOT COVER

**The screen v78 changes is not in the 140.** The password panel appears only after a
password-protected backup file has been imported, which `harness/overflow-scan.mjs` does not do —
it walks the app's own screens. So the scan proves the release broke no layout anywhere; it does
not show the changed panel.

**What does cover it is `harness/encbackup-test.mjs`, behaviourally rather than visually.** It
imports a real encrypted envelope, asserts the panel appears (`ENC-9`), asserts the panel names
nothing about the contents, and — new in this release — **presses keys one at a time and asserts
the caret is still in the box afterwards** (`ENC-9b`): RED on v77, GREEN on v78. 17/17.

**iPhone rendering is exempt, as on every release here.** This sandbox has Chromium only; the iOS
rows above are Chromium at Apple viewport sizes, not Safari, and an on-screen keyboard cannot be
reproduced at all. That matters slightly more than usual for this one, because the defect is about
what happens while a keyboard is open — so item 1 on the phone checklist is: **open a
password-protected backup on the real phone and type the password straight through.**
