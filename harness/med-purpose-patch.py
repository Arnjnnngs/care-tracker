#!/usr/bin/env python3
"""
med-purpose-patch.py -- v74. Every medication says what it is for.

Aaron, 2026-09-08: "I've asked before to have something pulled from another site to say what the med
is intended for... it wasn't webMD, it was something else that couldn't sue me for using their
stuff." And: it never shipped, and the ask was never written down in any of the three repos.

ON THE SOURCE, because it was his actual worry. What cannot be copied is somebody's PROSE; the fact
that ondansetron prevents nausea is not ownable by anyone. So this ships SHORT ORIGINAL sentences
written for a caregiver -- nothing is copied from WebMD, from a drug label, or from any site -- and
the app cites nothing, because a citation to a document nobody here read would be a lie. US federal
sources (openFDA, DailyMed, MedlinePlus) are public domain and would also have been safe to quote;
every one of them is blocked by this sandbox's network policy, which is why the text is original
rather than quoted. If Aaron later wants the exact federal label wording, that is a data refresh
into the same table, not a rebuild.

WHAT IT DOES
  * MED_PURPOSE: one plain sentence per medication the app ships, KEYED BY ID rather than added to
    DEFAULT_MEDS. This matters: every device already has its medication list saved in localStorage
    and Firestore from before v74, and those saved records carry no new field. A lookup by id gives
    every existing phone the text on the next load with no migration and nothing to re-enter.
  * purposeOf(med) prefers what the caregiver typed, falls back to the built-in line, else nothing.
    A medication with no purpose shows no empty label.
  * "What it's for" is a real field in the medication editor, so a medication Aaron adds later can
    carry its own line. It is optional and free text.
  * The Meds screen shows it under the generic name. ONE honest disclaimer sits at the top of that
    screen: general information, not medical advice.

WHAT IT DELIBERATELY DOES NOT DO
  * It does not touch the Home quick-log cards. Those are the screen a caregiver taps at 2am under
    time pressure, and every extra line there is a line between her and the dose button.
  * It does not fetch anything at runtime. A live lookup would send this patient's medication list
    to a third-party server from an app that has no login, and would fail exactly when she is
    offline. The text is in the file.
  * It states no dose, no schedule and no advice. Only what the medication is generally for.

Usage:  python3 harness/med-purpose-patch.py [--base outputs/rollback-v73/index.html] [--out index.html]
The version stamp lives INSIDE this patch: it refuses a base that is not v73 and emits v74.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FROM_V, TO_V = 'v73', 'v74'

args = sys.argv[1:]
base = args[args.index('--base') + 1] if '--base' in args else os.path.join(REPO, 'outputs', 'rollback-' + FROM_V, 'index.html')
out = args[args.index('--out') + 1] if '--out' in args else os.path.join(REPO, 'index.html')
sw_in = os.path.join(os.path.dirname(base), 'sw.js')
sw_out = os.path.join(os.path.dirname(out), 'sw.js')

s = open(base, encoding='utf-8').read()
m = re.search(r"const APP_VERSION = '([^']+)';", s)
if not m or m.group(1) != FROM_V:
    sys.exit('REFUSING: base is %s, this patch transforms %s -> %s' % (m.group(1) if m else '?', FROM_V, TO_V))


def rep(old, new, n=1):
    global s
    c = s.count(old)
    if c != n:
        sys.exit('REFUSING: expected %d match(es), found %d for:\n%s' % (n, c, old[:200]))
    s = s.replace(old, new)


# ---- 1. the table, and the reader that prefers what the caregiver typed -----------------------
rep("""function nameOf(id) {""", """// ---- WHAT EACH MEDICATION IS FOR (v74) ----
// Short original sentences, written for a caregiver rather than a clinician. Nothing is copied from
// any site or label -- see this patch's header on why that is the safe answer rather than the risky
// one. No dose, no schedule, no advice: only what the medication is generally used for.
// KEYED BY ID so a device whose saved medication list predates v74 gets the text with no migration.
// TWO SENTENCES WERE CHANGED ON THE AUDITOR'S CLINICAL READING, and both changes matter more than
// they look. Tylenol said "brings down a fever": true of the drug, and the one sentence here likely
// to change what a caregiver does at 2am in the wrong direction -- a fever during chemo is a thing
// to report, not to suppress, and this same app tracks Temperature. Senokot said "a GENTLE
// laxative": senna is a stimulant laxative, and "gentle" was an editorial claim rather than a fact.
// Dexamethasone said "given around chemo", which is a schedule written in words and slipped past a
// guard that only looks for digits.
// LIDOCAINE said "a numbing CREAM ... on the skin". True here -- this app's lidocaine is defined as
// the topical cream and the card's own subtitle says so -- but the form and the body site are
// already on the card, and ChemoWell's audit blocked its own copy of this line because there the
// same name may be the viscous rinse for mouth sores or a patch. One wording across all three apps,
// and the guard stays absolute rather than carrying an exemption that would have to be re-argued
// every time somebody edits the table.
const MED_PURPOSE = {
  'dexamethasone': 'A steroid that calms nausea, swelling and allergic reactions.',
  'tylenol': 'Eases pain.',
  'tylenol-liquid': 'Eases pain.',
  'zofran': 'Prevents and settles nausea and vomiting.',
  'compazine': 'Settles nausea and vomiting.',
  'morphine': 'A strong pain reliever for moderate to severe pain.',
  'lidocaine': 'Numbs the area where it is used.',
  'protonix': 'Lowers stomach acid, which protects the stomach and eases reflux.',
  'buspirone': 'Eases anxiety.',
  'paroxetine': 'Treats depression, and is also used for anxiety.',
  'iron': 'An iron supplement, for low iron levels.',
  'senokot': 'A laxative for constipation.',
  'imodium': 'Slows the gut down to control diarrhea.'
};
// What the caregiver typed wins; the built-in line is the fallback; otherwise nothing at all --
// never an empty label under a medication nobody has described.
// hasOwnProperty, NOT a bare index. MED_PURPOSE is a plain object, so MED_PURPOSE['constructor']
// reads back Object.prototype.constructor -- a FUNCTION, truthy and not a string -- and h() then
// throws inside the Meds list render. The medication persists, so every later render throws too:
// the Meds screen comes up with ZERO cards, which is the only place edit and delete live, and the
// broken list publishes to the other phone. `constructor` is the one prototype key that survives
// this app's id slug. nameOf() thirteen lines below carries the identical guard for the identical
// reason, and it was added after this exact bug printed the literal string "Object" as a
// medication name.
function purposeOf(med) {
  if (!med) return '';
  const typed = String(med.purpose || '').trim();
  if (typed) return typed;
  const built = Object.prototype.hasOwnProperty.call(MED_PURPOSE, med.id) ? MED_PURPOSE[med.id] : '';
  return typeof built === 'string' ? built : '';
}
function nameOf(id) {""")

# ---- 2. the editor carries it, so a medication added later can have its own line ---------------
# medicationFormFrom() SEEDS THE FORM. It did not carry `purpose`, so opening any medication's
# editor and saving would have written purpose:'' over whatever was there -- the v43.3 failure
# exactly, where correcting one field in this same editor silently disabled that medication's
# missed-dose alerts and the app said "updated". Seeded with purposeOf() rather than base.purpose so
# the box shows what the screen shows: a built-in line is visible and editable rather than an empty
# box under text the caregiver can see.
#
# CORRECTED AFTER THE ZERO DAY AUDIT BLOCKED THE FIRST BUILD. Seeding the box with purposeOf() made
# "deliberately blank" and "never set" the same state twice over: clearing the box and saving did
# NOTHING (the app said "updated" and the built-in sentence stayed), and saving ANY edit froze that
# day's wording into the patient's stored config and published it by medsync -- so a later
# correction to a sentence that turned out to be wrong would never reach a medication anyone had
# edited. The built-in line is a PLACEHOLDER now: unset stays unset, typing overrides, clearing
# returns to the built-in, and nothing is ever frozen.
rep("""    name: base.name || '',
    sub: base.sub || '',""",
    """    name: base.name || '',
    sub: base.sub || '',
    purpose: base.purpose || '',""")
rep("""    sub: String(form.sub || '').trim(),""",
    """    sub: String(form.sub || '').trim(),
    purpose: String(form.purpose || '').trim(),""")
rep("""      h('label', null, fieldLabel('Generic name'), formInput({ value: form.sub, placeholder: 'Generic name', onInput: event => updateMedicationForm('sub', event.target.value) })),""",
    """      h('label', null, fieldLabel('Generic name'), formInput({ value: form.sub, placeholder: 'Generic name', onInput: event => updateMedicationForm('sub', event.target.value) })),
      h('label', { style: { gridColumn: '1 / -1' } }, fieldLabel('What it\\u2019s for'), formInput({ value: form.purpose, placeholder: (purposeOf({ id: state.medEditor && state.medEditor.sourceId }) || 'For example: settles nausea'), onInput: event => updateMedicationForm('purpose', event.target.value) })),""")

# ---- Home's quick-log card: a pasted name must not carry the tab bar off the screen ------------
# PASS 6 measured it and PASS 7 proved the first two fixes did not reach it. Paste a long pharmacy
# name into a medication's name and Home reached 1019px on a 320px phone -- and the BOTTOM TAB BAR
# stretched with it, so the Meds tab a caregiver would use to go back and undo the paste was no
# longer on the screen. The paste that causes the problem removes the only route to the fix.
# It is pre-existing -- app-v71 measures the same -- and this release is deliberately widened to take
# it, because "she cannot navigate back" is not a defect to queue behind a copy change.
# TWO CAUSES, and overflow-wrap could reach NEITHER of them:
#   * the name sits under `white-space: nowrap`, which disables wrapping outright, and it carried no
#     overflow handling to truncate instead -- so it simply grew.
#   * the dose buttons are `flex: 0 0 auto` with the medication name inside them, so they refuse to
#     shrink and had no max width to stop at.
# That is why the global rule of pass 6 "worked" on Home while breaking two other screens: it was
# never the property that fixed this. Wrapping the name and bounding the buttons is.
rep("""          h('div', { style: { fontSize: '15.5px', fontWeight: '800', letterSpacing: '-0.01em', color: '#342530', whiteSpace: 'nowrap' } }, med.name),""",
    """          h('div', { style: { fontSize: '15.5px', fontWeight: '800', letterSpacing: '-0.01em', color: '#342530', overflowWrap: 'anywhere' } }, med.name),""")
rep("""flex: '0 0 auto', minWidth: '0', minHeight: '32px'""",
    """flex: '0 0 auto', minWidth: '0', maxWidth: '100%', minHeight: '32px'""", 3)
# ---- the wrapping rule, ON EVERY PLACE THE CAREGIVER'S OWN TEXT IS RENDERED --------------------
# Four rounds of audit went at this one property and the history is the argument for where it lands.
#   pass 4 put it on the purpose line          -> the note and the dose labels still overflowed
#   pass 5 put it on the medication card       -> Home still overflowed, and a long pasted name
#                                                 stretched the bottom tab bar off the screen, so the
#                                                 Meds tab needed to undo the paste was unreachable
#   pass 6 put it on `*` in the CSS reset      -> BROKE TWO SCREENS. overflow-wrap:anywhere changes
#                                                 MIN-CONTENT SIZING, so flex items shrank to about
#                                                 one character: Home's hospital-stay banner went
#                                                 from 4 lines to 32 with words split mid-syllable,
#                                                 and the In-Patient heading rendered as
#                                                 "IN-PATIEN / T / STATU / S". The overflow scan
#                                                 called it CLEAN throughout, because the scan
#                                                 measures WIDTH and that damage is vertical.
# The property that fixes Home is the one that breaks those screens, because `*` also reaches the
# app's OWN fixed labels. So it is scoped again -- but to the CLASS rather than to whichever
# container the last audit named: the three places that render a string a caregiver typed or pasted.
# The medication card on Meds (name, generic name, purpose, note, dose summary), the quick-log cards
# on Home, and the grouped-medications card. Nothing else in the app renders caregiver-entered text.
rep("""    return h('article', { style: { background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(212,104,138,0.16)', borderRadius: '17px', padding: '13px', boxShadow: '0 3px 16px rgba(180,130,150,0.09), inset 0 1px 0 rgba(255,255,255,0.75)' } },""",
    """    return h('article', { style: { background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(212,104,138,0.16)', borderRadius: '17px', padding: '13px', overflowWrap: 'anywhere', boxShadow: '0 3px 16px rgba(180,130,150,0.09), inset 0 1px 0 rgba(255,255,255,0.75)' } },""")
rep("""    quickLogOpen ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '8px', marginTop: '8px' } }, ...medCards) : null""",
    """    quickLogOpen ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '8px', marginTop: '8px', overflowWrap: 'anywhere' } }, ...medCards) : null""")
rep("""  return h('section', null,
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },""",
    """  return h('section', { style: { overflowWrap: 'anywhere' } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },""")
# ---- 3. the Meds screen shows it under the generic name ---------------------------------------
rep("""          h('div', { style: { fontSize: '12px', color: '#6E5261', fontWeight: '600', marginTop: '1px' } }, med.sub || 'No generic name')
        ),""",
    """          h('div', { style: { fontSize: '12px', color: '#6E5261', fontWeight: '600', marginTop: '1px' } }, med.sub || 'No generic name'),
          purposeOf(med) ? h('div', { 'data-med-purpose': med.id, style: { fontSize: '12.5px', color: '#5F4A56', fontWeight: '500', marginTop: '4px', lineHeight: '1.35' } }, purposeOf(med)) : null
        ),""")

# ---- 4. one honest line on the screen that now carries medical text ----------------------------
# The app is stating what medications are for. That earns exactly one sentence saying what this text
# is and is not -- said once, at the top of the list, not repeated under all thirteen cards.
rep("""    h('div', { 'data-tour-meds': 'true', style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards)""",
    """    // ONLY when at least one medication actually carries a line. ChemoWell's audit found this
    // notice printing above a list with no lines in it -- the app describing something that is not
    // on the screen. Not reachable here today with thirteen defaults, but a caregiver can delete
    // medications, and the sibling app proved the shape of the bug.
    sortedMeds.some(m => purposeOf(m)) ? h('div', { 'data-med-disclaimer': 'true', style: { fontSize: '11.5px', color: '#7D6974', lineHeight: '1.4', margin: '2px 0 10px' } },
      'Where a medication has a line under it, that is general information, not medical advice. Her care team is the answer for anything specific.') : null,
    h('div', { 'data-tour-meds': 'true', style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, ...cards)""")

if "const APP_VERSION = '%s';" % FROM_V not in s: sys.exit('REFUSING: version stamp missing')
rep("const APP_VERSION = '%s';" % FROM_V, "const APP_VERSION = '%s';" % TO_V)
rep("""  { v: 'v73', date: 'Sep 8, 2026', title: 'Removing a corrected weight no longer brings the old number back',""",
    """  { v: 'v74', date: 'Sep 8, 2026', title: 'Every medication now says what it is for',
    points: [
      'The Meds screen shows a short line under each medication saying what it is generally used for \\u2014 "settles nausea and vomiting", "lowers stomach acid".',
      'When you add or edit a medication there is a "What it\\u2019s for" box, so anything you add later can carry its own line.',
      'It is general information, not medical advice, and it never mentions a dose. Her care team is still the answer for anything specific.'
    ] },
  { v: 'v73', date: 'Sep 8, 2026', title: 'Removing a corrected weight no longer brings the old number back',""")

open(out, 'w', encoding='utf-8').write(s)

sw = open(sw_in, encoding='utf-8').read()
if "const CACHE = 'caretracker-%s';" % FROM_V not in sw: sys.exit('REFUSING: sw.js base is not %s' % FROM_V)
open(sw_out, 'w', encoding='utf-8').write(sw.replace("const CACHE = 'caretracker-%s';" % FROM_V, "const CACHE = 'caretracker-%s';" % TO_V))
print('patched %s -> %s: %s and %s' % (FROM_V, TO_V, out, sw_out))
