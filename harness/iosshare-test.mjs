/**
 * iosshare-test.mjs — proves exports reach an iOS PWA, and that the app stops claiming
 * success it cannot verify.
 *
 * Aaron, 2026-08-21: "can't find file for iPhone either." Root cause: deliverFile() was a bare
 * <a download> click, which in an INSTALLED iOS PWA saves nothing. Every export showed a success
 * toast and produced no file.
 *
 * These checks assert on WHICH API the app calls and WHAT IT SAYS afterwards -- a download in a
 * headless Chromium cannot reproduce iOS Safari's standalone behaviour, so asserting "a file
 * appeared" here would prove nothing about the phone. What CAN be proven is that the app prefers
 * the share sheet when the platform offers it, falls back when it does not, and never announces
 * a save the user cancelled.
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
const MUTATE = arg('--mutate');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__ios={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));}};
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
if (MUTATE) { const [f,t]=MUTATE.split('=>'); if(!html.includes(f)){console.error('MUTATOR ANCHOR MISSING');process.exit(4);} html=html.replace(f,t); console.log('MUTATED'); }

const R=[]; const assert=(c,m)=>{if(!c)throw new Error(m);};
async function run(n,d,fn){try{await fn();R.push(1);console.log('  PASS  '+n+' — '+d);}catch(e){R.push(0);console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);}}

const server=http.createServer((rq,rs)=>{if(rq.url.startsWith('/index.html')){rs.writeHead(200,{'Content-Type':'text/html'});rs.end(html);return;}rs.writeHead(404);rs.end();}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const PORT=server.address().port;
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});

// SHARE_MODE: 'ok' = share succeeds, 'cancel' = user taps Cancel, 'absent' = platform has no
// file sharing at all (desktop). Injected before any app code runs.
async function openApp(shareMode) {
  const ctx = await browser.newContext({ viewport:{width:375,height:812}, serviceWorkers:'block' });
  await ctx.route('**/*',(route)=>{const u=route.request().url();
   if(u.includes('firebase-app.js'))return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
   if(u.includes('firebase-firestore.js'))return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
   if(u.includes('firebase-messaging.js'))return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
   if(u.startsWith('http://127.0.0.1:'+PORT))return route.continue();
   if(u.startsWith('https://fonts.'))return route.abort();
   return route.abort();});
  await ctx.addInitScript((mode)=>{
    window.__shareCalls=[]; window.__anchorClicks=[];
    if(mode==='absent'){ try{delete navigator.canShare;}catch(e){} try{delete navigator.share;}catch(e){} }
    else {
      navigator.canShare = (d)=> !!(d && d.files && d.files.length);
      navigator.share = async (d)=>{ window.__shareCalls.push((d.files||[]).map(f=>f.name));
        if(mode==='cancel'){ const e=new Error('cancelled'); e.name='AbortError'; throw e; } };
    }
    // Record any <a download> click without letting it actually navigate.
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){ if(this.download){ window.__anchorClicks.push(this.download); return; } return realClick.apply(this,arguments); };
  }, shareMode);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1100);
  await page.evaluate(()=>globalThis.__ios.pushEntry({medId:'protonix',dose:'Morning',mg:0,ts:Date.now(),loggedAt:Date.now()}));
  await page.waitForTimeout(600);
  return { ctx, page };
}
async function exportCSV(page){
  await page.evaluate(()=>{ const n=document.querySelector('nav[aria-label="Primary navigation"] button[aria-label="Reports"]'); if(n) n.click(); });
  await page.waitForTimeout(500);
  await page.evaluate(()=>{ const b=document.querySelector('[data-backup-btn="csv"]'); if(b) b.click(); });
  await page.waitForTimeout(1400);
}

console.log('\nEXPORT ON iOS — does the file actually have a route to Files?\n');

{ const {ctx,page} = await openApp('ok');
  await exportCSV(page);
  await run('SHARE-1-uses-the-share-sheet',
    'when the platform can share files, the app uses the share sheet (the only iOS PWA route)', async () => {
    const calls = await page.evaluate(()=>window.__shareCalls);
    const anchors = await page.evaluate(()=>window.__anchorClicks);
    assert(calls.length > 0, 'navigator.share was NEVER called — on an installed iOS PWA this export saves nothing');
    assert(anchors.length === 0, 'it also fired an <a download>, which would double-deliver: ' + JSON.stringify(anchors));
  });
  await run('SHARE-2-honest-wording', 'it does not claim "saved to your downloads" after a share sheet', async () => {
    const txt = await page.evaluate(()=>document.body.innerText);
    assert(!/saved to your downloads/i.test(txt),
      'said "saved to your downloads" after a SHARE — she chose where it went, and on iOS it may be nowhere');
  });
  await ctx.close(); }

{ const {ctx,page} = await openApp('cancel');
  await exportCSV(page);
  await run('CANCEL-claims-nothing', 'a CANCELLED share never reports the file as saved', async () => {
    const txt = await page.evaluate(()=>document.body.innerText);
    assert(!/saved/i.test(txt), 'announced a save after the user cancelled: ' + JSON.stringify(txt.slice(0,160)));
  });
  await run('CANCEL-no-sneaky-download', 'a cancelled share does not silently fall back to a download', async () => {
    const anchors = await page.evaluate(()=>window.__anchorClicks);
    assert(anchors.length === 0, 'a file was downloaded after she cancelled: ' + JSON.stringify(anchors));
  });
  await ctx.close(); }

{ const {ctx,page} = await openApp('absent');
  await exportCSV(page);
  await run('FALLBACK-desktop-still-downloads',
    'where file sharing does not exist (desktop), it still falls back to a download', async () => {
    const anchors = await page.evaluate(()=>window.__anchorClicks);
    assert(anchors.length > 0, 'no share AND no download — the export vanished entirely');
    assert(/\.csv$/i.test(anchors[0]), 'downloaded the wrong file: ' + anchors[0]);
  });
  await ctx.close(); }

await run('SYNC-home-prompt-exists', 'Home warns when the two phones disagree and no choice is made', () => {
  assert(html.includes('data-medsync-home-prompt'), 'no Home prompt — the chooser is still buried on the Meds screen');
  assert(html.includes('medsyncCandidates()'), 'the prompt does not reuse medsyncCandidates()');
});
await run('ONE-DEFINITION', 'deliverFile and medsyncCandidates each defined exactly once', () => {
  assert((html.match(/function deliverFile/g)||[]).length === 1, 'deliverFile duplicated');
  assert((html.match(/function medsyncCandidates/g)||[]).length === 1, 'medsyncCandidates duplicated');
});

await browser.close(); server.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
