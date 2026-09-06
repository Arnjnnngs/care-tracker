AUDITED-COMMIT: e8c02cd
VERDICT: BLOCK

# Zero Day Audit — care-tracker v66

Audited at `e8c02cd` on `main`. Everything below was measured in a driven browser against the
shipped `index.html`, with all three gstatic Firebase modules stubbed and every other request
aborted. Brandi's Firestore was never reachable. All sabotage was done on scratch copies outside
the repo; `git status --porcelain` is clean apart from this file.

---

## THE HEADLINE — one unconfirmed tap deletes a whole period, permanently

**B1. `Remove` on a Cycle history row erased an entire menstrual period from the record, with no
confirmation step and no way to get it back.** Reproduced, not reasoned:

Seeded two completed periods. Tapped **Remove** once on the older row. Nothing else.

```
BEFORE rows = ["8/27/2026 – 8/31/2026 (5 days)", "7/28/2026 – 8/1/2026 (5 days)"]
BEFORE db   = c1:cycle_start, c2:cycle_end, c3:cycle_start, c4:cycle_end
AFTER  rows = ["8/27/2026 – 8/31/2026 (5 days)"]
AFTER  db   = c1:cycle_start,               c3:cycle_start, c4:cycle_end
AFTER  toast = "Removed"
CONFIRM_STEP_PRESENT = false
```

The July period is gone from Cycle History. Three things stack to produce that:

1. `cycleRemove(p.endId || p.startId)` deletes the period's **end** marker, so a closed period
   becomes open.
2. `cyclePeriods()`'s UC20 rule then makes the *next* `cycle_start` **update** that reopened period
   instead of starting a new one. The two periods merge and the older one's start date is
   overwritten. One row vanishes.
3. **It cannot be undone from the app.** After the merge the last chronological event is a
   `cycle_end`, so `cycleActive()` is false and both the main button and the `+` (log for another
   day) offer *Period Start* only. There is no control anywhere in the app that adds a `cycle_end`
   for a past day while no period is active. The deleted marker is gone from Firestore too.

And the toast says, in full: **"Removed"**.

**No confirmation.** Every other destructive control in this app is two-step — `removeBtn` shows
Remove → Delete/Keep, `removeParacentesis` shows Delete/Keep, `undoInpatientStart` shows "Tap to
confirm". `cycleRemove` fires on the first tap. At **320px the three buttons wrap**, and `Remove`
drops onto its own row directly under `Move start` (see `shots320/cycle.png`) — the destructive
control lands exactly where a thumb aiming at the benign one goes.

This is new in v66; v65 had no Remove on this screen at all.

**Minimum remediation, and it is smaller than a rollback.** Removing the `Remove` button from the
cycle row (one ternary → `null`) and the sentence about it in the hint restores v65's safety while
keeping the paracentesis add/edit and the cycle *moves*, which are correct. If Remove is wanted, it
needs (a) a Delete/Keep confirm like its siblings, (b) to delete the marker the caregiver is looking
at rather than `endId || startId`, and (c) a guard or warning when deleting an end would merge two
periods. Full rollback to `outputs/rollback-v65/` also works and discards correct work — Aaron's
call which.

---

## B2. The Weight add row does not exist on the screen Brandi actually has

**This is the fifth screenshot defect.** The release, the README row, the in-app changelog and
STATUS all say v66 adds "an add row on Paracentesis **and Weight**". Measured on the Weight report
with three weight readings seeded, at both 360px and 320px, the complete list of controls is:

```
WEIGHT_CONTROLS = [ menu, "Weeks", "Months", "↩ Back", Home, Meds, Reports, In-Patient, Symptoms ]
```

No `[data-weight-report-add]`. No input. No Log button. See `shots360/weight.png` — the page goes
straight from the title to the Weeks/Months toggle.

`renderWeightTrend()` has **three** return paths, and the patch fixed two:

| path | condition | add row |
|---|---|---|
| `weightEntries.length === 0` | no readings ever | present |
| `points.length === 0` | readings exist, none in range | present |
| **final return (line 7251)** | **readings exist and are in range — the normal case** | **MISSING** |

```js
return paraLine ? [toggle, chart, stats, paraLine, readings] : [toggle, chart, stats, readings];
```

The commit message and `RENDER-v66.md` both describe this as already caught: *"the Weight add row
reached one of two return paths and would have appeared only once readings existed."* There are
three, and the correction went the wrong way — it now appears **only when there are no readings**.
Brandi has months of weight data, so on the live app the feature is invisible.

`enhance-test` cannot catch it: its check is scoped, by design and by comment, to the empty state
(*"The seed has NO weight readings, so this is the empty-state path"*). The gate covers the one path
a caregiver will never see.

---

## Findings on the failure paths — the toasts do not survive contact

**F3. The move-failure instruction is right in one direction and destroys the correction in the
other.** A cycle move is add-then-remove. When the remove fails the toast says *"…moved, but the old
one is still there — remove it from Cycle History."* But UC20 collapses the two starts into one row,
and `p.startId` is the id of whichever start is **later**:

- start moved **earlier** → `p.startId` is the old one → tapping Remove finishes the move. Correct.
- start moved **later** → `p.startId` is the **new** one → tapping Remove deletes the correction and
  silently restores the original date. The caregiver believes she tidied up a duplicate; she undid
  her own fix, and nothing says so.

**F4. `cycleRemove`'s failure toast blames the network for everything:** *"Could not remove — check
connection and try again."* The `catch (e)` discards `e` without logging it, so a refusal is
indistinguishable from an outage in the UI and in the console. (`bypasses48h` does list
`cycle_start`/`cycle_end`, so age should not be the cause — but the Firestore rules are not in this
repo and I could not verify that server-side, and the app has no way to tell the caregiver which it
was.)

