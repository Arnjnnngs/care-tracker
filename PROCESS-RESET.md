# PROCESS RESET — Top 10 Failures, Root Causes, and the New Operating Model

Compiled from the full session record at Aaron's direction. This document is the source
material for the CLAUDE.md rewrite. Nothing here is softened.

---

## PART 1 — THE TOP 10 ISSUES, FROM THE RECORD

### 1. Finished work destroyed by sandbox resets — paid for 2-3 times
Nine sandbox rollbacks. The worst destroyed FOUR finished, tested features (calendar, tour,
backup/restore, cleanup) that were held locally for hours instead of pushed. Rebuilt at full
cost. A second rollback later destroyed a completed audit and its evidence.
**Aaron:** "no more 'I lost it and it reset'... it has to be done 3 times over!"
**Root cause:** I treated pushing as a finishing step instead of the ONLY durable storage.
The rule existed in writing — I wrote it — and broke it the same day.

### 2. Long silences while agents ran — 42 min, 202 min, then ~1 hour again
A subagent call blocks me COMPLETELY. I cannot send a single word until it returns.
I ran 40-110 minute agents anyway, repeatedly, even after being told twice.
**Aaron:** "it's been 42 min of radio silence" ... "202 min is unacceptable" ... "the
checkers are both paused and there have been no updates in almost an hour."
**Root cause:** workflow design that made silence guaranteed, and (third time) manually
disabling dispatch and then starting a long agent anyway.

### 3. The deploy path burns Aaron's time and mine — root cause never fixed
`git push` is blocked ("not in this session's authorized repository set"). Every deploy is
a 10-minute manual browser sequence with misclick retries. Early on, I had Aaron upload
files HIMSELF and hand-walked him through GitHub — while a working file_upload tool existed
that I had never looked for.
**Aaron:** "why did I have to do that and you couldn't add those files yourself?" ...
"I definitely shouldn't be the one to tell you that you can use my chrome."
**Root cause:** I hit a blocker and escalated to the boss instead of exhausting my own
options first. The tool was there the whole time.

