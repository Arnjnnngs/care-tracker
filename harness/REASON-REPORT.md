# Missed-dose reasons — port report

**Deliverables:** `reason-patch.py`, `reason-test.mjs`, this file, plus three screenshots
(`shot-history-rows.png`, `shot-reason-sheet.png`, `shot-reason-chosen.png`).

**Base:** care-tracker `main` @ `125583d`, `index.html` md5 `8136b7764f07865171c180212a4d5b09` (v43.3).
**Patched md5 (reason patch alone):** `aaa660fdea6fc2c60dcfbf209e02e066`.
**Patched md5 (calendar + reason, either order):** `21dbefeeca109ac183718e0e7c538189`.

---

## 1. What I found in ChemoWell — read this part first

Aaron's request was: *"I think in the chemowell app, there is something for missing doses where they
can select a reason. that should also be ported."*

**There is no missed-dose reason picker in ChemoWell.** I searched the whole 733 KB `index.html`,
`BACKLOG.md`, `REQUESTS.md`, `README.md`, `TEAM.md`, the `outputs/` tree, and the full git history
including `git log -S` on `missedReason`, `skipReason`, `missReason`, `missed_reason`. Nothing.

Two things exist in ChemoWell, and I believe Aaron has merged them in memory.

### 1a. What ChemoWell actually does with a missed dose — three buttons, no reason

`index.html:527–549`:

```js
// Per-row alternative to the banner's bulk "Clear": dismiss just this one missed window without
// logging a dose or creating any record. Stored as a list of "medId|ts" keys in prefs.
async function dismissMissedDose(e) { ... }

// Per-row "Skipped": writes a real (permanent) entry marking this window as intentionally not
// given, rather than just hiding it. missedDosesFor() treats a skipped:true entry the same as a
// real dose for coverage purposes.
async function skipMissedDose(e) {
  await addEntryDB({ medId: e.medId, dose: null, mg: 0, ts: e.ts, skipped: true });
  ...
}
```

and its own help text confirms there is nowhere to say why (`index.html:2225`):

> **How do I clear a missed dose?** — *"Every missed dose has three buttons — Took later, Skipped,
> and Clear. They mean different things. […] **Took later** — the dose was given, just late. […]
> **Skipped** — it was deliberately not given. This records that decision, permanently. […]
> **Clear** — just remove the flag. Nothing is recorded."*

No reason is captured on any of the three paths.

### 1b. What ChemoWell *does* have — an optional "Reason for change" picker, on WEIGHT

`index.html:2087–2102`, added in app-v21 and attributed in the source comment to Aaron himself:

```js
// Weight-change reasons (app-v21, per Aaron's request) — a quick-select list of the most common
// drivers of a fast weight swing in chemo/radiation patients, sourced from oncology-nursing and
// cancer-society guidance on what's worth documenting.
const WEIGHT_REASONS = [
  { id: 'paracentesis', label: 'Paracentesis (fluid drained)' },
  { id: 'fluid_retention', label: 'Fluid retention / swelling' },
  { id: 'poor_appetite', label: 'Poor appetite / eating less' },
  { id: 'nausea_vomiting', label: 'Nausea, vomiting, or diarrhea' },
  { id: 'steroid', label: 'Steroid medication' },
  { id: 'illness', label: 'Illness / infection' },
  { id: 'increased_appetite', label: 'Eating more / appetite up' },
  { id: 'other', label: 'Other' }
];
```

It renders as an optional `<select>` inside the log-confirm modal (`index.html:3549`), labelled
**"Reason for change (optional)"**, stored on the entry as `weightReason`, and surfaced in History
labels and in the Weight report. ChemoWell's own help describes the interaction exactly as Aaron
described it (`index.html:2239`):

> *"A **Reason for change** list appears. It's optional — skip it if nothing applies. Choose from
> things like fluid drained, fluid retention, poor appetite, nausea, steroid medication, illness, or
> eating more. […] All of it shows up in the Weight report."*

### 1c. What I therefore built

I ported **the interaction**, not the list: an optional quick-select reason, always skippable,
stored on the record, shown back in the log, and summarised in the printable report — attached to
care-tracker's missed doses instead of to a weight reading.

The list itself is new. ChemoWell's reasons are about fluid and appetite and say nothing usable
about a missed dose. Every word of the new list is argued in §3 below.

This is stated plainly at the top of `reason-patch.py`, in the feature block's own comment, and
here, so that nobody downstream reads this as "the ChemoWell missed-dose feature" when no such
feature exists. **If Aaron wants only the literal weight-reason picker ported instead, that is a
different and much smaller job — say the word and I will do that instead.**

