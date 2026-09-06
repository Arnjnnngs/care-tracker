AUDITED-COMMIT: 2aac09eec6bd1003011455825dfc029953b20e77 +working-tree
# ZERO DAY AUDIT — care-tracker v70 — **BLOCK**

**Moving a period start onto a date that falls inside an earlier period makes a whole period
disappear from the Cycle screen, the app says "moved" as if it worked, and there is no button
left anywhere that can put it back. v69 does not do this — it keeps both periods.**

Reproduced in a browser, twice, against both builds with the same data and the same tap.

---

## Verified good before the findings

- **Build reproduces byte-exactly.** `outputs/rollback-v69/index.html` + `harness/cycle-supersede-patch.py`
  → md5 `c33e103883a312435243769313f82e26`, identical to the shipped `index.html`. `sw.js` CACHE moved
  to `caretracker-v70`, `APP_VERSION` to `v70`.
- **`harness/enhance-test.mjs` 30/30 on v70, 29/30 on v69**, with the new check
  `moving a period date NEVER deletes a document` the one that goes red. That check is real.
- **No reader left behind.** Every consumer of cycle markers was read: `cycleActive()`,
  `daysSinceCycleStart()`, `lastCycleStart()`, `cyclePeriods()` — all now go through `cycleResolved()`.
  The Home banner (line 3609), the Reports tile (4428) and the Cycle report (6792–6833) all read those.
  Today's Journal (4058), the History day map (6728), the History day summary counter (6734) and the
  printable report's dose totals (5863) **exclude** cycle markers entirely, by construction, so there is
  no screen that can show a stale marker date. The CSV keeps every document and labels the old one.
- **Backup/restore round-trips it.** `bkCollect()` copies whole documents, `bkRestore()` writes them back
  at their original ids with every field intact, so `markerId` and `loggedAt` survive and a restored
  marker still resolves the same way.
- **`addEntryDB()` passes the entry straight to `addDoc`** with no field whitelist, so `markerId` and
  `loggedAt` genuinely persist. No `deleteDoc` on any cycle path.

---

## BLOCKER 1 — a period vanishes from the record, silently, and cannot be got back

**What breaks.** `cyclePeriods()`'s UC20 rule says a second `cycle_start` while a period is open
*updates* the open period instead of starting a new one. That rule was written for two starts logged
back-to-back by accident. v70 now lets a caregiver **move** a start onto any date at any age — and a
start moved backwards into an earlier period's span hits UC20, which swallows the whole later period.

**Reproduction** (`enhance-test.mjs` harness, two seeded periods, both markers weeks old):

1. Cycle report shows two periods: `8/27/2026 – 8/31/2026` and `7/28/2026 – 8/1/2026`.
2. Tap **Move start** on the 8/27 period. Change the date to 7/26 — a plausible wrong-month typo.
3. Confirm. Toast reads *"Period Start moved to Sun, Jul 26 …"* — success.
4. The screen now shows **one** period: `7/28/2026 – 8/1/2026`.

The `8/27 – 8/31` period is gone from the display. So is the 7/26 correction that was just made — the
card shows 7/28, the *other* period's start. The `8/31` Period End document is now attached to no card
at all, so there is no **Move end** button for it anywhere in the app.

**Why it cannot be undone.** After the move, the surviving card's *Move start* / *Move end* address the
7/28 period's markers. Nothing on any screen addresses the moved marker or the orphaned 8/31 end. The
only route back is to move the *other* period's start to a date earlier than 7/26 — which hands the
card back to the moved group — then move it forward again. No caregiver will find that.

**It is a v70 regression, measured.** Same seed, same tap, with the Firestore stub taught to refuse a
delete on a document older than 48 hours (which is what `STATUS.md`'s v52 section says the published
rules do):

| | after the move |
|---|---|
| **v69** | **2 periods** — `8/27 – 8/31` and `7/28 – 8/1`. Nothing lost; the app also says the move did not fully take. |
| **v70** | **1 period** — `7/28 – 8/1`. The 8/27 period is off the screen and the toast says it worked. |

v69 was safe here *by accident* — the delete it depended on was refused, so the original start survived
and kept its own period intact. v70 removes the delete, which is right, and in doing so removes the
thing that was accidentally protecting the record.

**How bad for the patient.** The Cycle report is the record of her periods, and it is the screen a
clinician would be shown. A single mistyped date silently erases a period from it while telling the
caregiver the correction was saved. The documents are still in Firestore and still in the CSV, so this
is a display loss, not a data loss — but nobody looking at the app can tell, and Aaron has been here
before: v66 shipped a control near this exact rule that "destroyed a whole period of a patient's record."

