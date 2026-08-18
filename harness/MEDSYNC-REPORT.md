# Shared medication settings — design, wording, and what was falsified

**Base:** care-tracker v45, `29b26b2`.
`index.html` `a036d6983ea7c30480fd758e35fd4ed3` → `0fbdd3af9260d80964a27eb24bdb5d07`.
`sw.js` `421b74cb9eacebd581a18d0777284aac` → **unchanged**. `APP_VERSION` still `'v45'`.
Both are set at ship time; `medsync-patch.py` never opens `sw.js` and refuses to write if `APP_VERSION` moved.

---

## 1. The defect

Medication *configuration* — `state.meds` and `state.archivedMeds` — lived only in
`localStorage['caretracker-medication-config-v1']`, per device. Dose entries synced through
Firestore; the configuration that **interprets** those entries did not. In `status()`:

```js
const at = last.ts + med.gapH * 3600000;
return { locked: now < at, availableAt: at };
```

`med.gapH` comes from that phone's own copy. One dose, one timestamp, two phones, two answers —
**Waiting** on one, **Available** on the other. There is a second path in the same function:

```js
if (med.rollingCeilingH) return { locked: false };
```

which returns before the gap is ever considered, so a phone whose copy carries `rollingCeilingH`
for a medication always says Available. The danger is a **double dose**: her phone invites a dose
his phone knows was already taken.

`archivedMeds` was equally unsynced, which is why the deactivated medications differ too.

The suite reproduces both paths on fixture data **before** it proves the fix — see
`BUG-A-says-waiting`, `BUG-B-says-available`, `BUG-B-rolling-unlocked`.

---

## 2. Where the shared list lives

**In the existing `caretracker_prefs/settings` document**, written with the exact
`setDoc(PREFS_DOC, payload, { merge: true })` the app already uses for `missedClearedAt`.

Three fields:

| field | what it is | who writes it |
|---|---|---|
| `medConfigJson` | the shared, **active** medication list | **only** the confirm button, and any later edit once sharing is on |
| `medConfigDevices.<deviceId>` | that phone's own list **as it was before sharing** | that phone only, and only until a choice exists |
| `medConfigSetAt` / `medConfigSetBy` | when, and from which phone | alongside `medConfigJson` |

**No new collection.** The published Firestore rules match named collections; a new one would fail
silently on the live app while passing in every harness. That exact mistake has been made on this
project before, so the patch has a post-condition that compares the *set* of `collection(db, …)`
and `doc(db, …)` targets before and after and refuses to write if it grew, and the suite has the
same check (`FILE-no-new-collection`) plus a mutator that introduces one.

`caretracker_entries` is append-only and holds no configuration. Nothing added here touches it —
proven statically (`FILE-nothing-added-to-entries`) and at runtime (`CHOOSE-writes-only-prefs`,
which audits every stub write during the whole choice).

### Why a JSON string and not a nested object

This is the single most important storage decision in the patch.

1. **Firestore's `merge: true` deep-merges maps.** Stored as an object, `medConfigJson.archivedMeds`
   would be merged key by key — so a medication *removed* from the archived map on one phone would
   silently never be removed on the other. That is the same class of bug this patch exists to end.
   A string is a scalar and is replaced whole.
2. `JSON.stringify` drops `undefined`. The medication editor can legitimately produce
   `ceilingUnit: undefined` (`ceiling` is true, the unit is mg), and Firestore **throws** on an
   undefined field value. As an object this would have failed on the live app the first time
   anybody set a milligram limit.
3. It side-steps Firestore's nested-array rules entirely.

The stub in `medsync-test.mjs` implements the recursive map merge faithfully, so this is tested
rather than assumed (`MERGE-semantics`, and the `candidate-stored-as-object` mutator).

Keys are stably sorted before stringifying (`medsyncStableStringify`), because a list typed in the
editor and the same list round-tripped through Firestore do not otherwise produce the same string,
and every equality comparison in the module depends on that.

---

## 3. Nothing is auto-merged, and no winner is picked silently

