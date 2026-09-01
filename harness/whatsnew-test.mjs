// WHAT'S NEW, read off the rendered screen in a real browser.
//
// Aaron, 2026-08-31: "I wanted a section on caretracker under the ellipsis for latest updates or
// versioning. I also want something with a pop up when opening the app to say what new on the
// latest release."
//
// Asserted on the RENDERED DOM and on real localStorage, because every interesting question here is
// about what a PERSON sees and when: does the pop-up appear after an update, does it stay away on a
// fresh install, does it stay away once dismissed, and does the history actually list the releases.
// None of that is visible to a test that only calls functions.
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


// A STUB THAT DOES NOT ANSWER YET. The ordinary stub fires its first snapshot immediately, so the
// app is loaded before anything can be observed and the "never covers Connecting..." claim was
// untestable -- deleting the guard left this suite green at 20/20, which the audit called out as
// the one assertion here backed by nothing. This one holds the entries snapshot until the test
// releases it, which is the only way to see the app in the state the guard exists for.
const STUB_FS_SLOW = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__release=function(){for(const cb of eL)cb(snap(store.entries));};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));return{id:'a'+n};}
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


// SEED A VERSION THIS PHONE HAS ALREADY SEEN, so the app is in the state that matters: an existing
// install picking up an update. Written before the page script runs -- afterwards is too late,
// the decision is made once at start-up.
async function openApp(seenVersion, priorData) {
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
  if (seenVersion !== undefined) {
    await page.addInitScript(v => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, seenVersion);
  } else {
    await page.addInitScript(() => { try { localStorage.removeItem('caretracker-seen-version'); } catch (e) {} });
  }
  // A PHONE THAT HAS BEEN HERE BEFORE. Any other caretracker-* key is the evidence.
  //
  // WHICH key is seeded matters, and an earlier version of this comment got it wrong. It claimed a
  // saved medication list was "the one every returning phone realistically has". The Zero Day
  // Auditor measured the actual start-up writes and it is not: a start-up writes only
  // caretracker-seen-version and caretracker-device-id-v1. The medication config is written ONLY
  // when somebody edits the medication list. So a phone that has run for weeks without ever
  // touching the med list has a device-id and no config — and seeding only the config left this
  // suite green while the fix was broken for exactly that phone, twice over: dropping device-id
  // from the snapshot, and narrowing the snapshot to the config key alone, both stayed 28/28.
  // The guard was hollow for the case it was written to protect. So it now runs BOTH.
  if (priorData === 'config') {
    await page.addInitScript(() => { try {
      localStorage.setItem('caretracker-medication-config-v1', JSON.stringify({ version: 1, meds: [], archivedMeds: [] }));
    } catch (e) {} });
  } else if (priorData) {
    // The realistic returning phone: a device id and nothing else. This is the seed that catches
    // a snapshot narrowed to the wrong key.
    await page.addInitScript(() => { try {
      localStorage.setItem('caretracker-device-id-v1', 'dev-test-0001');
    } catch (e) {} });
  } else {
    await page.addInitScript(() => { try {
      Object.keys(localStorage).forEach(k => { if (k.indexOf('caretracker-') === 0 && k !== 'caretracker-seen-version') localStorage.removeItem(k); });
    } catch (e) {} });
  }
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  return { ctx, page, errs };
}
const appVersion = (rawHtml.match(/APP_VERSION = '([^']*)'/) || [])[1];

console.log('\n1. The app version is read from the file, never pinned here');
t('APP_VERSION found in the build under test', !!appVersion, appVersion);

console.log('\n2. An existing install that has been updated sees the pop-up');
{
  const { ctx, page, errs } = await openApp('v1-something-older');
  const modal = await page.$('[data-whatsnew-modal]');
  t('the pop-up is on screen after an update', !!modal, '');
  if (modal) {
    const txt = (await page.evaluate(() => document.querySelector('[data-whatsnew-modal]').innerText)).trim();
    t('it names the version that is running', txt.indexOf(appVersion) >= 0, txt.split('\n')[0]);
    t('it shows the newest entry, not the whole history',
      (await page.evaluate(() => document.querySelectorAll('[data-whatsnew-modal] [data-whatsnew-entry]').length)) === 1, '');
    t('it offers a way to see everything', !!(await page.$('[data-whatsnew-all]')), '');
  }
  t('no page errors while showing it', errs.length === 0, errs.slice(0,2).join(' | ') || 'none');
  await ctx.close();
}

console.log('\n3. A fresh install is NOT greeted with an update notice');
{
  const { ctx, page } = await openApp(undefined);
  t('no pop-up on a phone that has never run this app', !(await page.$('[data-whatsnew-modal]')), '');
  const stored = await page.evaluate(() => localStorage.getItem('caretracker-seen-version'));
  t('but the current version is recorded silently, so the NEXT update does show', stored === appVersion, String(stored));
  await ctx.close();
}

