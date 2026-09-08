# Suite record — v74 — 2026-09-08 22:03 UTC

Every browser suite in `harness/`, run by `harness/run-all.sh`. A row reading FAIL or ERROR blocks
the release in `pm.py` unless it is changed to EXEMPT with a reason of at least twenty characters.

| Suite | Result | Last line |
|---|---|---|
| cal-test.mjs | PASS |     [iPhone-390x844] sheet field font sizes: title=16px, when=16px, note=16px (floor 16) |
| chemo-offset-test.mjs | PASS | 17/17 checks passed |
| daily-supersede-test.mjs | PASS | 40/40 checks passed |
| deactivate-test.mjs | EXEMPT | v43.3 deactivate-patch verifier, pinned to v43.3 per pm.py; 21/34 on v71 and on v72 with identical failures (the 600s gate cuts it to 15/34); rebase or retire queued |
| encbackup-test.mjs | PASS | 16/16 checks passed |
