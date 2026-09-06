AUDITED-COMMIT: c45c86f96628633fd76e9e2c22f419d5dc177af3 +working-tree
# ZERO DAY AUDIT — care-tracker v69, SECOND PASS — **BLOCK**

**Correcting a mistyped weight can make the printable oncologist report say the patient GAINED
35 lbs when the app's own Weight screen shows she LOST 10.** Reproduced from the downloaded file's
bytes. The Weight screen was rebuilt to read the new resolver; the doctor's report was not.

Reproduction suite: `harness/audit-v69-weightreport.mjs` — **7 passed, 4 failed** against the
build under audit, **9/9 green** against a one-line fix (falsified in both directions).
Run: `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/audit-v69-weightreport.mjs`

---

## What the FIRST pass fixed, and what it did not

The append-only rebuild is **correct where it was applied**. I attacked it directly and could not
break it:

- `weightResolved()` groups on `weightId`, falls back to `'doc:'+id`, newest `loggedAt||ts` wins,
  `cancelled:true` is a tombstone, and non-numeric / non-positive weights and `ts<=0` are dropped
  rather than guessed. A `Map` not an object, so a group id of `constructor` is safe.
- **No document is deleted.** I broke `removeWeightReading()` to call `removeEntryDB()` and watched
  `enhance-test`'s *"correcting or removing a weight NEVER deletes a document"* go **RED**
  (`[{"id":"a3","medId":"weight"}]`, 25/27). The check is real.
- A legacy reading with no `weightId` is its own group; an edit or removal of one carries
  `'doc:<its own id>'`, so it regroups with itself. Confirmed in a browser against readings 9 and
  20 days old — well past the 48-hour delete window.
- **Backup / restore survives it.** `bkCollect()` copies every data field verbatim and `bkRestore()`
  re-creates at the ORIGINAL document id, so `weightId` and `cancelled` round-trip and a restored
  tombstone still suppresses its reading. The `'doc:'+id` fallback key is stable because the id is.
- `weightLatest()` really is the newest (resolved is sorted `ts` ascending; the row list reverses
  it, chart plots ascending). Verified on screen: rows read 9/4 then 8/17.
- `h()` trap: `data-weight-row` and `data-para-row` are always set from the resolver's own group
  key and can never be `undefined`. (For the record: if one ever were, `h()` falls through to
  `setAttribute` and writes the literal string `"undefined"` — the selector would still match and
  nothing would throw. A silent trap, not a crash.)
- Reproducibility **verified by md5, not assumed**: `outputs/rollback-v65/index.html` +
  `harness/enhance-reports-patch.py` = `8a0ef4f1d5dbd448b2cd97e187c82ca3` = `index.html`.
- `enhance-test` 27/27 confirmed.

**The gap is the one the brief predicted: a reader still on raw documents.** I found it, and it is
the worst possible one.

---

## BLOCKER 1 — the printable oncologist report's "Net weight change" is computed from raw documents

**Where:** `index.html:5798-5800`, printed at `index.html:5932`.

```
const weights = allExportEntries().filter(e => e.medId === 'weight' && e.weight !== undefined)...
const netWeight = weights.length > 1 ? (... weights[weights.length-1] - weights[0] ...) : '—';
```

Before v69 this was correct, because raw and resolved were the same set — no weight document had
ever superseded another. **v69 is what makes it wrong.** Both new writes land in that filter:

- a **correction** appends a second `weight` document, so the typo it replaced is still in the set;
- a **removal** appends a tombstone that carries `weight: p.weight` (`index.html:5005`), so the
  deleted reading is counted **twice**.

### Reproduction (driven through the real Edit / Remove controls, asserted on downloaded bytes)

1. Two readings, both past the 48h window: **105.0 lbs** on 8/17 (a typo — 150 was meant) and
   **140.0 lbs** on 9/4. Report tile: `+35.0 lbs`. Correct so far.
2. Reports → Weight → **Edit** the 8/17 row, 105 → **150**. The screen is right: two rows, no
   duplicate, no delete, 150.0 → 140.0 = a **10 lb loss**.
3. Save the printable report. Tile reads **`+35.0 lbs`** — a **35-pound weight GAIN**, driven by a
   number the caregiver already corrected.
4. Reports → Weight → **Remove** the 9/4 reading. One row left on screen, no change to report.
   Tile still reads **`+35.0 lbs`** — computed from one value she corrected and one she deleted.

### Why step 3 is a coin flip, not a fluke — and why it will be worse in production than in the lab

Every weight `ts` in this app is **minute-granular**: both `logWeight()` and `weightEditOpen()` go
through the same `datetime-local` modal, and `toLocalISO()` (`index.html:1745`) emits
`YYYY-MM-DDTHH:MM` — no seconds, no milliseconds. So **an edit that keeps the time produces a
document with a `ts` identical to the one it supersedes.** `subscribeEntries` orders by
`orderBy("ts","asc")`, and Firestore breaks a tie on the order field by document `__name__` —
which for an auto-id is effectively random.

So `weights[0]` in that formula is **decided by a random document id**: sometimes the correction,
sometimes the typo. My first run (stub with a stable sort, seed ts carrying milliseconds) landed on
the right side and the check passed; seeding on a minute boundary, as every real reading is, and
tie-breaking by id, as real Firestore does, flips it. **A gate that happens to sort ties the other
way would show this as green.** That is the shape of the bug: not "the report is wrong", but "the
report is right or wrong depending on a random id", which is strictly worse to diagnose later.

