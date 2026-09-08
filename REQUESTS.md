# care-tracker — REQUESTS (the Scribe's file)

Every ask Aaron makes, logged the moment he makes it, checked off only when it is live and verified.
Shown in full — done and outstanding — in every reply after a build or a request. Aaron, on ChemoWell:
*"I can't remember all the things I've mentioned and still needs to be completed."*

## Outstanding

- [ ] **Port v72 and v73 to both ChemoWell apps** (Aaron, 2026-09-08: *"will this be the same for
      chemowell?"*). **Yes — both carry the identical defect**, the same four call sites: the symptom
      edit and the three bowel/appetite corrections all delete before they add. `chemowell-app-beta`
      also has the weight and paracentesis supersede model, so v73's resurrection bug applies there
      too. M, audited, one app at a time.
- [ ] **A short "what it's for" line on each medication** (Aaron, re-raised 2026-09-08: *"I asked a
      while ago for the meds list to have a brief desc of what the med that was being added and what
      it was used for. not sure I saw that rolling out anywhere"*). **He is right that it never
      shipped, and I cannot find the original ask written down in ANY of the three repos** — not in
      this file, not in ChemoWell's `REQUESTS.md` or `BACKLOG.md`, which have existed since app-v25.
      It was dropped, not deprioritised. Today a med card shows the name and the generic name
      (`Tylenol / Acetaminophen`) and a rule note (`Min 4-hour gap`); nothing says what it treats.
      Needs Aaron's pick between a typed field and built-in text for the known medications. M across
      both apps.
- [x] **v72 — re-answering bowel / appetite / symptom keeps the new answer, at any age** (2026-09-07,
      from Enhancer pass 03; Aaron: "do all"). Live on main `62517cd`; needs his phone to confirm.
- [x] **v73 — Remove on a corrected weight/paracentesis row must not restore the old number** (both v72 auditors). Live on main `705121a`; also fixed a paracentesis removal that could silently do nothing, and an older weight whose removal failed without saying so.
- [ ] **Take all** — saves some medications, then says nothing saved; re-tap double-logs (standing
      exception, verified). Ships on its own, on Aaron's word (his 2026-09-01 instruction). S–M, audited.
- [ ] **Bowel Movement and Appetite reports get add / correct / remove** (Enhancer pass 03, item B). S each.
- [ ] **Android emulator smoke job** in GitHub Actions, as ChemoWell runs (team review, 2026-09-07). M.
- [ ] **pm.py runs every harness suite** and fails on any that cannot start (team review). S.
- [ ] **Phone checks only Aaron can do:** does the iPhone actually save the backup file (open since v50);
      does v71's page hold still behind the menu on Brandi's phone.

## Done — live and verified

- [x] **Team review, hires, merges, sequence** (2026-09-07, "do all") — Rule 1.5 in CLAUDE.md.
- [x] **Delete ratchet in pm.py** (2026-09-07) — falsified three ways.
- [x] **Nightly Firestore backup** — confirmed by Aaron 2026-09-07 to be a Cowork desktop task.
- [x] **v71** — page holds still behind an open menu or pop-up (Aaron, 2026-09-06: "you can still scroll and
      see the background moving").
- [x] **v70** — "fix period things that needs fixed" — a period move works at any age and cannot swallow another.
- [x] **v69** — correct or remove a weight from the Weight report; "Total drained" kept (Aaron asked for it).
- [x] **Paracentesis average removed** — "this isn't an avg thing."
- [x] **v66–v68** — "there isn't a way to add a para from the reports screen. there also a way to edit cycles."
- [x] **Enhancer list in every release message** — "I shouldn't have to ask for enhancer list."
- [x] **The full record of what went wrong, in the README** — "document in full detail all the challenges."

## Standing rules Aaron set on 2026-09-08, recorded so no session has to be told twice

- **Do not report until it is done.** Two reasons to send a message: he must approve or decide
  something, or the work is complete. Not "a job is running", not "the audit found something".
  `CLAUDE.md` Rule 0.6.
- **Work end to end.** From the ask to live: build, check, fix what the checks find, audit, ship,
  update the docs and the lists, port to the sibling app. The two exceptions above are the only
  interruptions.
- **The Enhancer's proposal list goes at the TOP of the release message**, before any technical
  detail. It was there before and buried, which for him is the same as absent.