`medConfigJson` is written by exactly **one** code path a person can reach: the confirm button.
Enforced three ways —

* the patch refuses unless `medsyncCommitChoice` has exactly one call site;
* the suite asserts the same (`FILE-one-choice-writer`) and asserts the prefs handler never writes
  the shared field (`FILE-no-auto-merge`);
* `BOOT-no-shared-field` proves at runtime that booting a phone never sets it, and the
  `auto-merge-newest-wins` mutator — newest candidate wins, nobody chooses — must turn it red.

Until Aaron presses that button, **every phone keeps running on its own list, unchanged.**

---

## 4. Nothing is destroyed

Two independent, recoverable copies exist before anything is adopted, plus a third route in the UI.

1. **On each phone:** `localStorage['caretracker-medication-config-prechoice-v1']`, written by
   `medsyncBackupLocalOnce()` as the *first statement* of `medsyncAdopt()`, and **never overwritten**
   once present. The patch refuses if that ordering or that guard is missing.
2. **In Firestore:** `medConfigDevices.<deviceId>`. Refreshed freely while there is no shared list;
   **frozen the instant one exists** and never rewritten. A phone that first opens the app *after*
   the choice was made still gets its own pre-adoption list recorded there, exactly once, so it is
   recoverable too.
3. **In the UI:** after sharing is on, the chooser still lists every phone's original, labelled
   "Saved before sharing", each with a live button. Recovery is a tap, not a support call.

Checks: `CHOOSE-freezes-candidates`, `CHOOSE-backs-up-locally`, `RECOVER-firestore`,
`RECOVER-local`, `RECOVER-is-one-tap`. Mutators: `backup-overwritten`, `no-backup-before-adopt`,
`candidate-overwritten-after-choice`.

---

## 5. Offline never blocks anything

* Nothing in the module is awaited on a render path (`FILE-no-render-path-blocks`).
* `state.medsync.devices` is `null` until a prefs snapshot arrives. While it is null the sharing
  notice does not render at all — an offline phone is not nagged about something it cannot act on —
  and the phone runs on its own local list exactly as it does today.
* Every write is fire-and-forget with its own `catch`; failure is a toast, never a block.
* If the choice cannot be saved, **nothing local is touched**: the write is awaited first and the
  list is only adopted after it succeeds. A failed choice leaves both phones exactly as they were.

Checks: `OFFLINE-falls-back-to-local`, `OFFLINE-no-notice`, `OFFLINE-dosing-not-blocked` (a real
dose is logged through the time modal with every write rejecting),
`OFFLINE-failed-choice-changes-nothing`. Mutators: `offline-blocks-on-prefs`, `offline-nags`,
`failed-write-still-adopts`.

A corrupt or truncated shared document can never wipe a phone: `medsyncParseConfig()` returns null
for an empty medication list, which leaves that phone on its own list — the safe outcome
(`FILE-empty-config-refused`, mutator `empty-shared-config-accepted`).

---

## 6. They cannot diverge again

`persistMedicationConfig()` is the single choke point every medication edit in this app already
goes through — the editor, reordering Home cards, removing a medication, and the archived-name
merge that restore performs. One line was added to the end of it:

```js
medsyncPublishLocalChange(meds, archivedMeds);
```

Once a shared list exists, that publishes the whole list to `medConfigJson`; the other phone picks
it up through the `onSnapshot` listener it already has. Before a shared list exists, it refreshes
that phone's candidate instead.

The early `return` that used to sit inside the `try` block was moved into the condition, on
purpose: a phone with unusable localStorage must still publish its change, and returning early
skipped that silently.

Checks: `EDIT-propagates` (a real removal through the UI, asserting both `meds` and `archivedMeds`
in the published string), `EDIT-lands-on-other-phone`, `EDIT-no-second-choice` (adopting an edit
must not republish it — that is a write loop between the two phones).

---

## 7. The exact wording Aaron will see

### On the Medications screen, before a choice — only this phone has checked in

> **Medication settings are not shared between phones**
> Each phone is keeping its own medication list, so the two can disagree about when a dose is due.
> Only this phone has checked in so far — open CareTracker on the other phone once, then come back
> here.

