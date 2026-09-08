// remove-group-test.mjs -- v73. Removing a CORRECTED reading must not bring the old number back.
//
// WHAT IT PROVES. On Home's journal and in History the row standing on a corrected weight or
// paracentesis IS the correction. Before v73 its Remove hard-deleted that one document, and INSIDE
// 48 HOURS the rules allow that -- so the delete succeeded and the group fell back to the value it
// superseded. She removes a reading and the wrong number returns.
//
// THE SEED IS DELIBERATELY TODAY, not old. Every other suite here seeds records past the 48-hour
// window because that is where a delete is REFUSED. This defect needs the opposite: the one window
// where the delete WORKS is the window where it does damage. A suite that seeded old records would
// have gone green on the broken build -- the v66 Weight mistake exactly, tested in the one state no
// real device is in.
//
// The stub refuses deletes older than 48h as the rules do, and RECORDS every attempt.
//
// Run:  node harness/remove-group-test.mjs [--file <index.html>]
// Falsified 2026-09-08 against outputs/rollback-v72/index.html (counts in the release notes).
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
// The Designer's evidence: a picture of each state this release changes, taken by the same run that
// asserts on it, so the screenshot and the check can never describe different builds.
const SHOTS = argv.indexOf('--shots') >= 0 ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const baseHtml = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

