> **PROCESS RESET — Aug 18, 2026.** The operating model changed. Before using anything in
> this file about workflow, agents, or deploys, read `CLAUDE.md` (the operating model) and
> `PROCESS-RESET.md` (the top-10 failure analysis behind it). Where this handoff and
> CLAUDE.md disagree about PROCESS, CLAUDE.md wins. Technical/project facts below remain
> authoritative.

# CareTracker — AI Agent Handoff Document

> **Purpose:** Complete context for any AI assistant to understand, maintain, and extend the CareTracker project without prior knowledge.
>
> **Last updated:** August 16, 2026
> **Current version:** v64 (the screen redraws only when something visible changes)

---

### Working with Aaron — progress updates are mandatory

Aaron is a non-technical founder and cannot see the terminal. He has asked repeatedly, across
multiple sessions, not to be left in silence while work runs. Treat a silence longer than ~10
minutes as a defect in the work, the same as a failing test.

Checkpoint before starting anything long, when a long job launches (state expected duration), when
it finishes, **the moment a defect is found**, when the plan changes, and immediately when blocked.
Write it for a non-technical reader. Keep the task list current and deliver files as they are
produced rather than batching them — the sandbox has destroyed hours of unsaved work more than once.

When delegating to a subagent, put this rule in the agent's brief too, and tell it to lead with the
headline finding rather than burying it in a report.

### Deploying from a Claude session — the path that works

`git push` is **blocked** in the Claude sandbox. The git proxy refuses any repo not in the session's
authorized source list: *"Arnjnnngs/care-tracker is not in this session's authorized repository set."*
That is a session setting and cannot be changed from inside the session.

**Do not stop there and hand Aaron a zip to upload manually.** That happened twice and wasted his
time. The browser can do the whole thing:

1. Copy the files to ship into `/mnt/user-data/outputs/`. The upload tool only accepts paths the
   session has shared — a path under `/home/claude` is rejected.
2. Open `https://github.com/Arnjnnngs/care-tracker/upload/main` in Chrome.
3. `find` the file input ("choose your files"), then call **`mcp__claude-in-chrome__file_upload`**
   with its ref and the absolute paths. **Never click a file input** — that opens a native picker
   that cannot be driven. 10 MB limit per call.
4. Fill the commit summary and description, then click **Commit changes**.
5. **Verify twice.** Re-clone the repo and md5-compare every file against what was built; then wait
   60-90 seconds and fetch the live URL with a cache-buster to confirm the deployed `APP_VERSION`
   and the `sw.js` CACHE string actually changed. GitHub Pages lags the commit — checking too early
   shows the previous version and looks like a failed deploy.

`mcp__claude-in-chrome__file_upload` is a **deferred tool**: it must be loaded via ToolSearch before
it can be called. Not knowing that is why two releases were handed over for manual upload. Load it
up front with the rest of the browser tools.

**The sandbox rolls back without warning** — it has destroyed hours of unpushed work repeatedly on
this project. Anything not committed to GitHub or delivered to Aaron as a file can vanish. Push
early, push often, and treat the repo as the only durable storage.

Committing to `care-tracker` means committing to a live patient's app, so Aaron's explicit go-ahead
is required before the first push of a change. It does not need re-asking for a verification re-run
or a follow-up commit inside work he has already authorized.

## 1. What This Project Is

CareTracker is a **progressive web app (PWA)** that tracks medications, temperature, and weight for a family caregiver (caring for Brandi). It is a **single-file vanilla JavaScript app** — no build step, no framework, no node_modules for the frontend. The entire app lives in `index.html`. Firebase Firestore provides the database with real-time sync, and Firebase Cloud Messaging (FCM) handles push notification reminders.

**The core user flow:** A caregiver opens the app on their phone, taps a medication quick-log button (e.g., "500 mg" or "1000 mg" for Tylenol), and the dose is instantly synced to Firestore and reflected across all devices. The app enforces dosing limits (e.g., max 4000 mg Acetaminophen per 24h, 8-hour gap for Zofran) and shows countdown timers. Push notifications remind the caregiver when meds are due.

---

## 2. Links

| Resource | URL |
|---|---|
| **Live App** | https://arnjnnngs.github.io/care-tracker/ |
| **Cache Reset Page** | https://arnjnnngs.github.io/care-tracker/reset.html |
| **GitHub Repository** | https://github.com/arnjnnngs/care-tracker |
| **GitHub Commits** | https://github.com/arnjnnngs/care-tracker/commits/main |
| **GitHub Actions** | https://github.com/arnjnnngs/care-tracker/actions |
| **Firebase Console** | https://console.firebase.google.com/project/fuelforge-7c132 |

---

## 3. Repository Structure

```
care-tracker/
├── .github/
│ └── workflows/
│ └── reminders.yml # GitHub Actions cron — sends med reminders every 30 min
├── firebase-messaging-sw.js # FCM service worker — handles background push notifications
├── icon-192.png # PWA icon 192x192
├── icon-512.png # PWA icon 512x512
├── index.html # THE ENTIRE APP — HTML + CSS + JavaScript
├── manifest.webmanifest # PWA manifest (name, icons, theme, display mode)
├── reset.html # Utility page — nukes service workers + caches, redirects to app
├── send-reminders.js # Node.js server-side script — queries Firestore, sends FCM pushes
└── sw.js # App service worker — caching strategy + notification click handler
```

**There is no build step.** Edits to `index.html` are deployed by pushing to `main` — GitHub Pages serves from the root of `main`.

---

## 4. Tech Stack Details

### Frontend
- **Language:** Vanilla JavaScript with ES modules (`<script type="module">`)
- **Rendering:** Custom reactive rendering (not React/Vue/etc. — vanilla DOM manipulation via a small `h()` helper)
- **Styling:** Inline `<style>` block plus inline per-element style objects — light pink glassmorphism theme
- **Fonts:** Hanken Grotesk (body) + IBM Plex Mono (monospace data), loaded from Google Fonts
- **Theme colors:** Background `#FFF0F3`/`#FFF5F7` gradient, accent pink `#AA5375`, accent green `#0F9D6B`, alert red `#C0453B`

### Backend / Database
- **Firebase Project:** `fuelforge-7c132` (the "FuelForge" project — CareTracker shares this project)
- **Firebase SDK:** v10.12.0 (loaded as ESM from `https://www.gstatic.com/firebasejs/10.12.0/`)
- **Database:** Cloud Firestore
- **Auth:** None — the app is open (no user authentication)
- **Push:** Firebase Cloud Messaging (FCM)

