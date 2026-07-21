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

- **Cache name:** `caretracker-v40` (bump this to force updates on all devices)
- **Static assets (cache-first):** `./`, `index.html`, `manifest.webmanifest`, icons
- **Firebase/API calls (network-first):** `firestore.googleapis.com`, `gstatic.com`, `googleapis.com` — falls back to cache if offline

## Push Notification Reminders

The GitHub Actions workflow (`reminders.yml`) runs `send-reminders.js` every 30 minutes from 8 AM–10 PM CDT. It sends two types of reminders:

**Scheduled (time-based):**
- **8:30 AM** — Morning Meds: Protonix, Buspirone, Paroxetine (default 8 AM–noon window; if Protonix's actual morning dose logs later, a follow-up fires 2h after that instead)
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
| Buspirone | BuSpar | Once daily, with Protonix in the morning (8 AM–noon default; shifts to 2h after Protonix's actual morning log if later, open through end of day) |
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

| Version | Date | Changes |
|---|---|---|
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
