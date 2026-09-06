AUDITED-COMMIT: a215dcd2120fe3f19a2bceed5c7e0ba3cb6e53a0 +working-tree
# ZERO DAY AUDIT — v69 (weight Edit / Remove on the Weight report)

**VERDICT: BLOCK.**

**Headline: correcting a weight older than two days does not replace the old reading — it adds a
second one next to it, permanently, and the Remove button offered to clean it up cannot work
either.** Demonstrated, not theorised: with the delete rule this project's own notes describe,
2 readings became 3, showing 156.2 lbs and 150.3 lbs on the same day.

Reproducibility claim checked first and it holds: `outputs/rollback-v65/index.html` +
`harness/enhance-reports-patch.py` produces the working-tree `index.html` byte for byte
(md5 `aa09500214b45b425fa6f37f8da65d44` both sides).

---

## B1 — BLOCK. The weight edit deletes, and this app decided seventeen releases ago that deletes do not work.

**What breaks.** `confirmTimeAndLog()`'s weight branch adds the corrected reading and then calls
`removeEntryDB(editId)` -> `deleteDoc()`. `removeWeightReading()` does the same. Both are rendered
on **every** weight row regardless of the row's age — no age check at all.

The project's own `STATUS.md` (line 693, the v52 section) states this as settled fact:

> "The Firestore rules block deletes by **document age**, with no medId exemption. `BYPASS_48H_IDS`
> only shows or hides a button; it cannot grant a delete the rules refuse. Adding `paracentesis` to
> it would have produced a Remove button that looked like it worked and silently did nothing on any
> record older than two days. **A wrongly-recorded 6-litre drain that can never be corrected is a
> real harm.**"

That is exactly what v69 has now done for weight. And the contradiction is inside the same file, one
release apart: `removeParacentesis()` (v52/v68) **never calls `deleteDoc`** — it appends a
`cancelled: true` tombstone so it works at any age — and the paracentesis edit carries the comment
*"it works past the 48-hour delete window the Firestore rules enforce."* v69's weight edit does the
opposite and says nothing about why.

**Steps to reproduce.** Weight report -> any reading more than 48 hours old -> Edit -> change the
number -> Confirm.

**Demonstration.** I copied `harness/enhance-test.mjs` and changed **one line** — the stub's
`deleteDoc`, to refuse documents older than 48h the way the notes describe — and changed nothing
else:

```
FAIL  correcting a weight does not leave the old reading behind  |  2 -> 3
      rows: Fri, 9/4 156.2 lbs  |  Fri, 9/4 150.3 lbs  |  Fri, 8/28 154.8 lbs
FAIL  confirming removes exactly one reading                     |  3 -> 3
```
(The paracentesis edit in the same run still passes — the tombstone design survives. That is the
control.)

**Why the suite is green.** `harness/enhance-test.mjs` seeds its weights at `NOW - 2*DAY` and
`NOW - 9*DAY`. **Both are older than the delete window.** Every reading the new checks exercise is
one that fails in production; the Firebase stub simply has no rules, so all three green checks are
green about a case that does not exist on Brandi's phone.

**How bad for the patient.** Weight is the ascites signal. The record ends up carrying two different
weights for the same day and the trend chart plots both. The failure toast tells the caregiver
*"the old reading is still there — remove it from the Weight report"*; tapping Remove there fails
too and says *"Could not remove — check connection and try again."* She has a wrong number she cannot
delete, a right number she cannot isolate, and an instruction that loops. She may reasonably try
again, adding a third.

**Honest limit.** `firestore.rules` is not in this repo and I could not read the live rules. Two
possibilities, and both block: either STATUS.md is right and v69 corrupts the weight record, or
STATUS.md is wrong and v52's whole tombstone design was built on a false premise that has been
guiding this codebase for seventeen releases. **Nothing in the repo verifies which.** Shipping a
control that writes to a live patient's record on an unverified assumption is not acceptable when
the assumption is one the team already wrote down as false.

