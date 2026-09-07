// daily-supersede-test.mjs -- v72. Re-answering a day, or correcting a symptom, must never delete.
//
// WHAT IT PROVES. Bowel and appetite answers, and symptom notes, are corrected by APPENDING a
// superseding document and removed by appending a tombstone. The suite's Firestore stub does two
// things the real rules do: it REFUSES any delete of a document older than 48 hours (STATUS.md, v52),
// and it RECORDS every delete attempt, refused or not. Any delete attempt at all is a FAIL -- the
// app must never depend on one.
//
// THE CLOCK IS FROZEN at 19:00 today, inside the served HTML (the eod-test mechanism), so the
// end-of-day cards are on screen whatever the wall time is when this runs.
//
// EVERY SEEDED ROW CARRIES AN EXPLICIT id (the enhance-test lesson: an invented id matched nothing
// and every delete silently no-oped). The bowel document the banner will supersede carries a
// loggedAt FIVE DAYS IN THE FUTURE: a correction stamped with a bare Date.now() would lose to it and
// the banner would stay, so the `Math.max(now, prev + 1)` guard has a check that goes red without it.
//
// Run:  node harness/daily-supersede-test.mjs [--file <index.html>]
// Falsified 2026-09-07 against outputs/rollback-v71/index.html (see the release notes for the counts).
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
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1] : path.join(HERE, '..', 'index.html');
const SHOTS = argv.indexOf('--shots') >= 0 ? argv[argv.indexOf('--shots') + 1] : null;   // the Designer's evidence: a screenshot per touched screen
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const baseHtml = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

// ---- freeze the app clock at 19:00 today -------------------------------------------------------
const at = new Date(); at.setHours(19, 0, 0, 0);
const NOW = at.getTime();
const DAY = 86400000;
const dayStartOf = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const TODAY = dayStartOf(NOW);
const NOON = 12 * 3600000;
const i0 = baseHtml.indexOf('function simNow()');
if (i0 < 0) { console.error('simNow not found'); process.exit(4); }
const brace = baseHtml.indexOf('{', i0);
let depth = 0, end = -1;
for (let k = brace; k < baseHtml.length; k++) {
  if (baseHtml[k] === '{') depth++;
  else if (baseHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
}
const html = baseHtml.slice(0, i0) + 'function simNow() { return ' + NOW + '; }' + baseHtml.slice(end + 1);
if (!html.includes('return ' + NOW)) { console.error('clock freeze failed'); process.exit(4); }

// ---- seed ----------------------------------------------------------------------------------------
const D3 = TODAY - 3 * DAY, D2 = TODAY - 2 * DAY, D9 = TODAY - 9 * DAY;
const seed = [
  // D-3: two legacy answers for one day, identical ts (that day's noon). The second carries a
  // FUTURE loggedAt -- see the header. It wins today, so the "issue active" banner is on screen.
  { id: 'seed_bm_a', medId: 'bowel_movement', value: 'normal',   dose: 'Normal',   mg: 0, ts: D3 + NOON },
  { id: 'seed_bm_b', medId: 'bowel_movement', value: 'diarrhea', dose: 'Diarrhea', mg: 0, ts: D3 + NOON, loggedAt: NOW + 5 * DAY },
  // NOTHING for today on purpose: the banner targets the LATEST answered day, so a today answer
  // would point it at today and the D-3 path -- the one that fails on a real phone -- never runs.
  // D-2 appetite: a v72-style stamped answer listed FIRST, then two legacy ones with the same ts.
  // A `>=`-on-ts reader picks whichever comes last; a stamped reader picks the stamped one.
  { id: 'seed_ap_new', medId: 'appetite', value: 'little', dose: 'Little to none', mg: 0, ts: D2 + NOON, loggedAt: NOW - 3600000 },
  { id: 'seed_ap_x',   medId: 'appetite', value: 'normal', dose: 'Normal',         mg: 0, ts: D2 + NOON },
  { id: 'seed_ap_y',   medId: 'appetite', value: 'none',   dose: 'No Appetite',    mg: 0, ts: D2 + NOON },
  // a symptom NINE days old -- well past the 48-hour delete window, like every symptom on a real phone
  { id: 'seed_sym1', medId: 'symptom_nausea', symptomType: 'nausea', ts: D9 + 15 * 3600000, note: 'mild', dose: null, mg: 0 }
];
const stubFs = `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;const NOW=${NOW};
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
function push(){for(const cb of eL)cb(snap(store.entries));}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));push();return{id:'a'+n};}
export async function deleteDoc(ref){const id=ref&&ref.id;const hit=store.entries.find(e=>String(e.id)===String(id));
 globalThis.__deleted.push({id:String(id),medId:hit?hit.medId:null});
 // THE RULES, as STATUS.md (v52) states them: a delete of a document older than 48 hours is refused.
 if(hit&&(NOW-hit.ts)>48*3600000){const err=new Error('Missing or insufficient permissions.');err.code='permission-denied';throw err;}
 store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entries=()=>JSON.parse(JSON.stringify(store.entries));
globalThis.__deleted=[];
`;
const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;

const server = http.createServer((rq, rs) => {
  if (rq.url.startsWith('/index.html')) { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(html); return; }
  rs.writeHead(204); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
  if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stubFs });
  if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

// ---- helpers -----------------------------------------------------------------------------------
const entries = () => page.evaluate(() => globalThis.__entries());
const deleted = () => page.evaluate(() => globalThis.__deleted.slice());
const clickText = async (re, scope) => page.evaluate(([src, flags, sel]) => {
  const rx = new RegExp(src, flags);
  const root = sel ? document.querySelector(sel) : document;
  const b = root && [...root.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; } return false;
}, [re.source, re.flags, scope || null]);
const nav = async (label) => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
  await page.waitForTimeout(300);
  const ok = await clickText(new RegExp('^' + label));
  await page.waitForTimeout(500);
  return ok;
};
const openReport = async (label) => { await nav('Reports'); const ok = await clickText(new RegExp('^' + label)); await page.waitForTimeout(600); return ok; };
const modalOpen = () => page.evaluate(() => !!document.querySelector('input[type="datetime-local"]'));
const confirmModal = async (where) => {
  await clickText(/^Confirm$/i);
  for (let i = 0; i < 30 && await modalOpen(); i++) await page.waitForTimeout(100);
  if (await modalOpen()) throw new Error('modal did not close after Confirm at: ' + where);
  await page.waitForTimeout(400);
};
// The bowel banner and the end-of-day bowel card both carry a select with a 'very_little' option;
// the banner's placeholder option is the tell.
const bannerSelect = () => page.evaluate(() => {
  const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /back to normal/i.test(o.text)));
  return s ? true : false;
});

