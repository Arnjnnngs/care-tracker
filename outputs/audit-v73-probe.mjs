// audit-v73-probe.mjs -- ZERO DAY AUDIT of v73. Attacks the cases remove-group-test.mjs does not:
// a LEGACY single reading (no weightId/paraId), over-removal of a NEIGHBOUR reading, the junk-value
// fall-through, and a reading older than 48h. Version-agnostic: reads APP_VERSION out of the file.
// Run: env -u HTTPS_PROXY ... node outputs/audit-v73-probe.mjs --file <index.html>
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => { const _p = require('node:path');
  for (const c of ['playwright', _p.join(_p.dirname(process.execPath),'..','lib','node_modules','playwright'),
    '/opt/node22/lib/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright'])
    { try { return require(c); } catch (e) {} } throw new Error('playwright not found'); })();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file')+1] : path.join(HERE,'..','index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy']) if (process.env[v]) { console.error('REFUSING: '+v); process.exit(3); }
const baseHtml = fs.readFileSync(APP_FILE,'utf8');
const VER = (baseHtml.match(/const APP_VERSION = '([^']+)'/)||[])[1]||'?';
let pass=0, fail=0, notes=[];
const t=(n,c,d)=>{ console.log('  '+(c?'PASS  ':'FAIL  ')+n+(d?'  |  '+d:'')); c?pass++:fail++; };
const note=(s)=>{ console.log('  NOTE  '+s); notes.push(s); };

const at=new Date(); at.setHours(15,0,0,0); const NOW=at.getTime();
const i0=baseHtml.indexOf('function simNow()'); const brace=baseHtml.indexOf('{',i0);
let depth=0,end=-1; for(let k=brace;k<baseHtml.length;k++){ if(baseHtml[k]==='{')depth++; else if(baseHtml[k]==='}'){depth--; if(!depth){end=k;break;}} }
const html=baseHtml.slice(0,i0)+'function simNow() { return '+NOW+'; }'+baseHtml.slice(end+1);
const H=3600000, D=86400000;
const seed=[
  { id:'leg_a', medId:'weight', weight:150.0, dose:'150 lbs', mg:0, ts:NOW-5*H, loggedAt:NOW-5*H },
  { id:'leg_b', medId:'weight', weight:151.0, dose:'151 lbs', mg:0, ts:NOW-4*H, loggedAt:NOW-4*H },
  { id:'old_w', medId:'weight', weight:148.0, dose:'148 lbs', mg:0, ts:NOW-5*D, loggedAt:NOW-5*D },
  { id:'junk_w', medId:'weight', weight:'oops', dose:'oops lbs', mg:0, ts:NOW-3*H, loggedAt:NOW-3*H },
  { id:'leg_p', medId:'paracentesis', liters:3.0, dose:'3.0 L', mg:0, ts:NOW-2*H, loggedAt:NOW-2*H },
  { id:'dose', medId:'compazine', dose:'10 mg', mg:10, ts:NOW-1*H }
];
const stubFs=`
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;const NOW=${NOW};
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){globalThis.__added.push(JSON.parse(JSON.stringify(d)));store.entries.push(Object.assign({id:'a'+(++n)},d));push();return{id:'a'+n};}
export async function deleteDoc(ref){const id=ref&&ref.id;const hit=store.entries.find(e=>String(e.id)===String(id));
 globalThis.__deleted.push({id:String(id),medId:hit?hit.medId:null});
 if(hit&&(NOW-hit.ts)>48*3600000){const err=new Error('Missing or insufficient permissions.');err.code='permission-denied';throw err;}
 store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entries=()=>JSON.parse(JSON.stringify(store.entries));
globalThis.__deleted=[]; globalThis.__added=[];
`;
const STUB_APP=`export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG=`export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const server=http.createServer((rq,rs)=>{ if(rq.url.startsWith('/index.html')){rs.writeHead(200,{'Content-Type':'text/html'});rs.end(html);return;} rs.writeHead(204);rs.end();}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const PORT=server.address().port;
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
await ctx.route('**/*',route=>{const u=route.request().url();
  if(u.includes('firebase-app.js'))return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if(u.includes('firebase-firestore.js'))return route.fulfill({status:200,contentType:'application/javascript',body:stubFs});
  if(u.includes('firebase-messaging.js'))return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if(u.startsWith('http://127.0.0.1:'+PORT))return route.continue(); return route.abort();});
const page=await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.addInitScript(v=>{try{localStorage.setItem('caretracker-seen-version',v);}catch(e){}},VER);
await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);

const entries=()=>page.evaluate(()=>globalThis.__entries());
const deleted=()=>page.evaluate(()=>globalThis.__deleted.slice());
const added=()=>page.evaluate(()=>globalThis.__added.slice());
const clickText=async(re)=>page.evaluate(([s,f])=>{const rx=new RegExp(s,f);
  const b=[...document.querySelectorAll('button')].find(x=>rx.test((x.innerText||'').trim())); if(b){b.click();return true;} return false;},[re.source,re.flags]);
const nav=async(label)=>{ await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/menu/i.test(x.getAttribute('aria-label')||''));if(b)b.click();});
  await page.waitForTimeout(300); const ok=await clickText(new RegExp('^'+label)); await page.waitForTimeout(500); return ok; };
const openReport=async(label)=>{ await nav('Reports'); const ok=await clickText(new RegExp('^'+label)); await page.waitForTimeout(600); return ok; };
const removeHistoryRow=async(id)=>{ const armed=await page.evaluate(d=>{const b=[...document.querySelectorAll('[data-history-row="'+d+'"] button')].find(x=>/^Remove$/.test((x.innerText||'').trim())); if(b){b.click();return true;}return false;},id);
  if(!armed) return false; await page.waitForTimeout(300);
  await page.evaluate(d=>{const b=[...document.querySelectorAll('[data-history-row="'+d+'"] button')].find(x=>/^Delete$/.test((x.innerText||'').trim())); if(b)b.click();},id);
  await page.waitForTimeout(800); return true; };
