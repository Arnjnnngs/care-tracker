#!/usr/bin/env python3
"""
calendar-patch.py — adds the Calendar + Appointments feature to care-tracker's index.html.

Ported from ChemoWell (menu -> Calendar: month grid, day detail, add/edit/remove appointments),
re-implemented on care-tracker's storage model.

PROPERTIES THIS SCRIPT GUARANTEES
  * ANCHORED   — every edit is located by an exact substring that must appear EXACTLY ONCE.
                 Any anchor that is missing, or that appears more than once, aborts the whole run
                 with a non-zero exit and NOTHING is written.
  * ATOMIC     — the new file is built entirely in memory. The first failure aborts before any
                 write, so index.html is never left half-patched.
  * IDEMPOTENT — a second run detects the sentinel and exits 0 having changed nothing.
  * NON-COLLIDING — every identifier, icon key and data-hook it introduces is checked against the
                 base file first. If the base already has one, the run aborts. This is the check
                 that a previous round did not have, and a duplicated `help:` icon key silently
                 replaced another patch's icon (duplicate object keys are legal JS: last wins, no
                 error, no warning).
  * DOES NOT TOUCH APP_VERSION, and does not open sw.js at all. Verified after patching.

Usage:
    python3 calendar-patch.py [--repo /path/to/care-tracker] [--check]

    --check   verify only: report whether the patch is applied / appliable. Writes nothing.
"""

import argparse
import hashlib
import os
import sys

BASE_MD5 = "8136b7764f07865171c180212a4d5b09"          # care-tracker v43.3, commit 87e89bb
SENTINEL = "CAL_APPT_MED_ID"                            # presence => already applied

# Identifiers this patch introduces. If ANY of these already exists in the base file we abort
# rather than shadow, redeclare or silently override something another patch owns.
NEW_IDENTIFIERS = [
    "CAL_APPT_MED_ID", "CAL_TITLE_MAX", "CAL_NOTE_MAX", "CAL_WEEKDAY_LETTERS",
    "CAL_DRAWER_ITEMS", "calNewApptId", "calPad2", "calDateKeyOf", "calMonthKeyOf",
    "calShiftMonth", "calIsValidTs", "calResolveAppointments", "calApptSupersedes",
    "calApptsByDay", "calOpenDrawer", "calCloseDrawer", "calDrawerGo", "renderCalDrawer",
    "calDefaultWhenTs", "calOpenApptSheet", "calCloseApptSheet", "calParseLocalISO",
    "calSaveAppt", "calRemoveAppt", "renderApptSheet", "renderCalendarView",
    "calDrawerNeedsFocus", "calSheetNeedsFocus", "calFocusOnce", "calFieldStyle",
    "calLabelStyle", "cal-appt-title", "cal-appt-when", "cal-appt-note",
    # state fields
    "appointments:", "drawerOpen", "calCursor", "calSelected", "apptSheet", "apptConfirmDelete",
    # icon keys (checked WITH the colon, the way they appear in the icon table)
    "calMenu:", "calMonth:", "calClose:",
]

# Every test hook this patch emits. All are unique and descriptive: an earlier round emitted
# data-cal-ui="calendar" on THREE sections, and querySelector silently returned the first, so an
# auditor measured a third of the calendar and passed it.
NEW_HOOKS = [
    "data-cal-menu-button", "data-cal-drawer-overlay", "data-cal-drawer",
    "data-cal-drawer-close", "data-cal-drawer-item",
    "data-cal-view-header", "data-cal-add-button",
    "data-cal-month-section", "data-cal-month-grid", "data-cal-month-label",
    "data-cal-prev-month", "data-cal-next-month", "data-cal-weekday-row",
    "data-cal-day-cell", "data-cal-day-count",
    "data-cal-day-panel", "data-cal-day-panel-label", "data-cal-day-add-button",
    "data-cal-day-empty", "data-cal-appt-row", "data-cal-appt-edit", "data-cal-appt-delete",
    "data-cal-appt-delete-confirm", "data-cal-appt-delete-keep",
    "data-cal-sheet", "data-cal-sheet-title-input", "data-cal-sheet-when-input",
    "data-cal-sheet-note-input", "data-cal-sheet-save", "data-cal-sheet-cancel",
    "data-cal-sheet-remove", "data-cal-sheet-remove-confirm", "data-cal-sheet-remove-keep",
    "data-cal-sheet-error",
]


# =================================================================================================
# EDIT 1 — subscribeEntries: split appointments out of state.entries
# =================================================================================================
A1 = """    state.chemoDates = all.filter(e => e.medId === 'chemo_date');
    callback(all.filter(e => e.medId !== 'chemo_date'));
"""

B1 = """    state.chemoDates = all.filter(e => e.medId === 'chemo_date');
    // Appointments are scheduling records, not doses. They are split out of state.entries exactly
    // the way chemo_date is, one line above, so that every dose calculation, every report, the CSV
    // and the printable record all keep ignoring them BY CONSTRUCTION rather than by each one
    // remembering to filter. allExportEntries() is entries+chemoDates and is deliberately left
    // untouched: an appointment is not a dose and has no place in a clinical hand-off.
    state.appointments = calResolveAppointments(all.filter(e => e.medId === CAL_APPT_MED_ID));
    callback(all.filter(e => e.medId !== 'chemo_date' && e.medId !== CAL_APPT_MED_ID));
"""


# =================================================================================================
# EDIT 2 — state: calendar fields
# =================================================================================================
A2 = "confirmClearChemo: false, exporting: false };"

B2 = ("confirmClearChemo: false, exporting: false, "
      "appointments: [], drawerOpen: false, calCursor: null, calSelected: null, "
      "apptSheet: null, apptConfirmDelete: null };")


# =================================================================================================
# EDIT 3 — icons
# =================================================================================================
A3 = """    download: '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/>'
  };"""

