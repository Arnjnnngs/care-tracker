/**
 * missedcard-test.mjs — reproduces Aaron's exact live report, then proves the fix.
 *
 * SCENARIO (his words): "I didn't log protonix or zofran this morning. I have a missed alert for
 * protonix for morning. the protonix card shows waiting while the zofran shows available."
 *
 * Both states were CORRECT. The defect was that the Protonix CARD gave no sign the Morning window
 * had been skipped, so "Waiting" read as "nothing is wrong". These checks pin the correct states
 * AND the new signal, so a future change cannot quietly restore the confusing version.
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
const MUTATE = arg('--mutate');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

// 13:00 local — after Protonix's Morning window (8-12) closed, before Evening (20-22) opens.
// This is the exact moment Aaron was looking at his phone.
const AT = new Date(); AT.setHours(13, 0, 0, 0);
const NOW = AT.getTime();

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(){return{__kind:'doc'};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

let html = fs.readFileSync(APP_FILE, 'utf-8');
if (MUTATE) {
  const [from, to] = MUTATE.split('=>');
  if (!html.includes(from)) { console.error('MUTATOR ANCHOR MISSING'); process.exit(4); }
  html = html.replace(from, to); console.log('MUTATED');
}
// Freeze the clock so the run is identical at any real-world time of day.
html = html.replace('function simNow() { return Date.now(); }',
                    'function simNow() { return ' + NOW + '; }');
if (!html.includes('return ' + NOW)) { console.error('clock freeze failed'); process.exit(4); }

const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const server = http.createServer((rq,rs)=>{ if(rq.url.startsWith('/index.html')){rs.writeHead(200,{'Content-Type':'text/html'});rs.end(html);return;} rs.writeHead(404);rs.end(); }).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const escaped = [];
const ctx = await browser.newContext({ viewport:{width:375,height:812}, serviceWorkers:'block' });
await ctx.route('**/*',(route)=>{ const u=route.request().url();
  if(u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if(u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
  if(u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if(u.startsWith('http://127.0.0.1:'+PORT)) return route.continue();
  if(u.startsWith('https://fonts.')) return route.abort();
  escaped.push(u); return route.abort(); });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(1100);

// Walk UP from the medication name to the whole card. The first attempt took the innermost
// matching div and returned only "Protonix\nPantoprazole" -- the header -- so three checks failed
// against text that never contained a status at all, and a fourth PASSED VACUOUSLY because
// "missed" was absent from a string that could never have contained it.
const cardOf = (name) => page.evaluate((n) => {
  const hdr=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()===n && !d.children.length)[0];
  if(!hdr) return null;
  let el=hdr;
  for(let i=0;i<8 && el.parentElement;i++){
    el=el.parentElement;
    const t=el.innerText||'';
    // Require BOTH the status chip AND the meta line: the header row alone contains "Waiting"
    // and stopping there returned a string that could never hold the missed label.
    const hasStatus=/available|waiting|limit|restricted|course complete/i.test(t);
    const hasMeta=/last dose|no doses logged/i.test(t);
    if(hasStatus && hasMeta) return t;
  }
  return el.innerText||null;}, name);

console.log('\nMISSED-ON-CARD — Aaron\'s live Protonix/Zofran report, at 1:00 PM\n');

await run('PROTONIX-card-shows-missed',
  'the Protonix card itself says the Morning dose was missed', async () => {
  const txt = await cardOf('Protonix');
  assert(txt, 'Protonix card not found');
  assert(/missed/i.test(txt),
    'the card does not mention the missed Morning dose — this is the reported defect. Card said: ' + JSON.stringify(txt));
  assert(/morning/i.test(txt), 'the card does not name WHICH window was missed: ' + JSON.stringify(txt));
});

await run('PROTONIX-still-waiting',
  'Protonix still correctly reads Waiting with the 8 PM window next (not "fixed" into Available)', async () => {
  const txt = await cardOf('Protonix');
  assert(/waiting/i.test(txt), 'Protonix should still be Waiting between windows: ' + JSON.stringify(txt));
  assert(/next dose at/i.test(txt), 'the next-dose time disappeared: ' + JSON.stringify(txt));
});

await run('ZOFRAN-available-and-never-missed',
  'Zofran is as-needed: Available, and never reports a missed dose', async () => {
  const txt = await cardOf('Zofran');
  assert(txt, 'Zofran card not found');
  assert(/available/i.test(txt), 'Zofran should be Available: ' + JSON.stringify(txt));
  assert(!/missed/i.test(txt),
    'an as-needed medication must NEVER show a missed dose — it has no schedule to miss: ' + JSON.stringify(txt));
});

await run('LOGGING-clears-the-card-signal',
  'logging the Morning dose late removes the missed label from the card', async () => {
  // MUST assert the label was there FIRST. Without this the check passes on a card that never
  // showed "missed" at all -- which is exactly what it did on the first run.
  const before = await cardOf('Protonix');
  assert(/missed/i.test(before),
    'precondition failed: the card was not showing a missed dose before logging, so this check would prove nothing');
  const morning = new Date(NOW); morning.setHours(9,0,0,0);
  await page.evaluate((ts)=>globalThis.__mc.pushEntry({medId:'protonix',dose:'Morning',mg:0,ts,loggedAt:ts}), morning.getTime());
  await page.waitForTimeout(1400);
  const txt = await cardOf('Protonix');
  assert(!/missed/i.test(txt), 'the missed label survived a logged dose: ' + JSON.stringify(txt));
});

await run('ONE-DEFINITION-of-missed', 'the card and the banner share one missedDosesFor()', () => {
  const n = (html.match(/function missedDosesFor/g)||[]).length;
  assert(n === 1, 'missedDosesFor is defined ' + n + ' times — the card and banner can drift');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1 and the stubs',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});
await run('NET-2','no page errors',()=>{ assert(errs.length===0, errs.slice(0,2).join(' | ')); });

await browser.close(); server.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
