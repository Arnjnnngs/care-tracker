#!/usr/bin/env python3
"""
honesty-patch.py — two fixes the app has needed for a long time.

A) A FAILED WRITE IS NEVER AGAIN REPORTED AS SUCCESS.
   `addEntryDB()` was a bare `await addDoc(col, entry)` with no error handling, called from 18
   places. Every caller does `await addEntryDB(...)` and then immediately shows a success toast.
   If Firestore refuses the write (offline, rules, quota) the rejection was unhandled, the toast
   still said "logged", and the patient believed a dose was recorded when nothing was.
   The same shape as the export buttons that reported success with no file.

   Fix: addEntryDB never throws. On failure it records the error, raises a PERSISTENT banner
   (a toast is not good enough for "your dose did not save" — it vanishes in seconds), and
   suppresses exactly one following success toast so the lie cannot reach the screen.
   Returns true/false so future callers can branch without changing the 18 existing ones.

B) iOS NO LONGER ZOOMS IN AND STAYS ZOOMED.
   15 inputs/selects/textareas were under 16px. Mobile Safari zooms the page whenever a field
   under 16px is focused and does NOT zoom back out afterwards, leaving the app stranded at the
   wrong scale. Every one is raised to exactly 16px. Reported by the weight field but systemic.
"""
import argparse, hashlib, re, sys