**Smallest honest fix.** Refuse the move rather than let UC20 eat it: in the marker branch of
`confirmTimeAndLog()`, before writing, run the candidate date through `cyclePeriods()` and reject it if
the resulting start would fall inside another period's span or after its own period's end — toast
*"That date is inside another period — pick a date after 8/1"*. That is a guard, not a rewrite, and it
also closes Blocker 2.

## BLOCKER 2 — a start moved past its own end leaves the period permanently "Active"

Same mechanism, one period. Move a start to a date **after** its own Period End: the end marker is
dropped by `cyclePeriods()` (it needs an open period to attach to and there is none before it), the
period renders as `… – Active`, `cycleActive()` returns true, and the **non-dismissible red Home
banner** *"Day N since period start"* comes up and stays up. The card shows no **Move end** button
(`endId` is null), so the end marker is unreachable from the UI.

Recoverable — moving the start back before the end restores everything — but only if the caregiver
guesses that. Verified with the app's own extracted `cycleResolved()` / `cyclePeriods()` (scenarios B
and D of the probe). Fix is the same date guard as Blocker 1.

---

## MEDIUM — the one guard that protects against a bad clock has no check that can fail

`confirmTimeAndLog()` writes `loggedAt: Math.max(Date.now(), (m.prevStamp || 0) + 1)`. The `Math.max`
is load-bearing: it is what stopped the v67 paracentesis edit silently no-opping against a record with
a future `ts` or a fast device clock. Every marker in `enhance-test.mjs` is dated in the past, so
replacing that expression with a bare `Date.now()` leaves the suite at 30/30. **The protection is
untested.** One seeded marker with a `ts` a year in the future, edited, asserting the date changed,
would make it bite. This is the Rule 5 pattern — a check that cannot fail.

## LOW — one check in the new suite passes vacuously

`t('a second move corrects the first rather than adding another period', stillOneAfterTwo === 1)`
counts period *cards*. Only one period is seeded, and UC20 collapses any number of `cycle_start`s
into a single period, so this reads 1 whether grouping works or not. Its sibling
(`the second move actually changed the date again`) is what actually catches broken grouping — the
count check adds nothing and its name over-claims. Count **documents in the resolved set**, not cards.

## LOW — the CSV marks the old row but not the new one

`exportDetailFor()` labels a superseded marker `Period Start (moved — superseded)` and leaves the
current one as a bare `Period Start`. v69 shipped the weight equivalent as `(corrected)` on the live row
and `(superseded)` on the old one. Two `Period Start` rows minutes apart, one labelled and one not, is
readable but inconsistent with the pattern this release says it is copying.

---

## Correction — the brief's "ALREADY KNOWN" item 2 is wrong

**`harness/overflow-scan.mjs` does not report CLEAN.** Run on v70 it prints:

```
110 of 110 screen/width combinations scanned, 2 overflowing element(s).
NOT CLEAN
  iOS  iPhone SE (1st gen) (320px) — WHATSNEW-POPUP
      "THE PAGE ITSELF IS WIDER THAN THE PHONE"
        app needs 334px on a 320px screen — it will scroll sideways by 14px
  Android  Android small (display size) (330px) — WHATSNEW-POPUP — by 4px
```

It catches the exact 14px, at the exact width, and fails the run. So the gate is working.

**What is true is narrower, and still worth fixing:** it attributes the overflow to the *What's-New
pop-up* pass and calls the five tab screens clean at 320px. And the per-element scanner is
structurally incapable of naming the element responsible, for two compounding reasons:

1. **Every element is measured against its PARENT's box.** The `NAV` is itself 334px wide, so each of
   its five labels fits inside it perfectly and nothing is flagged. An overflow caused by a container
   is invisible to a rule that only ever compares a child to that container.
2. **The scanner is handed the widened viewport.** Line 428: `page.evaluate(scanFn, Math.max(dev.w, layout.inner))`.
   Under `isMobile: true` Chromium widens the layout viewport to fit content that will not fit —
   measured directly at 320px: `window.innerWidth` is **334**, `documentElement.clientWidth` is 320,
   `visualViewport.width` is 320. So `scanFn` is told the screen is 334px wide, and rule C
   (`r.right > vw + 1`, "off the right edge") **can never fire for anything that runs off a 320px
   phone.** The whole-page guard above it is the only thing that can see this class at all, which is
   why the whole finding collapses into one `<document>` row on whichever pass happens to trip it.

Passing `dev.w` (or `documentElement.clientWidth`) to `scanFn` instead of `Math.max(dev.w, layout.inner)`
would let it name the element. Separate from v70; the 334px is present on `outputs/rollback-v69/index.html` too.

---

## Verdict: **BLOCK**

The append/supersede model itself is sound, correctly wired through one seam, and reproduces from the
repo. What is missing is a validity check on the date being moved to. Ship it with the guard in
Blocker 1 and this becomes the release it says it is.