console.log('\n4. Dismissing it makes it stay dismissed');
{
  const { ctx, page } = await openApp('v1-something-older');
  // GUARDED. With the pop-up disabled there is no close button, and clicking a control that is not
  // there threw a Playwright timeout -- so the suite died with a stack trace instead of a legible
  // red. A suite that crashes when the thing it guards breaks is only accidentally a suite.
  if (!(await page.$('[data-whatsnew-close]'))) {
    t('cannot check dismissal — the pop-up never appeared', false, '');
    t('cannot check that the version is remembered', false, '');
    t('cannot check it stays dismissed', false, '');
    t('cannot check the menu is still reachable', false, '');
    await ctx.close();
  } else {
  await page.click('[data-whatsnew-close]');
  await page.waitForTimeout(400);
  t('it closes when dismissed', !(await page.$('[data-whatsnew-modal]')), '');
  const stored = await page.evaluate(() => localStorage.getItem('caretracker-seen-version'));
  t('the version is remembered', stored === appVersion, String(stored));
  // A SECOND PAGE IN THE SAME BROWSER, not a reload. Reloading re-runs the init script that seeds
  // the old version, so the app correctly showed the pop-up again and the test read that as the app
  // forgetting. The test was wrong, not the app -- and asserting it the wrong way would have hidden
  // a real regression here later. A fresh page shares localStorage and carries no init script, which
  // is what "opening the app again tomorrow" actually looks like.
  const page2 = await ctx.newPage();
  await page2.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(1800);
  t('and it does not come back on the next open', !(await page2.$('[data-whatsnew-modal]')), '');
  t('the history is still reachable from the menu afterwards',
    !!(await page2.$('[data-cal-menu-button]')), '');
  await ctx.close();
  }
}

console.log('\n5. The history lives under the menu and lists the real releases');
{
  const { ctx, page } = await openApp(appVersion);
  t('no pop-up when this phone has already seen this version', !(await page.$('[data-whatsnew-modal]')), '');
  await page.click('[data-cal-menu-button]');
  await page.waitForTimeout(500);
  const row = await page.$('[data-cal-drawer-item="whatsnew"]');
  t('a "What\u2019s new" row is in the menu', !!row, '');
  if (row) {
    await row.click();
    await page.waitForTimeout(600);
    t('it opens the history screen', !!(await page.$('[data-whatsnew-screen]')), '');
    const n = await page.evaluate(() => document.querySelectorAll('[data-whatsnew-entry]').length);
    // Not a pinned number: the file under test decides how many releases there are.
    const expected = (rawHtml.match(/\{ v: 'v[0-9.]+', date:/g) || []).length;
    t('every release in the file is listed', n === expected && n > 10, n + ' shown, ' + expected + ' in the file');
    const screenTxt = await page.evaluate(() => document.querySelector('[data-whatsnew-screen]').innerText);
    t('the newest release is at the top', screenTxt.indexOf(appVersion) >= 0 && screenTxt.indexOf(appVersion) < 200, '');
    t('it tells you which version this phone runs', screenTxt.indexOf('running ' + appVersion) >= 0, '');
    t('the oldest release is there too', screenTxt.indexOf('v13') >= 0, '');
  }
  await ctx.close();
}

console.log('\n6. It fits the narrowest phone');
{
  const { ctx, page } = await openApp('v1-something-older');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(500);
  const spill = await page.evaluate(() => {
    const root = document.querySelector('[data-whatsnew-modal]');
    if (!root) return ['no modal'];
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
  await ctx.close();
}

console.log('\n7. It never covers the "Connecting..." screen');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS_SLOW});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('caretracker-seen-version', 'v0-older'); } catch (e) {} });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  // The app is genuinely still connecting -- prove that before asserting anything about it.
  const connecting = await page.evaluate(() => document.body.innerText.indexOf('Connecting') >= 0);
  t('the app really is on the Connecting screen', connecting, '');
  t('the update notice is NOT on top of it', !(await page.$('[data-whatsnew-modal]')), '');
  await page.evaluate(() => globalThis.__release && globalThis.__release());
  await page.waitForTimeout(1200);
  t('and it appears as soon as the app is ready', !!(await page.$('[data-whatsnew-modal]')), '');
  await ctx.close();
}

console.log('\n8. A phone that SKIPPED a release still gets told what changed');
// THE CASE THAT WOULD HAVE CAUGHT THE v61 MISS, and the reason it is written out separately.
// v61 read "no seen-version record" as "brand new phone" and stayed silent. But that record was
// INTRODUCED in v61, so every phone that already had CareTracker took the new-phone branch on its
// first v61 open and was shown nothing -- on the very release that added the notice. Aaron reported
// it the next morning. Section 3 below asserts the fresh-install case and passed 23/23 throughout,
// because it pinned what I intended; the intent was wrong for the changeover.
// The same thing still bites any phone that skips a release: cached on an old build, jumps two
// versions, has no record, and is read as new. That is what this section holds.
{
  const { ctx, page, errs } = await openApp(undefined, true);
  const modal = await page.$('[data-whatsnew-modal]');
  t('a returning phone with no seen-version record IS shown the notice', !!modal,
    modal ? '' : 'silent — this is the v61 miss, and the case a skipped release still hits');
  const stored = await page.evaluate(() => localStorage.getItem('caretracker-seen-version'));
  t('and the version is stamped so it is asked once, not every load', stored === appVersion, String(stored));
  t('no page errors while deciding', errs.length === 0, errs.join(' / '));
  await ctx.close();
}
{
  // THE SAME PHONE, EVIDENCED BY A SAVED MEDICATION LIST INSTEAD. Both keys must count, because a
  // snapshot that recognises only one of them is broken for every phone carrying the other.
  const { ctx, page, errs } = await openApp(undefined, 'config');
  t('a returning phone evidenced by a saved medication list is also shown the notice',
    !!(await page.$('[data-whatsnew-modal]')), '');
  t('no page errors on that path either', errs.length === 0, errs.join(' / '));
  await ctx.close();
}
{
  // AND THE OTHER SIDE OF IT, or the fix would just be "always show it": a genuinely new phone,
  // with no CareTracker data of any kind, must still be left alone.
  const { ctx, page, errs } = await openApp(undefined, false);
  t('a genuinely new phone is still NOT greeted with an update notice',
    !(await page.$('[data-whatsnew-modal]')), '');
  t('no page errors on a first run either', errs.length === 0, errs.join(' / '));
  await ctx.close();
}

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
