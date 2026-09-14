#!/usr/bin/env python3
"""v75 -> v76: a red overdose warning is silently replaced by an amber timing notice.

FOUND IN THE SIBLING APPS AND CONFIRMED HERE, in Brandi's own build, line for line.

THE DEFECT, in the order it happens to her caregiver:

  1. The day reaches the 2,500 mg acetaminophen limit and one more Tylenol goes in through the
     app's own override. A red banner appears: "Acetaminophen ceiling exceeded -- Today's Tylenol
     total is 3,500 mg, above the 2,500 mg daily limit. Do not give more without contacting the
     care team."
  2. She taps "Take all" on the evening meds. Iron is in that batch.
  3. Protonix was logged within the last two hours, so afterLog({medId:'iron'}) fires the amber
     "Iron + Protonix timing" notice -- into the SAME single `state.warn` slot.

The overdose warning is gone from the screen, with nothing to say it was ever there, replaced by a
note about absorption timing. Which warning she ends up looking at depends on what she happened to
tap next.

`state.warn` is one slot and the iron/protonix branch sets it and RETURNS before any ceiling check
can run. The fix: collect every warning a dose earns, show the worst one, and never let an amber
displace a red that is still on the screen. A red may still replace a red -- the newer figure is
the one that matters.

THE SECOND DEFECT. "Take all" calls afterLog for iron and nothing else. This build's version is
already better than the siblings' -- v63 keyed it on `savedIds`, what actually saved, rather than
what was attempted -- but it still asks about ONE medication. A batch that pushes something else
past its own configured daily limit raises no warning at all.

Verified end to end in `harness/warning-priority-test.mjs` against the STAGING build, which carries
the identical afterLog, and re-run here against this file.
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML, SW = ROOT / 'index.html', ROOT / 'sw.js'

def die(msg):
    print('PATCH FAILED: ' + msg); sys.exit(1)

src = HTML.read_text(encoding='utf-8')
if 'EVERY WARNING THIS DOSE EARNS' in src:
    die('already applied')

sw = SW.read_text(encoding='utf-8')
if "caretracker-v75" not in sw:
    die('sw.js CACHE is not caretracker-v75 -- nothing written')

start = src.index('function afterLog(entry) {')
end = src.index('\n}\n\nasync function logMed(', start)
body = src[start:end]
for needle in ["Iron + Protonix timing", "Acetaminophen ceiling exceeded", "dailyCeiling(configuredMedication)"]:
    if needle not in body:
        die('afterLog is not shaped as expected (missing ' + needle + ') -- nothing written')

NEW = '''function afterLog(entry) {
  // EVERY WARNING THIS DOSE EARNS, THEN THE WORST ONE.
  // This used to be a chain of branches each calling setState({ warn }) into a single slot, with the
  // iron/protonix branch RETURNING before the ceiling check could run. A caregiver who had just been
  // shown "Acetaminophen ceiling exceeded -- do not give more without contacting the care team", and
  // who then tapped "Take all" on the evening meds, had that red banner replaced by an amber note
  // about iron absorption timing. The overdose warning simply left the screen, with nothing to say
  // it had been there. Which warning she was looking at depended on what she happened to tap next.
  const twoH = 2 * 3600000;
  const warnings = [];
  if (entry.medId === 'iron' || entry.medId === 'protonix') {
    const other = entry.medId === 'iron' ? 'protonix' : 'iron';
    const near = state.entries.find(e => e.medId === other && e.id !== entry.id && Math.abs(e.ts - entry.ts) <= twoH);
    // NO `return` HERE. That return is half the defect: it meant an iron dose could never also
    // report a ceiling, and that this amber always won whatever was already on screen.
    if (near) warnings.push({ tone: 'amber', title: 'Iron + Protonix timing', body: 'Iron and Protonix were logged within 2 hours of each other. Protonix (a PPI) lowers stomach acid, which can markedly reduce iron absorption. Aim to separate the two by at least 2 hours.' });
  }
  if (entry.medId === 'tylenol' || entry.medId === 'tylenol-liquid') {
    const mg = tylenolMg();
    const tylenol = state.meds.find(med => med.id === 'tylenol');
    const limit = medicationCeilingMax(tylenol) || CONFIG.ceilingMg;
    const mgOver = mg > limit;
    let volOver = false, vol = 0, liquidMed = null;
    if (entry.medId === 'tylenol-liquid') {
      liquidMed = state.meds.find(med => med.id === 'tylenol-liquid');
      vol = dailyVolumeMl('tylenol-liquid');
      volOver = !!(liquidMed && liquidMed.volumeCeilingMl && vol > liquidMed.volumeCeilingMl);
    }
    if (mgOver && volOver) {
      warnings.push({ tone: 'red', title: 'Acetaminophen ceiling exceeded', body: "Today's Tylenol total is " + mg.toLocaleString() + " mg (above the " + limit.toLocaleString() + " mg daily limit) and Tylenol Liquid volume is " + vol + " mL (above the " + liquidMed.volumeCeilingMl + " mL daily limit). Do not give more without contacting the care team." });
    } else if (mgOver) {
      warnings.push({ tone: 'red', title: 'Acetaminophen ceiling exceeded', body: "Today's Tylenol total is " + mg.toLocaleString() + " mg, above the " + limit.toLocaleString() + " mg daily limit. Do not give more without contacting the care team." });
    } else if (volOver) {
      warnings.push({ tone: 'red', title: 'Tylenol Liquid volume ceiling exceeded', body: "Today's Tylenol Liquid total is " + vol + " mL, above the " + liquidMed.volumeCeilingMl + " mL daily limit. Do not give more without contacting the care team." });
    }
  } else {
    // NO LONGER AN `else` ON THE IRON BRANCH. It was one before, so a medication that is neither
    // tylenol nor iron reached its own configured ceiling check, but iron itself never did -- iron
    // has no ceiling today, which is the only reason that did not already matter.
    const configuredMedication = state.meds.find(med => med.id === entry.medId);
    const configuredLimit = dailyCeiling(configuredMedication);
    if (configuredLimit && configuredLimit.used > configuredLimit.max) {
      warnings.push({ tone: 'red', title: configuredMedication.name + ' daily limit exceeded', body: "Today's " + configuredMedication.name + ' total is ' + configuredLimit.used + ' ' + configuredLimit.unit + ', above the ' + configuredLimit.label + ' daily limit. Do not give more without contacting the care team.' });
    }
  }

  if (!warnings.length) return;
  const worst = warnings.find(w => w.tone === 'red') || warnings[0];
  // AN AMBER NEVER DISPLACES A RED THE CAREGIVER IS STILL LOOKING AT. The red banner stays until
  // she taps the x on it, and while an overdose warning is on the screen it is the thing she has to
  // deal with -- a note about iron absorption timing is not a reason to take it away. A red may
  // still replace a red: the newer figure is the one that matters. Checked against what is ON
  // SCREEN rather than a per-batch flag, because the reported failure crosses taps: the red came
  // from a Tylenol dose and the amber from a later "Take all".
  if (state.warn && state.warn.tone === 'red' && worst.tone !== 'red') return;
  setState({ warn: worst });
'''
src = src[:start] + NEW + src[end:]

def cut(old, new, what):
    global src
    if src.count(old) != 1:
        die(what + ' is not where it was (found ' + str(src.count(old)) + ') -- nothing written')
    src = src.replace(old, new, 1)

# EVERY MEDICATION THAT SAVED, not just iron. v63 correctly keyed this on savedIds -- what actually
# reached the record -- and that half stays exactly as it is. What changes is that the batch asks
# about all of them: a "Take all" that pushed something past its own configured daily limit raised
# no warning whatsoever, because iron was the only medication it ever asked about.
cut("""    setTimeout(() => { if (savedIds.includes('iron')) afterLog({ medId: 'iron', ts, id: 'pending' }); }, 500);""",
    """    setTimeout(() => { savedIds.forEach(mid => afterLog({ medId: mid, ts, id: 'pending' })); }, 500);""",
    "take-all's afterLog call")

# WHAT BRANDI READS. The Voice's three questions, answered here rather than after the fact: it is
# true (the harness proves the red banner survives the amber one, and fails on v75), it says what
# happened in the words a tired person uses at 2am, and it prints no number about her at all.
cut("""const CHANGELOG = [
  { v: 'v75', date: 'Sep 11, 2026', title: 'Removed medications can be brought back',""",
    """const CHANGELOG = [
  { v: 'v76', date: 'Sep 14, 2026', title: 'A safety warning can no longer be pushed off the screen',
    points: [
      'The app shows one warning at a time. The red \u201cAcetaminophen ceiling exceeded \u2014 do not give more without contacting the care team\u201d could be replaced moments later by an amber note about Iron and Protonix timing, with nothing left to say the red one had ever been there.',
      'The more serious warning wins now. An amber note never takes a red one off the screen \u2014 the red stays until you close it yourself.',
      '\u201cTake all\u201d used to check only Iron. It checks every medication in the batch now, so going over any daily limit is reported.'
    ] },
  { v: 'v75', date: 'Sep 11, 2026', title: 'Removed medications can be brought back',""",
    "the changelog")

cut("""const APP_VERSION = 'v75';""", """const APP_VERSION = 'v76';""", 'APP_VERSION')
HTML.write_text(src, encoding='utf-8')
SW.write_text(sw.replace("caretracker-v75", "caretracker-v76", 1), encoding='utf-8')
print('v76 applied: the red overdose warning survives the amber one')
