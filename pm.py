#!/usr/bin/env python3
"""
pm.py — THE PROJECT MANAGER.  Run before starting work and again before saying "done".

WHY THIS EXISTS
  Aaron: "a PM is required at all times for each of my messages/changes."
  He is right, and the reason a PM is needed is on the record: promises were made and not kept
  ("next message will have it pushed" — it did not), dispatch was left off during long silent
  work, finished features were lost because they were never pushed, and a suite was "fixed"
  locally and never committed so the next agent inherited the broken copy.

WHY IT IS A SCRIPT AND NOT AN AGENT
  A subagent BLOCKS the main session completely — it cannot speak while one runs. A PM
  implemented as an agent would recreate the exact silence it is meant to prevent. So the PM is
  mechanical: it cannot forget, cannot be talked out of it, costs no tokens, and runs in seconds.

EXIT CODES:  0 = clear to proceed   1 = BLOCKERS (do not report done)   2 = warnings only
"""
import subprocess, sys, os, re, json

REPO = os.path.dirname(os.path.abspath(__file__))
def sh(c):
    r = subprocess.run(c, shell=True, cwd=REPO, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode

blockers, warnings, notes = [], [], []

# --- 1. Is everything actually pushed? The single most expensive failure on this project. ------
dirty, _ = sh("git status --porcelain")
if dirty:
    blockers.append("UNPUSHED WORK — the sandbox rolls back without warning and has destroyed\n"
                    "    finished features before. Push before anything else:\n      "
                    + "\n      ".join(dirty.splitlines()[:12]))
ahead, _ = sh("git log --oneline @{u}..HEAD 2>/dev/null")
if ahead:
    blockers.append("LOCAL COMMITS NOT ON THE REMOTE:\n      " + "\n      ".join(ahead.splitlines()[:8]))

# --- 2. Version and cache must move together, or phones serve stale code -----------------------
try:
    html = open(os.path.join(REPO, "index.html"), encoding="utf-8").read()
    sw = open(os.path.join(REPO, "sw.js"), encoding="utf-8").read()
    v = re.search(r"APP_VERSION = '([^']*)'", html)
    c = re.search(r"CACHE = '([^']*)'", sw)
    if not v or not c:
        blockers.append("Could not read APP_VERSION or the sw.js CACHE name.")
    else:
        vn = v.group(1).lstrip("v").replace(".", "-")
        if vn not in c.group(1):
            blockers.append("VERSION/CACHE MISMATCH: APP_VERSION=%s but sw.js CACHE=%s.\n"
                            "    Cache-first means phones keep serving the OLD app." % (v.group(1), c.group(1)))
        else:
            notes.append("version %s and cache %s agree" % (v.group(1), c.group(1)))
except FileNotFoundError as e:
    blockers.append("Missing core file: %s" % e)

# --- 3. Dispatch flag must match reality -------------------------------------------------------
try:
    st = open(os.path.join(REPO, "STATUS.md"), encoding="utf-8").read()
    m = re.search(r"^DISPATCH:\s*(\w+)", st, re.M)
    if not m:
        blockers.append("STATUS.md has no DISPATCH line — dispatch defaults to silent, so a stall "
                        "would go unreported.")
    else:
        notes.append("dispatch flag = %s" % m.group(1))
        if m.group(1).upper() == "ACTIVE":
            notes.append("ACTIVE: the two scheduled tasks must be ENABLED, or nobody is watching.")
        else:
            notes.append("IDLE: correct only if no work is in progress.")
    live = re.search(r"\*\*Version\*\*\s*\|\s*(v[\d.]+)", st)
    if live and v and live.group(1) != v.group(1):
        warnings.append("STATUS.md says live is %s but the build here is %s — update STATUS.md "
                        "in the SAME commit." % (live.group(1), v.group(1)))
except FileNotFoundError:
    blockers.append("STATUS.md is missing — it is the source of truth for every future session.")

# --- 4. The traps this project has actually shipped -------------------------------------------
if 'html' in dir():
    tick = "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();"
    if tick not in html:
        blockers.append("The composed 1s tick guard is missing or altered. tour-test.mjs pins it\n"
                        "    byte-for-byte and it is built from four separate patches.")
    for pat, msg in [
        (r"(disabled|checked|selected|aria-current)\s*:\s*(null|false)\b",
         "h() TRAP: a conditional attribute passed as null/false. h() calls setAttribute, so it\n"
         "    renders disabled=\"null\" and DISABLES the control. Spread it instead."),
        (r"\|\|\s*true\b", "a `|| true` — a check that cannot fail has shipped here before."),
        (r"TODO|FIXME|PLACEHOLDER", "a TODO/FIXME/PLACEHOLDER in a production path."),
    ]:
        hits = [mm for mm in re.finditer(pat, html)
                if not re.match(r"\s*//", html[html.rfind("\n", 0, mm.start())+1:mm.start()+1])]
        if hits: blockers.append(msg + "  (%d occurrence(s))" % len(hits))
    for mo in re.finditer(r"h\('(input|textarea|select)',\s*(?:Object\.assign\(\s*)?\{", html):
        ob = html.index('{', mo.start()); d = 0
        for i in range(ob, len(html)):
            if html[i] == '{': d += 1
            elif html[i] == '}':
                d -= 1
                if d == 0: break
        f = re.search(r"fontSize:\s*'([\d.]+)px'", html[ob:i+1])
        if not f or float(f.group(1)) < 16:
            warnings.append("a <%s> is under the 16px iOS floor — Safari zooms in and never back." % mo.group(1))
            break
    # the module must parse
    mm = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    if mm:
        open('/tmp/pm-check.mjs', 'w', encoding='utf-8').write(mm.group(1))
        _, rc = sh("node --check /tmp/pm-check.mjs")
        if rc != 0: blockers.append("index.html does NOT parse as valid JavaScript.")
        else: notes.append("index.html parses as valid JavaScript")

# --- 5. Reproducibility: the release must rebuild from the repo alone --------------------------
h = os.path.join(REPO, "harness")
if not os.path.isdir(h):
    blockers.append("No harness/ — the release is not reproducible from this repo.")
else:
    n = len([f for f in os.listdir(h) if f.endswith(('.py', '.mjs'))])
    notes.append("harness/ has %d patch+test files" % n)

print("=" * 74)
print("PM CHECK — %s" % REPO)
print("=" * 74)
for n in notes: print("  ok   " + n)
for w in warnings: print("  WARN " + w)
for b in blockers: print("  STOP " + b)
print("-" * 74)
if blockers:
    print("RESULT: %d BLOCKER(S). Do NOT tell Aaron this is done." % len(blockers)); sys.exit(1)
if warnings:
    print("RESULT: clear, with %d warning(s) to disclose." % len(warnings)); sys.exit(2)
print("RESULT: clear."); sys.exit(0)
