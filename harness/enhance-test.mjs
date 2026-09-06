/**
 * enhance-test.mjs — the report screens must be able to do the whole job.
 *
 * Aaron, 2026-09-06: "there isn't a way to add a para from the reports screen. there also a way to
 * edit cycles."
 *
 * v66 adds: an add row on Paracentesis and Weight, Edit on paracentesis rows, and Start/End/Remove
 * on cycle history rows. This suite drives each of them in a browser.
 *
 * THE CHECK THAT MATTERS MOST is that editing a paracentesis SUPERSEDES rather than duplicates.
 * A paracentesis edit writes a NEW database record carrying the SAME paraId; paracentesisResolved()
 * keeps the newest loggedAt per id. Get that wrong and correcting "45 L" to "4.5 L" leaves BOTH on
 * screen -- a fluid-balance record showing a drain that never happened. So this suite asserts the
 * row COUNT is unchanged as well as the value, because asserting the new value alone passes just
 * as happily on a build that duplicated.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, every other request aborted. Brandi's real
 * Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/enhance-test.mjs
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

const DAY = 86400000;
const NOW = Date.now();
// One paracentesis and one closed period, both a few days back so nothing depends on the hour the
// suite happens to run at.
// EVERY SEEDED ROW CARRIES AN EXPLICIT id. The first version left them out and let snap() invent
// one on read, so the stub's deleteDoc filter -- which compares e.id -- matched nothing and every
// delete silently did nothing. That made the cycle-move check fail against a build where the move
// works, and the failure looked like an app bug for a good ten minutes.
const seed = [
  { id: 'seed_para_1', medId: 'paracentesis', paraId: 'para_seed_one', liters: 4.5, dose: '4.5 L', mg: 0,
    ts: NOW - 3 * DAY, loggedAt: NOW - 3 * DAY },
  { id: 'seed_cyc_start', medId: 'cycle_start', dose: null, mg: 0, ts: NOW - 10 * DAY },
  { id: 'seed_cyc_end',   medId: 'cycle_end',   dose: null, mg: 0, ts: NOW - 6 * DAY }
];
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id||('s_'+(e.medId)+'_'+e.ts),data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));push();return{id:'a'+n};}
export async function deleteDoc(ref){const id=ref&&ref.id;store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entryCount=()=>store.entries.length;
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
// Read the version OUT OF THE FILE UNDER TEST. A pinned literal breaks this suite on the next
// legitimate release and has already cost this project three patches.
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const openReport = async (label) => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().startsWith('Reports'));
    if (b) b.click();
  }, label);
  await page.waitForTimeout(500);
  await page.evaluate((lbl) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim().startsWith(lbl));
    if (b) b.click();
  }, label);
  await page.waitForTimeout(600);
};
const modalOpen = () => page.evaluate(() => !!document.querySelector('input[type="datetime-local"]'));
// CONFIRM AND THEN PROVE IT CLOSED. The first version fired the click and slept. When a confirm
// silently failed, the modal stayed up and swallowed every later click -- the suite then died 60
// lines away with "Yesterday intercepts pointer events", pointing at the wrong section entirely.
// A helper that cannot tell success from failure moves the error, it does not find it.
const confirmModal = async (where) => {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Confirm$/i.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  for (let i = 0; i < 30 && await modalOpen(); i++) await page.waitForTimeout(100);
  if (await modalOpen()) throw new Error('modal did not close after Confirm at: ' + where);
  await page.waitForTimeout(400);
};
// Count rows by the resolved record set, not by scraping text. In a single-file app the source is
// in document.body, so any text assertion matches the source itself.
const paraCount = () => page.evaluate(() => window.__paraCount ? window.__paraCount() : null);
await page.evaluate(() => {
  // paracentesisResolved is module-scoped; expose the row count via the rendered rows' own hook.
  window.__paraCount = () => document.querySelectorAll('[data-para-edit]').length;
});

console.log('\n1. Paracentesis — the screen that could delete but not add');
{
  await openReport('Paracentesis');
  const addBox = await page.$('[data-para-report-add]');
  t('an add control exists on the Paracentesis report', !!addBox, addBox ? '' : 'no [data-para-report-add]');
  const before = await paraCount();
  if (addBox) {
    await addBox.fill('2.5');
    await page.evaluate(() => {
      const inp = document.querySelector('[data-para-report-add]');
      const btn = inp && inp.parentElement && [...inp.parentElement.querySelectorAll('button')].find(b => /^Log$/.test((b.innerText||'').trim()));
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    // ASSERT ON THE ELEMENT, NOT ON TEXT. The first version scanned body text for "Date & Time"
    // and went red while the flow underneath worked perfectly -- the record count proved it. This
    // is a single-file app: the project rule is never to assert on body text, because the source
    // is in it, and here the same habit produced the mirror-image error, a false RED.
    const modal = await modalOpen();
    t('logging from the report opens the date/time step', modal, '');
    await confirmModal('para-add');
  }
  const after = await paraCount();
  t('the new procedure is on the list', after === before + 1, before + ' -> ' + after);
}

console.log('\n2. Editing a paracentesis supersedes it — it must not appear twice');
{
  const before = await paraCount();
  await page.evaluate(() => { const b = document.querySelector('[data-para-edit]'); if (b) b.click(); });
  await page.waitForTimeout(500);
  const liters = await page.$('[data-para-edit-liters]');
  t('the edit step lets the liters be corrected', !!liters, liters ? '' : 'no liters field in the edit modal');
  if (liters) { await liters.fill('7.5'); await confirmModal('para-edit'); }
  const after = await paraCount();
  // GUARD THE COMPARISON FIRST. "unchanged" is trivially true of an empty list: run this against a
  // build with no add control and the count is 0 before and 0 after, and the check goes green while
  // nothing was tested at all. Falsifying against v65 is what exposed that.
  t('there was a record to edit in the first place', before > 0, before + ' row(s)');
  // BOTH halves. Asserting only that 7.5 is present would pass on a build that duplicated.
  t('the record count is unchanged after an edit', before > 0 && after === before, before + ' -> ' + after);
  const shows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-para-edit]')].map(b => b.closest('div').parentElement.innerText);
    return rows.join(' | ');
  });
  t('the corrected volume is the one displayed', /7\.5 L/.test(shows), shows.slice(0, 90));
}

console.log('\n3. Weight — the same defect, unreported');
{
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Back/.test(x.innerText||'')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await openReport('Weight');
  const box = await page.$('[data-weight-report-add]');
  // The seed has NO weight readings, so this is the empty-state path -- the one the first version
  // of the patch missed entirely.
  t('an add control exists on the Weight report when empty', !!box, box ? '' : 'no [data-weight-report-add]');
}

console.log('\n4. Cycle — a period logged on the wrong day can be moved');
{
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Back/.test(x.innerText||'')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await openReport('Cycle');
  const startBtn = await page.$('[data-cycle-edit-start]');
  const endBtn = await page.$('[data-cycle-edit-end]');
  const rmBtn = await page.$('[data-cycle-remove]');
  t('a period start can be moved', !!startBtn, startBtn ? '' : 'no [data-cycle-edit-start]');
  t('a period end can be moved', !!endBtn, endBtn ? '' : 'no [data-cycle-edit-end]');
  t('a period marker can be removed', !!rmBtn, rmBtn ? '' : 'no [data-cycle-remove]');
  if (startBtn) {
    const beforeText = await page.evaluate(() => document.querySelector('[data-cycle-edit-start]').closest('div').parentElement.innerText);
    await startBtn.click();
    await page.waitForTimeout(500);
    // Scoped to the dialog, not the whole document, for the same reason.
    const titled = await page.evaluate(() => {
      const inp = document.querySelector('input[type="datetime-local"]');
      const dlg = inp && inp.closest('div').parentElement;
      return !!dlg && /Edit Period Start/.test(dlg.innerText || '');
    });
    t('the move step says Edit, not Log', titled, '');
    // Move the start two days earlier and confirm the displayed period changed.
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="datetime-local"]');
      if (!inp) return;
      const d = new Date(inp.value); d.setDate(d.getDate() - 2);
      const p2 = (n) => String(n).padStart(2, '0');
      inp.value = d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmModal('cycle-move');
    const afterText = await page.evaluate(() => {
      const b = document.querySelector('[data-cycle-edit-start]');
      return b ? b.closest('div').parentElement.innerText : '(gone)';
    });
    t('the period now reads a different date', afterText !== beforeText, beforeText.replace(/\n/g,' ').slice(0,40) + '  ->  ' + afterText.replace(/\n/g,' ').slice(0,40));
    const stillOne = await page.evaluate(() => document.querySelectorAll('[data-cycle-edit-start]').length);
    t('moving a start did not create a second period', stillOne === 1, stillOne + ' period(s)');
  }
}

console.log('\n5. Nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' / ').slice(0, 200));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
