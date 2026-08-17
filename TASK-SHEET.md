# care-tracker — Task Sheet

**Updated:** Aug 17 · **Live version:** v43.3 (`87e89bb`) · **Live URL:** arnjnnngs.github.io/care-tracker

---

## DONE — shipped and verified live on Brandi's app

- [x] **v43.1** — Export buttons fixed (`fc2c345`)
- [x] **v43.2** — Missed-dose calculation fixed (`e4eb5c9`)
- [x] **v43.3** — Renderer `value` trap fixed at source (`87e89bb`)
- [x] **v43.3** — Appetite card: saved note no longer renders empty
- [x] **v43.3** — Symptom logger: typing before choosing no longer wipes the entry
- [x] **v43.3** — Medication editor: **the serious one.** Correcting a wrongly-displayed
      schedule type was silently disabling that medication's missed-dose alerts while
      the app said "updated"
- [x] Deploy path documented in `CLAUDE.md` + handoff (survives future chats)
- [x] Progress-checkpoint rule written into `CLAUDE.md` + handoff + every agent brief

**Verification:** re-cloned from GitHub, md5 match on `index.html` and `sw.js`,
version stamps confirmed, zero console errors, zero Firestore writes during testing.

---

## BUILT, PASSED, THEN LOST TO A SANDBOX ROLLBACK

All four were finished and green. None of it was pushed to GitHub, so none of it survived.
That is my error — the rule is push every increment, and I held four features locally for hours.

- [ ] **Calendar** — 151 checks passed. Found 2 real mobile defects: day cells 43.6px
      (under the 44px minimum) and a 14px Note field (makes iOS zoom in and never back)
- [ ] **Guided tour** — 26 checks, 16 falsified. Skippable, re-runnable from the menu,
      never blocks the app. 10 steps including calendar + backup
- [ ] **Backup / restore** — 93 checks. Appointments now survive a restore; they were
      the one thing "Save a copy" could not bring back
- [ ] **Concurrent-edit notice** — "this changed while you had it open"
- [ ] **Dead code removal** — `seedDemo()` and the demo banner
- [ ] **`send-reminders.js` rewrite** — data-driven instead of 4 hardcoded if-statements
      naming 5 medications. 362,880 simulated ticks, zero behaviour differences
- [ ] **Audit found + fixed:** restore silently dropped records whose id collided with
      JavaScript built-ins, while reporting success

---

## LEFT TO DO — after the rebuild

- [ ] **Reminder ledger** — late GitHub Actions runs currently send nothing, silently
- [ ] **Notes** port from ChemoWell
- [ ] **Settings** port
- [ ] **Help & FAQ** (118 topics)
- [ ] **Medication config → shared database** (currently device-local, so Aaron's and
      Brandi's phones can disagree about her medications)
- [ ] **Generic reminder engine**
- [ ] **6 missing symptom types**
- [ ] **Daily check-in** replacing the 3 banners
- [ ] **Commit `harness/`** — test files have never been pushed, lost on every rollback

---

## NEEDS AARON — I cannot do these

- [ ] **Test "Save spreadsheet" AND the backup on your iPhone.** Both use a download
      path with no failure detection. iOS can fail silently while the app says "saved."
      **Until you confirm a file actually lands, neither one is a backup.**
- [ ] **Check your medication list** — if you ever "corrected" a schedule type that
      looked wrong, that may have disabled its missed-dose alerts. Protonix especially
- [ ] **Authorize the 3 repos as session sources** — this is what forces every deploy
      through manual browser upload instead of `git push`, and it is the root cause of
      the rollback losses
