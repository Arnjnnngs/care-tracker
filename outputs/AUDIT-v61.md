# Zero-day audit — v61 ("What's new")
AUDITED-COMMIT: 60f0298961799de594a6a3ceeda6ff94a55577df
VERDICT: DO NOT SHIP

## The headline, in plain words

**The machinery is good. What it publishes is not.**

The code behind this feature is the cleanest thing I have audited in this repo. It cannot
touch a dose, a medication, a record or a missed-dose alert — I proved that rather than
assumed it. It cannot crash the app when the phone's storage is broken. It cannot swallow a
tap meant for a dose button. Every gate started and printed real numbers.

But the feature IS the text, and the text is wrong in four places out of the ten I checked
against README.md and STATUS.md. One entry credits a repair to the release that caused the
damage. One says a release changed "nothing you would notice on screen" when that release
shipped the Calendar and the very menu this feature lives in. One describes a change that
belongs to a different release, and silently loses the real one. And one tells Brandi her
iPhone backup works, which this project's own standing rule says nobody has confirmed.

An update history that is wrong 40% of the time is worse than no update history, because
she has no way to tell which entries to trust. **Fix the text, keep the code, ship it.**
This is a re-write of six paragraphs, not a rebuild.

---

## 1. Could this hurt Brandi? No — and here is the proof, not the reasoning

This was the only question that could actually matter, so I attacked it first and
mechanically rather than by reading.

- The whole feature is `CHANGELOG` (a constant list of text), four short helper functions,
  two render functions, and one new menu row. Nothing else.
- I extracted both new code blocks and searched them for every way this app can write:
  `addDoc(`, `setDoc(`, `deleteDoc(`, `state.entries`, `state.meds =`,
  `saveMedicationConfig`, `missedDosesFor`. **Zero hits.**
- Every `setState()` call in the new code was enumerated. There are exactly two, and between
  them they touch three things: `whatsNewOpen`, `view`, `drawerOpen`. Nothing else.
- The one new field added to shared app state (`whatsNewOpen`) cannot leak to the database:
  every Firestore write in this app sends an explicit named payload, never the state object.
- Firestore was stubbed in every run. **Nothing in this audit touched the live database.**

**Conclusion: this release cannot cause a missed dose, a double dose, or a lost record.**
Everything below is either the accuracy of the words, or the quality of the gates.

---

## 2. Findings

### A — MAJOR — the v37 entry describes a different release, and loses the real one
The history says v37 was *"Clearer dose buttons — Tidied up the wording on the quick-log
cards."* README.md's own v37 row says v37 gave the **missed-dose banner a persistent Clear
button** that writes `missedClearedAt` and syncs across both phones. The "quick-log wording"
change is v36 — which the history already lists correctly, one entry above. So v37 is a
duplicate of v36's theme, and a real, patient-visible control on the *missed-dose alert* has
been written out of the record entirely.
**Affects: the accuracy of the history only. Not the medication record.**

### B — MAJOR — the v39 entry credits the repair to the release that broke it
The history says v39 was a *"Repair release — A previous upload had damaged two files. This
put them back."* README.md says the opposite in bold: **v39 is the commit that corrupted**
`sw.js` and `CARETRACKER_HANDOFF.md` to the literal string "undefined", and it was **fixed in
v40**. The history's v40 entry mentions only the Buspirone/Paroxetine move and says nothing
about the repair. Both entries are wrong, in opposite directions.
**Affects: the accuracy of the history only.**

### C — MAJOR — the v44 entry says "nothing you would notice", which is plainly false
The history says v44 was *"Groundwork — Internal work with nothing you would notice on
screen."* STATUS.md's own "## v44 — SHIPPED" section lists what v44 added: the **Calendar and
appointments**, the **navigation drawer** (the menu this whole feature lives under), **backup
and restore**, appointments in the backup, the concurrent-edit notice, and the **missed-dose
reason picker** ("Took it later" / "Skipped"). That is one of the largest visible releases in
the list, described as invisible.
**Affects: the accuracy of the history only.**

### D — MAJOR — the v50 entry tells the patient the iPhone backup works
The history says: *"Saving a copy failed silently on iPhone. It works now."* CLAUDE.md Rule 7
carries a standing exception in the opposite direction: `deliverFile()` fails silently on iOS
with no detection, it *"needs Aaron's phone test to confirm any fix"*, and — verbatim —
**"Until confirmed, the backup is NOT called a backup."** I searched STATUS.md for any record
of that confirmation and found none; STATUS's own v50 section describes the fix
(`navigator.share`) but not a verification on a real phone.
This is the one accuracy defect with a route to harm: someone who reads "it works now" and
stops checking is relying on a file that may never land. Either confirm it on the phone, or
soften the sentence to what is actually known.
**Affects: the words only — but the words are about the safety net around the record.**

