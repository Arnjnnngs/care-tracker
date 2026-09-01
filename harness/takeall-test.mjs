/**
 * takeall-test.mjs — "Take all" must log every medication it can, and never lie about what it did.
 *
 * Aaron, 2026-09-01: "it would only log 1 of 2 meds or something like that. that has been annoying
 * me for a long time."
 *
 * He was right, and it was two separate defects in one button:
 *
 *   1. ONE REFUSED WRITE CANCELLED EVERY DOSE BEHIND IT. The loop awaited addEntryDB() with no
 *      catch, so the first refusal threw straight out of the loop. Measured on the shipped v62
 *      build with a single medication refused in the middle of five: ONE dose saved, four lost.
 *   2. AND THEN IT SAID THE OPPOSITE OF THE TRUTH. The banner read "That didn't save. Nothing was
 *      lost — check your connection and log it again." A dose HAD been saved. A caregiver
 *      following that instruction logs it a second time, and a dose that appears twice in a
 *      medication record is not a cosmetic error.
 *
 * A third, quieter one: "Take all" excludes medications that are not due — correctly, since gap
 * timers and daily ceilings exist precisely to stop those — but it did so SILENTLY. The card lists
 * six medications, the button says "Take all (5)", and nothing ever named the one left behind.
 * That is what "only logged 1 of 2" looks like from the outside even when every write succeeds.
 *
 * SAFETY: all three gstatic Firebase modules are stubbed and every other request is aborted.
 * Brandi's real Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/takeall-test.mjs
 *      --file <path>   to point at a scratch copy during falsification
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Resolved from a candidate list, not a pinned path: a pinned one made every browser suite in
// these repos unrunnable the last time the environment moved, and a gate that cannot start is
// indistinguishable from a gate that passes.
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright',
    '/home/claude/.npm-global/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found; tried:\n  ' + tries.join('\n  '));
})();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1]
                                             : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const raw = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
// refuseFor names the medication whose write is refused. Every write is recorded, in order.
const stubFs = (refuseFor) => `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;const writes=[];
const REFUSE=${JSON.stringify(refuseFor)};
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__writes=()=>writes.slice();
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){
  if(REFUSE && (REFUSE==='__all__' || (d && d.medId===REFUSE))) throw new Error('PERMISSION_DENIED (simulated)');
  writes.push(JSON.parse(JSON.stringify(d)));store.entries.push(Object.assign({id:'a'+(++n)},d));
  for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

// NON-LEGACY IDS ON PURPOSE. Seeding 'iron' or 'buspirone' pulls the app's own DEFAULT_MEDS flags
// in through backfillDefaultMedFlags -- including groupedMorning -- so the same medication renders
// on BOTH the Morning and Evening cards, and a document-wide button search then taps the wrong
// card. That cost two wrong diagnoses before it was spotted; it is a fixture trap, not an app bug.
const SEED_MEDS = { version: 1, archivedMeds: [], meds: [
  { id: 'evening-a', name: 'Evening A', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '1 tablet', mg: 0 }], windows: [{ start: 0, end: 24, name: 'All day' }] },
  { id: 'evening-b', name: 'Evening B', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '10 mg', mg: 10 }], windows: [{ start: 0, end: 24, name: 'All day' }] },
  { id: 'evening-c', name: 'Evening C', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '5 mg', mg: 5 }], windows: [{ start: 0, end: 24, name: 'All day' }] }
]};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function takeAll(refuseFor) {
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(raw); return; }
    rs.writeHead(204); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs(refuseFor)});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort(); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(meds => {
    try { localStorage.setItem('caretracker-medication-config-v1', JSON.stringify(meds)); } catch (e) {}
    // So the What's new notice cannot sit over the card this suite has to tap.
    try { localStorage.setItem('caretracker-seen-version', 'already-seen'); } catch (e) {}
  }, SEED_MEDS);
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // SCOPED TO THE EVENING CARD. A document-wide search finds the Morning card's button first.
  const tapped = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('main section')].find(s => /EVENING MEDS/i.test(s.innerText || ''));
    if (!sec) return null;
    const b = [...sec.querySelectorAll('button')].find(x => (x.innerText || '').trim().toLowerCase().startsWith('take all'));
    if (!b) return null;
    const label = b.innerText.trim();
    b.click();
    return { label, onCard: (sec.innerText.match(/\n/g) || []).length };
  });
  await page.waitForTimeout(900);
  // Take all opens the confirmation; Confirm is what writes.
  const confirmed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Confirm');
    if (!b) return false; b.click(); return true;
  });
  await page.waitForTimeout(1600);
  const out = await page.evaluate(() => ({
    writes: globalThis.__writes().map(w => w.medId),
    toast: (document.querySelector('[role="status"]') || {}).innerText || '',
    banner: ((document.querySelector('[role="alert"]') || {}).innerText || '').replace(/\s+/g, ' ').trim()
  }));
  await ctx.close(); server.close();
  return { ...out, tapped, confirmed, errs };
}

console.log('\n1. Nothing refused — every due medication is logged, and anything skipped is NAMED');
{
  const r = await takeAll(null);
  t('the Take all button is on the Evening card', !!r.tapped, r.tapped ? r.tapped.label : 'not found');
  t('the confirmation opened', r.confirmed, '');
  const mine = r.writes.filter(id => String(id).indexOf('evening-') === 0);
  t('all three seeded medications were written', mine.length === 3, r.writes.join(', '));
  t('the caregiver is told it worked', /logged/i.test(r.toast), r.toast || '(no toast)');
  t('no write-failure banner appears when nothing failed', !r.banner, r.banner || '(none)');
  // THE SILENT-SKIP DEFECT. The app's own Iron rides along in this fixture and is never due at the
  // hour this runs ("Opens 10:00 PM"), so Take all always leaves it out. It must be NAMED.
  // Written as a positive assertion on purpose: the first version of this check was
  // `!/not due/.test(toast) || /not due yet/.test(toast)`, which is satisfied by a toast that
  // never mentions it at all -- so it passed on the broken build too. A check with an escape
  // clause is a check that cannot fail.
  t('a medication left out because it is not due is NAMED, not dropped in silence',
    /not due yet/.test(r.toast), r.toast || '(no toast)');
  t('no page errors', r.errs.length === 0, r.errs.join(' / '));
}

console.log('\n2. ONE medication refused — the others must still be saved');
{
  const r = await takeAll('evening-b');
  const mine = r.writes.filter(id => String(id).indexOf('evening-') === 0);
  // THE DEFECT ITSELF. On the shipped v62 build this was 1 of 5: the throw left the loop and every
  // dose behind the refused one was never attempted.
  t('the refused medication did not cancel the ones after it',
    mine.indexOf('evening-c') >= 0, 'written: ' + (r.writes.join(', ') || 'nothing'));
  t('the medication that was refused is genuinely absent', mine.indexOf('evening-b') < 0, mine.join(', '));
  t('and the ones before it are still saved', mine.indexOf('evening-a') >= 0, mine.join(', '));
}

console.log('\n3. And it must never claim nothing was saved when something was');
{
  const r = await takeAll('evening-b');
  t('a banner is shown, not a success toast', !!r.banner, r.banner || '(no banner)');
  // THE SENTENCE THAT CAUSED THE HARM. "Nothing was lost -- log it again" sent the caregiver back
  // to re-log doses that were already written.
  t('it does NOT say nothing was lost', !/nothing was lost/i.test(r.banner), r.banner);
  t('it names the medication that failed', /Evening B/.test(r.banner), r.banner);
  t('it names at least one that succeeded', /Evening A|Evening C/.test(r.banner), r.banner);
  t('it tells the caregiver not to re-log the saved ones',
    /already saved|only the missing/i.test(r.banner), r.banner);
}

console.log('\n4. Everything refused — then "nothing was lost" is TRUE and may be said');
{
  // EVERY write refused. This is the ONLY case where "nothing was lost" is true, and it must still
  // be said here -- the fix must not replace one wrong message with another.
  const r = await takeAll('__all__');
  t('nothing at all was written', r.writes.length === 0, r.writes.join(', ') || '(nothing)');
  t('a banner is shown', !!r.banner, r.banner || '(none)');
  t('and here it MAY say nothing was lost, because that is true',
    /nothing was lost/i.test(r.banner), r.banner);
  t('it does not name anything as saved, because nothing was',
    !/already saved/i.test(r.banner), r.banner);
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
await browser.close();
process.exit(fail ? 1 : 0);