def die(m):
    print("FAIL: " + m); sys.exit(2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    src = open(a.file, encoding="utf-8").read()
    print("in   %s\n     md5 %s" % (a.file, hashlib.md5(src.encode()).hexdigest()))
    if "state.writeError" in src or "writeError:" in src:
        print("ALREADY APPLIED — nothing written."); return
    out = src

    # ---------- A1: honest addEntryDB -------------------------------------------------------
    old = "async function addEntryDB(entry) { await addDoc(col, entry); }"
    if out.count(old) != 1: die("addEntryDB anchor matched %d times" % out.count(old))
    new = """// A rejected write used to be a SILENT failure: the rejection went unhandled, the caller's
// success toast was skipped by the throw, the modal had already closed -- and the patient was
// told nothing at all. She would believe a dose was recorded when nothing reached the database.
//
// This STILL THROWS. That is deliberate and load-bearing: mrSaveReason(), saveApptSheet() and
// removeAppt() wrap their calls in try/catch to keep their sheet open and show an honest inline
// error. An earlier version of this patch swallowed the error and returned false, which silently
// disarmed all three of those handlers -- caught by reason-test.mjs (ERROR-is-recoverable), not
// by inspection. Raise the banner, then rethrow so every existing handler behaves exactly as before.
async function addEntryDB(entry) {
  try {
    await addDoc(col, entry);
  } catch (err) {
    console.warn('[write] entry was rejected:', err);
    // A toast vanishes in seconds. "Your dose did not save" must stay on screen until acknowledged.
    setState({ writeError: "That didn't save. Nothing was lost — check your connection and log it again." });
    throw err;
  }
}"""
    out = out.replace(old, new, 1)
    print("  ok  A1. addEntryDB reports failure instead of swallowing it")

    # A2 (suppressing a false success toast) was REMOVED. It only existed because an earlier
    # version made addEntryDB swallow the error and return normally, so the caller went on to
    # announce success. Now that the function rethrows, the throw itself skips the success toast
    # and no suppression hack is needed. Fewer moving parts, and nothing to disarm a caller.

    # ---------- A3: the persistent banner ----------------------------------------------------
    if "writeError:" not in out:
        old_state = "let state = { entries: []"
        if out.count(old_state) != 1: die("state initialiser anchor not unique")
        out = out.replace(old_state, "let state = { writeError: null, entries: []", 1)
    print("  ok  A3. writeError added to state")

    anchor = "  // MISSED DOSE ALERT — always on top; a Clear button lets the caregiver acknowledge"
    if out.count(anchor) != 1: die("banner mount anchor matched %d times" % out.count(anchor))
    # renderToday() builds its output with parts.push(...) — a STATEMENT context, not an
    # expression list. An earlier version inserted a `cond ? h(...) : null,` element here and
    # produced a hard syntax error caught by `node --check` before anything shipped.
    banner = """  // WRITE FAILURE — pushed above everything, including the missed-dose alert. If a dose did not
  // reach the database that is the most important thing on the screen, and unlike a toast it
  // stays until it is acknowledged.
  if (state.writeError) {
    parts.push(h('div', { role: 'alert', style: { background: 'rgba(192,69,59,0.16)', border: '2px solid #C0453B', borderRadius: '16px', padding: '13px 14px', display: 'flex', gap: '11px', alignItems: 'flex-start', boxShadow: '0 4px 24px rgba(192,69,59,0.25)' } },
      h('span', { style: { flexShrink: '0', width: '26px', height: '26px', borderRadius: '50%', background: '#C0453B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '16px' } }, '!'),
      h('div', { style: { flex: '1', minWidth: '0', fontSize: '14px', lineHeight: '1.45', color: '#8E3029', fontWeight: '700' } }, state.writeError),
      h('button', { onClick: () => setState({ writeError: null }), style: { flexShrink: '0', minHeight: '44px', minWidth: '44px', borderRadius: '10px', background: 'transparent', color: '#8E3029', fontSize: '13.5px', fontWeight: '800' } }, 'OK')
    ));
  }
""" + anchor
    out = out.replace(anchor, banner, 1)
    print("  ok  A4. persistent write-failure banner mounted above the missed-dose alert")

    # ---------- B: 16px floor on every text-entry control ------------------------------------
    # A regex cannot do this. The attrs object contains a nested `style: { ... }`, so a
    # non-greedy match stops at the first inner brace and silently covers only a few controls.
    # (First attempt did exactly that: it "raised 4" and its post-condition, sharing the same bad
    # regex, confirmed success. Brace-match properly instead.)
    def attrs_span(text, open_idx):
        depth = 0
        for i in range(open_idx, len(text)):
            c = text[i]
            if c == '{': depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0: return i + 1
        return -1

    raised = []
    pieces = []
    pos = 0
    for mo in re.finditer(r"h\('(input|textarea|select)',\s*(?:Object\.assign\(\s*)?\{", out):
        tag = mo.group(1)
        ob = out.index('{', mo.start())
        end = attrs_span(out, ob)
        if end < 0: die("unbalanced attrs object for <%s> at offset %d" % (tag, mo.start()))
        if mo.start() < pos: continue
        seg = out[ob:end]
        fm = re.search(r"fontSize:\s*'([\d.]+)px'", seg)
        pieces.append(out[pos:ob])
        if fm and float(fm.group(1)) < 16:
            raised.append((tag, float(fm.group(1))))
            seg = seg[:fm.start()] + "fontSize: '16px'" + seg[fm.end():]
        elif not fm:
            # No explicit size: it inherits, which on this app can land under 16px. Make it explicit.
            ins = seg.index('{') + 1
            seg = seg[:ins] + " fontSize: '16px'," + seg[ins:]
            raised.append((tag, None))
        pieces.append(seg)
        pos = end
    pieces.append(out[pos:])
    out = ''.join(pieces)
    print("  ok  B. raised %d controls to the 16px iOS floor (was: %s)"
          % (len(raised), sorted(set(str(r[1]) for r in raised))))

    # ---------- post-conditions --------------------------------------------------------------
    vi = re.search(r"const APP_VERSION = '([^']*)';", src)
    vo = re.search(r"const APP_VERSION = '([^']*)';", out)
    if not vi or not vo or vi.group(1) != vo.group(1):
        die("APP_VERSION changed. This patch must never touch it.")
    if "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();" not in out:
        die("the pinned tick guard was damaged.")
    if out.count("uiIsBusy()") < 4:
        die("the v47 sync guards were damaged.")
    if out.count("await addDoc(col, entry)") != 1:
        die("addEntryDB no longer has exactly one write.")
    if "throw err;" not in out:
        die("addEntryDB stopped rethrowing — that silently disarms mrSaveReason, saveApptSheet\n"
            "    and removeAppt, which rely on catching it to show their own inline error.")
    # Verified with the SAME brace matching used to make the change -- not a regex that stops at
    # the first nested brace, which is what made the first attempt report false success.
    left = []
    for mo in re.finditer(r"h\('(input|textarea|select)',\s*(?:Object\.assign\(\s*)?\{", out):
        ob = out.index('{', mo.start()); end = attrs_span(out, ob)
        f = re.search(r"fontSize:\s*'([\d.]+)px'", out[ob:end])
        if not f: left.append((mo.group(1), 'NO fontSize'))
        elif float(f.group(1)) < 16: left.append((mo.group(1), f.group(1)))
    if left: die("controls still under the 16px iOS floor: %s" % left)
    if out.count("updateDoc(") != src.count("updateDoc("):
        die("Firestore write surface changed. Rules are append-only.")

    # A syntax error must never leave this script. Extract the module and parse it.
    import subprocess, tempfile, os as _os
    _m = re.search(r'<script type="module">(.*?)</script>', out, re.S)
    if not _m: die("module script block not found")
    _tf = tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8')
    _tf.write(_m.group(1)); _tf.close()
    _r = subprocess.run(['node', '--check', _tf.name], capture_output=True, text=True)
    _os.unlink(_tf.name)
    if _r.returncode != 0:
        die("the patched file is not valid JavaScript:\n" + _r.stderr.strip()[:400])
    print("  ok  post: patched module parses as valid JavaScript")

    if a.check:
        print("check only — nothing written."); return
    open(a.file, "w", encoding="utf-8").write(out)
    print("\nout  %s\n     md5 %s  (%+d bytes)" % (a.file, hashlib.md5(out.encode()).hexdigest(), len(out)-len(src)))
    print("     APP_VERSION untouched: %s ; sw.js not opened." % vo.group(1))

main()