**No button at all.** Not a disabled one. `h()` calls `setAttribute` for anything it does not
special-case, so `disabled: null` renders `disabled="null"` and the control is dead for good; four
Blockers have shipped from that on this app, and a confirm dialog with a disabled-until-chosen
button is exactly where it bites. There is no `disabled` attribute anywhere in the new module, and
`CONFIRM-no-dead-controls` dumps every attribute in the chooser subtree and fails on any value of
`"null"` or `"undefined"`.

### On the Medications screen, before a choice — both phones seen, lists differ

> **Medication settings are not shared between phones**
> Each phone is keeping its own medication list, and they do not match. That is why the same dose
> can say "Waiting" on one phone and "Available" on the other. **9 differences found.**
>
> **[ See what is different ]**

(If the two lists happen to match: "They match right now, but they are separate copies and can
drift apart again." Button reads **Set the shared list**.)

### The chooser

> **Which phone has the right medication list?**
>
> Pick the phone whose medication list is correct. That list is copied to every phone and is the
> one CareTracker uses from now on.
> Nothing you have already logged changes — doses, weights, temperatures and appointments all stay
> exactly as they are.
> The list you do not pick is kept. It is saved on its own phone and in your CareTracker records,
> and you can switch back to it from this screen.
>
> ---
> **WHAT IS DIFFERENT BETWEEN THEM**
> This phone compared with Android phone
>
> **On this phone only:** Beta Test Med, Zeta Test Med, Eta Test Med
> **On Android phone only:** Gamma Test Med, Epsilon Test Med
> **Deactivated on this phone only:** Epsilon Test Med
> **Deactivated on Android phone only:** Zeta Test Med
>
> **Alpha Test Med**
> **Smallest gap between doses:** this phone says 6 hours, Android phone says 4 hours
> *This one changes when a dose is allowed.*
>
> **Delta Test Med**
> **Rolling limit window:** this phone says none, Android phone says 4 hours
> *This one changes when a dose is allowed.*
>
> ---
> **This phone — iPhone**
> 18 medications · 1 deactivated · this phone
> **Medications:** *(every name)*
> **Deactivated:** *(every name)*
>
> **[ Use this phone's list on both phones ]**
>
> ---
> **Other phone — Android phone**
> 17 medications · 1 deactivated · last seen 4 minutes ago
> **Medications:** *(every name)*
> **Deactivated:** *(every name)*
>
> **[ Use Android phone's list on both phones ]**

The medication names above are the harness's invented fixtures. **No medication name is hardcoded
anywhere in the module** — every name, count and setting is read from the data.
`FILE-no-hardcoded-med-names` reads the real `DEFAULT_MEDS` names out of the base build and fails
if any of them appears as a literal in the new code.

Every setting that differs is named in plain words, not as a field name — "Smallest gap between
doses", "How it is scheduled", "Dose options", "Times of day", "Limit amount", "Has its own card
on Home". The three that change dose timing (`type`, `gapH`, `rollingCeilingH`) plus `doses` and
`windows` are sorted to the top and carry the line *"This one changes when a dose is allowed."*
Any field the table does not know about is still reported, as `Setting "<key>"`, so nothing can
hide. Aaron does no manual matching — the app tells him what is out of step.

### The confirm step

> **Use this phone's list on both phones?**
>
> CareTracker will use this phone's **18 medications** on every phone, starting now.
>
> **Other phone's list of 17 medications will be replaced.** It is kept — saved on that phone and
> in your CareTracker records — and you can switch back to it from this screen.
>
> Nothing you have already logged changes. Doses, weights, temperatures and appointments all stay
> exactly as they are. You only need to do this once — after this, a change made on either phone
> shows up on both.
>
> **[ Yes, use this phone's list ]**
> **[ Not yet ]**

Both buttons are always live. While the write is in flight the panel adds a plain **Saving…** line;
re-entry is blocked by a flag, not by disabling a control.

### After the choice

> **Medication settings are shared**
> Every phone uses the same medication list. A change made on one phone shows up on the other.
> Set from iPhone on 18 Aug 2026, 3:04 PM.
>
> **[ Change which list is used ]**

Reopening the chooser then shows an **In use on every phone now** panel, followed by each phone's
original list, each badged **Saved before sharing** and each with a live button. That is the
recovery path, and `RECOVER-is-one-tap` exercises it end to end.

### The version, in the menu footer

> CareTracker v45

A centred grey line under the "Take a quick tour" row. Derived from `APP_VERSION`, never written as
a literal — the patch fails if any `'vNN'` literal it did not find in the input appears in the
output, and `VERSION-in-menu` compares what the menu shows against what the file says, whatever the
file says.

---

## 8. First run for a phone that has never seen a shared config

| what that phone finds | what happens |
|---|---|
| **No shared list, no other phone yet** | Runs on its own local list, unchanged. Publishes its list once as `medConfigDevices.<id>` (`frozen: false`). Medications screen shows the notice with **no button**. |
| **No shared list, another phone has checked in** | Runs on its own list, unchanged. Refreshes its own candidate whenever its list changes. The notice appears with the difference count and the chooser button. |
| **A shared list already exists** | Snapshots its own list to `…-prechoice-v1` (once), records that pre-adoption list to `medConfigDevices.<id>` with `frozen: true` **exactly once**, then adopts the shared list and caches it locally. No confirmation is asked for — the source of truth has already been chosen. Its original is still recoverable from both places and still choosable in the chooser. |
| **Offline, whatever the state** | Runs on its own local list. No notice, no writes, nothing blocked. Picks everything up on the next connection. |
| **A brand-new install** (no saved config at all) | `loadMedicationConfig()` gives it the defaults; those are what get snapshotted and, if a shared list exists, immediately replaced by it. |

`mergeMissingDefaultMeds()` still runs on adoption, deliberately: it is the only way a medication
added to `DEFAULT_MEDS` in a later release reaches a phone that already has a saved list. Both
phones run the same merge over the same shared string, so they still land on the same list.
`medsyncAppliedJson` holds the **shared** string, not the merged result, so the difference cannot
start an adopt loop.

A third device (a laptop, a spare phone) simply appears as a third panel in the chooser. Nothing
assumes there are exactly two.

If `localStorage` is unreadable (private mode), the device id is per-session, so that phone
re-publishes a candidate each session. It still never overwrites another phone's entry and never
touches a frozen one.

---

## 9. Concurrency — stated plainly, not hidden

Once sharing is on, two edits made within the same second write the whole list and the later one
wins. The snapshot listener keeps both phones current within a second or two, so the only real
window is an edit made while a phone is offline. Merge-conflict UI for that is a second, larger
feature and is not what is hurting anyone today. It is a **convergence** guarantee, not a
last-writer-detection one, and it is a strict improvement on two phones that never converged at all.

---

## 10. Deliberate non-changes

* **The composed one-second tick guard is untouched.** It is
  `if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing)` and
  four earlier patches each own a term of it; `tour-test.mjs` pins it verbatim. The chooser is a
  **screen**, not an overlay, precisely so it needs no sixth term. It repaints on the tick exactly
  like Home and Meds do. Both the patch and the suite fail if that line moves.
* **`CAL_DRAWER_ITEMS` is still the original six rows.** The version label is a text line appended
  to the existing footer, not a seventh navigation row.
* **`medIsOnActiveList` and the three Home counter-card gates** (`tylenol`, `imodium`, `lidocaine`)
  are byte-for-byte unchanged, checked by both the patch and the suite.
* **`logMed()` and `confirmTimeAndLog()` are byte-identical to v45.** A configuration patch does
  not get to touch the dosing write path.
* **Reminders.** Aaron accepted the trade-off explicitly ("not worried about alerts for her, we
  monitor outside the app until this is stable"), so the correctness fix ships and the reminder
  behaviour of a synced `alerts` flag is not held back over it.

### One pre-existing defect found and NOT fixed here

`confirmTimeAndLog()` does `await addEntryDB(entry)` with **no `catch`**. A refused dose write —
offline, rules error, anything — is an unhandled promise rejection, and the patient is told
nothing at all: no toast, no red, the modal simply closes as though the dose was recorded.
Reproduced side by side on the unpatched v45 and on the patched build; identical on both. It is
the same shape as the export buttons that reported success with no file. It deserves its own small
release. `FILE-dose-write-path-untouched` proves this patch neither introduced nor moved it, and
`OFFLINE-no-errors` filters exactly that one rejection by name rather than pretending it is absent.

---

## 11. Safety of the harness itself

* All **three** gstatic Firebase modules stubbed; one catch-all route aborts every request that is
  not loopback or one of the three stubs. `NET-1` fails the run if anything was ever *allowed* out.
* The service worker is deleted from the page before any script runs; `NET-2` fails if `sw.js` was
  requested.
* Fixtures only. The medications are invented (`zz-` ids, "Alpha Test Med"); none of this patient's
  data is anywhere near the harness.
* Every DOM read is scoped to rendered elements inside `#root`. **Nothing reads
  `document.body.textContent`** — on this single-file app that includes the inline `<script>`
  source, which is how a suite on this project once passed every check on a broken build.
* Mobile only: 375x812 and 390x844. Chooser buttons are **measured**, not eyeballed.

---

## 12. Test results

On the patched build (`0fbdd3af9260d80964a27eb24bdb5d07`):

| suite | result | notes |
|---|---|---|
| `medsync-test.mjs` | **99/99** | 375x812 and 390x844 |
| `medsync-test.mjs --falsify` | **27/27 guards falsifiable** | baseline green first, then each mutation in turn |
| `cal-test.mjs` | **69/70** | the one failure is the stale `v43.3` version pin, unchanged from v45 |
| `export-test.mjs` | **49/49** | |
| `reason-test.mjs` | **38/41** | identical failing set on the unpatched v45: the stale pin plus the two checks that cannot reach the export buttons from that screen |
| `tour-test.mjs` | **68/68** | |

The `reason-test.mjs` failures were confirmed by running the same suite against
`work/base-index.html`: same three, same reasons. Nothing was weakened to make a number look better.

---

## 13. Falsifications

Every guard was broken in turn and the named check confirmed RED, then restored. Run with:

```
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node medsync-test.mjs --file work/repo/index.html --base work/base-index.html --falsify
```

| # | mutation | what it breaks | check that went RED |
|---|---|---|---|
| 1 | `auto-merge-newest-wins` | THE FORBIDDEN SHORTCUT: adopt whichever candidate is newest, with nobody choosing. On a chemotherapy app that silently overwrites the correct list with the damaged one. | `BOOT-no-shared-field` |
| 2 | `candidate-stored-as-object` | stores the list as a nested map instead of a string, so Firestore DEEP-MERGES it and a removed medication is never removed on the other phone | `BOOT-publishes-candidate` |
| 3 | `archived-not-synced` | syncs only the active list and drops archivedMeds — Aaron reported the deactivated medications differ between the phones too | `ARCHIVED-syncs` |
| 4 | `candidate-overwritten-after-choice` | unfreezes the device snapshots — each phone's candidate is refreshed to the list it just adopted, so the list that was not chosen is destroyed and can never be recovered | `RECOVER-firestore` |
| 5 | `backup-overwritten` | lets the pre-share snapshot be rewritten, so the second adoption destroys the original | `FILE-snapshot-before-adopt`, `RECOVER-is-one-tap` |
| 6 | `no-backup-before-adopt` | adopts a shared list without snapshotting what this phone had first | `FILE-snapshot-before-adopt`, `CHOOSE-backs-up-locally` |
| 7 | `edit-not-published` | a later edit stays on the phone that made it — the two lists start drifting apart again from day two | `EDIT-propagates`, `EDIT-lands-on-other-phone` |
| 8 | `confirm-button-disabled-until-chosen` | THE h() TRAP, in exactly the place the brief warns about: a confirm button carrying a nullish `disabled`. h() calls setAttribute, so disabled="null" is disabled forever. | `CONFIRM-no-dead-controls`, `FILE-no-disabled-attr` |
| 9 | `dead-button-when-alone` | renders the chooser button with nothing to choose instead of omitting it | `CARD-alone-has-no-button` |
| 10 | `diff-hides-settings` | shows only which medications differ and not WHICH SETTINGS — Aaron said he does not want to do manual matching | `DIFF-names-settings` |
| 11 | `diff-hides-archived` | leaves deactivated medications out of the difference report | `DIFF-archived` |
| 12 | `confirm-omits-what-is-replaced` | drops the sentence naming the list that will be replaced and the fact that it is kept | `CONFIRM-wording` |
| 13 | `panels-hide-the-names` | shows a count and a button but not the medication names, so there is no way to tell which list is which | `PANELS-enough-to-choose-by` |
| 14 | `offline-blocks-on-prefs` | makes the medication list wait for the shared document, so an offline phone shows nothing to dose from | `OFFLINE-falls-back-to-local` |
| 15 | `offline-nags` | shows the sharing notice on a phone that cannot reach the shared document | `OFFLINE-no-notice` |
| 16 | `failed-write-still-adopts` | applies the choice locally even when saving it failed, so one phone silently moves and the other does not | `OFFLINE-failed-choice-changes-nothing` |
| 17 | `adoption-publishes-back` | republishes every adopted list, which is a write loop between the two phones | `EDIT-no-second-choice` |
| 18 | `editor-clobbered` | applies an incoming shared list straight through the open medication editor, destroying what is being typed | `EDITOR-not-clobbered` |
| 19 | `config-written-to-entries` | puts the configuration into the APPEND-ONLY entries collection | `FILE-nothing-added-to-entries`, `CHOOSE-writes-only-prefs` |
| 20 | `new-collection` | THE MISTAKE ALREADY MADE ON THIS PROJECT: a new collection, which the published rules do not match, so it fails silently on the live app and passes in every harness | `FILE-no-new-collection` |
| 21 | `plain-object-id-map` | lesson from restore: a plain {} keyed by medication ids answers truthy for "constructor" even when EMPTY | `FILE-null-prototype-maps` |
| 22 | `empty-shared-config-accepted` | lets a truncated shared document wipe a phone's medication list | `FILE-empty-config-refused` |
| 23 | `app-version-bumped` | touches APP_VERSION, which this patch must never do (version-agnostic mutator: it reads whatever the file says and changes it) | `FILE-app-version` |
| 24 | `version-label-hardcoded` | writes the build number into the UI as a literal, so the menu lies the next time the version changes | `FILE-version-label-derived`, `VERSION-in-menu` |
| 25 | `tick-guard-touched` | edits the composed one-second tick guard, which belongs to four earlier patches | `FILE-tick-guard-untouched` |
| 26 | `hardcoded-med-name` | hardcodes a real medication name into the shared-settings module | `FILE-no-hardcoded-med-names` |
| 27 | `tap-targets-shrunk` | drops the chooser buttons below the 44px floor — MEASURED at both phone widths, not eyeballed | `TAP-chooser-buttons-44` |

**27/27 guards proved falsifiable.** Every one was broken, confirmed RED, and restored.

---

## 14. How to run

```bash
git clone https://github.com/Arnjnnngs/care-tracker.git repo
mkdir -p work && cp -r repo work/repo && cp repo/index.html work/base-index.html && cp repo/sw.js work/base-sw.js

python3 medsync-patch.py --file work/repo/index.html --check   # dry run
python3 medsync-patch.py --file work/repo/index.html           # apply (idempotent)

env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
  node medsync-test.mjs --file work/repo/index.html --base work/base-index.html
```

`medsync-patch.py` and `medsync_js_block.txt` ship together; the patch refuses if the block is
missing. Re-running the patch prints "already applied" and writes nothing.

At ship time, and only then: bump `APP_VERSION` in `index.html` and `CACHE` in `sw.js`. Both are
outside this patch by design, and both the patch and the suite fail if this patch moved either.
