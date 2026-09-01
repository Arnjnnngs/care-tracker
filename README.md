# Brandi's CareTracker

Real-time family medication & vitals tracker — a progressive web app (PWA) for logging medications, temperature, and weight with live Firebase sync and push notification reminders.

**Live App:** https://arnjnnngs.github.io/care-tracker/
**Cache Reset:** https://arnjnnngs.github.io/care-tracker/reset.html
**Repository:** https://github.com/arnjnnngs/care-tracker

## Overview

CareTracker is a single-page PWA built with vanilla JavaScript and Firebase Firestore. It tracks daily medication doses, temperature readings, and weight for a caregiver workflow. The app uses real-time Firestore listeners for instant multi-device sync and Firebase Cloud Messaging (FCM) for scheduled push notification reminders via GitHub Actions.

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules), inline CSS, single-file `index.html` (1042 lines)
- **Backend/Database:** Firebase Firestore (project `fuelforge-7c132`)
- **Push Notifications:** Firebase Cloud Messaging (FCM)
- **Hosting:** GitHub Pages
- **Automation:** GitHub Actions cron job for medication reminders
- **Fonts:** Hanken Grotesk, IBM Plex Mono (Google Fonts)
- **Firebase SDK:** v10.12.0 (ESM imports from gstatic CDN)

## Project Structure

```
care-tracker/
├── .github/workflows/
│ └── reminders.yml # Cron job: med reminder notifications
├── firebase-messaging-sw.js # FCM service worker for background push
├── icon-192.png # PWA icon (192x192)
├── icon-512.png # PWA icon (512x512)
├── index.html # Main app (all HTML/CSS/JS in one file)
├── manifest.webmanifest # PWA manifest
├── reset.html # Cache reset utility for stuck service workers
├── send-reminders.js # Node.js script for sending FCM notifications
└── sw.js # Service worker (caching + notification clicks)
```

## Firebase Collections

| Collection | Purpose |
|---|---|
| `caretracker_entries` | All logged data — meds, temperature, weight |
| `caretracker_prefs` | Small app-preference docs (e.g. `settings.missedClearedAt` — when the caregiver last cleared the missed-dose banner) |
| `fcm_tokens` | Registered device tokens for push notifications |
| `fcm_tracking` | Tracks last-notified timestamps to prevent duplicate alerts |

## Service Worker Strategy

- **Cache name:** read the `CACHE` constant at the top of `sw.js` — it moves with `APP_VERSION` every
  release, so naming a version here only tells you which release last remembered to update this
  line. It had been stuck at `caretracker-v41` for twenty-two releases before the v63 audit
  caught it. Bumping `CACHE` is what forces installed devices to pick up a new build.
- **Static assets (cache-first):** `./`, `index.html`, `manifest.webmanifest`, icons
- **Firebase/API calls (network-first):** `firestore.googleapis.com`, `gstatic.com`, `googleapis.com` — falls back to cache if offline

## Push Notification Reminders

The GitHub Actions workflow (`reminders.yml`) runs `send-reminders.js` every 30 minutes from 8 AM–10 PM CDT. It sends two types of reminders:

**Scheduled (time-based):**
- **8:00 AM** — Protonix morning dose, fixed, independent of Buspirone/Paroxetine
- **Dynamic, or 10:00 AM fallback** — Buspirone, Paroxetine (fires 2h after Protonix's actual logged morning dose — e.g. logged 8:43 AM → fires 10:43 AM — else the static 10 AM window if Protonix hasn't been logged yet)
- **8:00 PM** — Protonix evening dose (window closes 10 PM)
- **10:00 PM** — Evening Meds: Iron, Compazine (dynamic — fires 2h after Protonix's actual evening dose if logged, else the static 10 PM window)

**Gap-based:**
- **Zofran** — checks if 8-hour gap since last dose has elapsed; sends "Zofran Available" notification. Uses `fcm_tracking/zofran_gap` doc to avoid duplicate alerts.

**Quiet hours:** No notifications between 10:05 PM and 8 AM Central (the 10:00 PM evening-meds send is allowed through).

## Tracked Medications

| Medication | Generic | Tracking Type |
|---|---|---|
| Tylenol | Acetaminophen | Daily limit (2500 mg, resets midnight), 4h min gap, 500/1000 mg doses |
| Zofran | Ondansetron | As needed — no gap timer (restricted on chemo days 1–2) |
| Compazine | Prochlorperazine | 6h min gap; 10 PM routine + earlier as needed (in Scheduled Meds card) |
| Morphine | Immediate release | 4h min gap, ½ tab (7.5 mg) / full tab (15 mg) doses |
| Lidocaine | Topical cream | 4h min gap, max 4 applications per day |
| Imodium | Loperamide | Daily pill count limit (4 pills) |
| Protonix | Pantoprazole | Twice daily windows (8 AM–noon, 8–10 PM) + reminders |
| Buspirone | BuSpar | Once daily, with Protonix in the morning (10 AM default — Protonix's typical 8 AM dose time + 2h; shifts to 2h after Protonix's actual morning log if later, open through end of day) |
| Paroxetine | Paxil | Once daily, with Protonix in the morning (same dynamic window as Buspirone) |
| Iron | Ferrous sulfate | Once daily, 10 PM (shifts to 2h after Protonix's actual evening log if later) |
| Senokot | Senna | As needed — 1 or 2 pills, no schedule |
| Dexamethasone | Steroid (chemo premed) | 2 tablets, 8 AM & 2 PM — auto-appears day before chemo through day after only |

## Missed Dose Alerts

Protonix, Buspirone, Paroxetine, and Iron are tracked for missed doses. When one of their schedule windows closes with no dose logged, the app shows a red alert banner at the top of Today (covering today's and yesterday's misses, so an overnight miss is still visible the next morning), a red MISSED row in Today's Journal under the matching time category, and red MISSED rows plus a "N MISSED" day summary in History. Each logged dose covers one window: doses in or before a window count for it, and a late dose (after the window closed, before the next opened) still counts for the window it followed — so a MISSED alert only appears when a window truly got no dose that day. As-needed meds (Senokot, Compazine, Tylenol, Zofran, Morphine, Lidocaine, Imodium) are never flagged. Tracking starts July 12, 2026 — no retroactive flags before that date.

**Clear button (v37+):** The banner has a Clear button. Tapping it writes the current time to `caretracker_prefs/settings.missedClearedAt` in Firestore — every miss with a window-start time at or before that moment is hidden from the banner, permanently (synced live across devices, survives reloads/cache clears). Any window that closes *after* the clear timestamp still alerts normally, so a new miss the next day isn't silently suppressed. This does not affect the Today Journal or History tab, which keep showing MISSED rows as a permanent record — only the top banner is dismissible.

## Chemo Cycle, Menstrual Cycle & In-Patient (v30+)

Set the next chemo date on the Today tab: Dexamethasone appears automatically for its 3-day premed window, Zofran is restricted on chemo days 1–2 (override available), and phased red banners with Zofran-Restricted / Dexamethasone-Due badges run from 2 days before chemo through the day after. The Cycle tab tracks periods (Start/End, day counter, non-dismissible active banner, history). The In-Patient tab tracks hospital stays (Start/End/Undo) — while a stay is open all meds show as Restricted and missed-dose alerts are suppressed. Tylenol and Morphine require a 1–10 pain level before logging.

## Vitals Tracking

- **Temperature** — logged in °F with timestamp
- **Weight** — logged in lbs with timestamp
- Both display last reading time and have dedicated input + "Log" button

## App Views

- **Today** — dose counters (shown only for meds used in the last 7 days), vitals inputs, individual quick-log cards (incl. Protonix and Senokot), a grouped "Morning meds" card for Buspirone/Paroxetine, and a grouped "Evening meds" card for Iron/Compazine — both with a one-tap "Take all" button
- **History** — historical view of logged entries, grouped per day into Overnight (12–6 AM), Morning (6–noon), Afternoon (noon–5 PM), Evening (5 PM–midnight)
- **Weight** — weight tracking over time

## Troubleshooting: "All Blank" / Stale Cache

If the app shows a blank screen on a device:

1. Visit https://arnjnnngs.github.io/care-tracker/reset.html — this automatically unregisters all service workers, clears all caches, and redirects back to the app
2. Or manually: Chrome DevTools → Application → Service Workers → Unregister, then hard refresh
3. On mobile: Settings → Site settings → arnjnnngs.github.io → Clear & reset

When deploying new versions, bump the `CACHE` constant in `sw.js` (currently `caretracker-v40`).

## GitHub Secrets Required

| Secret | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON service account key for firebase-admin (used by `send-reminders.js`) |

## Version History

| v63 | Sep 1, 2026 | **"Take all" really does take them all.** Aaron: *"do fix all first. that has been annoying me for a long time... it would only log 1 of 2 meds or something like that."* He was right, and it was **two** defects in one button plus a third that made it look like a third. **(1) One refused write cancelled every dose behind it.** The `multi` loop awaited `addEntryDB()` with no catch, so the first refusal threw straight out of the loop. Measured against the shipped v62 build with a single medication refused in the middle of five: **1 saved, 4 abandoned.** **(2) And then it said the opposite of the truth.** The banner read *"That didn't save. Nothing was lost — check your connection and log it again."* A dose HAD been saved. A caregiver following that instruction logs it twice, and a dose that appears twice in a medication record is not a cosmetic error. **(3) It also skipped silently.** Excluding a medication that is not due is correct — gap timers and daily ceilings exist precisely to stop that — but the card lists six medications, the button says *Take all (5)*, and nothing ever named the one left behind. From the outside that is indistinguishable from the bug. **Fixed:** each medication is written in its own `try/catch`; the message is assembled from what actually happened (all saved → toast; some saved → a persistent banner naming both sides and saying *not* to re-log the ones already in; none saved → *"None of those saved. Nothing was lost"*, which is the only case where that sentence is true); and a skipped medication is named in the toast. `groupIds` now rides on the time modal so the app knows what the card showed, not just what it logged. **Three wrong diagnoses before the right one, all recorded in the suite.** The first two reproductions seeded the app's own medication ids, which inherit `DEFAULT_MEDS` flags through `backfillDefaultMedFlags` — including `groupedMorning` — so the same medication rendered on **both** the Morning and Evening cards and a document-wide button search tapped the wrong one. I also wrongly suspected the once-a-second re-render, and killed that hypothesis by disabling the tick and watching the behaviour not change. **And one of my own checks could not fail:** the skipped-medication assertion was written as *`!/not due/.test(toast) || /not due yet/.test(toast)`*, which a toast that never mentions it at all satisfies — it passed against the broken build. Rewritten as a positive assertion. **The audit then refused this release on three findings, and the worst was in the test.** The auditor swapped only which name list goes where in the banner, so it named the **refused** medication as saved and the three saved ones as failed — telling the caregiver to re-log three doses already in the record, which is precisely the harm this release exists to stop — and **the suite stayed 19/19 green**, because it only asked whether the names appeared *anywhere* in the sentence. It now splits the banner and checks each name on the correct side. Second: *"it says which one was skipped"* was only true when nothing failed — `skippedNames` was used solely in the all-saved branch, so the silent skip survived in exactly the failure case the release is about, while the notice a patient reads claimed it unqualified. Third, and introduced by my own fix: the Iron + Protonix advisory was gated on *"something saved AND iron was attempted"* rather than *"iron saved"*, so it could warn about the timing of a dose that had just been refused. All three fixed, plus a stale failure banner that survived a successful retry still saying "log them again". **And three of my own checks could not fire**, each for a fixture reason now written into the suite header: the skipped-medication check leaned on the app's Iron being outside its window, making it wall-clock dependent; the advisory check needed a nearby Protonix entry that the fixture never seeded; and even then Iron was never *attempted*, because its default window leaves it not due for most of the day. Gates: **`harness/takeall-test.mjs` 25/25, and 17 passed / 8 red against the live v62 build**, failing on every one of the right checks. All three auditor sabotages go red: the name swap 22/25, the skip dropped from failure paths 24/25, the advisory gate reverted 24/25. `whatsnew-test` 30/30; `missed-banner` 16/16; `settings` 11/11; `para` 16/16; `eod` 11/11; `logger` 19/19; `overflow-scan` **80/80 CLEAN** with the notice re-read at 320px after the copy was shortened (`outputs/RENDER-v63.md`). `APP_VERSION` → `v63`, `sw.js` CACHE → `caretracker-v63`. |
| v62 | Sep 1, 2026 | **The update notice could never fire on the release that introduced it.** Aaron, the next morning: *"I did notice that caretracker didn't do a popup when it opened with features."* He was right, and the cause is a design error rather than a bug. v61's rule was: a phone with no record of a last-seen version is a brand-new install, so stay quiet — greeting a first-time user with a list of changes is meaningless and in the way. Sound in general. But **that record was introduced in v61**, so every phone that already had CareTracker had no record on its first v61 open, took the brand-new branch, was silently stamped `v61`, and was shown nothing. The one release where the notice was guaranteed not to appear is the release that added it. **The test could not have caught it.** `harness/whatsnew-test.mjs` asserts *"a fresh install is NOT greeted with an update notice"* and passed 23/23 throughout. It pinned exactly what I intended; the intent was wrong for the changeover, and **a check that confirms your intent cannot tell you your intent is wrong.** **The fix.** A read-only snapshot taken at the very top of the module — before any other start-up code writes its own keys, or the snapshot cannot tell "this phone has history" from "this phone made a key a moment ago" — records whether the phone already holds any other `caretracker-*` key. With that, a missing seen-version means *this phone upgraded across the change*, not *this phone is new*, and the notice is shown. A genuinely new phone, with no CareTracker data at all, is still left alone. **This is not only about v61.** Any phone that SKIPS a release — sitting on a cached old build, then jumping two versions — hits the identical thing, and would have kept hitting it. That case is now its own named section in the suite (8), which is where the v61 miss would have been caught. **Falsification, including the one that proved nothing.** Reverting to the v61 rule goes red; forcing the snapshot to always answer "no" (what a snapshot taken too late looks like) goes red. A third sabotage — counting the seen-version key itself as evidence — left the suite at 28/28, because the snapshot runs before that key is ever written, so on the only path reaching this branch the key is absent either way. That exclusion is defensive, not load-bearing, and it is recorded as such in the code rather than counted as a passing check. **The audit found the new section was guarding the wrong key, and it was my comment that was wrong.** It seeded a saved medication list and called that *"the one every returning phone realistically has"*. Measured, it is not: a start-up writes only `caretracker-seen-version` and `caretracker-device-id-v1`, and the medication config is written **only when somebody edits the medication list**. So a phone that has run for weeks without touching its meds carries a device id and no config — and two sabotages that break the fix for exactly that phone both stayed **28/28 green**. The guard was hollow for the case it existed to protect. It now seeds each key separately and both sabotages go red. **Known, and new in this release (LOW):** on a phone whose storage can be read but not written — quota-full, or read-only — the notice reappears on every open, because the version can never be stamped. No data is at risk; recorded in STATUS.md rather than fixed here. Suites: `whatsnew-test` **30/30**; `missed-banner` 16/16; `settings` 11/11; `para` 16/16; `eod` 11/11; `logger` 19/19; `overflow-scan` CLEAN. `APP_VERSION` → `v62`, `sw.js` CACHE → `caretracker-v62`. |
| v61 | Aug 31, 2026 | **You can see what changed.** Aaron: *"I wanted a section on caretracker under the ellipsis for latest updates or versioning. I also want something with a pop up when opening the app to say what new on the latest release."* A **What's new** page under the menu listing every release from v13, newest first, naming the version that phone runs; and a **notice on opening after an update** showing the newest release only. A fresh install gets no notice — the version is recorded silently, because with nothing stored the app cannot tell a new phone from one that has run for weeks. Per phone, not per person: two phones share this record, but "have I read this" is a fact about the phone in your hand. Armed once at start-up and painted only once loaded, so it never covers "Connecting…". The history is reconstructed from this file (v13–v43.3, v56–v61) and `STATUS.md` (v44–v55), and every entry is paired to its source in `outputs/CHANGELOG-SOURCES.md` — that file exists because "all entries were re-checked" was claimed twice and both times a reviewer found more errors within half an hour. **Eleven wrong entries were found across three review rounds**, all written from headline extraction rather than from reading the release; the last was introduced while correcting another entry in the same commit. Also fixed here, both pre-existing: the missed-dose banner's **Clear button was 30px** against the 44px iOS floor, live since v60; and `cal-test`'s drawer tap-target gate had been **dark since v58** (pinned to 6 menu items when there are 9, so it threw before the 44px loop it is named after). `APP_VERSION` → `v61`, `sw.js` CACHE → `caretracker-v61`. Gates: `harness/whatsnew-test.mjs` **23/23** reading the rendered DOM and real browser storage, falsified six ways; `para-test` 16/16; `missed-banner-test` 16/16; `cal-test` 69/70; render scan **80 of 80** combinations across ten widths. |
| v60 | Aug 26, 2026 | **In-patient stays, and the Dexamethasone alarm that ran for three weeks.** Aaron reported that ending a hospital stay produced a wall of missed doses. It was **three separate defects**, and the in-patient logic was only one of them. **(1) Every line in that banner was Dexamethasone, twice a day, since 4 Aug.** `chemoOnly` — the flag marking a medication as taken only around treatment — was added to `DEFAULT_MEDS` *after* her device had saved its own medication list, and nothing ever backfilled a new property onto an already-saved medication (`mergeMissingDefaultMeds()` adds missing MEDS, not missing PROPERTIES, and `normalizeMedication()` then froze the absent flag to `false` forever). A chemo-only steroid was therefore tracked as an everyday medication — against the hardcoded 8 AM / 2 PM schedule its id gets in the dose logic. `backfillDefaultMedFlags()` now fills in any property a saved medication has never heard of, **absent-only**: an explicit `false` is the caregiver's choice and is never overwritten. **(2) The wrong chemo date was used for every day in history.** `chemoOffsetFor()` measured from the most recently *entered* chemo date rather than the one nearest the day being asked about, so logging a past treatment after a future one shifted the entire timeline. Her 4 Aug is **one day after** the 3 Aug treatment — a day that expects a **Morning dose only**, which she logged at 10:30 — but it measured as 20 days out. Duplicate chemo dates (her record has two for 24 Aug) now collapse to one treatment day. **(3) A half-day stay had no correct answer.** Suppression was all-or-nothing per calendar day, and every medication card became an unloggable *In-Patient (Restricted)* tile for the duration. Aaron: *"they gave the Dex during the morning, but in the evening I had to end in patient bc I couldn't enter the Dex for the evening."* Leave the stay open and the evening dose she took at home is invisible; end it early to log it and the hospital's morning doses are flagged missed — **the app required a false record either way**. Suppression is now decided **per dose window** (the hospital's if she was admitted at the moment that window opened), and **medications stay fully loggable during a stay** — the banner still makes the stay unmistakable. *Take all* is restored for the same reason. **Also:** the *Chemo-day only* toggle described itself as controlling Home visibility while it silently also gated missed-dose alerts — which is very likely why it was left off. It now says so. **No data was migrated or rewritten; her 530 records are untouched.** `APP_VERSION` → `v60`, `sw.js` CACHE → `caretracker-v60`. Gates: `harness/inpatient-window-test.mjs` 10/10, `harness/medflag-backfill-test.mjs` 9/9, `harness/chemo-offset-test.mjs` 9/9 — **all three falsified against the pre-fix code**, and the chemo suite runs on her real chemo dates and asserts the exact line from her screenshot is gone. |
| v59 | Aug 24, 2026 | **One spelling for "liter".** Aaron: *"for the para.. is it supposed to be 'Litres' or Liters?"* It was both — every identifier used the American spelling while four user-facing strings used the British one, in an app whose patient and oncology team are American. Normalised to **liters**; no identifier touched. The gate asserts it **by absence against the shipped bytes** rather than against a screen. `harness/para-test.mjs` 16/16, falsified against v58. **The units question, answered rather than built:** paracentesis needs no unit picker — liters is the standard unit in every country. What is missing is a units picker at all, and there is a hazard behind it: `CONFIG.tempUnit` exists and `tempFever()`/`tempHigh()` already switch thresholds on it, but a reading is stored as `{temp: 98.6, dose: '98.6 °F'}` — the unit lives only in a display string, so exposing a picker today would re-read every historical reading in the new unit. Logged in REQUESTS.md, not built. `sw.js` cache `caretracker-v58` → `caretracker-v59`. |
| v58 | Aug 24, 2026 | **Settings exists, and the backup lives in it.** Aaron: *"all the backup stuff shouldn't live under reports. it should be under settings. and i don't even see a settings tab anymore in caretracker."* Right twice — there has never **been** a Settings screen in this app; the backup landed under Reports in v43.1 because that is where "save a copy" was built. **Reports keeps the two documents** — the spreadsheet and the printable record, both of which exist to be read or handed to a doctor and neither of which can be loaded back. **Settings gets everything that manages the data**: the backup, its password switch, putting one back, and sharing this tracker with another caregiver — plus a route to *Report a problem* and an About block naming the build and stating that, with no sign-in, the address itself is what grants access. One function renders both cards, so the counts and button behaviour cannot drift apart. **The half that matters:** someone who has tapped that backup button weekly for months will go to Reports looking for it, so Reports carries *"Looking for the backup? It moved to Settings"* and a one-tap route there — a move without that is a disappearance, and the thing that disappeared is the only copy of a patient's record. Drawer only, not a sixth bottom-nav tab: that grid is hardcoded to five and silently overflows. `harness/settings-test.mjs` 11/11, falsified against v57 at 8 red. Four suites were repointed at Settings; a fifth, `logger-test`, had pinned the literal `'v57'` — the exact anti-pattern Rule 5 forbids — and now reads the version from the file under test. `sw.js` cache `caretracker-v57` → `caretracker-v58`. |
| v57 | Aug 22, 2026 | **The app writes down its own errors, and there is a place to add yours.** Aaron: *"we were also going to build in a logger for errors or improvements."* A **Report a problem** row, last in the menu. Three things in the order they are needed: say what happened (*Something's wrong* / *An idea* — both, not only crashes), see what the app noticed by itself, take the lot away as one plain-text file. Passive `error` and `unhandledrejection` listeners record faults as they happen; the second matters more here, because almost every failure in this app is inside an `await` against Firestore where `window.onerror` never fires. Neither handler `preventDefault()`s — the gate asserts a thrown error is still thrown. **Kept in localStorage, never in Firestore**: that collection is her medical record under append-only rules, and a stack trace written there cannot be cleaned up. Repeats collapse to one counted entry; the list is capped; a full phone does not turn an error into a broken screen. Trimming drops the oldest **errors** first and takes what the person wrote last — a straight ring buffer let a flood of errors evict her own description of the fault she was reporting. The file carries version, device and the log, and no dose, temperature, weight, symptom or appointment. `harness/logger-test.mjs` 19/19, falsified against v55 at 16 red. `sw.js` cache `caretracker-v56` → `caretracker-v57`. |
| v56 | Aug 22, 2026 | **A backup file can be protected with a password before it is sent.** Aaron, twice: *"build the encryption part."* The link is already the sharing story for a caregiver trusted with everything; the backup **file** is the one that gets emailed and then sits wherever it lands, and it was plain text. A switch under the three save buttons, off by default. On, the file is **AES-256-GCM** under a key derived with **PBKDF2-SHA256 at 310,000 rounds** through `crypto.subtle` — no library, no server. A locked file names **nothing** about its contents until it opens, because a manifest there leaks what the password protects; the patient's name is inside the ciphertext and the file is called `backup-protected-<date>.json`. Fails closed on a wrong password (document ids compared before and after), on one flipped byte of ciphertext, on an iteration count read out of a file (bounded, not trusted — a hostile `900000000` is refused in milliseconds), and on a file that decrypts perfectly but is not a backup. Plain files stay at `formatVersion: 1` so a phone on v55 can still read them; protected files are written at **2**, so v55 says *"update first"* rather than reporting the backup empty. **No recovery path, by design** — the password is never stored, never transmitted, and not derivable from the file. `harness/encbackup-test.mjs` 16/16, falsified against v55 at 13 red. `sw.js` cache `caretracker-v55` → `caretracker-v56`. |
| v43.3 | Aug 16, 2026 | **Three defects fixed that were live on the patient's phone, all one root cause in the renderer.** `h()` routed `value` through `setAttribute`, which sets the DEFAULT value rather than the current one. On a `<textarea>` it is ignored entirely; on a `<select>` it does nothing at all, because selection is carried by `<option selected>`; on an `<input>` it goes stale as soon as the value is edited. `h()` now sets **both** the attribute and, deferred until after children exist (a `<select>` has no options to choose from at attribute time), the **property** — which is what actually holds a current value. Belt-and-braces: nothing relying on the HTML default changes. **What this fixes, all reported by the patient-facing screens rather than by a unit test:** the Home **appetite** card silently reset its dropdown and wiped its reason box about a second after being filled in; the **symptom logger** snapped its dropdown back to blank when a symptom was chosen, wiped any note typed beforehand, and showed an existing symptom's note as empty; and the **medication editor displayed the wrong schedule type** — Protonix shown as *As needed / gap-based* when it is a *Scheduled window* medication. That last one is the serious one: anyone who saw the wrong value and 'corrected' it would have converted a scheduled medication to as-needed and **silently switched off its missed-dose alerts**. In all three the underlying data was intact and saving worked correctly — the screen was contradicting what had just been entered, which for a patient in active chemotherapy reads as the app losing her entry and invites her to enter it twice. Proved by `harness/live-bugs.mjs`, which runs every check against this build **and against the currently-live build**, so each fix is demonstrated as a measured difference rather than asserted: **12 checks, all passing**, including that the live build genuinely fails each one. `sw.js` cache bumped `caretracker-v43-2` -> `caretracker-v43-3`. No change to the medication engine, the entry schema, Firestore, or any screen's behaviour beyond showing the truth. |
| v43.2 | Aug 16, 2026 | **Missed-dose alerts: a late dose no longer raises a false alarm on the window it was late for, and no longer silences the next one.** `missedDosesFor` claimed windows in two passes -- pass 1 offered EVERY window any unused dose logged before that window's CLOSE, pass 2 then handled late catch-ups. The split was the defect: a later window could claim a dose that was really a late catch-up for an earlier one. On Brandi's real Protonix schedule (Morning 8-12, Evening 20-22) a dose logged at 1 PM failed the Morning test (1 PM is not before noon) but passed the Evening test (1 PM is before 10 PM), so **Evening took it**. Two things went wrong at once: **Morning showed a red MISSED alert for a dose that was actually taken**, and **Evening was marked covered, so a genuinely skipped 8 PM dose raised no alert at all.** The silent half is the dangerous one -- an adherence tracker that goes quiet is worse than not having one, because the silence is trusted. Dexamethasone's 8 AM / 2 PM chemo-day pair failed identically. Replaced with a single pass processed strictly in window order, so each window gets first claim over any unused dose logged before the NEXT window opens: Morning is offered the 1 PM dose first and takes it, leaving Evening genuinely uncovered. This is the same logic as `chemowell-beta`, where it was fixed in v68 after Aaron reported that a late-logged dose could still show as missed; it was never carried across to production. One function, nothing else in the release. Verified by a harness that EXTRACTS the function and the medication windows from the shipping file at run time rather than re-typing them, so the test cannot drift from the code: **39 checks, all passing**, including the reported failure on the real Protonix and Dexamethasone schedules, and mutation checks that reconstruct the old two-pass logic and confirm it fails the two defect assertions -- so those assertions are proven able to fail. **Recorded, deliberately NOT changed:** a window still accepts any unused dose logged before its cutoff with no lower bound, so two doses logged in the same morning leave the second available to satisfy the Evening window. Same shape as the defect above, but pre-existing and unchanged by this release (assertion R7 proves the old logic behaves identically). Fixing it means deciding how early a dose may be and still count for a window -- a design decision, not a bug fix, and it would diverge from the implementation proven in `chemowell-beta`. **Amended after audit.** The first attempt at this fix let the earlier window claim the ENTIRE dead gap between windows, which fixed the 1 PM case and broke the 7 PM case in exactly the same way, mirrored: a dose taken an hour before the evening dose was due would be credited to Morning, raising a false Evening alert and silently suppressing a genuinely skipped Morning dose. Measured exposure was four hours a day (16:00-19:59) where it was strictly worse than v43.1. The gap is now **split at its midpoint** -- a dose is credited to whichever window it is nearer, so on Protonix 1 PM is a late Morning dose and 7 PM is an early Evening one. The audit also found two further defects in that first attempt, both introduced by the same root cause and both absent from v43.1: with OVERLAPPING windows a dose logged inside a window failed to cover it, and with windows listed OUT OF ORDER an on-time dose flagged its own window as missed. The medication editor validates only that end > start, so neither case is unreachable. Fixed by sorting windows defensively and clamping the cutoff so an overlapping next window can never cut the current one short. `sw.js` cache bumped `caretracker-v43-1` -> `caretracker-v43-2`. No change to the entry schema, the medication engine, Firestore, or any daily screen beyond the alert accuracy itself. |
| v43.1 | Aug 15, 2026 | **Save a copy of your records — a spreadsheet export and a printable report. The first backup this app has ever had.** Brandi's records live in one Firestore project with no copy anywhere; that is why this was built ahead of everything else on the list. Handing a printed record to an oncologist is the secondary purpose. **Strictly read-only, proven three ways.** WEB-MAIN has exactly four mutation mechanisms (`addEntryDB`, `removeEntryDB`, `setDoc`, `persistMedicationConfig`), all named functions with no dynamic dispatch, so "this feature cannot write" is mechanically checkable with a grep over the inserted block. The offline harness proves it twice more, by recording attempted Firestore writes AND attempted localStorage writes and asserting both recordings stay empty, and by reading the live `state.entries` / `state.chemoDates` arrays before and after to prove nothing was reordered in place. Each of the three is verified by injecting the corresponding write and confirming the suite goes red. **Reached from Reports**, as a card rather than a sixth bottom-nav tab (`renderBottomNav` hardcodes a five-column grid; a sixth item silently overflows it), and deliberately not added to the `reportTypes` array, whose dispatch ends in a bare `else renderAppetite(now)` and would have quietly rendered the wrong report. The card leads the screen rather than trailing the five browse buttons — below them it was 3–22% visible above the fixed nav on every phone size. **CSV columns:** Date, Time, Timestamp (ISO-8601), Time of day, Type, Med ID, Detail, Amount (mg), Note, Source, Entry ID, Logged at. `Med ID` carries the raw id unmodified on every row, which is what makes the file device-independent — display names depend on the medication list configured on the device that exported it. `Logged at` exists because a row with no event time blanks its four date columns, and without it the backup could no longer say when a chemo date was cleared. Logged rows lead the file and derived rows follow, so the backup does not open on forty consecutive "not logged" rows. **Chemo dates are included**, unlike the phone app's exporter which filters them out as internal scheduling state: they are real documents and they are the calendar the whole app pivots on, so excluding them from the only backup means the treatment schedule is the one thing that cannot be restored. **Missed doses are included and marked `derived`**, because they are not documents — `missedDosesFor()` computes them at render time from the schedule configured on *this* device, so two devices produce different sets from identical data. The `Source` column keeps the file honest about which rows are facts and which are inferences. A derived row takes its Time-of-day from the medication window it was inferred from rather than the clock bucket its timestamp lands in; those disagreed on 32 rows of a single export. **Spreadsheet safety:** UTF-8 BOM so Excel reads °F correctly, RFC-4180 quoting, and a leading apostrophe on any field starting `=`, `+`, `-` or `@`, applied before quote-wrapping so it lands inside the quotes where Excel actually reads it. **The printable report** leads with the daily log — what she actually took and how she felt. The calculated "scheduled doses with nothing logged" section follows it, is chipped *calculated* rather than *derived*, is set at normal weight in `#5B4A53` rather than bold red, and carries a body-size sentence stating plainly that these are not confirmed missed doses. With nothing logged the section is not emitted at all and the period reads `—`. Each day's date lives inside its own table `thead`, so it repeats on every page that day spans; `@page` margin boxes carry a running *name · treatment record · page N of M* and the patient-logged disclaimer on every page. Raw database keys never reach it: `nameOf` gained a `chemo_date` case, and a report-only `reportNameOf` resolves membership against the medication list explicitly and renders anything unresolvable as *Medication (removed)*. **Six review findings fixed before this shipped, none of which a unit test would have found:** a zero-document account produced a document whose entire body was a bold red table reading "166 scheduled doses with nothing logged" beside an ENTRIES tile reading 0; both day-walking loops advanced by a flat 24 hours against a `dayStart()` that returns local midnight, so from 2 Nov the current day was dropped from every backup and 1 Nov was emitted twice, permanently, every year; the reporting period was computed from inferred rows and pinned to `MISSED_TRACK_SINCE` regardless of what was recorded; page 2 onward carried no date, patient name or page number; the busy state completed inside one synchronous task and was painted in 0 of 70 sampled frames; and a failed export showed the patient a raw browser string such as *The operation is insecure.* **Three more were introduced by those fixes and caught by the Lead gates:** the card meta line rendered *Invalid Date* and read a scheduled appointment as "last logged"; `reportNameOf` guessed from whether an id contained a hyphen and was wrong in both directions, printing a raw key for `ativan` and labelling the active drug `5-fu` as removed; and a contrast "fix" claimed 3.6:1 for a colour producing 3.23:1 while stacking opacity took the empty state to 1.81:1, worse than the 1.95:1 it replaced. **One more was caught only by auditing the shipping bytes:** `reportNameOf` had been applied to Today's Journal and the History report, where medication config is device-local localStorage but entries sync from Firestore — so on a new phone every user-added medication, including ones she is actively taking, would have rendered as *Medication (removed)*, with two different drugs collapsing to one label and no id column to tell them apart. Those screens use `nameOf`. **Verified by an offline harness that starts its own server on an OS-assigned port, routes all three Firebase module URLs to a credential-free stub, blocks the service worker, pins the clock, and proves by md5 that the bytes under test are the shipping file.** 123 checks pass, and every one has been mutation-tested — 48 defects deliberately reintroduced, all 48 caught. `sw.js` cache bumped to `caretracker-v43-1`; `index.html` gained an `APP_VERSION` constant it previously did not carry. **Production Firestore untouched — this release cannot write to it.** |
| v42 | Jul 22, 2026 | **Full promotion from care-tracker-testing** — production brought up to date with everything validated during the 30-use-case QA pass on the testing app, per Aaron's go-ahead ("this is the main big push for all features"). New features: Tylenol Liquid (oral suspension) tracking with its own daily mg ceiling; Appetite tracking (Home alert + Reports history, same pattern as Bowel Movement); Bowel Movement daily card + dedicated Symptoms tab (Nausea/Vomiting/Other, notes required for Other); full medication editor (add/edit/delete/archive + manual reorder and A-Z sort on the Meds tab); Morphine's old flat "last dose + 4h gap" lockout replaced by a rolling 4-hour / 15 mg cumulative-ceiling model (a lone 7.5 mg half dose no longer triggers a full lockout), generalized into a reusable ceiling-group mechanism now also used for other ceiling meds. Bug fixes carried over: corrected Zofran chemo-block window (confirmed-correct 3-day block — chemo day plus the 2 following days); stale date-label bug (`fmtDateLabel` now uses app time consistently); orphaned "Active" Cycle/In-Patient period bug when a second Start was logged before an End was cleared; service-worker update lag (page now proactively calls `reg.update()` and reloads once on `controllerchange`, so a push no longer needs multiple reloads to take effect) — `sw.js` cache bumped to `caretracker-v42`. `mergeMissingDefaultMeds` ensures existing devices automatically pick up the new default meds (Tylenol Liquid) without disturbing any of Aaron's existing customizations or previously-archived meds. Testing-only scaffolding (TEST_MODE flag and every branch gated by it, orange TESTING badge/banner, date-override control, testing-specific collection names and localStorage key) fully removed, not just disabled, matching the standard promotion pattern. Verified against 12 mocked-Firestore regression suites (~208 checks, all passing) before push; production Firestore data untouched by this change (code-only promotion) |
| v41 | Jul 20, 2026 | **Correction to v40's Buspirone/Paroxetine default window**, per Aaron's direct feedback: the "no Protonix log yet" default is now a fixed 10 AM (Protonix's typical 8 AM dose time + 2h, mirroring Iron's 10 PM default exactly) instead of the 8 AM–noon range v40 used. `send-reminders.js` also fully decoupled — Protonix's own fixed 8 AM push (tag `morning-meds`) is now independent of Buspirone/Paroxetine's push (tag `morning-meds-buspar`, dynamic-or-10am-fallback), matching Aaron's exact example (Protonix logged 8:43 AM → Buspirone/Paroxetine available 10:43 AM). Cache bumped to `caretracker-v41` |
| v40 | Jul 20, 2026 | **Buspirone/Paroxetine moved from the 10 PM evening window to a new Morning window with Protonix** (default 8 AM–noon, matching Protonix's own morning window; shifts to 2h after Protonix's actual logged morning dose if that's later, staying open through end of day — mirrors the existing evening dynamic-window pattern). New "Morning meds" grouped Home card (Buspirone, Paroxetine) alongside the existing "Evening meds" card, now just Iron/Compazine. Medication editor gets a "Group with morning meds" toggle. `send-reminders.js` updated to match: the 8:30 AM push now covers Protonix + Buspirone + Paroxetine (with a dynamic follow-up if Protonix's actual log shifts the window later), and the evening push text dropped Buspirone/Paroxetine (now just "Iron, Compazine"). Also restores `sw.js` and `CARETRACKER_HANDOFF.md`, both of which were accidentally overwritten to the literal text "undefined" in v39 — see CARETRACKER_HANDOFF.md Known Issues section |
| v39 | Jul 20, 2026 | ~~Intended: SW cache bump + handoff doc update.~~ **This commit corrupted `sw.js` and `CARETRACKER_HANDOFF.md` to the literal 9-byte string "undefined"** — a paste-gone-wrong via GitHub's inline web editor (the same failure mode previously seen once in care-tracker-testing). `index.html` was unaffected. Fixed in v40 by restoring both files from the last-known-good commit (v38) and re-adding the content that v39 intended to add. See CARETRACKER_HANDOFF.md Known Issues section for the full incident and the standing rule this reinforces (never edit `index.html`/`sw.js` via GitHub's web editor — always push a real file diff) |
| v38 | Jul 19, 2026 | SW cache bump only (`caretracker-v37` → `caretracker-v38`), no functional change |
| v37 | Jul 19, 2026 | Missed-dose banner gets a persistent **Clear** button. Tapping it writes `caretracker_prefs/settings.missedClearedAt` (a synced Firestore doc, read via `onSnapshot` at startup like everything else) — every existing miss with a window-start time at or before that moment is hidden from the banner. Unlike a plain in-memory dismiss, this survives page reloads and syncs across every device instantly. A new miss occurring after the clear timestamp still alerts normally. Only the Today banner is affected — the Journal and History tabs keep every MISSED row as a permanent record |
| — | Jul 19, 2026 | `send-reminders.js`: dropped the compound `medId + ts` Firestore query in the Protonix evening-dose lookup (no composite index was configured for it, which would throw) in favor of a single-field `medId` query with the date-range check done in JS; wrapped in try/catch so a Firestore hiccup falls back to the static 10 PM reminder window instead of silently dropping the evening-meds notification |
| v36 | Jul 19, 2026 | Fixed the redundant "Available"/"Available now" text on Quick Log cards (the next-dose line is now only shown while a med is locked). Replaced `window.scrollTo({behavior:'smooth'})` with an instant scroll on tab/editor navigation — the smooth-scroll animation was visibly janky on some devices. Extended the 1-second re-render pause guard from just `INPUT` to also cover `SELECT` and `TEXTAREA` elements, so picking a dropdown option or typing in a textarea (e.g. the medication editor's note field) can no longer get wiped mid-interaction by the periodic tick |
| — | Jul 19, 2026 | `send-reminders.js`: evening-meds reminder (Iron/Buspirone/Paroxetine) now mirrors the app's dynamic Protonix+2h window — fires 2 hours after Protonix's actual logged evening dose that day instead of a fixed 10 PM, falling back to the static 9:55–10:05 PM window if Protonix hasn't been logged yet |
| v35 | Jul 19, 2026 | Promoted a redesigned Quick Log status-badge treatment and further chemo/Dex polish from testing. Simplified `status()`'s Dexamethasone course-complete handling by removing the `lateLog` exception added in v34 (a completed course now locks cleanly instead of allowing one more late log). Missed-dose banner changed from auto-expiring to staying up until the dose is actually logged (this is the behavior that later made a manual Clear button necessary — see v37). Testing-only scaffolding (date-override control, TEST_MODE gating) was stripped before promotion, matching the standard promotion pattern used for v30 |
| v34 | Jul 18, 2026 | Fixed Dexamethasone/Zofran chemo-window logic: Zofran restriction widened from chemo days 0–1 to 0–2 (`zofranBlockedOn`), and Dexamethasone's final premed day now correctly shows an 8 AM-only window via a new `dexWindowsForOffset()` helper instead of the default 8 AM & 2 PM. Added a `courseComplete` status so a finished Dex course shows "Course complete" and drops off Quick Log instead of re-locking with a countdown. The chemo-blocked Zofran card now gets a consistent red "Restricted" tint/badge (previously plain "Chemo" text with no card styling), and the chemo banner's day-after-chemo copy was corrected to say Zofran remains restricted through the next day |
| v33 | Jul 18, 2026 | Senokot converted to plain as-needed: schedule windows (8 AM & 10 PM) removed, quick-log now offers 1 pill or 2 pills |
| v32 | Jul 18, 2026 | Fix false MISSED alert when a dose was logged the same day: dose-to-window assignment is now two-pass — in-window/early doses first, then late doses (after a window closed, before the next opened) credit the window they follow. Two logged doses on a two-window day can no longer produce a MISSED row (was: an at/after-window-edge dose like 6:00 PM credited nothing). A genuinely skipped window still alerts. Early tag now only applies to doses logged before the day's first window — after-window doses are late, not Early |
| v31 | Jul 18, 2026 | Evening push reminders split to match app windows: Protonix nudge stays at 8:00 PM (its window closes 10 PM), Iron/Buspirone/Paroxetine/Compazine reminder moved to 10:00 PM. Quiet hours now start 10:05 PM so the 10 PM send goes through; workflow cron extended (0–4 UTC) so the 10 PM run is covered in winter (CST) too. Resolves the v30 known mismatch. App code unchanged; SW cache bumped per standard workflow |
| v30 | Jul 17, 2026 | Promote tested features from care-tracker-testing (t-v28–v33): chemo cycle system (chemo date scheduling, auto-appearing Dexamethasone 2 tablets 8 AM & 2 PM day −1..+1, Zofran restricted on chemo days 1–2 with override, phased banners + Zofran-Restricted / Dexamethasone-Due badges); menstrual Cycle tab (Period Start/End, day counter, active banner, history); In-Patient tracking (Start/End/Undo, active banner, meds shown as Restricted, missed-dose alerts suppressed on in-patient days, In-Patient tab with stay ranges); 1–10 pain scale required on Tylenol & Morphine logs (shown in Journal/History); Zofran converted to plain as-needed (no 8h gap timer; gap-based push reminder removed from send-reminders.js); Temperature/Weight inputs use placeholders, must be typed. Testing-only code stripped (TEST_MODE flag, orange banner, date-override control, seedDemo remains removed). Code-only promotion — production Firestore data untouched (verified by before/after ID snapshot) |
| v29 | Jul 17, 2026 | Re-enable the 48-hour edit-lock check in removeBtn(), reverting a Jul 16 temporary unlock that had allowed manual deletion of fake seedDemo() entries dated 7/6-7/7 (otherwise locked from removal after 48h) |
| v28 | Jul 17, 2026 | Data-integrity fix. Removed the dormant seedDemo() function entirely, along with the demo state flag, its banner UI, and the wasEmpty-triggered auto-seed call in the Firestore subscription callback, which had silently written hardcoded fake medication entries into caretracker_entries (Brandi's real medical data) whenever the app's first Firestore snapshot came back empty. All fake entries identified and deleted from Firestore; see Known Issues section below for full incident details |
| v27 | Jul 13, 2026 | Missed-dose banner also shows yesterday's misses (overnight rollover fix) |
| v26 | Jul 12, 2026 | Missed-dose alert system: red banner + journal/history MISSED rows for Protonix, Buspirone, Paroxetine, Iron |
| v25 | Jul 12, 2026 | New time-of-day categories in Today's Journal and History: Overnight 12–6 AM, Morning 6–noon, Afternoon noon–5 PM, Evening 5 PM–midnight |
| v24 | Jul 12, 2026 | Layout: Protonix and Senokot get individual cards; group card renamed "Evening meds" (Buspirone, Paroxetine, Iron, Compazine) |
| v23 | Jul 12, 2026 | Add Senokot (senna): 2 pills, 8 AM & 10 PM windows, as needed; scheduled-card and Take-all logs now record each med's default dose |
| v22 | Jul 12, 2026 | Block dose buttons that would exceed remaining daily limit; Buspirone/Paroxetine/Iron 10 PM windows; Compazine joins Scheduled Meds card; "Take all" one-tap logging; Early tag now based on logged time, not click time |
| v21 | Jul 11, 2026 | Tylenol ceiling 2500 mg; Protonix windows 8 AM/8 PM; future-time log warning; delete confirmation + 48h delete window; grouped Scheduled Meds card; conditional counters + Lidocaine counter; WCAG AA contrast pass (pink theme kept) |
| v20 | Jul 11, 2026 | Add Lidocaine topical cream (4h gap, max 4 applications/day); generalize daily-count ceiling; doc corrections |
| v19 | Jul 7, 2026 | Remove "Clear all" buttons, preserve history |
| v18 | Jul 2, 2026 | Add FCM push notifications + firebase-messaging-sw.js |
| v17 | Jul 2, 2026 | Remove Tylenol/Morphine/Imodium from reminders |
| v16 | Jul 2, 2026 | Add med reminder notifications |
| v15 | Jul 2, 2026 | Light pink glassmorphism theme + fix sticky tabs |
| v14 | Jul 1, 2026 | Fix input focus loss on mobile during render cycle |
| v13 | Jul 1, 2026 | Bump SW cache to force refresh on all devices |

## Maintaining This Documentation

**When making changes to CareTracker, update these docs in the same commit:**

- **README.md** (this file) — Update the Version History table, and revise any sections affected by the change (e.g., if you add a new medication, update the Tracked Medications table; if you change the service worker cache strategy, update that section).
- **CARETRACKER_HANDOFF.md** — Update the "Last updated" date at the top, add the new version to the Version History table, and revise any affected sections (medication definitions, Firebase collections, reminder schedule, known issues, etc.).

Both files live in the repo root and serve as the single source of truth for onboarding new contributors or AI agents.

- **v60 (in progress) — one shared clamp for treatment windows.** Four places in `index.html` answered
  "how many days is this window?" and two of them were hand-inlined copies of the rule that tested
  `Number.isFinite()` on values coming from a text field — where `"3"` is a string and the test is
  false. The visible symptom was a blank box: the medication editor read an empty field as a
  deliberate 0 and printed **"Treatment day only"**, while saving that same blank box fell back to
  1 day either side. The label promised a window the app did not obey. Everything now goes through
  `clampTreatmentDays()` (0–14, blank → 1), so the editor, the badge, the save path and the logic
  cannot disagree. Ported from the same fix in ChemoWell app-v68.

- **v60 (in progress) — text spilling outside its box on Home, and the scan that could not see it.**
  The Quick Log card's generic-name line ("Acetaminophen · Oral suspension") was held on a single
  line by `white-space: nowrap`. At 320px it ran 57px past the edge of its card, 17px at 360px — the
  most common Android width — and 2px at 375px. It now wraps under the medication name instead of
  being truncated: that line is what tells a caregiver which drug this actually is, so an ellipsis
  would cost more than it saves.

  This was live, and the first render scan reported the app clean anyway. Its overflow test asked
  `scrollWidth > clientWidth`, which is always 0 for an inline element — meaning for nearly every
  piece of text in the app — plus "did it leave the viewport", which text spilling a card in the
  middle of the screen never does. The Zero Day Auditor proved the same blindness in ChemoWell by
  deleting a layout fix and watching the scan stay green. The scan now measures the *rendered text*
  against the box it has to live in, and it also refuses to call a screen clean unless the app
  confirms it actually navigated there (`aria-current="page"`).

- **v60 (in progress) — the missed-dose banner, redesigned.** Aaron: *"the long list of banner needs
  a real redesign."* Every miss used to be written as a full sentence — "Tuesday, Aug 4:
  Dexamethasone — Afternoon window (2:00 PM) closed with no dose logged" — and all of them were
  joined into a single paragraph. Twelve misses meant twelve near-identical sentences with the
  useful words buried in the middle of each one. A caregiver cannot scan that, and an alert nobody
  can scan is not an alert.

  It now says the same thing structurally: **the number of missed doses leads the heading**, so the
  size of the problem is one glance; each dose is **its own line, grouped under its day**, so the
  day is written once instead of once per dose; and the repeated "closed with no dose logged" is
  gone, because that is what every row in a missed-dose banner means.

  **Capped at three days**, with the rest behind a control that says exactly what it is hiding
  ("Show 225 more on 45 earlier days") rather than a bare chevron. The cap is on days, not rows —
  cutting mid-day would show some of a day's misses and hide others, which reads as "that dose was
  fine". This matters after an in-patient stay, where the backlog is long and an unbounded banner
  pushes Today's actual medication cards off the screen.

  Checked by `harness/missed-banner-test.mjs`, which reads the **rendered screen** in a real browser
  rather than the source or a helper function — the defect was never in the data, it was in how the
  data was put on screen, which no data-layer test here could have caught.

### v61 — Aug 31, 2026 — you can see what changed

Aaron: *"I wanted a section on caretracker under the ellipsis for latest updates or versioning. I
also want something with a pop up when opening the app to say what new on the latest release."*

**Menu → "What's new"** lists every release from v13 (1 Jul) to v61, newest first, and names the
version that phone is running. **A notice on opening after an update** shows the newest release
only — fifty entries on open is something a person dismisses without reading.

Three decisions that separate useful from annoying:

- **A fresh install is not an update.** With nothing stored the app cannot tell a new phone from one
  that has run for weeks, so it records the version silently and says nothing. The next real update
  is the first thing this ever shows.
- **Per phone, not per person.** Two phones share this record, but "have I read this" is a fact
  about the phone in your hand, so it lives in local storage.
- **Armed at start-up, painted once loaded** — it never covers "Connecting…", but the decision does
  not wait for the network, so it still appears offline.

The user-facing history is reconstructed from this file (v13–v43.3, v56–v60) and `STATUS.md`
(v44–v55, which this file never carried). It is written for the person holding the phone and names
no function, file or commit — the engineering record stays here, and the two are deliberately not
the same text. Where a release was plumbing, it says so; an honest "nothing you would notice" is
what makes the entries that do matter believable.

`CHANGELOG` sits immediately after `APP_VERSION` and before `state`, deliberately. A `const` is
unreachable before the line that defines it, and this app's sibling shipped exactly that bug this
week — a bound declared below the start-up code that used it threw, was swallowed by a `try/catch`,
and silently emptied every saved medication.

**Gate:** `harness/whatsnew-test.mjs` — 20/20, reading the rendered DOM and real browser storage.
Falsified five ways: pop-up disabled → 10/17; greeting a fresh install → 18/20; dismissal not
remembered → 18/20; history truncated → 18/20; menu row removed → 14/15.

Two corrections recorded rather than quietly fixed. The test first failed on *"it does not come back
on the next open"* — that was the **test**, not the app: Playwright re-runs its setup script on
reload, resetting the stored version, so the app was right to show the notice again. And the first
falsification **crashed** instead of failing, because it clicked a button that was no longer there;
a suite that dies when the thing it guards breaks is only accidentally a suite.

#### Correction to the v61 notes above — the history was wrong in 4 of 10 sampled entries

The Zero Day Audit returned **DO NOT SHIP**, and it was right. Its finding was not in the code —
that was proven mechanically unable to touch a dose, a medication, a record or a missed-dose alert
— it was in the **words**, which for this feature *are* the product.

- **v37** described v36's change. Real v37 gave the missed-dose banner its persistent **Clear**
  button, and it had been written out of the record entirely.
- **v39/v40 were inverted.** v39 is the upload that *corrupted* `sw.js` and the handoff doc to the
  string "undefined"; v40 repaired it. The history called v39 a repair release and never mentioned
  the repair under v40.
- **v41** was titled as an evening-window fix. It corrects a **morning** window default.
- **v44** said "nothing you would notice on screen". Its own STATUS section lists the calendar,
  appointments, backup and restore, the missed-dose reason picker — and **the navigation drawer this
  feature lives in**.
- **v50** told the patient the iPhone backup works. CLAUDE.md Rule 7: *"Until confirmed, the backup
  is NOT called a backup."* No confirmation exists. This is the one with a route to harm — someone
  who stops checking would be relying on a file that may never arrive. Reworded to say exactly that.
- **v33** implied Senokot had been raising false missed alerts. The source says only that it was
  converted to as-needed.

A 40% error rate in a 10-entry sample meant the remaining 41 could not be trusted either, so every
entry was paired against its source in README.md and STATUS.md and re-read. The rest hold up.

**Why it happened:** the entries were written from *headline extraction* — the first bold phrase of
each row — rather than from reading each release. That is fast and it is exactly how v37 picked up
its neighbour's change.

Also fixed from the same audit: 115 `key` attributes that this renderer does not treat as special
and rendered as literal markup, and a code comment claiming the notice appears offline. It does not
— `state.loaded` only becomes true when the first Firestore snapshot arrives, so with no connection
it waits. That is the right trade, but the comment said otherwise.

**Still open from the audit, and honest about it:** the claim that the notice never covers the
"Connecting…" screen has **no gate that can fail** — deleting the guard left the suite green at
20/20. It is the one assertion in this feature backed by nothing.

**The one assertion backed by nothing now has a test.** The audit found that deleting the
`!state.loaded` guard left the suite green at 20/20 — the "never covers Connecting…" claim could not
fail. The cause was the test harness, not the app: the Firestore stub answers its first snapshot
immediately, so the app was always loaded before anything could be observed, and the state the guard
exists for was unreachable.

There is now a stub that **holds the first snapshot back**. The test proves the app is genuinely on
the Connecting screen *before* asserting anything about it, checks the notice is not on top of it,
then releases the snapshot and checks it appears. Falsified: deleting the guard now fails on exactly
that assertion. 23/23.

#### PM sign-off returned DO NOT SHIP — five more wrong entries, a broken gate, and a live defect

**The history was still wrong in five more places.** I had claimed all 51 entries were re-paired
against their sources; the PM checked about thirty of its own choosing and found five I had missed.
The two that mattered:

- **v52 contradicted another screen of this app.** The entry said the weight chart no longer jumps
  because of a drain. The Weight report itself prints *"Weight readings are shown exactly as
  recorded and are not adjusted for drainage."* Two screens disagreeing about a clinical chart.
- **v49 told the patient missed-dose alerts used to fail silently.** They did not. The alert was
  correct; the medication's own *card* disagreed with it. A different and far less alarming thing.

Also v54 (claimed a device field that does not exist), v23 (credited it with v24's card — the same
credit-the-neighbour error that produced the v37 defect) and v28 ("could have written fake entries"
— it **did**, into the real record, and they had to be deleted).

**v61 was breaking a passing test.** `para-test` went 16/16 → 15/16: `PARA-0` forbids the British
spelling anywhere in the shipped file, and the v59 entry *quoted the word to explain the fix*, so the
app displayed it inside the sentence saying it does not. Reworded; back to 16/16.

**A live defect, mine, already on her phone.** The missed-dose banner's Clear button is **30px** tall
against the 44px iOS floor — introduced by the v60 banner redesign and live since. The tap next to a
mis-tapped Clear is the alert you were trying to clear. Now 44px.

**The drawer's tap-target gate has been dark since v58.** It asserted `boxes.length === 6`; the menu
has had 9 since v58, so it threw *before* the 44px loop it is named after. Its red looked like a real
failure rather than a dead check. It now counts the rows from the app source.

My first fix made it dead a *different* way — it reached for a `html` local from another function, so
a ReferenceError fired inside the assert. **Both variants produce a plausible red.** Third shape of
one problem this week: a check that cannot start looks like one that passes, and a check that throws
looks like one that found something. Reading the actual message is the only thing that separates them.

With the count read at module scope the gate finally runs: **all nine rows clear 44px at both
widths, 69/70.**