---

## 2. Missed-dose identity — the hard part

A missed dose in care-tracker is not a document. `missedDosesFor(dayTs, now)` recomputes the whole
set from the medication schedule on every render — several times a second — so there is no id to
attach a reason to.

**Identity chosen: `medicationId + '|' + windowStartTimestamp`.**

```js
function mrKey(medId, ts) { return String(medId) + '|' + Number(ts); }
```

That is exactly the pair the derived miss object already carries (`{ missed:true, medId, ts,
windowName }`), and it is what the Today banner already prints. It is stable under re-derivation
because the window start is a pure function of the day and the saved schedule:
`dayStart(day) + window.start * 3600000`.

Every consequence, stated up front rather than discovered later:

| Event | Effect on a recorded reason | Is that right? |
|---|---|---|
| Window **renamed** (`Morning` → `AM`) | Reason survives — the name is not in the key | Yes. Renaming is common. |
| Window **start hour changed** (8 AM → 9 AM) | Reason no longer matches; it is not shown | Yes. The window it described no longer exists. |
| Two windows on one medication **starting at the same hour** | They share one key and one reason | Least-wrong option. They are already indistinguishable to the banner and to the CSV. |
| Dose **logged late**, covering the window | The miss disappears, and the reason with it | Yes. A reason is only ever read through a currently-derived miss. |
| …and then the covering dose is removed | The miss returns, and so does the reason | Yes — the document was never deleted. |
| Medication **deleted/archived** | Its misses stop being derived, so its reasons stop showing | Consistent with the base app. |

The key is also emitted into the DOM as `data-mr-missed-row="protonix|1786147200000"`. That is not a
test-only hook: it is the one place the derived identity is externally visible, which is what lets a
test prove a reason attached to *that* window and to no other, and makes a mis-attached reason
findable in the DOM rather than only in Firestore.

### Storage, and why not a new collection

Reasons are ordinary documents in `caretracker_entries` under `medId: 'missed_reason'`:

```js
{ medId: 'missed_reason', missMedId, missTs, missWindow, reasonId, reasonLabel, note,
  ts: missTs, mg: 0, dose: 'Missed-dose reason', loggedAt: Date.now() }
```

* **A separate collection was rejected.** The published rules match named collections; a client
  write to an unmatched path is refused. The feature would have failed silently on the live build
  and worked perfectly in every harness. Rules cannot be redeployed as part of a patch to
  `index.html`.
* **The medId must not be a real medication's id.** `missedDosesFor()` treats *any* same-day entry
  under a medication's own id as covering a window, so a reason filed under `protonix` would have
  erased the very miss it was describing. This was the single most dangerous available mistake.
* `reasonLabel` is a **snapshot of the words shown at the time**, so editing `MR_REASONS` later
  cannot retroactively change what a past record says. `mrLabelFor()` prefers the live label and
  falls back to the snapshot for an id this build no longer knows.

### Append-only: changing an answer

Nothing calls `updateDoc`, `setDoc` or `deleteDoc`. There are exactly two writes in the feature and
both are `addEntryDB`:

* **Change an answer** → append a new document for the same key. `mrSupersedes()` picks the newest
  `loggedAt`, with a document-id tie-break so two devices resolving the same pair cannot disagree.
* **Remove an answer** → append a document with `reasonId: ''` and `note: ''`. `mrReasonFor()` reads
  that as "no reason". Deletes are refused by the rules after 48 h, and a reason recorded last week
  must still be retractable — people mis-tap.

---

## 3. The wording, and why

Nine options, illness-first:

| id | label |
|---|---|
| `nausea` | **Felt too nauseous** |
| `unwell` | **Felt too unwell** |
| `vomited` | **Couldn't keep it down** |
| `asleep` | **Was asleep** |
| `time` | **Lost track of the time** |
| `away` | **Didn't have it with me** |
| `ranout` | **Ran out of it** |
| `held` | **Care team said to hold it** |
| `other` | **Something else** |

Plus one optional free-text field, 140 characters, labelled *"Anything else worth remembering"*.

**What I changed relative to ChemoWell, and why.** ChemoWell's list is not reusable — it is a weight
list. Two of its conventions I deliberately did **not** carry over:

1. **"Other" → "Something else."** "Other" is form language; it makes the person feel like a row in
   a dataset. "Something else" is what a person says.
