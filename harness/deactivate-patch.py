#!/usr/bin/env python3
"""
deactivate-patch.py — fixes the LIVE bug Aaron reported:

    "I noticed on the home screen that Imodium has a card when I already
     deactivated it in the meds section. might need to check that for others."

ROOT CAUSE
----------
Home renders THREE hardcoded per-medication "daily limit" counter cards —
Acetaminophen, Imodium and Lidocaine. Each is gated on `usedRecently(<id>)`
and nothing else:

    if (usedRecently('imodium')) parts.push(h('section', ... 'Imodium · today' ...

and

    function usedRecently(id) {
      return entriesFor(id).some(e => e.ts >= state.now - 7 * 86400000);
    }

`usedRecently()` reads LOGGED ENTRIES only. It never consults `state.meds`.
So the medication configuration — the thing the Meds section writes when a
medication is removed from the active list — has no bearing on whether these
cards render. They appear because a dose was logged in the last 7 days and they
keep appearing for 7 days after the last dose, whatever the Meds section says.

The Quick Log grid (`state.meds.filter(m => m.quickLog && ...)`) was always
correct, which is why the bug looked half-fixed: one card obeyed, the other did
not.

THE FIX
-------
1. `medIsOnActiveList(id)` — a new predicate, defined immediately after
   `usedRecently`, answering "is this medication still on the active medication
   list". It is a plain Array.prototype.some() over `state.meds`. It builds NO
   lookup object, so there is no `Object.prototype` inheritance to fall through
   (a `{}` keyed by medication id returns a truthy value for `'constructor'`
   even when empty).

2. The three Home counter cards are gated on `usedRecently(id) &&
   medIsOnActiveList(id)`.

   Gated on ACTIVE-LIST MEMBERSHIP, deliberately NOT on `quickLog`. `quickLog`
   is false for every medication folded into the grouped Morning/Evening cards
   (Iron, Compazine, Buspirone, Paroxetine ship that way) and those are fully
   active drugs. Gating a daily-ceiling meter on `quickLog` would delete the
   acetaminophen overdose guard for anyone who grouped Tylenol. Active-list
   membership is the only flag that means "stop tracking this going forward".

3. The two reads of `state.archivedMeds` — `nameOf()` and `reportNameOf()` —
   are hardened with hasOwnProperty. Both did `state.archivedMeds[id]` on a
   plain object, so a medication whose id is `'constructor'` resolved to
   `Object.prototype.constructor`: `nameOf()` returned the string "Object", and
   `reportNameOf()` suppressed the "Medication (removed)" label. Same lookup,
   same feature, and it is the map that stores the deactivation.

WHAT THIS PATCH DOES NOT DO
---------------------------
* Does NOT touch APP_VERSION. Set at ship time.
* Does NOT touch sw.js. Set at ship time.
* Does NOT touch send-reminders.js. It runs in GitHub Actions and cannot read a
  device-local localStorage config; fixing it means syncing medication config to
  Firestore, which with two phones holding divergent configs risks SILENCING a
  reminder for a drug still being taken. That is a design decision, not a
  hotfix. Documented in DEACTIVATE-REPORT.md.
* Does NOT change any behaviour for a medication that is still on the active
  list. `medIsOnActiveList` is true for every entry in `state.meds`, so for an
  active medication every gate evaluates exactly as it did in v43.3.
* Does NOT touch logged history. A removed medication's past doses remain in
  the history view, the CSV and the printable report — that is real medical
  record and deleting it would be the worse bug.

USAGE
-----
    python3 deactivate-patch.py [--file PATH] [--check]

Idempotent: re-running on an already-patched file reports "already applied" and
exits 0 without writing. Refuses loudly (exit 2) if any anchor is missing or
ambiguous, so it can never half-apply.

Base: index.html md5 8136b7764f07865171c180212a4d5b09 (v43.3, commit 87e89bb..125583d).
"""

import argparse
import hashlib
import os
import sys

BASE_MD5 = "8136b7764f07865171c180212a4d5b09"
MARKER = "function medIsOnActiveList("


def die(msg):
    sys.stderr.write("\n")
    sys.stderr.write("=" * 78 + "\n")
    sys.stderr.write("REFUSING TO PATCH\n")
    sys.stderr.write("=" * 78 + "\n")
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.write("=" * 78 + "\n")
    sys.stderr.write("No file was written. Nothing was changed.\n\n")
    sys.exit(2)


def anchored_replace(src, anchor, replacement, label):
    """Replace `anchor` with `replacement`, requiring EXACTLY one occurrence."""
    n = src.count(anchor)
    if n == 0:
        die(
            "Anchor not found for edit: %s\n\n"
            "Expected to find exactly one occurrence of:\n\n%s\n\n"
            "This patch targets index.html at md5 %s (v43.3). The file it was\n"
            "pointed at is a different build, or has already been modified by\n"
            "something else." % (label, anchor, BASE_MD5)
        )
    if n > 1:
        die(
            "Anchor is AMBIGUOUS for edit: %s\n\n"
            "Found %d occurrences of:\n\n%s\n\n"
            "Patching would change more than the intended site. Refusing."
            % (label, n, anchor)
        )
    return src.replace(anchor, replacement, 1)