**F5. A paracentesis edit silently does nothing on a legacy future-dated record.**
`paraSupersedes(a,b)` is `(a.loggedAt || a.ts) > (b.loggedAt || b.ts)`. A pre-`paraId` record has no
`loggedAt`, so it falls back to `ts`. If that `ts` is in the future (the time modal permits future
timestamps behind a double-confirm), the *old* record still wins and the row keeps the old value —
while the toast reads *"Paracentesis 7.5 L **updated** at …"*. Narrow, but the toast asserts success
unconditionally. Everything else about the para edit checks out: the `'doc:' + id` grouping key
means an edit of a legacy record still supersedes correctly, `cancelled` tombstones still win, and
the re-validation added in `confirmTimeAndLog` correctly catches a cleared or out-of-range liters
field with the modal still open.

---

## Copy that is not true

- **In-app CHANGELOG v66** — *"It can now do both, and so can the Weight screen."* **False twice.**
  Weight cannot add (B2), and Weight has no Edit on its rows at all, so "do both" is wrong even if
  B2 is fixed. This is the sentence a non-technical caregiver reads.
- **In-app CHANGELOG v66** — a new **destructive** control shipped to Cycle History and the What's
  New notice does not mention it. It lists Move start and Move end only.
- **Cycle hint** — *"Remove deletes the most recent marker of the period."* "Marker" is developer
  language, and the sentence is silent on what actually happens: the period may disappear from the
  list entirely.
- **README v66 row, STATUS.md State, `RENDER-v66.md`** — all repeat "an add row on Paracentesis and
  Weight". Same falsehood as B2. Every *number* in all three is correct (verified below).
- **STATUS.md** — the Commit cell reads *"NOT YET PUSHED to main at the time of writing"* with no
  SHA, while the release is live. STATUS is described in its own header as the single source of
  truth for what was last done; every previous row carries a SHA and a Pages-verification note.

---

## What I verified and found sound

**Patch fidelity — exact.** `outputs/rollback-v65/index.html` + `harness/enhance-reports-patch.py`
reproduces the shipped `index.html` with a diff of exactly 8 lines: `APP_VERSION` v65→v66 and the
six-line v66 CHANGELOG entry. Nothing else. The patch's `sub()` helper raises on any anchor that
does not match exactly once, so no regex rewrite could have touched anything silently.

**The numbers reproduce.** `enhance-test` **15/15** on HEAD; **1/11** against
`outputs/rollback-v65/index.html`. `para-test` 16/16. `whatsnew-test` 30/30. `pm.py` exits **2** —
one pre-existing pinned-literal warning in five older suites, no blockers. `md5` of `index.html` and
`sw.js` match STATUS.md exactly. `APP_VERSION` and the `sw.js` CACHE both read v66. No page errors
on any screen at either width.

**Falsification — six sabotages, on scratch copies.** Five of the fifteen checks never execute
against v65 (they sit behind `if (addBox)` / `if (startBtn)` guards), so I broke what each guards:

| sabotage | result |
|---|---|
| A · para edit writes `paraNewId()` instead of `m.editId` (duplicates) | **14/15** — *record count unchanged after an edit* RED, `2 -> 3` |
| B · the marker's `removeEntryDB` no-ops (a failed remove) | **14/15** — *the period now reads a different date* RED |
| C · modal title reverts to `'Log ' + m.label` | **14/15** — *the move step says Edit, not Log* RED |
| E · the report add row's Log button no-ops | **13/15** — both add checks RED |
| D · **the entire UC20 merge branch deleted** | **15/15 — STILL GREEN** |
| F · D + B together | 13/15 — the UC20 check finally RED |

**One more vacuous check, matching the one the builder already found.** *"moving a start did not
create a second period"* is named for the UC20 rule, and deleting that rule outright leaves the suite
fully green (sabotage D). It only fires when the remove is *also* broken (F), by which point *"the
period now reads a different date"* has already gone red for the same cause. It carries no
independent signal. The check the release leans on hardest — supersede-not-duplicate — is genuinely
live (A), which is the important half.

**Screens reviewed at 360×780 @3× and at 320px:** Home, Paracentesis, Weight, Cycle, the
paracentesis edit dialog, History, In-Patient, Symptoms, Appetite, Bowel Movement. Paracentesis is
good at both widths — add row present, Edit/Remove on every row, and the new 64px tail room does
clear the floating Back pill off the last row. The Cycle date now wraps to two lines at 320px rather
than four; readable, not ideal.

**Touch targets and iOS floor — all new controls pass.** Report add-row input 44px / **16px**; its
Log button 44px; the edit dialog's Liters field 52px / **16px**; Move start / Move end / Remove 44px;
paracentesis Edit / Remove 44px. Every new text input is at the 16px floor. (The 38px quick-day
buttons and the 31px Weeks/Months toggle are pre-existing and untouched.)

---

## Recommendation

**BLOCK on B1.** It is one unconfirmed tap, on a live patient's record, that measurably destroyed a
period the app cannot restore. Fix that first, by whichever of the two routes Aaron prefers; the
surgical one is ~2 lines and keeps the work he asked for.

**B2 next, and it is the release's own stated goal** — the Weight add row belongs on the final
return of `renderWeightTrend()`, the changelog sentence about Weight is false until it is, and
`enhance-test` needs a seeded-weights case so the covered path is the one that ships.