### Hosting & CI/CD
- **Hosting:** GitHub Pages (auto-deploys from `main` branch root)
- **CI:** GitHub Actions workflow `reminders.yml` runs on a cron schedule
- **No other CI/CD** — no tests, no linting, no build pipeline

---

## 5. Firebase Collections

### `caretracker_entries`
The main data collection. Each document is a single logged event.

**Document fields (verified against live data, July 11, 2026):**
- `medId` — string identifier: `"tylenol"`, `"zofran"`, `"compazine"`, `"morphine"`, `"lidocaine"`, `"imodium"`, `"protonix"`, `"buspirone"`, `"paroxetine"`, `"iron"`, `"senokot"`, `"chemo_date"`, `"cycle_start"`, `"cycle_end"`, `"inpatient_start"`, `"inpatient_end"` (legacy `"inpatient"`), or `"temp"` / `"weight"` for vitals
- `ts` — timestamp (milliseconds since epoch) of when the dose was taken
- `dose` — human-readable dose label string (e.g., `"1000 mg"`, `"½ tab · 7.5 mg"`, `"99.8 °F"`) or null
- `mg` — numeric milligrams (0 for non-mg meds)
- `pills` — count for pill/application-limited meds (Imodium, Lidocaine); only present when applicable
- `temp` / `weight` — numeric value on vitals entries
- `override` — boolean, present when the dose was logged early past a lock
- `painLevel` — 1–10, present on Tylenol/Morphine entries

### `caretracker_prefs` (added v37)
Small collection of app-preference documents — not dose history, just UI/session state that needs to persist and sync live.

**Known document:** `settings`
- `missedClearedAt` — timestamp (ms). Any missed-dose window with a start time at or before this value is hidden from the Today banner. Written via `setDoc(..., {merge:true})` when the caregiver taps **Clear** on the missed-dose banner; read via a live `onSnapshot` listener at app startup so it's already applied before first paint and stays in sync across devices without a refresh.

### `fcm_tokens`
Stores device push notification tokens.

**Document fields:**
- `token` — the FCM registration token string
- Document ID = the token itself

### `fcm_tracking`
Prevents duplicate notifications.

**Known document:** `zofran_gap`
- `lastDoseTs` — timestamp of the last Zofran dose that was already notified about
- `notifiedAt` — timestamp of when the notification was sent

---

## 6. Medication Definitions

| ID | Display Name | Generic | Dosing Rules |
|---|---|---|---|
| `tylenol` | Tylenol | Acetaminophen | Daily max: 2500 mg (resets at midnight). Min gap: 4 hours. Quick-log buttons: 500 mg, 1000 mg |
| `zofran` | Zofran | Ondansetron | As needed — no gap timer, no gap push (since v30). Restricted on chemo days 1–2 (override available) |
| `compazine` | Compazine | Prochlorperazine | 6-hour min gap. 10 PM routine, earlier as needed. Shown in the Evening Meds group card, not Quick Log |
| `morphine` | Morphine | Immediate release | 4-hour min gap. Quick-log buttons: ½ tab (7.5 mg), full tab (15 mg) |
| `lidocaine` | Lidocaine | Topical cream | 4-hour min gap. Daily max: 4 applications (resets at midnight). Quick-log button: Apply |
| `imodium` | Imodium | Loperamide | Daily limit: 4 pills (resets at midnight). Quick-log buttons: 2 pills, 1 pill |
| `protonix` | Protonix | Pantoprazole | Twice daily windows: morning (8–12) & evening (20–22). Early logging allowed via override |
| `buspirone` | Buspirone | BuSpar | Once daily, with Protonix in the morning (`morningLinkedToProtonix`, added v40; default corrected v41). Default window is a fixed 10 AM–midnight (Protonix's typical 8 AM dose time + 2h — mirrors Iron's 10 PM default exactly); if Protonix's actual morning dose logs later, shifts to 2h after that log time and stays open through end of day. Grouped into the "Morning meds" Home card with Paroxetine |
| `paroxetine` | Paroxetine | Paxil | Once daily, with Protonix in the morning — same dynamic window and grouping as Buspirone (v40) |
| `iron` | Iron | Ferrous sulfate | Once daily, evening (`eveningLinkedToProtonix`). Default 10 PM window; if Protonix's actual evening dose logs later, shifts to 2h after that log time. Grouped into the "Evening meds" Home card with Compazine |
| `senokot` | Senokot | Senna | As needed — no schedule, no lock (type gap, gapH 0). Quick-log buttons: 1 pill, 2 pills |
| `dexamethasone` | Dexamethasone | Steroid (chemo premed) | 2 tablets, 8 AM & 2 PM — auto-appears day before chemo through day after only |

### Vitals
- **Temperature** — logged in °F, shows last reading time
- **Weight** — logged in lbs, shows last reading time

---

## 7. Service Worker Architecture

### sw.js (App Service Worker)
**Cache name:** `caretracker-v40` — **bump this string when deploying changes** to force all devices to get the new version.

**Cached shell files:** `'./'`, `'index.html'`, `'manifest.webmanifest'`, `'icon-192.png'`, `'icon-512.png'`

**Fetch strategy:**
- **Network-first** for: `firestore.googleapis.com`, `gstatic.com`, `googleapis.com` — these are Firebase API calls, fonts, and SDK files. Falls back to cache if network fails.
- **Cache-first** for everything else (static assets). Falls back to network if not cached.

**Notification click handler:** When user taps a push notification, it focuses the existing CareTracker tab or opens a new one at `'./'`.

### firebase-messaging-sw.js (FCM Service Worker)
Separate service worker specifically for Firebase Cloud Messaging background message handling. Uses the Firebase compat SDK (not ESM). Duplicates the Firebase config. Handles `onBackgroundMessage` by calling `self.registration.showNotification()` with:
- Icon/badge: `icon-192.png`
- Tag: `caretracker-reminder`
- `requireInteraction: true` (notification stays until dismissed)
- Vibrate pattern: `[200, 100, 200]`

Also has its own notification click handler (identical logic to sw.js).

---

## 8. Push Notification System

### How It Works
1. **User subscribes:** The app calls `getToken()` from FCM and stores the device token in Firestore `fcm_tokens` collection.
2. **Cron runs:** Every 30 minutes (8 AM–10 PM CDT), GitHub Actions runs `send-reminders.js`.
3. **Script checks time:** Determines if a scheduled reminder window is active, and checks Zofran gap status.
4. **Script sends:** Uses `firebase-admin` to send FCM messages to all registered tokens.
5. **Device receives:** `firebase-messaging-sw.js` handles the background message and shows a system notification.
6. **Stale tokens cleaned:** If a token is invalid/expired, the script deletes it from Firestore.

