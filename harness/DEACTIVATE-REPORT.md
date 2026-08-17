# Deactivated medications still show a Home card — root cause, audit and fix

**Reported by Aaron:** *"I noticed on the home screen that Imodium has a card when I already deactivated it in the meds section. might need to check that for others."*

| | |
|---|---|
| Base | `index.html` md5 `8136b7764f07865171c180212a4d5b09` — v43.3, the exact build on their phones |
| Patched | `index.html` md5 `35ae4b8d234dde543b46af4220a32b4d` |
| Diff size | 40 changed lines across 6 sites (comments included) |
| `APP_VERSION` | untouched, still `v43.3` |
| `sw.js` | untouched |
| `send-reminders.js` | untouched — deliberately, see §5 |
| Suite | `deactivate-test.mjs` — **34 passed, 0 failed** on the patched build; **9 fail** on the shipped build; **13/13 mutators turn their checks RED** |

---

## THE HEADLINE, FIRST

**The card Aaron is looking at is not the Quick Log card. It is a separate, hardcoded "daily limit"
counter that never asks the medication config anything.**

**Aaron does NOT need to re-do the deactivation.** It saved correctly the first time. It is still
saved. It survives a reload. Nothing on disk is wrong — see §6.

---

## 1. Root cause

Home renders three per-medication *daily limit counter* cards, above the Quick Log grid.
`index.html:1628` / `:1645` / `:1666` in the shipped build:

```js
// Imodium pill counter
const imoPills = dailyPills('imodium');
const imoMax = 4;
...
if (usedRecently('imodium')) parts.push(h('section', ... 'Imodium · today' ... ));
```

and `index.html:309`:

```js
function usedRecently(id) { return entriesFor(id).some(e => e.ts >= state.now - 7 * 86400000); }
```

`entriesFor()` filters `state.entries` — **logged Firestore documents**. `usedRecently()` therefore
reads dose history and nothing else. It never touches `state.meds`, which *is* the active medication
list. So the medication configuration has no bearing whatsoever on whether these cards render: they
appear because a dose was logged in the last 7 days, and they keep appearing for 7 days after the
last dose regardless of anything done in the Meds section.

The Quick Log grid, 95 lines below at `:1745`, was always correct:

```js
const medCards = state.meds.filter(m => m.quickLog && (...))
```

That is why this looked half-broken to Aaron. One card obeyed him; the other never even looked.

### Where "deactivated" is actually stored

There is **no `active` / `inactive` / `archived` boolean on a medication** in v43.3. The Meds section
offers exactly two operations, and I drove both through the real UI:

| Control | Storage effect | Persists? |
|---|---|---|
| Trash icon → "Confirm delete" (2 taps) | med removed from `meds[]`, id added to `archivedMeds` in `localStorage['caretracker-medication-config-v1']` | yes |
| Pill toggle "Show as its own Home card" | `quickLog: false` on that med | yes |

`state.meds` **is** the active list. Membership in it is the deactivation flag. `archivedMeds` is the
tombstone that stops `mergeMissingDefaultMeds()` re-adding the medication on the next load — that
part works correctly.

---

## 2. The fix

Three edits of substance, three of hardening.

**`medIsOnActiveList(id)`**, added immediately after `usedRecently()`:

```js
function medIsOnActiveList(id) { return !!id && (state.meds || []).some(m => m && m.id === id); }
```

The three counter cards are now gated on `medIsOnActiveList(id) && usedRecently(id)`.

### Two decisions in that one line, both load-bearing

**It is gated on active-list membership, NOT on `quickLog`.** `quickLog` is `false` for every
medication folded into the grouped Morning/Evening cards — Iron, Compazine, Buspirone and Paroxetine
all ship that way and are fully active drugs. If someone grouped Tylenol into the morning card,
gating on `quickLog` would silently delete the **acetaminophen overdose meter**. That is a safety
regression, not a cosmetic one. The suite pins this as `SAFETY-grouped-med-keeps-meter`, and the
`gate-on-quickLog` mutator proves the check catches it.

