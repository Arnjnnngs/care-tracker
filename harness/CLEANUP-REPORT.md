# CareTracker — dead demo code, data-driven reminders, and the reminder ledger

Base: `care-tracker` @ `87e89bb` (v43.3, the currently-live build).
`index.html` md5 `8136b7764f07865171c180212a4d5b09`.
`send-reminders.js` md5 `553473d553c80cd4ce8d951bb67cc7ef`.

Three pieces of work:

1. Remove the dead demo-seed code from `index.html`.
2. Rewrite `send-reminders.js` to be data-driven instead of four hand-written
   if-statements naming five medications.
3. **New:** stop silently dropping reminders when GitHub Actions runs late.

---

## Deliverables

| file | what it is |
| --- | --- |
| `cleanup-patch.py` | anchored, idempotent patch for `index.html` |
| `send-reminders.js` | the rewrite: SCHEDULE table + ledger |
| `reminder-equivalence.mjs` | old vs new, 470,880 ticks |
| `ledger-test.mjs` | late / double / missed / manual re-run, plus 4,000 randomised days |
| `sim-firestore.mjs` | in-memory Firestore + FCM used by both harnesses |
| `send-reminders.v43.3.js` | verbatim v43.3 source, md5-asserted, so the harness compares against the real thing |

```
python3 cleanup-patch.py /path/to/care-tracker     # --check to dry-run
node reminder-equivalence.mjs                      # ~5.5 min
node ledger-test.mjs                               # ~5 min
```

Nothing in here touches the network. There is no `firebase-admin` import in
any harness, no credential, no URL. The real database holds one cancer
patient's medication history and the tests are structurally incapable of
reaching it.

---

## 1. Dead demo code

Six things removed, all unreachable in the shipped build:

| # | thing | where |
| --- | --- | --- |
| 1 | `seedDemo()` | the seeder itself, ~20 lines |
| 2 | the auto-seed call site | `if (false && wasEmpty && ...) { seedDemo(); }` |
| 3 | the orphaned `wasEmpty` binding | only ever read by (2) |
| 4 | `state.demo` | only ever set by (1) |
| 5 | the demo banner UI | only rendered when `state.demo` |
| 6 | the `checkNotifications` demo guard | `&& !state.demo` |

The docs claim this went away in v28. It did not. The call site was neutered to
`if (false && ...)` and everything else was left in place — the function, the
flag, the banner and the guard all still shipped to the phone.

**Result:** 237,442 → 235,655 bytes, md5 `8df3dd80cbab24d76ce6d70acab87eaf`.

**Net −1787 bytes, not the −1782 previously reported.** The five-byte difference
is deliberate: edit 2 also removes the comment
`// If first load and no entries, offer to seed demo data`, which after the
removal describes code that no longer exists. Leaving it would be a lie in the
source.

Properties of the patch:

- **Anchored.** Every edit matches a unique exact literal. A drifted anchor is a
  hard error with a non-zero exit, never a fuzzy match and never a silent no-op.
- **Idempotent.** Second and third runs are clean no-ops, exit 0. Safe to run
  after the calendar / backup-restore / tour patches land.
- **Narrow.** Writes only `index.html`. `APP_VERSION` is in an explicit
  protected list and the patch aborts if the edit set would change it. `sw.js`
  is never opened. `git diff --stat` after applying: `index.html | 37 +--`,
  one file.
- **Post-conditions.** After patching, the file must contain none of `seedDemo`,
  `state.demo`, `wasEmpty`, `demo: false`, `demo: true`. Otherwise it fails.

Verified: the extracted `<script>` block passes `node --check` after the patch.

---

## 2. The rewrite

### Before

Four literal if-statements naming Protonix, Buspirone, Paroxetine, Iron and
Compazine inline, plus two near-identical functions (`protonixMorningLogTs`,
`protonixEveningLogTs`) that differed only in a time range and each ran their
own Firestore query.

### After

One `SCHEDULE` table — the only place in the file a medication is named:

```js
{ id, at: {hour, minute}, title, body, tag,
  anchor?: { medId, fromMs, toMs, offsetMs } }
```

