# care-tracker — Task Sheet

**Updated:** 2026-09-14 · **Live:** care-tracker **v75** · ChemoWell **app-v79** on `main` · staging **beta-v64** (pushed) · **app-v80 built, round-3 audit pending** · **care-tracker v76 built on the working branch, waiting on your word** · **Dispatch:** ACTIVE

*The 2026-09-11 version of this line said "v74 and app-v72 live, v75 awaiting your merge call" — four
releases out of date, and it is the file you read to know what is happening. It is regenerated from
the actual `APP_VERSION` in each repo now, not from memory.*

Split by WHO the next step belongs to. If MINE has an item, the turn does not end.

---

## YOURS — decisions only you can make

- [ ] **Go / no-go on the three huddle proposals** (`outputs/HUDDLE-2026-09-08.md`, summarised in the
      release message). One release covering both apps as a single job · a written "what could this
      destroy" line before any code · one page per release instead of a conversation.
- [ ] **Enhancer proposals** (`outputs/ENHANCER-PASS-05.md`): archived medications cannot be seen or
      restored anywhere in either app (S–M, recommended first); add/correct controls on the Bowel
      Movement and Appetite reports (S each); History says "Superseded" where "Removed" reads better (S).
- [ ] **THE RED OVERDOSE WARNING IS REPLACED BY AN AMBER ONE, ON YOUR LIVE APP.** Found today while
      fixing the same thing in ChemoWell. `state.warn` is one slot, and the iron/protonix branch
      sets it and returns before any ceiling check runs. So: Brandi goes over the daily
      acetaminophen limit → the red *"do not give more without contacting the care team"* banner
      appears → the next **Take all** on the evening meds logs Iron within two hours of Protonix →
      the red banner is replaced by a note about iron absorption, with nothing to say it was ever
      there. Second half: **Take all only ever checks iron**, so a batch that pushes anything else
      past its own daily limit warns about nothing at all.
      **BUILT AND VERIFIED, 2026-09-14. The harness passes now and the only thing left is you.**
      It is `v76` on the working branch, reproducible from v75 plus one patch script.
      `harness/warning-priority-test.mjs` is **18/18** on the fix and **15/18 on v75** — so the
      defect is reproduced on the build that is live on your phone, not argued from the source. It
      appends nothing, edits nothing and deletes nothing; it changes which of two banners is on the
      screen. The same fix is already live in staging (`beta-v64`). **Your decision: say the word
      and I push v76 to `main`.** I recommend it.

- [x] **THE CHEMOWELL REDESIGN — BUILT IN BOTH APPS**, on your *"Let's do redesign on both apps.
      Maybe on chemowell first then caretracker staging."* Home now answers **what is due next**
      before it asks for anything: a card at the top naming the medication that is actually due,
      when, the day's dose count, and one control that takes the caregiver to the card that can log
      it. It never names an as-needed medication, never one the app itself is refusing, and when the
      day is finished it says so instead of vanishing. Staging (`beta-v63`) is **pushed and live**;
      ChemoWell (`app-v80`) is built and one gate from shipping. The port is deliberately not a
      copy — staging's theme is pink glassmorphism, so its card is pink.
- [ ] **Enhancer pass on app-v79** (`chemowell-app-beta/outputs/ENHANCER-PASS-v79.md`). The headline:
      **the app draws a daily-total card that no screen can create.** The running
      "2,500 / 3,000 mg · 500 mg left" card is switched on by a property only the legacy migration
      writes, so a new ChemoWell customer who sets up paracetamol with a 3,000 mg limit gets the
      ceiling *warning* and never the running total — they find out they are over at the moment they
      cross it. That is phase 4 of the hardcoded-medications plan (L, **recommended next**). Smaller:
      the red banner and the daily-total card are both dead ends, with no way through to the doses
      behind the number (S each).
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

- [x] **ChemoWell app-v77, app-v78, app-v79 built and audited** — phases 2 and 3 of taking one
      patient's prescription out of a product everyone uses. Thirteen drug names came out of the code
      and into the data, the fence that stopped a customer creating a medication called Zofran came
      down, and the ratchet reads 0 / 0 / 0.
- [x] **app-v78 shipped a dead Home screen and the audit caught it.** `medHomeCardKind` was called
      three times and defined nowhere; five suites and 103 checks were green while the app threw on
      every render. No suite had ever drawn a screen with a migrated medication. app-v79 fixes it and
      seven more, and the audit blocked app-v79 too — rightly, nine times, including a dose ceiling
      from one care plan that I put back into the product.
- [x] **Three repos each have their own instruction file that actually loads.** `CLAUDE.md` is a stub
      importing `claude/<app>.md`, because Claude Code auto-loads that one name and nothing else —
      which is why for months the only instructions any session read were this repo's, in a product
      that is not this patient's.

## QUEUED — built in order without re-asking

1. ~~**Take all** — saves some medications, reports none saved, re-tap double-logs.~~ **ALREADY
   DONE, and it has been since v63 (2026-09-01).** Checked against the live file today: the branch
   names both sides — *"X was logged. Y was NOT. Log only the missing one again."* — and clears a
   stale banner on a clean run. The symptom half was closed in v72. **It sat in this queue for a
   fortnight as work to do, and STATUS.md still listed it as open**, which is the second standing
   exception on this project to outlive its own fix. What IS still open in that function is the
   warning defect at the top of YOURS.
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