### E — MINOR — the v41 title says "Evening", the change was to the Morning window
v40 moved Buspirone and Paroxetine **out of** the 10 PM evening window **into a morning
window**. v41 corrected that new morning default. The history titles v41 *"Evening medication
timing corrected"*, which reads as though the evening window moved again.

### F — MINOR — the v33 entry implies Senokot had been raising false missed alerts
*"...it is taken when needed, so it is no longer flagged as missed."* Senokot was never one of
the tracked medications (CLAUDE.md lists Protonix, Buspirone, Paroxetine, Iron), and README
v23 recorded it as as-needed from the day it was added. Removing its windows was tidiness,
not the end of a false alarm.

### G — MINOR — no gate checks whether a single entry is TRUE
`harness/whatsnew-test.mjs` is a good suite for the mechanism: it counts entries, reads the
newest, checks the order, checks the version label. It never compares one word against
README.md or STATUS.md. **Every one of findings A–F passes it, 20/20.** If this history is
going to be maintained, one check that each `v:` in `CHANGELOG` also exists in the docs — and
a human read of any new entry — is the missing gate.

### H — MINOR — the "never covers Connecting…" guard is untested
Claim 6 of the release is that the notice is painted only once loading finishes. I removed
`!state.loaded` from `renderWhatsNewModal()` and re-ran the suite: **20/20, still green.**
The guard is correct in the shipped code, but nothing would notice if it were deleted. (The
practical harm is small — the loading overlay sits at z-index 100, above the notice's 95 —
but the check the release advertises does not exist.)

### I — MINOR (pre-existing, but now load-bearing) — the drawer's tap-target gate has not run for three releases
`harness/cal-test.mjs` fails `TAP-drawer-items` at both iPhone widths. It is **not** a tap
defect: the assertion hard-codes `boxes.length === 6` and the menu has had more rows since
v58 — it is now 9. Because that count assert throws first, **the 44px tap-target loop it is
named after has not actually executed since the menu grew.** I confirmed it is identical on
the pre-v61 commit, so v61 did not cause it — but v61 adds a row to exactly this menu, so I
measured it by hand instead: all 9 rows are **58 x 250px at 320px wide, 58 x 261px at 375 and
390**, and both buttons on the notice are **46px tall** at every width. All clear. The stale
assertion should be made version-agnostic; it is the "gate that goes red for a legitimate
change" pattern this project has already paid for three times.

### J — MINOR — the notice returns on every open if storage can be read but not written
Measured, not reasoned. With a shim where `getItem` returns an old version and `setItem`
throws `QuotaExceededError` (a full localStorage), the notice appeared and had to be
dismissed on **three out of three consecutive opens**. It is one tap, it never blocks
anything permanently, and no record is at risk.
The commoner iOS failures land the safe way: with storage fully unavailable, or in Safari
private mode where reads return null, the fresh-install path runs and **the notice never
appears at all**. I verified the fully-broken-storage case end to end: the app starts, paints
the real screen, logs zero page errors, and shows no notice.

### K — NOTE — 115 elements carry a meaningless `key=""` attribute
`whatsNewEntry()` passes `key: e.v` and `key: String(i)` to `h()`. `h()` has no `key` case, so
it falls through to `setAttribute` and the page ships `key="v61"`, `key="0"` and so on — 115
of them on the history screen. It is React habit; this renderer wipes `root.innerHTML` on
every paint, so it buys nothing. Harmless, invalid HTML, worth deleting. It is the only place
in the file that passes `key` to `h()`.

### L — NOTE — the "works offline" comment in the code is false
The comment above `state.whatsNewOpen` says the notice "still appears on a phone that opens
offline." I stubbed a Firestore that never delivers a snapshot: the app stays on
"Connecting…" and **the notice does not appear**, because painting is gated on `state.loaded`
and `loaded` is only ever set from a snapshot. The behaviour is fine — the app is unusable
offline regardless — but the comment will mislead whoever reads it next.

### M — NOTE — 51 entries, not 50
`CHANGELOG` holds 51 (v13–v61, counting v43.1/.2/.3 separately). The suite reads the count
from the file, so it passes either way.

### N — NOTE — STATUS.md contradicts itself two lines apart
The status table still reads **"Version | v60 — BUILT, NOT DEPLOYED. v59 is what is live on
her phone"** while the State row directly below says v60 is live on `main` and v61 is built.
`pm.py` flags this as a warning.

---

## 3. The h() trap — clean

Every new `h()` call was checked by hand and then by machine. I walked the notice, the menu
(new row included) and the full history screen in a real browser and searched every element
for an attribute whose value is the literal `null`, `undefined` or `NaN`. **Zero found.**
`aria-current` behaves correctly — present as `page` on exactly one menu row, absent (not
`"null"`) on the other eight. The new drawer row inherits the existing spread-in pattern and
does not reintroduce the trap.

## 4. The drawer still works

The new row sits seventh of nine, above Settings. All nine rows render, are the same size,
and meet the tap floor at 320/375/390 (measurements in finding I). `renderContent()` routes
`whatsnew` correctly, `navigateTo()` needed no change, and the bottom nav shows no active tab
on this view — the same as Settings, Calendar and Report a problem already do.

