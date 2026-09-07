# care-tracker — Task Sheet

**Updated:** 2026-09-07 · **Live version:** v71 (`6a419a0`) · **Live URL:** arnjnnngs.github.io/care-tracker
**Dispatch:** IDLE — no build in progress.

This file is the done / outstanding list Aaron asked to see after every build and every request. It is
split by WHO the next step belongs to, so "waiting on you" can never be said while the MINE column has
items on it. If YOURS is empty, the next item under MINE starts in the same turn.

---

## YOURS — decisions only you can make

- [ ] **Approve the team changes** in `outputs/TEAM-REVIEW-2026-09-07.md`: hire the Designer, hire the
      Scribe, merge the Voice into the auditor's brief, re-brief the auditor and builder.
- [ ] **Say the word on v72** — bowel, appetite and symptom corrections supersede instead of delete.
      Size M, audited release. Cost gate (Rule 3).
- [ ] **Nightly Firestore backup** — CLAUDE.md says one runs at ~3 AM. It is not among this account's
      cloud routines. Do you see it in Cowork's scheduled tasks? If not, I rebuild it (S).
- [ ] **Two phone checks** that only a real device can answer: does the iPhone actually save the backup
      file (open since v50); does v71's page hold still behind the menu on Brandi's phone.

## MINE — no decision needed; started in order, nothing waits

- [x] Team review written and pushed (`outputs/TEAM-REVIEW-2026-09-07.md`).
- [x] **Delete ratchet in `pm.py`** — every shape of `removeEntryDB(...)` call is pinned; a new one
      blocks; the four delete-based corrections show as a warning until v72 removes them. Falsified
      three ways.
- [x] This task sheet refreshed (it said v43.3 was live and fed the dispatch report).
- [ ] `pm.py` runs every harness suite and fails on any that cannot start (S).
- [ ] Re-point the dispatch routine prompt away from "the v44 table" (needs your OK — it pushes to
      your phone).
- [ ] CLAUDE.md / NEW-CHAT-PROMPT.md updated with the approved team and sequence (after your approval).

## QUEUED — built on your word, in this order unless you reorder

1. **v72** — bowel / appetite / symptom-edit supersede (M, audited).
2. **Take all** partial-write fix — saves some, reports none saved, re-tap double-logs (S–M, audited).
3. Add / correct / remove controls on the Bowel Movement and Appetite reports (S each).
4. Android emulator smoke job in GitHub Actions, as ChemoWell runs (M).

## DONE — live on Brandi's phone

- [x] v71 — page holds still behind an open menu or pop-up; scroll-lock suite covers all five overlays.
- [x] v70 — period start/end move works at any age and cannot swallow another period; overflow scanner unblindfolded.
- [x] v69 — correct or remove a weight by superseding, never deleting; oncologist report agrees with the screen.
- [x] v66–v68 — add a paracentesis from its report; edit rows; period Remove withdrawn after it destroyed a period.
- [x] v62–v65 — What's new shown once; frosted glass and repaint work; honest changelog copy.
