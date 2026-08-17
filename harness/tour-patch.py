#!/usr/bin/env python3
"""
v44 guided tour -- anchored, idempotent, refuses loudly.

Adds a nine-step guided tour that is reachable ONLY from the menu, exits four different ways on
every step, and puts the screen back where it found it.  Does not touch APP_VERSION and does not
touch sw.js.

Refuses to write on:
  * a missing or ambiguous anchor,
  * any collision between a name this patch introduces and a name already in the file,
  * a one-second tick guard whose composed form is not exactly right.
"""

import argparse
import hashlib
import os
import re
import sys

MARK = 'TOUR-PATCH-MARK'

# The whole tour module, inlined so this patch is a single self-contained file.
JS_BLOCK = r'''
// ---------------- Guided tour (v44) ----------------
// TOUR-PATCH-MARK
//
// Aaron's requirement in full: skippable, re-runnable from the menu, and it must NEVER block the
// app. ChemoWell's tour gates its app until setup completes; this one deliberately does the
// opposite, in four ways:
//
//  1. IT NEVER STARTS ON ITS OWN. There is no first-run flag, no prefs read, no Firestore read,
//     no localStorage key -- nothing exists that could decide to show it. The only way in is the
//     "Take a quick tour" row at the bottom of the menu. A tour with no auto-start has no path by
//     which it can stand between a patient and logging a dose, which is the failure we are
//     refusing to ship. It also means the tour is unaffected by prefs failing to load or by
//     Firestore being offline: it reads neither.
//  2. FOUR INDEPENDENT EXITS ON EVERY STEP -- Skip, the X, the Escape key, and a tap on the dimmed
//     backdrop. If any one of them regressed, three still work.
//  3. IT PUTS THE SCREEN BACK. The view and report the tour was started from are recorded at
//     start and restored on exit, so leaving at the Reports step does not strand anyone in
//     Reports.
//  4. IT LIVES OUTSIDE #root. render() does `root.innerHTML = ''`, so a tour built inside root
//     would be destroyed by any repaint. It is appended to <body> instead and only ever
//     repositioned, never rebuilt, by a repaint.
//
// The backdrop DOES swallow taps aimed at the app underneath, and that is the one place this is
// deliberately modal. Letting taps through would mean someone reading the "Logging a dose" step
// could log a real dose by touching the highlighted card. Wrong dose data in a chemotherapy log
// is a worse outcome than a modal you leave with one tap. "Never blocks the app" is honoured by
// the tour never appearing unbidden and never having fewer than four ways out -- not by making
// the highlighted control live.

const TOUR_STEPS = [
  {
    key: 'welcome',
    title: 'A quick look around',
    body: 'About a minute. Nothing you tap in here changes your records, and you can stop at any point — the tour stays in the menu for whenever you want it again.',
    view: 'home'
  },
  {
    key: 'menu',
    title: 'Everything lives here',
    body: 'The tabs along the bottom cover the day to day. This button opens the full menu, and it is the only way through to the Calendar.',
    view: 'home',
    sel: ['[data-tour-menu]']
  },
  {
    key: 'logging',
    title: 'Logging a dose',
    body: 'Tap a medication to log it at the current time. Each card shows what has already been taken today, and if a dose is not due yet it tells you when it will be.',
    view: 'home',
    sel: ['[data-tour-quicklog]']
  },
  {
    key: 'missed',
    title: 'If a dose gets missed',
    body: 'A scheduled dose with nothing logged shows up in red. You can add a short reason — asleep, felt sick, out of the house — or leave it blank. It is a record for the clinic, not a mark against you.',
    view: 'home',
    sel: ['[data-tour-missed]']
  },
  {
    key: 'calendar',
    title: 'Appointments',
    body: 'Tap any day to add an appointment or to see what is on it. If the same appointment is edited on two phones at once, CareTracker asks you which version to keep rather than quietly picking one.',
    view: 'calendar',
    sel: ['[data-tour-calendar]']
  },
  {
    key: 'meds',
    title: 'Your medication list',
    body: 'Add a medication, change its doses, or edit when it is due. Taking one off the list clears its card from Home — everything you already logged for it stays in your history.',
    view: 'meds',
    sel: ['[data-tour-meds]']
  },
  {
    key: 'reports',
    title: 'Looking back',
    body: 'History, weight, appetite and the rest, day by day. Useful when someone at the clinic asks how the last couple of weeks have gone.',
    view: 'reports',
    sel: ['[data-tour-reports]']
  },
  {
    key: 'backup',
    title: 'Your backup file',
    body: 'The backup file is the only one of these that can be put back. Save it somewhere safe — a new phone, or anything gone missing, is rebuilt from that file. The spreadsheet and the printable report are for reading and for handing to a doctor; neither can be loaded back in.',
    view: 'reports',
    sel: ['[data-tour-backup]']
  },
  {
    key: 'finish',
    title: 'That is everything',
    body: 'The tour stays right here, so you can run it again any time you like.',
    view: 'home',
    drawer: true,
    sel: ['[data-tour-drawer-item]']
  }
];

let tourEl = null;
let tourScrimEl = null;
let tourRingEl = null;
let tourCardEl = null;

function tourStepAt(i) {
  const n = TOUR_STEPS.length;
  const k = Math.max(0, Math.min(n - 1, Number(i) || 0));
  return TOUR_STEPS[k];
}

// Returns the element a step points at, or null. Null is a supported outcome, not a failure: the
// missed-dose step has nothing to point at on a day with no misses, and a brand-new phone with
// Firestore offline has no medication cards at all. positionTour() centres the card and hides the
// spotlight in that case, and the step still reads correctly.
function tourAnchorEl(step) {
  if (!step || !step.sel) return null;
  const list = Array.isArray(step.sel) ? step.sel : [step.sel];
  for (const s of list) {
    let el = null;
    try { el = document.querySelector(s); } catch (err) { el = null; }
    if (el && el.getClientRects && el.getClientRects().length) return el;
  }
  return null;
}

function tourMount() {
  if (tourEl) return;
  tourEl = document.createElement('div');
  tourEl.setAttribute('data-tour-root', 'true');
  // 120 clears every other layer in the app, including the z-index:100 "Connecting..." overlay,
  // so a tour that is somehow open while the connection drops is still readable and still
  // dismissible rather than being buried under a screen with no controls on it.
  tourEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:120;';
  document.body.appendChild(tourEl);
}

function tourUnmount() {
  if (tourEl && tourEl.parentNode) tourEl.parentNode.removeChild(tourEl);
  tourEl = null;
  tourScrimEl = null;
  tourRingEl = null;
  tourCardEl = null;
}

function tourReflow() { positionTour(false); }

// Geometry only -- never rebuilds the card, so it can be called from a scroll handler, from the
// one-second tick and from the tail of render() without ever moving focus.
function positionTour(animate) {
  if (!state.tour || !tourEl || !tourCardEl || !tourRingEl || !tourScrimEl) return;
  const step = tourStepAt(state.tour.i);
  const el = tourAnchorEl(step);
  const vw = window.innerWidth || document.documentElement.clientWidth || 375;
  const vh = window.innerHeight || document.documentElement.clientHeight || 812;
  const card = tourCardEl;
  card.style.transition = animate ? 'left 160ms ease, top 160ms ease' : 'none';
  tourRingEl.style.transition = animate ? 'left 160ms ease, top 160ms ease, width 160ms ease, height 160ms ease' : 'none';
  const cardW = card.offsetWidth || Math.min(340, vw - 24);
  const cardH = card.offsetHeight || 190;

  if (!el) {
    tourRingEl.style.opacity = '0';
    tourScrimEl.style.background = 'rgba(52,26,44,0.5)';
    card.style.left = Math.round(Math.max(12, (vw - cardW) / 2)) + 'px';
    card.style.top = Math.round(Math.max(12, (vh - cardH) / 2)) + 'px';
    return;
  }

  const r = el.getBoundingClientRect();
  const pad = 6;
  const rx = Math.max(0, r.left - pad);
  const ry = Math.max(0, r.top - pad);
  const rw = Math.max(0, Math.min(vw, r.right + pad) - rx);
  const rh = Math.max(0, Math.min(vh, r.bottom + pad) - ry);
  tourRingEl.style.opacity = '1';
  tourRingEl.style.left = Math.round(rx) + 'px';
  tourRingEl.style.top = Math.round(ry) + 'px';
  tourRingEl.style.width = Math.round(rw) + 'px';
  tourRingEl.style.height = Math.round(rh) + 'px';
  // The dimming is carried by the ring's own outer shadow, which leaves the highlighted control at
  // full brightness. The scrim underneath goes clear so the two do not stack into a double dim.
  tourScrimEl.style.background = 'transparent';

  const gap = 12;
  const margin = 12;
  const below = r.bottom + gap;
  const above = r.top - gap - cardH;
  let top;
  if (below + cardH <= vh - margin) top = below;
  else if (above >= margin) top = above;
  // Neither side fits, which means the target is taller than the room around it. Pin the card to
  // the bottom rather than centring it: centred, the card lands on the middle of the highlighted
  // block and covers the very heading the step is naming.
  else top = Math.max(margin, vh - cardH - margin);
  let left = r.left + (r.width / 2) - (cardW / 2);
  left = Math.max(margin, Math.min(left, vw - cardW - margin));
  card.style.left = Math.round(left) + 'px';
  card.style.top = Math.round(top) + 'px';
}

// Puts the app behind the tour onto the screen this step is about. Deliberately does NOT call
// calCloseDrawer(): that path exists to hand focus back to the menu button, and its handoff lands
// after the tour has taken focus and pulls it straight back out. The drawer flags are cleared
// directly here instead, and the tour claims focus on a double rAF so it wins that race outright.
function tourApplyView(step) {
  calDrawerNeedsFocus = false;
  calSheetNeedsFocus = false;
  state.drawerOpen = !!(step && step.drawer);
  if (step && step.view) {
    state.view = step.view;
    state.reportsView = null;
  }
  // Deliberately does not clear state.medEditor. A half-filled medication form is typed data, and
  // discarding it because someone opened the tour would be the tour destroying work -- the exact
  // thing it is not allowed to do. It stays open behind the tour and is still there afterwards.
  render();
}

function tourRenderStep() {
  if (!state.tour || !tourEl) return;
  const i = state.tour.i;
  const step = tourStepAt(i);
  const n = TOUR_STEPS.length;
  const isLast = i === n - 1;

  const scrim = h('div', {
    'data-tour-scrim': 'true',
    onClick: (e) => { if (e.target === e.currentTarget) tourEnd(); },
    style: { position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', background: 'rgba(52,26,44,0.5)' }
  });

  const ring = h('div', {
    'data-tour-ring': 'true', 'aria-hidden': 'true',
    style: { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', borderRadius: '16px', pointerEvents: 'none', opacity: '0', boxShadow: '0 0 0 3px rgba(255,255,255,0.9), 0 0 0 5px rgba(212,104,138,0.85), 0 0 0 9999px rgba(52,26,44,0.5)' }
  });

  const btnBase = { minHeight: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '13px', fontSize: '14px', fontWeight: '800', cursor: 'pointer' };

  const card = h('div', {
    'data-tour-card': 'true', 'data-tour-step': String(i), 'data-tour-key': step.key,
    role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-body', tabindex: '-1',
    style: { position: 'absolute', left: '0px', top: '0px', width: 'min(340px, calc(100vw - 24px))', boxSizing: 'border-box', background: 'rgba(255,247,250,0.985)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(212,104,138,0.24)', borderRadius: '20px', boxShadow: '0 18px 48px rgba(90,40,70,0.32)', padding: '14px 15px 13px', outline: 'none' }
  },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
      h('span', { 'data-tour-count': 'true', className: 'mono', style: { flex: '1', minWidth: '0', fontSize: '11px', fontWeight: '800', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8E3D61' } }, 'Step ' + (i + 1) + ' of ' + n),
      h('button', { 'data-tour-close': 'true', type: 'button', onClick: () => tourEnd(), 'aria-label': 'Close the tour', style: { width: '44px', height: '44px', flexShrink: '0', margin: '-6px -7px -6px 0', borderRadius: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(170,83,117,0.10)', color: '#AA5375', cursor: 'pointer' } }, appIcon('calClose', 18))
    ),
    h('h2', { id: 'tour-title', 'data-tour-title': 'true', style: { margin: '7px 0 0', fontSize: '17px', fontWeight: '800', letterSpacing: '-0.02em', color: '#342530', lineHeight: '1.2' } }, step.title),
    h('p', { id: 'tour-body', 'data-tour-body': 'true', style: { margin: '6px 0 0', fontSize: '14px', lineHeight: '1.45', color: '#5F4A56' } }, step.body),
    h('div', { 'data-tour-dots': 'true', role: 'group', 'aria-label': 'Tour progress', style: { display: 'flex', gap: '5px', marginTop: '12px' } },
      // aria-current is SPREAD IN, never passed as a nullish value. h() falls through to a bare
      // el.setAttribute() for anything it does not special-case, so `aria-current: null` renders
      // the literal aria-current="null" and every dot claims to be the current step.
      ...TOUR_STEPS.map((s, k) => h('span', Object.assign({
        'data-tour-dot': s.key,
        style: { width: k === i ? '18px' : '6px', height: '6px', borderRadius: '99px', background: k === i ? '#AA5375' : 'rgba(170,83,117,0.28)', transition: 'width 160ms ease' }
      }, k === i ? { 'aria-current': 'step' } : {})))
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' } },
      h('button', { 'data-tour-skip': 'true', type: 'button', onClick: () => tourEnd(), style: { ...btnBase, padding: '0 11px', background: 'transparent', color: '#745D69', fontSize: '13.5px' } }, 'Skip'),
      h('span', { style: { flex: '1' } }),
      // Back is OMITTED on the first step rather than rendered disabled. `disabled: false` and
      // `disabled: null` both disable a control through h(), and a permanently dead button on the
      // opening step is exactly the class of defect this app has shipped four times.
      i > 0 ? h('button', { 'data-tour-back': 'true', type: 'button', onClick: () => tourGo(i - 1), style: { ...btnBase, padding: '0 14px', background: 'rgba(255,255,255,0.72)', border: '1px solid rgba(212,104,138,0.32)', color: '#8E3D61' } }, 'Back') : null,
      h('button', { 'data-tour-next': 'true', type: 'button', onClick: () => tourNext(), style: { ...btnBase, padding: '0 16px', background: '#AA5375', color: '#fff', boxShadow: 'inset 0 -2px 0 rgba(121,57,84,0.35)' } }, isLast ? 'Done' : 'Next')
    )
  );

  tourEl.innerHTML = '';
  scrim.appendChild(ring);
  scrim.appendChild(card);
  tourEl.appendChild(scrim);
  tourScrimEl = scrim;
  tourRingEl = ring;
  tourCardEl = card;

  const el = tourAnchorEl(step);
  if (el && typeof el.scrollIntoView === 'function') {
    try {
      // A block taller than the screen must NOT be centred: centring puts its heading -- the thing
      // the step is actually naming -- above the top of the viewport, and the spotlight then
      // clamps to the screen edge instead of tracing the target. Align its top instead, then back
      // off by the height of the sticky header so the header is not sitting on top of it.
      const vhNow = window.innerHeight || 812;
      const tall = el.getBoundingClientRect().height > vhNow * 0.6;
      el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'auto' });
      if (tall) window.scrollBy(0, -96);
    } catch (err) {}
  }
  positionTour(false);
  // Two frames, not one. calFocusOnce() hands focus to a newly opened dialog on a single rAF;
  // taking focus on the second frame means the tour wins that race every time instead of most
  // of the time. Focus lands on the card, never on a text field, so no keyboard is thrown up.
  requestAnimationFrame(() => {
    positionTour(false);
    requestAnimationFrame(() => {
      positionTour(false);
      if (tourCardEl) { try { tourCardEl.focus(); } catch (err) {} }
    });
  });
}

function tourKeyHandler(e) {
  if (!state.tour) return;
  if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault();
    e.stopPropagation();
    tourEnd();
    return;
  }
  if (e.key !== 'Tab' || !tourCardEl) return;
  const items = Array.prototype.slice.call(tourCardEl.querySelectorAll('button'));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!tourCardEl.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

function tourGo(next) {
  if (!state.tour) return;
  state.tour.i = Math.max(0, Math.min(TOUR_STEPS.length - 1, Number(next) || 0));
  tourApplyView(tourStepAt(state.tour.i));
  tourRenderStep();
}

function tourNext() {
  if (!state.tour) return;
  if (state.tour.i >= TOUR_STEPS.length - 1) { tourEnd(); return; }
  tourGo(state.tour.i + 1);
}

function tourStart() {
  if (state.tour) return;
  // Anything half-typed is closed before the tour takes over, because the tour changes screens
  // underneath and a sheet left open behind it would be unreachable. Reached only from the menu,
  // and the menu cannot be open at the same time as the appointment sheet or the time modal.
  state.tour = { i: 0, retView: state.view, retReports: state.reportsView || null };
  tourMount();
  document.addEventListener('keydown', tourKeyHandler, true);
  window.addEventListener('resize', tourReflow);
  window.addEventListener('scroll', tourReflow, true);
  tourGo(0);
}

// Safe to call twice, from any step, with the DOM in any state. Every teardown line is guarded or
// idempotent, because "I tapped Skip twice" must not be a way to end up with a dead overlay.
function tourEnd() {
  const t = state.tour;
  state.tour = null;
  document.removeEventListener('keydown', tourKeyHandler, true);
  window.removeEventListener('resize', tourReflow);
  window.removeEventListener('scroll', tourReflow, true);
  tourUnmount();
  if (t) {
    state.view = t.retView || 'home';
    state.reportsView = t.retReports || null;
  }
  state.drawerOpen = false;
  calDrawerNeedsFocus = false;
  render();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    const b = document.querySelector('[data-tour-menu]');
    if (b) { try { b.focus(); } catch (err) {} }
  });
}
'''

