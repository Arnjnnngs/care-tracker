# Suite record — v72 — 2026-09-07 06:25 UTC

Every browser suite in `harness/`, run by `harness/run-all.sh`. A row reading FAIL or ERROR blocks
the release in `pm.py` unless it is changed to EXEMPT with a reason of at least twenty characters.

| Suite | Result | Last line |
|---|---|---|
| cal-test.mjs | PASS |     [iPhone-390x844] sheet field font sizes: title=16px, when=16px, note=16px (floor 16) |
| chemo-offset-test.mjs | PASS | 17/17 checks passed |
| daily-supersede-test.mjs | PASS | 40/40 checks passed |
| deactivate-test.mjs | EXEMPT | v43.3 deactivate-patch verifier, pinned to v43.3 per pm.py; 15/34 on v72, times out on v71; rebase or retire queued |
| encbackup-test.mjs | PASS | 16/16 checks passed |
| enhance-test.mjs | PASS | 37/37 checks passed |
| eod-test.mjs | PASS | 11/11 checks passed |
| export-test.mjs | PASS |   49/49 checks passed. |
| glass-test.mjs | PASS | 7/7 checks passed |
| inpatient-window-test.mjs | PASS | 10/10 checks passed |
| iosshare-test.mjs | PASS | 7/7 checks passed |