# =============================================================================
# EDIT 1 — the predicate
# =============================================================================

A1_ANCHOR = (
    "function usedRecently(id) { return entriesFor(id).some(e => e.ts >= state.now - 7 * 86400000); }"
)

A1_REPLACEMENT = (
    "function usedRecently(id) { return entriesFor(id).some(e => e.ts >= state.now - 7 * 86400000); }\n"
    "// Is this medication still on the ACTIVE list? state.meds IS the active list: removing a\n"
    "// medication in the Meds section takes it out of state.meds and records it in\n"
    "// state.archivedMeds, so membership here is exactly the deactivation flag.\n"
    "//\n"
    "// Deliberately NOT `quickLog`. quickLog is false for every medication folded into the grouped\n"
    "// Morning/Evening cards -- Iron, Compazine, Buspirone and Paroxetine all ship that way and are\n"
    "// fully active drugs. Gating a daily-ceiling meter on quickLog would remove the acetaminophen\n"
    "// overdose guard from anyone who grouped Tylenol. Active-list membership is the only flag that\n"
    "// means \"stop tracking this going forward\".\n"
    "//\n"
    "// An array .some() and not a prebuilt {} of ids on purpose: a plain object inherits\n"
    "// Object.prototype, so obj['constructor'] is truthy on an EMPTY map and a medication whose id\n"
    "// normalises to 'constructor' would read as active forever. There is no lookup object to\n"
    "// poison here.\n"
    "function medIsOnActiveList(id) { return !!id && (state.meds || []).some(m => m && m.id === id); }"
)

# =============================================================================
# EDIT 2, 3, 4 — the three Home daily-counter cards
# =============================================================================
# Each `if (usedRecently('<id>')) parts.push(h('section', {` is unique in the file.

A2_ANCHOR = "  // Acetaminophen meter (full width) — shown only when Tylenol used in last 7 days\n  if (usedRecently('tylenol')) parts.push("
A2_REPLACEMENT = (
    "  // Acetaminophen meter (full width) — shown only when Tylenol is still on the active\n"
    "  // medication list AND was used in the last 7 days. The active-list check is what makes a\n"
    "  // removal in the Meds section actually take effect here: usedRecently() reads logged\n"
    "  // entries only and never consulted the medication config, so before this the card outlived\n"
    "  // the medication by 7 days no matter what the Meds section said.\n"
    "  if (medIsOnActiveList('tylenol') && usedRecently('tylenol')) parts.push("
)

A3_ANCHOR = "  // Imodium pill counter\n  const imoPills = dailyPills('imodium');"
A3_REPLACEMENT = (
    "  // Imodium pill counter — active list first, then recent use. See the Acetaminophen meter\n"
    "  // above: this is the card Aaron reported as surviving a deactivation.\n"
    "  const imoPills = dailyPills('imodium');"
)

A4_ANCHOR = "  if (usedRecently('imodium')) parts.push("
A4_REPLACEMENT = "  if (medIsOnActiveList('imodium') && usedRecently('imodium')) parts.push("

A5_ANCHOR = "  // Lidocaine application counter — shown only when used in last 7 days\n  const lidoApps = dailyPills('lidocaine');"
A5_REPLACEMENT = (
    "  // Lidocaine application counter — shown only while Lidocaine is still on the active\n"
    "  // medication list AND was used in the last 7 days.\n"
    "  const lidoApps = dailyPills('lidocaine');"
)

A6_ANCHOR = "  if (usedRecently('lidocaine')) parts.push("
A6_REPLACEMENT = "  if (medIsOnActiveList('lidocaine') && usedRecently('lidocaine')) parts.push("

# =============================================================================
# EDIT 5, 6 — hasOwnProperty on the archivedMeds reads
# =============================================================================

A7_ANCHOR = "const m = state.meds.find(x => x.id === id); const archived = state.archivedMeds && state.archivedMeds[id]; return m ? m.name : (archived ? archived.name : id); }"
A7_REPLACEMENT = (
    "const m = state.meds.find(x => x.id === id); "
    "/* hasOwnProperty, not a bare index: state.archivedMeds is a plain object, so archivedMeds['constructor'] "
    "resolves to Object.prototype.constructor even when the map is EMPTY and this returned the literal string "
    "\"Object\" as a medication name. */ "
    "const archived = (state.archivedMeds && Object.prototype.hasOwnProperty.call(state.archivedMeds, id)) ? state.archivedMeds[id] : null; "
    "return m ? m.name : (archived ? archived.name : id); }"
)

A8_ANCHOR = "  const known = (state.meds || []).some(m => m.id === id) || !!(state.archivedMeds && state.archivedMeds[id]);"
A8_REPLACEMENT = (
    "  // hasOwnProperty, not a bare index -- see nameOf(). A bare index made every id that is also\n"
    "  // an Object.prototype key read as \"known\", which suppressed the \"Medication (removed)\"\n"
    "  // label in the document handed to an oncologist.\n"
    "  const known = (state.meds || []).some(m => m.id === id) || !!(state.archivedMeds && Object.prototype.hasOwnProperty.call(state.archivedMeds, id));"
)


