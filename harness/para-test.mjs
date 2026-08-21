/**
 * para-test.mjs — paracentesis is its own record, and the weight trend never moves because of it.
 *
 * Aaron, 2026-08-21: "we need to add para, but maybe leave it as a standalone so it doesn't affect
 * weight trend. there can be notes for weight that can add the para together to see how much was
 * drained."
 *
 * The two things that must be true, and that these checks exist to pin:
 *   1. A logged drain writes a `paracentesis` document. It never writes, edits or arithmetically
 *      touches a weight document. The plotted weight is what the scale said.
 *   2. The litres ARE aggregated and surfaced on the Weight report as annotation, against the same
 *      window the chart is showing.
 *
 * Plus the two traps the Developer brief found: the Reports dispatch falls through to Appetite for
 * any unhandled type, and removal after 48 hours cannot be a delete because the Firestore rules
 * refuse it by document age.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, service worker blocked, catch-all abort.
 * Brandi's real Firestore is never reachable from this file.
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
// The stub records DELETES as well as writes. care-tracker's rules block a delete by document age,
// so a Remove implemented as deleteDoc would pass a UI check and silently fail on a real 3-day-old
// record. DELETE-COUNT below asserts none is ever attempted.
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;const deletes=[];
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={
  pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));},
  entries(){return store.entries.map(e=>Object.assign({},e));},
  deletes(){return deletes.slice();}
};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} 
export async function deleteDoc(ref){deletes.push(ref&&ref.id);}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 220));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [];
const errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

async function boot(seed) {
  const at = new Date(); at.setHours(14, 0, 0, 0);
  const now = at.getTime();
  const i = rawHtml.indexOf('function simNow()');
  const brace = rawHtml.indexOf('{', i);
  let depth = 0, end = -1;
  for (let k = brace; k < rawHtml.length; k++) {
    if (rawHtml[k] === '{') depth++;
    else if (rawHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  const html = rawHtml.slice(0, i) + 'function simNow() { return ' + now + '; }' + rawHtml.slice(end + 1);
  if (!html.includes('return ' + now)) { console.error('clock freeze failed'); process.exit(4); }
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
  if (seed && seed.length) {
    await page.evaluate((rows) => rows.forEach(r => globalThis.__mc.pushEntry(r)), seed);
    await page.waitForTimeout(1200);
  }
  const d0 = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  return { page, ctx, server, now, d0, close: async () => { await ctx.close(); server.close(); } };
}

const openReport = (page, label) => page.evaluate(async (l) => {
  const nav=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'')==='Reports'||b.innerText.trim()==='Reports');
  if(nav) nav.click();
  await new Promise(r=>setTimeout(r,700));
  const card=[...document.querySelectorAll('button')].find(b=>(b.innerText||'').trim().startsWith(l));
  if(!card) return null;
  card.click();
  await new Promise(r=>setTimeout(r,800));
  return document.body.innerText;
}, label);

const logPara = (page, litres) => page.evaluate(async (v) => {
  const hdr=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Paracentesis' && !d.children.length);
  if(!hdr) return 'no-card';
  let el=hdr, card=null;
  for(let i=0;i<6&&el.parentElement;i++){ el=el.parentElement; if(el.querySelector('input') && [...el.querySelectorAll('button')].some(b=>b.textContent.trim()==='Log')){card=el;break;} }
  if(!card) return 'no-input';
  const inp=card.querySelector('input');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  setter.call(inp, String(v));
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  [...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Log').click();
  await new Promise(r=>setTimeout(r,600));
  // The time modal confirms; press its primary action.
  const confirm=[...document.querySelectorAll('button')].find(b=>/^(Log|Confirm|Save)$/i.test(b.textContent.trim()) && b.closest('[style*="position: fixed"], [style*="position:fixed"]'));
  if(confirm){ confirm.click(); await new Promise(r=>setTimeout(r,900)); }
  return 'ok';
}, litres);

console.log('\nPARACENTESIS — a standalone record that never moves the weight trend\n');

// ---------- logging ----------
{
  const b = await boot([]);
  await run('PARA-1-home-card',
    'the Paracentesis card is on Home with its own litres input', async () => {
    const hasCard = await b.page.evaluate(() => {
      const hdr=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Paracentesis' && !d.children.length);
      if(!hdr) return false;
      let el=hdr; for(let i=0;i<6&&el.parentElement;i++){ el=el.parentElement;
        if(el.querySelector('input[inputmode="decimal"]')) return true; }
      return false;
    });
    assert(hasCard, 'no Paracentesis card with a litres input on Home');
  });

  await run('PARA-2-writes-its-own-record',
    'logging 4.5 L writes a paracentesis document — and no weight document', async () => {
    const r = await logPara(b.page, 4.5);
    assert(r === 'ok', 'could not drive the card: ' + r);
    const rows = await b.page.evaluate(() => globalThis.__mc.entries());
    const paras = rows.filter(e => e.medId === 'paracentesis');
    const weights = rows.filter(e => e.medId === 'weight');
    assert(paras.length === 1, 'expected exactly one paracentesis document, got ' + paras.length);
    assert(Number(paras[0].liters) === 4.5, 'litres not recorded: ' + JSON.stringify(paras[0]));
    assert(typeof paras[0].paraId === 'string' && paras[0].paraId, 'no paraId — corrections would be impossible');
    assert(paras[0].weight === undefined, 'a weight field leaked onto the paracentesis record');
    assert(weights.length === 0, 'logging a drain wrote ' + weights.length + ' weight document(s) — it must never touch weight');
  });

  await run('PARA-3-rejects-nonsense',
    'zero, negative and absurd volumes are refused, and nothing is written', async () => {
    // Precondition. Without it this check passes VACUOUSLY on a build that has no card at all --
    // nothing is written because nothing can be written, which proves nothing about validation.
    const reachable = await logPara(b.page, 4.5);
    assert(reachable === 'ok', 'precondition failed: the card is not drivable, so refusal proves nothing');
    const before = await b.page.evaluate(() => globalThis.__mc.entries().filter(e=>e.medId==='paracentesis').length);
    for (const bad of [0, -3, 400, 25.5]) await logPara(b.page, bad);
    const after = await b.page.evaluate(() => globalThis.__mc.entries().filter(e=>e.medId==='paracentesis').length);
    assert(after === before, 'an invalid volume was written (' + before + ' -> ' + after + ')');
  });
  await b.close();
}

// ---------- the weight trend must not move ----------
{
  const day = 86400000;
  const at = Date.now();
  const seed = [];
  const b0 = await boot([]);
  const D = b0.d0;
  await b0.close();
  for (let i = 6; i >= 0; i--) seed.push({ medId:'weight', weight: 150 + i, dose:(150+i)+' lbs', mg:0, ts: D - i*day + 3600000*9 });
  seed.push({ medId:'paracentesis', paraId:'p1', liters:4.5, dose:'4.5 L', mg:0, ts: D - 3*day + 3600000*10, loggedAt: at });
  seed.push({ medId:'paracentesis', paraId:'p2', liters:3.0, dose:'3.0 L', mg:0, ts: D - 1*day + 3600000*10, loggedAt: at });

  const b = await boot(seed);
  await run('PARA-4-weight-values-untouched',
    'the Weight report still plots exactly what the scale said', async () => {
    const txt = await openReport(b.page, 'Weight');
    assert(txt, 'could not open the Weight report');
    // Seeded weights run 150..156; the newest is 150. Any drainage-adjusted figure would differ.
    assert(/150 lbs/.test(txt), 'the latest weight is not shown as recorded: ' + brief(txt));
    for (const w of ['151','152','153','154','155','156'])
      assert(txt.includes(w), 'weight reading ' + w + ' is missing from the readings list');
  });

  await run('PARA-5-drained-total-is-annotated',
    'the Weight report adds the drains together for the window it is showing', async () => {
    const txt = await b.page.evaluate(() => document.body.innerText);
    assert(/2 paracentesis procedures in this range/i.test(txt),
      'the procedure count for this range is missing: ' + brief(txt));
    assert(/7\.5 L drained/i.test(txt), 'the drained total is wrong or missing — expected 7.5 L: ' + brief(txt));
    assert(/not adjusted for drainage/i.test(txt),
      'the report does not state that weights are unadjusted, which is the whole point');
  });

  await run('PARA-6-own-report-not-appetite',
    'the Paracentesis report renders its OWN content, not the Appetite fallthrough', async () => {
    const txt = await openReport(b.page, 'Paracentesis');
    assert(txt, 'could not open the Paracentesis report');
    assert(/7\.5 L/.test(txt), 'total drained missing from its own report: ' + brief(txt));
    assert(/Total drained/i.test(txt), 'the Paracentesis stat cards did not render');
    assert(!/Little to none|No Appetite/i.test(txt),
      'this is the Appetite report wearing the Paracentesis heading — the dispatch fallthrough');
  });

  await run('PARA-7-remove-is-append-not-delete',
    'removing a drain appends a tombstone and never calls deleteDoc', async () => {
    const before = await b.page.evaluate(() => document.body.innerText);
    assert(/7\.5 L/.test(before), 'precondition failed: the report was not showing 7.5 L to begin with');
    await b.page.evaluate(async () => {
      const btn=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Remove');
      btn.click(); await new Promise(r=>setTimeout(r,400));
      const del=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Delete');
      del.click(); await new Promise(r=>setTimeout(r,1200));
    });
    const dels = await b.page.evaluate(() => globalThis.__mc.deletes());
    assert(dels.length === 0,
      'deleteDoc was called ' + dels.length + ' time(s) — the rules refuse deletes by age, so this silently fails on a real record');
    const rows = await b.page.evaluate(() => globalThis.__mc.entries().filter(e => e.medId === 'paracentesis'));
    assert(rows.some(r => r.cancelled === true), 'no tombstone was appended');
    const after = await b.page.evaluate(() => document.body.innerText);
    assert(!/7\.5 L/.test(after), 'the removed drain is still counted in the total: ' + brief(after));
  });
  await b.close();
}

// ---------- a drain with no weigh-in at all ----------
{
  const b0 = await boot([]); const D = b0.d0; await b0.close();
  const b = await boot([{ medId:'paracentesis', paraId:'solo', liters:6, dose:'6.0 L', mg:0, ts: D - 3600000*5, loggedAt: Date.now() }]);
  await run('PARA-8-drain-without-any-weight',
    'a drain logged when weight has never been recorded is still reported, not lost', async () => {
    const txt = await openReport(b.page, 'Paracentesis');
    assert(/6\.0 L/.test(txt), 'the drain is missing from its own report: ' + brief(txt));
    const wTxt = await openReport(b.page, 'Weight');
    assert(/paracentesis/i.test(wTxt),
      'the empty Weight report says nothing about the recorded drain, so it looks lost: ' + brief(wTxt));
  });
  await b.close();
}

// ---------- source-level guards ----------
await run('PARA-9-never-arithmetically-joined',
  'no code anywhere adds or subtracts litres against a weight value', () => {
  assert(!/weight\s*[-+]\s*[A-Za-z_.]*[Ll]iters/.test(rawHtml) && !/liters\s*[-+]\s*[A-Za-z_.]*[Ww]eight/.test(rawHtml),
    'weight and litres are being combined arithmetically — the trend must stay raw');
});
await run('PARA-10-not-counted-as-a-dose',
  'the oncologist report and History never count a drain as a medication dose', () => {
  const excl = rawHtml.match(/\['temp', 'weight', 'paracentesis'[^\]]*\]/);
  assert(excl, 'paracentesis is missing from the printable report dose-count exclusion list');
  assert(/e\.medId !== 'paracentesis'/.test(rawHtml),
    'paracentesis is missing from the History day-summary dose count');
});
await run('PARA-11-resolver-uses-a-Map',
  'the record resolver keys on a Map, so an id of "constructor" cannot be dropped', () => {
  const fn = (rawHtml.match(/function paracentesisResolved\(\)[\s\S]{0,900}?\n\}/) || [''])[0];
  assert(fn, 'paracentesisResolved not found');
  assert(/new Map\(\)/.test(fn), 'the resolver groups on a plain object — prototype keys will vanish');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1 and the stubs',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});
await run('NET-2','no page errors',()=>{ assert(errs.length===0, errs.slice(0,2).join(' | ')); });

await browser.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
