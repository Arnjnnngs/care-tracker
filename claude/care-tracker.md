# care-tracker (WEB-MAIN) — the instructions themselves

## READ FIRST

Before making any changes, read these docs in order:
1. **This file (CLAUDE.md)** — the operating model, rules, quality standards, deploy workflow
2. **PROCESS-RESET.md** — the top-10 failure analysis this operating model came from. Read it
   so you understand WHY each rule exists. Every rule below was paid for.
3. **README.md — the section "WORKING RELATIONSHIP"**, near the top. The full record of what has
   gone wrong between Aaron and this work, in his words: the stopping-instead-of-working failure,
   the checks that could not fail, the four times a release damaged or nearly damaged the patient's
   record, the copy that told her something untrue, and what is genuinely hard from this side.
   Written at his direction on 2026-09-07 so a new chat starts where the last one ended rather than
   repeating it.
4. **CARETRACKER_HANDOFF.md** — full project context, tech stack, med definitions,
   Firebase setup, version history, known issues
5. **STATUS.md** — what is live right now, what is in flight, what needs Aaron

`NEW-CHAT-PROMPT.md` in the repo root is the prompt Aaron pastes to start a fresh session. If the
operating model changes, update that file too — it is the first thing a new session ever sees.

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

## Rule 0.5 — A RECAP IS NOT A STOPPING POINT. FINISH THE WORK IN THE SAME TURN.

Aaron, 2026-09-04, and this is the most urgent rule on the page:

> *"youre stuck or still doing the same thing. I've put you in charge of this project and you keep
> pausing instead or working bc you're giving an update. fix this first before you touch anything
> else. can't have any more delays over this"*

**The failure, exactly.** Say "I'm measuring it now, about 20 minutes, I'll come back with the
result" — and then end the turn. Nothing runs. Aaron has to send another message just to restart
work that was never blocked on him. It happened repeatedly on 2026-09-01/02 and it is the single
most expensive habit on this project after the sandbox rollbacks.

**The rule.** If the next step is something YOU can do, DO IT IN THE SAME TURN, then report. The
message announcing the work and the message reporting its result should be the same message. Rule 6
demands progress updates during long work — it never licensed stopping to deliver one. **Checkpoint
while working, not instead of working.**

**There are exactly three legitimate reasons to end a turn:**

1. **The work is genuinely finished**, verified, pushed, and `python3 pm.py` is not exit 1.
2. **Aaron has to decide something you cannot decide for him**, or has to do something only he can
   (approve a push to `main`, look at his own phone). Say so in plain words that name what you need
   — *"say the word"*, *"your call"*, *"I need you to approve X"*. A vague *"let me know how it
   looks"* tacked onto unfinished work is not this.
3. **A background agent or job is running** and the harness will wake you when it finishes. Say
   that it is running in the background. Do not also promise separate work of your own alongside it
   — that work should already be done.

**Anything else — go back and finish.** In particular these are NOT stopping points: an estimate of
how long something will take; a plan; a diagnosis; a promise to verify; "I'll fold that in";
"shortly"; "stand by". If you catch yourself writing a future-tense sentence about your own work,
that sentence is the work you should be doing instead of writing it.

**Before ending any turn, ask: did I just promise something I could have done?** If yes, the turn is
not over.

**AARON HAS NOTHING TO DO ABOUT THIS RULE. Do not ask him to install anything for it.** A Stop
hook was drafted that would refuse the stop mechanically (`outputs/STOP-HOOK-PROPOSAL.md` — the
`pm.py` principle applied to turn-ending). The permission classifier refuses to install
auto-executing hook code from a cloud session, three different ways. **The response to that was to
write him a to-do list, which broke Rule 1 — he is the owner, not the deploy pipeline, and he reads
these on a tablet.** The correct response is this: the rule stands on its own, enforced by being
read, and the draft sits in `outputs/` for any future session that CAN install it without involving
him. Never turn a blocked mechanical guard into a chore for Aaron.

## Rule 0.6 — DO NOT REPORT UNTIL IT IS DONE. (2026-09-08, Aaron, EXPLICIT, effective immediately)

> *"I'm so tired of you stopping when you should be working. You WILL NOT give me a recap of what's
> going on UNLESS I need to approve something OR until you are COMPLETE. You are giving me an update
> when you should still be fixing things and you are treating it as something that needs my prompt
> to move forward."*

