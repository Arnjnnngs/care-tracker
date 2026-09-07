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
for f in "$HERE"/*-test.mjs "$HERE"/cycle-merge-probe.mjs "$HERE"/audit-v69-weightreport.mjs "$HERE"/overflow-scan.mjs; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if [ "$QUICK" = 1 ] && [ "$name" = "overflow-scan.mjs" ]; then
    echo "| $name | SKIPPED | --quick run; the scan must be recorded separately in RENDER-${VER}.md |" >> "$OUT"; continue
  fi
  echo "== $name"
  log="$(timeout 600 node "$f" 2>&1)"; rc=$?
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
