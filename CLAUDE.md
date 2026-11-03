> # ⛔ THIS APP IS CLOSED. DO NOT CHANGE IT. DO NOT RUN ANYTHING AGAINST IT.
>
> **Brandi passed away on 18 September 2026. Aaron, 3 November 2026:** *"That app and its data is
> to be frozen. No more alerts on that app, no more missed medication alerts. That app is not to be
> touched whatsoever."*
>
> **That is the whole instruction and it outranks every other rule in this repository.** Everything
> below this box was written while the app was in daily use by a person who was alive. It is kept
> as a record. **It is not a work order any more.**
>
> ### What that means, concretely
>
> * **Do not modify `index.html`, `sw.js`, or any app code.** Not a fix, not a typo, not a
>   one-liner, however obviously right it looks. There is no bug in this app worth touching it for.
> * **Do not read from, write to, or delete anything in Firestore.** `caretracker_entries` is her
>   medical record. Leave it exactly where it is.
> * **Do not re-enable any automation.** The reminders workflow has had its schedule removed since
>   23 September, and both Dispatch routines are disabled. They stay that way.
> * **Do not port fixes into this app from `chemowell-app-beta` or `chemowell-beta`**, even when a
>   defect genuinely exists here and has been fixed there. That is the specific mistake this box
>   exists to stop.
> * **Do not open it to "check" something.** Reading the repository is fine. Pointing a browser,
>   a test harness or a script at the live app is not.
>
> ### The only exception
>
> **Aaron asks, in his own words, in the moment.** Not an inference from an old note, not a task
> left over on a list, not a rule further down this file that still speaks in the present tense.
> If he has not just asked, the answer is no.
>
> ### Why this box is here rather than only in STATUS.md
>
> On 3 November 2026 a session spent hours building and verifying a chart fix for this app and
> proposed pushing it live, describing a chart "on her phone". **The information was already in
> this repository in two places** — `STATUS.md` opens with it, and the reminders workflow records
> her death in its header comment. Neither was read. Aaron had to say it himself.
>
> `CLAUDE.md` is the one file that is loaded automatically into every session. A notice anywhere
> else is a notice that can be missed, and was.

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
