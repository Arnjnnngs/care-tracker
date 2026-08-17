# CAL-REPORT — Calendar + Appointments, ported from ChemoWell to care-tracker

**Date:** 17 Aug 2026 · **Target:** care-tracker v43.3 (`87e89bb`) · **Version untouched:** `APP_VERSION` is still `v43.3`, `sw.js` was never opened.

| | |
|---|---|
| Base `index.html` md5 | `8136b7764f07865171c180212a4d5b09` (verified before every run) |
| Patched `index.html` md5 | `5037f95ccdcb023406219fc7e7ed68e0` (+35,987 bytes, 9 anchored edits) |
| Verification | **70 / 70 checks pass**, at 375x812 **and** 390x844 |
| Falsification | **14 / 14 guards proved falsifiable** — each one broken in turn, confirmed RED, restored |
| Firestore writes during testing | **zero** — all three gstatic Firebase modules stubbed, service worker removed, fixtures only |

Deliverables in `/home/claude/rebuild/cal/`:
`calendar-patch.py`, `cal-test.mjs`, `CAL-REPORT.md`, plus `work/index.html` (the patched build the numbers above refer to) and three screenshots.

---

## 1. Read this first — the shared checkout is not the base any more

`/home/claude/wm/index.html` is **modified in the working tree** and its md5 is `8df3dd80cbab24d76ce6d70acab87eaf`, not the v43.3 base. The diff versus `87e89bb` is 2 insertions / 35 deletions and it is the **"Dead code removal — `seedDemo()` and the demo banner"** item from the task sheet: `seedDemo()` deleted, the demo banner removed from `renderToday`, `demo: false` dropped from `state`, `state.demo` removed from `checkNotifications`.

I did not write it and my patch has **not** been applied to that tree. Two deliberate decisions:

* **I did not revert it.** It is uncommitted work belonging to somebody else and `git checkout --` would destroy it. No `git reset --hard` was run at any point.
* I built and tested against a pristine copy extracted straight from history without touching the working tree: `git -C /home/claude/wm show 87e89bb:index.html`. That copy hashes to `8136b77…` exactly.

**Consequence for the merge, already handled:** one anchor had to be re-derived. Edit 8 originally keyed off `const wasEmpty = state.entries.length === 0 && !state.loaded;` — but `wasEmpty` exists only to feed the dead `seedDemo()` call, so the dead-code patch deletes it, and my patch aborted. It now anchors on `if (state.timeModal) {` plus its own following comment line. **`calendar-patch.py --check` now passes all 9 anchors against both trees**, so the calendar and the dead-code removal can land in either order.

---

## 2. What was built

Menu → **Calendar**: a month grid, a day panel underneath it, and add / edit / remove for appointments. Reached from a new 44px menu button in the header; the five bottom-nav tabs are untouched.

The nine anchored edits, in file order:

| # | Location | What changes |
|---|---|---|
| 1 | `subscribeEntries` | splits `medId:'appointment'` out of `state.entries` into `state.appointments`, following the existing `chemo_date` → `state.chemoDates` line directly above it |
| 2 | `state` literal | `appointments`, `drawerOpen`, `calCursor`, `calSelected`, `apptSheet`, `apptConfirmDelete` |
| 3 | icon table | three keys: `calMenu`, `calMonth`, `calClose` |
| 4 | `renderHeader` | the 44x44 menu button |
| 5 | `renderContent` | `state.view === 'calendar'` → `renderCalendarView(now)` |
| 6 | `render()` | mounts `renderCalDrawer()` and `renderApptSheet()` |
| 7 | clock tick | no repaint under an open drawer or sheet |
| 8 | `subscribeEntries` callback | a live snapshot is deferred while the sheet is open |
| 9 | above the export block | the feature block itself (~36 KB) |

Edit 9 is placed **above** the export block on purpose: that block documents itself as strictly read-only with no path to `addEntryDB`, and dropping a feature that writes into the middle of it would break that argument even though the code is unrelated.

