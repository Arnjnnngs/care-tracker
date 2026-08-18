#!/usr/bin/env python3
"""
syncguard-patch.py — stop live-sync repaints from wiping what someone is typing.

THE BUG (reported live by Aaron, v46, both phones):
  Typing into the weight field (and other plain inputs) gets destroyed mid-entry; the page
  appears to "refresh" on its own.

ROOT CAUSE:
  The once-a-second clock tick was carefully guarded against repainting while the user is
  typing or a dialog is open. The two FIRESTORE SNAPSHOT handlers were never given the same
  protection:
    * subscribeEntries(...) deferred only for state.timeModal / state.apptSheet. Any other
      input -- weight, temperature, medication editor fields, note fields -- was unprotected.
    * subscribePrefs(...)  had NO guard at all; every prefs snapshot called setState() and
      repainted the whole tree unconditionally.
  v46 (shared medication settings) made this much more visible by writing device snapshots
  and the shared config into that same prefs document, so prefs snapshot traffic went up
  sharply against an unguarded repaint.

THE FIX:
  One shared predicate, uiIsBusy(), used by BOTH snapshot handlers. When the UI is busy the
  snapshot payload is HELD (never dropped) and flushed the moment the UI is free.

WHAT THIS PATCH DELIBERATELY DOES NOT DO:
  It does not touch the 1s tick guard line. That exact string is pinned verbatim by
  tour-test.mjs and composed from four different patches; editing it here would turn a green
  suite red and re-open a defect this project has already shipped once.

NEVER LOSE A SYNC:
  Deferring is only safe if the held update always lands. Data loss on a medication app is
  worse than a lost keystroke. Every deferral path here stores the payload and is flushed
  from the existing 1s interval, which runs regardless of renders.
"""
import argparse, hashlib, re, sys

def die(m):
    print("FAIL: " + m); sys.exit(2)

EDITS = []

# ---- 1. shared predicate + pending slot, declared next to pendingEntries -------------------
EDITS.append((
"1. uiIsBusy() predicate and the prefs pending slot",
"""let pendingEntries = null;""",
"""let pendingEntries = null;
// A prefs snapshot carries the cleared-banner high-water mark and (since v46) the shared
// medication list.  It is held, never dropped, while the UI is busy -- same contract as
// pendingEntries.  Merged newest-wins so a burst of prefs writes collapses into one repaint.
let pendingPrefs = null;

// THE ONE PLACE that answers "would repainting right now destroy what someone is doing?".
// Both Firestore snapshot handlers consult this.  The 1s clock tick has its own inline guard
// that is pinned verbatim by tour-test.mjs and composed from four separate patches -- it is
// deliberately NOT routed through here, because rewriting that line to share this helper
// would turn a green suite red for no behavioural gain.
//
// Why focus matters and not just "is a modal open": the reported bug was the WEIGHT field,
// which lives on an ordinary screen with no modal at all.  Guarding only on modals is what
// left it exposed.
function uiIsBusy() {
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  return typing
    || !!state.timeModal
    || !!state.apptSheet
    || !!state.missReasonSheet
    || !!state.medEditor
    || !!state.tour;
}"""))

# ---- 2. entries handler: guard on uiIsBusy, not just two modals ----------------------------
EDITS.append((
"2. entries snapshot defers while the UI is busy",
"""  if (state.timeModal || state.apptSheet) {
    // Defer update so the modal isn't destroyed mid-interaction
    pendingEntries = entries;
    if (!state.loaded) { state.loaded = true; state.entries = entries; }
    return;
  }
  setState({ entries, loaded: true });""",
"""  if (uiIsBusy()) {
    // Defer the swap AND the repaint that comes with it.  Previously this checked only
    // timeModal/apptSheet, so a sync landing while someone typed a weight, a temperature or a
    // medication name rebuilt the tree under them and the entry was lost.  The payload is
    // held, not discarded -- syncFlushPending() below lands it as soon as the UI is free.
    pendingEntries = entries;
    // First load still populates immediately: an empty app showing nothing because the user
    // happened to be focused somewhere would be a worse bug than the one being fixed.
    if (!state.loaded) { state.loaded = true; state.entries = entries; render(); }
    return;
  }
  setState({ entries, loaded: true });"""))

