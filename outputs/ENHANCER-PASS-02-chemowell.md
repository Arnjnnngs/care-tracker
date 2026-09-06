# Enhancer pass 02 — ChemoWell

Aaron, 2026-09-06: *"we probably need to make sure the same applies to chemowell where allowed."*

It does. **ChemoWell has every one of care-tracker's four gaps, plus a fifth of its own.** Run
against `chemowell-app-beta` at `40c8ba6` (app-v70, the published baseline).

## What each screen actually offers

Read off the real button labels, not inferred.

| Screen | Add | Add for another day | Edit | Remove |
|---|---|---|---|---|
| **Paracentesis** | **no** | **no** | **no** | yes |
| **Weight** | **no** | **no** | **no** | no |
| **Cycle** | yes | yes (`+`) | **no** | **no** |
| **Radiation** | **no** | **no** | **no** | **no** |
| Symptoms | yes (`+`) | — | no | via History |
| Appetite | no | no | no | via History |
| Bowel Movement | no | no | no | via History |

**Paracentesis is identical to care-tracker's**: Delete / Keep / Remove and nothing else. It can
destroy a record but not create or correct one.

**Radiation is ChemoWell-only and the worst of the set** — no controls at all, and its empty state
reads *"No radiation sessions logged yet. Log them from the Radiation sessions card on Home."*
Another sentence the app wrote about its own incompleteness.

## How much of the care-tracker fix ports

More than half, but **not by copy-paste**:

- **The paracentesis model is the same.** ChemoWell already documents it in the file: *"Correct or
  remove by appending another document with the SAME paraId and a newer loggedAt."* The supersede
  edit shipped in care-tracker v66 works here unchanged in shape.
- **The cycle model is different.** ChemoWell's time modal uses a `period` type where care-tracker
  uses `marker`, and there is no `logMarkerForDay()`. The add-then-remove edit has to be rewritten
  against ChemoWell's own helpers, not lifted.
- **`reportAddRow()` does not exist here** and would need porting.
- **Radiation is new work** with no care-tracker equivalent.
- **Storage differs**: ChemoWell is localStorage-only with no Firestore and no 48-hour delete
  window, so the "supersede instead of delete" argument is about consistency with the existing data
  shape rather than about a security rule.
- **Spelling differs and must stay different**: ChemoWell says **litres**, care-tracker says
  **liters**. `harness/para-test.mjs` enforces one spelling per app. Do not unify them.

## Why this is not being built in the same block as care-tracker v66

**The v66 design is still under audit.** The cycle edit's add-then-remove ordering and the
paracentesis supersede are exactly the mechanics an auditor is currently trying to break. Copying
an unratified design into a second app that a patient depends on would double any flaw before it
was found. This is sequencing, not delay: the moment v66's verdict is in, this port is
straightforward and mostly mechanical.

## Proposed, once v66 is ratified

| # | Change | Size |
|---|---|---|
| A | Port `reportAddRow()` and add it to Paracentesis and Weight | S |
| B | Edit on paracentesis rows (same supersede mechanic, already documented in ChemoWell's file) | S |
| C | Edit + Remove on Cycle history, rewritten against the `period` modal type | S–M |
| D | Add / Edit / Remove on the Radiation report — the largest piece, no care-tracker equivalent | M |
| E | All four as one release | **M** |

**Recommendation: E**, for the same reason as care-tracker — one audit, one version bump, one
"what's new" entry, and the app is consistent at the end of it rather than partway.
