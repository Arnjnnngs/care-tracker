# CLAUDE.md — care-tracker (WEB-MAIN, the live app)

**THIS FILE MUST BE CALLED `CLAUDE.md`. The instructions live in `claude/care-tracker.md`.**

Aaron, 2026-09-13: *"I think it's also worth looking into renaming all the cloud.md files based on
which app it's tied to. For example, Claude/caretracker.md"*

Right goal, and the obvious route is the bug he was reacting to. **Claude Code auto-loads a file
named exactly `CLAUDE.md` (or `.claude/CLAUDE.md`) and nothing else** — verified against the docs.
The two ChemoWell repos kept their rules in `APP_CLAUDE.md` and `BETA_CLAUDE.md`, which were
therefore never read by anything, so THIS file was the only instruction set in play in every session
touching any of the three repos. It names one patient throughout, correctly — and it was being read
while writing a different product's code.

So the app name goes on the file and this stub imports it.

**THIS REPO IS ONE NAMED PERSON'S APP.** Her name, her medications, her care team and her diagnosis
belong here. They do NOT belong in `chemowell-app-beta`, which is a product every user is a
different patient in. A fix ported there must have all of it taken out on the way; a fix ported back
here does not need it put in.

@./claude/care-tracker.md
