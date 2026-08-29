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
  fn('safeMedicationId'), fn('normalizeMedication'),
  fn('inpatientEntries'), fn('inpatientPeriods'), fn('isInpatientDay'), fn('inpatientCoversMoment'),
  fn('missedDosesFor'),
  'globalThis.__api = { treatmentActiveOn, treatmentWindowLabel, clampTreatmentDays, normalizeMedication, missedDosesFor, dayStart };'
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

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
