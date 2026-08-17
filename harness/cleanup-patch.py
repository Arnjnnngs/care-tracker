#!/usr/bin/env python3
"""
cleanup-patch.py — remove dead demo-seed code from care-tracker index.html.

Base: care-tracker @ 87e89bb (v43.3), index.html md5 8136b7764f07865171c180212a4d5b09

Removes exactly six things, all of them unreachable in the shipped build:
  1. seedDemo()                     — the demo-data seeder itself
  2. the auto-seed call site        — `if (false && wasEmpty && ...) { seedDemo(); }`
  3. the orphaned `wasEmpty` binding — only ever read by (2)
  4. state.demo                     — only ever set by (1)
  5. the demo banner UI             — only rendered when state.demo
  6. the checkNotifications guard   — `&& !state.demo`

The docs claim this went away in v28. It did not: the call site was neutered to
`if (false && ...)` and everything else was left in place.

Properties:
  * ANCHORED   — every edit matches a unique, exact literal; a changed anchor is a
                 hard error, never a silent no-op or a fuzzy match.
  * IDEMPOTENT — running twice is a no-op with exit code 0. Re-running after other
                 patches land is safe.
  * NARROW     — never touches APP_VERSION, sw.js, or any file other than index.html.

Usage:
    python3 cleanup-patch.py [path/to/repo]      # default: cwd
    python3 cleanup-patch.py --check [repo]      # report only, write nothing
"""

import hashlib
import os
import sys

BASE_MD5 = "8136b7764f07865171c180212a4d5b09"

# (name, old, new). `old` must appear exactly once when unapplied.
EDITS = [
    (
        "1. seedDemo() function",
        """
// Seed demo data
async function seedDemo() {
  const n = simNow(), H = 3600000, d0 = dayStart(n);
  const y = d0 - 24 * H;
  const seeds = [
    { medId: 'tylenol', dose: '500 mg', mg: 500, ts: y + 9 * H },
    { medId: 'temp', temp: 100.9, dose: '100.9 °F', mg: 0, ts: y + 9 * H },
    { medId: 'zofran', dose: null, mg: 0, ts: y + 13 * H },
    { medId: 'protonix', dose: null, mg: 0, ts: y + 19 * H },
    { medId: 'tylenol', dose: '1000 mg', mg: 1000, ts: n - 2 * H },
    { medId: 'tylenol', dose: '500 mg', mg: 500, ts: n - 6.5 * H },
    { medId: 'zofran', dose: null, mg: 0, ts: n - 3.2 * H },
    { medId: 'morphine', dose: 'Full · 15 mg', mg: 15, ts: n - 1.1 * H },
    { medId: 'protonix', dose: null, mg: 0, ts: d0 + 8 * H },
    { medId: 'iron', dose: null, mg: 0, ts: n - 5 * H },
    { medId: 'temp', temp: 99.8, dose: '99.8 °F', mg: 0, ts: n - 1.5 * H },
  ].filter(e => e.ts <= n);
  for (const s of seeds) await addEntryDB(s);
  setState({ demo: true });
}
""",
        "",
    ),
    (
        "2+3. auto-seed call site and orphaned wasEmpty binding",
        """unsub = subscribeEntries((entries) => {
  const wasEmpty = state.entries.length === 0 && !state.loaded;
  if (state.timeModal) {
    // Defer update so the modal isn't destroyed mid-interaction
    pendingEntries = entries;
    if (!state.loaded) { state.loaded = true; state.entries = entries; }
    return;
  }
  setState({ entries, loaded: true });
  // If first load and no entries, offer to seed demo data
  if (false && wasEmpty && entries.length === 0) {
    seedDemo();
  }
});""",
        """unsub = subscribeEntries((entries) => {
  if (state.timeModal) {
    // Defer update so the modal isn't destroyed mid-interaction
    pendingEntries = entries;
    if (!state.loaded) { state.loaded = true; state.entries = entries; }
    return;
  }
  setState({ entries, loaded: true });
});""",
    ),
    (
        "4. state.demo flag",
        "now: Date.now(), toast: null, warn: null, demo: false, view: 'home'",
        "now: Date.now(), toast: null, warn: null, view: 'home'",
    ),
    (
        "5. demo banner UI",
        """
  // Demo banner
  if (state.demo) {
    parts.push(h('div', { style: { background: 'rgba(212,104,138,0.08)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(212,104,138,0.18)', borderRadius: '16px', padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' } },
      h('div', { style: { flex: '1', color: '#8A6479', fontSize: '13px', lineHeight: '1.45' } }, 'Showing sample data so you can see the tracker in action. Log a real dose or clear it to start fresh.')
    ));
  }
""",
        "",
    ),
    (
        "6. checkNotifications demo guard",
        "  if (!state.loaded || state.entries.length === 0 && !state.demo) return;",
        "  if (!state.loaded || state.entries.length === 0) return;",
    ),
]

# Guard rails: these must be byte-identical before and after.
UNTOUCHABLE_SUBSTRINGS = ["const APP_VERSION = 'v43.3';"]


def main(argv):
    check_only = "--check" in argv
    args = [a for a in argv[1:] if not a.startswith("--")]
    repo = os.path.abspath(args[0]) if args else os.getcwd()
    path = os.path.join(repo, "index.html")

    if not os.path.isfile(path):
        print("FAIL: no index.html at " + path)
        return 2

    with open(path, encoding="utf-8", newline="") as f:
        original = f.read()

    raw = original.encode("utf-8")
    md5 = hashlib.md5(raw).hexdigest()
    print("index.html: {} bytes, md5 {}".format(len(raw), md5))
    if md5 == BASE_MD5:
        print("  (pristine v43.3 base)")

    text = original
    applied, already = [], []

    for name, old, new in EDITS:
        n = text.count(old)
        if n == 1:
            text = text.replace(old, new, 1)
            applied.append(name)
        elif n == 0:
            # Not found. Either already applied, or the anchor has drifted.
            # Distinguish: if the post-state is present, it is applied; else error.
            if new and text.count(new) >= 1:
                already.append(name)
            elif not new and not _residue(text, name):
                already.append(name)
            else:
                print("FAIL: anchor not found and not already applied -> " + name)
                print("      Refusing to guess. Re-derive the anchor against this file.")
                return 3
        else:
            print("FAIL: anchor matched {} times (expected 1) -> {}".format(n, name))
            return 3

    for s in UNTOUCHABLE_SUBSTRINGS:
        if original.count(s) != text.count(s):
            print("FAIL: patch would alter a protected string: " + s)
            return 4

    # Post-conditions: no demo symbol may survive anywhere.
    for sym in ["seedDemo", "state.demo", "wasEmpty", "demo: false", "demo: true"]:
        if sym in text:
            print("FAIL: post-condition — '{}' still present".format(sym))
            return 5

    for name in already:
        print("  already applied: " + name)
    for name in applied:
        print("  applied:         " + name)

    if not applied:
        print("No changes needed (idempotent no-op).")
        return 0

    delta = len(text.encode("utf-8")) - len(raw)
    print("Net change: {} bytes".format(delta))

    if check_only:
        print("--check: nothing written.")
        return 0

    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print("Wrote {} ({} bytes, md5 {})".format(
        path, len(text.encode("utf-8")),
        hashlib.md5(text.encode("utf-8")).hexdigest()))
    return 0


def _residue(text, name):
    """For deletions, detect leftover fragments that mean the edit is NOT applied."""
    if name.startswith("1."):
        return "seedDemo" in text
    if name.startswith("5."):
        return "Showing sample data so you can see the tracker" in text
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv))