EDITS = [
    ("predicate: medIsOnActiveList", A1_ANCHOR, A1_REPLACEMENT),
    ("home counter gate: Acetaminophen", A2_ANCHOR, A2_REPLACEMENT),
    ("home counter comment: Imodium", A3_ANCHOR, A3_REPLACEMENT),
    ("home counter gate: Imodium", A4_ANCHOR, A4_REPLACEMENT),
    ("home counter comment: Lidocaine", A5_ANCHOR, A5_REPLACEMENT),
    ("home counter gate: Lidocaine", A6_ANCHOR, A6_REPLACEMENT),
    ("archivedMeds read: nameOf", A7_ANCHOR, A7_REPLACEMENT),
    ("archivedMeds read: reportNameOf", A8_ANCHOR, A8_REPLACEMENT),
]

# Lines this patch must leave byte-identical. Checked before AND after.
FORBIDDEN_TOUCH = [
    ("APP_VERSION", "const APP_VERSION = 'v43.3';"),
]


def main():
    ap = argparse.ArgumentParser(description="Fix deactivated medications still showing a Home card.")
    ap.add_argument("--file", default="index.html", help="path to index.html (default: ./index.html)")
    ap.add_argument("--check", action="store_true", help="report status and exit without writing")
    args = ap.parse_args()

    path = args.file
    if not os.path.isfile(path):
        die("No such file: %s" % path)

    with open(path, "rb") as f:
        raw = f.read()
    src = raw.decode("utf-8")
    md5 = hashlib.md5(raw).hexdigest()

    print("file : %s" % os.path.abspath(path))
    print("md5  : %s" % md5)

    already = MARKER in src
    if already:
        print("state: ALREADY PATCHED")
        # Idempotence is only a real claim if the patched file is also intact.
        missing = [label for (label, _a, r) in EDITS if r.strip().splitlines()[-1].strip() not in src]
        if missing:
            die(
                "The file contains the patch marker (%s) but these edits are MISSING:\n  - %s\n\n"
                "That means a partially-patched or hand-edited file. Restore the v43.3 base\n"
                "(md5 %s) and re-run." % (MARKER, "\n  - ".join(missing), BASE_MD5)
            )
        for name, line in FORBIDDEN_TOUCH:
            if line not in src:
                die("Patched file no longer contains the untouched %s line:\n  %s" % (name, line))
        print("check: all 8 edits present, APP_VERSION untouched")
        print("\nNothing to do. Exiting 0.")
        return 0

    if md5 != BASE_MD5:
        die(
            "Base md5 mismatch.\n"
            "  expected : %s   (v43.3, the build running on the phones)\n"
            "  actual   : %s\n\n"
            "This patch is anchored to exact source text in that build. Applying it to a\n"
            "different build would either fail on an anchor or, worse, land an edit in the\n"
            "wrong place. Get the right base:\n\n"
            "    git clone https://github.com/Arnjnnngs/care-tracker.git\n"
            "    git -C care-tracker checkout -B main origin/main\n"
            % (BASE_MD5, md5)
        )
    print("state: UNPATCHED — base md5 matches v43.3")

    # Pre-flight: verify EVERY anchor is present and unique BEFORE mutating anything.
    problems = []
    for label, anchor, _rep in EDITS:
        n = src.count(anchor)
        if n != 1:
            problems.append("  [%s] expected 1 occurrence, found %d" % (label, n))
    if problems:
        die("Anchor pre-flight failed:\n" + "\n".join(problems))
    print("check: all 8 anchors present and unique")

    if args.check:
        print("\n--check given: would apply 8 edits. Nothing written.")
        return 0

    out = src
    for label, anchor, replacement in EDITS:
        out = anchored_replace(out, anchor, replacement, label)
        print("  applied: %s" % label)

    # Post-flight: the things this patch promised not to touch.
    for name, line in FORBIDDEN_TOUCH:
        if line not in out:
            die("Patch would have modified %s. Aborting before write." % name)
    if out.count(MARKER) != 1:
        die("Post-flight: expected exactly one medIsOnActiveList definition, found %d." % out.count(MARKER))
    # No bare `usedRecently('<id>')` gate may survive on a counter card.
    for med in ("tylenol", "imodium", "lidocaine"):
        bare = "  if (usedRecently('%s')) parts.push(" % med
        if bare in out:
            die("Post-flight: the %s counter card is still gated on usedRecently() alone." % med)
    print("check: APP_VERSION untouched, 3/3 counter gates rewritten")

    with open(path, "wb") as f:
        f.write(out.encode("utf-8"))

    new_md5 = hashlib.md5(out.encode("utf-8")).hexdigest()
    print("\nWROTE %s" % os.path.abspath(path))
    print("new md5: %s" % new_md5)
    print("\nsw.js and APP_VERSION were NOT touched — set those at ship time.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
