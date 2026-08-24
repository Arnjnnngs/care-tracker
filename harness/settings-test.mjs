/**
 * settings-test.mjs — the backup lives in Settings, and Settings exists at all.
 *
 * Aaron, 2026-08-22: "all the backup stuff shouldn't live under reports. it should be under
 * settings. and i don't even see a settings tab anymore in caretracker."
 *
 * He was right twice. There has never been a Settings screen in this app — the backup landed under
 * Reports in v43.1 because that is where "save a copy" was built, not because it belonged there.
 *
 * The check that matters most is not that the button moved. It is that someone who has tapped that
 * button every week for months can still find it: Reports must say where it went and get her there
 * in one tap. A move without that is a disappearance, and the thing that disappeared is the only
 * copy of a cancer patient's medical record.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, service worker blocked, catch-all abort.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Playwright's location is environment-specific: the old sandbox kept it under a user-global npm
// prefix, this one ships it alongside node. Resolving a LIST of candidates instead of one pinned
// absolute path is what lets the same suite run in both. The pinned path made all 39 browser
// suites in these three repos unrunnable the moment the environment changed -- a gate that cannot
// start is indistinguishable from a gate that passes, which is the failure Rule 5 is about.
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
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i+1] : null; };
const APP_FILE = arg('--file') || path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function fire(){for(const cb of eL)cb(snap(store.entries));}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));fire();},
 entries(){return store.entries.filter(e=>e.id!=='settings').map(e=>Object.assign({},e));}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));fire();return{id:'a'+n};}
export async function setDoc(ref,d){const id=(ref&&ref.id)||('s'+(++n));const i=store.entries.findIndex(e=>e.id===id);
 if(i>=0)store.entries[i]=Object.assign({id:id},d);else store.entries.push(Object.assign({id:id},d));fire();}
export async function deleteDoc(){} export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 220));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [], errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

const at = new Date(); at.setHours(14, 0, 0, 0);
const i0 = rawHtml.indexOf('function simNow()');
const brace = rawHtml.indexOf('{', i0);
let depth = 0, end = -1;
for (let k = brace; k < rawHtml.length; k++) {
  if (rawHtml[k] === '{') depth++;
  else if (rawHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const html = rawHtml.slice(0, i0) + 'function simNow() { return ' + at.getTime() + '; }' + rawHtml.slice(end + 1);
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
page.on('pageerror', e => { if (!noise(e.message)) errs.push('pageerror: ' + e.message); });
const noise = (t) => /ERR_FAILED|ERR_CERT_AUTHORITY_INVALID|ERR_TUNNEL|ERR_PROXY|Failed to load resource|fonts\.googleapis|fonts\.gstatic/i.test(String(t));
page.on('console', m => { if (m.type() === 'error' && !noise(m.text())) errs.push(m.text()); });
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
await page.evaluate((ts) => {
  globalThis.__mc.pushEntry({ medId:'weight', weight:150, dose:'150 lbs', mg:0, ts });
  globalThis.__mc.pushEntry({ medId:'temp', temp:98.6, dose:'98.6 F', mg:0, ts: ts + 60000 });
}, at.getTime() - 3600000);
await page.waitForTimeout(1200);

const tap = (sel) => page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.click(); return true; } return false; }, sel);
const goDrawer = (view) => page.evaluate(async (v) => {
  const m = document.querySelector('[data-cal-menu-button]');
  if (m) m.click();
  await new Promise(r => setTimeout(r, 450));
  const b = document.querySelector('[data-cal-drawer-item="' + v + '"]');
  if (b) { b.click(); await new Promise(r => setTimeout(r, 800)); return true; }
  const c = document.querySelector('[data-cal-drawer-close]'); if (c) c.click();
  await new Promise(r => setTimeout(r, 300));
  return false;
}, view);
const goReports = () => page.evaluate(async () => {
  const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Reports');
  if(b) b.click(); await new Promise(r=>setTimeout(r,900));
});

console.log('\nSETTINGS — where the backup lives now — CareTracker v58\n');

await run('SET-1-settings-exists', 'the menu has a Settings row at all', async () => {
  const opened = await goDrawer('settings');
  assert(opened, 'there is no Settings row in the menu — this app has never had one, which is the whole point of this release');
});

await run('SET-2-backup-button-is-here', 'the backup button lives in Settings', async () => {
  const st = await page.evaluate(() => ({
    card: (document.querySelector('[data-records-card]') || {}).getAttribute ? document.querySelector('[data-records-card]').getAttribute('data-records-card') : null,
    backup: !!document.querySelector('[data-backup-btn="backup"]'),
    protect: !!document.querySelector('[data-bk-protect]'),
    restore: !!document.querySelector('[data-backup-restore]')
  }));
  assert(st.card === 'settings', 'the records card here is in ' + brief(st.card) + ' mode');
  assert(st.backup, 'no backup button in Settings');
  assert(st.protect, 'the password switch did not come with it — the switch governs that button and must sit beside it');
  assert(st.restore, 'no way to put a backup back');
});

await run('SET-3-sharing-is-here', 'sharing this tracker is a Settings concern too', async () => {
  const st = await page.evaluate(() => ({
    card: !!document.querySelector('[data-settings-share]'),
    btn: !!document.querySelector('[data-share-btn]'),
    warn: (document.querySelector('[data-share-row]') || {}).innerText || ''
  }));
  assert(st.card && st.btn, 'the share control did not move with the backup');
  // The one thing that must never be lost in a move: no login means the link cannot be revoked.
  assert(/does not need a file/i.test(st.warn) || /same records/i.test(st.warn),
    'the share row lost its explanation: ' + brief(st.warn));
});

await run('SET-4-the-two-documents-are-NOT-here', 'the spreadsheet and printable record stay in Reports', async () => {
  const st = await page.evaluate(() => ({ csv: !!document.querySelector('[data-backup-btn="csv"]'), rep: !!document.querySelector('[data-backup-btn="report"]') }));
  assert(!st.csv && !st.rep, 'the doctor-facing exports followed the backup into Settings; they are for reading, not for managing data');
});

await run('SET-5-report-a-problem-is-reachable-from-settings', 'Settings offers the error/idea log', async () => {
  assert(await page.evaluate(() => !!document.querySelector('[data-settings-report-go]')), 'no route to Report a problem from Settings');
  assert(await tap('[data-settings-report-go]'), 'the button could not be tapped');
  await page.waitForTimeout(800);
  assert(await page.evaluate(() => !!document.querySelector('[data-report-kind="problem"]')), 'it did not open the report screen');
});

await run('SET-6-about-names-the-build', 'Settings says which version this phone is running', async () => {
  await goDrawer('settings');
  const txt = await page.evaluate(() => (document.querySelector('[data-settings-about]') || {}).innerText || '');
  assert(/v\d+/.test(txt), 'no version anywhere in About: ' + brief(txt));
  // The property that makes this app dangerous to share carelessly, stated where someone reads it.
  assert(/no sign-in/i.test(txt) || /address itself/i.test(txt), 'About does not mention that the address is what grants access: ' + brief(txt));
});

// ---- the half that matters: Reports must not have simply lost it ----
await run('SET-7-reports-no-longer-holds-the-backup', 'the backup button is gone from Reports', async () => {
  await goReports();
  const st = await page.evaluate(() => ({
    card: (document.querySelector('[data-records-card]') || {}).getAttribute ? document.querySelector('[data-records-card]').getAttribute('data-records-card') : null,
    backup: !!document.querySelector('[data-backup-btn="backup"]'),
    csv: !!document.querySelector('[data-backup-btn="csv"]'),
    rep: !!document.querySelector('[data-backup-btn="report"]')
  }));
  assert(st.card === 'reports', 'the records card in Reports is in ' + brief(st.card) + ' mode');
  assert(!st.backup, 'the backup button is still in Reports — Aaron asked for it to move, not to be duplicated');
  assert(st.csv && st.rep, 'the spreadsheet and printable record were lost from Reports: csv=' + st.csv + ' report=' + st.rep);
});

await run('SET-8-reports-says-where-it-went', 'Reports points at Settings instead of going quiet', async () => {
  const txt = await page.evaluate(() => (document.querySelector('[data-backup-pointer]') || {}).innerText || '');
  assert(txt, 'Reports says nothing about where the backup went. Someone who has tapped that button weekly for months will conclude it is gone, and it is the only copy of her record');
  assert(/settings/i.test(txt), 'the pointer does not name Settings: ' + brief(txt));
});

await run('SET-9-one-tap-back-to-it', 'the pointer actually gets her there', async () => {
  assert(await tap('[data-backup-pointer-go]'), 'no button on the pointer');
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({
    card: (document.querySelector('[data-records-card]') || {}).getAttribute ? document.querySelector('[data-records-card]').getAttribute('data-records-card') : null,
    backup: !!document.querySelector('[data-backup-btn="backup"]')
  }));
  assert(st.card === 'settings' && st.backup, 'the pointer did not land on the backup button');
});

await run('SET-10-the-backup-still-works-after-the-move', 'a backup taken from Settings is a real backup', async () => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  const res = await page.evaluate(async () => {
    let captured = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = function (b) { captured = b; return realCreate.call(URL, b); };
    const b = document.querySelector('[data-backup-btn="backup"]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 2000));
    URL.createObjectURL = realCreate;
    return captured ? await captured.text() : null;
  });
  assert(res, 'no file was produced from the moved button');
  const p = JSON.parse(res);
  assert(p.format === 'care-tracker-backup', 'not a backup: ' + brief(p.format));
  const recs = (p.entries || []).filter(e => e && e.id !== 'settings');
  assert(recs.length === 2, 'the moved button produced a backup missing records: ' + recs.length);
});

await run('SET-11-no-errors-and-nothing-escaped', 'the app threw nothing and no request left the sandbox', async () => {
  assert(escaped.length === 0, 'requests escaped the stub: ' + brief(escaped.slice(0, 3)));
  assert(errs.length === 0, 'the app threw: ' + brief(errs.slice(0, 3)));
});

await ctx.close(); server.close();
await browser.close();
const pass = R.filter(Boolean).length;
console.log('\n' + pass + '/' + R.length + ' checks passed\n');
process.exit(pass === R.length ? 0 : 1);