# Names, icon keys, state keys and data- hooks this patch introduces.  Every one of them is
# checked against the UNPATCHED source before a single byte is written.  A duplicate object key is
# legal JavaScript -- last wins, no error, no warning -- which is how a duplicate `help:` icon key
# once applied cleanly and silently, and anchor-uniqueness cannot see it.
NEW_IDENTIFIERS = [
    'TOUR_STEPS', 'tourEl', 'tourScrimEl', 'tourRingEl', 'tourCardEl', 'tourStepAt',
    'tourAnchorEl', 'tourMount', 'tourUnmount', 'tourReflow', 'positionTour', 'tourApplyView',
    'tourRenderStep', 'tourKeyHandler', 'tourGo', 'tourNext', 'tourStart', 'tourEnd',
]
NEW_ICON_KEYS = ['tourHelp']
NEW_STATE_KEYS = ['tour']
NEW_DATA_HOOKS = [
    'data-tour-root', 'data-tour-scrim', 'data-tour-ring', 'data-tour-card', 'data-tour-step',
    'data-tour-key', 'data-tour-count', 'data-tour-close', 'data-tour-title', 'data-tour-body',
    'data-tour-dots', 'data-tour-dot', 'data-tour-skip', 'data-tour-back', 'data-tour-next',
    'data-tour-quicklog', 'data-tour-meds', 'data-tour-reports', 'data-tour-drawer-item',
    'data-tour-menu', 'data-tour-calendar', 'data-tour-missed', 'data-tour-backup',
]
NEW_ELEMENT_IDS = ['tour-title', 'tour-body']

