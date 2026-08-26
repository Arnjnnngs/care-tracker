#!/bin/bash
# run-all-tests.sh — run EVERY suite in this repo and fail loudly if any of them fails.
#
# WHY THIS EXISTS. Nothing ran these suites. `npm test` was a stub that exits 1, release_check.sh
# runs none of them, and CI runs none either. Twenty suites existed and only ever executed when
# somebody remembered to type a filename. The cost, measured on 2026-08-24:
#
#   * V57-1, the gate guarding the "contact the care team" disclaimer on the Help search screen,
#     was RED for EIGHT releases (app-v58 through app-v65). It pinned the sentence verbatim and
#     app-v58 reworded it. Nobody saw, because nobody ran it.
#   * The layout regressions behind test/v57-browser-notice.mjs's 17 failures sat unnoticed for NINE.
#   * test/audit-v55b.mjs could not START at all -- it reads /tmp/topics.js, a path from a sandbox
#     that no longer exists.
#
# A gate nobody runs is not a gate. A gate that cannot start is indistinguishable from one that
# passes. This script is the answer to both, and it is meant to be boring: it takes no arguments,
# makes no judgement calls, and exits non-zero if ANYTHING is not green.
#
# Usage:   ./run-all-tests.sh              # everything
#          ./run-all-tests.sh v59 v64      # only suites whose filename matches one of these
set -uo pipefail
cd "$(dirname "$0")"

# The suites REFUSE to run with a proxy set, so that a test browser can never be routed through one.
# Honour that here rather than making every caller remember it.
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy

DIR="test"; [ -d "$DIR" ] || DIR="harness"
PORT="${PORT:-8899}"

# Some suites stand up their own server; the audit-v55/pm-v55 family expect one already listening.
# Starting one unconditionally satisfies the second group and is harmless to the first.
SERVER_PID=""
if ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null; then
  python3 -m http.server "$PORT" --directory . >/dev/null 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 40); do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null && break
    sleep 0.25
  done
fi
cleanup() { [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT

pass=0; failed=0; unstartable=0
declare -a FAILED_NAMES=() UNSTARTABLE_NAMES=()

echo "=========================================================================="
echo "RUNNING EVERY SUITE IN $DIR/  (static server on :$PORT)"
echo "=========================================================================="

for f in "$DIR"/*.mjs; do
  name=$(basename "$f" .mjs)
  if [ "$#" -gt 0 ]; then
    match=0; for pat in "$@"; do [[ "$name" == *"$pat"* ]] && match=1; done
    [ "$match" -eq 1 ] || continue
  fi
  printf '  %-26s ' "$name"
  out=$(timeout 600 node "$f" 2>&1); code=$?

  # A suite that dies before its first assertion is its OWN failure class. Folding it in with
  # ordinary red hides the worst case -- a gate that never ran at all, looking like one that did.
  if echo "$out" | grep -qE "MODULE_NOT_FOUND|Cannot find module|ENOENT: no such file|ERR_MODULE_NOT_FOUND"; then
    echo "COULD NOT START"
    echo "$out" | grep -oE "(Cannot find module|ENOENT: no such file[^']*'[^']*')[^\"]*" | head -1 | sed 's/^/        /'
    unstartable=$((unstartable+1)); UNSTARTABLE_NAMES+=("$name"); continue
  fi
  if [ "$code" -eq 0 ]; then
    echo "PASS   $(echo "$out" | grep -oE '[0-9]+/[0-9]+ (checks )?passed|ALL GREEN|[0-9]+ passed, [0-9]+ failed' | tail -1)"
    pass=$((pass+1))
  else
    echo "FAIL   (exit $code)"
    echo "$out" | grep -E "^\s*FAIL|FAILURES" | head -5 | sed 's/^/        /'
    failed=$((failed+1)); FAILED_NAMES+=("$name")
  fi
done

echo "--------------------------------------------------------------------------"
echo "PASS $pass   FAIL $failed   COULD-NOT-START $unstartable"
[ "$failed" -gt 0 ]      && echo "  failing:      ${FAILED_NAMES[*]}"
[ "$unstartable" -gt 0 ] && echo "  cannot start: ${UNSTARTABLE_NAMES[*]}"
if [ "$failed" -eq 0 ] && [ "$unstartable" -eq 0 ]; then
  echo "ALL GREEN"; exit 0
fi
echo "NOT GREEN — do not report this work as done."
exit 1