2. **ChemoWell's list is a `<select>` dropdown.** Here it is a chip grid. A dropdown hides every
   option behind a tap and reads as a required field; visible chips read as a menu you may ignore.

**Every label is a description, never a verdict.** The rule I applied: *no option should be one a
person would be ashamed to tap.*

* **"Lost track of the time"** replaces "Forgot". Forgetting is the single most common cause of
  non-adherence and the list is useless without it — but in an app used by someone on chemotherapy,
  after a bad night, "Forgot" is heard as a judgement about her rather than a description of the
  day. "Lost track of the time" carries identical information to a clinician and no verdict.
  Aaron's brief named "Forgot / careless" explicitly as the thing to avoid; the test suite has a
  mutator that puts that exact string back and a check (`COPY-no-judgment`) that goes red on it, so
  it cannot creep back in later.
* **"Care team said to hold it"** exists because a *held* dose is clinically the opposite of a
  missed one, and an oncologist reading "3 doses not logged" needs to see immediately that one of
  them was on their own instruction. This is the highest-value entry in the list.
* **"Couldn't keep it down"** is separated from "Felt too nauseous" because vomiting after
  swallowing may mean the dose needs repeating, and nausea before swallowing does not. Different
  clinical action, different option.
* **"Ran out of it"** is a supply-chain fact, not a personal failing, and it is directly actionable
  by the prescriber — it is the one reason on this list a doctor can *fix*.
* **Order is illness-first.** Adherence literature would put forgetting first by frequency. Leading
  a cancer patient's list with a time-management option implies the app's default theory of her is
  carelessness. The illness reasons lead; the practical ones follow.

**The screen copy.** Title: **"Add a reason"** — not "Why did you miss this dose?", which is an
interrogation. Body: *"Completely optional — it just gives the care team the context. Skip it,
change it or remove it whenever you like."* That single line does three jobs: it says it is
optional, it reframes the audience from the app to the care team, and it promises reversibility
before she commits.

Section label is **"What happened"**, not "Reason for missing" — the neutral framing of an event
rather than of a failure.

---

## 4. Where it appears, and where it deliberately does not