**This supersedes the checkpoint guidance in Rule 6 and in "Progress updates" below, wherever the two
disagree.** Those were written to cure long silences during agent runs, and they were then used to
justify a message after every single step — which turned each one into a stopping point that waited
for a prompt that was never needed.

**WORK END TO END.** Aaron, in the same breath: *"include that you are to work end to end! the only
exceptions are the ones I mentioned."* A task is not a series of steps to be reported between — it is
one piece of work that starts when he asks and finishes when it is live. Take it from the first line
to the last: build it, check it, fix what the checks find, audit it, ship it, update the docs and the
lists, and port it to the sibling app if it belongs there. The exceptions below are the ONLY places
that sequence may be interrupted.

**There are exactly TWO reasons to send Aaron a message:**

1. **He has to approve or decide something**, named in plain words.
2. **The work is COMPLETE** — built, verified, pushed, live, `python3 pm.py` not exit 1, and the
   done / outstanding list included.

**That is the whole list.** Not "a background job is running" — start it and keep working. Not "the
audit came back and I'm fixing it" — fix it. Not "here is what I found" — fix it and say so at the
end. Not a screenshot mid-build. If a check comes back red, the next thing that happens is the fix,
not a paragraph about the fix.

**The tell.** If the message ends with anything resembling *"running in the background"*,
*"now starting X"*, or *"next I will"*, it should not have been sent. Those sentences describe work
that could have been done in the same turn instead of written about.

**Long is fine.** A turn that runs for an hour, launches four agents and ships two releases is
correct. A turn that runs for four minutes and ends with a status paragraph is the failure.

**Files are the exception, and only when they are the deliverable.** A screenshot of a finished
change is a thing he asked for; `SendUserFile` is delivery, not a recap. Never pair it with a
progress note.

## Rule 0.7 — A TASK LIST, EVERY TIME, COMPLETED IN ORDER. (2026-09-14, Aaron, and he has said it before)

> *"Every time I give you something to do, you need to create a task list and complete in order
> unless I tell you otherwise. I've said multiple times before about task list. Those notes should be
> somewhere in the md file. There probably needs to be a meeting notes taker that can keep track of
> tasks to keep you on track. This is absurd"*

**He is right that he has said it before, and right that it was not written down here. That is the
whole defect.** The Scribe seat (Rule 1.5) was described as keeping `REQUESTS.md` and
`TASK-SHEET.md` — files. It was never made to create a LIVE, ORDERED task list at the moment he
asks for something, and so the order of work was decided by whatever I found interesting.

**What that cost, exactly, on 2026-09-13/14.** Aaron approved a three-screen redesign from
screenshots and gave the order himself: *Home timeline → Meds cards + ceiling bar → Reports.* Twelve
hours later **one card of one screen existed**, in a weaker form than the mockup, because a dose-
parser defect turned into eleven audit rounds and a back-button fix turned into three ports, and
neither was the thing he asked for. Both were real. Neither was next. **There was no list, so
nothing said so.**

### The rule

1. **The moment Aaron asks for anything, create the task list — before any other tool call.** Use
   the task tools (TaskCreate / TaskUpdate), not a paragraph and not a file. It has to be the thing
   he can see at a glance.
2. **One task per deliverable, in the order HE gave**, not the order that is easiest. If he did not
   give an order, propose one in the list and start at the top.
3. **Mark in_progress before starting and completed when it is genuinely done** — done means built,
   verified and pushed, not "written".
4. **Anything found along the way becomes its own task at the BOTTOM of the list**, not a detour.
   A defect found mid-task is logged and scheduled; only a defect that makes the current task
   impossible or unsafe is allowed to jump the queue, and then it is said out loud.
5. **The list goes in the reply** whenever the work spans more than one message, so he never has to
   ask what is happening or in what order.

**This is not the Scribe's habit. It is the first action of every request.** A role whose output is
a file Aaron does not read is not a role — that lesson is already written into Rule 2.6 about the
Enhancer, and it is the same lesson here one level up.

## Rule 0.8 — THE TASK TABLE GOES IN THE MESSAGE. EVERY MESSAGE. (2026-09-14, Aaron, EXPLICIT)

> *"I don't see the list. You said you fixed it. There needs to be very frequent task table update so
> I can see what has been done when I go back to the chat occasionally. I shouldn't have to read 15
> pages of small details to see what was done. I can scroll through and see the table and see what
> was done. Commit to your record and put into place now"*

