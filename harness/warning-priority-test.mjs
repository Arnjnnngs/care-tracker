// warning-priority-test.mjs -- v76 (production). A red overdose warning must not be replaced by an amber one.
//
// THE DEFECT, in the order it happens to a caregiver:
//   1. She logs Tylenol past the daily acetaminophen limit. A red banner appears reading
//      "Acetaminophen ceiling exceeded ... Do not give more without contacting the care team."
//   2. She taps "Take all" on the evening meds, which include Iron.
//   3. Protonix was logged within the last two hours, so afterLog({medId:'iron'}) fired the amber
//      "Iron + Protonix timing" notice -- into the SAME single `state.warn` slot.
//   4. The overdose warning is gone from the screen, with nothing to say it was ever there.
//
// `state.warn` is one slot and the iron branch set it and RETURNED before any ceiling check ran.
// Which warning she ended up looking at depended on what she happened to tap next.
//
// AND A SECOND DEFECT FOUND WRITING THIS: "Take all" called afterLog for iron ONLY
// (`if (ids.includes('iron'))`), so a batch that pushed some other medication over its own
// configured daily limit raised no warning at all -- the only medication the batch ever asked about
// was iron. Section 4 covers that one.
//
// ASSERTS ON THE RENDERED BANNER, not on a lifted function. The bug is that the wrong banner is on
// the screen; a unit test of the warning list would not have seen step 4 at all.
//
// PORTED FROM THE STAGING COPY, which carries the identical afterLog. MOCKED FIRESTORE ONLY --
// this is the production repo and `caretracker_entries` is a real person's medical history. The
// stub below is an in-memory store; nothing here can reach a network, and the context aborts every
// request that is not the local page.
//
// Run:  node harness/warning-priority-test.mjs [--file <index.html>] [--shots <dir>]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright',
    '/home/claude/.npm-global/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found');
})();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1] : path.join(HERE, '..', 'index.html');
const SHOTS = argv.indexOf('--shots') >= 0 ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const html = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

// THE CLOCK IS FROZEN AT 22:30. Not a convenience -- the whole scenario depends on the hour:
// Iron's only window is 22:00-24:00, so the evening "Take all" this defect travels through does
// not exist at any other time of day. Run against the wall clock, this suite would pass by never
// reaching the bug for 22 hours out of 24. That is exactly how the ChemoWell port of a sibling
// suite went vacuous and let a mutant through.
const FROZEN = (() => { const d = new Date(); d.setHours(22, 30, 0, 0); return d.getTime(); })();
const AT = (h, m) => { const d = new Date(FROZEN); d.setHours(h, m || 0, 0, 0); return d.getTime(); };

// MOCKED FIRESTORE, never the real one (hard rule 4). Entries are seeded into the in-memory store
// before the app subscribes, so the app loads a day that is already most of the way to the ceiling
// -- the state the defect needs, and tedious to reach by tapping.
const mkStub = (seed) => `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));eL.forEach(f=>f(snap(store.entries)));return{id:'a'+n};}
export async function deleteDoc(){} export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
`;
const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;

// THE APP REFUSES A DOSE THAT WOULD CROSS THE CEILING -- the dose chip reads "1000 mg . over
// limit" and only toasts how much is left. So the only way a caregiver reaches an acetaminophen
// overdose in this app at all is the OVERRIDE path: the day is already AT the 2,500 mg limit, the
// card is locked, and tapping it offers "Log 1000 mg now" anyway. That is the route this suite
// takes, because it is the only one that exists.
//
// BOTH LOCKS ON THE TYLENOL CARD MATTER, and getting them wrong made four earlier versions of this
// suite accuse the app of a defect the fixture had:
//   * the CEILING lock (`used >= max`) -- wanted here, it is what opens the override;
//   * the GAP lock -- Tylenol waits four hours between doses, and it hides the override behind a
//     countdown instead, so the last seeded dose has to be well over four hours old.
// So: 2,500 mg, the last of it at 16:00, against a frozen 22:30.
// Protonix at 22:00 puts an Iron dose logged now inside the two-hour interaction window.
const SEED = [
  { id: 's1', medId: 'tylenol', kind: 'med', ts: AT(12, 0), dose: '1000 mg', mg: 1000 },
  { id: 's2', medId: 'tylenol', kind: 'med', ts: AT(14, 0), dose: '1000 mg', mg: 1000 },
  { id: 's3', medId: 'tylenol', kind: 'med', ts: AT(16, 0), dose: '500 mg', mg: 500 },
  { id: 's4', medId: 'protonix', kind: 'med', ts: AT(22, 0), dose: null, mg: 0 }
];

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';

