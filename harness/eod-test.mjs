/**
 * eod-test.mjs — the Bowel Movement and Appetite check-ins ask about TODAY, at the end of the day.
 *
 * Aaron, 2026-08-21: "bowel movement and appetite should be at the end of the day for both
 * caretracker and chemowell. no longer for the day before."
 *
 * BEFORE this change both cards asked about YESTERDAY and were on screen from midnight onward.
 * These checks pin the new behaviour at three frozen clock positions -- 10:00 (absent), 19:00
 * (present, firm, about today) and 22:00 (urgent) -- so a future edit cannot quietly put the
 * morning-retrospective back.
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
const MUTATE = arg('--mutate');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={
  pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));},
  entries(){return store.entries.map(e=>Object.assign({},e));}
};
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

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
let baseHtml = rawHtml;
if (MUTATE) {
  const [from, to] = MUTATE.split('=>');
  if (!baseHtml.includes(from)) { console.error('MUTATOR ANCHOR MISSING'); process.exit(4); }
  baseHtml = baseHtml.replace(from, to); console.log('MUTATED');
}

const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [];
const errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

// One page per frozen clock position. The clock is frozen INSIDE the served HTML, so the run is
// identical whatever the real wall time is when Aaron or CI runs it.
async function bootAt(hour) {
  const at = new Date(); at.setHours(hour, 0, 0, 0);
  const now = at.getTime();
  let html = baseHtml.replace('function simNow() { return Date.now(); }',
                              'function simNow() { return ' + now + '; }');
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
  page.on('pageerror',e=>errs.push(hour+':00 ' + String(e)));
  await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1100);
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  return { page, ctx, server, now, dayStart,
           close: async () => { await ctx.close(); server.close(); } };
}

// Walk UP from the card's title to the card itself. The card is identified by the FIRST ancestor
// that owns both the <select> and the "Log" button -- not by matching the title text again:
// the title is rendered with text-transform:uppercase, so innerText returns "BOWEL MOVEMENT" and
// a check for "Bowel Movement" walks all the way up to <body> and returns the entire page. That
// is exactly what happened on the first run of this file, and it made three checks fail against
// a string that had nothing to do with the card.
const cardEl = (page, title, fn) => page.evaluate(([t, f]) => {
  // The CARD's title is the uppercase-transformed one. The same words also appear as a plain
  // journal row once the day is answered, and walking up from THAT row reaches a container that
  // happens to hold another card's <select> and a Log button -- which is how the "card survived
  // being answered" check first failed against the entire page.
  const hdr=[...document.querySelectorAll('div')].filter(d=>
    d.textContent.trim()===t && !d.children.length &&
    getComputedStyle(d).textTransform==='uppercase')[0];
  if(!hdr) return null;
  let el=hdr;
  for(let i=0;i<8 && el.parentElement;i++){
    el=el.parentElement;
    // Exactly one <select>: more than one means we have walked past the card into the page.
    if(el.querySelectorAll('select').length===1 &&
       [...el.querySelectorAll('button')].some(b=>b.textContent.trim()==='Log'))
      return f === 'text' ? el.innerText : getComputedStyle(el).borderColor;
  }
  return null;}, [title, fn]);
const cardOf = (page, title) => cardEl(page, title, 'text');
// Keep failure messages readable — an unbounded innerText dump is thousands of lines.
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 220));

const borderOf = (page, title) => cardEl(page, title, 'border');

console.log('\nEND-OF-DAY CHECK-INS — bowel movement and appetite, asked about today\n');

// ---------- 10:00 : the morning must be quiet ----------
{
  const m = await bootAt(10);
  await run('EOD-1-morning-quiet',
    'at 10:00 AM neither check-in is on Home — the day is not over yet', async () => {
    const bm = await cardOf(m.page, 'Bowel Movement');
    const ap = await cardOf(m.page, 'Appetite');
    assert(bm === null, 'the Bowel Movement card is on screen in the morning: ' + brief(bm));
    assert(ap === null, 'the Appetite card is on screen in the morning: ' + brief(ap));
  });
  await run('EOD-2-missed-day-is-not-re-asked',
    'a day that ended unanswered is not re-asked the next morning (deliberate — see STATUS.md)', async () => {
    // Seed a bowel movement two days ago and nothing for yesterday, so yesterday is genuinely
    // unanswered. Under the old behaviour this was precisely when the card appeared at breakfast.
    await m.page.evaluate((ts) => globalThis.__mc.pushEntry(
      { medId:'bowel_movement', value:'normal', dose:'Normal', mg:0, ts }), m.dayStart - 2*86400000 + 12*3600000);
    await m.page.waitForTimeout(1300);
    const bm = await cardOf(m.page, 'Bowel Movement');
    assert(bm === null, 'the morning retrospective came back: ' + brief(bm));
  });
  await m.close();
}

// ---------- 19:00 : present, firm, about TODAY ----------
{
  const e = await bootAt(19);
  await run('EOD-3-evening-present',
    'at 7:00 PM both check-ins are on Home', async () => {
    assert(await cardOf(e.page, 'Bowel Movement'), 'the Bowel Movement card is missing at 7 PM');
    assert(await cardOf(e.page, 'Appetite'), 'the Appetite card is missing at 7 PM');
  });

  await run('EOD-4-asks-about-today',
    'both name TODAY, and neither names a past weekday', async () => {
    const bm = await cardOf(e.page, 'Bowel Movement');
    const ap = await cardOf(e.page, 'Appetite');
    for (const [label, txt] of [['Bowel Movement', bm], ['Appetite', ap]]) {
      assert(/today/i.test(txt), label + ' does not say "today": ' + brief(txt));
      assert(!/yesterday/i.test(txt), label + ' still says "yesterday": ' + brief(txt));
      // The old copy built its message from toLocaleDateString(weekday:'long'), so any weekday
      // name in the card means the retrospective wording came back.
      assert(!/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(txt),
        label + ' names a specific past weekday — the retrospective wording is back: ' + brief(txt));
    }
  });

  await run('EOD-5-firm-not-urgent-at-7pm',
    'at 7:00 PM the cards are firm (amber), not urgent (red)', async () => {
    const c = await borderOf(e.page, 'Bowel Movement');
    assert(c, 'could not read the card border');
    assert(c.includes('154, 100, 25'), 'expected the firm amber border at 7 PM, got ' + c);
  });

  await run('EOD-6-logs-against-today',
    'logging from the card writes the entry against TODAY, not yesterday', async () => {
    await e.page.evaluate(() => {
      const hdr=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Bowel Movement' && !d.children.length);
      let el=hdr; for(let i=0;i<8&&el.parentElement;i++){ el=el.parentElement;
        const s=el.querySelector('select'); if(s){ s.value='normal'; s.dispatchEvent(new Event('change',{bubbles:true})); return; } }
    });
    await e.page.evaluate(() => {
      const hdr=[...document.querySelectorAll('div')].find(d=>d.textContent.trim()==='Bowel Movement' && !d.children.length);
      let el=hdr; for(let i=0;i<8&&el.parentElement;i++){ el=el.parentElement;
        const b=[...el.querySelectorAll('button')].find(x=>x.textContent.trim()==='Log');
        if(b){ b.click(); return; } }
    });
    await e.page.waitForTimeout(1400);
    const rows = await e.page.evaluate(() => globalThis.__mc.entries().filter(x => x.medId === 'bowel_movement'));
    assert(rows.length === 1, 'expected exactly one bowel_movement entry, got ' + rows.length);
    const d0 = new Date(rows[0].ts); d0.setHours(0,0,0,0);
    assert(d0.getTime() === e.dayStart,
      'the entry landed on ' + new Date(rows[0].ts).toString() + ' — it must belong to today');
    const after = await cardOf(e.page, 'Bowel Movement');
    assert(after === null, 'the card survived being answered: ' + brief(after));
  });

  await run('EOD-7-reports-summary-says-today',
    'the Reports > Appetite summary line describes today, not yesterday', async () => {
    await e.page.evaluate(() => {
      const b=[...document.querySelectorAll('button,div')].find(x=>x.textContent.trim()==='Reports');
      if(b) b.click();
    });
    await e.page.waitForTimeout(900);
    const body = await e.page.evaluate(() => document.body.innerText);
    assert(/appetite/i.test(body), 'the Reports page did not open');
    assert(!/not yet logged for yesterday|yesterday/i.test(body),
      'the Reports summary still describes yesterday: ' + JSON.stringify(body.slice(0, 500)));
  });
  await e.close();
}

// ---------- 22:00 : urgent ----------
{
  const n = await bootAt(22);
  await run('EOD-8-urgent-late',
    'at 10:00 PM an unanswered day is urgent and says so', async () => {
    const bm = await cardOf(n.page, 'Bowel Movement');
    assert(bm, 'the Bowel Movement card is missing at 10 PM');
    assert(/still not logged for today/i.test(bm), 'the late message is not urgent: ' + brief(bm));
    const c = await borderOf(n.page, 'Bowel Movement');
    assert(c && c.includes('192, 69, 59'), 'expected the urgent red border at 10 PM, got ' + c);
  });
  await n.close();
}

// ---------- source-level guards ----------
await run('EOD-9-one-definition',
  'the end-of-day window is defined once, and both cards use it', () => {
  assert((rawHtml.match(/function eodActive/g)||[]).length === 1, 'eodActive is defined more than once');
  assert((rawHtml.match(/&& eodActive\(now\)\) \{/g)||[]).length === 2,
    'both cards must be gated on the same end-of-day window');
  assert(!/const bmYStart = yesterdayStart/.test(rawHtml), 'the bowel card still targets yesterday');
  assert(!/const apYStart = yesterdayStart/.test(rawHtml), 'the appetite card still targets yesterday');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1 and the stubs',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});
await run('NET-2','no page errors',()=>{ assert(errs.length===0, errs.slice(0,2).join(' | ')); });

await browser.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