### Two decisions that differ from ChemoWell, both forced

**Storage.** ChemoWell keeps appointments in profile-scoped `localStorage`. care-tracker must never touch a ChemoWell key or collection, so an appointment here is an ordinary document in `caretracker_entries` with `medId:'appointment'`. A file-level check (`FILE-no-chemowell-storage`) fails the build if the calendar block references `localStorage`, `APPTS_KEY`, `loadAppointments` or anything else ChemoWell-shaped.

**Edit and delete are both an INSERT.** The Firestore rules are append-only: existing documents cannot be edited, and deletes are refused after 48 hours. A literal `updateDoc`/`deleteDoc` would have worked all the way through testing and then started failing on Brandi's phone the moment an appointment was more than two days old — silently, from her point of view. Instead every appointment carries a stable `apptId`; editing appends a new document with the same `apptId` and a newer `loggedAt`, removing appends one with `cancelled:true`. Newest document wins. Nothing is ever mutated or deleted, and a rescheduled appointment's history stays readable in the raw collection. Check `APPEND-only-no-deletes` asserts `deleteDoc` is called **zero** times.

### Deliberately not ported

* **Appointment colours.** ChemoWell lets you pick a colour per appointment. Skipped: more UI surface for no clinical value, and the single-accent dot reads fine at 11x3px.
* **Appointment reminders.** ChemoWell has six reminder options. care-tracker's reminder path is a GitHub Action (`send-reminders.js`) with hardcoded medication logic; wiring appointments into it is a separate piece of work and half-wiring it would have shipped a reminder setting that never fires. There is no reminder control in the UI, so nothing promises one.
* **`gear` and `help` icons.** The known-good design listed five icons. `gear` and `help` belong to Settings and Help & FAQ, neither of which exists in care-tracker yet — adding them would have been placeholders. `help` is also what the tour patch adds; see §4.

---

## 3. The four defects from the previous run — all fixed, all measured

### 3.1 Day cells measured 43.6px (floor is 44px)

Reproduced arithmetically before writing any code, which pinned the cause exactly. `<main>` has 16px padding each side; the first draft put 10px padding on the grid section and a 3px gap between columns:

```
(375 − 32 − 20 − 18) / 7 = 43.57px
```

That is the number the previous run measured. The fix is structural, not a nudge: the grid carries **no horizontal padding at all** and a 2px gap, with the month-nav row keeping its own padding.

```
(375 − 32 − 12) / 7 = 47.3px
```

**Measured, not eyeballed** — all 31 cells measured every run, minimum reported:

| Viewport | narrowest cell | height |
|---|---|---|
| 375 x 812 | **47.00px** | 56.00px |
| 390 x 844 | **49.14px** | 56.00px |

The brief notes the old harness hid this by measuring at the wrong width. Three things prevent a repeat: both viewports run every time; `boundingBox()` is read from **every** cell rather than a sample; and the mutator `day-cells-43.6px` restores the original padding/gap and the check goes RED (see §5).

### 3.2 The Note field was 14px

Every field in the appointment sheet goes through one shared styler, `calFieldStyle()`, which declares `fontSize: '16px'`. The check reads `getComputedStyle().fontSize` off the **live elements** rather than grepping the source, so an override anywhere in the cascade is caught. Measured `title=16px, when=16px, note=16px` at both viewports.

Worth Aaron knowing, though it is **not mine to fix in this patch**: the *existing* symptom-logger note field in `renderTimeModal` is still `fontSize: '14px'` (`index.html`, the `m.type === 'symptom'` textarea). It has the same iOS zoom-in-and-never-back behaviour. It is out of scope here — it is not on any of my anchors and touching it would collide with whatever patch owns that area — but it should be picked up.

### 3.3 `data-cal-ui="calendar"` on three sections

Every test hook is now unique and descriptive. There are **34** of them, all `data-cal-*`, and the patch refuses to run if the base already contains any of them (the base contains **zero** `data-*` attributes of any kind — checked). Two independent checks:

* `FILE-hooks-unique` — each static hook appears **exactly once** in the source.
* `HOOK-unique-sections` — at runtime, `[data-cal-view-header]`, `[data-cal-month-section]`, `[data-cal-month-grid]`, `[data-cal-day-panel]` each match **exactly one** element.

The mutator `duplicate-test-hook` puts the same hook on all three sections; both checks go RED, plus four more.

### 3.4 The duplicated `help:` icon key

A duplicate object key is legal JavaScript — last one wins, no error, no warning — which is why this was invisible. Prevention is now mechanical rather than remembered: `calendar-patch.py` holds an explicit list of **43 identifiers and 34 data-hooks** it introduces, greps the base for every one of them, and **aborts before writing anything** if any already exists. Icon keys are checked with their colon (`calMenu:`) the way they appear in the table.

The three icons are namespaced `calMenu` / `calMonth` / `calClose` rather than the obvious `menu` / `calendar` / `close`, precisely because the obvious names are what a second patch also reaches for.

---

## 4. Notes for the patches landing after this one

* **Icon keys.** `calMenu`, `calMonth`, `calClose` are taken. `menu`, `calendar`, `close`, `gear`, `help` are all still free — I did not touch them.
* **The tour can use my drawer.** `state.drawerOpen`, `calOpenDrawer()`, `calCloseDrawer()` and the `CAL_DRAWER_ITEMS` array are the extension points. Adding a "Replay tour" entry is one array element. `calDrawerGo(view)` handles closing + navigation.
* **Backup / restore must add appointments deliberately.** `allExportEntries()` is `entries.concat(chemoDates)` and I did **not** change it — that is what keeps appointments out of the CSV and the report. But it is also what the backup uses, so **appointments will not be in a backup unless restore adds them explicitly**, and they must be added on a path that does not feed the CSV or the report. The task sheet lists "Appointments now survive a restore" as backup's job; this is the hook it needs.
* **Restore must preserve `apptId` and `loggedAt` exactly.** Identity and supersede-ordering both depend on them. Restoring a superseded pair with rewritten `loggedAt` values could resurrect a cancelled appointment.
* **Anchors.** Mine are tight and all nine survive the dead-code-removal patch. My new identifiers are all `cal*` / `appt*` prefixed.

---

## 5. Falsification — 14 guards, all broken, all confirmed RED

`node cal-test.mjs --falsify` mutates the served HTML in memory, re-runs the whole suite, and asserts the named check fails. The baseline is re-verified green first, so a falsification result cannot come from an already-broken build. Nothing is left mutated — the mutation never touches disk.

| # | Mutation | Check that went RED |
|---|---|---|
| 1 | restore the 10px padding / 3px gap → 43.57px cells | `TAP-day-cells` (+ `LAYOUT-wide-font-stress`, `NAV-month-paging`) |
| 2 | note field to 14px | `FONT-16px-inputs`, `FILE-16px-inputs-in-source` |
| 3 | same hook on all three sections | `HOOK-unique-sections`, `FILE-hooks-unique` (+4) |
| 4 | `Map` → plain `{}` for `apptId` grouping | `PROTO-ids-survive` (+3) |
| 5 | append appointments to `allExportEntries()` | `FILE-allExportEntries`, `EXPORT-csv-clean`, `EXPORT-report-clean` |
| 6 | `disabled: busy ? 'disabled' : null` | `TRAP-no-null-attributes`, `FILE-no-null-attr-literals` |
| 7 | drop the sheet from the clock-tick guard | `TICK-sheet-survives` |
| 8 | drop the drawer from the clock-tick guard | `TICK-drawer-survives` |
| 9 | drop the sheet from the snapshot deferral | `SYNC-sheet-survives` |
| 10 | make an edit mint a new `apptId` | `EDIT-supersedes` |
| 11 | `setState` inside `onInput` | `TYPE-note-survives`, `FILE-no-setState-in-onInput` |
| 12 | bump `APP_VERSION` | `FILE-app-version` |
| 13 | remove the title-required validation | `VALIDATE-title-required` (+4) |
| 14 | remove with `deleteDoc` instead of a tombstone | `APPEND-only-no-deletes` |