**Rule 0.7 was written and then not obeyed.** The list was created with the task tools — which render
somewhere Aaron does not look — and the replies went back to being prose. From his side that is
identical to there being no list at all. The task tools are for me; **the table in the message is for
him**, and it is the one that counts.

### The rule

1. **Every message to Aaron carries a markdown table.** Not a bulleted list, not a paragraph, not
   "see the task list" — a table, so it is a recognisable shape he can scroll to and read in five
   seconds without reading anything around it.
2. **Columns, always these four, in this order:**

   | # | App | Task | Status |

   **App is not optional** (Aaron, 2026-09-14: *"the task should show what app is being worked on.
   Bc I have no idea which one you're actually working on"*). It is one of
   `ChemoWell app` · `care-tracker` · `staging` · `all 3 repos`.
3. **The table shows the LAST 5 COMPLETED items plus everything still open.** Not open items only —
   the completed rows are the record of what happened while he was away, and they are the reason the
   table exists. Completed rows come first, oldest of the five at the top, so the eye lands on the
   open work at the bottom where the next action is.
4. **Status is one of:** `DONE — live` · `DONE — pushed, awaiting your word` · `IN PROGRESS` ·
   `QUEUED` · `BLOCKED — needs you`. A status that names a blocker names it in the same cell.
5. **Frequent means every message, including the long ones.** This does not license a status-only
   message — Rule 0.6 still governs WHEN a message may be sent (an approval he must give, or
   completion). Rule 0.8 governs what is IN a message once one is due: the table is the top of it,
   and the detail goes underneath for whoever wants it.
6. **If a task moved since the last table, the table says so.** A row that has not changed in three
   messages while work is happening means the rows are wrong — split the task.

**Why a table and not the task tools.** The task tools are a side panel in a developer's terminal.
Aaron reads this on a tablet, scrolling back through a chat, looking for the shape of a table. Output
that lands somewhere the owner does not look is not output — the same lesson as Rule 2.6's Enhancer
list and Rule 0.7's task list, now for the third time. **Third time is the rule getting a mechanism:
the table is part of the message body, so it cannot be filed anywhere else.**

### The numbers, and why the first table got them wrong (2026-09-14, same day)

Aaron, on the very first table this rule produced: *"The # on the task table is quite confusing.
It's not in order and the range jumps from 28 to 77. Is that logical for you and do you think that
makes sense to me. You put 77 bc caretracker is on v77"*

**He is exactly right and it was worse than untidy.** The `#` column is a TASK number. I put `77` in
it because care-tracker's release is v77 — a VERSION number, in a column of task numbers, in a table
whose whole purpose is to be readable in five seconds. A reader has no way to know one row is
counting a different thing from every other row.

1. **The `#` column holds task numbers and nothing else.** Never a version, never a release, never a
   commit. A version belongs in the Task cell as words: *"care-tracker v77 — back button"*.
2. **Rows are in ascending order by number**, completed five first, then open. An out-of-order list
   is a list somebody has to read twice.
3. **Every open item gets a real task number**, allocated in sequence. If something is being tracked
   without one — a blocker, a promotion waiting on Aaron — it gets a number before it gets a row.
   A row with a `—` in the `#` column is a row that was never on the list.

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

## Rule 1.5 — THE TEAM AND THE SEQUENCE (2026-09-07, Aaron-approved: "do all")

The review that produced this is `outputs/TEAM-REVIEW-2026-09-07.md`. Aaron approved every item on
it. **This section wins where it disagrees with Rules 2–2.7 below**; those stay as the record of why
each seat exists and what it missed.

### The roster

| Seat | Who | Runs | Job |
|---|---|---|---|
| **Builder** | the main session | always | Makes the change work. **States the WRITE MODEL before coding**: what this release appends, what it deletes (the answer is nothing), how it tie-breaks. v52 did this and caught two traps before a line existed; v69 did not and was built three times. |
| **Scribe** | the builder, inline (ChemoWell has had it since app-v25) | every reply | Keeps `REQUESTS.md` (every ask Aaron makes, logged the moment he makes it) and `TASK-SHEET.md` (YOURS / MINE / QUEUED / DONE). Shows done / outstanding in every reply after a build or a request, in the reply itself. |
| **Enhancer** | the builder, inline | **BEFORE the build**, on the screens it will touch | Rule 2.6's checklist. Run first so Aaron picks from the list and the build carries the pick, instead of the proposal waiting a release. |
| **Designer** | the builder, inline; an agent only for a big visual release | any release that changes layout | Every touched screen at 320, 360 and 390 wide, screenshots **SENT to Aaron as they are produced** (SendUserFile), never filed, plus a named list of what to open on the two real phones. **This sandbox has Chromium only** — an iPhone's rendering cannot be reproduced here, and that is written as exempt on every release. |
| **Voice** | **merged** into the Zero Day Auditor's brief on audited releases; the builder inline on copy-only ones | every release | Rule 2.7's three questions. As a self-check it had zero catches and one miss; the auditor's eyes are the independent ones. |
| **Zero Day Auditor** | ONE agent, in the background, dispatch ACTIVE | any release that writes, edits or deletes a record, or is big | Tries to STOP the release. Five correct blocks (v61, v66, v69 ×2, v70). Brief now also carries: identical-timestamp tie-breaks, any `removeEntryDB` on a correction path, the Voice's questions, and falsification of every new check. |
| **`pm.py`** | a script | before the build, before the auditor, before saying done | Release mechanics **plus the delete ratchet** (every shape of `removeEntryDB(...)` is pinned; a new one blocks). Exit 1 = not done. |

Not on the team, decided: a coder (Rule 2.2), a device tester (that is Aaron), a second auditor
(retired, Rule 2.7).

### The sequence — cheap before expensive, design-time before build-time

1. `python3 pm.py` · cost line (S / M / L) · Scribe shows the open list · builder states the write
   model · Enhancer table for the screens about to change.
2. Dispatch → ACTIVE at the first commit. Build inline. Push at least every 30 minutes, a message at
   every push.
3. Suites, and falsify every new check · Voice on the copy · Designer on the screens.
4. `python3 pm.py` — it is free; never spend an agent on a build pm.py would bounce.
5. **Zero Day Auditor — once, last, in the background.** Before launch: dispatch is ACTIVE and a
   message says it is running, what it is checking, and for how long (cap 30 min). BLOCK → back to
   step 2; the re-audit is a delta pass.
6. `python3 pm.py` · release message · dispatch → IDLE once live.

Never two agents. Never an agent while dispatch is IDLE. Never an inline pass promoted to an agent
"to be thorough".

### The release message — every one, in this order

What shipped · the Enhancer's list with sizes (or "nothing this time") · the auditor's verdict ·
**what is deliberately exempt and why** · what needs Aaron's phone · the Scribe's done / outstanding
list.

### "Waiting on you" — a mechanism, not a promise (Aaron, 2026-09-07)

- `TASK-SHEET.md` is split **YOURS / MINE / QUEUED**. **If MINE has an item, the turn does not end.**
  "Nothing waiting on you" may only be written when MINE is empty, and then it is unnecessary.
- **Every message ends with exactly one of three lines:** *Done, pushed, nothing for you.* ·
  *Your decision: X* (named, with a recommendation) · *Running in the background: Y.*
  "Let me know how it looks" is banned.
- **The standing queue — amends Rule 3.** Aaron approves an ORDER of work once, and items on it are
  built in sequence without re-asking. One approval per batch. Cost stays his decision; the per-item
  stop, which is where most "waiting on you" came from, is gone.

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

## Rule 2.2 — WHO CHECKS THE BUILDER. The gate is lowered. (2026-09-06, Aaron's question)

Aaron: *"who checks your work. maybe you facilitate and brainstorm and then you pass it to a coder
for the work. there needs to be someone after you checking instead of PM at the end"*

**He is right that there was a hole, and it is bigger than it looks.** Rule 2 sent an independent
auditor only at *"big changes (features; anything touching dose logic, medication config, storage,
or export)"*. Everything else was built and checked by the same person, and the only thing standing
after that was `pm.py` — which is a **release-mechanics** script, not a reviewer. It checks that the
version moved and the work is pushed. **It has never once looked at whether the code is right.**