`anchor` expresses "this dose actually opens `offsetMs` after another med's
logged dose, and `at` is only the fallback for when that med hasn't been logged
yet". The two lookup functions collapse into one parameterised
`loadAnchors()` that runs **one** query per distinct anchor medication instead
of two.

Preserved exactly, and deliberately:

- the `medId ==` -only query. A compound `medId == && ts >=` query needs a
  composite index; this project defines none, so it would throw at query time.
  The range check stays in JS.
- a lookup failure falls back to the static window rather than dropping the
  reminder.
- the invalid-token pruning in `sendToAll`.
- quiet hours, 10:05 PM – 8:00 AM Central, as an absolute veto.
- the early tolerances (5 min static, 12 min anchored). **These are not
  cosmetic.** Anchored targets land on arbitrary minutes while cron only ticks
  on :00 and :30; without the wider tolerance an anchored evening dose would
  first become due at 22:30, inside quiet hours, and be suppressed entirely.

---

## 3. The ledger

### The bug

v43.3 decided "send?" by asking **is it 8:00 right now?** — a ±5-minute
wall-clock window on a cron that Actions runs late whenever it feels like it. A
run due at 13:00 that starts at 13:08 sent nothing. No error, no retry, no log,
no trace. The reminder simply never happened and nobody could tell afterwards.

It now asks **has this dose's reminder already gone out today?** and keeps the
answer in Firestore.

### Shape

Three document kinds plus a marker, all at deterministic IDs in
`reminder_ledger`:

```
<dateKey>__<doseId>__a<n>            claim   — "this run is sending attempt n"
<dateKey>__<doseId>__a<n>__result    result  — outcome of attempt n
<dateKey>__<doseId>__missed          missed  — terminal: this one is not going out
__genesis                            marker  — the first day the ledger existed
```

**Append-only by construction.** Only `create()` is ever called. Never
`update()`, never `delete()`. State is expressed by *which documents exist*,
not by any document's contents changing. The simulator throws on `set()` and
`update()`, so the tests passing at all proves no code path attempts one.

The deterministic ID is also the concurrency primitive. Firestore's `create()`
fails with `ALREADY_EXISTS`; two runs racing on the same dose both read "not
sent", both call `create()`, exactly one wins, the loser does not send. No
transaction, no update, no lock document.

**Claim before send, result after.** A run killed mid-send leaves a claim with
no result — visibly incomplete rather than falsely settled. After
`STALE_CLAIM_MS` (10 min, longer than a real run, shorter than the 30-minute
cron cadence) that claim is presumed dead and the dose gets one more attempt,
up to `MAX_SEND_ATTEMPTS` (3). "Delivered" is inferred from a *result*
document, never from a claim.

### The cutoff — `LATE_GRACE_MS = 90 minutes`

This is the number that decides whether a cancer patient gets told to take a
dose she should no longer take, so here is the whole argument.

**Why there must be a cutoff at all.** Every dose in this schedule has a real
clinical window, and the narrowest is two hours — the app's own copy says
*"Protonix — evening dose (window closes 10 PM)"* for a dose due at 8 PM. A
reminder that arrives after its window has closed is not a late reminder, it is
a wrong instruction.

**Why 90 and not less.** Actions queue delays are routinely 5–15 minutes and
pathologically reach roughly an hour; scheduled workflows are explicitly
best-effort and get dropped under load. A 30-minute grace would still lose the
dose on a bad morning, which is the bug we are fixing. 90 minutes clears
essentially all recoverable lateness.

**Why 90 and not more.** At 90 minutes into a 2-hour window there is still half
an hour left to act — the reminder is late but true. Past that it starts lying.
And these meds are **chained**: Iron/Compazine open two hours after the
*logged* evening Protonix. A reminder several hours late collides with the next
dose's reminder, and two pushes minutes apart naming different medications is
exactly how a double-dose happens. A four-hour grace would let a morning
reminder arrive at lunchtime.

**90 minutes is the widest value that keeps every reminder inside the window it
is about.** Past the cutoff the right surface is the app's own missed-dose UI,
which shows the dose in context against everything else logged that day; a push
cannot do that. So past the cutoff we record the miss and stay quiet.