Note the asymmetry that makes this worse than what shipped before: today, `bypasses48h('weight')`
only makes History's Remove **silently do nothing** — annoying, no data harm. v69 upgrades the same
assumption into a control that **creates a permanent duplicate**. The failure mode gets worse, not
better.

**Cheapest safe fixes, in order:** (a) read the live rules in the Firebase console and settle it;
(b) if deletes are age-limited, hide Edit and Remove on rows older than 48h exactly as `removeBtn()`
does, so the caregiver is never offered a control that corrupts; (c) longer term, give weight the
paracentesis treatment — supersede by group id, never delete.

---

## B2 — BLOCK. There IS a one-tap delete. The armed confirmation survives leaving the screen, and it sits where Edit was.

**What breaks.** `state.confirmRemoveWeight` is cleared by exactly two things: the Keep button, and a
successful delete. Navigation clears nothing — `setView()` clears only `confirmDeleteMed`, and the
Back pill sets `reportsView: null` and nothing else. Unlike `removeBtn()`, which auto-disarms after
6 seconds, the new control has no timeout.

An unarmed row renders `[Edit][Remove]`. An armed row renders `[Delete][Keep]`. **The leftmost button
changes from Edit to Delete and stays that way.**

**Steps to reproduce** (run and confirmed in the harness):
1. Weight report -> tap Remove on a row (arms it).
2. Change your mind. Tap Back.
3. Re-open the Weight report — minutes or hours later.
4. The row's first button is `Delete`, in the position Edit occupies on every other row.
5. Tap where Edit is. The reading is gone with one tap.

```
   leftmost button before arming: Edit
   leftmost button after arming : Delete
   leftmost button after leaving and returning: Delete
  FAIL  an armed Delete does NOT survive leaving and re-opening the screen
```

**How bad.** This is the v66 Cycle-History failure that "destroyed a whole period", rebuilt on a new
screen. The suite's check *"removing a weight asks a second time before deleting"* is true on a
freshly opened screen and false after the sequence above — a check that passes while a one-tap
delete exists.

**Fix (small).** Clear `confirmRemoveWeight` in `setView()`/on leaving the report, and add the same
6-second auto-disarm `removeBtn()` already has. The identical bug exists on the v68 paracentesis row
(`confirmRemovePara`) and should be fixed in the same pass.

---

## B3 — BLOCK. The layout gate has never rendered the screen this release changes.

`harness/overflow-scan.mjs` walks `SCREENS = ['home','meds','reports','inpatient','symptoms']` plus
three EXTRA passes (`whatsnew`, `whatsnew-popup`, `med-editor`). `reports` is the **reports menu**.
**No report detail screen is ever opened**, so the populated Weight report — the only screen v69
touches, and now two buttons wider per row — is not covered by "80/80 CLEAN" at any width. It also
seeds a single weight entry.

The file's own comment says it: *"a render gate that skips the thing under change is the exact
failure this file exists to prevent, and it happened on its first outing."* It has happened again.
`pm.py` independently blocks on the same thing: **no `outputs/RENDER-v69.md` exists.** Nobody has
looked at this screen at 320px with two extra 44px buttons on a row that also carries a weekday +
date + time.

---

## B4 — `python3 pm.py` returns 4 BLOCKERS. This release cannot be reported as done.

```
STOP  STATUS.md says index.html is 87e3099ee804 but it is actually aa09500214b4
STOP  STATUS.md says sw.js is cd5b7f000a95 but it is actually 814d201993e4
STOP  NOBODY LOOKED AT IT — index.html changed but there is no outputs/RENDER-v69.md
STOP  NOTES DID NOT MOVE WITH THE CODE — index.html, sw.js changed but README.md,
      CARETRACKER_HANDOFF.md did not
RESULT: 4 BLOCKER(S). Do NOT tell Aaron this is done.
```
Plus a warning that STATUS.md still says live is v68.

---

## Lower-severity findings

