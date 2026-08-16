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

## Progress updates — MANDATORY, not a courtesy

Aaron has had to ask for this repeatedly. It is now a rule, and it applies to every session, every
agent, and every task in this project.

**Never go more than ~10 minutes of wall-clock work without telling Aaron something.** Long silences
are the single most common complaint on this project. He is a non-technical founder who cannot see
the terminal — silence reads as "nothing is happening" or "it broke."

**Checkpoint at every one of these, without being asked:**

- Before starting anything that will take more than a few minutes — say what it is and roughly how long
- When a long-running job starts (an audit, a mutation sweep, a browser suite): say what launched, what it is checking, and the expected duration
- When it finishes: the result, in one or two plain sentences
- The moment a defect is found — do NOT save it for a summary at the end
- When the plan changes, or something turns out harder than stated
- Before asking him to do anything manual
- When blocked, immediately, with what is needed to unblock

**Write for a non-technical reader.** "Running the audit, about 20 minutes, it's checking whether the
fix breaks anything else" — not a wall of file paths and function names.

**Use the task list** (TaskCreate / TaskUpdate) so he can see state at a glance, and **deliver files as
they are produced** (SendUserFile), not batched at the end. The sandbox has wiped hours of work
repeatedly; anything not delivered or pushed can vanish.

**When delegating to a subagent, put this rule in the agent's brief.** An agent that works silently
for 20 minutes and returns a report is the same failure, one level down. Agents should be told to
report the headline finding first, not bury it.

**A silence longer than 10 minutes is a defect in the work, exactly like a failing test.**

## Deploying — the path that actually works

`git push` is blocked in the Claude sandbox: the git proxy refuses any repo not in the session's
authorized source list, with *"not in this session's authorized repository set."* That is a session
setting and cannot be changed from inside. **Do not stop there and hand Aaron a zip file to upload —
that wasted his time twice.**

The working path, entirely automated, no manual step for Aaron:

1. Copy the files to be shipped into `/mnt/user-data/outputs/` (the `file_upload` tool only accepts
   paths the session has shared; a path under `/home/claude` is rejected).
2. Open `https://github.com/<owner>/<repo>/upload/<branch>` in Chrome.
3. `find` the file input ("choose your files"), then call **`mcp__claude-in-chrome__file_upload`**
   with the ref and the absolute paths. Do NOT click the input — that opens a native picker that
   cannot be driven. Limit is 10 MB per call.
4. Fill the commit summary and description, then click **Commit changes**.
5. **Verify, always:** re-clone the repo and compare md5 of each file against what was built, then
   wait ~60-90s for GitHub Pages and fetch the live URL with a cache-buster to confirm the deployed
   `APP_VERSION` and `sw.js` CACHE actually changed. Pages lags the commit; checking too early shows
   the old version and looks like a failure.

`mcp__claude-in-chrome__file_upload` is a DEFERRED tool — it must be loaded with ToolSearch before it
can be called, which is why it was missed for two releases. Load it up front alongside the other
browser tools.

**Committing to `care-tracker` is committing to a live patient's app.** Aaron's explicit go-ahead is
still required before the first push of a change; it does not need re-asking for a verification
re-run or a follow-up commit within work he has already authorized.

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