It is a named constant with this reasoning attached in the source, not a magic
number, and `ledger-test.mjs` pins both sides of the boundary: 89 minutes
late sends, 91 minutes late records a miss.

### The four required behaviours

| requirement | how | proof |
| --- | --- | --- |
| a LATE run must still send | due-ness is `now >= target − early && now − target <= 90 min`, not "is it exactly 13:00" | 8 / 75 / 80-minute-late scenarios all deliver |
| ...but not one so stale it misleads | 91 minutes late records `missed{reason:'too-late'}` and sends nothing | boundary pinned both ways |
| a DOUBLE run must NOT double-send | delivery is settled by an existing ok-result; concurrent runs are settled by `create()` losing | 2 and 5 simultaneous runs → exactly 1 send; 4,000 randomised days → 0 duplicates |
| a MISSED run must be handled sanely and never vanish | in-window gaps recover if within grace; anything terminal writes a `missed` document; a whole-day outage is backfilled by the next day's first run | whole-day outage → 4 `no-run` records; healthy day → 0 |
| idempotent, survives manual re-run | every write is create-at-a-deterministic-ID | replaying all 48 runs of a day sends 0 more and writes 0 new documents |

### Why `Object.create(null)` (rule 7)

The ledger is keyed by dose id and date key. A plain `{}` inherits
`Object.prototype`, so on an **empty** map `byDose['constructor']` is a truthy
function — a dose called `constructor` or `toString` would read as
already-delivered and never be sent. Every such map uses `Object.create(null)`.
Tested directly: the map has a null prototype, `constructor` / `toString` /
`__proto__` / `hasOwnProperty` / `valueOf` all read `undefined` on an empty
map, and a dose genuinely named `constructor` still round-trips.

### Failure modes

- **Ledger unreadable → fail closed.** If we cannot know what already went out,
  re-pushing the whole day at once is far worse for the patient than one
  skipped reminder. The run sends nothing and says so.
- **Entries unreadable → fail open**, to the static window, exactly as v43.3
  did. Losing the anchor must not lose the reminder.
- **FCM fails → recorded as a non-ok result**, retried on a later run, capped
  at 3 attempts, then recorded as `missed{reason:'attempts-exhausted'}`.
- **No registered devices → recorded as not-delivered**, so it retries if a
  token registers later that day.

### Growth and cost

About 10 documents per day. The daily read is
`where('dateKey','==',<today>)` — a single-field query on Firestore's automatic
index, so read cost stays constant regardless of history size. Deletes being
blocked after 48 h is not a problem: nothing ever needs deleting.

---

## Firestore rules — no change needed, and Aaron does not have to touch Firebase

**Stated loudly because the brief asked for it.**

The design works under append-only rules: create-only, at deterministic IDs,
never an update, never a delete. It does not need the rules relaxed.

There is a second, separate reason nothing is needed: **`firebase-admin`
bypasses Firestore security rules entirely.** `send-reminders.js` runs with a
service account in GitHub Actions, so its writes are not evaluated against the
rules at all. The append-only shape is kept anyway because it is the stated
constraint and because it is what would let the app UI read this data later.

**The one future case that would need Aaron:** if the app UI is ever changed to
*display* missed doses, `index.html` reads via the web SDK and would need a read
rule for `reminder_ledger`. Nothing is needed to ship what is here.

---

## Findings

### 1. v43.3 never sends ~1 in 6 anchored reminders, even when Actions is perfectly on time

This is not a lateness bug. It is geometry.

Cron ticks at :00 and :30 — 30 minutes apart. The anchored branch fires only
within ±12 minutes of a target derived from when Protonix was actually logged.
A ±12 window around ticks 30 minutes apart covers 24 minutes in every 30 and
leaves **a five-minute hole**. If Protonix is logged at a minute that puts the
+2 h target at :13–:17 past a tick, *no tick is ever within 12 minutes* and the
Iron/Compazine (or Buspirone/Paroxetine) reminder is **never sent at all**.