// ==================================================================================================
console.log('\n1. The bowel banner: updating a day older than 48h must stick, and must not delete');
{
  t('the "issue active" banner is on screen for the D-3 diarrhea answer', await bannerSelect(), '');
  await shot('1-home-banner-before');
  const before = (await entries()).length;
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /back to normal/i.test(o.text)));
    if (s) { s.value = 'normal'; s.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  const tapped = await clickText(/^Update$/);
  t('the banner has an Update button', tapped, '');
  await page.waitForTimeout(700);
  const after = (await entries()).length;
  t('the update APPENDED one document', after === before + 1, before + ' -> ' + after);
  t('nothing was deleted, or even attempted', (await deleted()).length === 0, JSON.stringify(await deleted()));
  t('the banner is gone: the new answer won', !(await bannerSelect()), '');
  await shot('2-home-banner-after');
  const newest = (await entries()).slice(-1)[0];
  t('the new answer is stamped strictly newer than the future-stamped one it replaced',
    newest && newest.medId === 'bowel_movement' && typeof newest.loggedAt === 'number' && newest.loggedAt > NOW + 5 * DAY,
    newest ? ('loggedAt=' + newest.loggedAt + ' vs ' + (NOW + 5 * DAY)) : 'no newest');
  await openReport('Bowel Movement');
  const d3 = await page.evaluate((d) => { const r = document.querySelector('[data-bowel-row="' + d + '"]'); return r ? r.getAttribute('data-answer') : null; }, String(D3));
  t('the Bowel Movement report shows Normal for D-3', d3 === 'normal', 'row answer = ' + d3);
  await shot('3-report-bowel');
  const rows = await page.evaluate((d) => document.querySelectorAll('[data-bowel-row="' + d + '"]').length, String(D3));
  t('D-3 appears ONCE on the report, not once per document', rows === 1, rows + ' row(s)');
}

