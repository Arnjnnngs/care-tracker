#!/usr/bin/env python3
"""Falsify every check v75 adds. Rule 5: break the thing, watch the check go RED, restore it.

The one that matters most is the first: restore must bring a medication back with reminders OFF.
Leave them on and every dose window during the archived weeks is flagged as missed the moment the
screen redraws -- the flood that ending a hospital stay produced once already.
"""
import os, re, subprocess, sys

SP = '/tmp/claude-0/-home-user/41e5d279-40d0-5a8a-b4e0-827057dd9522/scratchpad/mutants-v75'
os.makedirs(SP, exist_ok=True)
ENV = {k: v for k, v in os.environ.items()
       if k not in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy')}
APP = '/home/user/care-tracker/index.html'
SUITE = '/home/user/care-tracker/harness/archived-meds-test.mjs'


def run(app_file):
    out = subprocess.run(['node', SUITE, '--file', app_file], env=ENV,
                         capture_output=True, text=True, timeout=900).stdout
    m = re.search(r'(\d+)/(\d+) checks passed', out)
    reds = [l.strip()[6:].split('  |')[0].strip() for l in out.split('\n') if l.strip().startswith('FAIL')]
    return (m.group(0) if m else 'NO SCORE'), reds


CASES = [
    ('THE SAFETY ONE: the away-span guard removed from the missed-dose walk',
     lambda h: h.replace("    if ((med.awayPeriods || []).some(p => p && d0 >= dayStart(p.start) && d0 <= dayStart(p.end))) return;\n", ""),
     'SUPPRESSION HAPPENS: the days it was off the list are not counted as missed'),

    ("THE AUDIT'S SECOND BLOCKER: a normaliser strips awayPeriods on load, so the feature dies at the first reload",
     lambda h: h.replace("function normalizeMedication(raw, index) {\n  const original = raw || {};",
                         "function normalizeMedication(raw, index) {\n  const original = raw || {};\n  delete original.awayPeriods;"),
     'and the span survives closing and reopening the app, which storage cannot prove'),

    ('the restore stops recording the span it was away',
     lambda h: h.replace("  med.awayPeriods = (Array.isArray(med.awayPeriods) ? med.awayPeriods : [])", "  med.awayPeriods = ([])"
                         ).replace("    .filter(p => p && Number(p.start) && Number(p.end))\n    .concat([{ start: awayFrom, end: awayTo }]);", "    .slice();"),
     'the span it was away is recorded with BOTH ends'),

    ('THE SECOND REFUSAL, PUT BACK: suppress EVERYTHING before the restore, not just the gap',
     lambda h: h.replace("if ((med.awayPeriods || []).some(p => p && d0 >= dayStart(p.start) && d0 <= dayStart(p.end))) return;",
                         "if ((med.awayPeriods || []).some(p => p && d0 <= dayStart(p.end))) return;"),
     'THE SAFETY CHECK: only the days it was away are suppressed, and it was away for none'),

    ('restore switches reminders off again, the design the audit refused',
     lambda h: h.replace("  med.id = id;\n", "  med.id = id;\n  med.alerts = false;\n", 1),
     'its reminders came back exactly as they were, rather than being switched off'),

    ('the archive goes back to keeping only the name',
     lambda h: h.replace("config: JSON.parse(JSON.stringify(med)), removedAt:", "removedAt:"),
     'the archive now carries the whole medication'),

    ('the archive is stripped again on every load (the v20 trap)',
     lambda h: h.replace("    if (value.config && typeof value.config === 'object') {",
                         "    if (false && value.config && typeof value.config === 'object') {"),
     'after closing and reopening the app, it still knows the settings were kept'),

    ('the id-clash guard removed, so restore can duplicate a medication',
     lambda h: h.replace("  if (state.meds.some(item => item.id === id)) {\n"
                         "    setToast('A medication called ' + nameOf(id) + ' is already on the list. Remove or rename that one first.');\n"
                         "    return;\n  }\n", ""),
     'restore is refused rather than creating a duplicate'),

    ('the Removed-medications section renders even when nothing is removed',
     lambda h: h.replace("    archivedList.length ? h('div', { 'data-archived-meds': 'true'",
                         "    true ? h('div', { 'data-archived-meds': 'true'"),
     'THE EXEMPTION: no "Removed medications" section when nothing is removed'),

    ('restore gives the medication a NEW id, orphaning its dose history',
     lambda h: h.replace("  med.id = id;\n  // REMINDERS COME BACK", "  med.id = id + '-2';\n  // REMINDERS COME BACK"),
     'it is on the active list again'),


    ('the archive stops recording the day the medication left the list',
     lambda h: h.replace(", removedAt: dayStart(state.now || Date.now()) } };", " } };"),
     'the archive wrote down the day it left, which nothing can recover later'),

    ('the day it left is stripped on every load -- the v20 trap, on the new field',
     lambda h: h.replace("    if (Number(value.removedAt)) entry.removedAt = Number(value.removedAt);\n", ""),
     'the span starts on the day it actually left, not on the day it came back'),

    ('the archived list is not sorted from the record, it is empty',
     lambda h: h.replace("  const archivedList = Object.entries(state.archivedMeds || {})",
                         "  const archivedList = Object.entries({})"),
     'it is listed on the Meds screen'),
]

src = open(APP, encoding='utf-8').read()
base, reds = run(APP)
print('  baseline%s%-22s %s' % (' ' * 56, base, reds or ''))
bad = 1 if reds else 0

for name, mutate, expect in CASES:
    h = mutate(src)
    if h == src:
        print('  %-62s SKIPPED (pattern absent)' % name); bad += 1; continue
    p = os.path.join(SP, re.sub(r'\W+', '-', name)[:50] + '.html')
    open(p, 'w', encoding='utf-8').write(h)
    score, reds = run(p)
    ok = expect in reds
    print('  %-62s %-22s %s' % (name, score, 'RED as intended' if ok else 'STILL GREEN <-- ' + str(reds)))
    if not ok:
        bad += 1

print('\n%s' % ('ALL MUTANTS BEHAVED' if bad == 0 else '%d PROBLEM(S)' % bad))
sys.exit(1 if bad else 0)