So on a release below the "big" line, nobody checked the builder. That is exactly the class this
project keeps getting hurt by: v66 was small, and it shipped a control that permanently destroyed a
period of a patient's record.

### The rule, effective now

**Any release that WRITES, EDITS or DELETES a record gets an independent auditor before the PM,
regardless of how few lines it is.** Size stops being the trigger; touching the patient's data is.
Copy, colours, layout and config stay inline as before — Rule 2 still says small work does not get
a full chain, and that has not changed for work that cannot lose data.

By that line, v69 — which deletes a weight reading — needed an auditor and would not have got one
under the old wording. It got one.

### On passing the coding to a coder instead

**Not recommended, and here is the honest reason.** Splitting *build* from *review* is the thing
worth having; which half is the subagent barely matters. Handing the code out costs more and buys
less, because the expensive mistakes on this project have not been coding mistakes — they have been
**context** mistakes: British spellings the file does not use, a version literal pinned in a patch,
a check written so it could not fail, and this release nearly deleting *"Total drained"* — a figure
**Aaron asked for**, recorded in STATUS.md, which no fresh coder would have known to protect. A
coder briefed from scratch makes more of those, not fewer, and the reviewer then has to catch them.

Keeping the build here and sending the **review** out puts the independent pair of eyes exactly
where Aaron wants it — after the builder, before the PM — at one agent instead of two, and the
reviewer's job is adversarial, which is the job that actually bites.

