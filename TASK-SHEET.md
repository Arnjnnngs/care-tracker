# care-tracker — Task Sheet

**Updated:** 2026-09-08 · **Live:** v73 · **v74, app-v72 and beta-v61 built, verified and pushed to the working branch — going live on main is Aaron's call** · **Dispatch:** ACTIVE

Split by WHO the next step belongs to. If MINE has an item, the turn does not end.

---

## YOURS — decisions only you can make

- [ ] **Go / no-go on the three huddle proposals** (`outputs/HUDDLE-2026-09-08.md`, summarised in the
      release message). One release covering both apps as a single job · a written "what could this
      destroy" line before any code · one page per release instead of a conversation.
- [ ] **Enhancer proposals** (`outputs/ENHANCER-PASS-05.md`): archived medications cannot be seen or
      restored anywhere in either app (S–M, recommended first); add/correct controls on the Bowel
      Movement and Appetite reports (S each); History says "Superseded" where "Removed" reads better (S).
- [ ] **The one thing that stops these going live: your go-ahead to merge to `main`.** All three are
      built, verified and pushed to the working branch; `main` is the patient's live app and nothing
      reaches it without you saying so.
- [ ] **Phone checks, when convenient.** Open Meds and read the new lines. Correct a weight, remove
      it, confirm the old number does not come back. Update a bowel answer from the banner for a day
      three or more days old and confirm it sticks after a reload.

## MINE — no decision needed

- [x] **Rule 0.6 written into the operating model in all three repos** — do not report until done,
      work end to end.
- [x] **v72** live — bowel, appetite and symptom corrections append instead of delete.
- [x] **v73** live — removing a corrected weight or paracentesis no longer restores the old number.
- [x] **v74 built** — every medication says what it is for. Two audit blocks fixed.
- [x] **ChemoWell app-v72 and beta-v61 built** — same feature, keyed by name.
- [x] **v74, app-v72 and beta-v61 verified and pushed.** Four adversarial audit passes; the last two
      found a guard that could not fail and a copy of it in the beta that had never been able to fail.
- [x] **Every check falsified** — 15 mutants across the three apps, each red on the intended check only.

## QUEUED — built in order without re-asking

1. **Take all** — saves some medications, reports none saved, re-tap double-logs (S–M, audited).
2. **Archived medications** — see and restore them (Enhancer pass 05, item A).
3. Add / correct controls on the Bowel Movement and Appetite reports (S each).
4. The four v43-era test suites — rebase or retire (S–M).
5. Android emulator smoke job in GitHub Actions (M).
6. ChemoWell's table has no Neulasta, Reglan or Phenergan and misses the brand halves of a dozen
   drugs; a combination product gets its main ingredient's line (Enhancer G and H, S each). New
   medical claims, so they get their own release and their own read — never bolted onto one that
   has already been audited.

## DONE — live on Brandi's phone

- [x] v73 — removing a corrected reading clears it instead of restoring the old number.
- [x] v72 — a changed bowel, appetite or symptom answer stays changed.
- [x] v71 — the page holds still behind an open menu or pop-up.
