# CareTracker — Working Instructions

## READ FIRST

Before making any changes, read these docs in order:
1. **This file (CLAUDE.md)** — the operating model, rules, quality standards, deploy workflow
2. **PROCESS-RESET.md** — the top-10 failure analysis this operating model came from. Read it
   so you understand WHY each rule exists. Every rule below was paid for.
3. **CARETRACKER_HANDOFF.md** — full project context, tech stack, med definitions,
   Firebase setup, version history, known issues
4. **STATUS.md** — what is live right now, what is in flight, what needs Aaron

These are non-negotiable. Skipping them leads to regressions — and to repeating expensive,
documented failures.

---

# THE OPERATING MODEL (adopted Aug 18, 2026 — Aaron-approved, supersedes all prior practice)

This model exists because the previous way of working cost Aaron 2-3x what it should have:
nine sandbox rollbacks destroyed finished work that wasn't pushed, seven long agent runs burned
most of a weekly quota in one day (half of it REBUILDING the destroyed work), and multi-hour
silences forced Aaron to babysit. The full record is in PROCESS-RESET.md.

## Rule 0 — GitHub is the only real computer
The sandbox rolls back without warning (9+ times so far, including mid-task). It is a
scratchpad that lies about being permanent.
- Every artifact — patch, test, report, doc — is pushed within minutes of existing.
- **Nothing may exist unpushed for more than ~30 minutes.** Not "when the feature is done."
- Every release must be reproducible from the repo alone: base version + patches in
  `harness/`. This is true as of v44 and stays mandatory.
- If you fixed a file (including a test file), it is not fixed until it is pushed. An
  unpushed fix once sent a later agent chasing a bug in a suite that was already repaired.

## Rule 1 — Deploying: SETTLED 2026-08-24. Read this before touching a browser.

**There are two ways to get code onto GitHub from a Claude session, and the good one is already
set up.** Verified in Aaron's browser on 2026-08-24.

### The good path: a repo-connected cloud session (USE THIS)