### How bad for the patient

The "Net weight change" tile sits in the stat grid at the top of the document handed to Brandi's
oncology team. Weight trajectory in advanced cancer is a real clinical signal — it moves decisions
about nutrition support, fluid management and treatment tolerance. A report claiming a 35 lb gain
where the record shows a 10 lb loss, or crediting a reading the caregiver deleted, is a **false
clinical impression created by using the app's own correction feature**. The caregiver has no way
to see it: she fixed the number on screen, the screen is right, and the file is generated
elsewhere.

### The fix (one line)

```js
const weights = weightResolved().map(e => Number(e.weight)).filter(n => !isNaN(n));
```

Applied to a scratch copy, my suite goes **9/9** and the tile reads `-10.0 lbs` then `—`.
(`weightResolved()` is defined above this call site and returns oldest-first, which is the order
the formula wants.)

---

## BLOCKER 2 — a corrected weigh-in appears as TWO readings, unmarked, in the spreadsheet and History

The brief says History, the CSV and the printable report deliberately keep showing RAW documents,
the way paracentesis and appointments do. **That precedent does not carry here, for two reasons.**

**a) A removal is marked; a correction is not.** `exportDetailFor()` (`index.html:5578`) prints
`'Removed'` for `cancelled`, so a deleted weight is honest. A **superseded** reading prints as a
perfectly ordinary reading. From the CSV produced in the run above:

```
8/17/2026,6:52 PM,...,Weight,weight,105.0 lbs,0,,logged,seed_w_old,
8/17/2026,6:52 PM,...,Weight,weight,150 lbs,  0,,logged,zz1,2026-09-06T18:52:58.745Z
```

Two different weights **at the same minute of the same day**, nothing saying which is current.
Because of the minute truncation these are not "an old entry and a later correction" on the page —
they are two contradictory readings taken at the same instant. A paracentesis edit at least lands
at a distinguishable time only by luck; a weight edit that keeps the time never does.

**b) The History day summary miscounts.** `renderHistory` (`index.html:6679`) counts raw weight
documents, so after one correction the day reads **"0 doses · 2 wt · 5 MISSED"** — *two weigh-ins*
where there was one. Verified on screen, scoped to the summary element (never `document.body`).

**Severity:** lower than Blocker 1 — the CSV is a backup and History is a log, and both showing the
audit trail is defensible. But **"2 wt" is not an audit trail, it is a wrong count**, and an
unmarked twin reading is a false impression rather than a record. Minimum fix: give a superseded
weight the same treatment the tombstone already gets (`exportDetailFor` can mark it, e.g.
`150.0 lbs (corrected from 105.0)` / `105.0 lbs (superseded)`), and count the History summary off
`weightResolved()` for that day. Aaron's call whether that rides with the fix above or follows.

---

## Smaller findings

**S1 — a reading older than the selected range cannot be corrected at all.**
`renderWeightTrend()` builds the readings list from `points`, which is `weightEntries` filtered to
the range toggle — 28 days on Weeks, 90 on Months. So Edit and Remove exist only for readings
inside the visible window, and **a mistyped weight more than 90 days old can never be corrected**.
This is exactly the shape of the gap Rule 2.6 was written for: the screen looks complete and is
not. It also cost me ten minutes — my first run seeded a 30-day-old reading and the row simply was
not there. Not a blocker; worth Aaron knowing the correction feature has a horizon.

**S2 — `dose` formatting drifts on an edit.** `confirmTimeAndLog` writes `dose: v + ' lbs'`
(`index.html:1995`), so correcting 105.0 to 150 stores `"150 lbs"` beside the original's
`"105.0 lbs"`. Visible in the CSV above and in History. Cosmetic; `.toFixed(1)` fixes it.

**S3 — one tautology inside a guard in `enhance-test.mjs` (line 299).**
`t('a weight edit and a weight removal both actually ran', beforeW > 0 && beforeR > 0 && anyWeightWrites >= 0, ...)`
— `anyWeightWrites >= 0` is a row count and is **always true**, so it contributes nothing to a
check whose whole purpose is to prove the guard above it is not vacuous. The check is saved by its
neighbours (line 292 proves the removal ran), but the clause reads as evidence and is not.

**S4 — noted, not re-found:** the cycle marker move (v68) still uses add-then-`removeEntryDB`,
per the brief, out of scope. I found nothing new about it. One adjacent observation: `enhance-test`
now drives that path and its stub records the delete, so whoever fixes it already has the gate.

**S5 — not a v69 defect, recorded so it is not rediscovered:** `subscribeEntries` builds each
record as `{ id: d.id, ...d.data() }`, so a stored field literally named `id` would override the
document id — while `bkCollect()` applies the id **last** and is immune. No document this app
writes has such a field, and `bkRestore()` strips `id` before writing, so nothing reaches it today.
The two spread orders disagreeing is the hazard, not today's data.

---

## Verdict

**BLOCK.** Not on the mechanic — the append-only rebuild is sound and I could not break it. Block
on the reader that was left behind: v69 creates, for the first time, weight documents that do not
mean what a raw read of them says, and the one place that still reads them raw is the document
handed to the oncologist. The primary fix is one line and my suite proves it, in both directions.

Ship after Blocker 1 is fixed and `harness/audit-v69-weightreport.mjs` is 9/9. Blocker 2 is
Aaron's call on scope.
