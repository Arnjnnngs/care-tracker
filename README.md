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
│   └── reminders.yml            # Cron job: med reminder notifications
├── firebase-messaging-sw.js     # FCM service worker for background push
├── icon-192.png                 # PWA icon (192x192)
├── icon-512.png                 # PWA icon (512x512)
├── index.html                   # Main app (all HTML/CSS/JS in one file)
├── manifest.webmanifest         # PWA manifest
├── reset.html                   # Cache reset utility for stuck service workers
├── send-reminders.js            # Node.js script for sending FCM notifications
└── sw.js                        # Service worker (caching + notification clicks)
```

## Firebase Collections

| Collection | Purpose |
|---|---|
| `caretracker_entries` | All logged data — meds, temperature, weight |
| `fcm_tokens` | Registered device tokens for push notifications |
| `fcm_tracking` | Tracks last-notified timestamps to prevent duplicate alerts |

## Service Worker Strategy

- **Cache name:** `caretracker-v19` (bump this to force updates on all devices)
- **Static assets (cache-first):** `./`, `index.html`, `manifest.webmanifest`, icons
- **Firebase/API calls (network-first):** `firestore.googleapis.com`, `gstatic.com`, `googleapis.com` — falls back to cache if offline

## Push Notification Reminders

The GitHub Actions workflow (`reminders.yml`) runs `send-reminders.js` every 30 minutes from 8 AM–10 PM CDT. It sends two types of reminders:

**Scheduled (time-based):**
- **8:30 AM** — Morning Meds: Protonix (morning) & Zofran
- **8:00 PM** — Evening Meds: Protonix, Iron, Buspirone, Paroxetine, Compazine

**Gap-based:**
- **Zofran** — checks if 8-hour gap since last dose has elapsed; sends "Zofran Available" notification. Uses `fcm_tracking/zofran_gap` doc to avoid duplicate alerts.

**Quiet hours:** No notifications between 10 PM and 8 AM Central.

## Tracked Medications

| Medication | Generic | Tracking Type |
|---|---|---|
| Tylenol | Acetaminophen | Daily limit (2500 mg, resets midnight), 4h min gap, 500/1000 mg doses |
| Zofran | Ondansetron | 8h gap timer, push notification when available |
| Compazine | Prochlorperazine | 6h min gap; 10 PM routine + earlier as needed (in Scheduled Meds card) |
| Morphine | Immediate release | 4h min gap, ½ tab (7.5 mg) / full tab (15 mg) doses |
| Lidocaine | Topical cream | 4h min gap, max 4 applications per day |
| Imodium | Loperamide | Daily pill count limit (4 pills) |
| Protonix | Pantoprazole | Twice daily windows (8 AM–noon, 8–10 PM) + reminders |
| Buspirone | BuSpar | Once daily, 10 PM |
| Paroxetine | Paxil | Once daily, 10 PM |
| Iron | Ferrous sulfate | Once daily, 10 PM |
| Senokot | Senna | 2 pills, 8 AM & 10 PM windows, as needed |

## Missed Dose Alerts

Protonix, Buspirone, Paroxetine, and Iron are tracked for missed doses. When one of their schedule windows closes with no dose logged, the app shows a red alert banner at the top of Today (covering today's and yesterday's misses, so an overnight miss is still visible the next morning), a red MISSED row in Today's Journal under the matching time category, and red MISSED rows plus a "N MISSED" day summary in History. A dose logged early (before the window opened, same day) counts as covering that window. As-needed meds (Senokot, Compazine, Tylenol, Zofran, Morphine, Lidocaine, Imodium) are never flagged. Tracking starts July 12, 2026 — no retroactive flags before that date.

## Vitals Tracking

- **Temperature** — logged in °F with timestamp
- **Weight** — logged in lbs with timestamp
- Both display last reading time and have dedicated input + "Log" button

## App Views

- **Today** — dose counters (shown only for meds used in the last 7 days), vitals inputs, individual quick-log cards (incl. Protonix and Senokot), and a grouped "Evening meds" card for Buspirone/Paroxetine/Iron/Compazine with a one-tap "Take all" button
- **History** — historical view of logged entries, grouped per day into Overnight (12–6 AM), Morning (6–noon), Afternoon (noon–5 PM), Evening (5 PM–midnight)
- **Weight** — weight tracking over time

## Troubleshooting: "All Blank" / Stale Cache

If the app shows a blank screen on a device:

1. Visit https://arnjnnngs.github.io/care-tracker/reset.html — this automatically unregisters all service workers, clears all caches, and redirects back to the app
2. Or manually: Chrome DevTools → Application → Service Workers → Unregister, then hard refresh
3. On mobile: Settings → Site settings → arnjnnngs.github.io → Clear & reset

When deploying new versions, bump the `CACHE` constant in `sw.js` (currently `caretracker-v19`).

## GitHub Secrets Required

| Secret | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON service account key for firebase-admin (used by `send-reminders.js`) |

## Version History

| Version | Date | Changes |
|---|---|---|
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
