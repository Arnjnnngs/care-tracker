// PER-MEDICATION TREATMENT WINDOWS.
//
// Aaron, 2026-08-29: "Not sure it should say chemo only day...bc it's not something taken on just
// chemo only days. none of the medication is. it should be like the other app and say treatment day
// with some offset options. at least that's how it should have been bc I've asked this before in
// chemowell."
//
// Two problems, one cause. The LABEL said "Chemo-day only", which is false of every medication here
// -- Dexamethasone runs the day before through the day after, a window AROUND treatment. And the
// window itself was hardcoded at -1..+1 inside dexActiveOn(), a function named after one drug, so
// no other medication could express its own schedule; its doses were judged against Dexamethasone's.
// The wrong label is what made Aaron doubt a correct setting and switch it off, which is what
// produced three weeks of false alerts.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/treatment-window-test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : new URL('../index.html', import.meta.url).pathname;
const html = fs.readFileSync(FILE, 'utf8');
function fn(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found: ' + name);
  const from = html.indexOf('{', html.indexOf(')', i));
  let d = 0;
  for (let k = from; k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (d === 0) return html.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function line(re) { const m = html.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; }

const ctx = { state: { entries: [], meds: [], chemoDates: [] }, console };
vm.createContext(ctx);
vm.runInContext([
  line(/const MISSED_TRACK_SINCE = [^\n]*/),
  'const DEFAULT_QUICK_LOG_IDS=[],DEFAULT_EVENING_IDS=[],DEFAULT_MORNING_IDS=[];',
  fn('dayStart'), fn('entriesFor'), fn('nextChemoTs'), fn('chemoDayList'), fn('chemoOffsetFor'),
  fn('chemoOffsetSinceLast'), fn('dexActiveOn'), fn('dexWindowsForOffset'),
  fn('clampTreatmentDays'), fn('treatmentActiveOn'), fn('treatmentWindowLabel'),
  fn('chemoDayFor'), fn('zofranBlockingDay'), fn('zofranBlockedOn'),
  fn('safeMedicationId'), fn('normalizeMedication'),
  fn('inpatientEntries'), fn('inpatientPeriods'), fn('isInpatientDay'), fn('inpatientCoversMoment'),
  fn('missedDosesFor'),
  'globalThis.__api = { treatmentActiveOn, treatmentWindowLabel, clampTreatmentDays, normalizeMedication, missedDosesFor, dayStart, chemoDayFor, zofranBlockingDay, zofranBlockedOn };'
].join('\n'), ctx);
const A = ctx.__api;

let pass = 0, fail = 0;
const t = (n, c, d) => { console.log((c ? '  PASS  ' : '  FAIL  ') + n + (d ? '  |  ' + d : '')); c ? pass++ : fail++; };
const D = (m, d) => new Date(2026, m - 1, d).getTime();
ctx.state.chemoDates = [{ medId: 'chemo_date', ts: D(8, 24), loggedAt: 1 }];

// ---- the default must reproduce the old fixed window EXACTLY -------------------------------
// This is the whole safety of the change: nothing moves for anyone until they choose to move it.
const legacy = {};
t('an unconfigured medication keeps the old day-before-through-day-after window',
  [23, 24, 25].every(d => A.treatmentActiveOn(legacy, D(8, d))) &&
  [22, 26].every(d => !A.treatmentActiveOn(legacy, D(8, d))));

// ---- and it can now be something else -------------------------------------------------------
t('a wider window is honoured', [22, 23, 24, 25, 26, 27].every(d => A.treatmentActiveOn({ treatmentDaysBefore: 2, treatmentDaysAfter: 3 }, D(8, d))) &&
  !A.treatmentActiveOn({ treatmentDaysBefore: 2, treatmentDaysAfter: 3 }, D(8, 28)));
t('treatment day only is expressible, which it never was before',
  A.treatmentActiveOn({ treatmentDaysBefore: 0, treatmentDaysAfter: 0 }, D(8, 24)) &&
  !A.treatmentActiveOn({ treatmentDaysBefore: 0, treatmentDaysAfter: 0 }, D(8, 25)));
t('with no treatment date recorded, nothing is in a window',
  (ctx.state.chemoDates = [], A.treatmentActiveOn(legacy, D(8, 24)) === false));
ctx.state.chemoDates = [{ medId: 'chemo_date', ts: D(8, 24), loggedAt: 1 }];

// ---- THE STRING BUG. The editor writes these from a number input, so they arrive as strings, and
// Number.isFinite("3") is FALSE. Every configured window would have silently reverted to 1/1.
t('a value typed into the editor survives as a NUMBER, not a string',
  A.normalizeMedication({ id: 'dex', name: 'Dexamethasone', treatmentDaysBefore: '2', treatmentDaysAfter: '3' }).treatmentDaysBefore === 2);
t('and the medication then actually uses it',
  A.treatmentActiveOn(A.normalizeMedication({ id: 'dex', name: 'D', treatmentDaysBefore: '2', treatmentDaysAfter: '3' }), D(8, 22)) === true);
t('blank means unset, not zero', A.clampTreatmentDays('') === 1 && A.clampTreatmentDays(null) === 1);
t('junk falls back rather than producing NaN', A.clampTreatmentDays('abc') === 1);
t('a mistyped 30 is clamped, not honoured for two months', A.clampTreatmentDays(30) === 14);
t('zero is a real choice and is preserved', A.clampTreatmentDays(0) === 0);

// ---- the label a caregiver reads -------------------------------------------------------------
t('the window reads in plain words',
  A.treatmentWindowLabel({}) === '1 day before → 1 day after' &&
  A.treatmentWindowLabel({ treatmentDaysBefore: 0, treatmentDaysAfter: 0 }) === 'Treatment day only',
  A.treatmentWindowLabel({ treatmentDaysBefore: 2, treatmentDaysAfter: 3 }));

// ---- and it drives missed doses, which is the half that actually hurt ------------------------
ctx.state.meds = [{ id: 'dexamethasone', name: 'Dexamethasone', alerts: true, chemoOnly: true,
  treatmentDaysBefore: 0, treatmentDaysAfter: 0,
  windows: [{ start: 8, end: 12, name: 'Morning' }, { start: 14, end: 18, name: 'Afternoon' }] }];
ctx.state.entries = [];
const NOW = D(8, 29) + 12 * 3600000;
t('a treatment-day-only medication is not reported missed the day after',
  A.missedDosesFor(D(8, 25), NOW).length === 0,
  A.missedDosesFor(D(8, 25), NOW).map(m => m.windowName).join(', ') || 'none');
t('and IS still reported missed on the treatment day itself',
  A.missedDosesFor(D(8, 24), NOW).length > 0,
  A.missedDosesFor(D(8, 24), NOW).map(m => m.windowName).join(', ') || 'none');

// ---- ASK EVERY TREATMENT, NOT THE NEAREST ONE (Zero Day Auditor, app-v68 round) -------------
// This asked chemoOffsetFor() -- distance to the CLOSEST treatment -- and tested that one number
// against the window. Treatments on 24 and 27 Aug with a 0-before/3-after window: the 26th is two
// days after the 24th and inside the window, but the closest date is the 27th, so it measured -1
// and the medication vanished. I had already "fixed" the directional problem for Zofran and written
// in the release notes that it was settled; it was settled for one caller out of two.
ctx.state.chemoDates = [
  { medId: 'chemo_date', ts: D(8, 24), loggedAt: 1 },
  { medId: 'chemo_date', ts: D(8, 27), loggedAt: 2 }
];
const wide = { treatmentDaysBefore: 0, treatmentDaysAfter: 3 };
t('26 Aug is 2 days after the 24th and stays active, though the 27th is nearer',
  A.treatmentActiveOn(wide, D(8, 26)) === true);
t('the window still ends where it should', A.treatmentActiveOn(wide, D(8, 31)) === false);
t('Zofran is blocked across BOTH treatments, not just the nearer one',
  [24, 25, 26, 27, 28, 29].every(d => A.zofranBlockedOn(D(8, d))) && !A.zofranBlockedOn(D(8, 30)));

// ---- A LABEL MUST NAME THE DATE ITS OWN ANSWER CAME FROM -------------------------------------
// Display sites printed dayStart(nextChemoTs()) -- the most recently ENTERED date -- while the
// condition around them used the new offsets. The card refused to unlock and then named a date
// three weeks in the past; with no date at all, dayStart(null) printed 1 Jan 1970. Both were
// reported fixed in the release notes before they were.
ctx.state.chemoDates = [
  { medId: 'chemo_date', ts: D(8, 24), loggedAt: 1 },
  { medId: 'chemo_date', ts: D(8, 3),  loggedAt: 2 }   // the OLDER date entered LAST
];
t('the banner names the treatment nearest the day, not the one typed last',
  A.chemoDayFor(D(8, 25)) === D(8, 24),
  new Date(A.chemoDayFor(D(8, 25))).toLocaleDateString());
t('with no treatment date, there is nothing to name — and never 1 Jan 1970',
  (ctx.state.chemoDates = [], A.chemoDayFor(D(8, 25)) === null && A.zofranBlockingDay(D(8, 25)) === null));
ctx.state.chemoDates = [
  { medId: 'chemo_date', ts: D(8, 24), loggedAt: 1 },
  { medId: 'chemo_date', ts: D(8, 26), loggedAt: 2 }
];
t('Zofran names the treatment actually holding it shut, the later block',
  A.zofranBlockingDay(D(8, 27)) === D(8, 26),
  new Date(A.zofranBlockingDay(D(8, 27))).toLocaleDateString());

// The three checks above prove the HELPERS are right. They do not prove the screens USE them --
// and when this suite was falsified against the pre-fix build, the label checks stayed green
// because the mutant only changed the call sites. So assert on the call sites directly: the raw
// pattern that produced both "Opens Thu, Aug 6" and 1 Jan 1970 must not appear anywhere.
const code = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
// A LITERAL-PATTERN BAN WAS THE FIRST ATTEMPT AND IT WAS WEAK. It looked for the exact string
// `dayStart(nextChemoTs())`, and when this suite was falsified the mutant wrote the same thing in
// two steps -- `const cDay = nextChemoTs()` then `dayStart(cDay)` -- and sailed past. A check that
// only catches one spelling of a mistake is close to no check.
//
// So pin the CALL SITES instead. nextChemoTs() has exactly two legitimate consumers, both of which
// genuinely want "the treatment date most recently entered" rather than a per-day answer:
//   * the Chemo schedule card, which displays the next/last treatment itself
//   * the printable report header
// Every OTHER use is a per-day question and belongs to chemoDayFor() or zofranBlockingDay().
// Adding a third call site turns this red, and whoever adds it has to come and justify it here.
//
// WHAT THIS STILL DOES NOT PROVE, plainly: that the screens render the right date. It proves the
// helpers are correct and that nothing new reaches for the wrong source. Proving the rendered text
// needs a browser assertion, which this project does not yet have for these cards.
const nextChemoCalls = (code.match(/nextChemoTs\(\)/g) || []).length - 1; // minus its own definition
t('nextChemoTs() still has exactly its two legitimate display consumers',
  nextChemoCalls === 2, nextChemoCalls + ' call site(s)');

// ---- ONE clamp, ported from ChemoWell app-v68 (its PM found the split there first) ----
//
// Four places in THIS file answered "how many days is this window?": the save path, the editor's
// form seed, the editor's own preview label, and treatmentActiveOn. Two of them were hand-inlined
// copies of the rule and two tested Number.isFinite() on values that arrive from a text field --
// where "3" is a string and isFinite("3") is false. The visible consequence was a blank box: the
// editor read Number('') as a deliberate 0 and printed "Treatment day only", while saving the same
// blank box fell back to 1 day either side. The label promised a window the app did not obey.
const DAYMS = 86400000;
const Tw = new Date(2026, 7, 20).getTime();
ctx.state.chemoDates = [{ ts: Tw, loggedAt: Tw }];

const { clampTreatmentDays, treatmentWindowLabel, treatmentActiveOn } = A;
t('a cleared field reads as 1 day, not as a deliberate 0', clampTreatmentDays('') === 1, clampTreatmentDays(''));
t('the editor label agrees with the save path on a cleared field',
  treatmentWindowLabel({ treatmentDaysBefore: '', treatmentDaysAfter: '' }) !== 'Treatment day only',
  treatmentWindowLabel({ treatmentDaysBefore: '', treatmentDaysAfter: '' }));
t('a deliberate 0/0 still reads "Treatment day only"',
  treatmentWindowLabel({ treatmentDaysBefore: 0, treatmentDaysAfter: 0 }) === 'Treatment day only',
  treatmentWindowLabel({ treatmentDaysBefore: 0, treatmentDaysAfter: 0 }));
t('a window typed as text is obeyed, not collapsed to 1',
  treatmentActiveOn({ treatmentDaysBefore: '3', treatmentDaysAfter: '0' }, Tw - 3 * DAYMS) === true, '');
t('and it still ends where it should',
  treatmentActiveOn({ treatmentDaysBefore: '3', treatmentDaysAfter: '0' }, Tw - 4 * DAYMS) === false, '');
t('a window typed as text is LABELLED as typed', 
  treatmentWindowLabel({ treatmentDaysBefore: '3', treatmentDaysAfter: '0' }).indexOf('3 days before') === 0,
  treatmentWindowLabel({ treatmentDaysBefore: '3', treatmentDaysAfter: '0' }));
t('a mistyped 300 cannot make a medication treatment-adjacent for months',
  treatmentActiveOn({ treatmentDaysBefore: 300, treatmentDaysAfter: 300 }, Tw - 20 * DAYMS) === false, '');
t('and the label shows the clamped number, not 300',
  treatmentWindowLabel({ treatmentDaysBefore: 300, treatmentDaysAfter: 300 }).indexOf('14 days before') === 0,
  treatmentWindowLabel({ treatmentDaysBefore: 300, treatmentDaysAfter: 300 }));

// The invariant, stated where it is actually enforced. Falsifying the clamp on the editor's save
// path did NOT turn this suite red, and that is worth writing down rather than papering over: every
// candidate goes through normalizeMedication() on the way to storage, so THAT is what guarantees a
// stored window is a bounded number. The clamp at the save site is defence in depth against a future
// path that stores without normalizing -- it is not what makes this true today. What must never
// break is the invariant itself, so it is asserted here against the function that owns it.
const storedWide = A.normalizeMedication({ id: 'x', name: 'Wide', treatmentDaysBefore: '300', treatmentDaysAfter: 300 }, 0);
t('nothing reaches storage with an out-of-range window',
  storedWide.treatmentDaysBefore === 14 && storedWide.treatmentDaysAfter === 14,
  storedWide.treatmentDaysBefore + '/' + storedWide.treatmentDaysAfter);
const storedText = A.normalizeMedication({ id: 'y', name: 'Text', treatmentDaysBefore: '3', treatmentDaysAfter: '' }, 0);
t('a window stored as text survives as the number typed',
  storedText.treatmentDaysBefore === 3 && storedText.treatmentDaysAfter === 1,
  storedText.treatmentDaysBefore + '/' + storedText.treatmentDaysAfter);

// The rule must exist once. A second hand-inlined copy is how these drifted apart to begin with.
const inlineBounds = (code.match(/Math\.min\(\s*14\s*,/g) || []).length;
t('exactly one 14-day bound in the file, inside clampTreatmentDays', inlineBounds === 1, inlineBounds + ' found');
const isFiniteOnWindow = (code.match(/Number\.isFinite\([^)]*treatmentDays(Before|After)/g) || []).length;
t('no Number.isFinite test left on a treatment-day field', isFiniteOnWindow === 0, isFiniteOnWindow + ' found');

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
