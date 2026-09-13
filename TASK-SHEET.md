# care-tracker — Task Sheet

**Updated:** 2026-09-11 · **Live:** v74 and app-v72, both on `main` · **v75, app-v73 and beta-v62 built, six audit passes, awaiting your merge call** · **app-v74 built and in audit** · **Dispatch:** ACTIVE

Split by WHO the next step belongs to. If MINE has an item, the turn does not end.

---

## YOURS — decisions only you can make

- [ ] **Go / no-go on the three huddle proposals** (`outputs/HUDDLE-2026-09-08.md`, summarised in the
      release message). One release covering both apps as a single job · a written "what could this
      destroy" line before any code · one page per release instead of a conversation.
- [ ] **Enhancer proposals** (`outputs/ENHANCER-PASS-05.md`): archived medications cannot be seen or
      restored anywhere in either app (S–M, recommended first); add/correct controls on the Bowel
      Movement and Appetite reports (S each); History says "Superseded" where "Removed" reads better (S).
- [ ] **MERGE v75 AND app-v73 TO `main`, OR ONE MORE AUDIT PASS.** Six passes have refused this
      release. The mechanism has been sound since the third; every refusal since was a sentence in
      the notes claiming a safety property the code did not have. Suites 51/51, 50/50, 42/42, every
      mutant red, `pm.py` clear. Your call, and I would take one more pass.
- [ ] **Enhancer pass 07, on app-v74** (`outputs/ENHANCER-PASS-07.md` in chemowell-app-beta):
      a lookup that fails can never be retried except by re-saving a medication you did not want to
      edit (S, **recommended** — the lookup may be failing for every medication forever and nobody
      would know to keep tapping Save); show when a description was fetched (S, not yet); refresh
      cached descriptions in the background (M, **refused** — it spends a patient's battery and
      signal on something nobody asked for).
- [ ] **PHONE CHECK THAT ONLY YOU CAN DO, and app-v74 needs it more than usual.** The live lookup was
      never contacted — this sandbox blocks every external host — so whether MedlinePlus answers a
      browser at all is unproven. On your phone: add a medication the app does not know and see
      whether a description appears with **Where this came from** under it. If it does not, that is
      the unverified half, not a bug; nothing else will be wrong.
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
- [x] **v74 and app-v72 are LIVE on `main`** (2026-09-11, on Aaron's go-ahead).
- [x] **Enhancer A, B and C built** — removed medications can be brought back (both apps); the table
      gains Neulasta, Reglan, Phenergan and a dozen brand names; combination products answer for
      themselves instead of through their generic ingredient. 17 mutants, all red on the intended check.
- [x] **app-v74 built on ChemoWell** — the medication description can fill itself in from MedlinePlus
      and the row says where it came from, cached so it works offline. The guards moved INTO the app,
      because fetched text arrives at run time where no suite can see it. 36/36, all mutants behaved.
      Falsifying it found four real defects, three of them checks that could not fail — including a
      timing check asking about an attribute this app does not have.
- [x] **Six audit passes on v75 / app-v73, all five refusals from the third onward the same class** —
      a sentence claiming a safety property the code does not have. The rule that came out of it is in
      STATUS.md: measure it or do not write it, and grep the file for what it already says.
- [x] **A pre-existing Home bug fixed on the way**, deliberately: a long pasted medication name pushed
      Home to 829px on a 320px phone and carried the bottom tab bar off the screen, so the Meds tab
      needed to undo the paste was unreachable. It measures 320px now.

## QUEUED — built in order without re-asking

1. **Take all** — saves some medications, reports none saved, re-tap double-logs (S–M, audited).
2. Add / correct controls on the Bowel Movement and Appetite reports (S each).
4. The four v43-era test suites — rebase or retire (S–M).
5. Android emulator smoke job in GitHub Actions (M).
7. A fixture that renders a GROUPED medications card (S). The ninth audit found the third wrapping
   declaration guarded by nothing, because no test ever renders that card — deleting it leaves the
   whole board green while about eighty per cent of a long medication name becomes invisible inside
   a clipped box. A source-level check stands in the meantime and its weakness is written down.

## DONE — live on Brandi's phone

- [x] v73 — removing a corrected reading clears it instead of restoring the old number.
- [x] v72 — a changed bowel, appetite or symptom answer stays changed.
- [x] v71 — the page holds still behind an open menu or pop-up.
