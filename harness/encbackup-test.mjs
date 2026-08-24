/**
 * encbackup-test.mjs — a backup file can be protected with a password before it is sent.
 *
 * Aaron, 2026-08-22: "build the encryption part." Asked twice.
 *
 * WEB-MAIN has no login: the link is the password, and every device on the URL sees the same live
 * records. That is the sharing story for a caregiver you trust with everything. The backup FILE is
 * the other story — the one that gets emailed, dropped in a shared folder, handed to a relative —
 * and until now every copy of it was a complete medical record in plain text.
 *
 * The checks that matter most are the ones about failing closed: a wrong password must not open the
 * file, a tampered byte must not be restored as though it were sound, and an iteration count read
 * out of a FILE must be bounded rather than run. And one about not leaking: neither the file nor
 * its filename may name the patient.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, service worker blocked, catch-all abort.
 * Nothing here can reach the real project.
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
// setDoc is REAL here, not an empty function. An empty setDoc made a previous harness report a
// successful restore while every record silently vanished, because bkRestore writes by document id.
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function fire(){for(const cb of eL)cb(snap(store.entries));}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));fire();},
 entries(){return store.entries.filter(e=>e.id!=='settings').map(e=>Object.assign({},e));},
 ids(){return store.entries.map(e=>e.id);},
 wipe(){store.entries.length=0;fire();}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));fire();return{id:'a'+n};}
export async function setDoc(ref,d){const id=(ref&&ref.id)||('s'+(++n));
 const i=store.entries.findIndex(e=>e.id===id);
 if(i>=0)store.entries[i]=Object.assign({id:id},d);else store.entries.push(Object.assign({id:id},d));
 fire();}
export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 240));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [], errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

const PASSWORD = 'correct-horse-9';
const PATIENT_MARK = 'Brandiglyph';   // a distinctive stand-in, never her real name in a fixture

async function boot() {
  const at = new Date(); at.setHours(14, 0, 0, 0);
  const i = rawHtml.indexOf('function simNow()');
  const brace = rawHtml.indexOf('{', i);
  let depth = 0, end = -1;
  for (let k = brace; k < rawHtml.length; k++) {
    if (rawHtml[k] === '{') depth++;
    else if (rawHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  let html = rawHtml.slice(0, i) + 'function simNow() { return ' + at.getTime() + '; }' + rawHtml.slice(end + 1);
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
  // Force the download route: headless Chromium exposes navigator.share and then refuses it, which
  // tests the wrong branch and produces no file at all.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1100);
  await page.evaluate(([ts, mark]) => {
    globalThis.__mc.pushEntry({ medId:'weight', weight:150, dose:'150 lbs', mg:0, ts, note: mark });
    globalThis.__mc.pushEntry({ medId:'temp', temp:98.6, dose:'98.6 F', mg:0, ts: ts + 60000 });
  }, [at.getTime() - 3600000, PATIENT_MARK]);
  await page.waitForTimeout(1200);
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
  return { page, ctx, server, close: async () => { await ctx.close(); server.close(); } };
}

const tap = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.click(); return true; } return false; }, sel);
const type = (page, sel, v) => page.evaluate(([s, vv]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, vv);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [sel, v]);
const notice = (page) => page.evaluate(() => { const n = document.querySelector('[data-backup-notice]'); return n ? n.innerText : null; });
const saveBackup = (page, waitMs) => page.evaluate(async (w) => {
  let captured = null, name = null;
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = function (b) { captured = b; return realCreate.call(URL, b); };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) name = this.download; return realClick.call(this); };
  const b = document.querySelector('[data-backup-btn="backup"]');
  if (b) b.click();
  await new Promise(r => setTimeout(r, w));
  URL.createObjectURL = realCreate;
  HTMLAnchorElement.prototype.click = realClick;
  return { text: captured ? await captured.text() : null, name: name };
}, waitMs);
const feedFile = (page, text) => page.evaluate(async (txt) => {
  const b = document.querySelector('[data-backup-restore]');
  if (b) b.click();
  await new Promise(r => setTimeout(r, 300));
  const inp = document.querySelector('input[type="file"]');
  if (!inp) return { fed: false };
  const dt = new DataTransfer();
  dt.items.add(new File([txt], 'b.json', { type: 'application/json' }));
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1000));
  return { fed: true, locked: !!document.querySelector('[data-bk-unlock]') };
}, text);

console.log('\nPASSWORD-PROTECTED BACKUP FILES — CareTracker v56\n');

const b = await boot();
let encText = null, encName = null;

await run('ENC-1-switch-exists-and-is-off', 'the save card offers a password, and it is off until asked for', async () => {
  const st = await b.page.evaluate(() => {
    const el = document.querySelector('[data-bk-protect]');
    return { there: !!el, mode: el ? el.getAttribute('data-bk-protect') : null, fields: !!document.querySelector('#bk-pw') };
  });
  assert(st.there, 'no password switch anywhere in the save card');
  assert(st.mode === 'off', 'it defaults to on — an unprotected backup is still the fastest path for someone in a hurry');
  assert(!st.fields, 'the password boxes are on screen before the switch has been touched');
});

await run('ENC-2-two-boxes', 'turning it on asks for the password twice', async () => {
  assert(await tap(b.page, '[data-bk-protect-toggle]'), 'the switch could not be tapped');
  await b.page.waitForTimeout(400);
  const st = await b.page.evaluate(() => ({ a: !!document.querySelector('#bk-pw'), c: !!document.querySelector('#bk-pw2') }));
  assert(st.a && st.c, 'no confirm box — a typo then becomes a file that cannot be opened');
});

await run('ENC-3-short-password-refused', 'a password under the minimum saves nothing and says why', async () => {
  await type(b.page, '#bk-pw', 'short1'); await b.page.waitForTimeout(200);
  await type(b.page, '#bk-pw2', 'short1'); await b.page.waitForTimeout(200);
  const res = await saveBackup(b.page, 1200);
  assert(res.text === null, 'a file was produced from a password too short to be one');
  const n = await notice(b.page);
  assert(n && /at least 8/.test(n), 'the refusal never names the reason: ' + brief(n));
});

await run('ENC-4-mismatch-refused', 'two passwords that differ save nothing', async () => {
  await type(b.page, '#bk-pw', PASSWORD); await b.page.waitForTimeout(200);
  await type(b.page, '#bk-pw2', PASSWORD + 'x'); await b.page.waitForTimeout(200);
  const res = await saveBackup(b.page, 1200);
  assert(res.text === null, 'a file was produced from a mistyped password — unopenable, and she would not find out until she needed it');
  const n = await notice(b.page);
  assert(n && /not the same/.test(n), 'the refusal never names the reason: ' + brief(n));
});

await run('ENC-5-envelope', 'a valid password produces an AES-GCM envelope', async () => {
  await type(b.page, '#bk-pw2', PASSWORD); await b.page.waitForTimeout(200);
  const res = await saveBackup(b.page, 4500);
  encText = res.text; encName = res.name;
  assert(encText, 'no file was produced at all');
  const env = JSON.parse(encText);
  assert(env.encrypted === true, 'the file is not marked as encrypted');
  assert(env.cipher === 'AES-GCM' && env.kdf === 'PBKDF2-SHA256', 'unexpected cipher/kdf: ' + brief([env.cipher, env.kdf]));
  assert(Number(env.iterations) >= 310000, 'iteration count too low to be worth calling a password: ' + env.iterations);
  assert(typeof env.salt === 'string' && env.blob && typeof env.blob.ciphertext === 'string' && typeof env.blob.iv === 'string', 'the envelope is missing salt/ciphertext/iv');
});

await run('ENC-6-nothing-in-the-clear', 'not one record, and not the patient, survives into the clear', async () => {
  const env = JSON.parse(encText);
  assert(!encText.includes(PATIENT_MARK), 'a logged note came through in plain text');
  assert(!/"weight"/.test(encText) && !/150 lbs/.test(encText), 'record fields are readable in the file');
  assert(env.patient === undefined, 'the envelope carries the patient name at the top level');
});

await run('ENC-7-filename-says-nothing', 'the filename does not name the patient either', async () => {
  assert(encName, 'no filename was used');
  assert(/^backup-protected-/.test(encName), 'unexpected filename: ' + brief(encName));
  assert(!new RegExp(PATIENT_MARK, 'i').test(encName), 'the patient is named in the filename of a file meant to be emailed: ' + brief(encName));
});

await run('ENC-8-older-build-refuses-rather-than-reads-empty', 'a protected file declares version 2', async () => {
  const env = JSON.parse(encText);
  assert(Number(env.formatVersion) === 2,
    'formatVersion is ' + env.formatVersion + ' — at 1, v55 would open the envelope, find no records, and report the backup as EMPTY');
});

await run('ENC-9-locked-file-shows-no-manifest', 'opening it asks for the password and names nothing about the contents', async () => {
  const fed = await feedFile(b.page, encText);
  assert(fed.fed, 'the file input never appeared');
  assert(fed.locked, 'no password prompt — the file was treated as an ordinary backup');
  const txt = await b.page.evaluate(() => { const el = document.querySelector('[data-bk-unlock]'); return el ? el.innerText : ''; });
  assert(!new RegExp(PATIENT_MARK, 'i').test(txt), 'the locked panel names the patient, which is what the password is protecting');
});

await run('ENC-10-wrong-password-writes-nothing', 'a wrong password opens nothing and changes nothing', async () => {
  const before = await b.page.evaluate(() => globalThis.__mc.ids().slice().sort().join(','));
  await type(b.page, '#bk-unlock-pw', 'not-the-password'); await b.page.waitForTimeout(200);
  await tap(b.page, '[data-bk-unlock-go]');
  await b.page.waitForTimeout(4500);
  const after = await b.page.evaluate(() => globalThis.__mc.ids().slice().sort().join(','));
  assert(before === after, 'documents changed on a failed unlock');
  const st = await b.page.evaluate(() => ({ locked: !!document.querySelector('[data-bk-unlock]'), n: (document.querySelector('[data-backup-notice]') || {}).innerText || '' }));
  assert(st.locked, 'the panel closed as though something had happened');
  assert(/did not open/.test(st.n), 'the message does not say the password was wrong: ' + brief(st.n));
});

await run('ENC-11-right-password-restores', 'the right password opens it and the records go in', async () => {
  await b.page.evaluate(() => globalThis.__mc.wipe());
  await b.page.waitForTimeout(600);
  const emptied = await b.page.evaluate(() => globalThis.__mc.entries().length);
  assert(emptied === 0, 'the fixture would not empty, so this check would have passed on a build that restores nothing');
  await type(b.page, '#bk-unlock-pw', PASSWORD); await b.page.waitForTimeout(200);
  await tap(b.page, '[data-bk-unlock-go]');
  await b.page.waitForTimeout(5000);
  const ents = await b.page.evaluate(() => globalThis.__mc.entries());
  assert(ents.length === 2, 'expected both records back, got ' + ents.length);
  assert(ents.some(e => e.note === PATIENT_MARK), 'the records came back without their contents');
  const st = await b.page.evaluate(() => !document.querySelector('[data-bk-unlock]'));
  assert(st, 'the unlock panel is still on screen after a successful restore');
});

await run('ENC-12-tampered-byte-is-rejected', 'one flipped byte of ciphertext is refused, not half-restored', async () => {
  const env = JSON.parse(encText);
  const c = env.blob.ciphertext;
  const mid = Math.floor(c.length / 2);
  env.blob.ciphertext = c.slice(0, mid) + (c[mid] === 'A' ? 'B' : 'A') + c.slice(mid + 1);
  const before = await b.page.evaluate(() => globalThis.__mc.ids().slice().sort().join(','));
  await feedFile(b.page, JSON.stringify(env));
  await type(b.page, '#bk-unlock-pw', PASSWORD); await b.page.waitForTimeout(200);
  await tap(b.page, '[data-bk-unlock-go]');
  await b.page.waitForTimeout(4500);
  const after = await b.page.evaluate(() => globalThis.__mc.ids().slice().sort().join(','));
  assert(before === after, 'a damaged file wrote documents — AES-GCM authenticates, so this must fail closed');
  await tap(b.page, '[data-bk-unlock-cancel]');
  await b.page.waitForTimeout(400);
});

await run('ENC-13-hostile-iteration-count-is-bounded', 'an iteration count read out of a file is not run', async () => {
  const env = JSON.parse(encText);
  env.iterations = 900000000;
  await feedFile(b.page, JSON.stringify(env));
  await type(b.page, '#bk-unlock-pw', PASSWORD); await b.page.waitForTimeout(200);
  const t0 = Date.now();
  await tap(b.page, '[data-bk-unlock-go]');
  await b.page.waitForTimeout(2500);
  const ms = Date.now() - t0;
  const n = await notice(b.page);
  assert(/newer version/.test(String(n)), 'a hostile iteration count was accepted: ' + brief(n));
  assert(ms < 4000, '900 million rounds were actually attempted — the phone would be locked for minutes');
  await tap(b.page, '[data-bk-unlock-cancel]');
  await b.page.waitForTimeout(400);
});

await run('ENC-14-plain-files-still-readable-by-old-builds', 'an unprotected backup is still written at version 1', async () => {
  await tap(b.page, '[data-bk-protect-toggle]');
  await b.page.waitForTimeout(400);
  const res = await saveBackup(b.page, 2200);
  assert(res.text, 'no unprotected file was produced');
  const p = JSON.parse(res.text);
  assert(p.encrypted === undefined, 'an unprotected save produced an encrypted file');
  assert(Number(p.formatVersion) === 1, 'formatVersion is ' + p.formatVersion + ' — at 2, every phone still on v55 would refuse a file it can read perfectly well');
  const recs = (p.entries || []).filter(e => e && e.id !== 'settings');
  assert(recs.length === 2, 'the unprotected path lost records: ' + recs.length);
});

await run('ENC-15-password-never-persisted', 'the password is not written to storage', async () => {
  const found = await b.page.evaluate((pw) => {
    const hits = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); const v = localStorage.getItem(k);
      if (v && v.indexOf(pw) >= 0) hits.push(k);
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i); const v = sessionStorage.getItem(k);
      if (v && v.indexOf(pw) >= 0) hits.push('session:' + k);
    }
    return hits;
  }, PASSWORD);
  assert(found.length === 0, 'the password is sitting in storage under: ' + brief(found));
});

await run('ENC-16-nothing-escaped-and-no-errors', 'no request left the sandbox and the app threw nothing', async () => {
  assert(escaped.length === 0, 'requests escaped the stub: ' + brief(escaped.slice(0, 3)));
  assert(errs.length === 0, 'the app threw: ' + brief(errs.slice(0, 3)));
});

await b.close();
await browser.close();
const pass = R.filter(Boolean).length;
console.log('\n' + pass + '/' + R.length + ' checks passed\n');
process.exit(pass === R.length ? 0 : 1);
