/**
 * repaint-test.mjs — the screen must stop rebuilding itself needlessly, WITHOUT going stale.
 *
 * Aaron, 2026-09-01: "caretracker screen flickers to often on my Samsung. I assume bc it's trying
 * to stay live with my phone and Brandi's iphone."
 *
 * It was not the sync. Measured with Firestore stubbed and completely silent: TEN full rebuilds in
 * ten seconds, one per second, with main-thread stalls of ~20ms on a modest fixture and ~30ms with
 * six months of history — so it grows with the record, which is why it became noticeable rather
 * than always having been so. The `setInterval(…, 1000)` calls `render()`, and `render()` tears
 * down and rebuilds the whole tree under #root.
 *
 * Roughly 59 of every 60 of those rebuilds changed nothing a person could see: every clock in the
 * app is `toLocaleTimeString` with hour and minute only, and the single seconds-level display
 * (`fmtCountdown`) has exactly one caller — the "Opens in 2m 30s. Log it early anyway?" override
 * prompt.
 *
 * THE DANGER IN FIXING IT is the opposite defect: a screen that stops updating. A frozen clock, a
 * card that never unlocks, or a countdown that stops moving would all be worse than the flicker.
 * So this suite asserts BOTH halves — that the needless repaints are gone, and that everything
 * time-driven still keeps up — and each half is falsified against the other.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, every other request aborted. Brandi's real
 * Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/repaint-test.mjs
 *      --file <path>   to point at a scratch copy during falsification
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
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
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1]
                                             : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

// THE APP'S OWN CLOCK, UNDER THIS SUITE'S CONTROL. Waiting on the wall clock for a minute boundary
// would make the suite slow and, worse, flaky — it would pass or fail depending on which second it
// happened to start at. simNow() is the single place the app reads the time.
let raw = fs.readFileSync(APP_FILE, 'utf8');
const CLOCK_SRC = 'function simNow() { return Date.now(); }';
if (raw.indexOf(CLOCK_SRC) < 0) { console.error('REFUSING: simNow() is not the shape this suite drives.'); process.exit(3); }
raw = raw.replace(CLOCK_SRC, 'function simNow() { return (globalThis.__clock || Date.now()); }');
// A SECOND HOOK, so a throw inside render() can be forced on demand. The auditor found that if
// render() throws, the exception escapes the interval callback and tickRepaint stays true -- after
// which every render, including a caregiver's tap, is silently subject to the signature gate. The
// fix is a try/finally; this is what proves the fix does anything. paintSignature() is called from
// inside render() on the tick path, so throwing there throws where it matters.
const SIG_SRC = 'function paintSignature() {';
if (raw.indexOf(SIG_SRC) < 0) { console.error('REFUSING: paintSignature() is not the shape this suite drives.'); process.exit(3); }
// THROWS FOR AS LONG AS THE FLAG IS SET, not once. A single throw does not strand anything: the
// NEXT tick runs a second later, completes normally, and clears tickRepaint on its way out -- so a
// test that waits before tapping measures a state that has already healed. The first version of
// this check did exactly that and passed against a build with the try/finally removed.
raw = raw.replace(SIG_SRC, SIG_SRC + ' if (globalThis.__throwAlways) { throw new Error("forced for the repaint suite"); }');

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const stubFs = (seed) => `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id||'s'+(++n),data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

// A fixed wall time, so nothing here depends on when the suite happens to run.
const START = new Date(2026, 8, 1, 10, 0, 5).getTime();
// A gap medication whose lock expires at 10:00:40 — deliberately MID-MINUTE, so "it unlocks on the
// minute boundary" and "it unlocks when it is actually due" give different answers and the check
// can tell them apart.
const GAP_H = 4;
const DOSE_TS = START - GAP_H * 3600000 + 35000;
const SEED_MEDS = { version: 1, archivedMeds: [], meds: [
  { id: 'gap-one', name: 'Gap One', type: 'gap', quickLog: true, gapH: GAP_H,
    doses: [{ label: '1 tablet', mg: 0 }] }
]};

async function boot() {
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(raw); return; }
    rs.writeHead(204); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs([{ medId:'gap-one', dose:'1 tablet', mg:0, ts:DOSE_TS }])});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort(); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(([clock, meds]) => {
    globalThis.__clock = clock;
    try { localStorage.setItem('caretracker-medication-config-v1', JSON.stringify(meds)); } catch (e) {}
    try { localStorage.setItem('caretracker-seen-version', 'already-seen'); } catch (e) {}
  }, [START, SEED_MEDS]);
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // Count full rebuilds: render() replaces the children of #root, so a childList removal on that
  // node is one repaint.
  await page.evaluate(() => {
    globalThis.__repaints = 0;
    const root = document.getElementById('root');
    new MutationObserver(ms => { for (const m of ms) if (m.type === 'childList' && m.removedNodes.length && m.target === root) globalThis.__repaints++; })
      .observe(root, { childList: true });
  });
  return { ctx, page, server, errs,
    setClock: (v) => page.evaluate(x => { globalThis.__clock = x; }, v),
    repaints: () => page.evaluate(() => globalThis.__repaints),
    clock: () => page.evaluate(() => { const h = document.querySelector('header'); return h ? (h.innerText.match(/\d{1,2}:\d{2}\s*(AM|PM)?/i) || [''])[0] : ''; }),
    body: () => page.evaluate(() => (document.querySelector('main') || {}).innerText || ''),
    close: async () => { await ctx.close(); server.close(); } };
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

console.log('\n1. Idle: the screen is not rebuilt when nothing a person can see would change');
{
  const a = await boot();
  await a.setClock(START + 4000);
  await new Promise(r => setTimeout(r, 4000));
  const n = await a.repaints();
  // Four seconds inside one minute, no user action, no data change. The old build repainted four
  // times here; the whole point of the gate is that this is now zero.
  t('no full rebuild during four idle seconds inside the same minute', n === 0, n + ' rebuild(s)');
  t('no page errors', a.errs.length === 0, a.errs.join(' / '));
  await a.close();
}

console.log('\n2. But the clock still moves — a frozen screen is worse than a flickering one');
{
  const a = await boot();
  const first = await a.clock();
  await a.setClock(START + 4000);
  await new Promise(r => setTimeout(r, 2500));
  t('the clock does not move within the same minute', (await a.clock()) === first, first);
  await a.setClock(START + 70000);
  await new Promise(r => setTimeout(r, 2500));
  const second = await a.clock();
  t('the clock moves as soon as the minute changes', second !== first, first + ' -> ' + second);
  await a.setClock(START + 3670000);
  await new Promise(r => setTimeout(r, 2500));
  const third = await a.clock();
  t('and it is still keeping up an hour later', third !== second, second + ' -> ' + third);
  t('exactly the repaints that were needed, not one per second',
    (await a.repaints()) <= 4, (await a.repaints()) + ' rebuild(s) across three clock jumps');
  await a.close();
}

console.log('\n3. A medication unlocks when it is DUE, not at the next minute boundary');
{
  // The lock expires at 10:00:40. If the gate keyed on the minute alone, the card would stay locked
  // until 10:01:00 — up to a minute late, and after the time printed on the card. The signature
  // includes which medications are locked precisely so this lands on the second it is due.
  const a = await boot();
  // SCOPED TO THE MEDICATION'S OWN CARD. Reading the whole of <main> matched "Available" in the
  // missed-dose banner, which has nothing to do with this medication -- a check that passes for the
  // wrong reason, which is the failure mode this project keeps paying for.
  // THE SMALLEST ELEMENT THAT STILL CONTAINS THE MEDICATION'S NAME. Selecting `main section` picked
  // up the whole Quick Log section, which holds every card -- so "Available" from a DIFFERENT
  // medication satisfied a check about this one. Same class as reading the whole of <main>: a
  // selector that is too wide is a check that passes for the wrong reason.
  const card = () => a.page.evaluate(() => {
    let best = null;
    for (const el of document.querySelectorAll('main *')) {
      const txt = el.innerText || '';
      // Must hold the name AND a status word: the smallest element containing only the name is the
      // title label, which carries no state at all -- narrowing too far is as wrong as too wide.
      if (!/Gap One/.test(txt)) continue;
      if (!/Available|Waiting|Opens/i.test(txt)) continue;
      if (!best || txt.length < best.length) best = txt;
    }
    return best ? best.replace(/\s+/g, ' ').trim() : '(no Gap One card)';
  });
  const before = await card();
  t('the Gap One card was found', !/no Gap One card/.test(before), before.slice(0, 90));
  t('the medication starts out locked', /Waiting|Opens/i.test(before) && !/Available/i.test(before), before.slice(0, 90));
  await a.setClock(START + 36000);   // 10:00:41 — one second past the gap expiring, mid-minute
  await new Promise(r => setTimeout(r, 2500));
  const after = await card();
  t('it unlocks the moment it is due, without waiting for the minute to turn',
    /Available/i.test(after) && !/Opens/i.test(after), after.slice(0, 90));
  await a.close();
}

console.log('\n4. The one thing on screen that counts in SECONDS keeps counting');
{
  // THE ONLY SECONDS-GRANULAR DISPLAY IN THE APP, AND THIS SUITE SHIPPED WITHOUT COVERING IT.
  // Found by the Zero Day Auditor: replacing the signature's seconds term with a constant froze
  // the "Opens in 2m 30s" countdown while every check here stayed green. A release whose whole
  // subject is "the screen must not go stale" left the one thing that ticks in seconds unguarded.
  //
  // The countdown lives in the override prompt -- tap a locked medication and the app offers to log
  // it early, showing how long is left. That prompt is the sole caller of fmtCountdown().
  const a = await boot();
  const openOverride = await a.page.evaluate(() => {
    // The locked card's own control opens the prompt. Scoped to the card, not the page: a
    // page-wide button search picks up whatever the header offers first.
    // Smallest element that holds the name, its locked status, AND a button. Requiring the button
    // matters: the smallest element carrying just the name and status is a text row with no
    // control in it at all, which is what the first version of this selector found.
    let card = null;
    for (const el of document.querySelectorAll('main *')) {
      const txt = el.innerText || '';
      if (!/Gap One/.test(txt) || !/Waiting|Opens/i.test(txt)) continue;
      if (!el.querySelector('button')) continue;
      if (!card || txt.length < (card.innerText || '').length) card = el;
    }
    if (!card) return 'no locked Gap One card with a control on it';
    const b = [...card.querySelectorAll('button')].pop();
    b.click();
    return true;
  });
  t('the locked medication offers to log it early', openOverride === true, String(openOverride));
  await new Promise(r => setTimeout(r, 900));
  const countdown = () => a.page.evaluate(() => {
    const m = (document.querySelector('main') || {}).innerText || '';
    const hit = m.match(/\b\d+m\s*\d+s\b|\b\d+s\b/);
    return hit ? hit[0] : '(no countdown on screen)';
  });
  const c1 = await countdown();
  t('a seconds-level countdown is on screen', /\d/.test(c1), c1);
  // Three seconds later it must read differently. Same minute throughout, so ONLY the seconds term
  // of the signature can cause this repaint -- which is exactly what is being pinned.
  await a.setClock(START + 3000);
  await new Promise(r => setTimeout(r, 2500));
  const c2 = await countdown();
  t('it counts down while the prompt is open, inside the same minute', c2 !== c1, c1 + ' -> ' + c2);
  await a.close();
}

console.log('\n5. A throw inside a repaint must not strand the gate');
{
  // WITHOUT THE try/finally THIS IS A SILENTLY DROPPED TAP. tickRepaint is set true around the
  // tick's render call; if that render throws, the exception escapes the interval callback and the
  // flag is never cleared. Every render afterwards -- including the one a caregiver's tap causes --
  // then goes through the signature gate, and inside the same minute the signature has not changed,
  // so the tap paints nothing at all. Measured by the Zero Day Auditor at 0 rebuilds for the first
  // tap after a forced throw. It self-heals on the next tick, which is precisely what makes it the
  // kind of defect nobody reproduces and everybody doubts.
  const a = await boot();
  await a.page.evaluate(() => { globalThis.__throwAlways = true; });
  await new Promise(r => setTimeout(r, 1500));   // let at least one tick throw
  // ASSERT THE SABOTAGE ACTUALLY FIRED. Without this line the whole section passes on a build with
  // the try/finally REMOVED -- rename the injected flag so the app never throws and it still went
  // 16/16 green, because nothing here checked that a throw had happened. Found by the Zero Day
  // Auditor on the re-verify. A check that cannot tell a live hook from a dead one is not a check.
  t('the forced throw actually fired', a.errs.some(e => /forced for the repaint suite/.test(e)),
    a.errs.length + ' page error(s)');
  const before = await a.repaints();
  const opened = await a.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || ''));
    if (!b) return false; b.click(); return true;
  });
  t('the menu button was found', opened, '');
  await new Promise(r => setTimeout(r, 900));
  const after = await a.repaints();
  t('a tap still paints after a repaint threw', after > before, before + ' -> ' + after);
  await a.close();
}

console.log('\n6. A user action still repaints immediately');
{
  const a = await boot();
  const before = await a.repaints();
  // Opening the menu is a pure state change with no clock involvement.
  const opened = await a.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || ''));
    if (!b) return false; b.click(); return true;
  });
  t('the menu button was found', opened, '');
  await new Promise(r => setTimeout(r, 900));
  const after = await a.repaints();
  t('a tap repaints straight away, gate or no gate', after > before, before + ' -> ' + after);
  await a.close();
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
await browser.close();
process.exit(fail ? 1 : 0);
