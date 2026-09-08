# care-tracker — Task Sheet

**Updated:** 2026-09-08 · **Live version:** v73 (`705121a`) · **Live URL:** arnjnnngs.github.io/care-tracker
**Dispatch:** ACTIVE — v73 in progress.

This file is the done / outstanding list Aaron asked to see after every build and every request. It is
split by WHO the next step belongs to, so "waiting on you" can never be said while the MINE column has
items on it. If YOURS is empty, the next item under MINE starts in the same turn.

---

## YOURS — decisions only you can make

- [x] Team changes, v72, and the backup question — all answered 2026-09-07 ("do all", backup is in Cowork).
- [ ] **Two phone checks** that only a real device can answer: does the iPhone actually save the backup
      file (open since v50); does v71's page hold still behind the menu on Brandi's phone.

## MINE — no decision needed; started in order, nothing waits

- [x] **v73 LIVE** (`705121a`) — Remove on a corrected weight or paracentesis clears the reading instead of restoring the old number; a second, older bug fixed alongside it (removing a paracentesis could silently do nothing). Suite 20/20, and 10/20 against v72. In checks now.
- [x] Team review written and pushed (`outputs/TEAM-REVIEW-2026-09-07.md`).
- [x] **Delete ratchet in `pm.py`** — every shape of `removeEntryDB(...)` call is pinned; a new one
      blocks; the four delete-based corrections show as a warning until v72 removes them. Falsified
      three ways.
- [x] This task sheet refreshed (it said v43.3 was live and fed the dispatch report).
- [x] `pm.py` requires a suite record from `harness/run-all.sh`; a hidden red or an unexplained exemption blocks. Falsified four ways.
- [x] **v72 audited: BLOCK (Home journal listed removed rows) → fixed → delta BLOCK (removed paracentesis still standing) → fixed → delta 2 SHIP.** Auditor's probe 28/28, suite 40/40, record 29 PASS / 4 EXEMPT / 0 failing, scan 140/140 clean, pm.py clear.
- [x] **v72 on main** (`62517cd`); deactivate-test proved identical on v71 and v72 (21/34 both) once given time.
- [ ] Rebase or retire the four v43/v44-era patch verifiers run-all found red on v71 and v72 alike (S–M).
- [x] Dispatch routine prompts re-pointed at STATUS.md's live table and this sheet.
- [x] CLAUDE.md Rule 1.5, NEW-CHAT-PROMPT.md, REQUESTS.md — the approved team and sequence.

## QUEUED — built on your word, in this order unless you reorder

1. **Take all** partial-write fix — saves some, reports none saved, re-tap double-logs (S–M, audited).
2. **Take all** partial-write fix — saves some, reports none saved, re-tap double-logs (S–M, audited).
3. Add / correct / remove controls on the Bowel Movement and Appetite reports (S each).
4. Android emulator smoke job in GitHub Actions, as ChemoWell runs (M).

## DONE — live on Brandi's phone

- [x] v73 — removing a corrected weight or paracentesis clears it instead of restoring the old number; removing an older weight works instead of failing silently.
- [x] v72 — a changed bowel, appetite or symptom answer stays changed; corrections append, never delete; the delete ratchet and the suite record are in pm.py.
- [x] v71 — page holds still behind an open menu or pop-up; scroll-lock suite covers all five overlays.
- [x] v70 — period start/end move works at any age and cannot swallow another period; overflow scanner unblindfolded.
- [x] v69 — correct or remove a weight by superseding, never deleting; oncologist report agrees with the screen.
- [x] v66–v68 — add a paracentesis from its report; edit rows; period Remove withdrawn after it destroyed a period.
- [x] v62–v65 — What's new shown once; frosted glass and repaint work; honest changelog copy.
