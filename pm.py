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
            notes.append("ACTIVE: both hourly tasks are ALWAYS enabled and push to Aaron's "
                         "phone. This flag is the ONLY thing keeping them quiet — do not set "
                         "ACTIVE until work is actually underway.")
        else:
            notes.append("IDLE: correct only if no work is in progress.")
    # The KEY that explains the flag must define both states, once each. It said IDLE twice and
    # never defined ACTIVE for a week -- so the one document explaining when Aaron gets notified
    # contradicted itself, and nothing caught it. A flag whose meaning is ambiguous is a flag that
    # gets set wrong.
    for state in ("ACTIVE", "IDLE"):
        n = len(re.findall(r"^- \*\*`DISPATCH: %s`\*\*" % state, st, re.M))
        if n != 1:
            blockers.append("STATUS.md's dispatch key defines `DISPATCH: %s` %d time(s), expected "
                            "exactly 1 — the flag's own definition is unreadable." % (state, n))
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

# --- 6. STATUS.md must record the md5 of what actually shipped ---------------------------------
# Added after the WRONG hash went into STATUS.md twice (v53 and v55). Both times it was captured
# BEFORE the version bump, so the file recorded a build that was never pushed. Nothing broke and no
# test failed -- which is precisely why this needed a check that fails loudly. Verification on this
# project is "re-clone and compare md5", and a wrong recorded hash makes that ritual meaningless.
import hashlib as _hl
_sp = os.path.join(REPO, "STATUS.md")
if os.path.exists(_sp):
    _txt = open(_sp, encoding="utf-8").read()
    _i = _txt.find("## LIVE RIGHT NOW")
    if _i >= 0:
        _blk = _txt[_i:_i + 1200]
        for _name in ("index.html", "sw.js"):
            _fp = os.path.join(REPO, _name)
            if not os.path.exists(_fp):
                continue
            _m = re.search(r"\*\*" + re.escape(_name) + r" md5\*\* \| `([0-9a-f]{32})`", _blk)
            if not _m:
                warnings.append("STATUS.md does not record an md5 for %s" % _name)
                continue
            _actual = _hl.md5(open(_fp, "rb").read()).hexdigest()
            if _m.group(1) != _actual:
                blockers.append("STATUS.md says %s is %s but it is actually %s — re-clone verification would prove nothing"
                                % (_name, _m.group(1)[:12], _actual[:12]))
            else:
                notes.append("STATUS.md md5 for %s matches the file" % _name)

# --- 7. THE GATES THEMSELVES ---------------------------------------------------------------
# Added 2026-08-24. Every check above this line inspects index.html. NONE of them ever looked at
# the suites, and that is exactly where the defects were hiding:
#   * A literal `|| true` sat in outputs/webmain-v43/run.mjs making an assertion permanently green.
#     pm.py checked index.html for `|| true` and walked straight past the file that had one.
#   * All 39 suites across the three repos hardcoded a playwright path from a retired sandbox and
#     could not START. A gate that cannot start is indistinguishable from a gate that passes.
#   * Suites pinned version literals ('app-v64') and broke on the very next release -- three
#     patches lost to this already.
# The gates are code too. They get checked like code.
_SUITE_EXT = ('.mjs', '.sh')
_SKIP_DIRS = {'.git', 'node_modules', 'outputs/v58-shots'}
_suites = []
for _root, _dirs, _files in os.walk(REPO):
    _dirs[:] = [d for d in _dirs if d not in _SKIP_DIRS and not d.startswith('.git')]
    for _f in _files:
        if _f.endswith(_SUITE_EXT):
            _suites.append(os.path.join(_root, _f))

def _strip_comments(_t):
    return re.sub(r'^\s*(//|#).*$', '', re.sub(r'/\*[\s\S]*?\*/', '', _t), flags=re.M)

_dead_paths, _ortrue, _pinned = [], [], []
for _f in _suites:
    try: _t = open(_f, encoding='utf-8').read()
    except Exception: continue
    _rel = os.path.relpath(_f, REPO)
    _code = _strip_comments(_t)
    # a path from an environment that no longer exists = a gate that cannot start
    # DIRECT use only. A dead path listed as one CANDIDATE among fallbacks is fine -- that is the
    # fix, not the bug. Flag it only when it is the single thing being required/read, which is what
    # actually stops a suite starting.
    for _m in re.finditer(
            r"(?:require|readFileSync|createReadStream|import)\s*\(\s*"
            r"['\"](/home/claude/[^'\"]*|/tmp/[A-Za-z0-9_.-]+\.(?:js|mjs|json|html))['\"]", _code):
        _dead_paths.append("%s -> %s" % (_rel, _m.group(1)))
    if re.search(r"\|\|\s*true\b", _code):
        _ortrue.append(_rel)
    # a version literal in a suite breaks on the next release; read it from the file under test
    for _m in re.finditer(r"['\"]((?:app-|beta-)?v\d+(?:\.\d+)?)['\"]", _code):
        _pinned.append("%s -> '%s'" % (_rel, _m.group(1)))

if _dead_paths:
    blockers.append("GATE CANNOT START — %d suite reference(s) point at a path from a dead\n"
                    "    environment. A gate that cannot start looks exactly like one that passes:\n    %s"
                    % (len(_dead_paths), "\n    ".join(sorted(set(_dead_paths))[:6])))
if _ortrue:
    blockers.append("a `|| true` in %d suite file(s) — a check that cannot fail has shipped here\n    before: %s"
                    % (len(_ortrue), ", ".join(sorted(set(_ortrue))[:6])))
if _pinned:
    _u = sorted(set(_pinned))
    warnings.append("PINNED VERSION LITERAL in %d place(s) — compare input to output, or read\n"
                    "    APP_VERSION from the file under test. This has cost three patches.\n"
                    "    JUDGEMENT REQUIRED: a harness/ PATCH legitimately names the versions it\n"
                    "    transforms between. An ASSERTION never should — that is the one that goes\n"
                    "    red on the next release for no defect:\n    %s"
                    % (len(_u), "\n    ".join(_u[:8])))

# --- 8. THE NOTES MUST MOVE WITH THE CODE ------------------------------------------------------
# Aaron, 2026-08-24: "we need to make sure that notes are being updated each final push and commit."
# Documentation failures are SILENT -- nothing breaks when a changelog goes stale, so no amount of
# careful reading catches it. Only a check that fails loudly does. Today's evidence: BETA_HANDOFF
# still said "Last updated July 23" and "Current version v71" seven releases later, and a debug
# checklist named a banner renamed months earlier -- which would have told a reader the beta was
# writing to the patient's real records.
_changed, _rc = sh("git -C %s diff --name-only origin/main 2>/dev/null" % REPO)
if _rc == 0 and _changed.strip():
    _files_changed = set(_changed.split())
    _app_touched = {f for f in ("index.html", "sw.js") if f in _files_changed}
    if _app_touched:
        _required = ("README.md", "CARETRACKER_HANDOFF.md", "STATUS.md")
        _missing = [d for d in _required if d not in _files_changed]
        if _missing:
            blockers.append("NOTES DID NOT MOVE WITH THE CODE — %s changed but %s did not.\n"
                            "    Docs are part of 'done', not a follow-up task. Update them in the\n"
                            "    SAME commit." % (", ".join(sorted(_app_touched)), ", ".join(_missing)))
        else:
            notes.append("notes moved with the code (%s + all three docs)" % ", ".join(sorted(_app_touched)))

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