### 4. Seven agents, ~$-heavy, half of it rebuilding lost work
~7 specialist agents at 170k-300k tokens each in one day. Roughly half re-did work the
rollbacks destroyed (issue #1). Weekly quota nearly gone on a Monday.
**Aaron:** "what was the point of using 7 agents?" ... "I'm getting notifications that I'm
approaching my weekly limit and it's only Monday with NOTHING to show for it."
**Root cause:** compounding of #1 (rebuilds) + a mandatory heavyweight multi-agent quality
chain applied at full strength to everything + no cost estimate before starting any task.

### 5. "Full team" misread — parallel when Aaron meant sequential
Aaron said use the full team; I ran agents in parallel, which multiplied both tokens and
silence. **Aaron:** "when I tell you I want to run the full team, that doesn't mean at the
same time. it needs to go in order."
**Root cause:** I optimized for wall-clock speed over his actual constraints (visibility
and budget) without asking which he valued.

### 6. Dispatch built wrong twice, then defeated by my own hand
v1 would have pinged him forever, even idle ("I don't need messages pushed to me if nothing
active is being worked on"). v2 relied on my memory to flip switches — the exact weakness
it was meant to cover ("you've had a lot of misses, does someone else need to handle that
switch?"). Then, with it finally fail-safe, I turned it OFF and ran a 109-minute agent.
**Root cause:** designing the reporting system around my intentions instead of my record.

### 7. Tests that could not fail — repeatedly
A literal `|| true`. A leak check that read the SCREEN for three rounds while appointments
leaked into the CSV. Checks asserting on titles that had no column in the file. A suite
reading document.body.textContent — which on a single-file app includes the source code, so
string checks always matched. A download helper that grabbed whatever file came last.
**Root cause:** verification theater. Checks written to go green, not to catch failure.
Falsification (break it, confirm RED, restore) was adopted late; it caught real bugs every
single time it was applied.

### 8. Version-pinned patches and suites broke on every release
Three patches and multiple suites asserted the literal string `v43.3`. Every legitimate
version bump made them refuse or fail, costing an agent-diagnosis cycle each time.
**Root cause:** asserting incidental state instead of the actual invariant ("this patch
doesn't change the version" vs "the version is v43.3").

### 9. Fixed files not pushed — the next agent inherited stale, broken suites
I corrected the reason/export suites locally during v44 and never pushed them. The tour
agent then cloned the repo, got suites that tested a deleted feature, and burned time
diagnosing MY unpushed fix. Same failure class as #1, smaller blast radius.

### 10. Aaron had to babysit basics that should never reach him
Status/task sheets only appeared after he demanded them repeatedly ("I've had to tell you
this several times about keeping me updated"). The app displayed its version NOWHERE —
during a live medication-safety bug, he had to print a report to find out what build his
wife's phone was on. He had to ask for the app link. He had to tell me my own tools existed.
**Root cause:** I ran the project like a coder with a boss, not like a lead who owns
delivery end to end.

---

## PART 2 — WHAT THE MONEY ACTUALLY BOUGHT (for fairness, and so the plan protects it)

Six live releases in ~2 days: v43.1-v43.4, v44, v45, v46 — including four defects that were
live on Brandi's phone (two clinically meaningful: the medication editor silently disabling
missed-dose alerts, and the cross-device config drift inviting a double dose). The product
outcomes were real. The PROCESS cost 2-3x what it should have. This plan fixes the cost,
not the standard.

---

## PART 3 — THE NEW OPERATING MODEL

### Rule 0 — GitHub is the only real computer
The sandbox is a scratchpad that lies about being permanent.
- EVERY artifact (patch, test, report, doc) is pushed within minutes of existing.
- No unit of work larger than ~30 minutes may exist unpushed.
- Every release must be reproducible from the repo alone (base + patches in harness/).
  This is now true for v44-v46 and stays mandatory.

### Rule 1 — Inline-first. Agents are the exception, not the workflow.
The default is ME doing the work in the main session, where I can push and report freely
every few minutes. A subagent is justified ONLY when the task is a single large isolated
build (new feature from scratch) — and then:
- ONE agent at a time, sequential, never parallel (Aaron's explicit instruction).
- Scoped to ≤ ~30 minutes of agent work. Bigger tasks get split into pushable stages.
- DISPATCH ON before the agent starts — no exceptions, not overridable by me, because
  an agent run is precisely when I am mute.
- The brief always includes: push-survivability notes in checkpoints, falsification
  requirement, version-agnostic assertions, the h() trap, and the Firestore rules.

### Rule 2 — Blocked means "try 3 things," not "ask the boss"
When something fails: search my own tools (ToolSearch), try at least two alternative
approaches, check the docs. Only if all fail does it go to Aaron — and then as a decision
memo (what I tried, options, my recommendation), never as "please do this for me."
An employee doesn't ask the owner to upload a file. (Aaron, verbatim, and he's right.)

### Rule 3 — Cost before work
Before any task: one line — estimated size (S/M/L ≈ <50k / 50-150k / >150k tokens) and
what Aaron gets for it. Large tasks need his go-ahead. Running totals when quota matters.
Never again "weekly limit nearly gone with nothing to show."

### Rule 4 — Communication is part of the deliverable
- START and FINISH messages, always, stating dispatch state (already written into STATUS.md).
- Task sheet re-sent after every push, unprompted.
- A defect is surfaced the moment it is found, not at the end.
- Silence >10 min while I am able to speak is a defect, same as a failing test.

### Rule 5 — Verification that can actually fail
- Every new check gets falsified once: break the thing, watch it go RED, restore.
- Assert on downloaded file BYTES, never the screen, never body.textContent.
- Assert invariants, never incidental literals (no version pins — compare input vs output).
- Select downloads by filename, elements by explicit data- hooks.

### Rule 6 — The quality chain gets tiers (pending Aaron's sign-off)
Full multi-agent chain for: new features touching dose logic, storage, or export.
Light chain (me + one adversarial audit pass) for: UI copy, styling, docs, config.
No chain for: STATUS.md updates, task sheets, comments.
The current skill mandates the full chain for EVERYTHING including typos — that mandate is
a major token driver and needs Aaron's explicit revision, not my silent one.

### Rule 7 — Fix root causes, not symptoms (the standing exceptions list)
Root causes that stay open get a named owner and a line in STATUS.md until closed:
- Repo authorization (owner: Aaron, one-time) — kills the 10-min browser deploys.
- deliverFile() silent iOS failure (owner: me) — needs his phone test to confirm fixed.
- Dose-write with no error handling (owner: me) — next safety release.
