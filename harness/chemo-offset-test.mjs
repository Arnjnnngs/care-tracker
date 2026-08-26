// The chemo date used for a day must be the one NEAREST that day.
//
// Reproduces, from Aaron's real record, the first line of the missed-dose banner he screenshotted on
// 2026-08-26: "Tuesday, Aug 4: Dexamethasone — Afternoon window (2:00 PM) closed with no dose
// logged." His actual chemo_date entries are used as the fixture below, duplicate included.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/chemo-offset-test.mjs
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
  throw new Error('unbalanced function: ' + name);
}
function line(re) { const m = html.match(re); if (!m) throw new Error('line not found: ' + re); return m[0]; }

const ctx = { state: { entries: [], meds: [], chemoDates: [] }, console };
vm.createContext(ctx);
vm.runInContext([
  line(/const MISSED_TRACK_SINCE = [^\n]*/),
  fn('dayStart'), fn('entriesFor'), fn('nextChemoTs'), fn('chemoDayList'), fn('chemoOffsetFor'),
  fn('dexActiveOn'), fn('dexWindowsForOffset'), fn('inpatientEntries'), fn('inpatientPeriods'),
  fn('isInpatientDay'), fn('inpatientCoversMoment'), fn('missedDosesFor'),
  'globalThis.__api = { missedDosesFor, chemoOffsetFor, dexActiveOn, dexWindowsForOffset, chemoDayList, dayStart };'
].join('\n'), ctx);
const A = ctx.__api;

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};
const D = (m, d) => new Date(2026, m - 1, d).getTime();

// HER ACTUAL chemo_date entries, duplicate included. loggedAt ordering is what the old code keyed
// on, so the fixture deliberately makes the most-recently-ENTERED date a late one.
ctx.state.chemoDates = [
  { medId: 'chemo_date', ts: D(7, 17), loggedAt: 1 },
  { medId: 'chemo_date', ts: D(8, 3),  loggedAt: 2 },
  { medId: 'chemo_date', ts: D(8, 22), loggedAt: 3 },
  { medId: 'chemo_date', ts: D(8, 24), loggedAt: 4 },
  { medId: 'chemo_date', ts: D(8, 24), loggedAt: 5 }   // duplicate, same calendar day
];

t('duplicate chemo dates collapse to one treatment day',
  A.chemoDayList().length === 4, A.chemoDayList().map(d => new Date(d).toLocaleDateString()).join(', '));
t('4 Aug measures from the 3 Aug treatment, not from whatever was typed last',
  A.chemoOffsetFor(D(8, 4)) === 1, 'offset ' + A.chemoOffsetFor(D(8, 4)));
t('22 Jul measures from the 17 Jul treatment', A.chemoOffsetFor(D(7, 22)) === 5, 'offset ' + A.chemoOffsetFor(D(7, 22)));
t('the day after chemo expects a MORNING dose only',
  A.dexWindowsForOffset(1).length === 1 && A.dexWindowsForOffset(1)[0].name === 'Morning',
  A.dexWindowsForOffset(1).map(w => w.name).join(', '));

// Dexamethasone as it ships: chemo-only, alerting. Windows come from the offset, not from here.
ctx.state.meds = [{ id: 'dexamethasone', name: 'Dexamethasone', alerts: true, chemoOnly: true,
  windows: [{ start: 8, end: 12, name: 'Morning' }, { start: 14, end: 18, name: 'Afternoon' }] }];

// The dose she really logged on 4 Aug, at 10:30.
ctx.state.entries = [{ id: 'd1', medId: 'dexamethasone', ts: D(8, 4) + 10.5 * 3600000, mg: 0 }];
const NOW = D(8, 26) + 12 * 3600000;
const missed4Aug = A.missedDosesFor(D(8, 4), NOW);

t('THE REPORTED LINE IS GONE — 4 Aug has no missed Dexamethasone dose',
  missed4Aug.length === 0, missed4Aug.map(m => m.windowName).join(', ') || '(none)');
t('and specifically no invented Afternoon window',
  !missed4Aug.some(m => m.windowName === 'Afternoon'), missed4Aug.map(m => m.windowName).join(', ') || '(none)');

// A day nowhere near a treatment must not expect the steroid at all.
ctx.state.entries = [];
t('a day far from any treatment expects no Dexamethasone',
  A.missedDosesFor(D(8, 12), NOW).length === 0, 'offset ' + A.chemoOffsetFor(D(8, 12)));

// The day before chemo DOES expect both windows, and an unlogged one is a real miss.
const missed2Aug = A.missedDosesFor(D(8, 2), NOW);
t('the day before chemo still expects both windows, and reports them when nothing is logged',
  missed2Aug.length === 2, missed2Aug.map(m => m.windowName).join(', ') || '(none)');

t('no chemo dates at all yields no offset rather than a crash',
  (ctx.state.chemoDates = [], A.chemoOffsetFor(D(8, 4)) === null));

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
