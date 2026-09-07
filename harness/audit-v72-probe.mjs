// audit-v72-probe.mjs -- Zero Day Auditor probe for v72 (boot and stub copied from daily-supersede-test.mjs).
// Probes: (A) Today's journal after a same-day remove; (B) symptom TYPE change on edit; (C) tombstone
// as data -- the "issue active" banner after the driving day is removed; (D) report meta line.
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/audit-v72-probe.mjs [--file f]
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = (() => { for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright', '/home/claude/.npm-global/lib/node_modules/playwright']) { try { return require(c); } catch (e) {} } throw new Error('playwright not found'); })();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1] : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }
const baseHtml = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => { console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : '')); cond ? pass++ : fail++; };
const at = new Date(); at.setHours(19, 0, 0, 0); const NOW = at.getTime(); const DAY = 86400000;
const dayStartOf = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const TODAY = dayStartOf(NOW), NOON = 12 * 3600000;
const i0 = baseHtml.indexOf('function simNow()'); const brace = baseHtml.indexOf('{', i0);
let depth = 0, end = -1; for (let k = brace; k < baseHtml.length; k++) { if (baseHtml[k] === '{') depth++; else if (baseHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } } }
const html = baseHtml.slice(0, i0) + 'function simNow() { return ' + NOW + '; }' + baseHtml.slice(end + 1);
const D1 = TODAY - DAY, D2 = TODAY - 2 * DAY, D9 = TODAY - 9 * DAY;
const seed = [
  { id: 'bm_d2', medId: 'bowel_movement', value: 'diarrhea', dose: 'Diarrhea', mg: 0, ts: D2 + NOON },
  { id: 'bm_d1', medId: 'bowel_movement', value: 'diarrhea', dose: 'Diarrhea', mg: 0, ts: D1 + NOON },
  { id: 'sym9', medId: 'symptom_nausea', symptomType: 'nausea', ts: D9 + 15 * 3600000, note: 'mild', dose: null, mg: 0 },
  { id: 'symT', medId: 'symptom_nausea', symptomType: 'nausea', ts: TODAY + 9 * 3600000, note: 'morning', dose: null, mg: 0, loggedAt: TODAY + 9 * 3600000 },
  // DELTA pass seeds (weightSuperseded is now excluded from the journal): a plain weight, a legacy weight
  // plus its append-correction, a weight plus its tombstone, one Tylenol dose, a paracentesis plus correction.
  { id: 'ty1', medId: 'tylenol', dose: '500 mg', mg: 500, pills: 1, ts: TODAY + 7 * 3600000 },
  { id: 'w1', medId: 'weight', weight: 140, dose: '140 lbs', mg: 0, ts: TODAY + 8 * 3600000 },
  { id: 'w2', medId: 'weight', weight: 141, dose: '141 lbs', mg: 0, ts: TODAY + 10 * 3600000 },
  { id: 'w3', medId: 'weight', weightId: 'doc:w2', weight: 142, dose: '142 lbs (corrected)', mg: 0, ts: TODAY + 10 * 3600000, loggedAt: TODAY + 10 * 3600000 + 60000 },
  { id: 'w4', medId: 'weight', weight: 143, dose: '143 lbs', mg: 0, ts: TODAY + 11 * 3600000 },
  { id: 'w4t', medId: 'weight', weightId: 'doc:w4', weight: 143, dose: 'Weight removed', mg: 0, ts: TODAY + 11 * 3600000, cancelled: true, loggedAt: TODAY + 11 * 3600000 + 60000 },
  { id: 'p1', medId: 'paracentesis', paraId: 'para_x', liters: 4, dose: '4 L', mg: 0, ts: TODAY + 13 * 3600000 },
  { id: 'p2', medId: 'paracentesis', paraId: 'para_x', liters: 4.5, dose: '4.5 L (corrected)', mg: 0, ts: TODAY + 13 * 3600000, loggedAt: TODAY + 13 * 3600000 + 60000 },
  // a paracentesis REMOVED today (v67-style tombstone) and an appointment removed today
  { id: 'p3', medId: 'paracentesis', paraId: 'para_y', liters: 3, dose: '3 L', mg: 0, ts: TODAY + 14 * 3600000 },
  { id: 'p3t', medId: 'paracentesis', paraId: 'para_y', liters: 3, dose: 'Paracentesis removed', mg: 0, ts: TODAY + 14 * 3600000, cancelled: true, loggedAt: TODAY + 14 * 3600000 + 60000 },
  { id: 'a1', medId: 'appointment', apptId: 'appt_z', title: 'Labs', note: '', ts: TODAY + 15 * 3600000, dose: 'Labs', mg: 0 },
  { id: 'a1t', medId: 'appointment', apptId: 'appt_z', title: 'Labs', note: '', ts: TODAY + 15 * 3600000, cancelled: true, dose: 'Appointment removed', mg: 0, loggedAt: TODAY + 15 * 3600000 + 60000 }
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
 if(hit&&(NOW-hit.ts)>48*3600000){const err=new Error('Missing or insufficient permissions.');err.code='permission-denied';throw err;}
 store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entries=()=>JSON.parse(JSON.stringify(store.entries)); globalThis.__deleted=[];`;
const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');} export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const server = http.createServer((rq, rs) => { if (rq.url.startsWith('/index.html')) { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(html); return; } rs.writeHead(204); rs.end(); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r)); const PORT = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.route('**/*', route => { const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
  if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stubFs });
  if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue(); return route.abort(); });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
const entries = () => page.evaluate(() => globalThis.__entries());
const clickText = async (re, scope) => page.evaluate(([src, flags, sel]) => { const rx = new RegExp(src, flags); const root = sel ? document.querySelector(sel) : document;
  const b = root && [...root.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim())); if (b) { b.click(); return true; } return false; }, [re.source, re.flags, scope || null]);
const nav = async (label) => { await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /menu/i.test(x.getAttribute('aria-label') || '')); if (b) b.click(); }); await page.waitForTimeout(300); const ok = await clickText(new RegExp('^' + label)); await page.waitForTimeout(500); return ok; };
const openReport = async (label) => { await nav('Reports'); const ok = await clickText(new RegExp('^' + label)); await page.waitForTimeout(600); return ok; };
const modalOpen = () => page.evaluate(() => !!document.querySelector('input[type="datetime-local"]'));
const bannerSelect = () => page.evaluate(() => !![...document.querySelectorAll('select')].find(x => [...x.options].some(o => /back to normal/i.test(o.text))));
// Today's journal rows: the rows inside the section whose heading says "Today’s journal".
const journalRows = () => page.evaluate(() => {
  const hd = [...document.querySelectorAll('div')].find(d => d.children.length === 0 && /^Today.s journal$/i.test((d.innerText || '').trim()));
  const sec = hd && hd.closest('section'); if (!sec) return null;
  return [...sec.querySelectorAll('div.mono')].filter(m => /^\d{1,2}:\d{2}/.test((m.innerText || '').trim())).map(m => (m.parentElement.innerText || '').replace(/\s+/g, ' ').trim());
});

console.log('\nD. DELTA: weights in Today\'s journal (plain once, corrected once, removed never), Tylenol total, missed row');
{
  await nav('Home');
  const rows = (await journalRows()) || [];
  console.log('     journal rows: ' + JSON.stringify(rows));
  const w = rows.filter(r => /weight/i.test(r));
  t('a plain single weight shows once', w.filter(r => /140 lbs/.test(r)).length === 1, JSON.stringify(w));
  t('a corrected weight shows ONCE, as the correction (142 lbs), never zero times', w.filter(r => /142 lbs/.test(r)).length === 1 && !w.some(r => /141 lbs/.test(r)), JSON.stringify(w));
  t('a removed weight shows zero times (no 143, no "removed")', !w.some(r => /143 lbs|removed/i.test(r)), JSON.stringify(w));
  t('exactly two weight rows in total', w.length === 2, w.length + ' weight row(s)');
  t('the Tylenol dose is still listed', rows.some(r => /tylenol/i.test(r) && /500/.test(r)), '');
  t('the missed Protonix row is still listed (missedDosesFor is untouched by the filter)', rows.some(r => /protonix/i.test(r) && /missed/i.test(r)), '');
  const nausea = rows.filter(r => /nausea/i.test(r)); t('today\'s symptom shows once', nausea.length === 1, nausea.length + '');
  // The Tylenol figure on Home: every leaf element whose text carries "500" -- printed, then asserted present.
  const figs = await page.evaluate(() => [...document.querySelectorAll('div,span')].filter(x => x.children.length === 0 && /\b500\b/.test(x.innerText || '')).map(x => (x.innerText || '').replace(/\s+/g, ' ').trim()).filter((v, i, a) => a.indexOf(v) === i));
  console.log('     "500" texts on Home: ' + JSON.stringify(figs.slice(0, 8)));
  t('the Tylenol total on Home still counts the 500 mg dose', figs.some(s => /500\s*(mg|\/)/i.test(s) || /^500$/.test(s)), JSON.stringify(figs.slice(0, 8)));
  // INFORMATIONAL (pre-v72 behaviour, not part of the delta): a paracentesis corrected today.
  const para = rows.filter(r => /paracentesis/i.test(r));
  const p3 = rows.filter(r => /3 L\b/.test(r) || /paracentesis removed/i.test(r));
  console.log('     INFO rows for a paracentesis REMOVED today: ' + JSON.stringify(p3));
  t('a paracentesis removed today is not listed as standing with no "removed" line', !(p3.some(r => /3 L\b/.test(r) && !/removed/i.test(r)) && !p3.some(r => /removed/i.test(r))), JSON.stringify(p3));
  const ap = rows.filter(r => /labs|appointment/i.test(r));
  console.log('     INFO rows for an appointment REMOVED today: ' + JSON.stringify(ap));
  console.log('     INFO paracentesis rows for a corrected procedure today: ' + para.length + ' ' + JSON.stringify(para));
}

console.log('\nA. Today\'s journal after logging today\'s bowel answer and removing it from History');
{
  await nav('Home');
  const set = await page.evaluate(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'very_little') && ![...x.options].some(o => /back to normal/i.test(o.text)));
    if (!s) return false; s.value = 'normal'; s.dispatchEvent(new Event('change', { bubbles: true })); const btn = s.parentElement && [...s.parentElement.querySelectorAll('button')].find(b => /^Log$/.test((b.innerText || '').trim())); if (btn) btn.click(); return !!btn; });
  t('end-of-day bowel card on screen; Log tapped', set, ''); await page.waitForTimeout(700);
  const logged = (await entries()).slice(-1)[0];
  await openReport('History');
  await page.evaluate((id) => { const b = [...document.querySelectorAll('[data-history-row="' + id + '"] button')].find(x => /^Remove$/.test((x.innerText || '').trim())); if (b) b.click(); }, String(logged.id));
  await page.waitForTimeout(300);
  await page.evaluate((id) => { const b = [...document.querySelectorAll('[data-history-row="' + id + '"] button')].find(x => /^Delete$/.test((x.innerText || '').trim())); if (b) b.click(); }, String(logged.id));
  await page.waitForTimeout(700);
  t('tombstone appended', (await entries()).slice(-1)[0].cancelled === true, '');
  await nav('Home');
  const rows = await journalRows();
  const bowelRows = (rows || []).filter(r => /bowel/i.test(r));
  console.log('     journal rows: ' + JSON.stringify(rows));
  t('Today\'s journal lists no bowel row for a day that reads unanswered (or labels every one it lists)',
    bowelRows.length === 0 || bowelRows.every(r => /superseded|removed/i.test(r)), bowelRows.length + ' bowel row(s): ' + JSON.stringify(bowelRows));
  t('a removed row in the journal, if shown, is not offered without a label next to the card asking again', !(bowelRows.some(r => /Normal/.test(r) && !/superseded/i.test(r))), '');
}

console.log('\nB. Symptom TYPE change on edit (nausea -> vomiting), nine days old');
{
  await nav('Symptoms');
  const n0 = await page.evaluate(() => document.querySelectorAll('[data-symptom-row]').length);
  t('two symptoms listed (D-9 and today)', n0 === 2, n0 + ' row(s)');
  await page.evaluate(() => { const b = document.querySelector('[data-symptom-row="doc:sym9"] button[title="Edit"]'); if (b) b.click(); });
  await page.waitForTimeout(400); t('edit modal open', await modalOpen(), '');
  await page.evaluate(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'vomiting')); s.value = 'vomiting'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  await clickText(/^Confirm$/i); for (let i = 0; i < 30 && await modalOpen(); i++) await page.waitForTimeout(100); await page.waitForTimeout(500);
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-symptom-row]')].map(r => r.getAttribute('data-symptom-row') + ':' + (r.innerText || '').replace(/\s+/g, ' ').slice(0, 40)));
  t('still two rows after the type change (grouped by symptomId, not medId)', rows.length === 2, JSON.stringify(rows));
  t('the D-9 row now reads Vomiting', rows.some(r => /^doc:sym9:Vomiting/.test(r)), '');
  const corr = (await entries()).slice(-1)[0];
  t('the correction is symptom_vomiting in group doc:sym9, stamped newer than the D-9 ts', corr.medId === 'symptom_vomiting' && corr.symptomId === 'doc:sym9' && corr.loggedAt > D9 + 15 * 3600000, JSON.stringify({ medId: corr.medId, symptomId: corr.symptomId }));
  await openReport('History');
  const stale = await page.evaluate(() => { const r = document.querySelector('[data-history-row="sym9"] [data-history-stale]'); return r ? r.getAttribute('data-history-stale') : null; });
  t('History marks the old nausea document Superseded', stale === 'superseded', 'stale=' + stale);
  // today's symptom: edit the note, then look at Today's journal
  await nav('Symptoms');
  await page.evaluate(() => { const b = document.querySelector('[data-symptom-row="doc:symT"] button[title="Edit"]'); if (b) b.click(); }); await page.waitForTimeout(400);
  await page.evaluate(() => { const ta = [...document.querySelectorAll('textarea')].find(x => x.value === 'morning'); if (ta) { ta.value = 'morning, worse'; ta.dispatchEvent(new Event('input', { bubbles: true })); } });
  await clickText(/^Confirm$/i); for (let i = 0; i < 30 && await modalOpen(); i++) await page.waitForTimeout(100); await page.waitForTimeout(500);
  await nav('Home');
  const jr = (await journalRows()) || []; const sym = jr.filter(r => /nausea/i.test(r));
  console.log('     journal rows: ' + JSON.stringify(jr));
  t('Today\'s journal shows the edited symptom ONCE, or labels the old copy', sym.length === 1 || sym.every(r => /superseded/i.test(r) || /worse/.test(r)), sym.length + ' nausea row(s)');
}

console.log('\nC. Tombstone as data: remove the day driving the issue banner');
{
  await nav('Home');
  t('banner on (D-1 diarrhea is the latest answered day since today was removed)', await bannerSelect(), '');
  const dayN = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(x => x.children.length === 0 && /Day \d+$/.test((x.innerText || '').trim())); return d ? d.innerText.trim() : null; });
  t('streak reads Day 2 (D-2, D-1 both diarrhea; today removed)', /Day 2$/.test(dayN || ''), dayN);
  await openReport('Bowel Movement');
  await page.evaluate((d) => { const b = [...document.querySelectorAll('[data-bowel-row="' + d + '"] button')].find(x => /^Remove$/.test((x.innerText || '').trim())); if (b) b.click(); }, String(D1));
  await page.waitForTimeout(300);
  await page.evaluate((d) => { const b = [...document.querySelectorAll('[data-bowel-row="' + d + '"] button')].find(x => /^Delete$/.test((x.innerText || '').trim())); if (b) b.click(); }, String(D1));
  await page.waitForTimeout(700);
  const rowsLeft = await page.evaluate(() => [...document.querySelectorAll('[data-bowel-row]')].map(r => r.getAttribute('data-answer')));
  t('report now shows only D-2', rowsLeft.length === 1, JSON.stringify(rowsLeft));
  await nav('Reports');
  const meta = await page.evaluate(() => { const d = [...document.querySelectorAll('div,span')].find(x => x.children.length === 0 && /most recent$/.test((x.innerText || '').trim())); return d ? d.innerText.trim() : null; });
  t('Reports menu meta reads Diarrhea most recent (D-2 stands)', meta === 'Diarrhea most recent', meta);
  await nav('Home');
  t('banner still on, driven by D-2', await bannerSelect(), '');
  const dayN2 = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(x => x.children.length === 0 && /Day \d+$/.test((x.innerText || '').trim())); return d ? d.innerText.trim() : null; });
  t('streak now reads Day 1 (the removed day broke it)', /Day 1$/.test(dayN2 || ''), dayN2);
  const lbl = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(x => x.children.length === 0 && /^Update status for/i.test((x.innerText || '').trim())); return d ? d.innerText.trim() : null; });
  t('banner names D-2, not yesterday', lbl && !/yesterday|today/.test(lbl), lbl);
}
t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : '')); process.exit(fail ? 1 : 0);