B3 = """    download: '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 16v3.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
    // Calendar patch. Namespaced cal* on purpose: plain `menu`, `calendar`, `close`, `gear` and
    // `help` are the obvious names, which is exactly why two patches reach for them and one wins
    // silently -- a duplicate object key is legal JavaScript with no error and no warning.
    calMenu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    calMonth: '<path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
    calClose: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>'
  };"""


# =================================================================================================
# EDIT 4 — header: 44px menu button
# =================================================================================================
A4 = """    h('div', { style: { maxWidth: '720px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px' } },
      h('div', { style: { minWidth: '0', flex: '1' } },"""

B4 = """    h('div', { style: { maxWidth: '720px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px' } },
      // The only route to the Calendar. 44x44 exactly -- it is the smallest control on the busiest
      // screen and it is hit one-handed while holding something else.
      h('button', { 'data-cal-menu-button': 'true', type: 'button', onClick: calOpenDrawer, 'aria-label': 'Open menu', 'aria-expanded': state.drawerOpen ? 'true' : 'false', style: { flexShrink: '0', width: '44px', height: '44px', borderRadius: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(170,83,117,0.12)', color: '#AA5375' } }, appIcon('calMenu', 21)),
      h('div', { style: { minWidth: '0', flex: '1' } },"""


# =================================================================================================
# EDIT 5 — renderContent: the calendar view
# =================================================================================================
A5 = """  if (state.view === 'symptoms') return renderSymptoms(now);
  return [...renderToday(now, mg, pct, tyColor, ceiling)];"""

B5 = """  if (state.view === 'symptoms') return renderSymptoms(now);
  if (state.view === 'calendar') return renderCalendarView(now);
  return [...renderToday(now, mg, pct, tyColor, ceiling)];"""


# =================================================================================================
# EDIT 6 — render(): mount the drawer and the appointment sheet
# =================================================================================================
A6 = """    renderTimeModal(),
    (state.view === 'reports' && state.reportsView)"""

B6 = """    renderTimeModal(),
    renderCalDrawer(),
    renderApptSheet(),
    (state.view === 'reports' && state.reportsView)"""


# =================================================================================================
# EDIT 7 — clock tick: never repaint underneath an open dialog
# =================================================================================================
A7 = "  if (!state.timeModal && !isEditing) render();"

B7 = ("  // A repaint rebuilds the whole tree, so a once-a-second tick underneath an open dialog\n"
      "  // destroys and recreates the control being touched. The drawer and the appointment sheet\n"
      "  // get the same protection the time modal already had.\n"
      "  if (!state.timeModal && !state.apptSheet && !state.drawerOpen && !isEditing) render();")


# =================================================================================================
# EDIT 8 — subscribeEntries callback: defer a live snapshot under the appointment sheet
# =================================================================================================
# Anchored on the guard and its own comment rather than on the `const wasEmpty` line above it:
# wasEmpty exists only to feed the dead seedDemo() call, so the pending dead-code-removal patch
# deletes it. Anchoring here means this patch applies whichever of the two lands first.
A8 = """  if (state.timeModal) {
    // Defer update so the modal isn't destroyed mid-interaction"""

B8 = """  // state.appointments was already refreshed inside subscribeEntries above, so the calendar is
  // never stale; what is deferred here is only the state.entries swap and the repaint that comes
  // with it, which would otherwise wipe a half-typed appointment when a sync lands.
  if (state.timeModal || state.apptSheet) {
    // Defer update so the modal isn't destroyed mid-interaction"""


# =================================================================================================
# EDIT 9 — the feature block, placed immediately ABOVE the export block
# =================================================================================================
A9 = """// =================================================================================================
// EXPORT — CSV + printable report (v43)"""