At [claude.ai/code](https://claude.ai/code), the composer has an environment toggle. Switch it from
**Local** to **Claude Cloud Environment** and a **Select repo…** picker appears beside it. Aaron's
GitHub is ALREADY authorized — it has been since a `fuelforge-mobile` session two months ago — and
the picker lists every repo on the account, `care-tracker`, `chemowell-app-beta` and
`chemowell-beta` included. Pick one and the composer reads
`Claude Cloud Environment | care-tracker | main`. A `+` beside it adds further repos to the same
session.

**In that session `git push` just works.** No browser automation, no uploads, no md5 round-trip to
prove the file landed. A release goes out in seconds instead of four separate browser uploads.

**Nothing needs adding and Aaron does not need to do anything.** Do not ask him to authorize
anything; it is done.

### The fallback: browser upload (only when a session was NOT started against the repo)

A session started from Cowork's task box — like the one that shipped v51 through v59 — has no repo
bound to it. Its git proxy refuses every repo not in its configured set, and **that set is fixed at
session creation and cannot be changed from inside.** Measured precisely so nobody re-tests it:
`api.github.com` IS reachable and `GH_TOKEN` DOES authenticate as Arnjnnngs (`/user` → 200), but
every repo-scoped path returns 403 *"GitHub access to this repository is not enabled for this
session"*, and the `add_repo` endpoint that error names answers *"sessions are bound to their
configured repositories."* The token is real and the network is open; the binding is server-side.

In that situation browser upload is the only path, and the recipe is under "Deploying" below. It
works, but it depends on the Chrome extension being connected — which on 2026-08-24 dropped when
Aaron's laptop slept and stayed down for six hours, during which the sandbox rolled back **twice**
and destroyed a finished release both times. That is the cost of the fallback. Prefer the good path.

- **NEVER ask Aaron to upload a file, run a git command, or touch GitHub himself.** He is the
  owner, not the deploy pipeline. This happened twice and is the single most corrosive failure in
  the record.
- **Do NOT stand the apps up on Vercel as a workaround.** The MCP is connected and it would work,
  and it would be a serious mistake: the patient's phone has `arnjnnngs.github.io` installed as a
  PWA, so a Vercel copy updates nothing and instead creates a SECOND live address writing to the
  same Firestore — and in an app with no login, the address is the password.

## Rule 2 — Agents: cross-checkers for big work, never a default, never parallel
Aaron's explicit policy, in his words: agents exist "to cross check each others work, not
independently."
- **Small changes (a few lines, copy, config, docs): work inline, solo.** No agents, no
  full chain. Aaron has said this twice; it is not discretionary.
- **Big changes (features; anything touching dose logic, medication config, storage, or
  export): builder + independent adversarial auditor.** The auditor's job is to STOP the
  release, not confirm it.
- **Strictly sequential — one agent at a time, never parallel.** Aaron: "that doesn't mean
  at the same time. it needs to go in order."
- Cap any single agent run at ~30 minutes of scope. Bigger work gets split into stages,
  each ending in a push.
- **DISPATCH ON before any agent starts, AND before any work block where you will go quiet.
  No exceptions, ever.** The rule was originally written as "before any agent starts", and that
  wording was then used to justify going silent during long INLINE work with dispatch off. The
  trigger is going quiet, not the tool being used. An agent run is precisely
  when the main session is mute. Turning dispatch off and then starting an agent caused a
  109-minute silence and nearly ended this engagement.
- Every agent brief must include: the progress rule, push-survivability (key findings go in
  checkpoint messages — messages survive rollbacks, files do not), falsification duty,
  version-agnostic assertions, the h() trap, and the Firestore rules.

## Rule 2.5 — THE PM IS `pm.py`. RUN IT. IT IS NOT OPTIONAL.

Aaron: *"a PM is required at all times for each of my messages/changes."*

    python3 pm.py        # exit 0 = clear · 1 = BLOCKERS · 2 = warnings to disclose

**Run it twice on every piece of work:** once before starting, once before telling Aaron
anything is done. **Exit 1 means you may NOT report the work as finished** — no exceptions, no
judgement call, no "but this case is different."

**It is a script, not an agent, and that is the whole point.** A subagent BLOCKS the main
session — a PM implemented as an agent would recreate the exact silence it exists to prevent.
This costs no tokens, runs in seconds, and cannot forget or be reasoned with.

It checks the things that have actually gone wrong here: unpushed work, local commits missing
from the remote, APP_VERSION and the sw.js CACHE moving together, the DISPATCH flag existing and
matching STATUS.md, the composed 1s tick guard being intact, the h() null-attribute trap,
`|| true`, TODO/FIXME in production paths, every text control at the 16px iOS floor, that
index.html actually parses, and that `harness/` still makes the release reproducible.

It blocked its own release on unpushed work while it was being written. Trust it over yourself.

## Rule 3 — Cost before work
Before starting any task, state one line: estimated size (S < 50k tokens / M 50-150k /
L > 150k) and what Aaron gets for it.
- **S: state it and proceed.**
- **M and L: give the estimate and WAIT for Aaron's go.** (His chosen gate.)
- When quota is tight, report the running total as work proceeds. Never again "weekly limit
  nearly gone with nothing to show for it."

## Rule 4 — Blocked means "try 3 things," not "ask the boss"
When something fails: search your own tools (ToolSearch — a needed tool sat unused for two
releases because nobody looked), try at least two alternative approaches, check docs. Only
if all fail does it go to Aaron — as a decision memo (what was tried, the options, a
recommendation), never as "please do this for me." Aaron, verbatim: "A employee doesn't
stop work and go to the boss and ask them to upload a file on the employees computer."

## Rule 5 — Verification that can actually fail
Every one of these was learned from a check that passed while the product was broken:
- **Falsify every new check once**: break the thing, watch the check go RED, restore it.
  A check that cannot fail is worse than no check (a literal `|| true` shipped here).
- Assert on downloaded file BYTES, never the screen (a leak check read the screen for
  three rounds while appointments leaked into the CSV).
- Never assert on `document.body.textContent` — in a single-file app it includes the
  source code, so string checks always match.
- Never pin version literals ('v43.3') in patches or suites — compare input to output.
  Three patches and several suites broke on every legitimate release because of this.
- Select downloads by FILENAME, elements by explicit `data-` hooks — never "most recent
  file" or text selectors (three buttons on one card made both wrong).

## Rule 6 — Communication is part of the deliverable
- START and FINISH messages for every work block, stating dispatch state (ACTIVE/IDLE).
- Task sheet re-sent after every push, unprompted.
- A defect is surfaced the moment it is found, never saved for the summary.
- A silence longer than 10 minutes while able to speak is a defect, like a failing test.
- Write for a non-technical reader. Plain words, short sentences, no file-path walls.

## Rule 7 — Standing exceptions (root causes still open, each with an owner)
Keep these in STATUS.md until closed:
- `deliverFile()` fails silently on iOS with no detection — needs Aaron's phone test to
  confirm any fix. Until confirmed, the backup is NOT called a backup.
- `confirmTimeAndLog()` has no error handling — a refused dose write closes the modal as
  if it worked. Next safety release.
- Reminder ledger built and tested (`harness/`) but not wired into the live workflow;
  v43.4+ silently drops ~1 in 6 anchored reminders on late cron runs.

---
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