**If the auditor's findings ever start being mostly context mistakes rather than logic mistakes,
this reasoning is wrong and the split should flip.** Worth re-reading after three releases.

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

## Rule 2.6 — THE ENHANCER. Nobody on this team was asked "does this screen make sense?"

**2026-09-07: runs BEFORE the build, on the screens about to change (Rule 1.5).**

Aaron, 2026-09-06: *"there isn't a way to add a para from the reports screen. there also a way to
edit cycles. these kind of things needs to be checked bc it's what makes sense for stuff like this.
someone should have suggested this fix from the team."*

**He is right, and the gap is structural.** Every existing role checks whether the change is
CORRECT: the builder makes it work, the Zero Day Auditor tries to prove it broken, `pm.py` checks
the release mechanics. **Not one of them asks whether the screen is COMPLETE.** So a screen that
lets a caregiver delete a paracentesis but never add one passed every gate this project has,
release after release, because nothing was wrong — something was just missing.

### The Enhancer's one job

For every screen the release touches: **can the caregiver do the whole job there, or does the app
send her somewhere else?** It PROPOSES; Aaron decides. It never widens a release on its own — this
is a patient's medical app and every extra control is a new way to mis-tap.

### The checklist, derived from what actually went wrong here

1. **Add / edit / remove symmetry.** For each kind of record a screen displays, can it be added,
   corrected, and removed from that same screen? A screen that removes but cannot add is the
   Paracentesis bug exactly.
2. **Read the empty states out loud.** *"No paracentesis procedures logged yet. Log the liters
   drained from the card on Today."* — **the app is telling you the screen is incomplete.** That
   sentence is a bug report the app wrote about itself. Three of them were sitting in the file.
3. **Can a mistake be corrected, or only deleted and redone?** Logging a period on the wrong day
   should be fixable, not require delete-and-re-add.
4. **Is anything a dead end** — information shown with no action available on it?
5. **Where a sibling screen already got it right, why didn't this one?** In-Patient has log-now,
   log-for-another-day and edit. Paracentesis, Weight and Cycle have some or none of that. The
   inconsistency IS the finding.
6. **Is everything already on the screen worth being there?** Added 2026-09-06. This pass added
   controls to the Paracentesis report and walked straight past *"Averaging 5.6 L per procedure"*,
   a statistic that means nothing for a procedure whose volume depends on elapsed time. **Looking
   for what is missing is not the same as looking at what is there**, and this role is the one most
   likely to make that mistake. Before adding to a screen, read what it already says.

### THE OUTPUT GOES TO AARON. Every release. Unprompted. (Added 2026-09-06)

Aaron: *"I shouldn't have to ask for enhancer list...otherwise, what is it doing?"*

**The role was being run and its output was being filed.** Two passes sat in `outputs/` — written,
committed, never surfaced. **A role whose output is a file in a repo the owner does not read is not a
role, it is a habit.** He had to ask for it twice, which is the same failure as a silent agent run.

**The rule: the proposal list goes IN THE RELEASE MESSAGE, as a short list with a size on each item
and a recommendation. A release message without one is incomplete.** The write-up still goes in
`outputs/ENHANCER-PASS-nn.md` for the record; the file is the record, not the delivery. If a pass
found nothing worth proposing, say that in one line — an explicit "nothing this time" is information,
silence is not.

