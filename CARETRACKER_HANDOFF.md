# CareTracker — AI Agent Handoff Document

> **Purpose:** Complete context for an AI assistant (Fable or any Cowork model) to understand, maintain, and extend the CareTracker project without prior knowledge.
>
> **Last updated:** July 11, 2026  
> **Current version:** v23

---

## 1. What This Project Is

CareTracker is a **progressive web app (PWA)** that tracks medications, temperature, and weight for a family caregiver (caring for Brandi). It is a **single-file vanilla JavaScript app** — no build step, no framework, no node_modules for the frontend. The entire app lives in `index.html` (1042 lines, 61.7 KB). Firebase Firestore provides the database with real-time sync, and Firebase Cloud Messaging (FCM) handles push notification reminders.

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
│   └── workflows/
│       └── reminders.yml            # GitHub Actions cron — sends med reminders every 30 min
├── firebase-messaging-sw.js         # FCM service worker — handles background push notifications
├── icon-192.png                     # PWA icon 192x192
├── icon-512.png                     # PWA icon 512x512
├── index.html                       # THE ENTIRE APP — HTML + CSS + JavaScript (1042 lines)
├── manifest.webmanifest             # PWA manifest (name, icons, theme, display mode)
├── reset.html                       # Utility page — nukes service workers + caches, redirects to app
├── send-reminders.js                # Node.js server-side script — queries Firestore, sends FCM pushes
└── sw.js                            # App service worker — caching strategy + notification click handler
```

**There is no build step.** Edits to `index.html` are deployed by pushing to `main` — GitHub Pages serves from the root of `main`.

---

## 4. Tech Stack Details

### Frontend
- **Language:** Vanilla JavaScript with ES modules (`<script type="module">`)
- **Rendering:** Custom reactive rendering (not React/Vue/etc. — vanilla DOM manipulation)
- **Styling:** Inline `<style>` block in index.html — dark theme with glassmorphism elements
- **Fonts:** Hanken Grotesk (body) + IBM Plex Mono (monospace data), loaded from Google Fonts
- **Theme colors:** Background `#FFF0F3` (light pink, meta theme), actual rendered dark theme `#1a1a2e`-ish, accent green `#0F9D6B`

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
- `medId` — string identifier: `"tylenol"`, `"zofran"`, `"compazine"`, `"morphine"`, `"lidocaine"`, `"imodium"`, `"protonix"`, `"buspirone"`, `"paroxetine"`, `"iron"`, `"senokot"`, or `"temp"` / `"weight"` for vitals
- `ts` — timestamp (milliseconds since epoch) of when the dose was taken
- `dose` — human-readable dose label string (e.g., `"1000 mg"`, `"½ tab · 7.5 mg"`, `"99.8 °F"`) or null
- `mg` — numeric milligrams (0 for non-mg meds)
- `pills` — count for pill/application-limited meds (Imodium, Lidocaine); only present when applicable
- `temp` / `weight` — numeric value on vitals entries
- `override` — boolean, present when the dose was logged early past a lock

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
| `zofran` | Zofran | Ondansetron | 8-hour gap between doses. Shows countdown timer. Push notification when gap expires |
| `compazine` | Compazine | Prochlorperazine | 6-hour min gap. 10 PM routine, earlier as needed. Shown in the Scheduled Meds card, not Quick Log |
| `morphine` | Morphine | Immediate release | 4-hour min gap. Quick-log buttons: ½ tab (7.5 mg), full tab (15 mg) |
| `lidocaine` | Lidocaine | Topical cream | 4-hour min gap. Daily max: 4 applications (resets at midnight). Quick-log button: Apply |
| `imodium` | Imodium | Loperamide | Daily limit: 4 pills (resets at midnight). Quick-log buttons: 2 pills, 1 pill |
| `protonix` | Protonix | Pantoprazole | Twice daily windows: morning (8–12) & evening (20–22). Early logging allowed via override |
| `buspirone` | Buspirone | BuSpar | Once daily, 10 PM window (22–24) |
| `paroxetine` | Paroxetine | Paxil | Once daily, 10 PM window (22–24) |
| `iron` | Iron | Ferrous sulfate | Once daily, 10 PM window (22–24) |
| `senokot` | Senokot | Senna | As needed: 2 pills, morning window (8–12) & night window (22–24). Default dose "2 pills" (pills: 2) recorded on log |

### Vitals
- **Temperature** — logged in °F, shows last reading time
- **Weight** — logged in lbs, shows last reading time

---

## 7. Service Worker Architecture

### sw.js (App Service Worker)
**Cache name:** `caretracker-v19` — **bump this string when deploying changes** to force all devices to get the new version.

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

### Reminder Schedule (Central Time)

| Time | Type | Notification |
|---|---|---|
| 8:25–8:35 AM | Scheduled | "Morning Meds Due" — Protonix (morning) & Zofran |
| 7:55–8:05 PM | Scheduled | "Evening Meds Due" — Protonix, Iron, Buspirone, Paroxetine, Compazine |
| Every 30 min | Gap-based | "Zofran Available" — only if 8h gap since last dose has elapsed |
| 10 PM–8 AM | Quiet hours | No notifications sent |

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
2. **Bump the cache version** in `sw.js` — change `const CACHE = 'caretracker-v19';` to `v20`, etc.
3. Push to `main` branch
4. GitHub Pages auto-deploys within ~1 minute
5. Devices with the old service worker will pick up the new version on their next visit (the activate event deletes old caches)

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

---

## 11. Version History

| Version | Date | Commit | Changes |
|---|---|---|---|
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
1. In `sw.js`, change `const CACHE = 'caretracker-v19';` to the next version number
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