// One page per scenario, each with its own seeded store, so a section never inherits the entries or
// the dismissed banner of the one before it.
const newPage = async (seed, medConfig) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await c.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
    if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: mkStub(seed) });
    if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort();
  });
  const p = await c.newPage();
  const e = [];
  p.on('pageerror', err => e.push(String(err)));
  await p.addInitScript(({ v, frozen, cfg }) => {
    try {
      localStorage.setItem('caretracker-seen-version', v);
      if (cfg) {
        // Written in the exact shape the in-app medication editor writes -- { version, meds, ... },
        // a whole LIST. An earlier version of this file wrote a per-medication map instead, which
        // `loadMedicationConfig` rejects outright (`!Array.isArray(saved.meds)`) and silently falls
        // back to the defaults: the fixture configured nothing and the check still ran. Medications
        // left out here are restored from the defaults by `mergeMissingDefaultMeds`.
        localStorage.setItem('caretracker-medication-config-v1',
          JSON.stringify({ version: 1, meds: cfg, archivedMeds: [] }));
      }
    } catch (err) {}
    const R = Date;
    const D = function (...a) { return a.length ? new R(...a) : new R(frozen); };
    D.now = () => frozen; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
    window.Date = D;
  }, { v: VER, frozen: FROZEN, cfg: medConfig || null });
  await p.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2600);
  return { page: p, ctx: c, errs: e };
};

const shot = async (pg, n) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, n + '.png') }); };

// THE BANNER AS THE CAREGIVER SEES IT. Read from the live DOM, matched on the warning's own title
// text -- never document.body.textContent, which in a single-file app contains the source and so
// matches every string a check could look for.
const banner = (pg) => pg.evaluate(() => {
  const el = [...document.querySelectorAll('div')]
    .find(d => /ceiling exceeded|daily limit exceeded|Iron \+ Protonix timing/.test(d.innerText || '')
      && (d.innerText || '').length < 700);
  if (!el) return null;
  const txt = el.innerText || '';
  return { red: /ceiling exceeded|daily limit exceeded/.test(txt), amber: /Iron \+ Protonix timing/.test(txt),
           head: (txt.split('\n').filter(Boolean)[1] || txt).slice(0, 70) };
});
// The banner's close control is a bare "x" with no label of its own, so it is found through the
// banner rather than by name.
const dismiss = async (pg) => {
  await pg.evaluate(() => {
    const el = [...document.querySelectorAll('div')]
      .find(d => /ceiling exceeded|daily limit exceeded|Iron \+ Protonix timing/.test(d.innerText || '')
        && (d.innerText || '').length < 700);
    const host = el && el.closest('div[style*="border-radius: 16px"]') || (el && el.parentElement);
    const b = host && [...host.querySelectorAll('button')].pop();
    if (b) b.click();
  });
  await pg.waitForTimeout(500);
};
const tap = async (pg, re) => {
  const b = pg.getByRole('button', { name: re });
  await b.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (!(await b.count())) return false;
  await b.last().click();
  await pg.waitForTimeout(700);
  return true;
};
// "Take all" on the card that actually contains Iron. Buspirone and Paroxetine share a window that
// is also open at 22:30, so there are TWO "Take all (2)" buttons on Home and picking the wrong one
// logs the morning pair and never reaches the interaction at all.
const takeAllWithIron = (pg) => pg.evaluate(() => {
  for (const sec of document.querySelectorAll('section')) {
    const txt = sec.innerText || '';
    if (!/\bIron\b/.test(txt)) continue;
    const b = [...sec.querySelectorAll('button')].find(x => /^Take all/i.test((x.innerText || '').trim()));
    if (b) { b.click(); return (b.innerText || '').trim(); }
  }
  return null;
});
// The Tylenol dose modal REFUSES TO LOG WITHOUT A PAIN SCORE and says so in a toast -- which is why
// four earlier versions of this suite reported findings about screens they never reached. The
// refusal is correct behaviour (`painScale: true`); the suite simply has to answer it.
// Set through a real `change` event rather than Playwright's selectOption: the app re-renders on a
// one-second tick and rebuilds the <select> each time, so a locator resolved a moment ago is
// detached before the option can be chosen. The handler reads `e.target.value` and writes state
// directly, which is exactly what this does.
const setPain = async (pg, n) => {
  const done = await pg.evaluate((v) => {
    const sel = [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => /worst/.test(o.textContent || '')));
    if (!sel) return 'no-select';
    if (![...sel.options].some(o => o.value === String(v))) return 'no-option';
    sel.value = String(v);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  }, n);
  await pg.waitForTimeout(300);
  return done;
};