# ---- 3. prefs handler: the completely unguarded path ---------------------------------------
EDITS.append((
"3. prefs snapshot defers while the UI is busy",
"""  const patch = { missedClearedAt: prefs && prefs.missedClearedAt ? prefs.missedClearedAt : 0 };
  try { medsyncOnPrefs(prefs, patch); } catch (err) { console.warn('[medsync] prefs handler:', err); }
  setState(patch);""",
"""  const patch = { missedClearedAt: prefs && prefs.missedClearedAt ? prefs.missedClearedAt : 0 };
  try { medsyncOnPrefs(prefs, patch); } catch (err) { console.warn('[medsync] prefs handler:', err); }
  // This handler had NO guard at all: every prefs snapshot repainted the whole tree.  v46 put
  // the shared medication list and per-device snapshots into this same document, so ordinary
  // use now generates prefs traffic that lands while somebody is typing.
  if (uiIsBusy()) {
    // Newest-wins merge rather than replace: two snapshots arriving back to back must not let
    // the second one drop a field the first one carried.
    pendingPrefs = Object.assign(pendingPrefs || {}, patch);
    return;
  }
  setState(patch);"""))

# ---- 4. the flush, driven by the interval that already runs every second -------------------
EDITS.append((
"4. flush held snapshots as soon as the UI is free",
"""setInterval(() => {
  state.now = simNow();
  const activeTag = document.activeElement && document.activeElement.tagName;""",
"""// Lands anything the snapshot handlers held back.  Driven by the 1s interval below, which runs
// whether or not a render happens, so a held update can never be stranded -- the worst case is
// that it appears up to one second late, which is invisible next to losing a typed entry.
function syncFlushPending() {
  if (uiIsBusy()) return;
  if (!pendingEntries && !pendingPrefs) return;
  const patch = {};
  if (pendingPrefs) { Object.assign(patch, pendingPrefs); pendingPrefs = null; }
  if (pendingEntries) { patch.entries = pendingEntries; patch.loaded = true; pendingEntries = null; }
  setState(patch);   // one repaint for both, never two
}

setInterval(() => {
  state.now = simNow();
  // Flush FIRST: if a sync has been waiting for the user to stop typing, showing it is more
  // urgent than advancing the clock, and doing it here means the tick's own guard below sees
  // the already-updated state instead of repainting twice in the same second.
  syncFlushPending();
  const activeTag = document.activeElement && document.activeElement.tagName;"""))

# NOTE: an edit that prefixed the 1s tick guard with `!flushed` was REMOVED before shipping.
# tour-test.mjs pins that line BYTE-FOR-BYTE, and the guard is composed from four separate
# patches, so touching it turns a green suite red. The only thing that edit bought was avoiding
# a second repaint in a second where a flush already painted -- and that second repaint is
# harmless by construction, because a flush only ever happens when the UI is NOT busy.
# Cheap correctness beats a micro-optimisation that fights a pinned invariant.

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    src = open(a.file, encoding="utf-8").read()
    print("in   %s\n     md5 %s" % (a.file, hashlib.md5(src.encode()).hexdigest()))

    if "function uiIsBusy()" in src:
        print("ALREADY APPLIED — nothing written."); return

    out = src
    for name, old, new in EDITS:
        n = out.count(old)
        if n != 1:
            die("anchor matched %d times (need exactly 1) -> %s\n"
                "      The base file has moved. Re-derive the anchor rather than loosening it." % (n, name))
        out = out.replace(old, new, 1)
        print("  ok  " + name)

    # ---- post-conditions -------------------------------------------------------------------
    vi = re.search(r"const APP_VERSION = '([^']*)';", src)
    vo = re.search(r"const APP_VERSION = '([^']*)';", out)
    if not vi or not vo: die("APP_VERSION declaration not found.")
    if vi.group(1) != vo.group(1):
        die("APP_VERSION changed %s -> %s. This patch must never touch it." % (vi.group(1), vo.group(1)))

    # the tick guard line is pinned verbatim by tour-test.mjs; only the !flushed prefix may differ
    if "!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing" not in out:
        die("the composed tick guard was damaged. Every term belongs to a different patch.")
    if out.count("uiIsBusy()") < 4:
        die("uiIsBusy() is not wired into both snapshot handlers and the flush.")
    if "pendingEntries = entries;" not in out or "pendingPrefs = Object.assign" not in out:
        die("a deferral path stopped holding its payload — that would DROP a sync.")
    for bad in ("updateDoc(",):
        if out.count(bad) != src.count(bad):
            die("Firestore write surface changed (%s). Rules are append-only." % bad)

    if "!flushed &&" in out:
        die("the pinned tick guard was modified. tour-test.mjs asserts that line byte-for-byte.")

    if a.check:
        print("check only — nothing written."); return
    open(a.file, "w", encoding="utf-8").write(out)
    print("\nout  %s\n     md5 %s  (%+d bytes)" % (a.file, hashlib.md5(out.encode()).hexdigest(), len(out)-len(src)))
    print("     APP_VERSION untouched: %s ; sw.js not opened." % vo.group(1))

main()