### How to run it

Cheap and mechanical first: extract the actual button labels per screen and tabulate add / edit /
remove. **Do not trust a keyword search** — the first pass at this reported "Add: yes" for
Paracentesis when the screen has only Delete/Keep/Remove, because a loose pattern matched something
else. Presence checks pass on nonsense here as everywhere. Read the labels.

Then judgement: the checklist above, on the screens the release touched. Inline for a small
release; its own pass before a big one. Output is a short list of proposed enhancements with a size
on each — never a diff, unless Aaron picks one.

## Rule 2.7 — THE VOICE. Read what Brandi reads, before she does. (Hired 2026-09-06)

**2026-09-07: MERGED into the Zero Day Auditor's brief on audited releases; stays an inline pass on
copy-only releases (Rule 1.5). The questions below are unchanged.**

Aaron approved this on 2026-09-06 in the same message that retired the Lead Auditor.

**Why it exists: the in-app What's New copy was wrong on four consecutive releases**, and every
time a person opening a screenshot caught it — never a check.

- **v64** — written in developer language.
- **v65** — *"The frosted glass is gone."* **False.** Four scrims kept it, and the blur behind an
  open menu is the most visible frosted glass in the app. The title also promised *"The flickering
  is actually fixed now"* — the promise v64 had already made and broken.
- **v66** — *"and so can the Weight screen."* **False twice** (no add, no edit on the path any real
  device takes), and the new destructive Remove control was not mentioned at all.
- **v66, pre-ship** — a hint reading *"Tap Start or End"* when the buttons said *"Move start"*, and
  *"Defaults to now"* printed above a field showing a date three days old.

Four for four. That is an unowned surface, not bad luck, and it is **the only part of this work that
speaks to the patient directly.**

### The job

Before any release, read every caregiver-facing string the diff touched — the changelog entry, new
toasts, new empty states, new hint text, new button labels — and ask two questions:

1. **Is it true?** Not "roughly right" — true. If the release kept something the note says was
   removed, the note is a lie the patient will read.
2. **Would a tired non-technical person understand it at 2am?**
3. **Does this number belong on the screen at all?** Added 2026-09-06, hours after the role was
   created, because it missed one immediately. Aaron: *"we need to remove average of 5.6 L per
   procedure for para. this isn't an avg thing."* He was right. A paracentesis drains what has
   accumulated; how much comes off depends on how long it has been. The mean of those volumes
   describes nothing a clinician would use and invites the wrong reading — *"she's averaging 5.6,
   this one was 3, she's improving"* — when the **interval** is what carries the meaning, and that
   was already on screen as "Since last".
   **Arithmetically correct and clinically meaningless is still a false impression**, and it is the
   harder kind to catch because nothing is wrong with the arithmetic. So: for every figure the app
   computes about a patient, ask what a clinician would do with it, and whether an average of it
   means anything at all. Averages of *events that accumulate over time* almost never do.

Two further rules, both paid for:

- **A button's label and the text describing it must match.** v66 shipped a hint naming controls
  that had been renamed.
- **Never promise a fix that has not been confirmed on the patient's own phone.** v64 and v65 both
  told her the flickering was fixed. It was not.

**It can block a release on copy alone.** Cost: inline, a few minutes, no agent. The cheapest role
on the board and the one with the worst record behind it.

### Why this did not need a new hire, and what actually went wrong

Aaron asked whether someone should be hired or should step up. **Step up — and the role is named.**

The average had been on that screen for many releases and survived every gate, including two passes
this same day: the **Enhancer** walked the Paracentesis screen and asked whether the caregiver could
*do* everything there, and never asked whether what was already displayed should be. That is a real
blind spot with a name now: **the Enhancer looks at what is missing, so it is exactly the role most
likely to walk past what should not be there.** Both roles now read the same screen from opposite
ends — one asks "what can't she do here", the other "should this be here at all".

Adding a third reviewer would not have helped. The gap was in a brief, not in the headcount.

**And a finding worth more than the fix: ChemoWell already had a copy-review role, and care-tracker
did not.** ChemoWell's `TEAM.md` has carried a "Copy review (wordsmith)" section since app-v23. The
two projects' processes had quietly drifted apart, and care-tracker was running without the role its
sibling had had for months. **When one project fixes a process gap, check whether the other has it.**

