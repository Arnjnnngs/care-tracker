/**
 * scrolllock-test.mjs — the page behind an open overlay must not scroll. One case per overlay.
 *
 * Aaron, 2026-09-06: "when there is a toast pop up or with the 3 elipsies, you can still scroll and
 * see the background moving when trying to scroll. why haven't this been caught. eyes should be
 * actively looking at stuff to verify. there should be cases written for everything to test for."
 *
 * He is right that nothing was looking. Every gate this project has asks a question about a STILL
 * frame — does it fit, is the copy true, can she do the job, does the record survive. Scrolling is
 * not a still frame, and there was no case for it because nobody had written one.
 *
 * This file is that case, per overlay, plus a COMPLETENESS check so a sixth overlay added later
 * cannot ship without a lock. That last one matters more than any single case here: the specific
 * bug is fixed either way, the class of bug is what keeps coming back.
 *
 * WHAT IT ASSERTS, and why the second half is not optional:
 *   1. With the overlay open, a scroll attempt moves the page by 0px.
 *   2. On close, the caregiver is put BACK where she was. A lock that forgets the position drops
 *      her at the top of a long History screen, which is a worse bug than the one being fixed.
 *
 * THE TOAST IS DELIBERATELY EXEMPT and is asserted to be so. A toast is not a modal; freezing the
 * page for three seconds after every dose would be its own defect. Aaron named it in the same
 * sentence as the menu, so it is tested for the OPPOSITE behaviour rather than quietly skipped.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, every other request aborted. Brandi's real
 * Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/scrolllock-test.mjs
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

const DAY = 86400000, NOW = Date.now();
// ENOUGH HISTORY THAT THE PAGE IS ACTUALLY SCROLLABLE. With a short page every scroll attempt moves
// 0px whether or not anything is locked, and every check here would pass on a build with no lock at
// all — the exact shape of vacuous check this project keeps retiring.
const seed = [];
for (let i = 0; i < 60; i++) {
  seed.push({ id: 'sd' + i, medId: 'tylenol', dose: '2 tsp (650 mg)', mg: 650, ts: NOW - (i * 6 + 2) * 3600000 });
}
seed.push({ id: 'sw1', medId: 'weight', weight: 156.2, dose: '156.2 lbs', mg: 0, ts: NOW - 9 * DAY });
seed.push({ id: 'sw2', medId: 'weight', weight: 154.8, dose: '154.8 lbs', mg: 0, ts: NOW - 20 * DAY });
// APPOINTMENTS, so the calendar's day panel is long enough to scroll. Without them that screen fits
// on one phone screen, the "was it scrolled before it opened" guard fails, and the appointment
// case would otherwise have reported 0 -> 0 and called itself a pass — a check that cannot fail.
// The guard catching that is the reason it is written that way.
for (let i = 0; i < 14; i++) {
  seed.push({ id: 'ap' + i, medId: 'appointment', apptId: 'appt_' + i, title: 'Oncology follow-up ' + (i + 1),
              note: 'Bring the printed record and the current medication list',
              dose: 'Appointment', mg: 0, cancelled: false, ts: NOW + 3 * DAY + i * 900000, loggedAt: NOW - DAY });
}

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));push();return{id:'a'+n};}
export async function deleteDoc(){} export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
`;

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
  if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs});
  if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// The page's own scroll offset, whichever mechanism is holding it. When the body is taken out of
// flow the window no longer scrolls, so window.scrollY alone would read 0 and every check would
// pass trivially; the body's own `top` is what says where the content actually sits.
const offset = () => page.evaluate(() => {
  const top = parseInt(document.body.style.top || '0', 10) || 0;
  return { win: Math.round(window.scrollY), bodyTop: top, effective: Math.round(window.scrollY) + (-top) };
});
const tryScroll = async (by) => {
  await page.evaluate((d) => window.scrollBy(0, d), by);
  await page.waitForTimeout(350);
};
const canScroll = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight > 200);

console.log('\n0. The page has to be scrollable, or none of this proves anything');
{
  await tryScroll(400);
  const o = await offset();
  t('the seeded app is long enough to scroll', await canScroll(), '');
  t('and it does scroll when nothing is open', o.effective > 100, 'offset ' + o.effective);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

// One case per overlay. Each entry says how to open it and how to close it again.
const overlays = [
  { name: 'the menu (the three lines)',
    open: async () => { await page.evaluate(() => { const b = document.querySelector('[data-cal-menu-button]'); if (b) b.click(); }); },
    isOpen: () => page.evaluate(() => !!document.querySelector('[data-cal-drawer-overlay]')),
    close: async () => { await page.evaluate(() => { const b = document.querySelector('[data-cal-drawer-close]'); if (b) b.click(); }); } },
  { name: 'the date & time dialog',
    // NAVIGATION IS SEPARATE FROM OPENING, and the first version of this file got that wrong: it
    // navigated inside open(), so the baseline offset was measured on the PREVIOUS screen and the
    // 400 -> 0 that follows any screen change read as a broken lock. The suite scrolls the screen
    // the overlay actually belongs to, then opens it.
    goto: async () => {
      await page.evaluate(() => { const b = document.querySelector('[data-cal-menu-button]'); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('Reports')); if (b) b.click(); });
      await page.waitForTimeout(500);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim().startsWith('Weight')); if (b) b.click(); });
      await page.waitForTimeout(800);
    },
    open: async () => {
      await page.evaluate(() => { const b = document.querySelector('[data-weight-edit]'); if (b) b.click(); });
    },
    isOpen: () => page.evaluate(() => !!document.querySelector('input[type="datetime-local"]')),
    close: async () => {
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Cancel$/i.test((x.innerText||'').trim())); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Back/.test(x.innerText||'')); if (b) b.click(); });
    } },
  { name: 'the appointment sheet',
    goto: async () => {
      await page.evaluate(() => { const b = document.querySelector('[data-cal-menu-button]'); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const r = document.querySelector('[data-cal-drawer-item="calendar"]'); if (r) r.click(); });
      await page.waitForTimeout(800);
      // THE DAY THAT ACTUALLY HAS SOMETHING ON IT. Clicking the first cell in the grid opened an
      // empty day panel, which is one screen tall and cannot scroll -- so the guard below failed
      // and the case would have been vacuous. Pick a day carrying a count badge.
      await page.evaluate(() => {
        const badge = document.querySelector('[data-cal-day-count]');
        const cell = badge ? badge.closest('[data-cal-day-cell]') : document.querySelector('[data-cal-day-cell]');
        if (cell) cell.click();
      });
      await page.waitForTimeout(600);
    },
    open: async () => {
      await page.evaluate(() => { const b = document.querySelector('[data-cal-day-add-button]') || document.querySelector('[data-cal-add-button]'); if (b) b.click(); });
    },
    isOpen: () => page.evaluate(() => !!document.querySelector('[data-cal-sheet-remove], [data-cal-appt-edit]') ||
      [...document.querySelectorAll('button')].some(b => /^Save$/i.test((b.innerText||'').trim()))),
    close: async () => {
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Cancel$/i.test((x.innerText||'').trim())); if (b) b.click(); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => ((x.getAttribute('aria-label')||x.innerText||'').trim().toLowerCase()) === 'home'); if (b) b.click(); });
    } }
];

for (const ov of overlays) {
  console.log('\n— ' + ov.name);
  if (ov.goto) { await ov.goto(); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await tryScroll(400);
  const before = (await offset()).effective;
  await ov.open();
  await page.waitForTimeout(700);
  const opened = await ov.isOpen();
  t('it opens at all (otherwise this case tests nothing)', opened, opened ? '' : 'could not open it');
  if (!opened) continue;
  // THE LOCK ITSELF, asserted on every overlay whether or not this particular screen happens to be
  // long enough to scroll. It fails on a build without the fix, so it carries the case on its own.
  const engaged = await page.evaluate(() => document.body.style.position === 'fixed');
  t('the lock is engaged while it is open', engaged, engaged ? '' : 'body is not taken out of flow');
  await tryScroll(600);
  const during = (await offset()).effective;
  // AND THE BEHAVIOUR, but only where it can actually be observed. On a screen that fits in one
  // phone height, "it did not move" is 0 -> 0 and true of a build with no lock at all -- so it is
  // reported as not applicable rather than counted as a pass. Silent not-applicable is how vacuous
  // coverage gets built, so it is printed.
  if (before > 100) {
    t('the page behind it does NOT move when you scroll', during === before, before + ' -> ' + during);
  } else {
    console.log('  n/a   this screen fits in one phone height, so there is no scrolling to observe' +
                ' — the lock check above is what covers this overlay');
  }
  await ov.close();
  await page.waitForTimeout(800);
  const after = (await offset()).effective;
  const released = await page.evaluate(() => document.body.style.position !== 'fixed');
  t('the lock is released when it closes', released, released ? '' : 'body left out of flow after close');
  if (before > 100) {
    t('and closing it puts you back where you were', Math.abs(after - before) <= 2, before + ' -> ' + after);
  }
}

console.log('\n— the toast, which must NOT lock the page');
{
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => ((x.getAttribute('aria-label')||x.innerText||'').trim().toLowerCase()) === 'home'); if (b) b.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await tryScroll(400);
  const before = (await offset()).effective;
  // Any logged dose raises a toast; the Tylenol card is on Home and always present.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Log$/i.test((x.innerText||'').trim()));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  await tryScroll(300);
  const during = (await offset()).effective;
  t('a toast does not freeze the page', during !== before || before === 0, before + ' -> ' + during);
}

console.log('\n— the risk the fix itself creates: restoring scroll onto a screen she never scrolled');
{
  // A lock that remembers the offset has to be careful WHERE it puts it back. Open the menu 700px
  // down Home, tap a different screen, and a naive restore would drop her 700px into a screen she
  // has never seen. Checked rather than assumed, because it is the obvious way this fix goes wrong.
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => ((x.getAttribute('aria-label')||x.innerText||'').trim().toLowerCase()) === 'home'); if (b) b.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await tryScroll(700);
  const before = (await offset()).effective;
  t('Home is scrolled down before opening the menu', before > 100, 'offset ' + before);
  await page.evaluate(() => { const b = document.querySelector('[data-cal-menu-button]'); if (b) b.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const r = document.querySelector('[data-cal-drawer-item="meds"]'); if (r) r.click(); });
  await page.waitForTimeout(1000);
  const landed = await page.evaluate(() => Math.round(window.scrollY));
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 400);
  t('the screen she lands on is long enough for this to be a real risk', tall, '');
  t('going to a new screen from the menu lands at the top, not at the old offset', landed < 50, 'scrollY ' + landed);
}

console.log('\n— completeness: no overlay may be added without a lock');
{
  // THE CHECK THAT OUTLIVES THIS RELEASE. The specific five are fixed either way; what keeps
  // recurring is a SIXTH overlay added later with nobody thinking about scroll. Every full-screen
  // scrim in this app is `position: 'fixed', inset: '0'` with a zIndex above the nav, and each is
  // gated on one piece of state. If a gate is not named in anyOverlayOpen(), it does not lock.
  const src = html;
  const gate = (src.match(/function anyOverlayOpen\(\)\s*\{[\s\S]*?\}/) || [''])[0];
  t('anyOverlayOpen() exists', gate.length > 0, gate ? '' : 'no scroll-lock gate in the file');
  const keys = ['drawerOpen', 'timeModal', 'whatsNewOpen', 'apptSheet', 'missReasonSheet'];
  const missing = keys.filter(k => gate.indexOf(k) < 0);
  t('every overlay this app mounts is named in it', missing.length === 0,
    missing.length ? 'not locked: ' + missing.join(', ') : keys.length + ' overlays covered');
  // And the lock must actually be called from render(), not merely defined.
  const called = /applyScrollLock\(\);/.test(src.slice(src.indexOf('function render()')));
  t('and render() calls it', called, called ? '' : 'applyScrollLock is defined but never called');
}

console.log('\n— nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' / ').slice(0, 200));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
