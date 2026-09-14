#!/usr/bin/env python3
"""v77 -- the phone's own Back button closed the app. Ported from ChemoWell on Aaron's "Port to both".

    Aaron, 2026-09-14: "All apps close out (go to user phone home screen) when hitting the phones
    built in back button. This should at least go to the previous page. There is a back button that
    we've built into the app that works. Thought you should know. Should have been found already."

**He is right, and the reason it was missed is Rule 5.5, written into this file's own operating
model.** Every gate on this project asks about a STILL FRAME -- does the screen fit (overflow-scan),
is the copy true (the Voice), can she do the job (the Enhancer), does the record survive (the Zero
Day Auditor), did the release mechanics happen (pm.py). Rule 5.5 says the one thing nobody asks is
what happens while a finger is moving. The hardware Back button is the purest case of that class
there is, and `grep popstate` returned nothing here, in staging, or in ChemoWell. Never built.

**What it costs Brandi's caregiver.** Part-way through the confirm-the-time sheet, or filling in a
medication, she taps Back to undo one step and the whole app disappears to the phone's home screen.
Nothing is corrupted -- none of these screens writes until it is confirmed, and this patch appends
nothing, edits nothing and deletes nothing -- but the work in front of her is gone, and the app has
behaved like nothing else on her phone.

THE WRITE MODEL, stated before a line was written (Rule 1.5): **this release writes NO record of any
kind.** It adds one history entry and one popstate listener, and every action it takes is one the
screen already offers through a Cancel or a close control. It cannot reach `addEntryDB` or
`removeEntryDB`.

PORTED, NOT COPIED. The registry is built from THIS app's state, which is not ChemoWell's: care-
tracker has `missReasonSheet`, `apptSheet`, `bkLocked`, `confirmRemoveWeight`, `confirmMedList` and
a `medsync.confirm` that ChemoWell does not, and does not have ChemoWell's profile or upgrade
sheets. Copying the other app's list would have left real overlays uncovered and invented rules for
things that do not exist here -- so the list was read off this file, and the suite's completeness
check enumerates this app's own state to prove none was missed.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ROOT / 'index.html'

def die(msg):
    print('PATCH FAILED: ' + msg); sys.exit(1)

def cut(src, old, new, what):
    if src.count(old) != 1:
        die(what + ' is not where it was (' + str(src.count(old)) + ' matches) -- nothing written')
    return src.replace(old, new, 1)

src = HTML.read_text(encoding='utf-8')
if 'BACK_LAYERS' in src:
    die('already applied')

ANCHOR = """function setState(patch) {"""
BLOCK = """// ---- THE PHONE'S OWN BACK BUTTON -------------------------------------------------------------
// Ordered INNERMOST FIRST. Each layer says how to tell it is open and how to close it, and closing
// it is exactly what that layer's own Cancel or close control does -- if the two ever disagree,
// Back becomes a second way out of a screen that leaves different state behind.
const BACK_LAYERS = [
  // 1. CONFIRMATIONS FIRST. They sit on top of whatever armed them, so Back disarms the
  //    confirmation and leaves that thing open, rather than closing both.
  { key: 'confirmDeleteMed', label: 'the delete-medication confirmation', open: () => state.confirmDeleteMed != null, close: () => setState({ confirmDeleteMed: null }) },
  { key: 'confirmRemove', label: 'the remove-entry confirmation', open: () => state.confirmRemove != null, close: () => setState({ confirmRemove: null }) },
  { key: 'confirmRemovePara', label: 'the remove-paracentesis confirmation', open: () => state.confirmRemovePara != null, close: () => setState({ confirmRemovePara: null }) },
  { key: 'confirmRemoveWeight', label: 'the remove-weight confirmation', open: () => state.confirmRemoveWeight != null, close: () => setState({ confirmRemoveWeight: null }) },
  { key: 'confirmMedList', label: 'the medication-list confirmation', open: () => !!state.confirmMedList, close: () => setState({ confirmMedList: false }) },
  { key: 'confirmClearChemo', label: 'the clear-treatment-date confirmation', open: () => !!state.confirmClearChemo, close: () => setState({ confirmClearChemo: false }) },
  { key: 'reportConfirmClear', label: 'the clear-reports confirmation', open: () => !!state.reportConfirmClear, close: () => setState({ reportConfirmClear: false }) },
  { key: 'apptConfirmDelete', label: 'the delete-appointment confirmation', open: () => state.apptConfirmDelete != null, close: () => setState({ apptConfirmDelete: null }) },
  { key: 'shareArmed', label: 'the armed share control', open: () => !!state.shareArmed, close: () => setState({ shareArmed: false }) },
  { key: 'override', label: 'the over-limit override', open: () => state.override != null, close: () => setState({ override: null }) },
  // 2. SHEETS AND POP-UPS.
  { key: 'timeModal', label: 'the confirm-the-time sheet', open: () => state.timeModal != null, close: () => setState({ timeModal: null }) },
  { key: 'missReasonSheet', label: 'the missed-dose reason sheet', open: () => state.missReasonSheet != null, close: () => setState({ missReasonSheet: null }) },
  { key: 'apptSheet', label: 'the appointment sheet', open: () => state.apptSheet != null, close: () => setState({ apptSheet: null }) },
  { key: 'backupNotice', label: 'the backup notice', open: () => state.backupNotice != null, close: () => setState({ backupNotice: null }) },
  { key: 'reportNotice', label: 'the report notice', open: () => state.reportNotice != null, close: () => setState({ reportNotice: null }) },
  { key: 'bkLocked', label: 'the locked-backup prompt', open: () => state.bkLocked != null, close: () => setState({ bkLocked: null }) },
  { key: 'whatsNewOpen', label: "the What's New sheet", open: () => !!state.whatsNewOpen, close: () => setState({ whatsNewOpen: false }) },
  { key: 'tour', label: 'the guided tour', open: () => state.tour != null, close: () => setState({ tour: null }) },
  // 3. PANELS AND EDITORS.
  { key: 'medEditor', label: 'the medication editor', open: () => state.medEditor != null, close: () => setState({ medEditor: null, confirmDeleteMed: null }) },
  { key: 'missedBannerOpen', label: 'the expanded missed-dose banner', open: () => !!state.missedBannerOpen, close: () => setState({ missedBannerOpen: false }) },
  { key: 'drawerOpen', label: 'the menu drawer', open: () => !!state.drawerOpen, close: () => setState({ drawerOpen: false }) }
];
function backLayerKeys() { return BACK_LAYERS.map(l => l.key); }
// Returns what it dismissed, or null when there is nothing left on this screen to dismiss.
function handleBackPress() {
  // NESTED CONFIRMATION INSIDE medsync, which is an object rather than a top-level flag. Handled
  // explicitly and first, because a generic rule over `state` cannot see one level down -- and the
  // suite's completeness check is written against top-level keys, so this is the one that would
  // have been missed silently.
  if (state.medsync && state.medsync.confirm) {
    setState({ medsync: { ...state.medsync, confirm: null } });
    return 'medsync.confirm';
  }
  for (let i = 0; i < BACK_LAYERS.length; i++) {
    if (BACK_LAYERS[i].open()) { BACK_LAYERS[i].close(); return BACK_LAYERS[i].key; }
  }
  // A tab that is not Home goes to Home -- the "at least go to the previous page" Aaron asked for.
  // For a tab bar Home is the honest answer: the tabs are siblings, not a trail, so there is
  // nowhere else to go back TO.
  if (state.view !== 'home') { setState({ view: 'home' }); return 'view'; }
  return null;
}
// ONE HISTORY ENTRY, pushed once and re-pushed after every Back the app handles. When nothing is
// left it is not replaced, so a second Back leaves the app exactly as the phone expects.
function armBackButton() {
  if (typeof window === 'undefined' || !window.history || !window.addEventListener) return;
  try { history.pushState({ ctBack: 1 }, ''); } catch (e) { return; }
  let leaving = false;
  window.addEventListener('popstate', () => {
    const handled = handleBackPress();
    if (handled) { try { history.pushState({ ctBack: 1 }, ''); } catch (e) {} return; }
    // NOTHING LEFT TO DISMISS, SO LET THE PHONE LEAVE -- ON ONE PRESS, NOT TWO.
    // Without this the first Back on Home did nothing visible: it consumed the entry this app
    // pushed at startup and stopped there, so a caregiver had to press Back twice to get out while
    // every other app on her phone takes one. The suite caught it by asserting the app DOES leave.
    // `history.back()` hands the press back to the platform: in a browser it returns to whatever
    // was open before, and in an installed PWA or the native wrapper there is nothing behind the
    // app, so the system closes it -- which is exactly the behaviour being asked for.
    if (leaving) return;              // one delegation per press; never a loop
    leaving = true;
    try { history.back(); } catch (e) {}
    setTimeout(() => { leaving = false; }, 0);
  });
}
if (typeof window !== 'undefined') {
  // For the completeness check in harness/back-button-test.mjs. Exported rather than copied into
  // the suite, so a new layer cannot be added to one and not the other. Pure reads; holds nothing.
  window.__backTest = { keys: backLayerKeys, press: handleBackPress, stateKeys: () => Object.keys(state) };
}

function setState(patch) {"""

src = cut(src, ANCHOR, BLOCK, 'setState')

# ARMED AFTER INIT, not during it: pushState is harmless early, but the popstate handler calls
# setState, and `state` is not initialised at the top of this file.
BOOT = """function setState(patch) {"""
if 'armBackButton();' in src:
    die('armBackButton already called')
# AN EXPLICIT, ASSERTED ANCHOR. The first version of this searched a list of candidates and took
# the LAST occurrence of `render();` -- which happened to land at module top level and would just as
# easily have landed inside a function body on the next release. A patch that works by luck is a
# patch that fails silently later, and this file's whole reproducibility claim rests on these
# scripts still applying cleanly to the version they name.
ARM_ANCHOR = """  checkNotifications();
}, 1000);
render();"""
src = cut(src, ARM_ANCHOR, """  checkNotifications();
}, 1000);
// ARMED HERE, at module top level and after `state` exists and after the app has rendered once.
// pushState would be harmless earlier; the popstate handler calls setState, which reads `state`.
// (The first draft of this comment cited a `TREATMENT_DAYS_MAX` scar. That belongs to ChemoWell,
// not to this file -- a fact carried across on the way over, which is precisely the leak this
// repo's own instructions warn about, and it pointed at a comment that does not exist here.)
armBackButton();
render();""", 'the startup tail')

# ---- WHAT BRANDI READS. The suite caught this, not a reviewer: bumping APP_VERSION without a
# changelog entry left the app telling her about v76 while running v77. The Voice's first question
# is "is it true", and a What's New sheet naming the wrong release fails it before a word is read.
src = cut(src, """const CHANGELOG = [
  { v: 'v76',""",
"""const CHANGELOG = [
  { v: 'v77', date: 'Sep 14, 2026', title: 'Your phone\\u2019s Back button no longer closes the app',
    points: [
      'Tapping Back used to shut the whole app and drop you on your phone\\u2019s home screen, wherever you were \\u2014 even half-way through confirming a dose. Whatever you were filling in was gone.',
      'Back now goes back one step: it closes whatever is open, then takes you to Home. Only when nothing is open does it leave the app, the same as every other app on your phone.',
      'If you have tapped something that asks \\u201cAre you sure?\\u201d, Back cancels just that question and leaves the screen behind it as it was.'
    ] },
  { v: 'v76',""", 'the changelog')

HTML.write_text(src, encoding='utf-8')
print('v77 applied: the phone Back button walks the app instead of leaving it')
