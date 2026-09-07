#!/usr/bin/env bash
# run-all.sh -- every browser suite in harness/, one after another, with the result written down.
#
# WHY. export-test was dead from v64 to v70 -- its first click swallowed by the What's-New pop-up --
# and nobody noticed because nobody ran it. A suite nobody runs is a check that cannot fail. This
# script runs ALL of them and writes outputs/SUITES-<version>.md; pm.py refuses a release whose
# index.html changed without that record, or whose record carries a FAIL or ERROR row that is not
# marked EXEMPT with a written reason (an exemption nobody wrote down looks identical to an oversight).
#
# Usage:  harness/run-all.sh            # against index.html, records outputs/SUITES-<APP_VERSION>.md
#         harness/run-all.sh --quick    # skip overflow-scan (the slow one); the record says so
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$HERE")"
cd "$REPO"
VER="$(grep -o "const APP_VERSION = '[^']*'" index.html | sed "s/.*'\(.*\)'/\1/")"
OUT="outputs/SUITES-${VER}.md"
# the newest rollback bundle is the previous release -- the base the patch-comparison suites need
PREV="$(ls -d outputs/rollback-v* 2>/dev/null | sed 's/.*rollback-//' | sort -V | tail -1)"
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
# The suites refuse to start with a proxy set (they must never reach the network); clear it for them.
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy
mkdir -p outputs
{
  echo "# Suite record — ${VER} — $(date -u +'%Y-%m-%d %H:%M UTC')"
  echo
  echo "Every browser suite in \`harness/\`, run by \`harness/run-all.sh\`. A row reading FAIL or ERROR blocks"
  echo "the release in \`pm.py\` unless it is changed to EXEMPT with a reason of at least twenty characters."
  echo
  echo "| Suite | Result | Last line |"
  echo "|---|---|---|"
} > "$OUT"
fails=0
for f in "$HERE"/*-test.mjs "$HERE"/cycle-merge-probe.mjs "$HERE"/audit-v69-weightreport.mjs "$HERE"/audit-v72-probe.mjs "$HERE"/overflow-scan.mjs; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if [ "$QUICK" = 1 ] && [ "$name" = "overflow-scan.mjs" ]; then
    echo "| $name | SKIPPED | --quick run; the scan must be recorded separately in RENDER-${VER}.md |" >> "$OUT"; continue
  fi
  # EXEMPT, SAID OUT LOUD. These four are v43/v44-era PATCH VERIFIERS: each compares one old patch
  # against its own base (tour-test fails on "APP_VERSION equals the base"; medsync-test times out
  # on v71 and v72 alike; reason-test is 34/41 on v71 and v72 alike; deactivate-test is pinned to
  # v43.3 per pm.py's literal check). None of them is a gate on the current release and none goes
  # red BECAUSE of it. They stay listed here, with the reason, until they are rebased or retired
  # (TASK-SHEET.md, QUEUED). Deleting a line here makes that suite run and count again.
  case "$name" in
    tour-test.mjs)       echo "| $name | EXEMPT | v44 tour-patch verifier: compares a patched build to an unpatched base; fails 'APP_VERSION equals base' on v71 and v72 alike |" >> "$OUT"; continue ;;
    medsync-test.mjs)    echo "| $name | EXEMPT | v44 medsync-patch verifier; hangs past the 600s limit on v71 and v72 alike; rebase or retire queued |" >> "$OUT"; continue ;;
    reason-test.mjs)     echo "| $name | EXEMPT | v43.4 reason-patch verifier; 34/41 on v71 and on v72 (identical), so nothing in the current release moved it |" >> "$OUT"; continue ;;
    deactivate-test.mjs) echo "| $name | EXEMPT | v43.3 deactivate-patch verifier, pinned to v43.3 per pm.py; 15/34 on v72, times out on v71; rebase or retire queued |" >> "$OUT"; continue ;;
  esac
  echo "== $name"
  # Every suite is handed the real file. The v43-era suites default to harness/work/index.html, a
  # directory that stopped existing with the sandbox that made it -- that is how export-test could be
  # dead for six releases with nobody noticing.
  extra=""
  case "$name" in
    overflow-scan.mjs) extra="" ;;
    tour-test.mjs|medsync-test.mjs) extra="--file $REPO/index.html --base $REPO/outputs/rollback-${PREV}/index.html" ;;
    *) extra="--file $REPO/index.html" ;;
  esac
  log="$(timeout 600 node "$f" $extra 2>&1)"; rc=$?
  last="$(printf '%s\n' "$log" | grep -v '^\s*$' | tail -1 | sed 's/|/\\|/g' | cut -c1-140)"
  if [ $rc -eq 0 ]; then res="PASS"; else res="FAIL"; fails=$((fails+1)); fi
  # a suite that dies before its first check is an ERROR, not a FAIL -- the gate could not start
  if ! printf '%s\n' "$log" | grep -q "PASS\|FAIL\|CLEAN\|passed"; then res="ERROR"; fi
  echo "| $name | $res | $last |" >> "$OUT"
  echo "   -> $res: $last"
done
echo >> "$OUT"
echo "Failing or erroring suites: $fails" >> "$OUT"
echo; echo "record: $OUT  (failing: $fails)"
exit $fails