const wRows=()=>page.evaluate(()=>[...document.querySelectorAll('[data-weight-row]')].map(r=>({k:r.getAttribute('data-weight-row'),txt:(r.innerText||'').replace(/\s+/g,' ')})));
const pRows=()=>page.evaluate(()=>[...document.querySelectorAll('[data-para-row]')].length);
const histRow=(id)=>page.evaluate(d=>{const r=document.querySelector('[data-history-row="'+d+'"]'); if(!r)return null;
  const c=r.querySelector('[data-history-stale]'); return {txt:(r.innerText||'').replace(/\s+/g,' '),stale:c?c.getAttribute('data-history-stale'):null,
  buttons:[...r.querySelectorAll('button')].map(b=>(b.innerText||'').trim())};},id);
const histIds=()=>page.evaluate(()=>[...document.querySelectorAll('[data-history-row]')].map(r=>r.getAttribute('data-history-row')));
const daySummary=()=>page.evaluate(()=>{const d=[...document.querySelectorAll('div')].map(x=>x.innerText||'').find(x=>/\d+ dose/.test(x)&&x.length<80);return d||'';});

console.log('\n=== FILE UNDER TEST: '+APP_FILE+'  APP_VERSION='+VER+' ===');

console.log('\nA. baseline');
{ await openReport('Weight'); const r=await wRows();
  t('three usable legacy readings, the junk one skipped', r.length===3, JSON.stringify(r.map(x=>x.k)));
  await openReport('Paracentesis'); t('one legacy paracentesis', (await pRows())===1); }

console.log('\nB. remove ONE legacy weight (leg_a, 150) from History — the neighbour must survive');
{ await openReport('History');
  const before=(await entries()).length;
  t('Remove was offered on the legacy weight', await removeHistoryRow('leg_a'));
  const del=await deleted(), add=await added();
  note('leg_a: deletes attempted='+JSON.stringify(del)+'  appends='+JSON.stringify(add.map(a=>({m:a.medId,w:a.weightId||a.paraId,c:a.cancelled}))));
  const all=await entries();
  note('entry count '+before+' -> '+all.length);
  await openReport('Weight'); const r=await wRows();
  t('OVER-REMOVAL: the neighbour 151 reading is still there', r.some(x=>/151/.test(x.txt)), JSON.stringify(r.map(x=>x.txt)));
  t('the removed 150 is gone from the Weight report', !r.some(x=>/150/.test(x.txt)), JSON.stringify(r.map(x=>x.txt)));
  await openReport('History'); const row=await histRow('leg_a'); const ids=await histIds();
  note('History after removing leg_a: row still rendered? '+JSON.stringify(row)+'  |  rows='+JSON.stringify(ids));
  note('day summary line: '+(await daySummary()).replace(/\n/g,' ')); }

console.log('\nC. remove the >48h legacy weight (old_w)');
{ await openReport('History'); const dBefore=(await deleted()).length;
  const offered=await removeHistoryRow('old_w');
  t('Remove is offered on a weight older than 48h (weight bypasses the lock)', offered);
  const del=(await deleted()).slice(dBefore);
  note('old_w: deletes attempted='+JSON.stringify(del));
  await openReport('Weight'); const r=await wRows();
  note('Weight report after removing old_w: '+JSON.stringify(r.map(x=>x.txt)));
  t('the >48h reading actually went away', !r.some(x=>/148/.test(x.txt)), JSON.stringify(r.map(x=>x.txt))); }

console.log('\nD. the junk-value weight — the fall-through');
{ await openReport('History'); const dBefore=(await deleted()).length; const eBefore=(await entries()).length;
  const offered=await removeHistoryRow('junk_w');
  const del=(await deleted()).slice(dBefore); const all=await entries();
  note('junk_w: offered='+offered+' deletes='+JSON.stringify(del)+' entries '+eBefore+' -> '+all.length);
  t('the junk document really left (fall-through delete worked)', !all.some(e=>e.id==='junk_w'), 'still present'); }

console.log('\nE. the legacy paracentesis');
{ await openReport('History'); const dBefore=(await deleted()).length;
  const offered=await removeHistoryRow('leg_p');
  const del=(await deleted()).slice(dBefore);
  note('leg_p: offered='+offered+' deletes='+JSON.stringify(del));
  await openReport('Paracentesis'); const n=await pRows();
  t('the legacy paracentesis is gone from its report', n===0, n+' row(s)'); }

console.log('\nF. the control dose still hard-deletes');
{ await openReport('History'); const dBefore=(await deleted()).length;
  await removeHistoryRow('dose'); const del=(await deleted()).slice(dBefore);
  t('ordinary dose still deleted', del.length===1&&del[0].id==='dose', JSON.stringify(del)); }

t('no page errors', errs.length===0, errs.join(' | ').slice(0,400));
console.log('\nALL DELETES ATTEMPTED: '+JSON.stringify(await deleted()));
console.log('ALL APPENDS: '+JSON.stringify((await added()).map(a=>({m:a.medId,g:a.weightId||a.paraId,c:a.cancelled,dose:a.dose,logged:a.loggedAt}))));
await browser.close(); server.close();
console.log('\n'+pass+'/'+(pass+fail)+' checks passed'+(fail?'  <-- FAIL':''));
process.exit(fail?1:0);
