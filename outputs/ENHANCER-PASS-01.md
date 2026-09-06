# Enhancer pass 01 — can the caregiver finish the job on the screen she is on?

Run 2026-09-06 against live **v65**, prompted by Aaron: *"there isn't a way to add a para from the
reports screen. there also a way to edit cycles."*

Both confirmed. **The paracentesis one is worse than reported** — see below. And the pattern is
systematic rather than two isolated misses.

## What each screen actually offers

Read off the real button labels in `index.html`, not inferred. (A first pass using keyword
matching reported *"Add: yes"* for Paracentesis, which has no add control at all — a loose pattern
matched something else. Presence checks pass on nonsense.)

| Screen | Add | Add for another day | Edit | Remove |
|---|---|---|---|---|
| **In-Patient** | yes | yes (`+`) | **yes** | yes |
| **Calendar / appointments** | yes | yes | **yes** | yes |
| **Cycle** | yes | yes (`+`) | **no** | yes |
| **Symptoms** | yes (`+`) | — | **no** | via History |
| **Paracentesis** | **no** | **no** | **no** | yes |
| **Weight** | **no** | **no** | **no** | via History |
| Appetite | no | no | no | via History |
| Bowel Movement | no | no | no | via History |
| History | — | — | **no** | yes |

**In-Patient and Calendar are the model.** They have the full set. Nothing else does, and there is
no reason for the difference beyond the order things were built in.

## The three findings, in priority order

### 1. Paracentesis: the screen deletes but cannot add — and cannot correct

Reports → Paracentesis shows totals, an average, and every procedure with a **Remove** button. To
record a new one you must leave, go to Today, and use the card there. **A screen that can destroy a
record but not create one is backwards** — the destructive action is the easy one.

It also cannot correct a wrong figure. If 4.5 L was typed as 45 L, the only route is delete and
re-add.

**The app already admits this.** Its own empty state reads: *"No paracentesis procedures logged
yet. Log the liters drained from the card on Today."* That sentence is a bug report the app wrote
about itself.

### 2. Cycle: no way to fix a period logged on the wrong day

Reports → Cycle can start a period, end one, log either for another day, and delete an entry. It
cannot **edit** one. A period start logged a day late is corrected only by deleting and re-adding —
two destructive-feeling steps for what is a typo.

### 3. Weight: same shape as Paracentesis, not yet reported

Reports → Weight has only a Weeks/Months toggle. No add, no edit, no remove — and its empty state
says *"Log your first weight on the Today tab."* Aaron did not raise this one; it is the same
defect and it is listed here because the pass found it, not because anyone asked.

## Proposed, with sizes — Aaron picks, nothing is being built yet

| # | Change | Size |
|---|---|---|
| A | Add a **`+` add-paracentesis** control to the Paracentesis report, reusing the existing Home flow (liters + time modal) so there is one code path, not two | **S** |
| B | Add **edit** to Paracentesis rows (liters and date) | S–M |
| C | Add **edit** to Cycle history rows (start/end dates) | S–M |
| D | Add a **`+` add-weight** control to the Weight report | S |
| E | Do all four as one release, so the app becomes consistent in a single step rather than four | **M** |

**Recommendation: E.** The four are the same change to four screens, they share the time-modal
plumbing that already exists, and shipping them together means one audit, one version bump, and one
"what's new" entry Brandi has to read — instead of four. Doing them piecemeal costs more and leaves
the app inconsistent in between.

**Whichever is chosen, it needs the full chain** — this touches how records are written and edited,
which is the "big changes" category: builder plus an independent adversarial auditor, and every new
control falsified.

## What this pass did not cover

Only the screens listed. Settings, the medication manager, the backup/restore flows and the tour
were not examined for the same symmetry. That is the obvious next pass.