# The composed one-second tick guard.  Every term belongs to a different patch.  The patch refuses
# to write unless this exact line is present in the result, so a later edit that drops somebody
# else's term fails here rather than in production.
TICK_OLD = "  if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();"
TICK_NEW = """  // COMPOSED, NOT OVERWRITTEN.  Every term below belongs to a different patch: timeModal is
  // original, apptSheet and drawerOpen are the calendar patch's, missReasonSheet rides inside
  // isEditing from the reason patch, and !state.tour is this one.  Dropping any single term ships
  // a once-a-second repaint that destroys the control somebody is currently touching -- the
  // appointment sheet losing focus mid-sentence is a defect this project has already shipped.
  if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();
  // Skipping render() during a tour is what stops the spotlight jumping, but the page underneath
  // can still reflow with no repaint at all -- a sync landing, an image settling, the keyboard
  // closing.  Re-glue the highlight to its target instead of leaving it on stale coordinates.
  else if (state.tour) positionTour(false);"""

TICK_REQUIRED = "if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !state.tour && !isEditing) render();"
TICK_REQUIRED_ELSE = "else if (state.tour) positionTour(false);"


def die(msg):
    sys.stderr.write('REFUSED: ' + msg + '\n')
    sys.exit(2)


def replace_once(src, old, new, label):
    n = src.count(old)
    if n == 0:
        die('anchor not found [%s]. Expected exactly one occurrence of:\n---\n%s\n---' % (label, old))
    if n > 1:
        die('anchor ambiguous [%s]: found %d occurrences, expected 1.' % (label, n))
    return src.replace(old, new, 1)


