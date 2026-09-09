# care-tracker — Task Sheet

**Updated:** 2026-09-09 · **Live:** v73 · **v74, app-v72 and beta-v61 finished, verified and pushed to the working branch after NINE audit passes — going live on `main` is Aaron's call** · **Dispatch:** ACTIVE

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
- [x] **v74, app-v72 and beta-v61 verified and pushed.** **Nine adversarial audit passes.** The feature
      was right after the first; every block since was a check printing green while the thing it
      guarded was broken. The ninth returned SHIP.
- [x] **Every check falsified** — 45 mutants across the three apps in the final round, every one red on
      the intended check and only that check.
- [x] **A pre-existing Home bug fixed on the way**, deliberately: a long pasted medication name pushed
      Home to 829px on a 320px phone and carried the bottom tab bar off the screen, so the Meds tab
      needed to undo the paste was unreachable. It measures 320px now.

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
7. A fixture that renders a GROUPED medications card (S). The ninth audit found the third wrapping
   declaration guarded by nothing, because no test ever renders that card — deleting it leaves the
   whole board green while about eighty per cent of a long medication name becomes invisible inside
   a clipped box. A source-level check stands in the meantime and its weakness is written down.

## DONE — live on Brandi's phone

- [x] v73 — removing a corrected reading clears it instead of restoring the old number.
- [x] v72 — a changed bowel, appetite or symptom answer stays changed.
- [x] v71 — the page holds still behind an open menu or pop-up.