**Even so, the wordsmith would NOT have caught the average** — which is why question 3 exists rather
than being assumed. *"Averaging 5.6 L per procedure"* is short, clear, reads the way a person would
say it and repeats nothing; it passes every test a copy review applies. **The wording was never the
problem. The number was.**

### RETIRED 2026-09-06 — the Lead Auditor

The second agent that verified the first auditor's findings is **retired**. On v64, v65 and v66 the
single Zero Day Auditor plus the builder's own falsification duty found everything — including the
v66 BLOCK, which a second pass would only have agreed with. A duplicate run costs a full agent:
real money and real silence, both of which this project has already overspent.

Aaron's own rule is the argument — agents exist *"to cross check each others work, not
independently"* — and **one cross-check that bites beats two that agree with each other.**

Reinstate it only for a release that changes dose logic or the storage format.

## Rule 3 — Cost before work

**2026-09-07, the standing queue:** Aaron approves an ORDER of work once and it is built in sequence
without re-asking per item. The S / M / L line is still stated on each. See Rule 1.5.
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

## Rule 5.5 — EVERY GATE HERE ASKS ABOUT A STILL FRAME. Aaron found the one that moves.

Aaron, 2026-09-06: *"when there is a toast pop up or with the 3 elipsies, you can still scroll and
see the background moving when trying to scroll. why haven't this been caught. eyes should be
actively looking at stuff to verify. there should be cases written for everything to test for."*

**He is right, and the reason is structural rather than careless.** Look at what this project checks:

| Gate | The question it asks |
|---|---|
| `overflow-scan` | Does the screen **fit**? |
| the Voice | Is the copy **true**? |
| the Enhancer | Can she **do the job** here? |
| the Zero Day Auditor | Does the **record** survive? |
| `pm.py` | Did the **release mechanics** happen? |

**Every one of them is a question about a still frame.** Not one asks what happens while a finger is
moving. So five full-screen overlays shipped for many releases with the page free to scroll behind
them — and the only way it was ever going to be found was somebody using the app, which is what
happened.

### The rule

**A release that adds or changes an overlay, a screen, or anything a finger touches must ship at
least one case for the INTERACTION, not only for the rendered result.** Scrolling behind it.
Focus after it closes. Where the back gesture goes. What a second tap does.

And when a case is written, write it for **the whole class, not the one instance Aaron reported.**
`harness/scrolllock-test.mjs` covers all five overlays and carries a completeness check that fails
if a sixth is added without a lock — because the specific bug is fixed either way, and the class is
what keeps coming back.

**Say out loud what is deliberately exempt.** A toast is not a modal, so it is asserted to stay
scrollable rather than quietly skipped. An exemption nobody wrote down is indistinguishable from
an oversight.

## Rule 6 — Communication is part of the deliverable

**READ RULE 0.6 FIRST — it supersedes this section wherever the two disagree.** A START message is
not a licence to stop; the only two reasons to send anything are an approval Aaron must give, or
completion. The rules below are about the CONTENT of a message once one is due, not about how often
one is due.
- START and FINISH messages for every work block, stating dispatch state (ACTIVE/IDLE).
- Task sheet re-sent after every push, unprompted.
- A defect is surfaced the moment it is found, never saved for the summary.
- A silence longer than 10 minutes while able to speak is a defect, like a failing test.
- Write for a non-technical reader. Plain words, short sentences, no file-path walls.

## Rule 7 — Standing exceptions (root causes still open, each with an owner)

**EVERY ENTRY CARRIES THE DATE IT WAS LAST CHECKED AGAINST THE CURRENT FILE. An entry with no date
is UNKNOWN, not true, and the first thing to do with it is check it — not act on it.**

That sentence is here because on 2026-09-13 this list was checked end to end for the first time and
**all three entries were wrong.** Two described defects that had been fixed for weeks; one of them
was simultaneously sitting in `TASK-SHEET.md` as queued work, one go-ahead away from being built a
second time. The `confirmTimeAndLog()` entry below already records this exact failure happening
once, in 2026-08-31, and the rule that came out of it — *verify a standing exception before acting
on it* — did not prevent the next two, because **nobody re-reads a list of known problems looking
for problems that are no longer there.** A date is a mechanism; a reminder is not.

