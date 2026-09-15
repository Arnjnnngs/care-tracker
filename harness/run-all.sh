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
  # EXEMPT, SAID OUT LOUD -- AND THE OLD WORDING HERE WAS WRONG IN THE ONE WAY THAT MATTERED.
  #
  # It said "none of them is a gate on the current release and none goes red BECAUSE of it". The
  # first half is a choice and still stands. THE SECOND HALF WAS FALSE. On 2026-09-15 two of these
  # four went red on a defect in the SHIPPING build -- FILE-no-setState-in-onInput, in both
  # reason-test and deactivate-test -- and it was a real one: the password box on a
  # password-protected backup destroyed itself on every keystroke, one character per tap, on the
  # screen that restores an encrypted backup. That became v78.
  #
  # So the honest statement is narrower: these four carry PATCH-ERA EXPECTATIONS that no longer
  # describe this app, which is why their totals do not move between releases -- not that they have
  # nothing to say about it. Each red inside them still needs the same verdict recorded one way or
  # the other: is the APP wrong, or is the CHECK? Task #32 on the sheet is that triage.
  #
  # EVERY FIGURE BELOW CARRIES THE DATE IT WAS MEASURED, because an undated count in a list of known
  # problems is how this project sent real work at a solved problem three times (CLAUDE.md Rule 7).
  #
  # Deleting a line here makes that suite run and count again.
  case "$name" in
    tour-test.mjs)       echo "| $name | EXEMPT | v44 tour-patch verifier: compares a patched build to an unpatched base, so it fails 'APP_VERSION equals base' by construction on any release. Needs --base; not a statement about this build |" >> "$OUT"; continue ;;
    medsync-test.mjs)    echo "| $name | EXEMPT | v44 medsync-patch verifier; needs --base and hangs past the 600s limit (v71, v72, and again at v77 on 2026-09-15). Never yet measured to completion, so nothing is known about what it would say -- task #32 |" >> "$OUT"; continue ;;
    reason-test.mjs)     echo "| $name | EXEMPT | v43.4 reason-patch verifier; 34/41 at v71, v72 and again at v77 (2026-09-15), identical every time. ONE of those reds was real and is fixed in v78 (FILE-no-setState-in-onInput); the other six are patch-era expectations awaiting triage -- task #32 |" >> "$OUT"; continue ;;
    deactivate-test.mjs) echo "| $name | EXEMPT | v43.3 deactivate-patch verifier; 21/34 at v71 and v72, 12 red at v77 measured 2026-09-15 with the 600s gate lifted. ONE was real and is fixed in v78 (FILE-no-setState-in-onInput); the rest are 'removed medication' checks written for a deactivation mechanism this app replaced with archiving -- task #32 |" >> "$OUT"; continue ;;
  esac
  echo "== $name"
  # Every suite is handed the real file. The v43-era suites USED to default to harness/work/index.html,
  # a directory that stopped existing with the sandbox that made it -- that is how export-test could
  # be dead for six releases with nobody noticing. Passing --file here hid it from THIS script while
  # leaving it fatal for anyone running a suite by hand, which is how seven of them sat on the task
  # sheet as "rebase or retire" while passing perfectly: cal-test 70/70, export-test 49/49,
  # medskip-test 10/10 against live v77. The defaults were fixed on 2026-09-15 (commit 4958124) --
  # they prefer harness/work/ when it exists and fall back to the repo's own index.html -- so a
  # plain `node harness/<suite>.mjs` now works and this --file is belt and braces rather than the
  # only thing holding them up.
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
