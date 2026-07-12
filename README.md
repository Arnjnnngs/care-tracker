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
| Tylenol | Acetaminophen | 24h rolling limit (4000 mg), 4h min gap, 500/1000 mg doses |
| Zofran | Ondansetron | 8h gap timer, push notification when available |
| Compazine | Prochlorperazine | Dose logging |
| Morphine | Immediate release | Dose logging |
| Imodium | Loperamide | 24h pill count limit (4 pills) |
| Protonix | Pantoprazole | Scheduled (morning/evening reminders only) |

## Vitals Tracking

- **Temperature** — logged in °F with timestamp
- **Weight** — logged in lbs with timestamp
- Both display last reading time and have dedicated input + "Log" button

## App Views

- **Today** — current day's med trackers, vitals inputs, quick-log med cards
- **History** — historical view of logged entries
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