FEATURE_BLOCK = r"""// =================================================================================================
// CALENDAR & APPOINTMENTS  (ported from ChemoWell)
//
// WHAT THIS IS. Menu -> Calendar: a month grid, a day panel underneath it, and add/edit/remove for
// appointments. Reached only from the header menu button; the five bottom-nav tabs are unchanged.
//
// WHERE APPOINTMENTS LIVE. ChemoWell keeps them in localStorage under its own profile-scoped key.
// care-tracker does not and must not touch that key or that collection. Here an appointment is an
// ordinary document in caretracker_entries with medId 'appointment', and subscribeEntries splits
// those out into state.appointments the same way it already splits chemo_date into
// state.chemoDates. state.entries therefore never contains one, which is what keeps appointments
// out of every dose calculation, out of the CSV and out of the printable oncologist report --
// allExportEntries() is entries+chemoDates and this block does not change it.
//
// WHY EDIT AND DELETE ARE BOTH AN INSERT. The Firestore rules for this project are append-only:
// existing documents cannot be edited at all, and deletes are refused after 48 hours. A literal
// updateDoc/deleteDoc would therefore work while testing and start failing on the patient's phone
// the moment an appointment was older than two days. Instead every appointment carries a stable
// apptId; editing appends a new document with the same apptId and a newer loggedAt, and removing
// appends one with cancelled:true. The newest document for an apptId is the live version. Nothing
// is ever mutated, nothing is ever deleted, and the history of a rescheduled appointment stays
// readable in the raw collection.
//
// This block is placed ABOVE the export block deliberately: the export block documents itself as
// strictly read-only, and inserting a feature that calls addEntryDB inside it would break that
// claim even though the code is unrelated.
// =================================================================================================

const CAL_APPT_MED_ID = 'appointment';
const CAL_TITLE_MAX = 120;
const CAL_NOTE_MAX = 500;
const CAL_WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function calPad2(n) { return String(n).padStart(2, '0'); }
function calNewApptId() { return 'appt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
function calIsValidTs(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

// Local date key. Deliberately NOT toISOString().slice(0,10) -- that is UTC, and west of Greenwich
// an 8pm appointment would land on the following day in the grid.
function calDateKeyOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + calPad2(d.getMonth() + 1) + '-' + calPad2(d.getDate());
}
function calMonthKeyOf(ts) { return calDateKeyOf(ts).slice(0, 7); }

function calShiftMonth(cursor, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(cursor || ''));
  if (!m) return calMonthKeyOf(simNow());
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return d.getFullYear() + '-' + calPad2(d.getMonth() + 1);
}

// Deterministic: loggedAt decides, and the document id breaks a tie the same way on every device,
// so two phones can never disagree about which version of an appointment is showing.
function calApptSupersedes(next, prev) {
  const a = (typeof next.loggedAt === 'number' && isFinite(next.loggedAt)) ? next.loggedAt : 0;
  const b = (typeof prev.loggedAt === 'number' && isFinite(prev.loggedAt)) ? prev.loggedAt : 0;
  if (a !== b) return a > b;
  return String(next.id || '') > String(prev.id || '');
}

// Collapse the append-only document history down to the live appointments.
//
// The grouping uses a Map, NOT a plain object. apptId comes out of the database, and on a plain
// object an id of 'constructor', 'toString' or '__proto__' reads back a truthy INHERITED value
// from Object.prototype -- so the first document with such an id would have been treated as
// already-seen and dropped, silently, with no error. That exact class of bug has already cost this
// project one blocker. A Map has no prototype chain on its keys.
function calResolveAppointments(docs) {
  const byGroup = new Map();
  for (const d of (docs || [])) {
    if (!d) continue;
    const key = (typeof d.apptId === 'string' && d.apptId) ? d.apptId : ('doc:' + String(d.id));
    const prev = byGroup.get(key);
    if (!prev || calApptSupersedes(d, prev)) byGroup.set(key, d);
  }
  const live = [];
  byGroup.forEach((a, key) => {
    if (a.cancelled) return;                                   // tombstone
    if (!calIsValidTs(a.ts)) return;                           // unusable date, do not guess one
    if (typeof a.title !== 'string' || !a.title.trim()) return;
    // apptId is normalised onto the copy so a legacy document written without one is still
    // editable and removable -- its group key becomes its identity.
    live.push(Object.assign({}, a, { apptId: key }));
  });
  return live.sort((a, b) => a.ts - b.ts);
}

function calApptsByDay() {
  const byDay = new Map();
  for (const a of (state.appointments || [])) {
    const k = calDateKeyOf(a.ts);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a);
  }
  byDay.forEach((list) => list.sort((x, y) => x.ts - y.ts));
  return byDay;
}

// ---- Menu drawer ----

let calDrawerNeedsFocus = false;
let calSheetNeedsFocus = false;

// Moves focus into a newly opened dialog once, for a screen reader, without stealing it back on
// every later repaint (which would fight the person typing) and without focusing a text field
// (which would throw the on-screen keyboard up unasked).
function calFocusOnce(el, flagGet, flagClear) {
  if (!el || !flagGet()) return;
  flagClear();
  requestAnimationFrame(() => { try { el.focus(); } catch (err) {} });
}

function calOpenDrawer() { calDrawerNeedsFocus = true; setState({ drawerOpen: true }); }
function calCloseDrawer() { calDrawerNeedsFocus = false; setState({ drawerOpen: false }); }

const CAL_DRAWER_ITEMS = [
  { view: 'home', label: 'Home', icon: 'home', blurb: "Today's doses" },
  { view: 'calendar', label: 'Calendar', icon: 'calMonth', blurb: 'Appointments and dates' },
  { view: 'meds', label: 'Medications', icon: 'pill', blurb: 'The medication list' },
  { view: 'reports', label: 'Reports', icon: 'chart', blurb: 'History, charts, save a copy' },
  { view: 'inpatient', label: 'In-Patient', icon: 'hospital', blurb: 'Hospital stays' },
  { view: 'symptoms', label: 'Symptoms', icon: 'notes', blurb: 'How she is feeling' }
];

function calDrawerGo(view) {
  calDrawerNeedsFocus = false;
  state.drawerOpen = false;
  navigateTo(view);
}

function renderCalDrawer() {
  if (!state.drawerOpen) return null;
  return h('div', { 'data-cal-drawer-overlay': 'true', onClick: (e) => { if (e.target === e.currentTarget) calCloseDrawer(); }, style: { position: 'fixed', inset: '0', background: 'rgba(60,30,50,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: '70', display: 'flex', justifyContent: 'flex-start' } },
    h('div', { 'data-cal-drawer': 'true', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu', tabindex: '-1', ref: (el) => calFocusOnce(el, () => calDrawerNeedsFocus, () => { calDrawerNeedsFocus = false; }), style: { width: '286px', maxWidth: '86vw', height: '100%', overflowY: 'auto', background: 'rgba(255,245,248,0.98)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderRight: '1px solid rgba(212,104,138,0.18)', boxShadow: '0 0 60px rgba(120,60,90,0.22)', padding: 'calc(14px + env(safe-area-inset-top)) 12px calc(16px + env(safe-area-inset-bottom))', outline: 'none' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '0 4px 12px' } },
        h('div', { style: { fontSize: '15px', fontWeight: '800', letterSpacing: '-0.02em', color: '#342530' } }, 'Menu'),
        h('button', { 'data-cal-drawer-close': 'true', type: 'button', onClick: calCloseDrawer, 'aria-label': 'Close menu', style: { width: '44px', height: '44px', flexShrink: '0', borderRadius: '13px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(170,83,117,0.10)', color: '#AA5375' } }, appIcon('calClose', 19))
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        ...CAL_DRAWER_ITEMS.map((item) => {
          const active = state.view === item.view;
          return h('button', Object.assign({
            'data-cal-drawer-item': item.view,
            type: 'button',
            onClick: () => calDrawerGo(item.view),
            style: { minHeight: '58px', width: '100%', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left', padding: '9px 11px', borderRadius: '14px', background: active ? 'rgba(170,83,117,0.13)' : 'rgba(255,255,255,0.55)', border: active ? '1px solid rgba(170,83,117,0.34)' : '1px solid rgba(212,104,138,0.14)' }
            // aria-current is OMITTED when it does not apply -- spread in, never passed with a
            // nullish value. h() calls setAttribute for anything it does not special-case, so a
            // nullish aria-current renders the literal aria-current="null" and every item in the
            // menu then announces itself as the current page.
          }, active ? { 'aria-current': 'page' } : {}),
            h('span', { style: { width: '34px', height: '34px', flexShrink: '0', borderRadius: '11px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(170,83,117,0.16)' : 'rgba(170,83,117,0.09)', color: '#AA5375' } }, appIcon(item.icon, 18)),
            h('span', { style: { display: 'block', minWidth: '0', flex: '1' } },
              h('span', { style: { display: 'block', fontSize: '14.5px', fontWeight: '800', color: '#342530', letterSpacing: '-0.01em' } }, item.label),
              h('span', { style: { display: 'block', fontSize: '11.5px', color: '#6E5261', marginTop: '1px', lineHeight: '1.3' } }, item.blurb)
            )
          );
        })
      )
    )
  );
}

// ---- Appointment sheet ----

// 9am is the default for a future day because clinic appointments are morning-weighted; for today
// it opens at the current time instead, so "add something for later today" does not start in the
// past. Neither is a guess the person cannot see -- the field is right there, filled in.
function calDefaultWhenTs(dateKey) {
  const todayKey = calDateKeyOf(simNow());
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) ? dateKey : todayKey;
  if (key === todayKey) return simNow();
  const p = key.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 9, 0, 0, 0).getTime();
}

function calOpenApptSheet(apptId, dateKey) {
  const existing = apptId ? (state.appointments || []).find(a => a.apptId === apptId) : null;
  calSheetNeedsFocus = true;
  calDrawerNeedsFocus = false;
  setState({
    drawerOpen: false,
    apptConfirmDelete: null,
    apptSheet: {
      apptId: existing ? existing.apptId : null,
      title: existing ? String(existing.title || '') : '',
      when: toLocalISO(existing ? existing.ts : calDefaultWhenTs(dateKey)),
      note: existing ? String(existing.note || '') : '',
      confirmRemove: false,
      busy: false,
      error: ''
    }
  });
}

function calCloseApptSheet() { calSheetNeedsFocus = false; setState({ apptSheet: null }); }

// Strict. new Date('2026-02-31T09:00') rolls silently over to 2 March in some engines, which would
// save an appointment onto a day the person never picked.
function calParseLocalISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || ''));
  if (!m) return NaN;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]), hh = Number(m[4]), mi = Number(m[5]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || hh > 23 || mi > 59) return NaN;
  const d = new Date(y, mo - 1, da, hh, mi, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return NaN;
  const t = d.getTime();
  return isFinite(t) ? t : NaN;
}

async function calSaveAppt() {
  const s = state.apptSheet;
  if (!s || s.busy) return;
  const title = String(s.title || '').trim().slice(0, CAL_TITLE_MAX);
  const note = String(s.note || '').trim().slice(0, CAL_NOTE_MAX);
  const ts = calParseLocalISO(s.when);
  if (!title) { s.error = 'Give it a name, so it is recognisable on the calendar.'; setState({ apptSheet: s }); return; }
  if (!isFinite(ts)) { s.error = 'Pick a date and a time.'; setState({ apptSheet: s }); return; }
  const wasEdit = !!s.apptId;
  const apptId = s.apptId || calNewApptId();
  s.busy = true; s.error = '';
  setState({ apptSheet: s });
  try {
    await addEntryDB({ medId: CAL_APPT_MED_ID, apptId: apptId, title: title, note: note, ts: ts, cancelled: false, dose: 'Appointment', mg: 0, loggedAt: Date.now() });
    calSheetNeedsFocus = false;
    setState({ apptSheet: null, apptConfirmDelete: null, calSelected: calDateKeyOf(ts), calCursor: calMonthKeyOf(ts) });
    setToast(wasEdit ? 'Appointment updated' : 'Appointment saved');
  } catch (err) {
    // The raw message here is a browser string that reads like the app broke. It goes to the
    // console; what she sees says what actually happened to her data.
    console.error('[calendar:save]', err);
    const cur = state.apptSheet;
    if (cur) { cur.busy = false; cur.error = "Couldn't save that. Nothing was changed — please try again."; setState({ apptSheet: cur }); }
    else setToast("Couldn't save the appointment.");
  }
}

// Append-only removal: a tombstone document, not a delete. See the block header.
async function calRemoveAppt(apptId) {
  const appt = (state.appointments || []).find(a => a.apptId === apptId);
  if (!appt) { setState({ apptConfirmDelete: null }); setToast('That appointment is no longer there.'); return; }
  const sheet = state.apptSheet;
  if (sheet && sheet.busy) return;
  if (sheet) { sheet.busy = true; sheet.error = ''; setState({ apptSheet: sheet }); }
  try {
    await addEntryDB({ medId: CAL_APPT_MED_ID, apptId: apptId, title: String(appt.title || ''), note: String(appt.note || ''), ts: appt.ts, cancelled: true, dose: 'Appointment removed', mg: 0, loggedAt: Date.now() });
    calSheetNeedsFocus = false;
    setState({ apptSheet: null, apptConfirmDelete: null });
    setToast('Appointment removed');
  } catch (err) {
    console.error('[calendar:remove]', err);
    const cur = state.apptSheet;
    if (cur) { cur.busy = false; cur.confirmRemove = false; cur.error = "Couldn't remove that. It is still on the calendar — please try again."; setState({ apptSheet: cur }); }
    else { setState({ apptConfirmDelete: null }); setToast("Couldn't remove the appointment."); }
  }
}

// Shared field styling. 16px is a hard floor on every one of these: iOS Safari zooms the page in
// when a focused field is under 16px and does not zoom back out afterwards, which leaves the app
// stuck at 1.3x with the nav off-screen. A 14px note field did exactly that in an earlier round.
function calFieldStyle(extra) {
  return Object.assign({ width: '100%', minHeight: '52px', border: '1px solid rgba(212,104,138,0.2)', borderRadius: '13px', padding: '13px 14px', fontSize: '16px', lineHeight: '1.35', background: 'rgba(255,255,255,0.72)', color: '#3D2B3A', fontFamily: 'inherit' }, extra || {});
}
function calLabelStyle() {
  return { fontSize: '11.5px', fontWeight: '700', color: '#8A6479', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' };
}

function renderApptSheet() {
  const s = state.apptSheet;
  if (!s) return null;
  const editing = !!s.apptId;
  const heading = editing ? 'Edit appointment' : 'Add appointment';
  // maxHeight + overflowY, not a taller card: at 375x812 with the keyboard up, a card that grows
  // past the viewport pushes Save below the fold with no way to reach it.
  return h('div', { onClick: (e) => { if (e.target === e.currentTarget && !s.busy) calCloseApptSheet(); }, style: { position: 'fixed', inset: '0', background: 'rgba(60,30,50,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '80', padding: '20px' } },
    h('div', { 'data-cal-sheet': editing ? 'edit' : 'add', role: 'dialog', 'aria-modal': 'true', 'aria-label': heading, tabindex: '-1', ref: (el) => calFocusOnce(el, () => calSheetNeedsFocus, () => { calSheetNeedsFocus = false; }), style: { background: 'rgba(255,245,248,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(212,104,138,0.18)', borderRadius: '22px', padding: '22px 20px', width: '320px', maxWidth: '100%', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', outline: 'none', boxShadow: '0 24px 64px rgba(120,60,90,0.18), 0 0 0 1px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.7)' } },
      h('div', { style: { fontSize: '16px', fontWeight: '800', marginBottom: '18px', textAlign: 'center', letterSpacing: '-0.01em', color: '#342530' } }, heading),

      h('div', { style: { marginBottom: '14px' } },
        h('label', { for: 'cal-appt-title', style: Object.assign({ display: 'block' }, calLabelStyle()) }, 'What is it'),
        h('input', { 'data-cal-sheet-title-input': 'true', id: 'cal-appt-title', type: 'text', value: s.title || '', maxlength: String(CAL_TITLE_MAX), placeholder: 'Oncology appointment', autocomplete: 'off',
          // Never setState from onInput: it rebuilds the tree and destroys the field being typed
          // into. State is mutated directly and the v43.3 deferredValue path in h() replays it on
          // the next legitimate render.
          onInput: (e) => { if (state.apptSheet) state.apptSheet.title = e.target.value; }, style: calFieldStyle() })
      ),

      h('div', { style: { marginBottom: '14px' } },
        h('label', { for: 'cal-appt-when', style: Object.assign({ display: 'block' }, calLabelStyle()) }, 'Date & time'),
        h('input', { 'data-cal-sheet-when-input': 'true', id: 'cal-appt-when', type: 'datetime-local', value: s.when || '', className: 'mono',
          onInput: (e) => { if (state.apptSheet) state.apptSheet.when = e.target.value; }, style: calFieldStyle({ colorScheme: 'light' }) })
      ),

      h('div', { style: { marginBottom: '14px' } },
        h('label', { for: 'cal-appt-note', style: Object.assign({ display: 'block' }, calLabelStyle()) }, 'Note (optional)'),
        h('textarea', { 'data-cal-sheet-note-input': 'true', id: 'cal-appt-note', value: s.note || '', rows: 3, maxlength: String(CAL_NOTE_MAX), placeholder: 'Where to go, who to ask for, what to bring…',
          onInput: (e) => { if (state.apptSheet) state.apptSheet.note = e.target.value; }, style: calFieldStyle({ minHeight: '84px', resize: 'vertical' }) })
      ),

      s.error ? h('div', { 'data-cal-sheet-error': 'true', role: 'alert', style: { background: 'rgba(192,69,59,0.10)', border: '1px solid rgba(192,69,59,0.32)', borderRadius: '12px', padding: '11px 13px', fontSize: '13px', lineHeight: '1.45', color: '#96382F', fontWeight: '700', marginBottom: '14px' } }, s.error) : null,

      h('div', { style: { display: 'flex', gap: '10px' } },
        h('button', Object.assign({ 'data-cal-sheet-cancel': 'true', type: 'button', onClick: calCloseApptSheet,
          style: { flex: '1', minHeight: '50px', borderRadius: '13px', border: '1px solid rgba(212,104,138,0.22)', background: 'rgba(255,255,255,0.6)', color: '#7A5568', fontSize: '15px', fontWeight: '700' } },
          // Spread, never `disabled: s.busy ? 'disabled' : null` -- h() setAttribute's it and
          // disabled="null" disables the control just as thoroughly as disabled="disabled".
          s.busy ? { disabled: 'disabled' } : {}), 'Cancel'),
        h('button', Object.assign({ 'data-cal-sheet-save': 'true', type: 'button', onClick: calSaveAppt,
          style: { flex: '1', minHeight: '50px', borderRadius: '13px', background: s.busy ? '#9C6079' : '#AA5375', color: '#fff', fontSize: '15px', fontWeight: '700', boxShadow: 'inset 0 -2px 0 rgba(150,60,90,0.35)' } },
          s.busy ? { disabled: 'disabled' } : {}), s.busy ? 'Saving…' : 'Save')
      ),

      editing ? h('div', { style: { marginTop: '16px', paddingTop: '14px', borderTop: '1px solid rgba(212,104,138,0.16)' } },
        s.confirmRemove
          ? h('div', null,
              h('div', { style: { fontSize: '12.5px', color: '#96382F', fontWeight: '700', lineHeight: '1.4', marginBottom: '10px' } }, 'Take this off the calendar? The record of it stays in your history.'),
              h('div', { style: { display: 'flex', gap: '10px' } },
                h('button', Object.assign({ 'data-cal-sheet-remove-keep': 'true', type: 'button', onClick: () => { const c = state.apptSheet; if (c) { c.confirmRemove = false; setState({ apptSheet: c }); } },
                  style: { flex: '1', minHeight: '46px', borderRadius: '12px', border: '1px solid rgba(212,104,138,0.22)', background: 'rgba(255,255,255,0.6)', color: '#7A5568', fontSize: '14px', fontWeight: '700' } }, s.busy ? { disabled: 'disabled' } : {}), 'Keep it'),
                h('button', Object.assign({ 'data-cal-sheet-remove-confirm': 'true', type: 'button', onClick: () => calRemoveAppt(s.apptId),
                  style: { flex: '1', minHeight: '46px', borderRadius: '12px', background: '#C0453B', color: '#fff', fontSize: '14px', fontWeight: '800' } }, s.busy ? { disabled: 'disabled' } : {}), s.busy ? 'Removing…' : 'Remove it')
              )
            )
          : h('button', Object.assign({ 'data-cal-sheet-remove': 'true', type: 'button', onClick: () => { const c = state.apptSheet; if (c) { c.confirmRemove = true; setState({ apptSheet: c }); } },
              style: { width: '100%', minHeight: '46px', borderRadius: '12px', border: '1px solid rgba(192,69,59,0.28)', background: 'rgba(192,69,59,0.06)', color: '#A5443C', fontSize: '14px', fontWeight: '700' } }, s.busy ? { disabled: 'disabled' } : {}), 'Remove appointment')
      ) : null
    )
  );
}

// ---- Calendar view ----

function renderCalendarView(now) {
  const todayKey = calDateKeyOf(now);
  let cursor = state.calCursor;
  if (!/^\d{4}-\d{2}$/.test(String(cursor || ''))) cursor = todayKey.slice(0, 7);
  // The selected day is independent of the month on screen, so paging through months to look
  // ahead does not throw away what you had selected.
  let selected = state.calSelected;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(selected || ''))) selected = todayKey;

  const cy = Number(cursor.slice(0, 4)), cm = Number(cursor.slice(5, 7));
  const first = new Date(cy, cm - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const monthLabel = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const byDay = calApptsByDay();
  const keyOf = (d) => cursor + '-' + calPad2(d);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // 44px is the tap-target floor and it is measured, not assumed. The seven columns live inside
  // <main>'s 16px padding, so the grid itself carries NO horizontal padding and a 2px gap:
  // (375 - 32 - 12) / 7 = 47.3px on the narrowest supported phone. The earlier 10px section
  // padding with a 3px gap produced (375 - 32 - 20 - 18) / 7 = 43.57px -- under the floor, on the
  // control the whole screen exists to be tapped.
  const dayCell = (d) => {
    if (d === null) return h('div', { 'aria-hidden': 'true' });
    const ds = keyOf(d);
    const list = byDay.get(ds) || [];
    const isToday = ds === todayKey;
    const isSel = ds === selected;
    const long = new Date(cy, cm - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    return h('button', {
      'data-cal-day-cell': ds,
      'data-cal-day-count': String(list.length),
      type: 'button',
      'aria-pressed': isSel ? 'true' : 'false',
      'aria-label': long + (list.length ? ', ' + list.length + ' appointment' + (list.length === 1 ? '' : 's') : ', nothing scheduled'),
      onClick: () => setState({ calSelected: ds, apptConfirmDelete: null }),
      style: { minHeight: '56px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '4px', padding: '7px 2px 6px', borderRadius: '12px', background: isSel ? '#AA5375' : (isToday ? 'rgba(170,83,117,0.14)' : 'transparent'), border: (isToday && !isSel) ? '1px solid rgba(170,83,117,0.45)' : '1px solid transparent' }
    },
      h('span', { style: { fontSize: '14px', fontWeight: (isSel || isToday) ? '800' : '600', color: isSel ? '#fff' : '#3D2B3A', lineHeight: '1' } }, String(d)),
      list.length
        ? h('span', { 'aria-hidden': 'true', style: { display: 'flex', gap: '2px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '34px' } },
            ...list.slice(0, 3).map(() => h('span', { style: { width: '11px', height: '3px', borderRadius: '2px', background: isSel ? 'rgba(255,255,255,0.9)' : '#AA5375' } })),
            list.length > 3 ? h('span', { style: { fontSize: '8.5px', fontWeight: '800', lineHeight: '1', color: isSel ? '#fff' : '#8E3D61' } }, '+' + (list.length - 3)) : null
          )
        : h('span', { 'aria-hidden': 'true', style: { display: 'block', height: '3px' } })
    );
  };

  const dayList = (byDay.get(selected) || []);
  const sp = selected.split('-').map(Number);
  const selectedLabel = new Date(sp[0], sp[1] - 1, sp[2]).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + (selected === todayKey ? ' · Today' : '');

  const apptRow = (appt) => {
    const removing = state.apptConfirmDelete === appt.apptId;
    return h('div', { 'data-cal-appt-row': appt.apptId, style: { borderTop: '1px solid rgba(212,104,138,0.12)' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px' } },
        h('span', { 'aria-hidden': 'true', style: { flexShrink: '0', width: '9px', height: '9px', borderRadius: '50%', background: '#AA5375', marginTop: '6px' } }),
        h('div', { style: { flex: '1', minWidth: '0' } },
          h('div', { style: { fontSize: '15px', fontWeight: '800', color: '#342530', letterSpacing: '-0.01em', wordBreak: 'break-word', overflowWrap: 'anywhere' } }, appt.title),
          h('div', { className: 'mono', style: { fontSize: '12px', color: '#6E5261', marginTop: '3px', fontWeight: '600' } }, fmtTime(appt.ts)),
          appt.note ? h('div', { style: { fontSize: '12.5px', color: '#5B4353', marginTop: '4px', lineHeight: '1.4', wordBreak: 'break-word', overflowWrap: 'anywhere' } }, appt.note) : null
        ),
        h('div', { style: { display: 'flex', gap: '6px', flexShrink: '0' } },
          h('button', { 'data-cal-appt-edit': appt.apptId, type: 'button', onClick: () => calOpenApptSheet(appt.apptId, null), 'aria-label': 'Edit ' + appt.title, style: { width: '44px', height: '44px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(170,83,117,0.10)', color: '#8E3D61' } }, appIcon('edit', 16)),
          h('button', { 'data-cal-appt-delete': appt.apptId, type: 'button', onClick: () => setState({ apptConfirmDelete: removing ? null : appt.apptId }), 'aria-label': (removing ? 'Cancel removing ' : 'Remove ') + appt.title, style: { width: '44px', height: '44px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: removing ? 'rgba(192,69,59,0.16)' : 'rgba(192,69,59,0.07)', color: '#A5443C' } }, appIcon('trash', 16))
        )
      ),
      removing ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px 12px' } },
        h('span', { style: { flex: '1', fontSize: '12px', color: '#96382F', fontWeight: '700', lineHeight: '1.35' } }, 'Take this off the calendar?'),
        h('button', { 'data-cal-appt-delete-keep': appt.apptId, type: 'button', onClick: () => setState({ apptConfirmDelete: null }), style: { minHeight: '44px', padding: '0 14px', borderRadius: '11px', border: '1px solid rgba(212,104,138,0.22)', background: 'rgba(255,255,255,0.6)', color: '#7A5568', fontSize: '13px', fontWeight: '700' } }, 'Keep'),
        h('button', { 'data-cal-appt-delete-confirm': appt.apptId, type: 'button', onClick: () => calRemoveAppt(appt.apptId), style: { minHeight: '44px', padding: '0 14px', borderRadius: '11px', background: '#C0453B', color: '#fff', fontSize: '13px', fontWeight: '800' } }, 'Remove')
      ) : null
    );
  };

  const cardStyle = { background: 'rgba(255,255,255,0.63)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(212,104,138,0.16)', boxShadow: '0 4px 18px rgba(180,130,150,0.09), inset 0 1px 0 rgba(255,255,255,0.75)' };

  return [
    h('section', { 'data-cal-view-header': 'true' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' } },
        // Deliberately compact. Measured at 375x812, the first draft's eyebrow row plus a
        // four-line description pushed the day panel -- the part she actually reads -- 70px below
        // the fold, so the screen opened on a month grid and nothing else.
        h('div', { style: { minWidth: '0' } },
          h('h1', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '22px', fontWeight: '800', letterSpacing: '-0.03em', color: '#342530', lineHeight: '1.1' } },
            h('span', { style: { color: '#AA5375', display: 'inline-flex' } }, appIcon('calMonth', 20)),
            'Appointments'
          ),
          h('div', { style: { fontSize: '12.5px', color: '#6E5261', marginTop: '5px', lineHeight: '1.4', maxWidth: '46ch' } }, 'Scans, labs and clinic visits. Never shown in the spreadsheet or the printable record.')
        ),
        h('button', { 'data-cal-add-button': 'true', type: 'button', onClick: () => calOpenApptSheet(null, selected), style: { flexShrink: '0', minHeight: '44px', padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '13px', background: '#AA5375', color: '#fff', fontSize: '13px', fontWeight: '800', boxShadow: 'inset 0 -2px 0 rgba(150,60,90,0.35)' } }, appIcon('plus', 16), 'Add')
      )
    ),

    h('section', { 'data-cal-month-section': 'true', style: Object.assign({ borderRadius: '18px', padding: '12px 0 10px' }, cardStyle) },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '0 10px', marginBottom: '10px' } },
        h('button', { 'data-cal-prev-month': 'true', type: 'button', onClick: () => setState({ calCursor: calShiftMonth(cursor, -1) }), 'aria-label': 'Previous month', style: { width: '44px', height: '44px', flexShrink: '0', borderRadius: '12px', background: 'rgba(170,83,117,0.10)', color: '#8E3D61', fontSize: '18px', fontWeight: '800' } }, '‹'),
        h('div', { 'data-cal-month-label': 'true', style: { fontSize: '15px', fontWeight: '800', color: '#342530', letterSpacing: '-0.015em', textAlign: 'center', minWidth: '0' } }, monthLabel),
        h('button', { 'data-cal-next-month': 'true', type: 'button', onClick: () => setState({ calCursor: calShiftMonth(cursor, 1) }), 'aria-label': 'Next month', style: { width: '44px', height: '44px', flexShrink: '0', borderRadius: '12px', background: 'rgba(170,83,117,0.10)', color: '#8E3D61', fontSize: '18px', fontWeight: '800' } }, '›')
      ),
      h('div', { 'data-cal-weekday-row': 'true', 'aria-hidden': 'true', style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px', marginBottom: '3px' } },
        ...CAL_WEEKDAY_LETTERS.map(l => h('div', { style: { textAlign: 'center', fontSize: '11.5px', fontWeight: '700', color: '#8A6479', padding: '2px 0' } }, l))
      ),
      h('div', { 'data-cal-month-grid': 'true', role: 'grid', 'aria-label': monthLabel, style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '2px' } },
        ...cells.map(dayCell)
      )
    ),

    h('section', { 'data-cal-day-panel': 'true', style: Object.assign({ borderRadius: '18px', overflow: 'hidden' }, cardStyle) },
      h('div', { style: { padding: '13px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
        h('div', { 'data-cal-day-panel-label': 'true', style: { fontSize: '13.5px', fontWeight: '800', color: '#342530', minWidth: '0' } }, selectedLabel),
        h('button', { 'data-cal-day-add-button': 'true', type: 'button', onClick: () => calOpenApptSheet(null, selected), 'aria-label': 'Add an appointment on ' + selectedLabel, style: { flexShrink: '0', minHeight: '44px', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: '5px', borderRadius: '12px', background: 'rgba(170,83,117,0.10)', border: '1px solid rgba(170,83,117,0.28)', color: '#8E3D61', fontSize: '12.5px', fontWeight: '800' } }, appIcon('plus', 14), 'Add')
      ),
      dayList.length
        ? h('div', null, ...dayList.map(apptRow))
        : h('div', { 'data-cal-day-empty': 'true', style: { padding: '14px 16px 22px', textAlign: 'center', fontSize: '13px', color: '#6E5261' } }, 'Nothing scheduled this day.')
    )
  ];
}

"""