**It is an array scan, not a prebuilt `{}` of ids.** A plain object keyed by medication id inherits
`Object.prototype`, so `ids['constructor']` is truthy on an *empty* map — a medication whose id
normalises to `constructor` would read as active forever. There is no lookup object here to poison.
Pinned as `FILE-predicate-has-no-object-lookup`.

### The two hardening edits (same lookup, same feature)

`nameOf()` and `reportNameOf()` both did `state.archivedMeds[id]` on a plain object. With an **empty**
`archivedMeds`, `archivedMeds['constructor']` resolves to `Object.prototype.constructor`, so:

* `nameOf('constructor')` returned the literal string **`"Object"`** as a medication name, and
* `reportNameOf()` treated the id as *known*, suppressing the `"Medication (removed)"` label —
  **in the document handed to an oncologist.**

Both now use `Object.prototype.hasOwnProperty.call(...)`. Reachability is narrow but real: only ids
that survive `safeMedicationId()` lowercasing and match an `Object.prototype` key qualify, which in
practice is `constructor` alone (`toString` → `tostring`, `__proto__` → `proto`). Fixed because it is
the same map that stores the deactivation, and because it lands in the clinical hand-off. Pinned as
`PROTO-prototype-key-id`, falsified by the `archivedMeds-bare-index` mutator.

---

## 3. PART 2 — the full consumer audit

Every consumer of the medication list, and whether a deactivated medication is correctly excluded.

| # | Consumer | Before the fix | After | Check |
|---|---|---|---|---|
| 1 | **Home — daily counter cards** (Acetaminophen / Imodium / Lidocaine) | **BROKEN.** Gated on `usedRecently()` alone; medication config ignored entirely | **FIXED** | `HOME-imodium-counter`, `HOME-tylenol-counter`, `HOME-lidocaine-counter`, `HOME-other-counters-survive` |
| 2 | **Home — Quick Log grid** | Correct (`state.meds.filter(m => m.quickLog && ...)`) | unchanged | `QUICKLOG-removed-absent` |
| 3 | **Home — grouped Morning / Evening meds cards** | Correct (`state.meds.filter(med => med.groupedMorning)`) | unchanged | covered by `ALL-MEDS-removable-and-gone-from-home` |
| 4 | **Missed-dose calculation** (`missedDosesFor`, `:390`) | Correct — iterates `state.meds.filter(m => m.alerts && m.windows)`; a removed med drops out | unchanged | `MISSED-banner-excludes-removed`, `COUNTS-missed-total-drops` |
| 5 | **Home missed-dose banner** (`:1401`) | Correct — same source | unchanged | `MISSED-banner-excludes-removed` |
| 6 | **CSV export — derived (missed-dose) rows** | Correct — `derivedMissedEntries()` calls `missedDosesFor()` | unchanged, **verified on file bytes** | `CSV-no-derived-for-removed` |
| 7 | **CSV export — logged rows** | Correct, and must stay: real medical history | unchanged, **verified on file bytes** | `CSV-keeps-logged-history`, `CSV-removed-med-keeps-its-name` |
| 8 | **Printable oncologist report — "Scheduled doses with nothing logged"** | Correct — derived from `missedDosesFor()` | unchanged, **verified on file bytes** | `REPORT-no-missed-for-removed`, `REPORT-no-removed-med-in-future-schedule` |
| 9 | **Printable report — "Doses recorded, by medication"** | Correct: counts real logged doses, including removed meds. This is *right* — see §7 | unchanged, **verified on file bytes** | `REPORT-keeps-dose-history` |
| 10 | **Printable report — daily log** | Correct, same reason | unchanged, **verified on file bytes** | `REPORT-daily-log-keeps-history` |
| 11 | **Printable report — medication naming** | **LATENT BUG** — `reportNameOf()` prototype fall-through printed `"Object"` | **FIXED** | `PROTO-prototype-key-id` |
| 12 | **Quick-log / dose-logging UI** (log buttons, dose sheets) | Correct — driven off `state.meds` | unchanged | `QUICKLOG-removed-absent` |
| 13 | **In-app reminder scheduler** (`:3205+`) | Correct — every block does `const med = state.meds.find(...); if (!med) return;` | unchanged | `NOTIF-scheduler-skips-removed` |
| 14 | **`send-reminders.js` (server push)** | **BROKEN, AND NOT FIXED TODAY.** See §5 | unchanged, **by decision** | `KNOWN-LEAK-send-reminders` |
| 15 | **History view** | Correct — shows past doses of removed meds, which is required | unchanged | `HISTORY-keeps-removed-doses` |
| 16 | **History day-summary aggregates** (`N doses`, `· N Imodium`, `· N mg APAP`) | Correct — reads `state.entries`, i.e. what actually happened | unchanged | `COUNTS-day-summary-keeps-removed` |
| 17 | **Warning banners** (ceiling exceeded, Iron+Protonix timing) | Correct — fire on a `logMed()` of an active med only; a removed med cannot be logged | unchanged | implied by #12 |
| 18 | **Streak / adherence counters** | Not medication-driven. The only streak in the app tracks daily Bowel/Appetite answers | n/a | — |