**L1 — a check in the suite that cannot fail correctly, left one function above the one they fixed.**
The weight block carries a careful comment explaining that counting `[data-weight-edit]` buttons
misreads an armed row as a deletion, and correctly counts `[data-weight-row]` instead. But
`window.__paraCount = () => document.querySelectorAll('[data-para-edit]').length` — used by section
2's *"the record count is unchanged after an edit"* — was **not** changed and still counts Edit
buttons. It passes today only because no para row happens to be armed at that moment. Same defect,
same file, fixed in one place and not the other.

**L2 — the failure toast sends the caregiver to a control that cannot work.** *"Weight corrected, but
the old reading is still there — remove it from the Weight report"* is the instruction, and per B1
that Remove fails with a message blaming her connection. `removeWeightReading`'s `catch` does log the
error to the console (better than `cycleRemove`, which discards it), but the caregiver is told
"check connection" for what is a permissions refusal. She will retry forever.

**L3 — changelog accuracy (Rule 2.7).** *"Before this, a weight typed wrong could only be fixed from
History."* History has no edit for a weight — only Remove-and-re-log — and if B1 holds, that Remove
has been silently failing on entries older than 48h for a long time. The sentence promises a working
prior route that does not exist. *"Removing asks twice, like everywhere else in the app"* is true as
written but false after the B2 sequence.

**L4 — `12.3.4` is accepted silently.** The edit field's `onInput` runs `parseFloat`, so `12.3.4`
becomes `12.3` and passes re-validation. `abc`/empty -> `null` -> *"Enter a valid weight"* (correct);
`-5`, `0`, `1e9` are all correctly rejected by the `v > 0 && v <= 999` guard. Low severity, but the
typo it silently accepts is the one this feature exists to catch.

## Things I attacked that turned out to be sound

- **Double-tap Confirm.** `setState({ timeModal: null })` runs synchronously before the `await`, so
  the second call returns immediately on `if (!m) return`. No duplicate.
- **The add-then-remove ORDER.** Correct and load-bearing, as the comment says: a failed add leaves
  the original intact. It is the *delete* that is wrong (B1), not the order.
- **A failed add.** `addEntryDB` raises the persistent red banner and rethrows before the remove is
  reached, so the original reading cannot be destroyed by a failed add.
- **`editId` pointing at an already-deleted row.** `deleteDoc` on a missing document resolves without
  error, so no duplicate results.
- **The `h()` trap on `'data-weight-row': p.id`.** Read `h()` directly: an unknown key falls to
  `el.setAttribute(k, v)`, which coerces `undefined` to the string `"undefined"` — no throw. And
  `p.id` is always present here: rows derive from `state.entries`, which are built from Firestore
  snapshot docs that always carry an id. Not a defect.
- **Data loss on edit.** A weight document is only ever written as `{medId, weight, dose, mg, ts}` —
  by `confirmTimeAndLog` and nowhere else. The edit reconstructs all five. The CSV export and the
  printable report read `medId`, `weight`, `dose`, `ts` only. Nothing is dropped. (The Entry ID and
  "Logged at" columns change, which is correct for a new document.)
- **The Average stat on the Weight report** is not the paracentesis-average mistake repeated: weight
  is a level, not a quantity that accumulates between events, so a mean over a window is meaningful.

## What I would need to lift the BLOCK

1. The live Firestore rules read from the console, settling whether age-limited deletes exempt
   `weight`. If they do not: hide Edit/Remove past 48h, or supersede instead of delete.
2. `confirmRemoveWeight` (and `confirmRemovePara`) cleared on navigation, with the 6s auto-disarm.
3. `harness/overflow-scan.mjs` extended to open the report detail screens, and `outputs/RENDER-v69.md`
   written after someone LOOKS at the 320px screenshot of a populated Weight report.
4. `pm.py` at exit 0 or 2.
5. A suite check seeded with a weight reading INSIDE the delete window as well as outside it, so the
   two cases are distinguishable.