console.log('\n1. THE APP LOADS BELOW THE CEILING AND ONE MORE DOSE CROSSES IT');
const A = await newPage(SEED);
{
  t('no page error on load', A.errs.length === 0, A.errs.join(' | '));
  const b0 = await banner(A.page);
  t('nothing is warning yet', b0 === null, JSON.stringify(b0));
  // The card is locked on the ceiling, so this opens the override popover, not the dose modal.
  const card = await tap(A.page, /^1000 mg$/);
  t('the Tylenol 1000 mg button was reachable on Home', card === true);
  const over = await tap(A.page, /^Log 1000 mg now$/);
  t('the app offered the override rather than logging it silently', over === true);
  const pain = await setPain(A.page, 3);
  t('the dose modal opened and asked for a pain score', pain === 'ok', String(pain));
  const ok = await tap(A.page, /^Confirm$/);
  await A.page.waitForTimeout(1800);
  await shot(A.page, '01-red-banner');
  const b1 = await banner(A.page);
  t('Confirm was there', ok === true);
  t('the RED acetaminophen ceiling warning is on screen', !!b1 && b1.red && !b1.amber, JSON.stringify(b1));
}

console.log('\n2. AND AN AMBER TIMING NOTICE DOES NOT REPLACE IT');
{
  // Exactly what "Take all" does: log Iron while Protonix is inside the two-hour window, without
  // the caregiver dismissing the red banner first. THIS IS THE DEFECT.
  const took = await takeAllWithIron(A.page);
  t('a Take all control was found on the card holding Iron', took !== null, String(took));
  await A.page.waitForTimeout(800);
  await tap(A.page, /^Confirm$/);
  await A.page.waitForTimeout(1800);
  await shot(A.page, '02-after-take-all');
  const b2 = await banner(A.page);
  t('the red overdose warning is STILL the one on screen', !!b2 && b2.red && !b2.amber, JSON.stringify(b2));
  await A.ctx.close();
}

console.log('\n3. THE AMBER NOTICE STILL WORKS ON ITS OWN');
{
  // Without this, section 2 would pass just as well on a build that never raised the amber warning
  // at all -- which is a way of "fixing" it that loses a real interaction warning. Fresh page, no
  // Tylenol anywhere near the day, Protonix half an hour ago.
  const B = await newPage([{ id: 'p1', medId: 'protonix', kind: 'med', ts: AT(22, 0), dose: null, mg: 0 }]);
  const took = await takeAllWithIron(B.page);
  await B.page.waitForTimeout(800);
  await tap(B.page, /^Confirm$/);
  await B.page.waitForTimeout(1800);
  await shot(B.page, '03-amber-alone');
  const b3 = await banner(B.page);
  t('no page error in the amber-only fixture', B.errs.length === 0, B.errs.join(' | '));
  t('the evening batch was taken', took !== null, String(took));
  t('with no red on screen, the Iron + Protonix notice is shown', !!b3 && b3.amber && !b3.red, JSON.stringify(b3));
  await B.ctx.close();
}

