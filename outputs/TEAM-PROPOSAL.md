# Who else is on the team — a hiring memo

Aaron, 2026-09-06: *"who else needs to be added to the team. gaps are not allowed on my team. so we
need to hire/fire as needed. needs my approval first."*

**Nothing here is in effect.** This is the proposal; the roles below are not active until Aaron says
so. Each one is judged on the same standard the Enhancer was: a **documented, repeated failure** it
would have caught, not a gap somebody imagined.

## Who is on the team today

| Role | What it checks | Cost |
|---|---|---|
| **Builder** (the main session) | Makes the change work | — |
| **Zero Day Auditor** | Tries to prove the change broken. Adversarial, one per big release | ~25 min, one agent |
| **`pm.py`** | Release mechanics: unpushed work, version/cache agreement, parse, iOS 16px floor, the pinned tick guard | seconds, free |
| **Enhancer** (Rule 2.6, new today) | Whether a screen is COMPLETE, not merely correct | inline, cheap |

## HIRE — one role, and only one

### The Voice — reads what the caregiver reads, before Brandi does

**The documented failure.** The in-app What's New copy has been wrong on **three consecutive
releases**, and every time it was caught by a person opening a screenshot, never by a check:

- **v64** — written in developer language.
- **v65** — *"The frosted glass is gone."* **False.** Four scrims kept it, and the blur behind an
  open menu is the most visible frosted glass in the app. The title also promised *"The flickering
  is actually fixed now"* — the same promise v64 had made and broken.
- **v66** — caught pre-ship: a hint reading *"Tap Start or End"* when the buttons said *"Move
  start"*, and *"Defaults to now"* printed above a field showing a date from three days ago.

Three for three. That is not bad luck, it is an unowned surface. **Brandi reads this text**; it is
the only part of the work that speaks to her directly, and it is the only part nothing checks.

**What it does.** Before any release: read every caregiver-facing string the diff touched — the
changelog entry, new toasts, new empty states, new hint text — and ask two questions. *Is it true?*
*Would a tired non-technical person understand it at 2am?* It has one power: it can block a release
on copy alone.

**Cost:** inline, a few minutes. No agent. This is the cheapest role on the board.

## DO NOT HIRE — two I considered and rejected

**A "data-safety reviewer" for anything touching how records are written.** The failures are real —
Take-all saving some doses and reporting total failure, the paracentesis supersede-versus-duplicate
question, the cycle add-then-remove ordering. But the Zero Day Auditor already owns exactly this and
has been finding it: it caught the Iron advisory regression, the stranded repaint flag, and the
scrim classifier. Adding a second reviewer over the same ground **duplicates the auditor and halves
the attention each release gets.** Sharpen the auditor's brief instead — free.

**A "device tester".** Aaron's Galaxy and Brandi's iPhone are the only real devices, and no agent
can hold one. This is not a role; it is Aaron, and it is already how v64 and v65 were caught.

## FIRE — one candidate, honestly flagged

**The Lead Auditor** (a second agent that verifies the first auditor's findings) has not earned its
place recently. On v64, v65 and v66 the single auditor plus the builder's own falsification duty
found everything, and a second pass over the same report costs a full agent run — which on this
project means real money and real silence. **Recommend retiring it**, and reinstating it only for a
release that changes dose logic or storage format.

Aaron's own rule is the argument: *agents exist "to cross check each others work, not
independently"* — and one cross-check that actually bites beats two that agree with each other.

## The honest summary

**Hire one (The Voice). Retire one (The Lead Auditor). Change nothing else.**

Adding roles is how a process bloats, and this project has already paid once for a heavy chain: nine
sandbox rollbacks and a weekly quota burned in a day. Every role above the minimum has to earn its
seat with a failure it would have caught. The Voice has three. Nothing else on the list has one.
