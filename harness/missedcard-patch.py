#!/usr/bin/env python3
"""
missedcard-patch.py — a Quick Log card must not hide a missed dose behind "Waiting".

REPORTED BY AARON (v48, live):
  He did not log Protonix this morning. He got a missed-dose alert for Protonix Morning — correct.
  But the Protonix card read "Waiting - Next dose at 8:00 PM" and said nothing about the morning
  dose having been skipped, while Zofran beside it read "Available". It looked broken.

IT WAS NOT BROKEN — AND THAT IS THE PROBLEM.
  Protonix is windowed (Morning 8-12, Evening 20-22, alerts on). After noon the morning window has
  closed unlogged, so the alert is right, and the next window is 8 PM, so "Waiting" is right too.
  Zofran is as-needed (type 'gap', gapH 0) and can never be missed, so "Available" is right.
  Every individual state was correct. What was wrong is that the CARD and the BANNER told different
  stories about the same medication: "Waiting" reads as *nothing is wrong, just wait*, which is
  precisely the wrong impression when a scheduled dose was skipped.

THE FIX
  The card now says so, reusing missedDosesFor() -- the SAME function that raises the banner -- so
  the two can never disagree. No second definition of "missed" is introduced; that would just be a
  new way for them to drift apart.
"""
import argparse, hashlib, re, subprocess, tempfile, os, sys

def die(m):
    print("FAIL: " + m); sys.exit(2)

ANCHOR = """        locked ? h('span', { style: { flexShrink: '0', color: (st.ceilingHit || st.chemoBlock) ? '#A15B56' : '#96631C', fontWeight: '700', fontSize: '11px', whiteSpace: 'nowrap' } }, nextDoseLabel) : null,"""

REPLACE = """        locked ? h('span', { style: { flexShrink: '0', color: (st.ceilingHit || st.chemoBlock) ? '#A15B56' : '#96631C', fontWeight: '700', fontSize: '11px', whiteSpace: 'nowrap' } }, nextDoseLabel) : null,
        // A CARD MUST NEVER HIDE A MISSED DOSE BEHIND "Waiting". Reported live: Protonix showed
        // "Waiting - Next dose at 8:00 PM" with no sign the Morning window had been skipped, while
        // the missed-dose banner at the top of the SAME screen said it had. Both were individually
        // correct and together they read as a bug.
        //
        // missedDosesFor() is the SAME function the banner uses. Reused deliberately rather than
        // recomputing "missed" here: a second definition is a second thing to drift.
        missedTodayLabel ? h('span', { 'data-missed-on-card': 'true', style: { flexShrink: '0', color: '#A13830', fontWeight: '800', fontSize: '11px', whiteSpace: 'nowrap' } }, missedTodayLabel) : null,"""

CALC_ANCHOR = """    const countdownLabel = locked && st.availableAt ? fmtCountdown(st.availableAt - now) : '';"""

CALC_NEW = """    const countdownLabel = locked && st.availableAt ? fmtCountdown(st.availableAt - now) : '';
    // Windows of THIS medication that closed today with nothing logged in them. Same source as the
    // banner. Named windows are listed ("Morning missed"); an unnamed one degrades to a count, so a
    // medication whose windows have no names still reports honestly instead of printing "undefined".
    const missedToday = missedDosesFor(now, now).filter(x => x.medId === med.id);
    const missedNames = missedToday.map(x => x.windowName).filter(Boolean);
    const missedTodayLabel = !missedToday.length ? ''
      : (missedNames.length === missedToday.length
          ? missedNames.join(' + ') + ' missed'
          : missedToday.length + ' missed today');"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    src = open(a.file, encoding="utf-8").read()
    print("in   %s\n     md5 %s" % (a.file, hashlib.md5(src.encode()).hexdigest()))
    if "data-missed-on-card" in src:
        print("ALREADY APPLIED — nothing written."); return
    out = src
    for name, old, new in [("1. compute today's missed windows for this card", CALC_ANCHOR, CALC_NEW),
                           ("2. show it on the card, beside the next-dose label", ANCHOR, REPLACE)]:
        if out.count(old) != 1: die("anchor matched %d times (need 1) -> %s" % (out.count(old), name))
        out = out.replace(old, new, 1)
        print("  ok  " + name)

    vi = re.search(r"const APP_VERSION = '([^']*)';", src)
    vo = re.search(r"const APP_VERSION = '([^']*)';", out)
    if not vi or not vo or vi.group(1) != vo.group(1):
        die("APP_VERSION changed. This patch must never touch it.")
    if out.count("function missedDosesFor") != 1:
        die("missedDosesFor was duplicated — the banner and the card must share ONE definition.")
    if "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();" not in out:
        die("the pinned 1s tick guard was damaged.")
    if out.count("uiIsBusy()") < 4: die("the v47 sync guards were damaged.")
    if "throw err;" not in out: die("the v48 write-failure rethrow was removed.")
    m = re.search(r'<script type="module">(.*?)</script>', out, re.S)
    if not m: die("module block not found")
    tf = tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8')
    tf.write(m.group(1)); tf.close()
    r = subprocess.run(['node', '--check', tf.name], capture_output=True, text=True)
    os.unlink(tf.name)
    if r.returncode != 0: die("patched file is not valid JavaScript:\n" + r.stderr.strip()[:400])
    print("  ok  post: patched module parses as valid JavaScript")

    if a.check:
        print("check only — nothing written."); return
    open(a.file, "w", encoding="utf-8").write(out)
    print("\nout  md5 %s  (%+d bytes)\n     APP_VERSION untouched: %s ; sw.js not opened."
          % (hashlib.md5(out.encode()).hexdigest(), len(out)-len(src), vo.group(1)))

main()
