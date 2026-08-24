/**
 * logger-test.mjs — the app writes down its own errors, and there is a place to add yours.
 *
 * Aaron, 2026-08-22: "we were also going to build in a logger for errors or improvements. so many
 * thing I've said has gotten lost."
 *
 * This is a live medical app used every day by someone who is not going to file a bug report. When
 * something goes wrong on her phone it currently reaches nobody: there is no crash reporting, and
 * by the time it gets described in chat the detail is gone.
 *
 * The checks that matter most are the ones about the logger not becoming the fault. It must record
 * a genuinely thrown error WITHOUT swallowing it; it must not fill its own storage when one error
 * repeats every tick; a full phone must not turn an error into a broken screen; and the file it
 * produces must contain no dose, temperature, weight, symptom or appointment — because the whole
 * point is that it can be sent to a stranger.
 *
 * And one that is specific to this app: nothing here may write to Firestore. That collection is her
 * medical record under append-only rules, and a logger that writes to it on every error is a logger
 * that can fill it.
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
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;let writes=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function fire(){for(const cb of eL)cb(snap(store.entries));}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));fire();},
 entries(){return store.entries.filter(e=>e.id!=='settings').map(e=>Object.assign({},e));},
 writes(){return writes;}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){writes++;store.entries.push(Object.assign({id:'a'+(++n)},d));fire();return{id:'a'+n};}
export async function setDoc(ref,d){writes++;const id=(ref&&ref.id)||('s'+(++n));
 const i=store.entries.findIndex(e=>e.id===id);
 if(i>=0)store.entries[i]=Object.assign({id:id},d);else store.entries.push(Object.assign({id:id},d));fire();}
export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
// Read from the file under test, never typed in. Pinning a literal ('v57') is the failure this
// project has a written rule against: three patches and several suites broke on legitimate
// releases because of it, and this suite broke on the very next one after it was written.
const APP_VER = (rawHtml.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (!APP_VER) { console.error('REFUSING: could not read APP_VERSION out of the file under test.'); process.exit(3); }
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 240));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [], pageErrs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

const SECRET_NOTE = 'zzzsecretsymptomtextzzz';

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
page.on('pageerror', e => pageErrs.push(String(e)));
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
});
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1200);
await page.evaluate(([ts, note]) => {
  globalThis.__mc.pushEntry({ medId:'weight', weight:150, dose:'150 lbs', mg:0, ts });
  globalThis.__mc.pushEntry({ medId:'symptom', dose:'Nausea', mg:0, ts: ts + 1000, note: note });
}, [at.getTime() - 3600000, SECRET_NOTE]);
await page.waitForTimeout(1200);

const tap = (sel) => page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.click(); return true; } return false; }, sel);
const typeInto = (sel, v) => page.evaluate(([s, vv]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, vv);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, [sel, v]);
const logNow = () => page.evaluate(() => JSON.parse(localStorage.getItem('caretracker-log-v1') || '[]'));
const openReport = () => page.evaluate(async () => {
  const m = document.querySelector('[data-cal-menu-button]');
  if (m) m.click();
  await new Promise(r => setTimeout(r, 450));
  const b = document.querySelector('[data-cal-drawer-item="report"]');
  if (b) { b.click(); await new Promise(r => setTimeout(r, 700)); return true; }
  const c = document.querySelector('[data-cal-drawer-close]'); if (c) c.click();
  await new Promise(r => setTimeout(r, 300));
  return false;
});

console.log('\nTHE LOG — CareTracker v57\n');

await run('LOG-1-menu-row-exists', 'the menu has a way in', async () => {
  const opened = await openReport();
  assert(opened, 'no "Report a problem" row in the menu — a logger nobody can find is a logger nobody uses');
  assert(await page.evaluate(() => !!document.querySelector('[data-report-kind="problem"]')), 'the row is there but the screen did not open');
});

await run('LOG-2-both-kinds', 'it takes a fault and an idea, not only crashes', async () => {
  const st = await page.evaluate(() => ({ a: !!document.querySelector('[data-report-kind="problem"]'), b: !!document.querySelector('[data-report-kind="idea"]') }));
  assert(st.a && st.b, 'Aaron asked for "errors or improvements" — both');
});

await run('LOG-3-typed-report-is-kept', 'what the person types is written down', async () => {
  await typeInto('#report-draft', 'The weight box would not take a decimal point.');
  await page.waitForTimeout(200);
  await tap('[data-report-save]');
  await page.waitForTimeout(600);
  const l = await logNow();
  assert(l.length === 1, 'expected one entry, got ' + l.length);
  assert(l[0].kind === 'problem' && /decimal point/.test(l[0].text), 'the entry does not hold what was typed: ' + brief(l[0]));
  assert(l[0].app === APP_VER, 'the entry records ' + brief(l[0].app) + ' but this build is ' + brief(APP_VER));
  assert(await page.evaluate(() => { const el = document.querySelector('#report-draft'); return !!el && el.value === ''; }),
    'the box was not cleared, so the same report gets filed twice');
});

await run('LOG-4-an-idea-stays-an-idea', 'an idea is not filed as a fault', async () => {
  await tap('[data-report-kind="idea"]');
  await page.waitForTimeout(300);
  await typeInto('#report-draft', 'Let me reorder the medication list.');
  await page.waitForTimeout(200);
  await tap('[data-report-save]');
  await page.waitForTimeout(600);
  const l = await logNow();
  assert(l.length === 2 && l[1].kind === 'idea', 'kinds recorded: ' + brief(l.map(e => e.kind)));
});

await run('LOG-5-blank-is-not-recorded', 'an empty report is not recorded', async () => {
  const before = (await logNow()).length;
  await typeInto('#report-draft', '    ');
  await page.waitForTimeout(200);
  await tap('[data-report-save]');
  await page.waitForTimeout(500);
  assert((await logNow()).length === before, 'a blank submission became an entry');
});

await run('LOG-6-a-real-throw-records-itself', 'a genuinely thrown error records itself with nothing asking it to', async () => {
  const before = (await logNow()).length;
  const errsBefore = pageErrs.length;
  await page.evaluate(() => { setTimeout(() => { throw new Error('deliberate-test-fault-alpha'); }, 0); });
  await page.waitForTimeout(800);
  const l = await logNow();
  assert(l.filter(e => e.kind === 'error' && /deliberate-test-fault-alpha/.test(e.text)).length === 1,
    'the error was not recorded — entries went ' + before + ' -> ' + l.length);
  assert(pageErrs.length > errsBefore && pageErrs.some(m => /deliberate-test-fault-alpha/.test(m)),
    'the logger swallowed the error, which hides it from the console and from every other tool');
});

await run('LOG-7-rejections-too', 'an unfinished background task is recorded', async () => {
  await page.evaluate(() => { Promise.reject(new Error('deliberate-test-rejection-beta')); });
  await page.waitForTimeout(800);
  const l = await logNow();
  assert(l.filter(e => /deliberate-test-rejection-beta/.test(e.text)).length === 1,
    'unhandledrejection is not recorded — almost every failure in this app is inside an await against Firestore, where window.onerror never fires');
});

await run('LOG-8-repeats-collapse', 'one error repeating forty times is one entry, counted', async () => {
  const r = await page.evaluate(async () => {
    const before = JSON.parse(localStorage.getItem('caretracker-log-v1') || '[]').length;
    for (let i = 0; i < 40; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'repeating-render-fault' }));
    await new Promise(r => setTimeout(r, 400));
    const after = JSON.parse(localStorage.getItem('caretracker-log-v1') || '[]');
    const rep = after.filter(e => /repeating-render-fault/.test(e.text));
    return { grew: after.length - before, rows: rep.length, count: rep.length ? rep[0].count : 0 };
  });
  assert(r.rows === 1 && r.count === 40 && r.grew === 1,
    'rows=' + r.rows + ' count=' + r.count + ' grew=' + r.grew + ' — a render error fires every tick, and without this it evicts everything else within seconds');
});

await run('LOG-9-capped-oldest-errors-first', 'the list is capped, and it is the oldest ERRORS that go', async () => {
  const r = await page.evaluate(async () => {
    for (let i = 0; i < 180; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'distinct-fault-' + i }));
    await new Promise(r => setTimeout(r, 500));
    const l = JSON.parse(localStorage.getItem('caretracker-log-v1') || '[]');
    const mine = l.filter(e => e.kind !== 'error');
    return { n: l.length, newest: l.some(e => /distinct-fault-179/.test(e.text)), oldest: l.some(e => /distinct-fault-0\b/.test(e.text)),
             mine: mine.length, texts: mine.map(e => e.text).join(' | ') };
  });
  assert(r.n <= 100, 'the list grew past its cap: ' + r.n);
  assert(r.newest && !r.oldest, 'the wrong end was dropped — newestKept=' + r.newest + ' oldestDropped=' + !r.oldest);
  // The half nobody can reconstruct afterwards.
  assert(r.mine === 2 && /decimal point/.test(r.texts) && /reorder the medication list/.test(r.texts),
    'a flood of errors evicted what the person wrote: ' + r.mine + ' of 2 survived');
});

await run('LOG-10-full-phone-does-not-break-the-app', 'a full phone does not turn one error into a broken screen', async () => {
  const r = await page.evaluate(async () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k) { if (k === 'caretracker-log-v1') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } return real.apply(this, arguments); };
    let threw = false;
    try { window.dispatchEvent(new ErrorEvent('error', { message: 'fault-while-storage-is-full' })); } catch (e) { threw = true; }
    Storage.prototype.setItem = real;
    await new Promise(r => setTimeout(r, 250));
    return { threw: threw, alive: !!document.querySelector('[data-report-kind="problem"]') };
  });
  assert(!r.threw, 'the logger threw while recording a fault');
  assert(r.alive, 'the screen died — the write happens on the error path, which is exactly when storage is most likely to be gone');
});

await run('LOG-11-nothing-reaches-firestore', 'not one log entry is written to her medical record', async () => {
  const w = await page.evaluate(() => globalThis.__mc.writes());
  const ents = await page.evaluate(() => globalThis.__mc.entries());
  assert(!ents.some(e => JSON.stringify(e).indexOf('deliberate-test-fault') >= 0 || JSON.stringify(e).indexOf('distinct-fault') >= 0),
    'a log entry was written into the records collection, which is append-only and cannot be cleaned up');
  assert(ents.length === 2, 'the record count changed while logging: expected 2, got ' + ents.length);
});

await run('LOG-12-survives-a-restart', 'the record survives a reload', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  const opened = await openReport();
  assert(opened, 'the screen could not be reopened after a reload');
  const st = await page.evaluate(() => ({ errs: !!document.querySelector('[data-log-errors]'), mine: !!document.querySelector('[data-log-mine]') }));
  assert(st.errs && st.mine, 'a fault seen last night has to still be describable this morning');
});

await run('LOG-13-long-list-is-collapsed', 'a long list is collapsed, with a way to see the rest', async () => {
  const shown = await page.evaluate(() => document.querySelectorAll('[data-log-errors] [data-log-entry]').length);
  assert(shown <= 3, 'the whole list was dumped on the screen: ' + shown + ' rows');
  assert(await tap('[data-log-more]'), 'no way to see the rest');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => document.querySelectorAll('[data-log-errors] [data-log-entry]').length);
  assert(after > 3, 'expanding did nothing: still ' + after + ' rows');
});

let report = null;
await run('LOG-14-produces-a-file', 'it produces a text file that can be sent', async () => {
  report = await page.evaluate(async () => {
    let captured = null, name = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = function (b) { captured = b; return realCreate.call(URL, b); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) name = this.download; return realClick.call(this); };
    const b = document.querySelector('[data-report-file]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 1800));
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return { text: captured ? await captured.text() : null, name: name };
  });
  assert(report.text, 'no file was produced');
  assert(/\.txt$/.test(report.name || ''), 'unexpected filename: ' + brief(report.name));
});

await run('LOG-15-file-names-the-build-and-the-device', 'the file says which build and which device it came from', async () => {
  assert(report.text.indexOf('App version: ' + APP_VER) >= 0, 'the file does not name this build (' + APP_VER + ') — a bug report without a version is a guess');
  assert(/Device: /.test(report.text), 'no device string in the file');
});

await run('LOG-16-both-halves-in-the-file', 'the errors and what the person wrote are both in it', async () => {
  assert(/decimal point/.test(report.text) && /reorder the medication list/.test(report.text), 'what the person wrote is missing');
  assert(/THE APP NOTICED/.test(report.text) && /YOU REPORTED/.test(report.text) && /YOUR IDEA/.test(report.text),
    'the three kinds are not named, so whoever reads the file cannot tell them apart');
});

await run('LOG-17-no-patient-data-in-the-file', 'no dose, weight, symptom or appointment is in the file', async () => {
  assert(!report.text.includes(SECRET_NOTE), 'a logged symptom note came through into a file meant to be sent to a stranger');
  assert(!/150 lbs/.test(report.text) && !/Nausea/.test(report.text), 'logged records are in the file');
  assert(/does NOT/i.test(report.text) && /dose/.test(report.text),
    'the file does not state what it excludes — a promise she can check by opening it beats one she has to take on trust');
});

await run('LOG-18-erasing-takes-two-taps', 'erasing the list is not a single tap', async () => {
  await tap('[data-report-clear]');
  await page.waitForTimeout(400);
  const still = (await logNow()).length;
  assert(still > 0, 'one tap erased the whole list');
  await tap('[data-report-clear]');
  await page.waitForTimeout(600);
  assert((await logNow()).length === 0, 'the second tap did not erase it');
});

await run('LOG-19-nothing-escaped', 'no request left the sandbox', async () => {
  assert(escaped.length === 0, 'requests escaped the stub: ' + brief(escaped.slice(0, 3)));
});

await ctx.close(); server.close();
await browser.close();
const pass = R.filter(Boolean).length;
console.log('\n' + pass + '/' + R.length + ' checks passed\n');
process.exit(pass === R.length ? 0 : 1);
