// Missed-dose suppression during a PARTIAL in-patient stay.
//
// Aaron, 2026-08-26, describing a real half-day stay: "they gave the Dex during the morning, but in
// the evening I had to end in patient bc I couldn't enter the Dex for the evening. I had to also
// toggle off the around chemo day."
//
// Suppression used to be all-or-nothing for a whole calendar day, so the app offered two false
// records and no true one: leave the stay open and the evening dose she took at home is invisible,
// or end the stay early and the morning doses the hospital gave are flagged missed.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/inpatient-window-test.mjs
//      --file <path>   to run against a mutated copy (this is how the checks are falsified)
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
  fn('dayStart'), fn('entriesFor'), fn('nextChemoTs'), fn('chemoOffsetFor'), fn('dexActiveOn'),
  fn('dexWindowsForOffset'), fn('inpatientEntries'), fn('inpatientPeriods'),
  fn('isInpatientDay'), fn('inpatientCoversMoment'), fn('missedDosesFor'),
  'globalThis.__api = { missedDosesFor, inpatientCoversMoment, dayStart };'
].join('\n'), ctx);
const A = ctx.__api;

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

// A weekday well after MISSED_TRACK_SINCE. Fixed, never "today" -- a suite pinned to the real clock
// passes or fails depending on when it runs.
const DAY = new Date(2026, 7, 24).getTime();          // Mon 24 Aug 2026, local midnight
const at = (h, m = 0) => DAY + h * 3600000 + m * 60000;
const NOW = DAY + 86400000 + 12 * 3600000;            // midday the FOLLOWING day: every window closed

// Three windows so the boundary cases are distinguishable, and a plain daily med so nothing here
// depends on the dexamethasone special-casing.
ctx.state.meds = [{ id: 'testmed', name: 'Test Med', alerts: true, windows: [
  { start: 8,  end: 12, name: 'Morning' },
  { start: 14, end: 18, name: 'Afternoon' },
  { start: 20, end: 22, name: 'Evening' }
] }];

const stay = (startH, endH) => [
  { id: 'ip1', medId: 'inpatient_start', ts: at(startH) },
  ...(endH === null ? [] : [{ id: 'ip2', medId: 'inpatient_end', ts: at(endH) }])
];
const missedNames = () => A.missedDosesFor(DAY, NOW).map(m => m.windowName).join(', ') || '(none)';

// ---- THE REPORTED CASE ---------------------------------------------------------------------
// Admitted 08:00, home by 18:00. Hospital covers Morning and Afternoon; the 20:00 Evening dose is
// hers to log, and nothing was logged, so Evening -- and ONLY Evening -- is a genuine miss.
ctx.state.entries = stay(8, 18);
t('half-day stay: the hospital\'s windows are not flagged',
  !/Morning|Afternoon/.test(missedNames()), missedNames());
t('half-day stay: the window she was home for IS flagged',
  /Evening/.test(missedNames()), missedNames());

// ---- and the dose she logged at home covers it --------------------------------------------
ctx.state.entries = [...stay(8, 18), { id: 'd1', medId: 'testmed', ts: at(20, 30), mg: 0 }];
t('a dose logged at home after discharge clears the miss',
  A.missedDosesFor(DAY, NOW).length === 0, missedNames());

// ---- a full-day stay still suppresses everything ------------------------------------------
ctx.state.entries = stay(0, 23);
t('a stay spanning the whole day suppresses every window',
  A.missedDosesFor(DAY, NOW).length === 0, missedNames());

// ---- an OPEN stay suppresses from admission onward ----------------------------------------
ctx.state.entries = stay(8, null);
t('an open stay suppresses every window after admission',
  A.missedDosesFor(DAY, NOW).length === 0, missedNames());

// ---- admitted late: the morning was hers ----------------------------------------------------
ctx.state.entries = stay(15, null);
t('admitted at 15:00 — the 08:00 dose was still hers to give',
  /Morning/.test(missedNames()) && !/Evening/.test(missedNames()), missedNames());

// ---- no stay at all -------------------------------------------------------------------------
ctx.state.entries = [];
t('no stay: every unlogged window is a miss', A.missedDosesFor(DAY, NOW).length === 3, missedNames());

// ---- BOUNDARY: admitted exactly as the window opens ----------------------------------------
// Inclusive on purpose. A dose due at 08:00 for someone admitted at 08:00 is the hospital's.
ctx.state.entries = stay(8, 18);
t('admission exactly at the window\'s opening minute counts as covered',
  A.inpatientCoversMoment(at(8)) === true);
t('discharge exactly at a window\'s opening minute does NOT count as covered',
  A.inpatientCoversMoment(at(18)) === false, 'discharged 18:00, a window opening at 18:00 is hers');

// ---- the legacy whole-day marker still suppresses its whole day -----------------------------
ctx.state.entries = [{ id: 'lg', medId: 'inpatient', ts: at(9) }];
t('the legacy whole-day marker still suppresses the entire day',
  A.missedDosesFor(DAY, NOW).length === 0, missedNames());

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
