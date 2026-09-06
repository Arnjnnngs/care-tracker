/**
 * audit-v69-weightreport.mjs — ZERO DAY AUDIT, v69 second pass.
 *
 * HYPOTHESIS: the printable oncologist report's "Net weight change" tile reads RAW weight
 * documents (allExportEntries().filter(medId==='weight')), not weightResolved(). v69 introduces
 * superseding corrections and tombstones into that document set for the first time, so a
 * correction or a removal changes a CLINICAL NUMBER in the document handed to a doctor.
 *
 * Asserts on the DOWNLOADED FILE BYTES, never on the screen.
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/audit-v69-weightreport.mjs
 */
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
    '/opt/node22/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found');
})();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1]
                                             : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }
const html = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (n, c, d) => { console.log('  ' + (c ? 'PASS  ' : 'FAIL  ') + n + (d ? '  |  ' + d : '')); c ? pass++ : fail++; };

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const DAY = 86400000, NOW = Date.now();
// Two readings, both far past the 48h delete window, as every reading on Brandi's phone is.
// The OLDER one carries a typo: 105.0 where 150.0 was meant. Real weights, real magnitudes.
const seed = [
  { id: 'seed_w_old', medId: 'weight', weight: 105.0, dose: '105.0 lbs', mg: 0, ts: NOW - 20 * DAY },
  { id: 'seed_w_new', medId: 'weight', weight: 140.0, dose: '140.0 lbs', mg: 0, ts: NOW - 2 * DAY }
];
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id||('s_'+e.medId+'_'+e.ts),data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));store.entries.sort((a,b)=>(a.ts||0)-(b.ts||0));push();return{id:'a'+n};}
export async function deleteDoc(ref){globalThis.__deleted.push(String(ref&&ref.id));store.entries=store.entries.filter(e=>String(e.id)!==String(ref&&ref.id));push();}
export async function setDoc(){} export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
globalThis.__deleted=[]; globalThis.__raw=()=>JSON.parse(JSON.stringify(store.entries));
`;
const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  serviceWorkers: 'block', acceptDownloads: true });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs});
  if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
page.on('popup', p => { p.close().catch(()=>{}); });
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const openReport = async (label) => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label')||'')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('Reports')); if (b) b.click(); });
  await page.waitForTimeout(500);
  await page.evaluate((lbl) => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith(lbl)); if (b) b.click(); }, label);
  await page.waitForTimeout(700);
};
const modalOpen = () => page.evaluate(() => !!document.querySelector('input[type="datetime-local"]'));
const confirmModal = async (where) => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Confirm$/i.test((x.innerText||'').trim())); if (b) b.click(); });
  for (let i = 0; i < 30 && await modalOpen(); i++) await page.waitForTimeout(100);
  if (await modalOpen()) throw new Error('modal did not close: ' + where);
  await page.waitForTimeout(500);
};
async function grabReport() {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label')||'')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('Reports')); if (b) b.click(); });
  await page.waitForTimeout(600);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }),
    page.click('[data-backup-btn="report"]')]);
  await page.waitForTimeout(300);
  return fs.readFileSync(await dl.path()).toString('utf-8');
}
const netFromBytes = (txt) => {
  const m = txt.match(/Net weight change<\/span><b>([^<]*)<\/b>/);
  return m ? m[1] : '(tile not found)';
};

console.log('\nBASELINE — before any correction');
let rep = await grabReport();
const net0 = netFromBytes(rep);
t('baseline Net weight change is +35.0 lbs (105.0 -> 140.0, as recorded)', net0 === '+35.0 lbs', 'got ' + JSON.stringify(net0));

console.log('\n1. CORRECT the older reading 105.0 -> 150.0 through the real Edit control');
await openReport('Weight');
const rowsBefore = await page.evaluate(() => document.querySelectorAll('[data-weight-row]').length);
t('two weight rows on the Weight report', rowsBefore === 2, String(rowsBefore));
// Rows render oldest-last (resolved oldest-first then .reverse()), so the 30-day-old one is last.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-weight-row]')];
  const target = rows[rows.length - 1];
  const b = [...target.querySelectorAll('button')].find(x => /^Edit$/i.test((x.innerText||'').trim()));
  if (b) b.click();
});
await page.waitForTimeout(500);
t('the Edit step opened', await modalOpen(), '');
await page.evaluate(() => {
  const inp = [...document.querySelectorAll('input[type="number"]')].find(i => i.closest('div') && /lbs|weight/i.test(i.parentElement ? i.parentElement.innerText : ''));
  const cand = inp || [...document.querySelectorAll('input[type="number"]')][0];
  if (cand) { cand.value = '150'; cand.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.waitForTimeout(200);
await confirmModal('weight-edit');
const rowsAfter = await page.evaluate(() => document.querySelectorAll('[data-weight-row]').length);
t('still two weight rows — the edit superseded, it did not duplicate', rowsAfter === 2, String(rowsAfter));
const shown = await page.evaluate(() => [...document.querySelectorAll('[data-weight-row]')].map(r => (r.innerText||'').split('\n')[0]).join(' | '));
console.log('     rows on screen now: ' + shown);
const deleted = await page.evaluate(() => globalThis.__deleted.slice());
t('NO document was deleted', deleted.length === 0, JSON.stringify(deleted));

console.log('\n2. THE ATTACK — the printable oncologist report, from the downloaded bytes');
rep = await grabReport();
const net1 = netFromBytes(rep);
console.log('     Net weight change tile now reads: ' + JSON.stringify(net1));
t('the report reflects the CORRECTED record (150.0 -> 140.0 = -10.0 lbs)', net1 === '-10.0 lbs',
  'REPORT SAYS ' + JSON.stringify(net1) + ' — the Weight screen shows 150.0 -> 140.0. The doctor gets a different number.');

console.log('\n3. REMOVE the newer reading and re-read the tile');
await openReport('Weight');
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-weight-row]')];
  const b = [...rows[0].querySelectorAll('button')].find(x => /^Remove$/i.test((x.innerText||'').trim()));
  if (b) b.click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-weight-row] button')].find(x => /^Delete$/i.test((x.innerText||'').trim()));
  if (b) b.click();
});
await page.waitForTimeout(900);
const rowsFinal = await page.evaluate(() => document.querySelectorAll('[data-weight-row]').length);
t('one weight row left on screen after Remove', rowsFinal === 1, String(rowsFinal));
rep = await grabReport();
const net2 = netFromBytes(rep);
console.log('     Net weight change tile now reads: ' + JSON.stringify(net2));
t('a REMOVED reading no longer drives the report (one reading left => no net change)', net2 === '—',
  'REPORT SAYS ' + JSON.stringify(net2) + ' — computed from a reading the caregiver deleted.');

fs.writeFileSync(path.join(HERE, '..', 'outputs', 'v69-report-after-edit.html'), rep);
t('no page errors', errs.length === 0, errs.join(' ; '));
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
