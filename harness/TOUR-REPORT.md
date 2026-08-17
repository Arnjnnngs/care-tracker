# care-tracker v44 — guided tour

**Base:** `Arnjnnngs/care-tracker` @ `b1abdf2`, the build currently on their phones.
`index.html` md5 `da4ca5510da8489e646cfa7e0e3e27cd`, `APP_VERSION 'v44'`.
`sw.js` md5 `99d797cd71d8c74dba2da6b6569ba4a9`, `CACHE 'caretracker-v44'`.

**Result:** `index.html` md5 `da4ca5510da8489e646cfa7e0e3e27cd` → `c4c242ff4054ad9661b12bd34df7b84e`.
`APP_VERSION` untouched. `sw.js` byte-identical, md5 unchanged.

**Deliverables**

| file | what it is |
|---|---|
| `tour-patch.py` | anchored, idempotent, refuses loudly. `--check` verifies and writes nothing. |
| `tour-test.mjs` | 68 checks at two phone widths, plus 22 mutators under `--falsify`. |
| `TOUR-REPORT.md` | this file. |

**Reproduce from scratch.** The suite compares the patched build against the *unpatched* base, so
it needs both. Defaults are `work/repo/index.html` and `work/base-index.html`; `--file` and
`--base` override either.

```
git clone https://github.com/Arnjnnngs/care-tracker.git base
mkdir -p work && cp -r base work/repo && rm -rf work/repo/.git
cp base/index.html work/base-index.html && cp base/sw.js work/base-sw.js

python3 tour-patch.py --repo work/repo --check      # verify, write nothing
python3 tour-patch.py --repo work/repo              # apply (idempotent; re-running is a no-op)

env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node tour-test.mjs
env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node tour-test.mjs --falsify

# no regression on the three existing suites
cd base/harness && for f in cal export reason; do
  env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy \
    node $f-test.mjs --file ../../work/repo/index.html
done
```

`HTTPS_PROXY` must be unset — it breaks Chromium against loopback, and the suite refuses to start
rather than failing every check for the wrong reason.

---

## 1. The shape of it, and why it cannot trap anybody

Aaron's requirement was skippable, re-runnable from the menu, and never blocking the app.
ChemoWell's tour gates its app until setup completes. This one refuses that in four ways, and
each one is independently tested:

1. **It never starts on its own.** There is no first-run flag, no prefs read, no Firestore read,
   no `localStorage` key — nothing exists that *could* decide to show it. `tourStart` appears
   exactly twice in the whole file: its own declaration, and the menu row's `onClick`.
   `FILE-no-auto-start` counts those two occurrences and fails on a third, and also fails if the
   tour block ever mentions `localStorage`, `subscribePrefs`, `setDoc` or `addEntryDB`.
   `BOOT-no-tour-on-load` loads the app, reloads it, waits, and then asserts that a dose-logging
   control at the top of Home is reachable by `elementFromPoint` — usable, not merely un-covered.
2. **Four independent exits on every step** — Skip, the X, Escape, and a tap on the dimmed
   backdrop. `EXIT-skip-every-step` walks all nine steps and skips out of each one, then proves
   the app still works by opening and closing the menu afterwards. If any single exit regressed,
   three still work.
3. **It puts the screen back.** The view *and* the open report are recorded at start and restored
   on exit, so leaving at the Reports step does not strand anyone in Reports.
4. **It lives outside `#root`.** `render()` does `root.innerHTML = ''`. A tour built inside root
   would be destroyed by any repaint — and this app repaints on every Firestore snapshot.

**The one place it is deliberately modal, stated plainly:** the backdrop swallows taps aimed at
the app underneath. Letting them through would mean somebody reading the "Logging a dose" step
could log a real dose by touching the highlighted card. A wrong entry in a chemotherapy log is a
worse outcome than a panel you leave with one tap. "Never blocks the app" is honoured by the tour
never appearing unbidden and never having fewer than four ways out — not by making the highlighted
control live underneath it.

---

## 2. The steps, and why these

Nine steps. They cover what the app actually has, in the order somebody meets it.

