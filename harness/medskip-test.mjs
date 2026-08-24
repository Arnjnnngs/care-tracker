/**
 * medskip-test.mjs — a restore never leaves the medication list behind in silence.
 *
 * Aaron, 2026-08-22: "there isn't a way to backup the list of meds someone has."
 *
 * It IS backed up, and always was. The defect was on the way back in: the incoming list is only
 * applied to a phone that has never saved one, and on any other phone it was dropped WITHOUT A
 * WORD. The summary said "Restored N records... Nothing was removed" while a medication list sat
 * in the file, unused. That silence is what made Aaron conclude it was never saved at all.
 *
 * These checks pin the disclosure and the way out of it, and — the one that matters most —
 * that taking that way out never touches a single logged dose.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, service worker blocked, catch-all abort.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i+1] : null; };
const APP_FILE = arg('--file') || path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;const deletes=[];
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));},
 entries(){return store.entries.map(e=>Object.assign({},e));}, deletes(){return deletes.slice();}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
// A REAL setDoc. bkRestore writes with setDoc(doc(db,COL,id), fields) so a restore keeps each
// record's original document id and is therefore idempotent. An empty stub here made every
// restored record vanish, and the summary still said it had restored them -- so SKIP-6 was
// measuring the stub, not the app.
export async function setDoc(ref,data){
  const id=ref&&ref.id; if(!id) return;
  const at=store.entries.findIndex(e=>e.id===id);
  if(at>=0) store.entries[at]=Object.assign({id:id},data); else store.entries.push(Object.assign({id:id},data));
  for(const cb of eL)cb(snap(store.entries));
}
export async function deleteDoc(ref){deletes.push(ref&&ref.id);}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 260));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [], errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const at = new Date(); at.setHours(14, 0, 0, 0);

const i = rawHtml.indexOf('function simNow()');
const brace = rawHtml.indexOf('{', i);
let depth = 0, end = -1;
for (let k = brace; k < rawHtml.length; k++) {
  if (rawHtml[k] === '{') depth++;
  else if (rawHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const html = rawHtml.slice(0, i) + 'function simNow() { return ' + at.getTime() + '; }' + rawHtml.slice(end + 1);

const server = http.createServer((rq,rs)=>{ if(rq.url.startsWith('/index.html')){rs.writeHead(200,{'Content-Type':'text/html'});rs.end(html);return;} rs.writeHead(404);rs.end(); }).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const PORT = server.address().port;
const ctx = await browser.newContext({ viewport:{width:375,height:812}, serviceWorkers:'block' });
await ctx.route('**/*',(route)=>{ const u=route.request().url();
  if(u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if(u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
  if(u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if(u.startsWith('http://127.0.0.1:'+PORT)) return route.continue();
  if(u.startsWith('https://fonts.')) return route.abort();
  escaped.push(u); return route.abort(); });
const page = await ctx.newPage();
page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1100);

