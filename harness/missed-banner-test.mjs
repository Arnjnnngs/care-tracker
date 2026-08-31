// THE MISSED-DOSE BANNER, rendered in a real browser and read off the screen.
//
// Aaron, 2026-08-29: "the long list of banner needs a real redesign." He screenshotted a wall of
// text: every miss written as a full sentence -- "Tuesday, Aug 4: Dexamethasone - Afternoon window
// (2:00 PM) closed with no dose logged" -- and all of them joined with ' · ' into ONE paragraph.
// Twelve misses meant twelve near-identical sentences with the useful words buried mid-sentence.
//
// This asserts on the RENDERED DOM, not on the source and not on a helper function, because the
// defect was never in the data -- missedDosesFor() was right all along. It was in how the data was
// put on screen, which no data-layer test in this project could ever have caught.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/missed-banner-test.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/pw-browsers/../node_modules/playwright', '/opt/node22/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found');
})();
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' is set.'); process.exit(3); }

const FILE = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : new URL('../index.html', import.meta.url).pathname;
const rawHtml = fs.readFileSync(FILE, 'utf-8');

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={ pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));} };
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

let pass = 0, fail = 0;
function t(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  |  ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  |  ' + detail : '')); }
}

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(rawHtml); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
  if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// NO SEEDED ENTRIES AT ALL. Every tracked medication with a closed window since MISSED_TRACK_SINCE
// is therefore missed, which is the exact shape of Aaron's screenshot: a long backlog spanning many
// days. Seeding misses directly is not possible -- a miss is DERIVED from the absence of an entry.
const banner = async () => page.evaluate(() => {
  const clear = document.querySelector('[data-missed-clear]');
  if (!clear) return null;
  let el = clear;
  while (el && !(el.parentElement && el.parentElement.tagName === 'SECTION') && el.parentElement) {
    if (el.getAttribute && el.getAttribute('style') && /2px solid/.test(el.getAttribute('style'))) break;
    el = el.parentElement;
  }
  const root = el || clear.parentElement;
  const text = root.innerText;
  return {
    text,
    // The first line of the banner is the round "!" icon, not the heading. Reading line 0 as the
    // heading made this test fail on a correct app -- a test bug, fixed here rather than by
    // loosening the assertion it was getting wrong.
    heading: (text.split('\n').map(s => s.trim()).find(s => /missed dose/i.test(s)) || '').trim(),
    lines: text.split('\n').map(s => s.trim()).filter(Boolean),
    more: !!document.querySelector('[data-missed-more]'),
    moreLabel: (document.querySelector('[data-missed-more]') || {}).innerText || '',
    less: !!document.querySelector('[data-missed-less]')
  };
});

const b = await banner();
console.log('\n1. The banner is on screen and leads with a count');
t('the missed-dose banner rendered at all', !!b, b ? '' : 'no [data-missed-clear] found');
if (!b) { console.log('\nFAILED early — cannot continue'); await browser.close(); server.close(); process.exit(1); }
const countMatch = b.heading.match(/^(\d+)\s+MISSED DOSES?$/i);
t('the heading is a COUNT, not the bare words "Missed doses"', !!countMatch, b.heading);
const total = countMatch ? Number(countMatch[1]) : 0;
t('the count is a real number greater than zero', total > 0, String(total));

console.log('\n2. It is a list, not one run-on paragraph');
// The old render joined every miss with ' · ' into a single text node. That is the defect.
t('no line crams two or more misses together with the old separator',
  !b.lines.some(l => (l.match(/ · /g) || []).length >= 2),
  b.lines.find(l => (l.match(/ · /g) || []).length >= 2) || 'none');
t('the repeated boilerplate is gone',
  !/closed with no dose logged/i.test(b.text),
  /closed with no dose logged/i.test(b.text) ? 'still present' : 'absent');
t('each dose is its own line', b.lines.length > 2, b.lines.length + ' lines');

console.log('\n3. A long backlog is capped, and says what it is hiding');
// Aaron's failure case: an in-patient stay produces a backlog spanning many days, and an
// unbounded banner pushes Today's actual medication cards off the screen.
const dayHeads = b.lines.filter(l => /^(TODAY|YESTERDAY|[A-Z][a-z]+day, [A-Z][a-z]{2} \d+)$/i.test(l));
t('at most three days are shown while collapsed', dayHeads.length <= 3, dayHeads.length + ' day headings');
t('a control offers the rest', b.more, b.moreLabel);
t('the control names how many are hidden, not just "more"',
  /\d+\s+more on\s+\d+\s+earlier day/i.test(b.moreLabel), b.moreLabel);
const shownNow = b.lines.length;

console.log('\n4. The control actually reveals them, and can be reversed');
// GUARDED. Removing the cap makes the "show more" control disappear, and clicking a control that is
// not there threw a Playwright timeout -- so the suite died with a stack trace instead of a legible
// red. A test that crashes when the thing it guards breaks is only accidentally a test.
if (!b.more) {
  t('cannot check the reveal control — it is not on screen (the cap is not in effect)', false, '');
  console.log('\n' + pass + '/' + (pass + fail + 4) + ' checks passed  (4 skipped: no reveal control)');
  await browser.close(); server.close(); process.exit(1);
}
await page.click('[data-missed-more]');
await page.waitForTimeout(500);
const b2 = await banner();
t('expanding shows strictly more lines than before', b2.lines.length > shownNow, shownNow + ' -> ' + b2.lines.length);
t('expanded, nothing is left hidden', !b2.more, b2.more ? 'still offering more' : 'all shown');
t('expanded, a way back is offered', b2.less, '');
t('the count in the heading did not change when expanding',
  b2.heading === b.heading, b.heading + ' -> ' + b2.heading);
await page.click('[data-missed-less]');
await page.waitForTimeout(500);
const b3 = await banner();
t('collapsing returns to the capped view', b3.lines.length === shownNow, shownNow + ' vs ' + b3.lines.length);

console.log('\n5. It fits the narrowest phone');
// The whole reason this file exists in a browser: 320px is where text ran off the card.
await page.setViewportSize({ width: 320, height: 568 });
await page.waitForTimeout(600);
const spill = await page.evaluate(() => {
  const clear = document.querySelector('[data-missed-clear]');
  if (!clear) return ['no banner'];
  let root = clear; for (let i = 0; i < 6 && root.parentElement; i++) root = root.parentElement;
  const bad = [];
  root.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || !el.getClientRects().length) return;
    const txt = (el.textContent || '').trim();
    if (!txt || [...el.children].some(c => (c.textContent || '').trim())) return;
    const p = el.parentElement; if (!p) return;
    const pcs = getComputedStyle(p), pr = p.getBoundingClientRect();
    const innerW = pr.width - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    const r = document.createRange(); r.selectNodeContents(el);
    const rects = [...r.getClientRects()];
    const w = rects.length ? Math.max(...rects.map(q => q.width)) : 0;
    if (w > 0 && innerW > 0 && w - innerW > 1.5) bad.push(txt.slice(0, 40) + ' (+' + Math.round(w - innerW) + 'px)');
  });
  return bad;
});
t('no wording spills its box at 320px', spill.length === 0, spill.slice(0, 3).join(' | ') || 'clean');
t('the app logged no errors while rendering it', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
