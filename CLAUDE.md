# CareTracker — Working Instructions

## READ FIRST

Before making any changes, read these docs in order:
1. **This file (CLAUDE.md)** — rules, quality standards, deploy workflow
2. **CARETRACKER_HANDOFF.md** — full project context, tech stack, med definitions,
   Firebase setup, version history, known issues

These are non-negotiable. Skipping them leads to regressions.

## What this project is

CareTracker is a real-time medication & vitals tracker PWA for patient Brandi.
Single-file vanilla JS app (`index.html`) — no framework, no build step.
Firebase Firestore (fuelforge-7c132) for data, GitHub Pages for hosting.

**Live:** https://arnjnnngs.github.io/care-tracker/
**Repo:** https://github.com/arnjnnngs/care-tracker

## Quality standards

- Own every task end-to-end. Don't hand back anything you haven't verified.
- "Should work" is not acceptable. **Prove it works** — test on the live site.
- When Aaron pushes back, treat it as a real bug.
- Don't ask permission to proceed — execute.
- One short paragraph of reasoning before code, not a wall of plan.

## Deploy workflow (mandatory, every change)

1. **Edit** `index.html` (and any other files needed)
2. **Bump SW cache version** in `sw.js` — e.g., `caretracker-v27` → `caretracker-v28`.
   This is critical. Skipping it means devices get stale code.
3. **Update docs** in the same commit — both `README.md` and `CARETRACKER_HANDOFF.md`.
   Add version history row, update any affected sections, bump "Current version" at top.
4. **Push to main** — GitHub Pages auto-deploys within ~1 minute
5. **Verify on the live site** — open the app, confirm changes work, zero console errors
6. **Save a rollback bundle** before making changes (copy of index.html + sw.js at
   previous version) so we can revert if needed

## Time-of-day categories (v25+)

Used everywhere — Today's Journal and History. One shared `timeBucket()` function:
- **Overnight** — midnight to 6 AM
- **Morning** — 6 AM to noon
- **Afternoon** — noon to 5 PM
- **Evening** — 5 PM to midnight

## Med layout (v24+)

- **Individual cards (Quick Log):** Tylenol, Zofran, Morphine, Lidocaine, Imodium,
  Protonix, Senokot
- **Evening Meds group card:** Buspirone, Paroxetine, Iron, Compazine
- **"Take all" button** counts only Evening Meds group members

## Missed dose alerts (v26+)

Tracked meds (have `alerts: true`): Protonix (both windows), Buspirone, Paroxetine, Iron.
As-needed meds are NEVER flagged. Alerts show as: red banner atop Today (includes
yesterday), red rows in Journal and History, "N MISSED" in History day summaries.
`MISSED_TRACK_SINCE` prevents retroactive flags before July 12, 2026.

## Firebase security rules (published July 2026)

- Append-only: no edits to existing entries
- Deletes blocked after 48 hours
- Junk/malformed writes rejected
- Server collections (fcm_tracking) sealed from client
- The UI hides the Remove button for entries older than 48h to match

## Critical gotchas

- **Always bump SW cache** — devices will show stale/blank content without it
- **Duplicate Firebase config** — appears in both `index.html` and
  `firebase-messaging-sw.js`. Keep them in sync.
- **No authentication** — app is open to anyone with the URL
- **Shared Firebase project** — fuelforge-7c132 is also used by FuelForge app.
  Don't modify project-level settings.
- **Timezone hardcoded** — America/Chicago (Central Time) in reminders and display
- **Single-file architecture** — entire app is `index.html`. Edit carefully.
- **reset.html** — send users here if they see blank screen (nukes SW cache)

## Nightly backup

Scheduled task runs at ~3 AM, fetches all Firestore entries via REST API, saves CSV.
If entry count ever drops below previous backup, flag as possible data loss.

## Testing checklist

Before declaring any change done:
- [ ] SW cache version bumped in `sw.js`
- [ ] Docs updated (README.md + CARETRACKER_HANDOFF.md) in same commit
- [ ] Deployed to GitHub Pages
- [ ] Verified on live site — changes visible, zero console errors
- [ ] Rollback bundle saved for previous version
- [ ] Edge cases tested (empty states, boundary times, multiple doses)