// Give this phone its OWN saved medication list, which is the whole precondition: the incoming
// list is only ever declined on a phone that already keeps one.
await page.evaluate(() => {
  localStorage.setItem('caretracker-medication-config-v1', JSON.stringify({
    version: 1,
    meds: [{ id: 'protonix', name: 'Protonix', generic: 'Pantoprazole', doses: [{ label: '40 mg', mg: 40 }] }],
    archivedMeds: {}
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1300);
await page.evaluate((ts) => globalThis.__mc.pushEntry({ medId:'protonix', dose:'40 mg', mg:40, ts }), at.getTime() - 7200000);
await page.waitForTimeout(1000);

// A backup file carrying a DIFFERENT, larger medication list.
const backup = {
  // 'care-tracker-backup' with the hyphen. The first version of this file used
  // 'caretracker-backup' and every check downstream failed on "That doesn't look like a CareTracker
  // backup" -- the payload was rejected before a single line of the code under test ran.
  format: 'care-tracker-backup', formatVersion: 1, app: 'v55', patient: 'Test',
  createdAt: at.getTime(),
  entries: [{ id: 'imported1', medId: 'protonix', dose: '40 mg', mg: 40, ts: at.getTime() - 86400000 }],
  appointments: [], prefs: null,
  medications: { version: 1, archivedMeds: {}, meds: [
    { id: 'protonix', name: 'Protonix', generic: 'Pantoprazole', doses: [{ label: '40 mg', mg: 40 }] },
    { id: 'zofran',  name: 'Zofran',  generic: 'Ondansetron',  doses: [{ label: '8 mg', mg: 8 }] },
    { id: 'senokot', name: 'Senokot', generic: 'Senna',        doses: [{ label: '2 pills', mg: 0 }] }
  ] }
};

const loadBackup = async () => {
  await page.evaluate(async (payload) => {
    const b = document.querySelector('[data-backup-restore]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 350));
    const inp = document.querySelector('input[type="file"]');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2200));
  }, backup);
};
const notice = () => page.evaluate(() => {
  const n = document.querySelector('[data-backup-notice]'); return n ? n.innerText : null; });
const medNames = () => page.evaluate(() => {
  const raw = localStorage.getItem('caretracker-medication-config-v1');
  return raw ? JSON.parse(raw).meds.map(m => m.id).sort() : null; });

console.log('\nRESTORE — the medication list is never left behind in silence\n');

await run('SKIP-1-restore-runs',
  'the backup loads and its records come in', async () => {
  await page.evaluate(async () => {
    // v58 moved the backup, its password and the share control out of Reports and into a new
    // Settings screen (Aaron: "all the backup stuff shouldn't live under reports"). Settings is a
    // drawer destination, not a bottom-nav tab -- renderBottomNav hardcodes a five-column grid.
    const m = document.querySelector('[data-cal-menu-button]');
    if (m) m.click();
    await new Promise(r => setTimeout(r, 450));
    const s = document.querySelector('[data-cal-drawer-item="settings"]');
    if (s) { s.click(); await new Promise(r => setTimeout(r, 900)); }
    else { const c = document.querySelector('[data-cal-drawer-close]'); if (c) c.click(); await new Promise(r => setTimeout(r, 300)); }
  });
  await loadBackup();
  const n = await notice();
  assert(n, 'no restore summary appeared');
  assert(/restored/i.test(n), 'the restore did not report adding anything: ' + brief(n));
});

await run('SKIP-2-says-the-list-was-left-alone',
  'the summary states the medication list was not applied, and how many the file holds', async () => {
  const n = await notice();
  assert(/medication list was left/i.test(n),
    'the summary is silent about the medication list — this is the defect: ' + brief(n));
  assert(/3 medications/i.test(n),
    'it does not say how many the file holds, so there is nothing to judge: ' + brief(n));
});

await run('SKIP-3-current-list-untouched-by-default',
  'nothing changed on this phone unless asked', async () => {
  const ids = await medNames();
  assert(JSON.stringify(ids) === JSON.stringify(['protonix']),
    'the restore replaced the medication list without being asked: ' + JSON.stringify(ids));
});

await run('SKIP-4-replacing-takes-two-taps',
  'using the file list asks once and says what happens', async () => {
  await page.evaluate(async () => {
    const b = document.querySelector('[data-medlist-offer]');
    if (b) b.click(); await new Promise(r => setTimeout(r, 500));
  });
  const c = await page.evaluate(() => {
    const el = document.querySelector('[data-medlist-confirm]'); return el ? el.innerText : null; });
  assert(c, 'there is no offer to use the file’s list at all');
  assert(/replaced/i.test(c), 'the confirmation does not say the current list is replaced: ' + brief(c));
  assert(/history changes|stays exactly/i.test(c),
    'it does not reassure that logged doses are untouched, which is the thing people fear: ' + brief(c));
  const ids = await medNames();
  assert(JSON.stringify(ids) === JSON.stringify(['protonix']),
    'the list changed merely by opening the confirmation');
});

await run('SKIP-5-applying-brings-the-list-in',
  'confirming uses the file’s medications', async () => {
  await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find(x => /Use the file/i.test(x.textContent));
    if (b) b.click(); await new Promise(r => setTimeout(r, 1200));
  });
  const ids = await medNames();
  assert(ids && ids.includes('zofran') && ids.includes('senokot'),
    'the file’s medications did not come in: ' + JSON.stringify(ids));
});

await run('SKIP-6-doses-are-never-touched',
  'replacing the medication list writes and deletes no dose records', async () => {
  const dels = await page.evaluate(() => globalThis.__mc.deletes());
  assert(dels.length === 0, 'deleteDoc was called ' + dels.length + ' time(s) while changing a medication list');
  const rows = await page.evaluate(() => globalThis.__mc.entries().filter(e => e.medId === 'protonix'));
  assert(rows.length === 2,
    'the logged doses changed while swapping the medication list — expected the seeded one plus the imported one, got ' + rows.length);
});

await run('SKIP-7-offer-does-not-linger',
  'the offer disappears once used, so a later restore cannot reapply an old file', async () => {
  // Precondition. Without it this passes VACUOUSLY on a build where the offer never existed --
  // which is exactly what it did on the first run of this file.
  const ids = await medNames();
  assert(ids && ids.includes('zofran'),
    'precondition failed: the file list was never applied, so "it disappeared" proves nothing');
  const still = await page.evaluate(() => !!document.querySelector('[data-medlist-offer]') || !!document.querySelector('[data-medlist-confirm]'));
  assert(!still, 'the offer is still on screen after being used');
});

await run('SKIP-8-apply-path-cannot-touch-doses',
  'no dose write exists anywhere in the apply path', () => {
  const seg = (rawHtml.match(/function applyPendingMedList[\s\S]*?\n\}/) || [''])[0];
  assert(seg, 'applyPendingMedList not found');
  assert(!/addEntryDB|removeEntryDB|deleteDoc/.test(seg),
    'the apply path can write or delete dose records');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1 and the stubs',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});
await run('NET-2','no page errors',()=>{ assert(errs.length===0, errs.slice(0,2).join(' | ')); });

await browser.close(); server.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