**Two things were genuinely broken. One is fixed. One is documented and deliberately not fixed.**

---

## 4. Additional finding, NOT fixed (out of scope, low harm)

The three counter cards hardcode their limits instead of reading the medication's configured ceiling:

```js
const imoMax = 4;    // :1646   — ignores med.ceilingMax / med.ceilingUnit
const lidoMax = 4;   // :1667   — same
```

Both happen to match today's `DEFAULT_MEDS` values (`imodium.ceilingMax: 4`, `lidocaine.ceilingMax: 4`),
so nothing is wrong on screen right now. But if Aaron edits Imodium's daily limit in the Meds
section, the Home card will keep saying `/ 4 pills`. **This ships alone; that is a separate change
with its own test surface. Flagging it, not bundling it.**

---

## 5. `send-reminders.js` — confirmed leak, deliberately unfixed

**It is real.** `send-reminders.js` runs in GitHub Actions. It never reads the medication config —
it *cannot*, because the config lives in `localStorage` on a phone. Every reminder is a hardcoded
string literal:

```js
await sendToAll('Morning Meds Due', 'Protonix - time for morning doses', 'morning-meds');
await sendToAll('Morning Meds Due', 'Buspirone, Paroxetine - time for morning doses', 'morning-meds-buspar');
await sendToAll('Evening Meds Due', 'Iron, Compazine - time for evening doses', 'evening-meds');
```

So if Brandi stops **Iron, Compazine, Protonix, Buspirone or Paroxetine**, the phones keep getting
push notifications naming that drug. (Imodium is unaffected only by luck — it never had a reminder.)

**Why I did not fix it in this ship:**

The only fix is to sync the medication config to Firestore so the Action can read it. Medication
config is device-local *by design today*, and Aaron's phone and Brandi's phone are already known to
disagree about her medications. A config sync built in a hotfix means whichever phone writes last
decides what the server believes — and the failure mode is **silencing a reminder for a drug she is
still taking**. An extra notification for a drug she stopped is an annoyance. A missing reminder for
a drug she is on is a missed dose. Those risks are not symmetrical, and the second one is not
acceptable to introduce on the same day as an unrelated one-line UI fix.

This needs the device-local-config decision made properly, with its own tests. It is a bigger piece
of work than the bug Aaron reported, and it should not ride along inside it.

The suite carries `KNOWN-LEAK-send-reminders`, which **pins the current state**: it asserts the file
still reads no config and still carries all five hardcoded names. If anyone changes the shape of
that file, the check goes red and forces them back to this paragraph. Nobody gets to believe the
leak is covered.

