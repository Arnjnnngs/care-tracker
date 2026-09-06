# Enhancer pass 03 — every screen, and the process fix that matters more

Aaron, 2026-09-06: *"I shouldn't have to ask for enhancer list...otherwise, what is it doing?"*

**He is right, and the failure is not that the pass was not run — it is that its output never reached
him.** Two Enhancer passes exist in `outputs/` (`ENHANCER-PASS-01.md`, `ENHANCER-PASS-02-chemowell.md`).
Both were written, committed, and never surfaced. A role whose output is a file in a repo the owner
does not read is not a role, it is a habit.

**Fixed in `CLAUDE.md` Rule 2.6: the proposal list goes in the release message to Aaron, every
release, unprompted, as a short list with a size on each item. A release message without one is
incomplete.** No new work — the pass was already being done.

---

## The table, read off the real controls

| Screen | Add | Add for another day | Correct | Remove |
|---|---|---|---|---|
| In-Patient | yes | yes | yes | yes |
| Calendar | yes | yes | yes | yes |
| Paracentesis | yes | yes | yes | yes |
| **Weight** | yes | yes | **yes (v69)** | **yes (v69)** |
| **Cycle** | yes | yes (`+`) | **yes (v70)** | no — withdrawn on purpose after v66 |
| **Bowel Movement** | from Home | no | **NO** | only via History |
| **Appetite** | from Home | no | **partly, and it can silently fail** | only via History |
| History | — | — | no | yes |

Cycle's missing Remove is deliberate: v66 shipped one and a single unconfirmed tap destroyed an
entire period. It stays out.

---

## Three findings, and two of them are defects rather than enhancements

### 1. DEFECT — re-answering "how was today?" can silently keep the OLD answer

`logBowelMovement()` appends with **no replacement of an existing answer for that day**, and every
bowel-movement entry for a day is stamped at the same instant (`dayStart + 12h`). So after a second
answer there are two documents with an **identical `ts`**, and the reader keeps whichever the
database happens to return last:

```
if (!existing || e.ts >= existing.ts) map.set(d0, e);   // both ts identical -> arbitrary winner
```

**She can change the answer, see it change, and have it change back.** Same coin-flip mechanism the
v69 audit found on the weight report — identical timestamps plus an arbitrary tie-break.

### 2. DEFECT — the appetite correction removes before it adds, and the remove can be refused

```
const existing = appetiteFor(dayStartTs);
if (existing) await removeEntryDB(existing.id);     // <- refused past 48 hours
await logAppetite(v, dayStartTs, state.appetiteNoteInput);
```

Two things wrong, both already paid for elsewhere in this app. **The order is backwards** — a failed
add after a successful remove destroys the answer with nothing on screen to say so; every other
correction in this app adds first for exactly that reason. And **the remove is refused by the
Firestore rules on any day older than two days**, leaving two entries for one day with the same
arbitrary tie-break as above. This is the third and fourth instance of the delete-based-correction
bug fixed in v69 and v70.

### 3. GAP — the Bowel Movement and Appetite reports have no controls at all

Neither screen has a single button. They display a history that cannot be added to, corrected, or
removed from. This is the Paracentesis gap Aaron originally reported, unchanged, on two more screens.

---

## Proposed, sizes attached — Aaron picks

| # | Change | Size |
|---|---|---|
| A | Make both answers replace-by-append: group by day, newest `loggedAt` wins. Kills findings 1 and 2 together and removes the last two `removeEntryDB` correction paths in the app. | **S–M** |
| B | Add / correct / remove controls on the Bowel Movement and Appetite reports, matching Weight and Paracentesis. | **S** each |
| C | A and B as one release, so those two screens end up consistent with the other four rather than partway. | **M** |

**Recommendation: A first, on its own** — it is a correctness fix on a patient's record and should
not wait behind a screen-completeness change. B follows.

---

## Also found, filed separately because it is not an Enhancer finding

**The app is ~14px too wide at 320px** (`scrollWidth` 334 on a 320 viewport; a `NAV` measures 334px),
with and without the What's New pop-up. Reproduced 3/3 on v70 **and identically on v65**, so it is
long-standing. **`harness/overflow-scan.mjs` reports CLEAN over it**, which is the worse half — a
render gate that misses a document-level overflow on the five tab screens.