Concretely: Protonix logged 08:15 → Buspirone/Paroxetine target 10:15 → 15
minutes from the 10:00 tick, 15 from the 10:30 tick → nothing, ever.

v43.3's own comment says the window *"reliably catches exactly one tick without
double-firing or (usually) missing the run."* The `(usually)` is the bug.

Measured by pass 3 of the equivalence harness across 1,147 simulated production
days: 170 reminders that v43.3 drops and the rewrite delivers.

### 2. Quiet hours and late-recovery genuinely conflict — Aaron's call, not mine

Quiet hours start at 22:05. The evening-meds reminder's static time is 22:00,
and its anchored target can be later. So:

- a run **more than 5 minutes late cannot deliver the 10 PM evening reminder** —
  ever;
- an anchored evening target past 22:05 (Protonix logged after 20:05) can never
  be delivered.

v43.3 had exactly the same hole and said nothing about it. I did **not**
unilaterally change quiet hours — that is a patient-facing policy and it is
Aaron's to set. What changed is that the dose is now recorded as
`missed{reason:'quiet-hours'}` instead of vanishing. Both cases are pinned by
tests so they cannot regress unnoticed.

**If Aaron wants the 10 PM reminder to survive a late run**, moving the
quiet-hours start from 22:05 to 23:00 is a one-constant change
(`QUIET_LATE_HOUR` / `QUIET_LATE_MINUTE`). I have not made it.

### 3. `centralMidnightTodayMs` is an hour wrong on DST days, and two bugs cancel

Found by chasing a falsification that refused to go red.

`centralMidnightMs` (carried over verbatim from v43.3) computes "hours since
midnight" from the wall clock, which is not the same thing on a 23- or 25-hour
day. Measured:

```
2026-03-08 (spring fwd)  d0 -> Mar 7, 11:00 PM   d0+12h -> 12:00 PM   d0+24h -> 12:00 AM Mar 9
2026-11-01 (fall back)   d0 -> Nov 1, 01:00 AM   d0+12h -> 12:00 PM   d0+24h -> 12:00 AM Nov 2
```

`d0` is an hour early on spring-forward and an hour late on fall-back. That
error **exactly cancels** the naive `d0 + hour*HOUR` offset error for every
instant after the 2 AM transition — which is why all four SCHEDULE times come
out right by accident, and why deleting the DST correction in `centralTargetMs`
changed no observable behaviour at first.

Consequences, stated precisely:

- The anchor windows' noon split and day end are **correct**. Only the window's
  *opening* boundary is off by one hour, for one hour, twice a year, at
  23:00–00:00 / 00:00–01:00 — hours in which nothing is dosed (the doses are
  8 AM and 8 PM).
- I left it alone. Changing it is a behaviour change beyond this rewrite's
  remit, and `index.html` computes its day boundary the same way, so the two
  must agree. It is now documented in the source with the measured values.
- The correction loop in `centralTargetMs` stays, and is now genuinely
  exercised: `ledger-test.mjs` sweeps all 48 half-hour wall times on both
  transition days. Without the loop, targets in the 00:00–01:59 band are an
  hour wrong. The test probes which wall times actually exist rather than
  hardcoding the US DST rule, because 02:00–02:59 does not exist on
  spring-forward day.

### 4. The workflow needs no change

`.github/workflows/reminders.yml` is untouched. The existing
`0,30 13-23 * * *` / `0,30 0-4 * * *` cron plus `workflow_dispatch` is exactly
what the ledger is designed around, and manual dispatch is now inert rather
than a double-send risk.

---

## Verification

### Equivalence — `reminder-equivalence.mjs`

The **real** v43.3 source is loaded from disk, md5-asserted against
`553473d553c80cd4ce8d951bb67cc7ef`, its four-line firebase-admin bootstrap and
trailing invocation stripped, and evaluated with `db`, `admin`, `Date` and
`console` injected. Every window, string and offset in the old side is
untouched v43.3 — not a paraphrase. Comparison is on the **outbound FCM
messages**, the actual thing the patient receives, not on any internal call.