## 5. Start-up safety — tested, not argued

`CHANGELOG` sits after `APP_VERSION` and before `state`, so the temporal-dead-zone fault that
emptied ChemoWell's saved medications this week cannot occur here; `pm.py` confirms the file
parses. `whatsNewShouldShow()` cannot throw: both storage helpers (`medsyncLsGet` /
`medsyncLsSet`) are already inside try/catch and return `null`/`false` on failure. I proved it
by replacing `window.localStorage` with an object that throws on every method — the app
started, connected, painted the dose cards and logged no errors.

## 6. The notice cannot block a dose

It is a fixed overlay at z-index 95, above the dose time-picker (60), the menu (70) and the
appointment sheet (80), and below the "Connecting…" screen (100). It can only be armed once,
at start-up, and it is only painted after loading finishes — so it cannot appear part-way
through a dose being logged, and the time-picker cannot be open underneath it (input is
blocked by the loading screen until the moment the notice is already up).
I confirmed the behaviour both ways. With the notice up, a click aimed at a Quick Log button
**does not reach it** — Playwright reports the notice intercepting the pointer, no time-picker
opens, and no entry is written. After one tap on "Got it", all 22 buttons on the Home screen
are live again. Backdrop tap also dismisses, and there is always scrim above the card to tap.

---

## 7. Numbers — every gate started and printed real assertion counts

| Suite | Result |
|---|---|
| `harness/whatsnew-test.mjs` | **20/20** |
| `harness/treatment-window-test.mjs` | **32/32** |
| `harness/missed-banner-test.mjs` | **16/16** |
| `harness/chemo-offset-test.mjs` | **17/17** |
| `harness/inpatient-window-test.mjs` | **10/10** |
| `harness/medflag-backfill-test.mjs` | **9/9** |
| `harness/missedcard-test.mjs` | **7/7** |
| `harness/medskip-test.mjs` | **10/10** |
| `harness/overflow-scan.mjs` (~6 min) | **80/80 screen/width combinations, 0 overflowing** |
| `harness/cal-test.mjs` (extra) | 67/70 — all 3 reds identical on the pre-v61 commit; see finding I |
| my probes (storage, taps, blast radius, h(), tap targets, offline) | **33 checks** |

**121 assertions across the eight required suites, all green.** The overflow scan reproduces
RENDER-v61.md exactly: 80 of 80, clean.

## 8. Falsification — I broke each check and watched it go red

Every sabotage was applied to a **copy** of `index.html`; the repo file was never modified.

| Sabotage | Result | Which check fired |
|---|---|---|
| Never arm the notice at start-up | **RED 10/17** | "the pop-up is on screen after an update", plus all four dismissal checks |
| Greet a fresh install with the notice | **RED 18/20** | "no pop-up on a phone that has never run this app" |
| Delete the "What's new" menu row | **RED 14/15** | "a What's new row is in the menu" |
| Render only 4 of the releases | **RED 18/20** | "every release in the file is listed \| 4 shown, 51 in the file" |
| Delete the `!state.loaded` guard | **STILL GREEN 20/20** | nothing — see finding H |

Four of five sabotages went red on precisely the check they were aimed at. The fifth is the
gap in finding H.

## 9. `python3 pm.py`

**Exit 1 — one blocker, and it is mine:** `?? outputs/AUDIT-v61.md`, this report, untracked.
Everything else about the release passes: v61 and `caretracker-v61` agree, the file parses,
both md5s in STATUS.md match, the render audit is recorded, and the notes moved with the code.
Two warnings: the stale STATUS version row (finding N), and 9 pinned version literals in
harness suites — all pre-existing, none in the new suite, and one of them is the `cal-test`
problem in finding I.

---

## 10. What I did not check

- **Nobody has opened v61 on a real iPhone.** Everything here is Chromium at Apple viewport
  sizes. That remains the one check worth Aaron's ten seconds.
- I did not verify the 41 changelog entries I did not spot-check. Given four material errors
  in the ten I did check, **assume the rest need the same pass** before this ships.
- I did not deploy, commit, or push anything. `git status` shows only this file.

## 11. What has to happen before this ships

1. Rewrite v37 (it is v36's change — restore the real one: the missed-dose banner's Clear button).
2. Rewrite v39 and v40 (v39 broke the files, v40 repaired them).
3. Rewrite v44 (Calendar, appointments, the menu, backup & restore, missed-dose reasons).
4. Soften v50, or confirm the iPhone backup on the phone first.
5. Re-title v41; drop the "no longer flagged as missed" clause from v33.
6. Re-check the remaining 41 entries against README.md and STATUS.md.
7. Optional but cheap: delete the `key:` attributes, fix the offline comment, correct the
   STATUS version row, and make `cal-test`'s drawer count version-agnostic so that gate runs again.

None of this touches the code that renders the feature. Once the words are right, ship it.
