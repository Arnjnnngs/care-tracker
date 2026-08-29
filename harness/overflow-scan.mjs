// LAYOUT AUDIT — does any text escape its box, at real iPhone widths, on EVERY screen?
//
// Aaron, 2026-08-29: "how is auditing being done if nothing can be seen to make sure everything
// looks right? ... on an iPhone, some wording spills outside the text box." The Zero Day Auditor
// said the same thing independently about app-v67: "Every gate in this release is data-layer;
// nothing tests a render path." Every check in this project asserted on bytes, entries and
// offsets. Not one had ever measured a pixel. A caregiver reading a clipped dose instruction is a
// real failure that every existing gate passes.
//
// A FIRST VERSION OF THIS SCANNED ONLY AN EMPTY HOME SCREEN AND REPORTED "CLEAN". That is the trap
// this project already has written down -- a screen check only covers the screens it happens to
// visit. Overflow needs LONG CONTENT to show, so this seeds the real medication names off Brandi's
// record ("Children's Liquid Tylenol", "Dexamethasone") and walks every tab.
//
// WHAT IT CANNOT DO, plainly: this is CHROMIUM at iPhone viewport sizes, not Safari. It catches a
// box too small for its content, which is most "text spills out" bugs. It does NOT catch
// WebKit-specific font metrics. A clean run narrows the search; it does not clear Safari.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/overflow-scan.mjs
//      --shots <dir>   write a screenshot per width per screen
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found');
})();
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' is set.'); process.exit(3); }

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i+1] : null; };
const APP_FILE = arg('--file') || new URL('../index.html', import.meta.url).pathname;
const SHOTS = arg('--shots');
const errs = [], escaped = [];

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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

const DEVICES = [
  { name: 'iPhone SE (1st gen)', w: 320, h: 568 },
  { name: 'iPhone SE 2/3, 8',    w: 375, h: 667 },
  { name: 'iPhone 13/14',        w: 390, h: 844 },
  { name: 'iPhone 15 Pro',       w: 393, h: 852 },
  { name: 'iPhone 14/15 Plus',   w: 428, h: 926 }
];

// Her real medication names, which are what actually stress the layout.
const now = Date.now();
const SEED = [
  { id: 's1', medId: 'children-s-liquid-tylenol', dose: '2 tsp (650 mg)', mg: 650, ts: now - 3600000 },
  { id: 's2', medId: 'dexamethasone', dose: '2 tablets', mg: 8, ts: now - 7200000 },
  { id: 's3', medId: 'lorazapem', dose: '0.5 mg', mg: 0.5, ts: now - 10800000 },
  { id: 's4', medId: 'compazine', dose: '10 mg', mg: 10, ts: now - 14400000 },
  { id: 's5', medId: 'morphine', dose: '15 mg', mg: 15, ts: now - 18000000 },
  { id: 's6', medId: 'temp', dose: '100.9 F', mg: 0, ts: now - 5400000, temp: 100.9 },
  { id: 's7', medId: 'weight', dose: '182 lbs', mg: 0, ts: now - 9000000, weight: 182 },
  { id: 's8', medId: 'paracentesis', dose: '4.5 L', mg: 0, ts: now - 86400000, liters: 4.5 },
  { id: 's9', medId: 'inpatient_start', dose: null, mg: 0, ts: now - 172800000 },
  { id: 's10', medId: 'chemo_date', dose: 'Chemo scheduled', mg: 0, ts: now - 259200000, loggedAt: now - 259200000 },
  { id: 's11', medId: 'symptom_nausea', dose: 'Sharp rib pain after the second dose, worse lying down', mg: 0, ts: now - 12600000 }
];

const SCREENS = ['home', 'meds', 'reports', 'inpatient', 'symptoms'];

let problems = 0;
const report = [];

for (const dev of DEVICES) {
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(rawHtml); return; }
    rs.writeHead(404); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, serviceWorkers: 'block'
  });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (u.startsWith('https://fonts.')) return route.abort();
    escaped.push(u); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(rows => rows.forEach(r => globalThis.__mc.pushEntry(r)), SEED);
  await page.waitForTimeout(1200);

  for (const screen of SCREENS) {
    await page.evaluate(v => { try { if (typeof navigateTo === 'function') navigateTo(v); } catch (e) {} }, screen);
    await page.waitForTimeout(700);

    const found = await page.evaluate(vw => {
      const out = [], seen = new Set();
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const text = (el.textContent || '').trim();
        if (!text) return;
        if ([...el.children].some(c => (c.textContent || '').trim())) return; // leaves only
        const scrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
        const clipped = cs.textOverflow === 'ellipsis';   // deliberate truncation, not a defect
        const overflowsSelf = el.scrollWidth - el.clientWidth > 1 && !scrollable && !clipped;
        const offRight = r.right > vw + 1, offLeft = r.left < -1;
        if (!overflowsSelf && !offRight && !offLeft) return;
        const label = text.slice(0, 64).replace(/\s+/g, ' ');
        const key = label + '|' + Math.round(r.top);
        if (seen.has(key)) return; seen.add(key);
        out.push({ text: label, tag: el.tagName.toLowerCase(),
          kind: overflowsSelf ? 'content wider than its box' : (offRight ? 'off the right edge' : 'off the left edge'),
          overBy: overflowsSelf ? el.scrollWidth - el.clientWidth : Math.round(offRight ? r.right - vw : -r.left),
          box: Math.round(r.width) + 'x' + Math.round(r.height), ws: cs.whiteSpace });
      });
      return out;
    }, dev.w);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, dev.w + '-' + screen + '.png'), fullPage: true });
    }
    if (found.length) {
      problems += found.length;
      report.push({ dev: dev.name, w: dev.w, screen, found });
    }
  }
  await ctx.close();
  server.close();
}
await browser.close();

if (report.length) {
  report.forEach(r => {
    console.log('\n  ' + r.dev + ' (' + r.w + 'px) — ' + r.screen.toUpperCase() + ' — ' + r.found.length + ' problem(s)');
    r.found.slice(0, 10).forEach(f => {
      console.log('      "' + f.text + '"');
      console.log('        <' + f.tag + '> ' + f.kind + ' by ' + f.overBy + 'px · box ' + f.box + ' · white-space:' + f.ws);
    });
    if (r.found.length > 10) console.log('      ... and ' + (r.found.length - 10) + ' more');
  });
} else {
  console.log('  every screen clean at all ' + DEVICES.length + ' iPhone widths');
}
if (errs.length) console.log('\n  PAGE ERRORS: ' + errs.length + '\n    ' + errs.slice(0,3).join('\n    '));
console.log('\n' + (DEVICES.length * SCREENS.length) + ' screen/width combinations, ' + problems + ' overflowing element(s).');
console.log(problems ? 'NOT CLEAN' : 'CLEAN (Chromium at iPhone sizes — not Safari).');
process.exit(problems ? 1 : 0);