console.log('\n4. "TAKE ALL" ASKS ABOUT EVERY MEDICATION IN THE BATCH, NOT JUST IRON');
{
  // The second defect. `if (ids.includes('iron'))` meant a batch that pushed some OTHER medication
  // over its own configured daily limit raised no warning whatsoever. Compazine rides in the same
  // evening batch as Iron; give it a caregiver-set ceiling of two pills a day and a two-pill dose,
  // log one pill at 9am, then take the batch -- three pills against a limit of two. No Protonix in
  // this fixture, so nothing amber can mask the answer.
  const C = await newPage(
    [{ id: 'c1', medId: 'compazine', kind: 'med', ts: AT(9, 0), dose: '1 pill', mg: 0, pills: 1 }],
    [{ id: 'compazine', name: 'Compazine', sub: 'Prochlorperazine', type: 'gap', gapH: 6,
       ceiling: true, ceilingMax: 2, ceilingUnit: 'pills',
       doses: [{ label: '2 pills', pills: 2, mg: 0 }],
       note: '10 PM \u00b7 earlier as needed \u00b7 min 6h gap' }]);
  const took = await takeAllWithIron(C.page);
  await C.page.waitForTimeout(800);
  await tap(C.page, /^Confirm$/);
  await C.page.waitForTimeout(2200);
  await shot(C.page, '04-batch-ceiling');
  const b4 = await banner(C.page);
  t('no page error in the batch fixture', C.errs.length === 0, C.errs.join(' | '));
  t('the evening batch was taken', took !== null, String(took));
  t('a batch that crosses another medication\'s own daily limit warns about it',
    !!b4 && b4.red && /Compazine/i.test(b4.head), JSON.stringify(b4));
  await C.ctx.close();
}

console.log('\n5. ONE DOSE THAT EARNS BOTH WARNINGS SHOWS THE RED ONE');
{
  // WITHOUT THIS SECTION the suite passes on a build that just shows whichever warning it collected
  // first. Every other fixture produces at most one warning per dose, so "show the worst" and "show
  // the first" are indistinguishable -- a mutation replacing the whole priority rule with
  // `warnings[0]` survived all four sections above.
  // One Iron dose, in the batch, earning both at once: a caregiver-set ceiling of two pills with
  // one already taken today (the batch adds two more), and Protonix half an hour ago.
  const D = await newPage(
    [{ id: 'i1', medId: 'iron', kind: 'med', ts: AT(9, 0), dose: '1 pill', mg: 0, pills: 1 },
     { id: 'p1', medId: 'protonix', kind: 'med', ts: AT(22, 0), dose: null, mg: 0 }],
    [{ id: 'iron', name: 'Iron', sub: 'Ferrous sulfate', type: 'win', alerts: true,
       eveningLinkedToProtonix: true, ceiling: true, ceilingMax: 2, ceilingUnit: 'pills',
       doses: [{ label: '2 pills', pills: 2, mg: 0 }],
       windows: [{ start: 22, end: 24, name: 'Night' }], note: 'Once daily · with Protonix' }]);
  const took = await takeAllWithIron(D.page);
  await D.page.waitForTimeout(800);
  await tap(D.page, /^Confirm$/);
  await D.page.waitForTimeout(2200);
  await shot(D.page, '05-both-warnings');
  const b5 = await banner(D.page);
  t('no page error in the both-warnings fixture', D.errs.length === 0, D.errs.join(' | '));
  t('the evening batch was taken', took !== null, String(took));
  t('the same dose earns an interaction notice and a ceiling breach, and the RED one is shown',
    !!b5 && b5.red && !b5.amber && /Iron daily limit exceeded/i.test(b5.head), JSON.stringify(b5));
  await D.ctx.close();
}

await browser.close();
server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
process.exit(fail ? 1 : 0);