**14 / 14.** Falsification runs at 375x812 only, so a fourteen-mutator sweep finishes in one sitting; verification always runs both viewports.

### Falsification caught four defects in my own harness — this is the part that matters

Every one of these was a check that was **passing on the good build and would have kept passing on a broken one**. That is the exact failure mode the brief describes (a `|| true`, a check that reads the screen instead of the file). None of them were found by running the suite; all four were found by trying to break it.

1. **`EXPORT-report-clean` did not go red when appointments leaked into the report.** My assertion looked for the fixture *titles*. The printable report has no title column, so a leaked appointment never prints its title — it prints as a row reading **`Medication (removed) | Appointment`**. I dumped a clean report and a leaking one to confirm: clean contains the substring `ppointment` **zero** times, leaking contains it once. The check now asserts exact absence of `ppointment` and of `Medication (removed)`, in both the CSV and the report. Worth stating plainly: had this leaked, an oncologist would have read a clinic appointment as a **discontinued medication**.

2. **`TICK-sheet-survives` was vacuous.** Deleting the guard it exists to protect did not fail it. The clock tick already skips a repaint while a field has focus (`isEditing`), and the check ran with the cursor still in the title input, so it passed regardless of the dialog guard. It now blurs first and **asserts the precondition** — if a field has focus, the check fails as a precondition failure rather than passing quietly.

3. **`TYPE-note-survives` was watching the wrong field.** It filled the note, *then* planted its probe, then typed in the title — so it was really testing the title handler. Breaking the note handler left it green. It now plants the probe first and types **one key at a time** into the field it guards (per-keystroke typing is what actually exposes a `setState`-per-keystroke: the caret dies with the element and every character after the first lands nowhere).

4. **`FILE-no-null-attr-literals` only caught the literal form.** It matched `disabled: null` but not `disabled: busy ? 'disabled' : null`, which is the form the trap actually ships in. Both the check and the patch's own post-condition now reject the ternary form as well. Both strip whole-line `//` comments first, so the trap can be documented next to the code that avoids it — an earlier version failed on its own explanatory comment.

### One more gap closed rather than argued away

`NET-1` initially failed on the two Google Fonts stylesheets that the base HTML links. They were correctly *refused* by the catch-all; my assertion ("nothing external was attempted") was just wrong. Rewording it would have left a real gap: fonts are blocked here, so the harness renders in the system fallback while Brandi's phone renders Hanken Grotesk — and a wider font could overflow the header now that a 44px button sits in it. So the assertion was rewritten to the honest, stronger claim (no Firebase **data** endpoint was ever contacted; the only external requests attempted were the two inert stylesheets), **and** a new check `LAYOUT-wide-font-stress` re-measures the header row and every day cell with Courier New forced onto everything — materially wider than either real font. Passes at both sizes; cells stay above 44px.

---

## 6. Safety of the harness itself

* **All three gstatic Firebase URLs stubbed** — `firebase-app.js`, `firebase-firestore.js`, `firebase-messaging.js` — with in-memory ES modules. `NET-1` fails the run if any of the three stubs was never used (which would mean the real module loaded).
* **Service worker removed** before any page script runs (`delete Navigator.prototype.serviceWorker`), so the app's own `'serviceWorker' in navigator` guard skips registration cleanly instead of throwing. `sw.js` is cache-first and would serve a stale build between runs. `NET-2` fails if it was ever requested.
* **One catch-all route** with explicit dispatch — no reliance on Playwright's handler ordering. Anything that is not 127.0.0.1 or one of the three stubs is aborted and recorded.
* **Fixtures only.** No credentials, no real collection, no writes anywhere but the in-memory stub. Zero Firestore writes during all testing.
* `window.open` is stubbed to return null so the printable report takes its download branch — `print()` never returns headless. The file is still produced and its bytes are read from the download, which is the branch under test.
* Runs under `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy` against `127.0.0.1`; the suite **refuses to start** if a proxy variable is set rather than failing 70 checks for the wrong reason.
* Chromium at `/opt/pw-browsers/chromium`; the CommonJS playwright at `/home/claude/.npm-global/...` is loaded with `createRequire`. `playwright install` was never run.