| Surface | Behaviour |
|---|---|
| Missed row (Today's journal and History) | A quiet second line under the existing tap-to-log strip: `Add a reason`, or the chosen reason as a chip plus `Change`, plus the note if one was written. |
| The reason sheet | Opened only by an explicit tap on that button. Overlay-tap, Cancel and Save all dismiss it. |
| **Missed-dose banner on Home** | **Unchanged.** No prompt, no "N unexplained", no badge. Asserted by `BANNER-unchanged`. |
| **Printable oncologist report** | **Yes** — see below. |
| **CSV export** | **No** — see §5. |
| Notifications / reminders | Untouched. `send-reminders.js` filters on `medId == 'protonix'` and cannot see a reason document. |

### The report — my recommendation, and what it does

**Recommendation: yes, include it.** "Missed 3 doses, all nausea" is genuinely valuable to an
oncologist and is exactly the kind of thing that gets lost between appointments. Three blank rows
are worth nothing.

It is implemented as its own labelled subsection **inside** the existing *"Scheduled doses with
nothing logged"* section, under that table, never mixed into it:

* `<h3>What Brandi recorded about these</h3>` — a table grouped by reason:
  *Reason recorded · Windows · Medications · Dates*.
* A second `<h3>Notes Brandi added</h3>` table when any free text exists: *Date · Medication · Note*.
* Lead sentence: *"Recording a reason is optional in the app, so a window with nothing against it
  means nothing was entered — not that a dose was refused. These are Brandi's own words at the time
  and are not a clinical assessment."*

It inherits that section's existing suppression rules, which matter a great deal:

* It only renders when the calculated missed-dose table renders, which itself only renders when
  something was actually **logged** in the period. A report built purely from non-events is still
  never emitted.
* It sits **below the daily log**, so a page of patient-reported explanations can never outrank the
  record of what she actually took. Asserted by `REPORT-carries-reasons` (which checks the ordering,
  not just the presence).
* Superseded, retracted and orphaned reasons never reach it — only the current answer for a
  currently-derived miss.

---

## 5. The CSV — read this out loud

**The CSV is byte-for-byte unchanged, and reasons are NOT in it.**

Reason documents are split out of `state.entries` the moment they arrive in `subscribeEntries`,
exactly the way `chemo_date` already is. `allExportEntries()` is `entries + chemoDates` and this
patch does not touch it, so the exporter cannot see a reason document by any route.
`EXPORT_COLUMNS` is unchanged. The patch script refuses to write if either of those two lines has
moved, and `CSV-byte-identical` proves it empirically: the same fixture is exported twice, once with
seven reason documents present and once without, and the two files must be byte-identical.

**The trade-off, stated loudly:** the CSV is described in the app as *"your backup"*. Reasons are
currently not in that backup. If the device is lost, the doses survive and the reasons do not.

Three ways forward, for Aaron to choose:

1. **Leave it** (what I shipped). The format stays frozen; reasons live only in Firestore, which is
   the actual system of record and is itself backed up nightly by the 3 AM job — that job reads the
   collection over REST, so it *does* capture the raw reason documents.
2. **Add them as their own row type** (`Source` column = `reason`). This changes the CSV's *content*
   but not its column layout. It would break a byte-equality fixture that contains reason
   documents; it would not break one that does not. **This needs a decision from whoever owns the
   byte-equality test, not a unilateral change from me.**
3. **A second file.** Cleanest for the regression test, worst for the person who now has two files.

**Whoever owns the backup/restore patch should read this section.** A restore that replays the CSV
will not restore reasons.

---

## 6. Known limitations (not defects — inherited or accepted)

1. **A missed dose is only tappable on a day that has at least one logged entry.**
   `renderHistory()` groups by the days that have logged documents and derives misses only for those
   days. A day with *nothing* logged never renders a row, in the base app and in the patched one
   alike — its misses appear only as text in the Home banner, which has no rows. So on a completely
   blank day there is nowhere to record a reason. This is base-app behaviour that predates this
   patch; changing which days History renders is a materially bigger change and I did not make it
   inside a reason patch. **Recommend as a follow-up.** (The test fixture works around it by putting
   one temperature on each pinned day, and says so in a comment.)
2. Two windows on the same medication that start at the same hour share one reason (see §2).
3. Changing a window's start hour orphans reasons recorded against the old timing (see §2).
4. The nightly REST backup dumps `caretracker_entries` raw, so reason documents *do* appear there as
   rows with `medId: missed_reason`. That is a raw dump and is correct; the entry-count
   drop-detection heuristic will simply count a few more documents than before.
5. The sheet is not focus-trapped. It has `role="dialog" aria-modal="true"` and a label, and every
   control is keyboard-reachable, but tabbing past the last control leaves the dialog. The base app
   does not focus-trap `renderTimeModal()` either; fixing it here alone would be inconsistent.

---

## 7. Collision safety and patch order

Every identifier is namespaced `MR_*` / `mr*` and every hook `data-mr-*`. All 24 identifiers and 13
hooks are checked against the target file before anything is written; the run aborts if any already
exists. `svgIcon`'s icon table is not touched at all — no new icon key, so no silent duplicate-key
overwrite is possible.

**Anchors were chosen to be disjoint from `calendar-patch.py`'s.** Verified empirically: calendar →
reason and reason → calendar both produce `21dbefeeca109ac183718e0e7c538189`, byte-identical.

The one line both patches care about is the once-a-second repaint guard. Calendar rewrites
`if (!state.timeModal && !isEditing) render();`. I reach the same guarantee through the
`const isEditing = …` line **above** it, so neither anchor disturbs the other:

```js
const isEditing = activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA' || !!state.missReasonSheet;
```

Post-conditions enforced by the script after patching, any of which abort the write:
`APP_VERSION` unchanged and unmoved · `EXPORT_COLUMNS` unchanged · `allExportEntries()` unchanged ·
no `updateDoc(` · no new `deleteDoc(` · no `onInput` handler anywhere in the file calls `setState`
(checked across the whole file, so it also catches a regression elsewhere) · no `disabled:` attribute
anywhere carries a value other than `'disabled'` or `true`.

**`sw.js` is never opened.** Per `CLAUDE.md` the SW cache key must be bumped before this ships —
that is a release step for whoever integrates the patches, not something a feature patch should do
unilaterally, since four patches bumping the same constant would collide.

---

## 8. Verification

```
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node reason-test.mjs
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node reason-test.mjs --falsify --batch 0-7
```

**41/41 checks pass**, on the reason-only build and on the calendar+reason composed build.

Safety: all three gstatic Firebase modules stubbed in memory; a catch-all route aborts every other
off-origin request; the service worker is blocked at the context and the property level and `NET-2`
fails the run if `sw.js` was ever fetched; `NET-1` fails on any unexpected off-site request (Google
Fonts, requested by the base build's own `<link>`, is blocked and tallied separately rather than
reported as a leak). Fixtures only — nothing can reach the real project.

### What I falsified — 18 mutators, every one confirmed RED, plus 1 control confirmed GREEN

| Mutator | Went red |
|---|---|
| `reasons-leak-into-entries` — stop splitting reason docs out of `state.entries` | `FILE-split-at-arrival`, `CSV-byte-identical`, `CSV-no-reason-strings`, `REPORT-*` |
| `reasons-in-daily-log` — add reasons to `allExportEntries()` | `CSV-byte-identical`, `CSV-no-reason-strings`, `REPORT-reasons-not-in-log` |
| `plain-object-report-grouping` — group the report by label in a plain `{}` | `REPORT-carries-reasons` |
| `oldest-answer-wins` — invert `mrSupersedes` | `SUPERSEDE-newest-wins` (+7 more) |
| `removal-not-honoured` — an empty answer reads as a reason | `REMOVE-reads-as-none` |
| `key-ignores-window` — drop the timestamp from the identity | `IDENTITY-one-window-only` |
| `change-uses-delete` — remove with `removeEntryDB` | `APPEND-only-no-deletes` |
| `setState-in-onInput` — setState from the note field | `FILE-no-setState-in-onInput`, `TYPE-note-survives` |
| `tick-repaints-under-sheet` — drop the sheet from the clock-tick guard | `TICK-sheet-survives` |
| `toast-repaints-under-sheet` — let a clearing toast repaint under the sheet | `TICK-sheet-survives` |
| `h-null-attribute-trap` — `disabled: s.busy ? 'disabled' : null` | `TRAP-no-null-attributes` |
| `note-field-14px` | `FONT-16px-note` |
| `chip-tap-target-32px` | `TAP-44px-targets` |
| `row-logs-again-without-guard` | `ROW-button-does-not-log` |
| `row-logs-again-guard-kept` | **control — stayed green, as required** |
| `reason-absent-from-report` | `REPORT-carries-reasons` |
| `app-version-bumped` | `FILE-app-version` |
| `auto-opens-the-sheet` — open the sheet unprompted | `OPTIONAL-nothing-auto-opens` |
| `judgmental-wording` — restore "Forgot / careless" | `COPY-no-judgment` |

### One falsification I attempted and could not produce — stated because it matters

I wrote a mutator that swapped `mrResolveReasons`' `Map` for a plain object, expecting a medication
whose id is `constructor` to break. **It stayed green, and it was right to.** The lookup key is
composite (`'constructor|1786586400000'`), and that string is not a name on `Object.prototype`, so
the hazard is not reachable through that path. I did not keep a mutator that proves nothing.

The `Map` stays, for two reasons: it is the correct structure regardless, and the key format is not
guaranteed to stay composite forever.

I then found a place where the hazard **is** reachable and covered it instead: the report groups by
reason *label*, and the label is a wire value (`reasonLabel`, snapshotted from an older build). A
document carrying `reasonLabel: 'constructor'` against a plain-object grouping reads back as
`Object` itself and takes the entire report down. The fixture now contains exactly that document,
`PROTO-labels-survive` and `REPORT-carries-reasons` cover it, and
`plain-object-report-grouping` proves both go red without the `Map`.

### One flake, disclosed

One run out of eight (the first run against the composed calendar+reason build) reported 40/41. I
filtered the output and lost the failing check id, and could not reproduce it in seven consecutive
runs afterwards (5× reason-only, 3× composed, all 41/41). The most likely cause is the 20-second
download deadline in `saveCSV`/`saveReport` on a cold first browser launch. I am reporting it rather
than quietly re-running until it was green.

### Also verified by hand

* `python3 reason-patch.py --repo work` twice → second run detects the sentinel and changes nothing.
* Anchor mismatch → aborts with a non-zero exit and writes nothing (proved by pointing it at an
  already-mutated file).
* The extracted `<script type="module">` body passes `node --check`.
* `md5sum sw.js` identical before and after.
* Screenshots at 375×812: `shot-history-rows.png` (rows with and without a reason),
  `shot-reason-sheet.png` (the sheet), `shot-reason-chosen.png` (a chip selected, sticky Save row).

---

## 9. One design change I made after looking at it on a phone

Nine chips plus a note field are taller than a 375×812 screen, so `Save` sat below the fold and the
patient had to scroll past the entire list to find the primary action. The action row is now
**sticky inside the scrolling panel** — visible from the first frame, with an opaque background so
the list scrolls cleanly underneath it. `SHEET-fits-viewport` asserts the panel never overflows the
screen and scrolls when its content is taller than its box.