---

## 6. PART 4 — is the data recoverable? Does Aaron need to re-do anything?

**No. Aaron does not need to re-do the deactivation.**

I drove both deactivation paths through the real UI in Chromium against the exact shipped build and
read `localStorage` directly:

| What Aaron did | What was written | Survived reload | Quick Log card | Counter card |
|---|---|---|---|---|
| Trash → Confirm delete | `meds[]` no longer contains `imodium`; `archivedMeds: {imodium: {...}}` | yes | gone (correct) | **still there (the bug)** |
| Toggled off "Show as its own Home card" | `quickLog: false` on `imodium` | yes | gone (correct) | **still there (the bug)** |

The deactivation **was saved correctly and is being read correctly**. It is not a write bug and not a
corruption. One Home element simply never consulted the saved value. Once the fix is on his phone,
the card is gone with no further action.

Pinned as `PERSIST-deactivation-saved`.

### One thing Aaron does need to know, in plain language

There are two different controls in the Meds section and they do different things:

* **The trash / bin icon** (then "Confirm delete") is what actually **takes a medication off the
  active list**. Her past doses are kept — the app says so on screen, and I tested it.
* **The "Show as its own Home card" toggle** only moves a medication off the Quick Log grid. The
  medication is **still active**, still counted, still reminded about.

After this fix ships, if the "Imodium · today" card is *still* on Home, it means Imodium is still on
the active list — i.e. the toggle was used rather than the trash button. Open **Meds → Imodium →
trash icon → Confirm delete**, and it will go. Nothing else needs doing, and no history is lost.

### The device-local problem is still there

Medication config lives in `localStorage` per device. Deactivating Imodium on Aaron's phone does
**not** deactivate it on Brandi's. This fix does not change that and does not pretend to. **The
deactivation has to be done on each phone separately.** This is the known bug behind the
`send-reminders.js` leak in §5 and it needs its own piece of work.

---

## 7. PART 3 — which medications are affected, and under exactly what conditions

**Affected: exactly three medications.** The bug is not general — it is three hardcoded ids on Home.

| Medication | Home counter card | Affected |
|---|---|---|
| **Tylenol** (`tylenol`) | "Acetaminophen · today" | **YES** |
| **Imodium** (`imodium`) | "Imodium · today" | **YES** — the one Aaron saw |
| **Lidocaine** (`lidocaine`) | "Lidocaine · today" | **YES** |
| Dexamethasone, Tylenol Liquid, Zofran, Compazine, Morphine, Protonix, Buspirone, Paroxetine, Iron, Senokot | none | no — these never had such a card, so removing them was always clean on Home |

Verified exhaustively, not by inspection: `ALL-MEDS-removable-and-gone-from-home` removes **every
one of the 13 configured medications** through the real two-tap UI and asserts that no
`"<name> · today"` card is left behind for any of them. On the shipped build it reports
`Home cards left behind: ["Imodium","Lidocaine"]` (Tylenol's card is titled "Acetaminophen", caught
by its own check). On the patched build: none.

### The exact trigger conditions

The card is left behind when **both** hold:

1. the medication is one of `tylenol` / `imodium` / `lidocaine`, **and**
2. at least one dose of it was logged **within the last 7 days**.

And it is affected by **none** of these:

* **not** when it was deactivated — no version cutoff, no migration boundary;
* **not** which app version wrote the config;
* **not** as-needed vs scheduled — Imodium is `gap`, Tylenol is `gap`, and the windowed meds were
  never affected at all;
* **not** whether it had existing logged entries *in general* — only whether one falls inside the
  rolling 7-day window;
* **not** which of the two Meds controls was used — the card survived **both**.

**Why it looks intermittent:** condition 2 is a rolling 7-day window. Deactivate Imodium the day
after a dose and the card sits there for another 6 days, then vanishes on its own. Deactivate it
after a quiet fortnight and there is no card at all and nothing looks wrong. That is why this went
unreported for so long, and it is worth Aaron knowing so a "it fixed itself" doesn't get mistaken
for a fix.

