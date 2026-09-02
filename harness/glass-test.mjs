/**
 * glass-test.mjs — the frosted glass must not cost frames.
 *
 * Aaron, 2026-09-02, on live v64: "caretracker screen flickers to often on my Samsung ... it shows
 * that its worse on the ellipsis screen ... home screen doesnt even pass."
 *
 * v64 stopped the app rebuilding itself once a second. That was real, and it was NOT this. Frame
 * analysis of Aaron's own screen recording put the flashing at roughly every 0.33s -- three times
 * a second -- on Home AND on the menu drawer, and the app contains exactly one timer. Two frames
 * either side of a flash showed the drawer GONE, the dark scrim visible through where it had been.
 *
 * The cause was 56 stacked `backdrop-filter: blur(...)` layers. Every card, the header, the bottom
 * bar, the drawer panel and its scrim asked the phone to re-blur their backdrop whenever anything
 * moved. Measured on a 360x780 @3x viewport (Aaron's Galaxy) while scrolling with the drawer open:
 *   v64  ->  134 frames in 3s, 47 of them over 32ms
 *   v65  ->  181 frames in 3s,  0 over 32ms
 *
 * WHAT WAS KEPT AND WHY. The four modal/drawer SCRIMS keep their blur. They are what makes the
 * screen behind the menu read as "behind"; without them a 0.62 scrim still leaves red text legible
 * and the menu stops feeling like a layer. Measured with only those four restored: 181 frames, 0
 * janky. They are cheap because a scrim's backdrop is a static screen, not fifty scrolling cards.
 * Everything else sat on the page's smooth pink gradient, where blurring a gradient returns the
 * same gradient -- so removing those blurs is visually a no-op and costs nothing to lose.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, every other request aborted. Brandi's real
 * Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/glass-test.mjs
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
  throw new Error('playwright not found');
})();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1]
                                             : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const html = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
// Six weeks of history, so the page is as long as the real one and the scroll has somewhere to go.
const NOW = Date.now();
const seed = [];
for (let d = 1; d < 42; d++)
  for (const m of ['tylenol','zofran','protonix','buspirone','paroxetine','iron'])
    seed.push({ medId: m, dose: '1 tablet', mg: 0, ts: NOW - d * 86400000 - 3.6e6 });
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id||'s'+(++n),data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}`;

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// Aaron's Galaxy: 1080x2340 physical at 3x -> 360x780 CSS.
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs});
  if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// Read the version OUT OF THE FILE UNDER TEST rather than naming one here -- a pinned literal has
// broken three patches on this project on the next legitimate release.
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const countGlass = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') out.push((el.getAttribute('data-cal-drawer-overlay') || el.getAttribute('data-mr-overlay')) ? 'scrim' : 'other');
  }
  return out;
});

// Scroll for 3s, sampling every animation frame. A frame over 32ms is one the phone dropped.
const scrollJank = () => page.evaluate(async () => {
  const deltas = [];
  const sc = document.scrollingElement || document.documentElement;
  await new Promise(resolve => {
    let last = performance.now(); const t0 = last; let y = 0;
    (function frame(now) {
      deltas.push(now - last); last = now;
      y = (y + 14) % Math.max(1, sc.scrollHeight - sc.clientHeight);
      sc.scrollTop = y;
      if (now - t0 < 3000) requestAnimationFrame(frame); else resolve();
    })(performance.now());
  });
  deltas.shift();
  return { frames: deltas.length, janky: deltas.filter(d => d > 32).length };
});

console.log('\n1. Home carries no live blur');
{
  const g = await countGlass();
  // PRESENCE IS HALF A CHECK. The other half is that the wrong thing is ABSENT -- so this asserts
  // the count is zero, not merely that some element was inspected.
  t('no blurred layer on the resting Home screen', g.length === 0, g.length + ' blurred element(s)');
  const r = await scrollJank();
  t('scrolling Home drops no frames', r.janky === 0, r.frames + ' frames, ' + r.janky + ' over 32ms');
}

console.log('\n2. The menu drawer — the screen Aaron said was worst');
{
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(800);
  const open = await page.evaluate(() => !!document.querySelector('[data-cal-drawer]'));
  t('the drawer actually opened', open, '');   // without this the jank check below measures Home
  const g = await countGlass();
  const scrims = g.filter(x => x === 'scrim').length;
  const others = g.filter(x => x === 'other').length;
  t('the scrim keeps its blur', scrims >= 1, scrims + ' scrim(s) blurred');
  t('nothing else on the drawer is blurred', others === 0, others + ' non-scrim blurred element(s)');
  const r = await scrollJank();
  t('scrolling with the drawer open drops no frames', r.janky === 0, r.frames + ' frames, ' + r.janky + ' over 32ms');
}

console.log('\n3. Nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' / '));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