The claim is not "identical", because the whole point is that v43.3 drops
reminders. It is three machine-checked propositions:

1. **Superset.** Every reminder v43.3 sends, the rewrite also sends, at the same
   tick, with a byte-identical payload. No tick, no fixture where v43.3
   notifies and the rewrite does not.
2. **Every extra is a recovered drop.** Every reminder the rewrite sends that
   v43.3 does not is a dose already due, later than v43.3's own tolerance, and
   within `LATE_GRACE_MS`. Exactly the set v43.3 was discarding.
3. **No new payloads.** Nothing is emitted that isn't in the schedule.

```
Pass 1  CDT 2026-06-15              362,880 ticks   (1440 min x 21 x 12)
Pass 2  CST / spring-fwd / fall-back 108,000 ticks
Pass 3  1,147 production-grid days, persistent ledger

ticks compared (both engines at each):  470,880
engines agree exactly:                  385,914  (81.956%)
sends by the rewrite v43.3 dropped:      87,324
duplicate sends by the rewrite:               0
violations:                                   0
```

The 18% of ticks where they differ is entirely late-window recovery — every one
classified and justified.

### Ledger — `ledger-test.mjs`

157 named scenario checks plus a randomised whole-day simulation. Each
simulated day independently makes every scheduled tick on-time / late by up to
3 h / dropped / duplicated, adds random `workflow_dispatch` runs, and applies
random FCM outages. Seeded PRNG, so any failure is reproducible.

Seven invariants per day: no dose delivered twice; nothing delivered past the
grace; nothing delivered early beyond tolerance; nothing delivered in quiet
hours; delivered and recorded-missed are mutually exclusive; **every dose is
either delivered or has a missed record**; every ledger write is a `create()`
and no ID is written twice. Then the entire day is replayed and must produce
zero further sends.

```
4,000 randomised days
simulated workflow runs:   188,610
reminders delivered:        13,002
misses recorded:             2,998
checks passed:              28,157
failures:                        0
duplicate deliveries:            0
silent disappearances:           0
```

### Falsifications

Every check was broken on purpose and confirmed RED, then restored. 9 for 9.

| mutation | harness | result |
| --- | --- | --- |
| `LATE_GRACE_MS = 0` | equivalence | RED — 493 violations, all `REGRESSION: v43.3 sent, rewrite did not` |
| drop "Compazine" from a body string | equivalence | RED — 688 violations, both regression and unjustified-extra |
| anchor offset 2 h → 3 h | equivalence | RED — 408 violations |
| remove the DST correction in `centralTargetMs` | ledger-test | RED — 00:00/00:30/01:00/01:30 resolve an hour wrong on both transition days |
| `Object.create(null)` → `{}` in `loadLedger` | ledger-test | RED — prototype keys read as records |
| remove the already-delivered check in `decide()` | ledger-test | RED — double-send |
| `record-miss` → `skip` on too-late | ledger-test | RED — misses vanish |
| remove the genesis gate | ledger-test | RED — first run ever invents 4 historical misses |
| `STALE_CLAIM_MS` = 24 h | ledger-test | RED — a dead claim is never retried |

`cleanup-patch.py` falsified separately: a one-character whitespace change to
edit 6's anchor → `FAIL: anchor not found and not already applied`, exit 3; a
duplicated anchor for edit 4 → `FAIL: anchor matched 2 times (expected 1)`,
exit 3. Both refuse to guess.

**The DST falsification initially came back GREEN.** That was not a false alarm
in the mutation — it was a hole in my test, and chasing it produced finding 3
above. The test now sweeps every real wall time on both transition days and the
mutation goes red.

---

## What I did not do

- Did not push to GitHub.
- Did not change `APP_VERSION` or `sw.js`.
- Did not point anything at real Firestore. No `firebase-admin` import, no
  credential, no URL in any harness.
- Did not change quiet hours (finding 2) — patient-facing policy, Aaron's call.
- Did not change `centralMidnightMs` (finding 3) — behaviour change beyond
  remit, and the client depends on the same computation.
- Did not change `.github/workflows/reminders.yml` — none needed.
