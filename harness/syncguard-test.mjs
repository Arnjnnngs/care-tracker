/**
 * syncguard-test.mjs — proves a live sync cannot destroy what someone is typing,
 * and (just as important) cannot be DROPPED while they type.
 *
 * The reported bug: typing a weight on the live app got wiped when a sync landed.
 * Root cause: subscribeEntries() deferred only for timeModal/apptSheet, and
 * subscribePrefs() had no guard at all.
 *
 * SAFETY: all three gstatic Firebase modules are stubbed, the service worker is blocked,
 * and a catch-all route aborts anything that is not 127.0.0.1 or a stub. NET-1 fails the
 * run if anything escaped. Nothing here can reach the real Firestore.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMIUM = '/opt/pw-browsers/chromium';
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const APP_FILE = arg('--file') || path.join(HERE, '..', 'index.html');
const MUTATE = arg('--mutate');

for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy']) {
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set; Chromium cannot reach 127.0.0.1.'); process.exit(3); }
}

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('disabled');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let auto=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function emitE(){for(const cb of eL)cb(snap(store.entries.slice().sort((a,b)=>(a.ts||0)-(b.ts||0))));}
function emitP(){for(const cb of pL)cb({exists:()=>true,data:()=>JSON.parse(JSON.stringify(store.prefs))});}
globalThis.__sg={
  // Deliver an entry from "the other phone" into an already-open page.
  pushEntry(e){store.entries.push(Object.assign({id:'x'+(++auto)},e));emitE();},
  pushPrefs(p){Object.assign(store.prefs,p);emitP();},
  entryCount(){return store.entries.length;}
};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(){return{__kind:'doc'};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){ if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};} pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++auto)},d));emitE();return{id:'a'+auto};}
export async function setDoc(r,d){Object.assign(store.prefs,d);emitP();}
export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

let html = fs.readFileSync(APP_FILE, 'utf-8');
if (MUTATE) {
  const [from, to] = MUTATE.split('=>');
  if (!html.includes(from)) { console.error('MUTATOR ANCHOR MISSING: ' + from); process.exit(4); }
  html = html.replace(from, to);
  console.log('MUTATED: ' + from.slice(0,60) + ' => ' + to.slice(0,60));
}

const results = [];
const ok = (n, d) => { results.push({n, pass: true, d}); console.log('  PASS  ' + n + ' — ' + d); };
const bad = (n, d, e) => { results.push({n, pass: false, d}); console.log('  FAIL  ' + n + ' — ' + d + '\n          ' + e); };
async function run(n, d, fn) { try { await fn(); ok(n, d); } catch (e) { bad(n, d, e.message); } }
const assert = (c, m) => { if (!c) throw new Error(m); };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/index.html')) { res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); return; }
  res.writeHead(404); res.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const escaped = [];
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({ status:200, contentType:'application/javascript', body: STUB_APP });
  if (u.includes('firebase-firestore.js')) return route.fulfill({ status:200, contentType:'application/javascript', body: STUB_FS });
  if (u.includes('firebase-messaging.js')) return route.fulfill({ status:200, contentType:'application/javascript', body: STUB_MSG });
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  // Google Fonts is a stylesheet the app links; it is aborted like everything else, so no data
  // leaves. Recorded separately so NET-1 stays a real check for anything unexpected rather than
  // being permanently red for a known, harmless, already-blocked request.
  if (u.startsWith('https://fonts.googleapis.com/') || u.startsWith('https://fonts.gstatic.com/')) {
    return route.abort();
  }
  escaped.push(u); return route.abort();
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);

const WEIGHT = 'input[inputmode="decimal"][step="0.1"]';

console.log('\nSYNCGUARD — a live sync must not destroy typing, and must not be lost\n');

await run('TYPING-focus-survives-entry-sync',
  'focus stays in the weight field when an entries sync lands mid-typing', async () => {
  await page.waitForSelector(WEIGHT, { timeout: 8000 });
  await page.focus(WEIGHT);
  await page.type(WEIGHT, '156.4', { delay: 20 });
  const before = await page.evaluate(s => document.activeElement === document.querySelector(s), WEIGHT);
  assert(before, 'precondition: the weight field was not focused before the sync');
  await page.evaluate(() => globalThis.__sg.pushEntry({ medId: 'protonix', dose: 'Morning', ts: Date.now(), loggedAt: Date.now() }));
  await page.waitForTimeout(350);
  const still = await page.evaluate(s => document.activeElement === document.querySelector(s), WEIGHT);
  const val = await page.$eval(WEIGHT, el => el.value);
  assert(still, 'FOCUS WAS LOST — the sync repainted the tree under the user (the reported bug)');
  assert(val === '156.4', 'the typed value did not survive the sync: "' + val + '"');
});

await run('TYPING-focus-survives-prefs-sync',
  'focus stays in the weight field when a PREFS sync lands (the fully unguarded path)', async () => {
  await page.focus(WEIGHT);
  await page.evaluate(() => globalThis.__sg.pushPrefs({ missedClearedAt: Date.now() }));
  await page.waitForTimeout(350);
  const still = await page.evaluate(s => document.activeElement === document.querySelector(s), WEIGHT);
  assert(still, 'FOCUS WAS LOST on a prefs sync — this handler had no guard at all before v47');
});

await run('DEFERRED-while-typing-then-LANDS-after-blur',
  'a sync is HELD (screen unchanged) while typing, then APPLIED once the field is left', async () => {
  // This is the check that matters most. Deferring is only acceptable if the held update always
  // arrives -- silently dropping a sync on a medication app is worse than the bug being fixed.
  // Observed through the rendered text, so it cannot pass on internal state that never painted.
  await page.focus(WEIGHT);
  const before = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => globalThis.__sg.pushEntry({
    medId: 'lidocaine', dose: 'SYNCGUARD-MARKER', ts: Date.now(), loggedAt: Date.now() }));
  await page.waitForTimeout(1400);           // longer than the app's 1s flush interval
  const during = await page.evaluate(() => document.body.innerText);
  assert(during === before,
    'the screen changed WHILE TYPING — the sync was not deferred (this is the reported bug)');
  const focused = await page.evaluate(s2 => document.activeElement === document.querySelector(s2), WEIGHT);
  assert(focused, 'focus was lost while the update was supposedly being held');

  await page.evaluate(s2 => document.querySelector(s2).blur(), WEIGHT);
  await page.waitForTimeout(1600);           // the flush rides the app's own 1s interval
  const after = await page.evaluate(() => document.body.innerText);
  assert(after !== before,
    'THE HELD SYNC WAS NEVER APPLIED after the field was left — a dropped update, worse than the bug');
});

await run('NET-1', 'nothing reached the network beyond 127.0.0.1 and the three stubs', () => {
  assert(escaped.length === 0, 'escaped: ' + escaped.slice(0,3).join(', '));
});
await run('NET-2', 'no page errors were thrown', () => {
  assert(errs.length === 0, errs.slice(0,2).join(' | '));
});

await browser.close(); server.close();
const p = results.filter(r => r.pass).length;
console.log('\n' + p + '/' + results.length + ' checks passed');
process.exit(p === results.length ? 0 : 1);