---

## 8. History is preserved — tested, not assumed

Deactivating means *stop tracking it going forward*, never *erase that she took it*. Verified at
byte level:

* the **CSV** still carries every logged dose of a removed medication, with its real name, not a
  bare id (`CSV-keeps-logged-history`, `CSV-removed-med-keeps-its-name`);
* the **oncologist report** still counts them in "Doses recorded, by medication" and still prints
  each individual dose in the daily log (`REPORT-keeps-dose-history`, `REPORT-daily-log-keeps-history`);
* the **History view** still lists them by name and dose label (`HISTORY-keeps-removed-doses`);
* with **every medication removed**, the CSV still contains all 7 logged fixture rows and 0 derived
  rows, and both artifacts still contain all 5 fixture marker strings (`ALL-MEDS-export-survives-empty-list`).

The `export-erases-removed-history` mutator implements **the wrong fix** — filtering removed
medications out of `allExportEntries()` — and turns three checks red. That mutation is the mistake
this brief was most at risk of, and it is now guarded.

### One behavioural consequence Aaron should understand

Removing a *scheduled* medication (Iron, Protonix, Buspirone, Paroxetine, Dexamethasone) removes its
**calculated missed-dose rows for the entire history**, not just going forward — because
`derivedMissedEntries()` recomputes from `MISSED_TRACK_SINCE` against the *current* configuration
every time an export is built. Her **logged** doses are completely untouched; only the *inferred*
"nothing logged against this scheduled dose" rows disappear.

This is pre-existing v43.3 behaviour, and the report already states it in its own caveat: *"These are
calculated from the medication schedule saved on this device, not entries Brandi made."* It is
arguably the right outcome — you do not want to hand an oncologist a list of "missed" doses of a drug
she was told to stop. But it is a real effect and Aaron should not be surprised by it.

---

## 9. Falsifications — what I broke, and what went red

Every check in this suite was proved to be capable of failing. `node deactivate-test.mjs --falsify`
applies 13 mutators to the **patched** build and asserts the named checks go RED.

| # | Mutator | What it restores or breaks | Checks that went RED |
|---|---|---|---|
| 1 | `revert-imodium-gate` | the shipped bug, verbatim | `HOME-imodium-counter` |
| 2 | `revert-tylenol-gate` | same, on the acetaminophen meter | `HOME-tylenol-counter` |
| 3 | `revert-lidocaine-gate` | same, on Lidocaine | `HOME-lidocaine-counter` |
| 4 | `predicate-always-true` | `medIsOnActiveList` returns `true` — gate present but meaningless | all three HOME checks |
| 5 | `gate-on-quickLog` | gates ceiling meters on `quickLog` — deletes the overdose guard for a grouped Tylenol | `SAFETY-grouped-med-keeps-meter` |
| 6 | `missed-doses-from-DEFAULT_MEDS` | missed doses computed off `DEFAULT_MEDS` — a removed drug keeps alerting, keeps CSV rows, keeps a report row | `MISSED-banner-excludes-removed`, `CSV-no-derived-for-removed`, `REPORT-no-missed-for-removed` |
| 7 | `export-erases-removed-history` | **the wrong fix** — strips removed meds from the backup and the clinical hand-off | `CSV-keeps-logged-history`, `REPORT-keeps-dose-history`, `REPORT-daily-log-keeps-history` |
| 8 | `history-hides-removed` | hides removed meds from History — erases that she took them | `HISTORY-keeps-removed-doses` |
| 9 | `archivedMeds-bare-index` | restores the prototype fall-through — `"Object"` prints in the oncologist report | `PROTO-prototype-key-id` |
| 10 | `quicklog-ignores-active-list` | Quick Log rendered from `DEFAULT_MEDS` — removed med keeps a loggable button | `QUICKLOG-removed-absent` |
| 11 | `app-version-bumped` | touches `APP_VERSION` | `FILE-app-version-untouched` |
| 12 | `meds-delete-button-32px` | shrinks the Meds remove control below 44px | `TAP-meds-targets-44px` |
| 13 | `med-form-input-shrunk` | drops editor fields below the v43.3 13px baseline | `FONT-inputs-16px` |