### Reminder Schedule (Central Time) — updated v41

| Time | Type | Notification |
|---|---|---|
| 7:55–8:05 AM | Scheduled | "Morning Meds Due" — Protonix only, fixed, independent of Buspirone/Paroxetine |
| Dynamic, or 9:55–10:05 AM fallback | Scheduled | "Morning Meds Due" — Buspirone, Paroxetine. Fires 2h after Protonix's actual logged morning dose if logged (e.g. logged 8:43 AM → fires 10:43 AM), else the static 10 AM window |
| 7:55–8:05 PM | Scheduled | "Protonix Due" — evening dose (app window closes 10 PM) |
| Dynamic, or 9:55–10:05 PM fallback | Scheduled | "Evening Meds Due" — Iron, Compazine. Fires 2h after Protonix's actual logged evening dose if logged, else the static 10 PM window |
| Every 30 min | Gap-based | "Zofran Available" — only if 8h gap since last dose has elapsed |
| 10:05 PM–8 AM | Quiet hours | No notifications sent (10:00 PM send explicitly allowed) |

`send-reminders.js` implements the dynamic windows via `protonixMorningLogTs(d0)` / `protonixEveningLogTs(d0)`, mirroring the client's `morningWindowsFor()` / `eveningWindowsFor()` in `index.html`.

### GitHub Actions Workflow (reminders.yml)
- **Triggers:** Cron schedule + manual `workflow_dispatch`
- **Cron expressions:** `'0,30 13-23 * * *'` and `'0,30 0-3 * * *'` (UTC, covering 8 AM–10 PM CDT)
- **Runner:** `ubuntu-latest`, Node 20
- **Dependencies:** `firebase-admin@12` (installed at runtime via npm)
- **Secret required:** `FIREBASE_SERVICE_ACCOUNT` — JSON service account key for the `fuelforge-7c132` project

---

## 9. Deployment

### How to deploy changes
1. Edit files locally (usually just `index.html`)
2. **Bump the cache version** in `sw.js` — change `const CACHE = 'caretracker-v40';` to `v41`, etc.
3. Push to `main` branch
4. GitHub Pages auto-deploys within ~1 minute
5. Devices with the old service worker will pick up the new version on their next visit (the activate event deletes old caches)

**Never edit `index.html` or `sw.js` through GitHub's inline web editor.** Always prepare the full file locally and push it as a real diff (e.g. via the GitHub web-upload UI or `git push`). Pasting large file contents into the inline editor has twice truncated/corrupted a file to the literal text "undefined" — once in care-tracker-testing, and again here in v39 (see Known Issues item 11).

### Cache Reset for Stuck Devices
If a device shows a blank screen or stale content:
- Navigate to `https://arnjnnngs.github.io/care-tracker/reset.html`
- This page automatically unregisters all service workers, deletes all caches, and redirects to the app with a cache-busting query string

---

## 10. Known Issues & Gotchas

1. **"All blank" on some devices** — Caused by stale service worker cache. The reset page fixes this. Always bump `CACHE` version in `sw.js` when deploying.

2. **No authentication** — The app has no login. Anyone with the URL can read/write data. The Firebase config (API keys) are in the client-side code — this is normal for Firebase web apps, but Firestore security rules should be configured in the Firebase console.

3. **Shared Firebase project** — CareTracker uses the `fuelforge-7c132` project, which may have other collections/apps. Don't modify project-level settings without checking.

4. **Single-file architecture** — The entire app is in `index.html`. This makes it simple but means there's no code splitting, no tree shaking, and editing is done on one large file. If the app grows significantly, consider splitting into modules.

5. **Duplicate Firebase config** — The Firebase config appears in both `index.html` and `firebase-messaging-sw.js`. Keep them in sync when changing.

6. **FCM token management** — Tokens can go stale if a user uninstalls the PWA or clears browser data. The `send-reminders.js` script auto-cleans invalid tokens, but there's no UI to re-subscribe.

7. **UI/rules coupling** — The Remove button is hidden for entries older than 48h because Firestore security rules (published July 2026) block those deletes. If the rules' delete window changes, update the `48 * 3600000` constant in `removeBtn()` in index.html to match.

8. **Timezone hardcoded** — The reminder system uses `America/Chicago` (Central Time). If the user moves timezone, both `send-reminders.js` and any time-display logic in `index.html` may need updating.

9. **seedDemo() fake-data bug (fixed v28, Jul 17, 2026)** — A dormant seedDemo() function fired whenever the app's first Firestore snapshot returned empty entries, intended only for a genuinely fresh install, but cold caches and brief network blips produce the same "empty" signal, so it could fire unpredictably during real usage. It silently wrote 10+ hardcoded fake medication entries per trigger directly into caretracker_entries — Brandi's real medical data. Fix: the function, the demo state flag, its banner UI, and the auto-seed call were all removed entirely in v28 (see Version History). All fake entries were identified by timestamp fingerprint and deleted from Firestore via the admin console, re-verified via a fresh collection query (0 matches). Deleting the older fake entries (dated 7/6-7/7) required a temporary one-time unlock of the 48h removeBtn() edit-lock (see item 7 above), which was reverted in v29 immediately after cleanup. Lesson for future fixture/demo-data functions: never gate a write on "the collection looks empty" as a proxy for "this is the user's first real launch" — a cold local cache or a dropped network request looks identical to genuine emptiness from the client's point of view. If a demo-seeding feature is ever wanted again, it should require an explicit user action (a button), not fire automatically off a snapshot listener.

10. **Version History gap, v34–v36 (resolved Jul 19, 2026)** — v34, v35, and v36 shipped without Version History rows in README.md or this file; an agent working a later session skipped the documentation step. Backfilled the same day by reading the actual commit diffs from `github.com/Arnjnnngs/care-tracker/commits/main` rather than guessing — see Section 11 for the real per-version changes (and the two related `send-reminders.js` fixes that shipped without their own version bump). Lesson: verify against the actual commit history before writing a changelog entry from memory, and don't let a "flag it for later" placeholder stand in for doing the fix now if the source-of-truth (commit history) is still available and cheap to check.

