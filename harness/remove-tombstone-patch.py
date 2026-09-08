#!/usr/bin/env python3
"""
remove-tombstone-patch.py -- v73. Removing a CORRECTED weight or paracentesis must not bring the
wrong number back.

BOTH v72 auditors named this, and neither could block on it because it is older than v72 (v67/v69):

  Home's journal and History show raw documents. On a weight or paracentesis that has been CORRECTED,
  the row standing there is the correction, and its Remove button called removeEntry(e.id) -- a hard
  delete of that one document. Inside 48 hours the rules allow it, so the delete SUCCEEDS and the
  correction disappears -- which hands the group back to the document it superseded. She removes a
  reading and the OLD, WRONG number returns, on the screen a clinician reads a trend off. Past 48
  hours the same tap is refused and does nothing at all.

  Second, smaller: `weightSuperseded` was added to History's chip in v72 but never to removeBtn, so a
  superseded weight ORIGINAL still offered a Remove that deletes a document nothing was reading.

THE FIX, and it is small because the machinery already exists: route these two types to the
tombstone functions the report screens already use (removeWeightReading / removeParacentesis, both
append-only since v69/v52), and hide the button on a row that no longer stands.

  * removeEntryFor() sends a weight to removeWeightReading(group) and a paracentesis to
    removeParacentesis(group) WHEN that group is live. A tombstone kills the whole group, which is
    what "remove this reading" has always meant on the report screens -- the two paths now agree.
  * If the group is NOT in the resolved set -- an unusable value weightResolvedFrom() skips, a
    corrupt document -- it falls through to the old delete, so the button can never become a silent
    no-op. Inside 48 hours that delete still works; outside, the button was already hidden.
  * removeBtn() also hides on a superseded weight.

NOTHING HERE CALLS removeEntryDB ON A CORRECTION. pm.py's delete ratchet pins the shapes that remain.

Usage:  python3 harness/remove-tombstone-patch.py [--base outputs/rollback-v72/index.html] [--out index.html]
The version stamp lives INSIDE this patch: it refuses a base that is not v72 and emits v73.
"""
import re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FROM_V, TO_V = 'v72', 'v73'

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


# ---- 1. Remove routes a corrected weight or paracentesis to its tombstone --------------------
rep("""async function removeEntryFor(e) {
  if (e.medId === 'bowel_movement' || e.medId === 'appetite') return removeDailyAnswer(e);
  if (e.medId && e.medId.indexOf('symptom_') === 0) return removeSymptom(symptomKey(e));
  return removeEntry(e.id);
}""", """// The group key each resolver uses, so a row rendered raw can be matched to its live group.
function weightKey(d) { return (typeof d.weightId === 'string' && d.weightId) ? d.weightId : ('doc:' + String(d.id)); }
function paraKey(d) { return (typeof d.paraId === 'string' && d.paraId) ? d.paraId : ('doc:' + String(d.id)); }
async function removeEntryFor(e) {
  if (e.medId === 'bowel_movement' || e.medId === 'appetite') return removeDailyAnswer(e);
  if (e.medId && e.medId.indexOf('symptom_') === 0) return removeSymptom(symptomKey(e));
  // A CORRECTED reading's row IS the correction. Deleting that one document hands the group back to
  // the wrong number it replaced -- inside 48h the delete succeeds, so this really happened. The
  // tombstone removes the whole group, which is what the report screens' Remove has always done.
  if (e.medId === 'weight') {
    const gid = weightKey(e);
    if (weightResolved().some(x => x.weightId === gid)) return removeWeightReading(gid);
  }
  if (e.medId === PARA_MED_ID) {
    const gid = paraKey(e);
    if (paracentesisResolved().some(x => x.paraId === gid)) return removeParacentesis(gid);
  }
  // Not in the resolved set (an unusable value the resolver skips, a corrupt document): fall through
  // rather than become a button that does nothing. Inside 48h this delete still works.
  return removeEntry(e.id);
}""")

# ---- 2. a superseded weight row has nothing to remove either ----------------------------------
rep("""  if (e.cancelled || dailySuperseded(e) || symptomSuperseded(e) || paraSuperseded(e)) return null; // a row that no longer stands has nothing to remove""",
    """  if (e.cancelled || dailySuperseded(e) || symptomSuperseded(e) || paraSuperseded(e) || weightSuperseded(e)) return null; // a row that no longer stands has nothing to remove""")

# ---- 2b. removing a paracentesis must actually remove it -------------------------------------
# FOUND BY remove-group-test.mjs WHILE VERIFYING THE ABOVE, and pre-existing since v52: the weight
# tombstone is stamped Math.max(Date.now(), previous + 1) precisely so it cannot lose the tie, and
# the paracentesis tombstone was stamped with a bare Date.now(). Whenever the record being removed
# carries a loggedAt at or ahead of this device's clock -- two caregiver phones a few minutes apart,
# a correction written by the faster one -- the tombstone LOSES and the procedure stays on screen
# while the toast says "Paracentesis removed". The same guard, on the same shape of write.
rep("""                       mg: 0, ts: p.ts, cancelled: true, loggedAt: Date.now() });
    setState({ confirmRemovePara: null });""",
    """                       mg: 0, ts: p.ts, cancelled: true, loggedAt: Math.max(Date.now(), (p.loggedAt || p.ts || 0) + 1) });
    setState({ confirmRemovePara: null });""")

# ---- 3. version and the note she reads ---------------------------------------------------------
rep("const APP_VERSION = '%s';" % FROM_V, "const APP_VERSION = '%s';" % TO_V)
rep("""  { v: 'v72', date: 'Sep 7, 2026', title: 'A changed answer now stays changed',""",
    """  { v: 'v73', date: 'Sep 8, 2026', title: 'Removing a corrected weight no longer brings the old number back',
    points: [
      'If you corrected a weight or a paracentesis and then removed it from Today or History, the reading you had corrected could come back in its place. Remove now clears the whole reading, the same way the Weight and Paracentesis screens already did \\u2014 including on older weights, where it used to fail without saying so. History still lists what was recorded, marked Removed.',
      'A row that has already been replaced by a correction no longer offers a Remove button \\u2014 there is nothing left on it to remove.',
      'Removing a paracentesis could quietly do nothing when two phones\\u2019 clocks disagreed. It takes effect now, as long as you have a connection.'
    ] },
  { v: 'v72', date: 'Sep 7, 2026', title: 'A changed answer now stays changed',""")

if "removeEntry(e.id);\n}" not in s: sys.exit('REFUSING: the fall-through delete is gone')
if "const APP_VERSION = '%s';" % TO_V not in s: sys.exit('REFUSING: version stamp missing')

open(out, 'w', encoding='utf-8').write(s)

sw = open(sw_in, encoding='utf-8').read()
if "const CACHE = 'caretracker-%s';" % FROM_V not in sw: sys.exit('REFUSING: sw.js base is not %s' % FROM_V)
open(sw_out, 'w', encoding='utf-8').write(sw.replace("const CACHE = 'caretracker-%s';" % FROM_V, "const CACHE = 'caretracker-%s';" % TO_V))
print('patched %s -> %s: %s and %s' % (FROM_V, TO_V, out, sw_out))