def collision_scan(src):
    """Run against the UNPATCHED source.  Any hit is fatal."""
    hits = []
    for name in NEW_IDENTIFIERS:
        if re.search(r'\b' + re.escape(name) + r'\b', src):
            hits.append('identifier `%s` already exists' % name)
    for key in NEW_ICON_KEYS:
        if re.search(r'^\s*' + re.escape(key) + r'\s*:', src, re.M):
            hits.append('icon/object key `%s:` already exists' % key)
    for key in NEW_STATE_KEYS:
        if re.search(r'\bstate\.' + re.escape(key) + r'\b', src) or \
           re.search(r'[{,]\s*' + re.escape(key) + r'\s*:', src):
            hits.append('state key `%s` already exists' % key)
    for hook in NEW_DATA_HOOKS:
        if hook in src:
            hits.append('data hook `%s` already exists' % hook)
    for eid in NEW_ELEMENT_IDS:
        if ("id: '" + eid + "'") in src or ('id="' + eid + '"') in src:
            hits.append('element id `%s` already exists' % eid)
    # The calendar patch namespaced its icons to cal* and deliberately left these free.  Confirm
    # that still holds, so this patch is not the one that takes a name somebody else is about to.
    for free in ['menu', 'calendar', 'close', 'gear', 'help']:
        if re.search(r'^    ' + free + r": '", src, re.M):
            hits.append('icon key `%s` was expected to be free but is taken' % free)
    if hits:
        die('name collision(s) in the base file -- nothing written:\n  - ' + '\n  - '.join(hits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='.', help='repo root containing index.html')
    ap.add_argument('--check', action='store_true', help='verify only, write nothing')
    args = ap.parse_args()

    target = os.path.join(args.repo, 'index.html')
    if not os.path.isfile(target):
        die('index.html not found at %s' % target)
    with open(target, encoding='utf-8') as f:
        src = f.read()

    before_md5 = hashlib.md5(src.encode('utf-8')).hexdigest()

    if MARK in src:
        print('tour-patch: already applied (%s present) -- nothing to do. md5 %s' % (MARK, before_md5))
        return 0

    ver = re.search(r"const APP_VERSION = '([^']+)';", src)
    if not ver:
        die('APP_VERSION not found -- this does not look like index.html')
    app_version = ver.group(1)

    collision_scan(src)

    out = src

    # 1. state key ------------------------------------------------------------------------------
    out = replace_once(
        out,
        "apptSheet: null, apptConfirmDelete: null };",
        "apptSheet: null, apptConfirmDelete: null, tour: null };",
        'state.tour',
    )

    # 2. icon ------------------------------------------------------------------------------------
    out = replace_once(
        out,
        """    calClose: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>'
  };""",
        """    calClose: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
    // Namespaced tour*, for the same reason the calendar patch namespaced cal*: `help` is the
    // obvious name, which is exactly why the next patch will reach for it too. `help` stays free.
    tourHelp: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9"/><path d="M12 17.6h.01"/>'
  };""",
        'tourHelp icon',
    )

    # 3. one-second tick guard --------------------------------------------------------------------
    out = replace_once(out, TICK_OLD, TICK_NEW, 'tick guard')

    # 4. render() tail ----------------------------------------------------------------------------
    out = replace_once(
        out,
        """  root.innerHTML = '';
  root.appendChild(page);
}""",
        """  root.innerHTML = '';
  root.appendChild(page);
  // The tour lives OUTSIDE #root, because the line above would otherwise destroy it on every
  // repaint. It survives -- but every element the spotlight could be pointing at has just been
  // replaced, so re-glue the highlight to the new node now instead of leaving it on stale
  // coordinates for up to a second.
  if (state.tour) positionTour(false);
}""",
        'render() tail',
    )

    # 5. Home anchor: the Quick log section --------------------------------------------------------
    out = replace_once(
        out,
        """  parts.push(h('section', null,
    h('div', { onClick: () => setState({ quickLogOpen: !quickLogOpen }),""",
        """  parts.push(h('section', { 'data-tour-quicklog': 'true' },
    h('div', { onClick: () => setState({ quickLogOpen: !quickLogOpen }),""",
        'quick log anchor',
    )

    # 6. Meds anchor -------------------------------------------------------------------------------
    out = replace_once(
        out,
        """    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards)
  ];""",
        """    h('div', { 'data-tour-meds': 'true', style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards)
  ];""",
        'medication list anchor',
    )

    # 7. Reports anchor ----------------------------------------------------------------------------
    out = replace_once(
        out,
        """    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      ...reportTypes.map(type => {""",
        """    h('div', { 'data-tour-reports': 'true', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      ...reportTypes.map(type => {""",
        'reports list anchor',
    )

    # 7b. The tour's own hook on the existing header button. NOT a second button -- the same
    # element gains one attribute. The tour does not reuse 'data-cal-menu-button' because the
    # calendar suite asserts that hook appears exactly once in the whole source, and a selector
    # that merely READS it counts too: two reads turned that check red.
    out = replace_once(
        out,
        """      h('button', { 'data-cal-menu-button': 'true', type: 'button', onClick: calOpenDrawer,""",
        """      h('button', { 'data-cal-menu-button': 'true', 'data-tour-menu': 'true', type: 'button', onClick: calOpenDrawer,""",
        'header button tour hook',
    )

    # 7c. The remaining three anchors get tour-owned hooks on the SAME elements, for the reason
    # above: the calendar, reason and export suites each assert that their own hooks appear
    # exactly once in the source, and a selector string counts as an occurrence.
    out = replace_once(
        out,
        """      h('div', { 'data-cal-month-grid': 'true', role: 'grid',""",
        """      h('div', { 'data-cal-month-grid': 'true', 'data-tour-calendar': 'true', role: 'grid',""",
        'month grid tour hook',
    )
    out = replace_once(
        out,
        """      h('button', { 'data-mr-row-button': 'true', 'aria-label':""",
        """      h('button', { 'data-mr-row-button': 'true', 'data-tour-missed': 'true', 'aria-label':""",
        'missed-row tour hook',
    )
    out = replace_once(
        out,
        """      'data-backup-btn': kind,
      ...(off ? { disabled: 'disabled' } : {}),""",
        """      'data-backup-btn': kind,
      // Spread, never a nullish ternary: h() falls through to setAttribute, and any value at all
      // -- including the string "null" -- would put a dead hook on the other two buttons.
      ...(kind === 'backup' ? { 'data-tour-backup': 'true' } : {}),
      ...(off ? { disabled: 'disabled' } : {}),""",
        'backup button tour hook',
    )

    # 8. Drawer row ---------------------------------------------------------------------------------
    # NOT a header button.  The header is menu + title + clock and leaves roughly 128px for a title
    # that needs about 150px; a second header button squeezes the patient's own name off the screen.
    # There is no reserved `help` row in this build to take over -- CAL_DRAWER_ITEMS is six
    # navigation rows and nothing else -- so this adds one row below a rule, kept out of
    # CAL_DRAWER_ITEMS on purpose: that array is view-keyed and feeds calDrawerGo(), and a
    # non-view entry in it would navigate to a view that does not exist.
    out = replace_once(
        out,
        """            )
          );
        })
      )
    )
  );
}

// ---- Appointment sheet ----""",
        """            )
          );
        })
      ),
      h('div', { style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(212,104,138,0.16)' } },
        h('button', {
          'data-tour-drawer-item': 'true', type: 'button', onClick: () => tourStart(),
          style: { minHeight: '58px', width: '100%', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', padding: '9px 11px', borderRadius: '14px', background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(212,104,138,0.14)', cursor: 'pointer' }
        },
          h('span', { style: { width: '34px', height: '34px', flexShrink: '0', borderRadius: '11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(170,83,117,0.09)', color: '#AA5375' } }, appIcon('tourHelp', 18)),
          h('span', { style: { display: 'block', minWidth: '0', flex: '1' } },
            h('span', { style: { display: 'block', fontSize: '14.5px', fontWeight: '800', color: '#342530', letterSpacing: '-0.01em' } }, 'Take a quick tour'),
            h('span', { style: { display: 'block', fontSize: '11.5px', color: '#6E5261', marginTop: '1px', lineHeight: '1.3' } }, 'A minute-long look around')
          )
        )
      )
    )
  );
}

// ---- Appointment sheet ----""",
        'drawer tour row',
    )

    # 9. the module itself ---------------------------------------------------------------------------
    out = replace_once(
        out,
        """// Init
unsubPrefs = subscribePrefs((prefs) => {""",
        JS_BLOCK.rstrip('\n') + """

// Init
unsubPrefs = subscribePrefs((prefs) => {""",
        'tour module insertion point',
    )

    # ---- post-conditions: refuse to write unless every one of these holds -------------------------
    problems = []
    if MARK not in out:
        problems.append('marker %s missing from the result' % MARK)
    if TICK_REQUIRED not in out:
        problems.append('composed tick guard missing -- expected exactly:\n      ' + TICK_REQUIRED)
    if TICK_REQUIRED_ELSE not in out:
        problems.append('tick guard reflow branch missing -- expected: ' + TICK_REQUIRED_ELSE)
    if out.count(TICK_REQUIRED) != 1:
        problems.append('composed tick guard appears %d times, expected 1' % out.count(TICK_REQUIRED))
    if ("const APP_VERSION = '%s';" % app_version) not in out:
        problems.append('APP_VERSION was altered -- this patch must never touch it')
    # A duplicate object key is silent.  Re-scan the icon table of the RESULT for repeats.
    icon_tbl = re.search(r'const paths = \{(.*?)\n  \};', out, re.S)
    if not icon_tbl:
        problems.append('icon table not found in the result')
    else:
        keys = re.findall(r'^\s{4}([A-Za-z_$][\w$]*)\s*:', icon_tbl.group(1), re.M)
        dupes = sorted({k for k in keys if keys.count(k) > 1})
        if dupes:
            problems.append('duplicate icon key(s) after patch: ' + ', '.join(dupes))
    # The header must still hold exactly one button.
    hdr = re.search(r"function renderHeader\(now\) \{.*?\n\}", out, re.S)
    if not hdr:
        problems.append('renderHeader() not found in the result')
    elif hdr.group(0).count("h('button'") != 1:
        problems.append('renderHeader() has %d buttons, expected exactly 1'
                        % hdr.group(0).count("h('button'"))
    # CAL_DRAWER_ITEMS must be untouched: six navigation rows, no more, no fewer.
    items = re.search(r'const CAL_DRAWER_ITEMS = \[(.*?)\n\];', out, re.S)
    if not items:
        problems.append('CAL_DRAWER_ITEMS not found in the result')
    elif items.group(1).count("{ view:") != 6:
        problems.append('CAL_DRAWER_ITEMS has %d rows, expected the original 6'
                        % items.group(1).count("{ view:"))
    # Nobody else's hooks may move. A hook string that a sibling patch asserts is unique breaks
    # even when this patch only READS it in a selector -- which is exactly what happened once.
    for hook in sorted(set(re.findall(r"data-(?:cal|mr|backup)-[a-z-]+", src))):
        if src.count(hook) != out.count(hook):
            problems.append('hook %s occurrence count changed: %d -> %d'
                            % (hook, src.count(hook), out.count(hook)))
    if out.count("'data-tour-drawer-item'") != 1:
        problems.append('expected exactly one tour drawer row, found %d'
                        % out.count("'data-tour-drawer-item'"))
    # calCloseDrawer() must not be reachable from the tour: it hands focus back to the menu button
    # and yanks it out from under the tour.
    for fn in ['function tourStart', 'function tourGo', 'function tourApplyView']:
        m = re.search(re.escape(fn) + r'\(.*?\n\}', out, re.S)
        if m and 'calCloseDrawer(' in m.group(0):
            problems.append('%s() calls calCloseDrawer() -- it queues a focus handoff that lands '
                            'after the tour has taken focus' % fn.split()[-1])
    if problems:
        die('post-conditions failed -- nothing written:\n  - ' + '\n  - '.join(problems))

    after_md5 = hashlib.md5(out.encode('utf-8')).hexdigest()
    if args.check:
        print('tour-patch: --check OK. would write %s  (%s -> %s)' % (target, before_md5, after_md5))
        return 0

    with open(target, 'w', encoding='utf-8') as f:
        f.write(out)
    print('tour-patch: applied to %s' % target)
    print('  APP_VERSION untouched: %s' % app_version)
    print('  md5 %s -> %s' % (before_md5, after_md5))
    print('  composed tick guard: %s' % TICK_REQUIRED.strip())
    return 0


if __name__ == '__main__':
    sys.exit(main())