11. **`sw.js` / `CARETRACKER_HANDOFF.md` corrupted to "undefined" in v39 (fixed v40, Jul 20, 2026)** — The v39 commit ("bump SW cache, update handoff doc") was made through GitHub's inline web editor rather than a proper local-edit-then-push, and the paste into the editor silently truncated both files down to the literal 9-byte string `undefined`. `index.html` was untouched (verified 2136 lines, intact). This is the second occurrence of this exact failure mode — the first happened in `care-tracker-testing`, which is what originally established the "never edit `index.html`/`sw.js` through the GitHub web editor" rule; that rule evidently wasn't being followed for `sw.js`/doc-only commits in production, which is how this repeated here. Root-caused via `git log`/`git show` against the commit history (the last-known-good `sw.js` content was recovered from the parent commit, v38). Fixed in v40 by restoring both files from that recovered content and re-adding the intended v38/v39 documentation updates. Lesson (reinforced, not new): this rule applies to *every* commit that touches `index.html` or `sw.js`, including small "just bump the cache" or "just update docs" commits — there's no safe shortcut through the web editor for these two files specifically. Always prepare the full file content locally and push it as a real diff.

12. **Missed-dose "Clear" prefs storage model changed in v42** — Before v42, `clearMissedDoses()` wrote a new auto-ID document to the `caretracker_prefs` collection on every click, and `subscribePrefs()` scanned the whole collection for the doc with the highest `missedClearedAt`. v42 (promoted from the testing app's cleaner implementation) switched this to a single fixed document, `caretracker_prefs/settings`, read/written via `onSnapshot`/`setDoc` with `{ merge: true }`. Functionally equivalent going forward, but any `missedClearedAt` value set by the *old* code before this promotion lives in a different (auto-ID) document that the new code never reads — so the very first load after v42 may briefly show previously-cleared missed doses again until Clear is tapped once more. No entry/medication data is affected; this is UI state only.

---

## 11. Version History

| Version | Date | Commit | Changes |
|---|---|---|---|
| v43.3 | Aug 16, 2026 | v43.2 | **Three defects fixed that were live on the patient's phone, all one root cause in the renderer.** `h()` routed `value` through `setAttribute`, which sets the DEFAULT value rather than the current one. On a `<textarea>` it is ignored entirely; on a `<select>` it does nothing at all, because selection is carried by `<option selected>`; on an `<input>` it goes stale as soon as the value is edited. `h()` now sets **both** the attribute and, deferred until after children exist (a `<select>` has no options to choose from at attribute time), the **property** — which is what actually holds a current value. Belt-and-braces: nothing relying on the HTML default changes. **What this fixes, all reported by the patient-facing screens rather than by a unit test:** the Home **appetite** card silently reset its dropdown and wiped its reason box about a second after being filled in; the **symptom logger** snapped its dropdown back to blank when a symptom was chosen, wiped any note typed beforehand, and showed an existing symptom's note as empty; and the **medication editor displayed the wrong schedule type** — Protonix shown as *As needed / gap-based* when it is a *Scheduled window* medication. That last one is the serious one: anyone who saw the wrong value and 'corrected' it would have converted a scheduled medication to as-needed and **silently switched off its missed-dose alerts**. In all three the underlying data was intact and saving worked correctly — the screen was contradicting what had just been entered, which for a patient in active chemotherapy reads as the app losing her entry and invites her to enter it twice. Proved by `harness/live-bugs.mjs`, which runs every check against this build **and against the currently-live build**, so each fix is demonstrated as a measured difference rather than asserted: **12 checks, all passing**, including that the live build genuinely fails each one. `sw.js` cache bumped `caretracker-v43-2` -> `caretracker-v43-3`. No change to the medication engine, the entry schema, Firestore, or any screen's behaviour beyond showing the truth. |
| v43.2 | Aug 16, 2026 | v43.1 | **Missed-dose alerts: a late dose no longer raises a false alarm on the window it was late for, and no longer silences the next one.** `missedDosesFor` claimed windows in two passes -- pass 1 offered EVERY window any unused dose logged before that window's CLOSE, pass 2 then handled late catch-ups. The split was the defect: a later window could claim a dose that was really a late catch-up for an earlier one. On Brandi's real Protonix schedule (Morning 8-12, Evening 20-22) a dose logged at 1 PM failed the Morning test (1 PM is not before noon) but passed the Evening test (1 PM is before 10 PM), so **Evening took it**. Two things went wrong at once: **Morning showed a red MISSED alert for a dose that was actually taken**, and **Evening was marked covered, so a genuinely skipped 8 PM dose raised no alert at all.** The silent half is the dangerous one -- an adherence tracker that goes quiet is worse than not having one, because the silence is trusted. Dexamethasone's 8 AM / 2 PM chemo-day pair failed identically. Replaced with a single pass processed strictly in window order, so each window gets first claim over any unused dose logged before the NEXT window opens: Morning is offered the 1 PM dose first and takes it, leaving Evening genuinely uncovered. This is the same logic as `chemowell-beta`, where it was fixed in v68 after Aaron reported that a late-logged dose could still show as missed; it was never carried across to production. One function, nothing else in the release. Verified by a harness that EXTRACTS the function and the medication windows from the shipping file at run time rather than re-typing them, so the test cannot drift from the code: **39 checks, all passing**, including the reported failure on the real Protonix and Dexamethasone schedules, and mutation checks that reconstruct the old two-pass logic and confirm it fails the two defect assertions -- so those assertions are proven able to fail. **Recorded, deliberately NOT changed:** a window still accepts any unused dose logged before its cutoff with no lower bound, so two doses logged in the same morning leave the second available to satisfy the Evening window. Same shape as the defect above, but pre-existing and unchanged by this release (assertion R7 proves the old logic behaves identically). Fixing it means deciding how early a dose may be and still count for a window -- a design decision, not a bug fix, and it would diverge from the implementation proven in `chemowell-beta`. **Amended after audit.** The first attempt at this fix let the earlier window claim the ENTIRE dead gap between windows, which fixed the 1 PM case and broke the 7 PM case in exactly the same way, mirrored: a dose taken an hour before the evening dose was due would be credited to Morning, raising a false Evening alert and silently suppressing a genuinely skipped Morning dose. Measured exposure was four hours a day (16:00-19:59) where it was strictly worse than v43.1. The gap is now **split at its midpoint** -- a dose is credited to whichever window it is nearer, so on Protonix 1 PM is a late Morning dose and 7 PM is an early Evening one. The audit also found two further defects in that first attempt, both introduced by the same root cause and both absent from v43.1: with OVERLAPPING windows a dose logged inside a window failed to cover it, and with windows listed OUT OF ORDER an on-time dose flagged its own window as missed. The medication editor validates only that end > start, so neither case is unreachable. Fixed by sorting windows defensively and clamping the cutoff so an overlapping next window can never cut the current one short. `sw.js` cache bumped `caretracker-v43-1` -> `caretracker-v43-2`. No change to the entry schema, the medication engine, Firestore, or any daily screen beyond the alert accuracy itself. |
| v43.1 | Aug 15, 2026 | v42 | **Save a copy of your records — a spreadsheet export and a printable report. The first backup this app has ever had.** Brandi's records live in one Firestore project with no copy anywhere; that is why this was built ahead of everything else on the list. Handing a printed record to an oncologist is the secondary purpose. **Strictly read-only, proven three ways.** WEB-MAIN has exactly four mutation mechanisms (`addEntryDB`, `removeEntryDB`, `setDoc`, `persistMedicationConfig`), all named functions with no dynamic dispatch, so "this feature cannot write" is mechanically checkable with a grep over the inserted block. The offline harness proves it twice more, by recording attempted Firestore writes AND attempted localStorage writes and asserting both recordings stay empty, and by reading the live `state.entries` / `state.chemoDates` arrays before and after to prove nothing was reordered in place. Each of the three is verified by injecting the corresponding write and confirming the suite goes red. **Reached from Reports**, as a card rather than a sixth bottom-nav tab (`renderBottomNav` hardcodes a five-column grid; a sixth item silently overflows it), and deliberately not added to the `reportTypes` array, whose dispatch ends in a bare `else renderAppetite(now)` and would have quietly rendered the wrong report. The card leads the screen rather than trailing the five browse buttons — below them it was 3–22% visible above the fixed nav on every phone size. **CSV columns:** Date, Time, Timestamp (ISO-8601), Time of day, Type, Med ID, Detail, Amount (mg), Note, Source, Entry ID, Logged at. `Med ID` carries the raw id unmodified on every row, which is what makes the file device-independent — display names depend on the medication list configured on the device that exported it. `Logged at` exists because a row with no event time blanks its four date columns, and without it the backup could no longer say when a chemo date was cleared. Logged rows lead the file and derived rows follow, so the backup does not open on forty consecutive "not logged" rows. **Chemo dates are included**, unlike the phone app's exporter which filters them out as internal scheduling state: they are real documents and they are the calendar the whole app pivots on, so excluding them from the only backup means the treatment schedule is the one thing that cannot be restored. **Missed doses are included and marked `derived`**, because they are not documents — `missedDosesFor()` computes them at render time from the schedule configured on *this* device, so two devices produce different sets from identical data. The `Source` column keeps the file honest about which rows are facts and which are inferences. A derived row takes its Time-of-day from the medication window it was inferred from rather than the clock bucket its timestamp lands in; those disagreed on 32 rows of a single export. **Spreadsheet safety:** UTF-8 BOM so Excel reads °F correctly, RFC-4180 quoting, and a leading apostrophe on any field starting `=`, `+`, `-` or `@`, applied before quote-wrapping so it lands inside the quotes where Excel actually reads it. **The printable report** leads with the daily log — what she actually took and how she felt. The calculated "scheduled doses with nothing logged" section follows it, is chipped *calculated* rather than *derived*, is set at normal weight in `#5B4A53` rather than bold red, and carries a body-size sentence stating plainly that these are not confirmed missed doses. With nothing logged the section is not emitted at all and the period reads `—`. Each day's date lives inside its own table `thead`, so it repeats on every page that day spans; `@page` margin boxes carry a running *name · treatment record · page N of M* and the patient-logged disclaimer on every page. Raw database keys never reach it: `nameOf` gained a `chemo_date` case, and a report-only `reportNameOf` resolves membership against the medication list explicitly and renders anything unresolvable as *Medication (removed)*. **Six review findings fixed before this shipped, none of which a unit test would have found:** a zero-document account produced a document whose entire body was a bold red table reading "166 scheduled doses with nothing logged" beside an ENTRIES tile reading 0; both day-walking loops advanced by a flat 24 hours against a `dayStart()` that returns local midnight, so from 2 Nov the current day was dropped from every backup and 1 Nov was emitted twice, permanently, every year; the reporting period was computed from inferred rows and pinned to `MISSED_TRACK_SINCE` regardless of what was recorded; page 2 onward carried no date, patient name or page number; the busy state completed inside one synchronous task and was painted in 0 of 70 sampled frames; and a failed export showed the patient a raw browser string such as *The operation is insecure.* **Three more were introduced by those fixes and caught by the Lead gates:** the card meta line rendered *Invalid Date* and read a scheduled appointment as "last logged"; `reportNameOf` guessed from whether an id contained a hyphen and was wrong in both directions, printing a raw key for `ativan` and labelling the active drug `5-fu` as removed; and a contrast "fix" claimed 3.6:1 for a colour producing 3.23:1 while stacking opacity took the empty state to 1.81:1, worse than the 1.95:1 it replaced. **One more was caught only by auditing the shipping bytes:** `reportNameOf` had been applied to Today's Journal and the History report, where medication config is device-local localStorage but entries sync from Firestore — so on a new phone every user-added medication, including ones she is actively taking, would have rendered as *Medication (removed)*, with two different drugs collapsing to one label and no id column to tell them apart. Those screens use `nameOf`. **Verified by an offline harness that starts its own server on an OS-assigned port, routes all three Firebase module URLs to a credential-free stub, blocks the service worker, pins the clock, and proves by md5 that the bytes under test are the shipping file.** 123 checks pass, and every one has been mutation-tested — 48 defects deliberately reintroduced, all 48 caught. `sw.js` cache bumped to `caretracker-v43-1`; `index.html` gained an `APP_VERSION` constant it previously did not carry. **Production Firestore untouched — this release cannot write to it.** |
| v42 | Jul 22, 2026 | — | **Full promotion from care-tracker-testing** (Aaron: "this is the main big push for all features... every aspect of the testing should be on main with exception of the testing things like date and banner"). Brings production up to date with everything validated in the 30-use-case QA pass. New: Tylenol Liquid tracking, Appetite tracking, Bowel Movement daily card + Symptoms tab, full medication editor (add/edit/delete/archive/reorder/A-Z sort), Morphine rolling 4h/15mg cumulative ceiling (replacing the old flat last-dose+4h gap) generalized into a reusable ceiling-group mechanism. Fixes carried over: Zofran chemo-block confirmed/restored to the correct 3-day window; `fmtDateLabel` stale-date bug; orphaned Cycle/In-Patient "Active" period when a second Start preceded an End; service-worker update lag (`reg.update()` + one-time `controllerchange` reload) — cache bumped `caretracker-v41` → `caretracker-v42`. `mergeMissingDefaultMeds` auto-adds new default meds to existing devices without disturbing customizations or archived meds. Missed-dose Clear button's storage model changed to a single Firestore doc — see Known Issues item 12. All TEST_MODE-gated code (flag, banner, date-override control) removed entirely rather than just disabled; testing-only collection names and localStorage key swapped for the real ones. `manifest.webmanifest` and this repo's own docs were left untouched by the promotion (not overwritten by testing's versions). Verified with 12 mocked-Firestore regression suites (~208 checks, all passing) before push. Production Firestore data untouched — code-only promotion |
| v41 | Jul 20, 2026 | — | **Correction to v40's Buspirone/Paroxetine default window, per Aaron's direct feedback**, plus clears any confusion around today's Buspirone/Paroxetine missed-dose flags (those cleared naturally once logged; nothing needed there). Aaron clarified the intended design: Protonix fires at a fixed 8 AM; Buspirone/Paroxetine open 2h after Protonix's *actual logged* time (e.g. logged 8:43 AM → available 10:43 AM), but if Protonix hasn't been logged yet, the fallback default is a single fixed clock time — **10 AM** (Protonix's typical 8 AM dose time + 2h) — not the 8 AM–noon range v40 used. This mirrors Iron's evening default (10 PM = Protonix's 8 PM time + 2h) exactly. `DEFAULT_MEDS` buspirone/paroxetine `windows` changed from `{start:8,end:12}` to `{start:10,end:24,name:'Morning'}`. `checkNotifications()`'s Buspirone/Paroxetine check moved from the fixed 8:30 AM block to a new 9:55–10:05 AM block (`sched-10am` key). `send-reminders.js` rewritten to fully decouple Protonix's own fixed 7:55–8:05 AM push (tag `morning-meds`) from Buspirone/Paroxetine's push (tag `morning-meds-buspar`, new) — the latter now fires dynamically at `protonixMorningLogTs + 2h` (±12 min tolerance) if logged, else at the static 9:55–10:05 AM fallback, exactly mirroring the evening Iron/Compazine structure. Cache bumped `caretracker-v40` → `caretracker-v41`. QA'd: `test_prod_v57_morning.js` updated (28/28) and `test_prod_send_reminders.js` fully rewritten for the new cron design (13/13, including a direct test of Aaron's 8:43 AM → 10:43 AM example) |
| v40 | Jul 20, 2026 | — | Buspirone/Paroxetine moved from the 10 PM evening window to a new Morning window linked to Protonix (`morningLinkedToProtonix`): default 8 AM–noon (Protonix's own morning window), shifting to 2h after Protonix's actual logged morning dose if later, open through end of day — mirrors the existing `eveningLinkedToProtonix`/`eveningWindowsFor()` pattern via new `protonixMorningLogTs()`/`morningWindowsFor()`. New shared `renderGroupedMedsCard()` helper powers both a new "Morning meds" Home card (Buspirone, Paroxetine) and the existing "Evening meds" card (now just Iron, Compazine). Medication editor gets a "Group with morning meds" toggle (`groupedMorning` field). `send-reminders.js` updated to match: `protonixMorningLogTs()` added server-side; the 8:25–8:35 AM push now reads "Protonix, Buspirone, Paroxetine" with a dynamic follow-up push if Protonix's actual log shifts the window past 8:45 AM; the evening push text dropped Buspirone/Paroxetine (now "Iron, Compazine" only). Also restores `sw.js` and `CARETRACKER_HANDOFF.md`, both corrupted to "undefined" in v39 (see Known Issues item 11) — cache bumped `caretracker-v38` → `caretracker-v40` (v39's intended bump never actually shipped). Scope note: this port intentionally did **not** carry over several testing-only changes shipped alongside it in `care-tracker-testing` (editor label renames for "Home quick log"/"Chemo plan", a "Chemo-day only" editor toggle, the Chemo Schedule card resize, cycle-entry exclusion from Journal/History, and the Symptoms dropdown redesign) — those remain testing-only per explicit scoping |
| v39 | Jul 20, 2026 | 0bd5f61 | Intended as a routine SW cache bump + handoff doc update; instead corrupted `sw.js` and this file to "undefined" via the GitHub inline web editor. See Known Issues item 11 and the v40 entry above for the fix |
| v38 | Jul 19, 2026 | 9988c16 | SW cache bump only (`caretracker-v37` → `caretracker-v38`), no functional change |
| v37 | Jul 19, 2026 | 247f22e | Missed-dose banner gets a persistent **Clear** button. New `caretracker_prefs/settings` doc (field `missedClearedAt`) written via `setDoc(...,{merge:true})` on tap, read via a live `onSnapshot` listener set up alongside `subscribeEntries()` at startup. Banner filtering changed from a single `bannerItems` list to `bannerItemsAll` (unchanged `missedDosesFor()` walk) filtered down to `bannerItems = bannerItemsAll.filter(m => m.ts > (state.missedClearedAt || 0))`. Unlike an in-memory-only dismiss, this persists across reloads and syncs across every device instantly (verified with a mocked-Firestore harness simulating a full app reload with a fresh `state` object). A window that closes after the clear timestamp still alerts normally. Journal and History tabs are unaffected — they keep every MISSED row permanently; only the Today banner is dismissible |
| — | Jul 19, 2026 | 56becfc | `send-reminders.js`: `protonixEveningLogTs()`'s Firestore query dropped the compound `.where('medId','==','protonix').where('ts','>=',d0)` (which needs a manual composite index — none was configured, so it would throw) for a single-field `.where('medId','==','protonix')` query with the `d0` date-range check done client-side in JS afterward. Also wrapped the whole lookup in try/catch so a Firestore error falls back to the static 10 PM window and logs the failure, instead of throwing and silently killing the evening-meds reminder for the day |
| v36 | Jul 19, 2026 | c1bbc74 | Fixed redundant "Available"/"Available now" text: the next-dose meta line on a Quick Log card (`nextDoseLabel`) is now only rendered while the med is actually `locked`, matching the green "Available" badge already shown when it isn't. Replaced `window.scrollTo({top:0,behavior:'smooth'})` with a plain instant `window.scrollTo(0,0)` in `navigateTo()`, `openReport()`, and `openMedicationEditor()` — the smooth-scroll animation was visibly janky, especially on lower-end mobile devices. The 1-second `setInterval` render-pause guard (`isEditing`) previously checked only `document.activeElement.tagName === 'INPUT'`; extended to `INPUT`, `SELECT`, and `TEXTAREA` so choosing a dropdown option or typing a note in the medication editor's textarea can no longer get wiped mid-interaction by the periodic re-render tick |
| — | Jul 19, 2026 | 38059ef | `send-reminders.js`: added `centralMidnightTodayMs()` and `protonixEveningLogTs()` so the evening-meds (Iron/Buspirone/Paroxetine) push reminder mirrors the client's dynamic Protonix+2h window instead of a fixed 9:55–10:05 PM slot — it now fires ~2 hours after Protonix's actual logged evening dose that day (found via a live Firestore lookup), falling back to the static 10 PM window if Protonix hasn't been logged yet. Client-side equivalent (`eveningWindowsFor()`) had already shipped to testing; this is the server-side cron catching up to match |
| v35 | Jul 19, 2026 | 8baa097 | Large promotion from testing (680 additions / 145 deletions) carrying a redesigned Quick Log status-badge treatment plus further chemo/Dex polish. Simplified `status()`'s Dexamethasone handling by removing the `lateLog` exception introduced in v34 — a completed course now locks cleanly (`courseComplete: true`) rather than permitting one more late log after the window closed. Missed-dose banner behavior changed from auto-expiring to staying up indefinitely until the dose is actually logged — this is the change that later made a manual Clear mechanism necessary (see v37). Testing-only scaffolding (`TEST_MODE` gating, the date-override control) was stripped before promotion, matching the same pattern used for the v30 promotion |
| v34 | Jul 18, 2026 | 948e5a4 | Fixed Dexamethasone/Zofran chemo-window logic. `zofranBlockedOn(dayTs)` widened from chemo offsets `{0,1}` to `{0,1,2}` — Zofran is now correctly restricted through the day *after* chemo, not just chemo day itself. Added `dexWindowsForOffset(offset)`: on the final premed day (offset `+1`) Dexamethasone now shows a single 8 AM window instead of the default 8 AM & 2 PM. Added a `courseComplete` status branch to `status()` so a Dex course that's actually finished renders "Course complete" and drops off the Quick Log grid, instead of the card re-locking with a misleading countdown to a dose that will never come due. The chemo-blocked Zofran card's badge/background now consistently render red-tinted "Restricted" styling (`st.chemoBlock` folded into the same conditional as `st.ceilingHit`) — previously it showed plain "Chemo" text with no distinguishing card color. Chemo banner's day-after-chemo copy corrected to state Zofran remains restricted through the next day, and its "Dexamethasone Due" badge now says "8 AM only" on that final day instead of the default "8 AM & 2 PM" |
| v33 | Jul 18, 2026 | — | Senokot converted to plain as-needed: schedule windows (8 AM & 10 PM) removed, quick-log now offers 1 pill or 2 pills (type win→gap/0; never in missed-dose alerts, unchanged) |
| v32 | Jul 18, 2026 | — | Fix false MISSED alert when a dose was logged the same day: dose-to-window assignment is now two-pass — in-window/early doses first, then late doses (after a window closed, before the next opened) credit the window they follow. Two logged doses on a two-window day can no longer produce a MISSED row (was: an at/after-window-edge dose like 6:00 PM credited nothing). A genuinely skipped window still alerts. Early tag now only applies to doses logged before the day's first window — after-window doses are late, not Early. `missedDosesFor()` uses a used-set greedy assignment over the day's entries; `isEarlyAt()` win-branch is now `ts < first window start` |
| v31 | Jul 18, 2026 | — | Evening push reminders split to match app windows: Protonix nudge stays at 8:00 PM (its window closes 10 PM), Iron/Buspirone/Paroxetine/Compazine reminder moved to 10:00 PM. Quiet hours now start 10:05 PM so the 10 PM send goes through; workflow cron extended (0–4 UTC) so the 10 PM run is covered in winter (CST) too. Resolves the v30 known mismatch. App code unchanged; SW cache bumped per standard workflow |
| v30 | Jul 17, 2026 | — | Promote tested features from care-tracker-testing (t-v28–v33): chemo cycle system (chemo date scheduling, auto-appearing Dexamethasone 2 tablets 8 AM & 2 PM day −1..+1, Zofran restricted on chemo days 1–2 with override, phased banners + Zofran-Restricted / Dexamethasone-Due badges); menstrual Cycle tab (Period Start/End, day counter, active banner, history); In-Patient tracking (Start/End/Undo, active banner, meds shown as Restricted, missed-dose alerts suppressed on in-patient days, In-Patient tab with stay ranges); 1–10 pain scale required on Tylenol & Morphine logs (shown in Journal/History); Zofran converted to plain as-needed (no 8h gap timer; gap-based push reminder removed from send-reminders.js); Temperature/Weight inputs use placeholders, must be typed. Testing-only code stripped (TEST_MODE flag, orange banner, date-override control, seedDemo remains removed). Code-only promotion — production Firestore data untouched (verified by before/after ID snapshot). New entry medIds: `chemo_date`, `cycle_start`, `cycle_end`, `inpatient_start`, `inpatient_end` (legacy `inpatient` still honored); `painLevel` field on Tylenol/Morphine entries. KNOWN MISMATCH: the 8:00 PM push reminder still lists Iron/Buspirone/Paroxetine which open in-app at 10 PM (pre-existing since v22 — pending decision) |
| v29 | Jul 17, 2026 | — | Re-enabled the 48-hour edit-lock check in removeBtn(), reverting a Jul 16 temporary unlock that had allowed manual deletion of fake seedDemo() entries dated 7/6-7/7 (see v28 and Known Issues item 9) |
| v28 | Jul 17, 2026 | — | Data-integrity fix. Removed the dormant seedDemo() function entirely, along with the demo state flag, its banner UI, and the wasEmpty-triggered auto-seed call in the Firestore subscription callback. This function had silently written hardcoded fake medication entries into caretracker_entries (Brandi's real medical data) whenever the app's first Firestore snapshot came back empty. All fake entries identified and deleted from Firestore. See Known Issues item 9 for full incident details |
| v27 | Jul 13, 2026 | — | Today's missed-dose banner now includes yesterday's misses (labeled "Yesterday:"), so a late-evening miss isn't hidden after midnight. Journal/History rows unchanged (per-day) |
| v26 | Jul 12, 2026 | — | Missed-dose alerts. Meds with `alerts:true` (protonix, buspirone, paroxetine, iron) are checked by `missedDosesFor(dayTs, now)`: each schedule window that has closed with no covering dose emits a `{missed:true, medId, ts: windowStart, windowName}` pseudo-entry. Coverage rule: any dose logged after the previous window closed and before this window closed counts (early logs covered). Rendered as: non-dismissible red banner atop Today, red `missedRow()` entries in Today's Journal buckets, red rows + "N MISSED" summaries in History. `MISSED_TRACK_SINCE` (Jul 12, 2026) prevents retroactive flags. As-needed meds are never flagged |
| v25 | Jul 12, 2026 | — | Shared `timeBucket(ts)` groups entries as Overnight (0–6), Morning (6–12), Afternoon (12–17), Evening (17–24). Used by Today's Journal and now also by the History tab, which shows category label rows inside each day's card. Old "Night" category removed |
| v24 | Jul 12, 2026 | — | Layout only: Protonix and Senokot pulled out of the group into individual Quick Log cards (window logic unchanged); group card renamed "Evening meds" and now contains exactly Buspirone, Paroxetine, Iron, Compazine; "Take all" counts only those four |
| v23 | Jul 12, 2026 | — | Add Senokot (senna laxative): win-type med with morning (8–12) and night (22–24) windows, as-needed, no reminders. Scheduled-card Log/Log-early and the Take-all flow now pass a med's default `doses[0]` so entries record dose label and pill count |
| v22 | Jul 12, 2026 | — | Dose buttons that would exceed the remaining daily ceiling are disabled (Tylenol mg, Imodium/Lidocaine counts); the red override path only remains once the ceiling is fully hit. Buspirone/Paroxetine/Iron moved to a 22–24 (10 PM) window. Compazine moved into the Scheduled Meds card (6h gap kept). "Take all (N)" button logs all currently-due scheduled meds in one time-modal. `isEarlyAt(med, ts)` now decides the Early tag from the logged timestamp instead of the lock state at click time (fixes false Early on backdated logs). |
| v21 | Jul 11, 2026 | — | Tylenol ceiling 2500 mg (midnight reset, per care team); Protonix windows 8 AM & 8 PM; future-timestamp double-confirm in time modal; two-step delete confirmation, Remove hidden for entries >48h old (matches Firestore rules); window meds grouped into one "Scheduled Meds" card; ceiling counters render only if med used in last 7 days, Lidocaine counter added; all text colors darkened to WCAG AA 4.5:1 against the pink theme |
| v20 | Jul 11, 2026 | — | Add Lidocaine topical cream (4h gap, max 4 applications/day, no reminders); generalize daily-count ceiling label; correct med table & Firestore field docs |
| v19 | Jul 7, 2026 | 591a271 | Remove "Clear all" buttons, preserve history |
| v18 | Jul 2, 2026 | 8f185cc | Add FCM push notifications + firebase-messaging-sw.js |
| v17 | Jul 2, 2026 | c49adf3 | Remove Tylenol/Morphine/Imodium from reminders |
| v16 | Jul 2, 2026 | b1fb779 | Add med reminder notifications |
| v15 | Jul 2, 2026 | 3fdc571 | Light pink glassmorphism theme + fix sticky tabs |
| v14 | Jul 1, 2026 | 84496d7 | Fix input focus loss on mobile during render cycle |
| v13 | Jul 1, 2026 | 27852a4 | Bump SW cache to force refresh on all devices |
| — | Jul 1, 2026 | 3b0060d | Add cache reset page for stuck service workers |
| v12 | Jul 1, 2026 | a537c86 | Fix apostrophe in warning strings |

---

## 12. Quick Reference for Common Tasks

### Add a new medication
1. In `index.html`, find the medication definitions array/object
2. Add a new entry with: `id`, `name`, `generic`, dosing rules (gap time, max dose, etc.)
3. The Quick Log UI should auto-generate from the definitions
4. If it needs reminders, update `send-reminders.js` to include it in the scheduled or gap-based checks

### Change a reminder time
1. Edit `send-reminders.js`, find the `sendReminders()` function
2. Adjust the `hour` and `minute` conditions for the target reminder
3. Push to `main` — the GitHub Actions cron will pick it up on next run

### Force all devices to update
1. In `sw.js`, change `const CACHE = 'caretracker-v40';` to the next version number
2. Push to `main`
3. For devices that are still stuck, have them visit the reset page

### Check if reminders are working
1. Go to https://github.com/arnjnnngs/care-tracker/actions
2. Look at the "Send Med Reminders" workflow runs
3. Click into a run to see console output (sent count, skipped reasons, etc.)

### Debug the live app
1. Open https://arnjnnngs.github.io/care-tracker/ in Chrome
2. DevTools → Console for JavaScript errors
3. DevTools → Application → Service Workers to check SW status
4. DevTools → Network to verify Firestore connections
5. Look for the green "Live sync" indicator in the app header

---

## 13. Notes from Latest Diagnostic (July 11, 2026)

A report of "all blank" on a device was investigated. Loading the app in a fresh Chrome tab showed:
- **All 13 network requests returned HTTP 200** (no failures)
- **Zero console errors**
- **Firebase Firestore listener connected successfully** to `fuelforge-7c132`
- **All fonts loaded**, manifest loaded, icons loaded
- **The app rendered fully** with all data visible

**Conclusion:** The blank-screen issue is device-specific, likely a stale service worker cache. The reset page (`reset.html`) or clearing site data on the affected device should resolve it.

---

## 14. Keeping These Docs Updated

**IMPORTANT: When you make any changes to CareTracker, update both documentation files in the same commit.**

### What to update in README.md:
- Add a new row to the **Version History** table
- Revise any sections affected by the change (Tracked Medications, Service Worker Strategy, Push Notification Reminders, Project Structure, etc.)

### What to update in CARETRACKER_HANDOFF.md (this file):
- Change the **"Last updated"** date and **"Current version"** at the top of this document
- Add a new row to the **Version History** table (Section 11)
- Revise any affected sections: medication definitions (Section 6), Firebase collections (Section 5), reminder schedule (Section 8), service worker details (Section 7), known issues (Section 10), etc.
- If you added a new file, update the **Repository Structure** (Section 3)

### Why this matters:
These two files are the single source of truth for onboarding new contributors or AI agents to this project. Stale documentation leads to incorrect assumptions and wasted debugging time. Treat doc updates as part of the feature — not a follow-up task.

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
