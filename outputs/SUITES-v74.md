# Suite record — v74 — 2026-09-08 22:27 UTC

Every browser suite in `harness/`, run by `harness/run-all.sh`. A row reading FAIL or ERROR blocks
the release in `pm.py` unless it is changed to EXEMPT with a reason of at least twenty characters.

| Suite | Result | Last line |
|---|---|---|
| cal-test.mjs | PASS |     [iPhone-390x844] sheet field font sizes: title=16px, when=16px, note=16px (floor 16) |
| chemo-offset-test.mjs | PASS | 17/17 checks passed |
| daily-supersede-test.mjs | PASS | 40/40 checks passed |
| deactivate-test.mjs | EXEMPT | v43.3 deactivate-patch verifier, pinned to v43.3 per pm.py; 21/34 on v71 and on v72 with identical failures (the 600s gate cuts it to 15/34); rebase or retire queued |
| encbackup-test.mjs | PASS | 16/16 checks passed |
| enhance-test.mjs | PASS | 37/37 checks passed |
| eod-test.mjs | PASS | 11/11 checks passed |
| export-test.mjs | PASS |   49/49 checks passed. |
| glass-test.mjs | PASS | 7/7 checks passed |
| inpatient-window-test.mjs | PASS | 10/10 checks passed |
| iosshare-test.mjs | PASS | 7/7 checks passed |
| ledger-test.mjs | PASS |        and every ledger write is an append. |
| logger-test.mjs | PASS | 19/19 checks passed |
| med-purpose-test.mjs | FAIL | 30/31 checks passed  <-- FAIL |
| medflag-backfill-test.mjs | PASS | 9/9 checks passed |
| medskip-test.mjs | PASS | 10/10 checks passed |
| medsync-test.mjs | EXEMPT | v44 medsync-patch verifier; hangs past the 600s limit on v71 and v72 alike; rebase or retire queued |
| missed-banner-test.mjs | PASS | 16/16 checks passed |
| missedcard-test.mjs | PASS | 7/7 checks passed |
| para-test.mjs | PASS | 16/16 checks passed |
| reason-test.mjs | EXEMPT | v43.4 reason-patch verifier; 34/41 on v71 and on v72 (identical), so nothing in the current release moved it |
| remove-group-test.mjs | PASS | 22/22 checks passed |
| repaint-test.mjs | PASS | 17/17 checks passed |
| scrolllock-test.mjs | PASS | 23/23 checks passed |
| settings-test.mjs | PASS | 11/11 checks passed |
| share-test.mjs | PASS | 9/9 checks passed |
| swfresh-test.mjs | PASS | 7/7 checks passed |
| syncguard-test.mjs | PASS | 5/5 checks passed |
| takeall-test.mjs | PASS | 29/29 checks passed |
| tour-test.mjs | EXEMPT | v44 tour-patch verifier: compares a patched build to an unpatched base; fails 'APP_VERSION equals base' on v71 and v72 alike |
| treatment-window-test.mjs | PASS | 32/32 checks passed |
| whatsnew-test.mjs | PASS | 30/30 checks passed |
| cycle-merge-probe.mjs | PASS | 24/24 checks passed |
| audit-v69-weightreport.mjs | PASS |   11 passed, 0 failed |
| audit-v72-probe.mjs | PASS | 28/28 checks passed |
| overflow-scan.mjs | SKIPPED | --quick run; the scan must be recorded separately in RENDER-v74.md |

Failing or erroring suites: 1