// ---- freeze the app clock at 15:00 today ---------------------------------------------------------
const at = new Date(); at.setHours(15, 0, 0, 0);
const NOW = at.getTime();
const i0 = baseHtml.indexOf('function simNow()');
if (i0 < 0) { console.error('simNow not found'); process.exit(4); }
const brace = baseHtml.indexOf('{', i0);
let depth = 0, end = -1;
for (let k = brace; k < baseHtml.length; k++) {
  if (baseHtml[k] === '{') depth++;
  else if (baseHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const html = baseHtml.slice(0, i0) + 'function simNow() { return ' + NOW + '; }' + baseHtml.slice(end + 1);
if (!html.includes('return ' + NOW)) { console.error('clock freeze failed'); process.exit(4); }

// ---- seed: a corrected weight and a corrected paracentesis, BOTH TODAY ----------------------------
const H = 3600000;
// BOTH CORRECTIONS ARE STAMPED AHEAD OF THE REAL WALL CLOCK, and this is the whole guard.
// The app's tombstone uses Math.max(Date.now(), previousStamp + 1) so it can never lose the tie; a
// build that used a bare Date.now() must lose it. The FIRST version of this suite derived the
// correction's stamp from the FROZEN 15:00 app clock -- which is only ahead of Date.now() while the
// real time is before noon, so after lunch the bare-Date.now() bug passed this suite 20/20. The Zero
// Day Audit caught that and it is the project's oldest failure class: a check that cannot fail.
// Deriving the stamp from the REAL clock makes the check hour-independent, which is proved by
// running the reverted build with Date.now() shifted forward and watching it stay red.
// Ahead of BOTH clocks: the frozen 15:00 app clock the other seeds derive from, and the real wall
// clock the app stamps a tombstone with. Deriving it from only one of them fails at some hours --
// from the app clock alone the bug passes after noon (what the audit caught); from the real clock
// alone the seeded ORIGINAL outranks the correction before 09:00 and the suite red-herrings.
const AHEAD = Math.max(NOW, Date.now()) + 6 * H;
const seed = [
  // 156.2 was typed wrong and corrected to 142.0 an hour later. Same weightId = one weigh-in.
  { id: 'seed_w_orig', medId: 'weight', weightId: 'w_group_1', weight: 156.2, dose: '156.2 lbs', mg: 0, ts: NOW - 5 * H, loggedAt: NOW - 5 * H },
  { id: 'seed_w_corr', medId: 'weight', weightId: 'w_group_1', weight: 142.0, dose: '142 lbs (corrected)', mg: 0, ts: NOW - 5 * H, loggedAt: AHEAD },
  // 4.0 L corrected to 4.5 L. Same paraId = one procedure.
  { id: 'seed_p_orig', medId: 'paracentesis', paraId: 'p_group_1', liters: 4.0, dose: '4.0 L', mg: 0, ts: NOW - 6 * H, loggedAt: NOW - 6 * H },
  { id: 'seed_p_corr', medId: 'paracentesis', paraId: 'p_group_1', liters: 4.5, dose: '4.5 L', mg: 0, ts: NOW - 6 * H, loggedAt: AHEAD },
  // AN ORDINARY DOSE. Its Remove must still be a plain delete -- the fix must not swallow the normal
  // path, which is the way a narrow fix usually breaks something.
  { id: 'seed_dose', medId: 'compazine', dose: '10 mg', mg: 10, ts: NOW - 2 * H }
];
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;const NOW=${NOW};
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));push();return{id:'a'+n};}
export async function deleteDoc(ref){const id=ref&&ref.id;const hit=store.entries.find(e=>String(e.id)===String(id));
 globalThis.__deleted.push({id:String(id),medId:hit?hit.medId:null});
 if(hit&&(NOW-hit.ts)>48*3600000){const err=new Error('Missing or insufficient permissions.');err.code='permission-denied';throw err;}
 store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entries=()=>JSON.parse(JSON.stringify(store.entries));
globalThis.__deleted=[];
`;
const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
  if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stubFs });
  if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const entries = () => page.evaluate(() => globalThis.__entries());
const deleted = () => page.evaluate(() => globalThis.__deleted.slice());
const clickText = async (re) => page.evaluate(([src, flags]) => {
  const rx = new RegExp(src, flags);
  const b = [...document.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; } return false;
}, [re.source, re.flags]);
const nav = async (label) => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
  await page.waitForTimeout(300);
  const ok = await clickText(new RegExp('^' + label));
  await page.waitForTimeout(500);
  return ok;
};
const openReport = async (label) => { await nav('Reports'); const ok = await clickText(new RegExp('^' + label)); await page.waitForTimeout(600); return ok; };
// Remove -> Delete on one History row, addressed by the document id it was rendered from.
const removeHistoryRow = async (id) => {
  const armed = await page.evaluate((docId) => {
    const b = [...document.querySelectorAll('[data-history-row="' + docId + '"] button')].find(x => /^Remove$/.test((x.innerText || '').trim()));
    if (b) { b.click(); return true; } return false;
  }, id);
  if (!armed) return false;
  await page.waitForTimeout(300);
  await page.evaluate((docId) => {
    const b = [...document.querySelectorAll('[data-history-row="' + docId + '"] button')].find(x => /^Delete$/.test((x.innerText || '').trim()));
    if (b) b.click();
  }, id);
  await page.waitForTimeout(700);
  return true;
};

// ==================================================================================================
console.log('\n1. The corrected weight, before anything is touched');
{
  await openReport('Weight');
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-weight-row]')].map(r => r.getAttribute('data-weight-row')));
  t('the Weight report shows ONE reading for the corrected weigh-in', rows.length === 1 && rows[0] === 'w_group_1', JSON.stringify(rows));
  const txt = await page.evaluate(() => { const r = document.querySelector('[data-weight-row]'); return r ? (r.innerText || '') : ''; });
  t('it shows the corrected 142, not the mistyped 156.2', /142/.test(txt) && !/156/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 60));
}

console.log('\n2. History offers Remove on the correction only, never on the row it replaced');
{
  await openReport('History');
  const onCorr = await page.evaluate(() => !![...document.querySelectorAll('[data-history-row="seed_w_corr"] button')].find(b => /^Remove$/.test((b.innerText || '').trim())));
  const onOrig = await page.evaluate(() => !![...document.querySelectorAll('[data-history-row="seed_w_orig"] button')].find(b => /^Remove$/.test((b.innerText || '').trim())));
  t('the standing correction row offers Remove', onCorr, '');
  t('the superseded original offers NO Remove', !onOrig, 'a Remove on a row nothing reads deletes a document for no reason');
  const stale = await page.evaluate(() => { const c = document.querySelector('[data-history-row="seed_w_orig"] [data-history-stale]'); return c ? c.getAttribute('data-history-stale') : null; });
  t('the superseded original is still listed, marked Superseded', stale === 'superseded', 'stale=' + stale);
  await shot('1-history-corrected-weight');
}

console.log('\n3. THE DEFECT: removing the corrected weight must not bring 156.2 back');
{
  const before = (await entries()).length;
  const did = await removeHistoryRow('seed_w_corr');
  t('Remove -> Delete could be tapped on the correction', did, '');
  t('nothing was deleted, or even attempted', (await deleted()).length === 0, JSON.stringify(await deleted()));
  const all = await entries();
  t('a tombstone was APPENDED instead', all.length === before + 1 && all.slice(-1)[0].cancelled === true && all.slice(-1)[0].weightId === 'w_group_1',
    all.length + ' entries, newest ' + JSON.stringify(all.slice(-1)[0] || {}).slice(0, 90));
  // The WEIGHT stamp guard, asserted directly — the mirror of the paracentesis one in section 4.
  // Without it the weight guard was only ever tested through its effect on a screen, which the
  // delta audit pointed out as an asymmetry: the weight mutant scored 20/21 where the para mutant
  // scored 19/21, and the missing point was this assertion.
  const wTomb = all.slice(-1)[0];
  t('the weight tombstone is stamped strictly newer than the record it removes', wTomb && wTomb.loggedAt > AHEAD,
    wTomb ? ('loggedAt=' + wTomb.loggedAt + ' vs correction ' + AHEAD) : 'no tombstone');
  await openReport('Weight');
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-weight-row]')].length);
  t('the weigh-in is GONE from the Weight report — the old 156.2 did not take its place', rows === 0, rows + ' row(s) still shown');
  const body = await page.evaluate(() => { const g = document.querySelector('[data-weight-row]'); return g ? (g.innerText || '') : ''; });
  t('no 156.2 anywhere in the readings list', !/156/.test(body), body.replace(/\s+/g, ' ').slice(0, 60));
  await shot('2-weight-report-after-remove');
}

console.log('\n4. The same for a corrected paracentesis');
{
  await openReport('Paracentesis');
  const before0 = await page.evaluate(() => [...document.querySelectorAll('[data-para-row]')].length);
  t('the Paracentesis report shows ONE procedure for the corrected drain', before0 === 1, before0 + ' row(s)');
  await openReport('History');
  const before = (await entries()).length;
  const did = await removeHistoryRow('seed_p_corr');
  t('Remove -> Delete could be tapped on the corrected paracentesis', did, '');
  t('still nothing deleted', (await deleted()).length === 0, JSON.stringify(await deleted()));
  const all = await entries();
  t('a paracentesis tombstone was appended', all.length === before + 1 && all.slice(-1)[0].cancelled === true && all.slice(-1)[0].paraId === 'p_group_1',
    all.length + ' entries');
  // THE STAMP GUARD, asserted directly rather than only through its effect on the screen. The
  // correction is stamped ahead of the wall clock, so a bare Date.now() tombstone comes out OLDER
  // than what it removes and the procedure survives.
  const tomb = (await entries()).slice(-1)[0];
  t('the tombstone is stamped strictly newer than the record it removes', tomb && tomb.loggedAt > AHEAD,
    tomb ? ('loggedAt=' + tomb.loggedAt + ' vs correction ' + AHEAD) : 'no tombstone');
  await openReport('Paracentesis');
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-para-row]')].length);
  t('the procedure is GONE — the 4.0 L it replaced did not come back', rows === 0, rows + ' row(s) still shown');
  await shot('3-para-report-after-remove');
}

console.log('\n5. The ordinary path is untouched: a dose still deletes');
{
  await openReport('History');
  const before = (await entries()).length;
  const did = await removeHistoryRow('seed_dose');
  t('Remove -> Delete could be tapped on an ordinary dose', did, '');
  const dels = await deleted();
  t('THAT one really was deleted — the fix did not swallow the normal path', dels.length === 1 && dels[0].id === 'seed_dose', JSON.stringify(dels));
  const all = await entries();
  t('the dose document is gone, and no tombstone was invented for it', all.length === before - 1 && !all.some(e => e.id === 'seed_dose'),
    before + ' -> ' + all.length);
}

console.log('\n-- nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
t('exactly one delete in the whole run, and it was the ordinary dose', (await deleted()).length === 1, JSON.stringify(await deleted()));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
process.exit(fail ? 1 : 0);
