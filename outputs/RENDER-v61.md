# Render audit — v61

Run: `harness/overflow-scan.mjs`, 2026-08-31, against `index.html` at v61.
Screenshots: `outputs/render-v61/` — 80 images, one per screen per width.

**80 of 80 screen/width combinations scanned, 0 overflowing elements. CLEAN.**

Eight passes across ten widths, iOS and Android:
Home, Meds, Reports, In-Patient, Symptoms, the medication editor, **What's new**, and
**the update notice**.

Widths: 320, 330, 345, 360, 375, 384, 390, 393, 412, 428.
320 is the iPhone SE/mini floor. 360 is the most common Android width in the world.

## What this run is worth, and what it is not

**The first run of this scan after v61 was built reported "50 combinations, CLEAN" and had
never opened either new screen.** Every overlay pass was re-verified by looking for a Save
button — a marker that exists only in the medication editor — so any screen added later
would have been reported unreachable no matter how well it rendered. A render gate that
skips the thing under change is worse than no gate, because it reads like coverage.

That is fixed, and both new screens now have to earn the pass:

- **What's new** must list more than ten releases. A heading alone is what a broken screen
  also shows.
- **The update notice** is produced the way an update really happens — seed a version the
  phone has already seen, reload, require real content. The decision is made once at
  start-up, so no click can create that state.

**The reported total was also wrong** — it counted widths × tabs and left every overlay pass
out, so it said 50 while walking 80. The coverage was real; the number understated it. Now
counted from what actually ran.

## What it still cannot tell you

These are Chromium at Apple viewport sizes, not Safari. The scan catches a box too small for
its content, which is most "text spills out" defects. It does not catch WebKit font metrics.

It measures **horizontal** overflow only. A layout that pushes content below the fold — the
kind of defect recorded against ChemoWell's Help search screen — is invisible to every rule
in this file.

**Nobody has seen v61 on a real iPhone.** That is the one check worth Aaron's ten seconds
when this ships.
