#!/usr/bin/env python3
"""v78 — the password box on a protected backup can be typed in.

Applies to a v77 index.html and produces v78. Rule 0: every release must be reproducible from the
repo alone (base version + the patches in harness/), so this script exists before the release does.

WHAT IT FIXES, and how it was found. `harness/deactivate-test.mjs` and `harness/reason-test.mjs`
both carry FILE-no-setState-in-onInput, a file-level check that no keystroke handler calls
setState. Both had been unrunnable for months because their default APP_FILE pointed at
`harness/work/`, a v43.3-era build directory that no longer exists. Fixing that default (commit
4958124) made them run, and both went red on v77 for the same single line:

    index.html:5302
    onInput: (e) => setState({ bkUnlockPw: e.target.value, backupNotice: null }),

setState() ends in an unconditional render(), and this app's render() does not restore focus. It
protects typing a different way -- the once-a-second tick is suppressed while a text field is
focused (uiIsBusy) -- which does nothing about a repaint the handler asks for itself. So every
character typed into the password box destroyed the box: one character per tap, on the screen that
restores an encrypted backup of a cancer patient's medication history.

Neither file-level check was enough on its own, because a grep can be argued with. ENC-9b in
harness/encbackup-test.mjs presses keys one at a time and asserts the caret is still in the box:
RED on v77, GREEN on v78. Every other check in that file entered the password by setting the whole
value with the native setter and firing one input event, which is not typing -- which is why a
suite that covers this screen in thirteen other ways never saw it.

WHAT IT DOES NOT DO: it does not touch the restore path, the envelope format, the key derivation,
or any write. The only behavioural change beyond the caret is that the message about a failed
attempt now stays on screen while the password is retyped. bkUnlock() already clears it on the way
in, so clearing it per keystroke was never doing anything a person could see.

    python3 harness/v78-bkpw-patch.py [path/to/index.html] [path/to/sw.js]
"""
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'index.html'
SW = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'sw.js'


def die(msg):
    print('REFUSED: ' + msg)
    sys.exit(1)


def cut(src, old, new, what):
    if src.count(old) != 1:
        die('%s -- anchor matched %d times, expected exactly 1' % (what, src.count(old)))
    return src.replace(old, new)


src = HTML.read_text()
if "onInput: (e) => { state.bkUnlockPw = e.target.value; }" in src:
    die('v78 is already applied to this file')

COMMENT = (
    "      // WRITE THE STATE, DO NOT RE-RENDER. `setState` ends in an unconditional `render()`, and\n"
    "      // this app's render() does NOT put focus back — it protects typing by suppressing the\n"
    "      // once-a-second tick while a text field is focused (`uiIsBusy`), which does nothing about a\n"
    "      // repaint this handler asks for itself. So every keystroke here destroyed the box being\n"
    "      // typed into: one character per tap, on the screen that restores an encrypted backup of a\n"
    "      // medication history. The file already states the rule in its own words further up —\n"
    "      // \"NEVER setState from onInput — it rebuilds the tree and destroys the field being typed\n"
    "      // in\" — and every other input in this file obeys it. This was the only violation left.\n"
    "      //\n"
    "      // Clearing `backupNotice` here was the only reason a render was wanted, and it was never\n"
    "      // needed: `bkUnlock()` already clears it on the way in. The message about the last attempt\n"
    "      // now stays on screen while the password is retyped, which is what it is for.\n"
    "      onInput: (e) => { state.bkUnlockPw = e.target.value; },"
)

src = cut(src,
          "      onInput: (e) => setState({ bkUnlockPw: e.target.value, backupNotice: null }),",
          COMMENT,
          'the backup-unlock keystroke handler')

# The changelog entry the caregiver reads. No version numbers in the prose, no function names.
ENTRY = (
    "const CHANGELOG = [\n"
    "  { v: 'v78', date: 'Sep 15, 2026', title: 'The password box on a protected backup can be typed in',\n"
    "    points: [\n"
    "      'Opening a password-protected backup asks for the password. That box was throwing the cursor out after every single letter, so you had to tap it again for every character.',\n"
    "      'It takes a typed password normally now.',\n"
    "      'Nothing else about backups changed \\u2014 the same file, the same password, the same records.'\n"
    "    ] },\n"
    "  { v: 'v77',"
)
src = cut(src, "const CHANGELOG = [\n  { v: 'v77',", ENTRY, 'the changelog entry')

# VERSION AND CACHE MOVE TOGETHER OR NEITHER MOVES. A version bump without a service-worker cache
# bump serves the old file from cache to every installed phone, which is the failure pm.py exists
# to catch; doing both here means a rebuild from this script cannot get it half right.
src = cut(src, "const APP_VERSION = 'v77';", "const APP_VERSION = 'v78';", 'APP_VERSION')
HTML.write_text(src)

sw = SW.read_text()
sw = cut(sw, "const CACHE = 'caretracker-v77';", "const CACHE = 'caretracker-v78';", 'the sw.js cache name')
SW.write_text(sw)

print('OK -- v78 applied to ' + str(HTML) + ' and ' + str(SW))
