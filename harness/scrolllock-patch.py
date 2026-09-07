#!/usr/bin/env python3
"""
scrolllock-patch.py -- v71. The page behind an open overlay must not scroll.

Aaron, 2026-09-06: "when there is a toast pop up or with the 3 elipsies, you can still scroll and
see the background moving when trying to scroll. why haven't this been caught. eyes should be
actively looking at stuff to verify. there should be cases written for everything to test for."

THE DEFECT. This app has five full-screen overlays -- the menu drawer, the date/time dialog, the
What's New notice, the appointment sheet and the missed-dose reason sheet -- and NOT ONE of them
locked the page behind it. Open the menu and drag: the whole app slides around underneath a fixed
panel. On a phone that reads as the app coming apart, and it is worse here than in most apps
because four of those overlays sit on a blurred scrim, so the thing moving behind the blur smears.

WHY NOTHING CAUGHT IT, which is the part worth writing down. Every gate this project has asks a
question about a STILL frame: does the screen fit (overflow-scan), does the copy say something
true (the Voice), can the caregiver do the job (the Enhancer), does the record survive (the
auditor). Scrolling is not a still frame. There was no case for it because nobody had written one,
and Aaron found it by using the app -- which is the only method that was ever going to.

THE FIX, and why not simply `overflow: hidden`. On iOS Safari, `overflow: hidden` on body does not
stop touch scrolling; the page keeps moving. The reliable approach is to take the body out of flow
at its current offset and put it back afterwards:

    lock:    remember scrollY, body { position: fixed; top: -scrollY; left/right: 0; overflow: hidden }
    unlock:  clear those, then window.scrollTo(0, remembered)

The scroll position MUST be restored on unlock. Without it, closing the menu drops the caregiver
back at the top of a long History screen -- a fix that trades one annoyance for a worse one.

THE TOAST IS DELIBERATELY NOT INCLUDED. A toast is not a modal: it says "logged at 6:04 PM" and
disappears, and locking the page for three seconds after every dose would make the app feel broken
in a different way. Aaron named it in the same sentence as the menu, so it was checked -- the toast
has no scrim and no blur, and the page moving under it is what a toast is supposed to do. Said out
loud rather than silently skipped.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'index.html')
s = open(TARGET, encoding='utf-8').read()
orig_len = len(s)


def sub(old, new, why):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit('ANCHOR %s matched %d times (need exactly 1): %s' % (why, n, old[:90]))
    s = s.replace(old, new)


sub("""function render() {""",
    """// ---- BODY SCROLL LOCK (v71) ----
// The list is the five overlays render() actually mounts, each keyed on the SAME state the
// overlay's own render function checks, so an overlay cannot appear without being locked or stay
// locked after it closes. The loading splash is excluded: nothing is scrollable yet. The tour is
// excluded too, and on purpose -- it walks the caregiver around the app and needs the page to move.
function anyOverlayOpen() {
  return !!(state.drawerOpen || state.timeModal || state.whatsNewOpen || state.apptSheet || state.missReasonSheet);
}
let _scrollLockY = null;
function applyScrollLock() {
  const want = anyOverlayOpen();
  const locked = _scrollLockY !== null;
  if (want === locked) return;
  const b = document.body;
  if (want) {
    _scrollLockY = window.scrollY || window.pageYOffset || 0;
    // position:fixed, not overflow:hidden. On iOS Safari overflow:hidden on body does NOT stop a
    // touch drag -- the page keeps moving under the overlay, which is the bug this is fixing.
    b.style.position = 'fixed';
    b.style.top = (-_scrollLockY) + 'px';
    b.style.left = '0';
    b.style.right = '0';
    b.style.width = '100%';
    b.style.overflow = 'hidden';
  } else {
    const y = _scrollLockY;
    _scrollLockY = null;
    b.style.position = '';
    b.style.top = '';
    b.style.left = '';
    b.style.right = '';
    b.style.width = '';
    b.style.overflow = '';
    // PUT HER BACK WHERE SHE WAS. Without this, closing the menu drops her at the top of a long
    // History screen -- a fix that trades one annoyance for a worse one.
    window.scrollTo(0, y);
  }
}

function render() {""",
    'scroll-lock-helpers')

sub("""  if (state.tour) positionTour(false);
}""",
    """  if (state.tour) positionTour(false);
  // AFTER the DOM is in place, so the lock reflects what is actually on screen rather than what
  // state said a moment ago.
  applyScrollLock();
}""",
    'call-scroll-lock')

# A REAL HOOK ON THE DATE/TIME DIALOG. harness/para-test.mjs found its Confirm button by asking for
# the nearest ancestor with `position: fixed` in its style attribute -- and the scroll lock above
# puts `position: fixed` on the BODY, so that ancestor became the whole document and the search
# started returning the Home card's own Log button instead. The suite went from 16/16 to 15/16 and
# the app was fine; the selector was not. Rule 5 has said it for months: elements by explicit
# data- hooks, never by text or by a style substring. Here is the hook.
sub("""  return h('div', { style: { position: 'fixed', inset: '0', background: 'rgba(60,30,50,0.42)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '60', padding: '20px' }, onClick: (e) => { if (e.target === e.currentTarget) setState({ timeModal: null }); } },""",
    """  return h('div', { 'data-time-modal': 'true', style: { position: 'fixed', inset: '0', background: 'rgba(60,30,50,0.42)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '60', padding: '20px' }, onClick: (e) => { if (e.target === e.currentTarget) setState({ timeModal: null }); } },""",
    'time-modal-hook')

# ---------------------------------------------------------------------------------------------
# THE RELEASE STAMP. Applies to outputs/rollback-v70/index.html; stamping here rather than by hand
# is what keeps the release reproducible from the repo alone (Rule 0).
sub("""const APP_VERSION = 'v70';""", """const APP_VERSION = 'v71';""", 'app-version')

sub("""const CHANGELOG = [
""", """const CHANGELOG = [
  { v: 'v71', date: 'Sep 7, 2026', title: 'The screen stays put behind the menu',
    points: [
      'Open the menu, or any pop-up, and the page underneath no longer slides around when you drag your finger. It holds still until you close it, then puts you back exactly where you were.',
      'Toasts \\u2014 the little messages that say something was logged \\u2014 still let you scroll, on purpose. They are not pop-ups you have to close.'
    ] },
""", 'changelog-v71')

open(TARGET, 'w', encoding='utf-8').write(s)
print('scrolllock-patch applied: %d -> %d bytes' % (orig_len, len(s)))