B9 = FEATURE_BLOCK + A9

EDITS = [
    ("1: subscribeEntries splits appointments out of state.entries", A1, B1),
    ("2: state gains the calendar fields", A2, B2),
    ("3: icon table gains calMenu / calMonth / calClose", A3, B3),
    ("4: header gains the 44px menu button", A4, B4),
    ("5: renderContent dispatches the calendar view", A5, B5),
    ("6: render() mounts the drawer and the appointment sheet", A6, B6),
    ("7: clock tick does not repaint under an open dialog", A7, B7),
    ("8: live snapshot is deferred under an open appointment sheet", A8, B8),
    ("9: feature block inserted above the export block", A9, B9),
]


def fail(msg):
    sys.stderr.write("\n" + "!" * 88 + "\n")
    sys.stderr.write("REFUSING TO PATCH: " + msg + "\n")
    sys.stderr.write("Nothing was written. index.html is untouched.\n")
    sys.stderr.write("!" * 88 + "\n")
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="/home/claude/wm",
                    help="path to the care-tracker checkout (default: /home/claude/wm)")
    ap.add_argument("--check", action="store_true", help="verify only, write nothing")
    args = ap.parse_args()

    path = os.path.join(args.repo, "index.html")
    if not os.path.isfile(path):
        fail("no index.html at " + path)

    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    digest = hashlib.md5(src.encode("utf-8")).hexdigest()
    print("calendar-patch.py")
    print("  target : " + path)
    print("  md5    : " + digest + ("  (expected v43.3 base)" if digest == BASE_MD5 else ""))

    if SENTINEL in src:
        print("  status : ALREADY APPLIED — the calendar feature block is present.")
        print("  result : nothing to do, no changes written. (idempotent)")
        return 0

    if digest != BASE_MD5:
        # Not fatal: another patch may legitimately have landed first. The anchors are the real
        # contract and they are checked below.
        print("  note   : md5 differs from the recorded v43.3 base (" + BASE_MD5 + ").")
        print("           Continuing — the anchors below are the actual contract.")

    # --- pre-flight: nothing this patch introduces may already exist -------------------------
    clashes = [n for n in NEW_IDENTIFIERS if n in src] + [n for n in NEW_HOOKS if n in src]
    if clashes:
        fail("the base file already contains identifiers/hooks this patch introduces: "
             + ", ".join(sorted(set(clashes)))
             + "\n  Adding them would shadow or silently override whatever owns them today "
               "(a duplicate object key is legal JS: last one wins, no error).")
    print("  preflight: %d identifiers and %d data-hooks checked, none already present."
          % (len(NEW_IDENTIFIERS), len(NEW_HOOKS)))

    # --- anchors ------------------------------------------------------------------------------
    out = src
    for label, anchor, replacement in EDITS:
        n = out.count(anchor)
        if n != 1:
            fail("anchor for edit %s matched %d times, expected exactly 1.\n"
                 "  ---- anchor ----\n%s\n  ----------------\n"
                 "  The base file has moved. Re-derive the anchor rather than loosening it."
                 % (label, n, anchor))
        out = out.replace(anchor, replacement, 1)
        print("  ok  edit %s" % label)

    # --- post-conditions ----------------------------------------------------------------------
    if "const APP_VERSION = 'v43.3';" not in out:
        fail("APP_VERSION is no longer intact. This patch must never touch it.")
    if out.count("function allExportEntries()") != 1 or \
       "return (state.entries || []).concat(state.chemoDates || []);" not in out:
        fail("allExportEntries() was modified. Appointments must stay out of the CSV and report.")
    if "state.appointments" not in out or "CAL_APPT_MED_ID" not in out:
        fail("post-condition: the feature block did not land.")
    # A conditional attribute passed as null renders as the string "null" and, for these
    # attributes, that is truthy to the browser. Four separate Blockers on this project.
    # Whole-line // comments are stripped first so the trap can be DOCUMENTED next to the code
    # that avoids it; only real code is inspected. (`https://` is untouched: the pattern requires
    # the comment to start the line.)
    import re as _re
    code = _re.sub(r"(?m)^[ \t]*//.*$", "", out)
    for bad in ["disabled: null", "checked: null", "selected: null", "readonly: null",
                "hidden: null", "'aria-current': null", "'aria-pressed': null"]:
        if bad in code:
            fail("the h() null-attribute trap is present in the output: " + bad)
    # The ternary form is the one that actually ships: `disabled: busy ? 'disabled' : null`.
    ternary = _re.findall(
        r"\b'?(?:disabled|checked|selected|readonly|hidden|aria-current|aria-pressed|inert)'?\s*:\s*[^,}\n]*\b(?:null|undefined)\b",
        code)
    if ternary:
        fail("a conditional attribute can evaluate to null/undefined; h() will setAttribute it: "
             + " | ".join(ternary[:4]))

    if args.check:
        print("  status : NOT applied; all 9 anchors matched and all post-conditions hold.")
        print("  result : --check given, nothing written.")
        return 0

    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    new_digest = hashlib.md5(out.encode("utf-8")).hexdigest()
    print("  written: %s" % path)
    print("  new md5: %s" % new_digest)
    print("  status : APPLIED — 9 anchored edits, +%d bytes." % (len(out) - len(src)))
    print("  note   : sw.js was not opened. APP_VERSION unchanged (v43.3).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
