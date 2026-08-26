// Behaviour flags added to DEFAULT_MEDS must reach devices that saved their list first.
//
// THE FAILURE THIS EXISTS FOR, from Aaron's screenshot on 2026-08-26: the missed-dose banner listed
// Dexamethasone Morning AND Afternoon, every single day, from Aug 4 to Aug 26. Dexamethasone is a
// steroid taken only around a chemo date. Her device had saved its medication list BEFORE
// `chemoOnly` existed, mergeMissingDefaultMeds() adds missing MEDICATIONS but never missing
// PROPERTIES, and normalizeMedication() turned "never heard of this setting" into a permanent
// `false`. So it was tracked as an everyday medication against a hardcoded 8 AM / 2 PM schedule.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/medflag-backfill-test.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : new URL('../index.html', import.meta.url).pathname;
const html = fs.readFileSync(FILE, 'utf8');

function block(marker, open, close) {
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + marker);
  const from = html.indexOf(open, i);
  let d = 0;
  for (let k = from; k < html.length; k++) {
    if (html[k] === open) d++;
    else if (html[k] === close) { d--; if (d === 0) return html.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced: ' + marker);
}
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

const ctx = { console };
vm.createContext(ctx);
vm.runInContext([
  block('const DEFAULT_MEDS = [', '[', ']'),
  fn('deepCopyMeds'), fn('backfillDefaultMedFlags'),
  'globalThis.__api = { DEFAULT_MEDS, backfillDefaultMedFlags };'
].join('\n'), ctx);
const A = ctx.__api;

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

const defDex = A.DEFAULT_MEDS.find(m => m.id === 'dexamethasone');
t('the default Dexamethasone is still marked chemo-only (the premise of this whole suite)',
  !!(defDex && defDex.chemoOnly), defDex ? String(defDex.chemoOnly) : 'NOT IN DEFAULT_MEDS');

// HER DEVICE: a saved Dexamethasone from before chemoOnly existed. No such key at all.
const hers = { id: 'dexamethasone', name: 'Dexamethasone', type: 'win', alerts: true,
  windows: [{ start: 8, end: 12, name: 'Morning' }, { start: 14, end: 18, name: 'Afternoon' }] };
t('a saved medication predating the flag genuinely lacks it (guards the fixture itself)',
  !Object.prototype.hasOwnProperty.call(hers, 'chemoOnly'));

const fixed = A.backfillDefaultMedFlags(hers);
t('the missing flag is filled in from the default', fixed.chemoOnly === true, String(fixed.chemoOnly));
t('the caregiver\'s own customisation is untouched',
  fixed.name === 'Dexamethasone' && fixed.windows.length === 2 && fixed.alerts === true);
t('the original object is not mutated', !Object.prototype.hasOwnProperty.call(hers, 'chemoOnly'));

// A DELIBERATE choice must survive. Present-but-false is the user's decision, not an absence.
const optedOut = A.backfillDefaultMedFlags({ id: 'dexamethasone', name: 'Dexamethasone', chemoOnly: false });
t('an explicit false is a choice and is NEVER overwritten', optedOut.chemoOnly === false, String(optedOut.chemoOnly));

// A medication the caregiver added has no default to inherit from.
const custom = { id: 'lorazapem', name: 'Lorazapem', alerts: true };
const customOut = A.backfillDefaultMedFlags(custom);
t('a user-added medication is left exactly as it is',
  JSON.stringify(customOut) === JSON.stringify(custom), JSON.stringify(customOut));

// Deep values must be copied, or every device shares one mutable array with DEFAULT_MEDS.
const bare = A.backfillDefaultMedFlags({ id: 'dexamethasone', name: 'Dexamethasone' });
if (Array.isArray(bare.windows) && Array.isArray(defDex.windows)) {
  bare.windows.push({ start: 0, end: 1, name: 'polluted' });
  t('backfilled arrays are copies, not shared references into DEFAULT_MEDS',
    defDex.windows.every(w => w.name !== 'polluted'), defDex.windows.map(w => w.name).join(', '));
} else {
  t('backfilled arrays are copies, not shared references into DEFAULT_MEDS', true, 'no array to test');
}

t('null and undefined do not throw',
  A.backfillDefaultMedFlags(null) === null && A.backfillDefaultMedFlags(undefined) === undefined);

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