| # | key | title | anchor |
|---|---|---|---|
| 1 | `welcome` | A quick look around | none — centred |
| 2 | `menu` | Everything lives here | the header menu button |
| 3 | `logging` | Logging a dose | the Quick log section on Home |
| 4 | `missed` | If a dose gets missed | a missed-dose row (may legitimately not exist) |
| 5 | `calendar` | Appointments | the month grid |
| 6 | `meds` | Your medication list | the medication cards |
| 7 | `reports` | Looking back | the report list |
| 8 | `backup` | Your backup file | the Backup button |
| 9 | `finish` | That is everything | the tour row in the open menu |

**Why these and not others.** The brief asked for the menu/drawer, the calendar, logging a dose,
missed doses and their reasons, and saving a copy. Steps 2–5 and 8 are exactly those. Two were
added because leaving them out would have made the tour lie by omission: `meds` (step 6), because
the medication list is where the app's data actually comes from and taking a medication off it is
the operation people most often misread as deleting their history — the copy says so explicitly;
and `reports` (step 7), because step 8 lands on a button *inside* Reports and dropping somebody
there with no explanation of where they are is disorienting. Step 1 sets the expectation ("about a
minute", "nothing you tap in here changes your records") and step 9 closes the loop by
highlighting the menu row it lives on, so the answer to "how do I see that again?" is on screen at
the moment the question occurs.

**Step 4 has no guaranteed anchor and that is by design.** On a day with nothing missed there is
no missed row, and on a brand-new phone with Firestore offline there are no cards at all.
`tourAnchorEl()` returns null, `positionTour()` hides the spotlight and centres the card, and the
step still reads correctly. `ANCHORED_STEPS` in the suite deliberately excludes `missed` for this
reason; every other step must show a live spotlight or `STEPS-run-through` fails.

**The backup copy leads with the fact Aaron asked it to lead with.** Verbatim:

> The backup file is the only one of these that can be put back. Save it somewhere safe — a new
> phone, or anything gone missing, is rebuilt from that file. The spreadsheet and the printable
> report are for reading and for handing to a doctor; neither can be loaded back in.

`COPY-backup-leads` anchors on `^` — the sentence must be *first*, not merely present. Mutator
`backup-copy-buried` rewrites it to "Save the backup file somewhere safe. It is the only one of
these that can be put back…", which says the same thing in a different order, and the check goes
RED. That mutator exists because burying the lead is the realistic failure, not deleting it.

**Copy.** Nine bodies, 69–270 characters. `COPY-no-guilt` fails the build on `you should`,
`you must`, `you need to`, `you failed`, `you forgot`, `don't forget`, `make sure you`,
`remember to`, `be sure to`, `always remember`. The missed-dose step is the one that matters
most and it ends: *"It is a record for the clinic, not a mark against you."*

---

## 3. The composed tick guard

The 1-second clock tick guard is shared. It was **composed with, never overwritten.**

**What v44 actually has** (`index.html:4777` and `:4781`) — note this is *not* the term order
quoted in the brief, which is why the patch reads the real line rather than assuming:

```js
const isEditing = activeTag === 'INPUT' || activeTag === 'SELECT' || activeTag === 'TEXTAREA' || !!state.missReasonSheet;
...
if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();
```

**What it is after this patch:**

```js
if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();
else if (state.tour) positionTour(false);
```

Five terms, four owners: `timeModal` is original, `apptSheet` and `drawerOpen` are the calendar
patch's, `missReasonSheet` rides inside `isEditing` from the reason patch, and `!state.tour` is
this one. The `else` branch matters on its own: skipping `render()` is what stops the spotlight
jumping, but the page underneath can still reflow with no repaint at all — a sync landing, an
image settling, the keyboard closing — and without the branch the highlight sits on stale
coordinates for up to a second.

**The patch refuses to write unless that exact string is present exactly once**, and refuses again
if the `else` branch is missing. Proven: a copy of the patch doctored to emit the guard without
`!state.apptSheet` refuses with *"composed tick guard missing … appears 0 times, expected 1"* and
writes nothing. Three separate mutators in the suite delete a different term each and all three
turn `FILE-tick-guard-composed` RED.

### `!state.tour` protects the spotlight, not focus

The tour lives outside `#root`, so a repaint cannot take focus off it. The brief is explicit that
a focus test does not cover this, and there is no focus test here pretending to.

`SPOT-follows-reflow` is the real one. It advances to the `backup` step, waits for the tour's own
two-frame positioning to *settle* (two identical samples 150ms apart — otherwise a leftover frame
re-glues the ring and the check passes while disarmed), asserts the ring is on its target to begin
with, then injects a 190px-tall node straight into `#root` — no `setState`, no `render()`, no
scroll event, no resize event, so the clock-tick branch is the only thing that can react. It then:

- **asserts the target actually moved** (`>= 40px`; measured 208px at both widths). A check that
  passes because nothing moved proves nothing.
- **asserts a canary attribute on a node inside `#root` survived**, so no repaint happened during
  the wait and the tail of `render()` cannot be what re-glued the ring.
- **requires the ring within 3px** of the target. Measured: **dy 0.22px, dx 0.00px** at 375x812
  and at 390x844.

Mutator `reflow-branch-removed` neuters the `else` branch and this goes RED.

---

## 4. Collision check

A duplicate `help:` icon key applied cleanly and silently once on this project. Duplicate object
keys are legal JavaScript — last wins, no error — and anchor-uniqueness is blind to them. So the
collision scan runs **inside the patch, against the unpatched source, before a single byte is
written**, and any hit is fatal.

What is checked, from `NEW_IDENTIFIERS` / `NEW_ICON_KEYS` / `NEW_STATE_KEYS` / `NEW_DATA_HOOKS` /
`NEW_ELEMENT_IDS`:

- **18 identifiers** — `TOUR_STEPS`, `tourEl`, `tourScrimEl`, `tourRingEl`, `tourCardEl`,
  `tourStepAt`, `tourAnchorEl`, `tourMount`, `tourUnmount`, `tourReflow`, `positionTour`,
  `tourApplyView`, `tourRenderStep`, `tourKeyHandler`, `tourGo`, `tourNext`, `tourStart`,
  `tourEnd`
- **1 icon key** — `tourHelp`
- **1 state key** — `tour`
- **23 `data-` hooks** — every `data-tour-*` this patch emits or selects on
- **2 element ids** — `tour-title`, `tour-body`

**What is actually free in v44, verified rather than assumed.** The brief said the calendar work
namespaced icons to `calMenu`/`calMonth`/`calClose`. Confirmed. The scan additionally asserts that
`menu`, `calendar`, `close`, `gear` and **`help`** are still *unused* — and refuses if any of them
has been taken since. This patch does not take `help`; it namespaces to `tourHelp`, for exactly
the reason the calendar patch namespaced its own: `help` is the obvious name, which is precisely
why the next patch will reach for it too. `FILE-no-duplicate-icon-keys` re-checks the same five
names in the *result*.

**Post-condition, because a pre-scan cannot see a duplicate the patch itself introduces:** after
patching, the icon table is re-parsed and any repeated key anywhere in it refuses the write.

**Nobody else's hooks may move.** The calendar, reason and export suites each assert their own
hooks appear exactly once in the whole source — and a tour *selector* that merely reads one counts
as an occurrence, which is how a previous round turned `cal-test` red. So the tour puts its own
`data-tour-*` attribute on the same element instead of selecting on somebody else's, and the patch
counts every `data-cal-*`, `data-mr-*` and `data-backup-*` hook before and after, refusing on any
change. `FILE-sibling-hooks-untouched` re-checks 31 of them from the test side.

---

## 5. Where the trigger went

**In the drawer, not the header.** The header is menu + title + clock and has room for one button.

**Discrepancy with the brief, stated rather than papered over:** the brief said the drawer already
had a reserved `{ key: 'help', helper: 'Coming soon', ready: false }` row to take over. **It does
not.** In v44, `CAL_DRAWER_ITEMS` (`index.html:2911`) is six navigation rows and nothing else —
Home, Calendar, Medications, Reports, In-Patient, Symptoms. There is no reserved slot, and
`grep` for `Coming soon`, `ready: false` and `key: 'help'` returns nothing.

So the tour row is added **below a divider, deliberately outside `CAL_DRAWER_ITEMS`**. That array
is view-keyed and feeds `calDrawerGo() → navigateTo()`; a seventh entry in it would navigate to a
view that does not exist. The patch asserts `CAL_DRAWER_ITEMS` still has exactly six rows and
refuses otherwise — a doctored patch that adds the row to the array refuses with *"CAL_DRAWER_ITEMS
has 7 rows, expected the original 6"*. Mutator `seventh-drawer-item` covers the same thing from the
test side, and `HEADER-one-button` measures at runtime: **1 header button, 6 nav rows, 1 tour row**,
at both widths.

**`closeDrawer()` is never called.** It queues a ~30ms focus handoff back to the menu button that
lands *after* the tour has taken focus and yanks it straight back out. `tourApplyView()` clears
`calDrawerNeedsFocus` / `calSheetNeedsFocus` and sets `state.drawerOpen` directly, and the tour
claims focus on a **double** rAF so it wins the race outright rather than most of the time. The
patch greps its own emitted `tourStart` / `tourGo` / `tourApplyView` bodies for `calCloseDrawer(`
and refuses on a hit; `FILE-no-calCloseDrawer-in-tour` and mutator `tour-calls-calCloseDrawer`
cover it from the test side, and `FOCUS-tour-wins` proves it at runtime.

---

## 6. The h() trap

`h(tag, attrs, ...children)` falls through to `el.setAttribute(k, v)`. `disabled: null` renders
`disabled="null"`, and **any** value disables the control. Four Blockers have shipped from this,
including two dead export buttons. A tour with Back / Next / Skip is exactly where it bites, and
the Back button on step 1 is the classic case.

- **Back is omitted on step 1, not rendered disabled.** `i > 0 ? h('button', …) : null`. There is
  no disabled state anywhere in the tour to get wrong.
- **`aria-current` on the progress dots is spread in**, never passed as a nullish ternary:
  `Object.assign({…}, k === i ? { 'aria-current': 'step' } : {})`.
- **`data-tour-backup` on the Backup button is spread in**, so the other two export buttons do not
  receive a dead hook — and it sits alongside the existing `...(off ? { disabled: 'disabled' } : {})`
  rather than replacing it.

`TRAP-no-null-attributes` walks **every attribute of every element in the tour subtree on all nine
steps** and fails if any value is `"null"` or `"undefined"`, if a `disabled`/`checked`/`selected`/
`hidden` attribute reached the DOM *at all*, or if the number of elements carrying `aria-current`
is anything other than exactly one. It then asserts every button is live (`!b.disabled` and a
non-zero box). `FILE-no-null-attr-literals` greps the source for six risky attributes passed as
nullish ternaries. Two mutators reproduce the real defect — `back-button-disabled-null` and
`aria-current-not-spread` — and both go RED.

---

## 7. Actively trying to get it stuck

The brief asked for this specifically, so these are attacks, not happy paths.

| attack | check | outcome |
|---|---|---|
| Firestore offline, **prefs never resolve at all**, every write rejected, zero entries | `OFFLINE-full-run` | all 9 steps run end to end, every card on screen, no page errors |
| Dismiss at **every single step** — 9 separate runs | `EXIT-skip-every-step` | closes each time, and the menu opens and closes afterwards |
| Escape, backdrop tap, the X | `EXIT-escape`, `EXIT-backdrop`, `EXIT-close-x` | all close |
| **Double-tap Skip**, **double-tap the X** | `STUCK-double-taps-and-restarts` | no overlay survives |
| **Double-tap the menu row** | same | exactly 1 overlay, still on step 1 — not two stacked, not skipped ahead |
| Re-run a third time after that | same | starts clean at step 1 |
| Back from step 9 all the way to step 1, then Skip | `EXIT-back-then-skip` | reaches step 0, no Back button there, Skip works |
| **Live Firestore snapshot mid-tour** | `SYNC-tour-survives-snapshot` | tour survives, stays on its step, keeps focus, is not inside `#root`, ring re-glues within 3px |
| Quit at the Reports step; quit from **inside a report detail** | `EXIT-restores-view` | both restored, the detail included |

`tourEnd()` is safe to call twice from any step with the DOM in any state: every teardown line is
guarded or idempotent, because "I tapped Skip twice" must not be a way to end up with a dead
overlay. `state.tour` is nulled *first*, so a re-entrant call returns immediately.

**Zero writes.** `TOUR-no-writes` runs the tour start to finish and asserts `addDoc`, `deleteDoc`
and `setDoc` were all called zero times. Firestore is append-only here and a tour has no business
touching patient data at all.

**A half-filled medication form is deliberately *not* discarded** when the tour starts. That is
typed data; throwing it away because somebody opened the tour would be the tour destroying work —
the exact thing it is not allowed to do. It stays open behind the tour and is still there after.

---

## 8. Mobile, measured

375x812 **and** 390x844, `isMobile`, `hasTouch`, DPR 3. Every number below is
`getBoundingClientRect()`, not eyeballed, at **both** widths — a previous harness in this project
hid a real defect by measuring at the wrong width.

```
drawer tour row @375x812: 58.0px tall, 261.0px wide
drawer tour row @390x844: 58.0px tall, 261.0px wide
smallest tour button @375x812: 44.0px (close @step0)
smallest tour button @390x844: 44.0px (close @step0)
spotlight after a 208px reflow @375x812: dy 0.22px, dx 0.00px (tolerance 3px)
spotlight after a 208px reflow @390x844: dy 0.22px, dx 0.00px (tolerance 3px)
```

`TAP-tour-buttons-44` measures **height and width of every button on every one of the nine steps**
at both widths, not just the first. `STEPS-run-through` asserts the card is fully inside the
viewport on every step at both widths. There is no font-size floor to check because **the tour
contains no input at all** — `A11Y-dialog` asserts zero `input`/`select`/`textarea` inside the
tour root, so it can never raise a keyboard. Focus lands on the card, not on a field.

---

## 9. Two traps this project has fallen into, and how this suite avoids them

**Passing while disarmed.** A previous appointment-sheet focus test raced the app's own 30ms focus
timer; when the app won, focus sat on an `<input>` where the pre-existing `isEditing` term already
suppressed the repaint, so the test passed even with `!state.apptSheet` deleted.
`TYPE-appt-sheet-survives` **waits for the app's own focus handoff to land on the sheet first**,
then deliberately blurs to `<body>` and asserts `document.activeElement.tagName` is not
`INPUT`/`SELECT`/`TEXTAREA` — so `isEditing` is provably false and only `!state.apptSheet` can be
doing the work. Mutator `tick-clobbers-appt-sheet` (the exact regression the brief warns about)
turns it RED. `FOCUS-tour-wins` does the same thing: it waits for the drawer to focus *itself*
before opening the tour, so the tour is proven to win a live race rather than an empty one.
`SPOT-follows-reflow` applies the same discipline twice — settle-then-shove, and the `#root`
canary.

**Reading `document.body.textContent`.** On this single-file app that includes the inline
`<script>` source, so string literals match and every check passes on a broken build. **No check
in this suite reads `body.textContent` or `body.innerText` for content.** Text assertions are
scoped to rendered elements — `card.querySelector('[data-tour-title]').textContent` and the like.
File-level checks read the *file*, and `stripComments()` removes `//` and `/* */` before grepping,
because the base file carries `disabled: busy ? 'disabled' : null` inside a comment explaining why
that must never be written. And `HARNESS-page-is-the-file` compares the length of the module script
the browser is actually running against the file the FILE checks read, so a runtime check cannot
pass against a stale or cached build.

---

## 10. Version-agnostic post-conditions

Three earlier patches here pinned `const APP_VERSION = 'v43.3';` and all refused to apply the
moment the version was legitimately bumped. This patch **compares input to output** and never
asserts a literal:

```python
app_version = re.search(r"const APP_VERSION = '([^']+)';", src).group(1)   # read from the input
...
if ("const APP_VERSION = '%s';" % app_version) not in out:                 # must match the output
    problems.append('APP_VERSION was altered -- this patch must never touch it')
```

It is correct at v44, at v45, and at any version after.

> **Defect found in the surviving `tour-test.mjs` and fixed.** `FILE-app-version` asserted the
> literal `const APP_VERSION = 'v43.4';` — the exact anti-pattern above. It would have failed
> against the v44 base and again at every ship-time bump. It now reads the unpatched base
> (`--base`, default `work/base-index.html`) and asserts input == output. The matching
> `app-version-bumped` mutator was pinned the same way; it now reads whatever version is present
> and changes it. A new `FILE-sw-js-byte-identical` check was added, comparing the patched tree's
> `sw.js` to the base's byte for byte and *reporting* the CACHE name rather than asserting it.

`sw.js` is not touched by the patch at all: md5 `99d797cd71d8c74dba2da6b6569ba4a9` before and
after. `FILE-sw-block-untouched` additionally asserts the registration line in `index.html` is
unchanged and that the tour block never mentions `serviceWorker`.

---

## 11. The three existing suites

**These numbers do not match the ones in the brief, and that is a finding, not a regression.**
Measured here against the **unpatched** base, `da4ca5510da8489e646cfa7e0e3e27cd`:

| suite | brief says | measured on unpatched v44 | measured on patched build |
|---|---|---|---|
| `cal-test.mjs` | 69/70 | **69/70** | **69/70** |
| `export-test.mjs` | 49/49 | **47/49** | **47/49** |
| `reason-test.mjs` | 38/41 | **31/41** (30/41 on one run — see below) | **31/41** |

**The gate that matters — patched == unpatched, check for check — passes.** The failing check IDs
are identical in each pair; the patch introduces no new failure in any of the three.

**Why export is 47/49, not 49/49.** Two failures, both stale version pins:
`FILE-app-version` wants v43.4, and `BACKUP-format` fails with *"app version not recorded: v44"* —
it asserts the backup file records a specific literal version.

**Why reason is 31/41, not 38/41.** `FILE-app-version` wants v43.3. The other failures are one
cause: **the committed `harness/reason-test.mjs` is a pre-cut copy that still tests the 9-option
reason list.** It asserts labels like `Felt too nauseous`, which appears **8 times in the suite and
0 times in v44's `index.html`** — the task sheet records that the 9-option list was cut in favour
of Took later / Skipped / Clear. The suite is out of sync with the app it ships beside; once
`COPY-no-judgment` fails, the fixtures that depend on those labels take the sheet-driven checks
with them. This is identical before and after the patch. `reason-test.mjs` is also mildly flaky —
`IDENTITY-one-window-only` / `REPORT-reasons-not-in-log` flapped between two baseline runs — so
30/41 and 31/41 are both baseline values.

**None of these were "fixed" by weakening them.** The three suites are byte-identical to the
committed `harness/` copies (md5s verified against `/home/claude/rebuild/{cal,export,reason}/`);
not one line was touched.

---

## 12. Falsifications

Every check below was broken, confirmed RED, and restored. Nothing here is asserted without
having been proved to fail when the thing it guards is removed.

### Patch-side — the patch must refuse and write nothing

Run against a doctored copy of the base or of the patch. All eight refuse; the input file is
never written.

| # | attack | refusal |
|---|---|---|
| A | a `tourHelp:` icon key already in the base | `icon/object key \`tourHelp:\` already exists` |
| B | `data-tour-menu` already in the base | `data hook \`data-tour-menu\` already exists` |
| C | identifier `positionTour` already in the base | `identifier \`positionTour\` already exists` |
| D | `help` icon key taken when it was expected free | `icon key \`help\` was expected to be free but is taken` |
| E | tick-guard anchor already altered by a sibling patch | `anchor not found [tick guard]` |
| F | `state.tour` key already exists | `state key \`tour\` already exists` |
| G | patch doctored to emit a guard missing `!state.apptSheet` | `composed tick guard missing … appears 0 times, expected 1` |
| H | patch doctored to add the row to `CAL_DRAWER_ITEMS` | `CAL_DRAWER_ITEMS has 7 rows, expected the original 6` |

G and H are the important pair: they prove the patch fails **at patch time** if a later edit drops
somebody else's term or moves the drawer row into the view-keyed array, rather than shipping it.

### Suite-side — 22 mutators, one broken property each

Baseline for falsification: **44/44 green on the unmutated build**, so a RED result is attributable
to the mutation.

| mutator | breaks | must go RED |
|---|---|---|
| `tick-drops-tour` | `!state.tour` out of the shared guard | `FILE-tick-guard-composed`, `TICK-no-repaint-under-tour` |
| `tick-clobbers-appt-sheet` | the brief's named regression: drops the calendar term | `FILE-tick-guard-composed`, `TYPE-appt-sheet-survives` |
| `tick-clobbers-drawer` | drops the drawer term | `FILE-tick-guard-composed`, `TICK-drawer-survives` |
| `reflow-branch-removed` | the `else` reflow branch | `FILE-tick-guard-composed`, `SPOT-follows-reflow` |
| `back-button-disabled-null` | the h() trap on Back, step 1 | `TRAP-no-null-attributes` |
| `aria-current-not-spread` | the h() trap on the progress dots | `TRAP-no-null-attributes` |
| `tour-auto-starts` | the ChemoWell behaviour Aaron refused | `FILE-no-auto-start`, `BOOT-no-tour-on-load` |
| `skip-does-nothing` | Skip wired to a no-op | `EXIT-skip-every-step` |
| `escape-ignored` | the Escape exit | `EXIT-escape` |
| `backdrop-tap-ignored` | the backdrop exit | `EXIT-backdrop` |
| `tour-calls-calCloseDrawer` | lesson 5 — the 30ms focus yank | `FILE-no-calCloseDrawer-in-tour` |
| `duplicate-icon-key` | lesson 3 — a silent duplicate key | `FILE-no-duplicate-icon-keys` |
| `header-second-button` | lesson 4 — trigger in the header | `FILE-header-one-button`, `HEADER-one-button` |
| `seventh-drawer-item` | tour into `CAL_DRAWER_ITEMS` | `FILE-drawer-items-6` |
| `app-version-bumped` | touches `APP_VERSION` | `FILE-app-version` |
| `sw-registration-touched` | edits the sw registration block | `FILE-sw-block-untouched` |
| `tour-writes-to-firestore` | the tour writes a document | `TOUR-no-writes` |
| `backup-copy-buried` | moves the only-restorable fact out of the lead | `COPY-backup-leads` |
| `tour-inside-root` | mounts the tour inside `#root` | `SYNC-tour-survives-snapshot` |
| `tap-targets-shrunk` | buttons below the 44px floor | `TAP-tour-buttons-44` |
| `view-not-restored` | leaves the patient where the tour stopped | `EXIT-restores-view` |
| `setState-in-onInput` | regression guard for the other four patches | `FILE-no-setState-in-onInput` |

Plus, run by hand because it needs a second file rather than a mutated HTML string:

| attack | check | outcome |
|---|---|---|
| append a line to the patched tree's `sw.js` | `FILE-sw-js-byte-identical` | RED, restored |

**Result: 22/22 suite mutators proved falsifiable, 8/8 patch-side refusals proved, plus the `sw.js` check — 31 falsifications in all. Baseline before mutation: 44/44 green, so every RED is attributable to the mutation.**

---

## 13. Safety of the harness

This app holds one cancer patient's real medication history. The suite never touches it.

- **All three gstatic Firebase modules are stubbed** — `firebase-app.js`, `firebase-firestore.js`,
  `firebase-messaging.js` — and `NET-1` fails the run unless all three stubs were actually hit,
  so the real module cannot have been used.
- **One catch-all route aborts every request that is not `127.0.0.1` or one of the three stubs.**
  `NET-1` asserts nothing was ever *allowed* out except loopback, and separately that no
  `firestore` / `firebaseio` / `googleapis.com/v1` / `identitytoolkit` host was reached.
- **The service worker is deleted from the page before any script runs** (`delete
  Navigator.prototype.serviceWorker`), and any request for `sw.js` or `firebase-messaging-sw.js`
  is aborted and flagged. `NET-2` fails the run if either was ever requested.
- **Fixtures only.** No credentials. All writes land in an in-memory stub, and `TOUR-no-writes`
  asserts the tour issues none at all.
- `window.open` is stubbed to `null` and `localStorage` is cleared on every page.
- The suite **refuses to start** if `HTTPS_PROXY` is set, rather than failing every check for the
  wrong reason. Chromium is `/opt/pw-browsers/chromium`; the global CommonJS playwright is loaded
  with `createRequire`. `playwright install` is never run.

Nothing was pushed to GitHub. `git reset --hard` was never run.

---

## 14. What is not covered

- **The tour describes the download buttons; it cannot prove a file lands.** The task sheet's open
  item stands: on iOS the download path has no failure detection, and until Aaron confirms a file
  actually arrives, the backup is not a backup. The tour's step 8 tells the patient the backup file
  is the one that can be restored — which is true of the *format*, and is the right thing to say —
  but it inherits that unverified delivery path. `TOUR-no-writes` proves the tour does not create
  the problem; it does not prove the problem is gone.
- **`APP_VERSION` and `CACHE` are deliberately untouched.** Shipping this needs both bumped, by
  hand, at ship time. Until `sw.js` gets a new `CACHE` name the cache-first worker will keep
  serving v44 to phones that already have it.
- **`reason-test.mjs` is out of sync with the app it ships beside** (section 11). Worth a separate
  fix; deliberately not done here, because quietly editing another feature's suite while shipping
  this one is how coverage gets lost.