console.log('\n2. The appetite reader: a stamped answer beats two legacy ones whatever order they arrive in');
{
  await openReport('Appetite');
  const d2 = await page.evaluate((d) => { const r = document.querySelector('[data-appetite-row="' + d + '"]'); return r ? r.getAttribute('data-answer') : null; }, String(D2));
  t('Appetite report shows the stamped answer (little) for D-2', d2 === 'little', 'row answer = ' + d2);
  const rows = await page.evaluate((d) => document.querySelectorAll('[data-appetite-row="' + d + '"]').length, String(D2));
  t('D-2 appears once', rows === 1, rows + ' row(s)');
}

console.log('\n3. The end-of-day appetite card: a fresh answer is stamped and deletes nothing');
{
  await nav('Home');
  const before = (await entries()).length;
  const set = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'little'));
    if (!s) return false; s.value = 'little'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;
  });
  t('the appetite card is on screen at 19:00 with today unanswered', set, '');
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'little'));
    const btn = s && s.parentElement && [...s.parentElement.querySelectorAll('button')].find(b => /^Log$/.test((b.innerText || '').trim()));
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);
  const all = await entries();
  const newest = all.slice(-1)[0];
  t('one appetite document was appended', all.length === before + 1 && newest.medId === 'appetite', all.length + ' entries, newest ' + (newest && newest.medId));
  t('it carries a loggedAt stamp', newest && typeof newest.loggedAt === 'number' && newest.loggedAt > 0, newest ? String(newest.loggedAt) : '');
  t('still no delete attempted', (await deleted()).length === 0, '');
}

console.log('\n4. Symptom edit at nine days old: supersedes, does not duplicate, does not delete');
{
  await nav('Symptoms');
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('[data-symptom-row]').length);
  t('the seeded symptom is listed once', rowsBefore === 1, rowsBefore + ' row(s)');
  const before = (await entries()).length;
  await page.evaluate(() => { const b = document.querySelector('[data-symptom-row] button[title="Edit"]'); if (b) b.click(); });
  await page.waitForTimeout(400);
  t('Edit opens the date/time step', await modalOpen(), '');
  await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find(x => x.value === 'mild');
    if (ta) { ta.value = 'worse'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await confirmModal('symptom-edit');
  const rowsAfter = await page.evaluate(() => document.querySelectorAll('[data-symptom-row]').length);
  t('still exactly one symptom row -- the edit superseded, it did not duplicate', rowsAfter === 1, rowsAfter + ' row(s)');
  const note = await page.evaluate(() => { const r = document.querySelector('[data-symptom-row]'); return r ? (r.innerText || '') : ''; });
  t('the row shows the corrected note', /worse/.test(note) && !/mild/.test(note), note.replace(/\s+/g, ' ').slice(0, 80));
  await shot('4-symptoms-after-edit');
  const all = await entries();
  t('the edit APPENDED one document', all.length === before + 1, before + ' -> ' + all.length);
  const orig = all.find(e => e.id === 'seed_sym1');
  const corr = all.slice(-1)[0];
  t('the original document is untouched and the correction shares its group id',
    !!orig && corr.symptomId === 'doc:seed_sym1' && corr.note === 'worse', corr ? JSON.stringify({ symptomId: corr.symptomId, note: corr.note }) : '');
  t('no delete attempted', (await deleted()).length === 0, '');
}

console.log('\n5. Symptom remove at nine days old: a tombstone, and the original cannot come back');
{
  const before = (await entries()).length;
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-symptom-row] button')].find(x => /^Remove$/.test((x.innerText || '').trim())); if (b) b.click(); });
  await page.waitForTimeout(300);
  const armed = await page.evaluate(() => !![...document.querySelectorAll('[data-symptom-row] button')].find(x => /^Delete$/.test((x.innerText || '').trim())));
  t('Remove arms a Delete / Keep confirmation', armed, '');
  await page.evaluate(() => { const b = [...document.querySelectorAll('[data-symptom-row] button')].find(x => /^Delete$/.test((x.innerText || '').trim())); if (b) b.click(); });
  await page.waitForTimeout(700);
  const rows = await page.evaluate(() => document.querySelectorAll('[data-symptom-row]').length);
  t('the symptom is gone from the tab', rows === 0, rows + ' row(s)');
  const all = await entries();
  t('the removal APPENDED a tombstone; nothing deleted', all.length === before + 1 && all.slice(-1)[0].cancelled === true && (await deleted()).length === 0,
    all.length + ' entries, deleted=' + (await deleted()).length);
}