- **`deliverFile()` fails silently on iOS with no detection.** **STALE AS WRITTEN — checked
  2026-09-13.** "No detection" has not been true since v57: `deliverFile()` returns
  `{ method, cancelled }`, tries the Web Share API first (the only route on iOS that reaches Files),
  distinguishes a cancelled share from a failed one, and falls back to the download rather than
  losing the export. `deliveredWord()` turns that into what the caregiver is told, so the app no
  longer claims a success it cannot verify. **What is genuinely open is narrower and is Aaron's:**
  nobody has confirmed the share route works on HER phone. Until he does, do not call the backup a
  backup — but do not describe this as silent failure either.

- ~~`confirmTimeAndLog()` has no error handling — a refused dose write closes the modal as
  if it worked.~~ **CLOSED in v48** (`git log -S writeError`) — checked again 2026-09-13.
  `addEntryDB()` catches the rejection, sets `state.writeError`, and the app renders a red banner
  ABOVE everything including the missed-dose alert, which stays until the caregiver taps OK; the
  rethrow means the success toast never fires. **This note survived ten releases after its subject
  was fixed and sent real work at a solved problem.**

- ~~The `multi` branch ("Take all") loops `await addEntryDB()` outside any catch, so the first
  refusal aborts the rest while the banner says *"Nothing was lost."*~~ **CLOSED in v63**
  (commit `c0aabc9`, 2026-09-01) — checked 2026-09-13. The branch tracks `savedNames` and
  `failedNames` separately and, when both are non-empty, says so: *"X was logged. Y was NOT. Log
  only the missing one again — the rest are already saved."* It also clears a stale `writeError` on
  a fully successful run. The `symptom` half — delete then re-log — **closed in v72**: it passes
  `symptomId` and `prevStamp` into `logSymptom`, which appends a superseding entry stamped strictly
  newer, so the original is never gone. **This entry was written twelve days ago claiming it had
  "been verified against the current file", and it had — the file just moved.** Verified once is
  not verified.

- ~~Reminder ledger built and tested (`harness/`) but not wired into the live workflow.~~
  **CLOSED — it has been live since v59** (`git log -S LEDGER_COLLECTION -- send-reminders.js`,
  commit `4d6df42`), checked 2026-09-13. `.github/workflows/reminders.yml` runs
  `node send-reminders.js`, and that file claims each reminder by `create()` at a deterministic
  document id in `reminder_ledger`. The "~1 in 6 anchored reminders dropped on late cron runs" this
  entry warns about is what the ledger fixes, and the fix shipped.

- ~~A red overdose warning is replaced by an amber timing notice.~~ **CLOSED — LIVE IN v77, and
  measured rather than assumed, 2026-09-15.** `harness/warning-priority-test.mjs` run with
  `--file` pointed at `origin/main`'s own `index.html` reports **18/18**, including the case this
  entry was written for: one dose that earns both an interaction notice and a ceiling breach shows
  the **red** one. `afterLog` collects every warning the dose earns into a list and then picks the
  worst, and the iron/protonix branch no longer `return`s before the ceiling check — the comment in
  the shipped file says so in those words. **This entry is closed by running the suite against the
  file that is serving to her phone, not by reading the branch it was built on.** That distinction
  is the whole reason Rule 7 carries dates: the previous three entries here all described defects
  that had been fixed for weeks, and one of them nearly sent a second build at a solved problem.

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

**SUPERSEDED IN PART BY RULE 0.6 (2026-09-08).** The rule below cured multi-hour silences during
agent runs; it was then used to justify a message after every step, which made every step a stopping
point. Dispatch and the task list carry the progress now. Aaron gets a message when he must decide
something, or when the work is complete. What follows still governs what a message CONTAINS.

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

**It is a Cowork desktop scheduled task** (Aaron confirmed 2026-09-07), so it does NOT appear in the
cloud routines list — do not conclude it is missing from there. Scheduled task runs at ~3 AM, fetches all Firestore entries via REST API, saves CSV.
If entry count ever drops below previous backup, flag as possible data loss.

## Testing checklist

Before declaring any change done:
- [ ] SW cache version bumped in `sw.js`
- [ ] Docs updated (README.md + CARETRACKER_HANDOFF.md) in same commit
- [ ] Deployed to GitHub Pages
- [ ] Verified on live site — changes visible, zero console errors
- [ ] Rollback bundle saved for previous version
- [ ] Edge cases tested (empty states, boundary times, multiple doses)
