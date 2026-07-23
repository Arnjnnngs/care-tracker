# CareTracker — AI Agent Handoff Document

> **Purpose:** Complete context for any AI assistant to understand, maintain, and extend the CareTracker project without prior knowledge.
>
> **Last updated:** July 22, 2026
> **Current version:** v42

---

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