console.log('\n6. History: rows stay, the ones that no longer stand are labelled, and a count is a count');
{
  await openReport('History');
  const stale = await page.evaluate((id) => { const r = document.querySelector('[data-history-row="' + id + '"] [data-history-stale]'); return r ? r.getAttribute('data-history-stale') : null; }, 'seed_sym1');
  await shot('5-history-labels');
  t('the superseded symptom document is still listed, marked Superseded', stale === 'superseded', 'stale=' + stale);
  const bmStale = await page.evaluate((id) => { const r = document.querySelector('[data-history-row="' + id + '"] [data-history-stale]'); return r ? r.getAttribute('data-history-stale') : null; }, 'seed_bm_b');
  t('the replaced D-3 diarrhea answer is listed, marked Superseded', bmStale === 'superseded', 'stale=' + bmStale);
  const removed = await page.evaluate(() => document.querySelectorAll('[data-history-stale="removed"]').length);
  t('the symptom tombstone is listed, marked Removed', removed >= 1, removed + ' removed row(s)');
  // No medication was seeded, so every day summary must read "0 doses" -- an answer is not a dose.
  const summaries = await page.evaluate(() => [...document.querySelectorAll('div.mono')].map(d => (d.innerText || '').trim()).filter(s => /^\d+ doses?/.test(s)));
  t('every day summary counts 0 doses (an answer or a symptom is not a dose)', summaries.length > 0 && summaries.every(s => /^0 dose/.test(s)), summaries.join(' / '));
  const superStale = await page.evaluate((id) => !![...document.querySelectorAll('[data-history-row="' + id + '"] button')].find(b => /^Remove$/.test((b.innerText || '').trim())), 'seed_bm_b');
  t('a superseded row offers no Remove (nothing to remove)', !superStale, '');
}

console.log('\n7. Today\'s answer from the card, then removed from History: a tombstone, and the day reads unanswered again');
{
  await nav('Home');
  const before = (await entries()).length;
  const set = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'very_little') && ![...x.options].some(o => /back to normal/i.test(o.text)));
    if (!s) return false; s.value = 'normal'; s.dispatchEvent(new Event('change', { bubbles: true }));
    const btn = s.parentElement && [...s.parentElement.querySelectorAll('button')].find(b => /^Log$/.test((b.innerText || '').trim()));
    if (btn) btn.click(); return !!btn;
  });
  t('the end-of-day bowel card is on screen and Log was tapped', set, '');
  await page.waitForTimeout(700);
  const logged = (await entries()).slice(-1)[0];
  t('today\'s answer was appended with a stamp', (await entries()).length === before + 1 && logged.medId === 'bowel_movement' && typeof logged.loggedAt === 'number', JSON.stringify({ medId: logged.medId, loggedAt: logged.loggedAt }));
  const cardGone = await page.evaluate(() => ![...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'very_little')));
  t('the card is gone: today reads answered', cardGone, '');
  await openReport('History');
  const has = await page.evaluate((id) => { const b = [...document.querySelectorAll('[data-history-row="' + id + '"] button')].find(x => /^Remove$/.test((x.innerText || '').trim())); if (b) { b.click(); return true; } return false; }, String(logged.id));
  t('today\'s bowel row offers Remove in History', has, 'row id ' + logged.id);
  await page.waitForTimeout(300);
  await page.evaluate((id) => { const b = [...document.querySelectorAll('[data-history-row="' + id + '"] button')].find(x => /^Delete$/.test((x.innerText || '').trim())); if (b) b.click(); }, String(logged.id));
  await page.waitForTimeout(700);
  const all = await entries();
  t('the removal appended a tombstone and deleted nothing', all.length === before + 2 && all.slice(-1)[0].cancelled === true && (await deleted()).length === 0, all.length + ' entries');
  await nav('Home');
  const cardBack = await page.evaluate(() => !![...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'very_little') && ![...x.options].some(o => /back to normal/i.test(o.text))));
  t('the end-of-day bowel card is back: today reads unanswered', cardBack, '');
}

console.log('\n-- nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
t('ZERO delete attempts across the whole run', (await deleted()).length === 0, JSON.stringify(await deleted()));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
process.exit(fail ? 1 : 0);