---

## 7. Fixtures — what the suite actually exercises

Thirteen documents, including the awkward ones:

| Fixture | Exercises |
|---|---|
| normal appointment with a note | the ordinary case |
| two documents, same `apptId`, different `loggedAt` | supersede — only the newer renders |
| a pair ending in `cancelled:true` | tombstone — neither renders |
| `apptId: 'constructor'` | `Object.prototype` collision |
| `apptId: '__proto__'` | **not storable as an own key on a plain object** — this is the one that actually vanishes |
| `apptId: 'toString'` | `Object.prototype` collision |
| a document with **no** `apptId` at all | legacy identity falls back to the document id, still editable and removable |
| `ts: 0` | unusable date — dropped rather than guessed at |
| three real dose/vital documents | so the CSV under test is **not empty** — an empty CSV would let "no appointments in the export" pass for the wrong reason |

On the `__proto__` case specifically: with a plain-object lookup, `o['__proto__'] = doc` sets the object's *prototype* instead of creating an own key, so the appointment disappears with no error and no warning. `Object.keys()` never sees it. That is the mechanism behind the earlier audit finding about restore dropping records whose id collided with JavaScript built-ins. Grouping uses a `Map`, whose keys have no prototype chain at all.

---

## 8. Reproducing

```bash
# pristine base, without touching the shared working tree
git -C /home/claude/wm show 87e89bb:index.html > work/index.html
md5sum work/index.html          # 8136b7764f07865171c180212a4d5b09

python3 calendar-patch.py --check --repo <repo>   # verify only, writes nothing
python3 calendar-patch.py       --repo <repo>     # apply
python3 calendar-patch.py       --repo <repo>     # again: "ALREADY APPLIED", writes nothing

env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node cal-test.mjs
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node cal-test.mjs --falsify --batch 0-5
```

The patch is atomic (built in memory, first failure aborts before any write), idempotent, and aborts loudly with exit code 2 on an anchor that matches anything other than exactly once. Its refusal path is not theoretical — it fired for real on the contaminated tree in §1 and wrote nothing.

---

## 9. Open items for Aaron

1. **The patch has not been applied to `/home/claude/wm`.** It is verified to apply cleanly to both that tree and the pristine base, but that tree holds somebody else's uncommitted dead-code-removal work and I left it alone. Someone needs to decide the merge order and apply it. `--check` first, always.
2. **The existing symptom-logger note field is still 14px** (§3.2). Same iOS zoom problem as the defect this patch fixed; out of scope here, needs an owner.
3. **Appointments are not in the backup** until the backup/restore patch adds them explicitly (§4), and must not be added via `allExportEntries()`.
4. **Appointment reminders do not exist** and nothing in the UI implies they do. If Brandi expects an appointment to ring, that is a separate feature.
5. Pre-existing, unrelated, noticed while reading: `buildReportDoc` builds its per-medication totals in a plain `const totals = {}` keyed by `medId`. A `medId` of `constructor` reads back the inherited `Object.prototype` value, so `(totals[id] || 0) + 1` evaluates to the **string** `"function Object() { [native code] }1"` — verified in node — which would then print as that medication's dose count in the oncologist report and sort as `NaN`. Every `medId` today is app-generated so it is not reachable now, but it is the same class of bug as §7. Not touched — it is inside the read-only export block and not on any of my anchors.