**Result: 13/13 turned their named checks RED. No check is blind.**

### The strongest falsification: the suite run against the shipped build

`node deactivate-test.mjs --file base/index.html` — the unmodified v43.3 that is on their phones
right now — **fails 9 checks**, including `HOME-imodium-counter`, `HOME-tylenol-counter`,
`HOME-lidocaine-counter`, `ALL-MEDS-removable-and-gone-from-home`, `PERSIST-deactivation-saved` and
`PROTO-prototype-key-id`. The same suite passes 34/34 on the patched build. The checks describe a
real, currently-live defect and its removal, not a tautology.

### One falsification of my own work, worth recording

My first draft of `bodyText()` read `document.body.textContent`. The whole app is **one inline
`<script type="module">` inside `<body>`**, so `document.body.textContent` contains the *source
code* — including `'Imodium · today'` as a string literal. Every Home check passed on the shipped
build for that reason, and the baseline check would have passed forever.

This is precisely the failure mode in the brief — *"a previous agent checked the screen for three
straight rounds and missed a live leak."* `bodyText()` now clones the body and strips
`script`/`style`/`template`/`noscript` before reading, and the comment above it says why. It was
caught because the checks were run against the unpatched build and *did not go red*, which is the
only reason to ever run them there.

---

## 10. Safety of the harness

* All **three** gstatic Firebase modules are stubbed with in-memory ES modules. Nothing can reach
  the real Firestore.
* A catch-all route **aborts every request** that is not `127.0.0.1`, one of the three stubs, or a
  `data:`/`blob:` URL. `NET-no-escape` fails the run if any request was allowed to a non-local
  origin, and reports any Firestore/FCM URL that was even attempted (zero).
* The **service worker is blocked** before any page script runs — with a stub whose `register()`
  never settles, because the app guards with `'serviceWorker' in navigator` and an undefined getter
  still satisfies `in` and then throws. `sw.js` is cache-first and would serve a stale build between
  runs. `NET-no-sw` fails the run if it was ever requested (it was not).
* `Notification` is stubbed as permanently denied so no permission prompt can hang the run.
* `window.open` returns `null`, taking the app's documented "open it from Downloads" branch — the
  file is written *before* that call, so the bytes under test are identical either way.
* **Fixtures only.** No credentials, no real patient data, no writes anywhere but the in-memory stub.

Run at **375x812** and **390x844**, `isMobile`, `hasTouch`, DPR 2.

---

## 11. Files

```
/home/claude/rebuild/deactivate/
  deactivate-patch.py       anchored, idempotent, refuses loudly on md5 or anchor mismatch
  deactivate-test.mjs       34 checks + 13 falsification mutators
  DEACTIVATE-REPORT.md      this file
  work/index.html           patched build, md5 35ae4b8d234dde543b46af4220a32b4d
  work/send-reminders.js    unmodified copy, for KNOWN-LEAK-send-reminders
  base/index.html           pristine v43.3, md5 8136b7764f07865171c180212a4d5b09
```

### Commands

```bash
# apply (refuses on anything but the v43.3 base; re-running is a no-op)
python3 deactivate-patch.py --file /path/to/index.html

# verify
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node deactivate-test.mjs                       # -> 34 passed, 0 failed

# prove the checks catch the live bug
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node deactivate-test.mjs --file base/index.html --send-reminders base/send-reminders.js
                                                 # -> 25 passed, 9 failed

# prove the checks can fail
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node deactivate-test.mjs --falsify             # -> 13/13 mutators RED
```

`APP_VERSION` and `sw.js` are untouched. Set the version at ship time.
