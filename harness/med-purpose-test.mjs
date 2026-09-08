// med-purpose-test.mjs -- v74. Every medication says what it is for, and an edit cannot wipe it.
//
// WHAT IT PROVES
//   1. Every medication the app ships carries a line on the Meds screen, and none of them is blank.
//   2. NO LINE CONTAINS A NUMBER. This is the guard that matters: the app is now stating medical
//      information, and the one thing it must never drift into is a dose or a schedule. A digit in
//      any of these sentences is a failure, whoever added it and however well meant.
//   3. Editing a medication and saving does NOT wipe the line -- the v43.3 failure class, where
//      correcting one field in this same editor silently disabled that medication's missed-dose
//      alerts while the app said "updated".
//   4. What the caregiver types beats the built-in line.
//   5. A medication with nothing to say shows NO empty label.
//   6. THE DELIBERATE EXEMPTION, ASSERTED: the Home quick-log cards carry none of this. That screen
//      is what she taps at 2am under time pressure, and an exemption nobody wrote down is
//      indistinguishable from an oversight.
//
// FIELD LABELS ARE UPPERCASED BY CSS and innerText returns what is RENDERED, so every label match
// here is case-insensitive. A case-sensitive one went red against a build where the field was
// present and correct -- the same trap that produced a false red on "Total drained" in v69.
//
// Run:  node harness/med-purpose-test.mjs [--file <index.html>] [--shots <dir>]
// Falsified 2026-09-08 against outputs/rollback-v73/index.html.
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
const SHOTS = argv.indexOf('--shots') >= 0 ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const html = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

// ---- the table is read OUT OF THE FILE UNDER TEST, never re-typed here ---------------------------
// A copy of the sentences in this suite would drift from the app and prove nothing about it.
const tableMatch = html.match(/const MED_PURPOSE = \{([\s\S]*?)\n\};/);
const TABLE = {};
if (tableMatch) {
  for (const m of tableMatch[1].matchAll(/'([a-z0-9-]+)':\s*'((?:[^'\\]|\\.)*)'/g)) TABLE[m[1]] = m[2];
}

const stubFs = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));return{id:'a'+n};}
export async function deleteDoc(){} export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
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

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const clickText = async (re) => page.evaluate(([src, flags]) => {
  const rx = new RegExp(src, flags);
  const b = [...document.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; } return false;
}, [re.source, re.flags]);
const goMeds = async () => { await clickText(/^Meds$/); await page.waitForTimeout(700); };
const purposeMap = () => page.evaluate(() => {
  const out = {};
  document.querySelectorAll('[data-med-purpose]').forEach(el => { out[el.getAttribute('data-med-purpose')] = (el.innerText || '').trim(); });
  return out;
});

console.log('\n1. The table itself — what the app is willing to say about a medication');
{
  const ids = Object.keys(TABLE);
  t('the app carries a purpose table', ids.length > 0, ids.length + ' entries');
  const empty = ids.filter(k => !TABLE[k].trim());
  t('no entry is blank', empty.length === 0, empty.join(', '));
  // THE GUARD THAT MATTERS. A digit here is a dose, a frequency or a duration creeping into text
  // that is only ever meant to say what a medication is generally for.
  const withDigits = ids.filter(k => /\d/.test(TABLE[k]));
  t('NO entry contains a number — no dose, no schedule, no duration', withDigits.length === 0,
    withDigits.map(k => k + ': ' + TABLE[k]).join(' | '));
  // A SCHEDULE IN WORDS passed the digit guard: "given around chemo" carries a when, not a what, and
  // the audit caught it while the check stayed green. Words as well as digits now.
  // WRONG BOTH WAYS in its first form, per the delta audit: it rejected "the tablets" -- a dosage
  // FORM, not a dose -- and it hardcoded the literal phrase "around chemo", so "on chemo days",
  // "at bedtime", "before meals" and "when needed" all walked through. Dosage forms are allowed;
  // WHEN and HOW MUCH are not.
  const SCHEDULEY = /\b(daily|hourly|nightly|weekly|every \w+|twice|once a|per day|a day|as needed|when needed|at bedtime|before bed|before meals|after meals|with food|on an empty stomach|in the morning|in the evening|on chemo days|around chemo|with chemo|after chemo|before chemo|chemotherapy|dose|doses|mg|ml|mcg)\b/i;
  const scheduley = ids.filter(k => SCHEDULEY.test(TABLE[k]));
  t('NO entry states a schedule or a dose in words either', scheduley.length === 0,
    scheduley.map(k => k + ': ' + TABLE[k]).join(' | '));
  // NO FEVER CLAUSE, EVER. Removing them was this release's safety decision -- a fever during chemo
  // is a thing to REPORT, not to suppress -- and nothing was holding it. The patch header says a
  // later refresh to federal label wording is planned, and federal wording says "reduces fever", so
  // this guard is what stops that refresh quietly undoing the decision. Raised by ChemoWell's audit.
  const fevery = ids.filter(k => /fever|antipyretic|temperature/i.test(TABLE[k]));
  t('NO entry tells anyone a medication brings down a fever', fevery.length === 0,
    fevery.map(k => k + ': ' + TABLE[k]).join(' | '));
  // A LINE MUST DESCRIBE THE DRUG, NOT A PRODUCT. ChemoWell's audit blocked on lidocaine being
  // called "a numbing cream", then blocked AGAIN on "This is Tylenol in liquid form" -- and the
  // first version of that guard passed the second one, because it pinned eleven words and
  // `liquid` was not among them. A guard that lists words is only as good as its list.
  const FORMY = /\b(cream|ointment|patch|gel|rinse|suppository|injection|infusion|syrup|lozenge|liquid|tablet|tablets|capsule|capsules|by mouth|topical|rub on|rubbed on|applied to|on the skin|under the tongue)\b/i;
  const formy = ids.filter(k => FORMY.test(TABLE[k]));
  t('NO entry names a dosage form, route or body site', formy.length === 0,
    formy.map(k => k + ': ' + TABLE[k]).join(' | '));
  const tooLong = ids.filter(k => TABLE[k].length > 110);
  t('every entry is short enough to read on a phone', tooLong.length === 0, tooLong.join(', '));
}

console.log('\n2. The Meds screen shows a line for every medication');
{
  await goMeds();
  const map = await purposeMap();
  const shown = Object.keys(map);
  t('a line is rendered for every medication in the table', shown.length >= Object.keys(TABLE).length,
    shown.length + ' shown vs ' + Object.keys(TABLE).length + ' in the table');
  const blank = shown.filter(k => !map[k]);
  t('none of the rendered lines is blank', blank.length === 0, blank.join(', '));
  const mismatched = shown.filter(k => TABLE[k] && map[k] !== TABLE[k].replace(/\\u2019/g, '’'));
  t('each line on screen matches the table it came from', mismatched.length === 0, mismatched.slice(0, 3).join(' | '));
  const disc = await page.evaluate(() => document.querySelectorAll('[data-med-disclaimer]').length);
  t('the "general information, not medical advice" line appears exactly once', disc === 1, disc + ' found');
  // Scroll to the cards themselves before the picture -- the top of this screen is the reorder
  // list, and a screenshot of the part that did not change proves nothing about the part that did.
  await page.evaluate(() => { const el = document.querySelector('[data-med-purpose]'); if (el) el.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(400);
  await shot('1-meds-screen');
}

console.log('\n3. THE EXEMPTION, ASSERTED: Home stays clean');
{
  await clickText(/^Home$/);
  await page.waitForTimeout(700);
  const onHome = await page.evaluate(() => document.querySelectorAll('[data-med-purpose]').length);
  t('the Home quick-log cards carry NO purpose text', onHome === 0, onHome + ' found on Home');
}

console.log('\n4. Editing a medication must not wipe its line (the v43.3 failure class)');
{
  await goMeds();
  const before = (await purposeMap())['zofran'] || '';
  t('Zofran shows a line before editing', !!before, before);
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Edit Zofran$/.test(x.getAttribute('aria-label') || ''));
    if (b) { b.click(); return true; } return false;
  });
  t('its editor opens', opened, '');
  await page.waitForTimeout(500);
  // (The box is deliberately EMPTY here with the built-in line as its placeholder -- section 4b
  // asserts that directly. Seeding it as a VALUE is what the audit blocked.)
  await clickText(/^Save changes$/);
  await page.waitForTimeout(800);
  const after = (await purposeMap())['zofran'] || '';
  t('after saving with no changes, the line is still there', after === before, JSON.stringify(after));
  // THE AUDIT FOUND THIS SECTION COULD NOT FAIL FOR ITS OWN SUBJECT: deleting the `purpose` line
  // from saveMedicationEditor -- the v43.3 bug itself -- left every check above green, because the
  // built-in line covers for a lost value. So assert what was SAVED, not only what is on screen.
  // `state` is module-scoped in this single-file app and is NOT on window; the saved list is read
  // back out of the medication config in localStorage, which is what the app actually persists.
  const saved = await page.evaluate((k) => {
    try {
      const raw = JSON.parse(localStorage.getItem(k) || '{}');
      const m = (raw.meds || []).find(x => x.id === 'zofran');
      return m ? (m.purpose === undefined ? '<<missing>>' : m.purpose) : '<<no med>>';
    } catch (e) { return '<<unreadable>>'; }
  }, 'caretracker-medication-config-v1');
  t('the save path carries the purpose field at all', saved !== '<<missing>>' && saved !== '<<no med>>', String(saved));
}

console.log('\n4b. Clearing the box is a real action, not a no-op (the audit BLOCKED on this)');
{
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Edit Zofran$/.test(x.getAttribute('aria-label') || ''));
    if (b) { b.click(); return true; } return false;
  });
  t('the editor opens', opened, '');
  await page.waitForTimeout(500);
  // The built-in line must be a PLACEHOLDER, not a value: an unset medication shows an EMPTY box
  // with the sentence in grey behind it. Seeded as a value, clearing it did nothing at all and the
  // app still said "updated", and every saved edit froze that day's wording into the record.
  const state0 = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /what it/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    return inp ? { value: inp.value, placeholder: inp.placeholder } : null;
  });
  t('the box is EMPTY for a medication nobody has described', state0 && state0.value === '', JSON.stringify(state0 && state0.value));
  // COMPARE TO THE TABLE, not to a word. /nausea/i also matches the fallback literal
  // "For example: settles nausea", so this check stayed green on a build with the placeholder
  // reverted to that literal -- found by the delta audit.
  t('the built-in sentence shows as the placeholder instead',
    !!(state0 && state0.placeholder === (TABLE['zofran'] || '\u0000')),
    JSON.stringify(state0 && state0.placeholder));
  await clickText(/^Save changes$/);
  await page.waitForTimeout(800);
  const stored = await page.evaluate((k) => {
    try {
      const raw = JSON.parse(localStorage.getItem(k) || '{}');
      const m = (raw.meds || []).find(x => x.id === 'zofran');
      return m ? String(m.purpose || '') : '<<no med>>';
    } catch (e) { return '<<unreadable>>'; }
  }, 'caretracker-medication-config-v1');
  t('saving an untouched medication stores NOTHING — the wording is never frozen into the record', stored === '',
    JSON.stringify(stored));
}

console.log('\n5. What the caregiver types wins');
{
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Edit Zofran$/.test(x.getAttribute('aria-label') || ''));
    if (b) { b.click(); return true; } return false;
  });
  t('the editor opens again', opened, '');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /what it/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    if (inp) { inp.value = 'Her oncologist prescribed this for sickness'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText(/^Save changes$/);
  await page.waitForTimeout(800);
  const after = (await purposeMap())['zofran'] || '';
  t('the typed line replaces the built-in one', after === 'Her oncologist prescribed this for sickness', after);
  await shot('2-typed-purpose');
  // ...and clearing it puts the built-in line back, rather than silently doing nothing.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Edit Zofran$/.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  const held = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /what it/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    return inp ? inp.value : null;
  });
  t('the box holds the typed line when there is one', held === 'Her oncologist prescribed this for sickness', JSON.stringify(held));
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /what it/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText(/^Save changes$/);
  await page.waitForTimeout(800);
  const cleared = (await purposeMap())['zofran'] || '';
  t('clearing the box returns to the built-in line', /nausea/i.test(cleared) && cleared !== 'Her oncologist prescribed this for sickness', cleared);
}

console.log('\n6. A medication with nothing to say shows no empty label');
{
  // The control on the Meds screen reads "Add"; "Add medication" is the SAVE button inside the form.
  const added = await clickText(/^Add$/);
  t('the add form opens', added, '');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /medication name/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input');
    if (inp) { inp.value = 'Testosterone Cypionate ZZ'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText(/^Add medication$/);
  await page.waitForTimeout(900);
  const map = await purposeMap();
  const stray = Object.keys(map).filter(k => !map[k]);
  t('the new medication renders NO purpose element rather than an empty one', stray.length === 0, stray.join(', '));
}

console.log('\n7. A medication named after a JavaScript built-in must not destroy the Meds screen');
{
  // THE DELTA AUDIT BLOCKED ON THIS. MED_PURPOSE is a plain object, so a bare MED_PURPOSE['constructor']
  // reads back Object.prototype.constructor -- a function, truthy, not a string -- and h() throws
  // inside the list render. The medication PERSISTS, so every later render throws too: the Meds
  // screen comes up empty, and the Meds screen is the only place edit and delete live. There is no
  // way back from inside the app, and the broken list publishes to the other phone.
  // `constructor` is the one prototype key that survives this app's id slug.
  const errsBefore = errs.length;
  await goMeds();
  const added = await clickText(/^Add$/);
  t('the add form opens', added, '');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll('label')].find(l => /medication name/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input');
    if (inp) { inp.value = 'Constructor'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText(/^Add medication$/);
  await page.waitForTimeout(900);
  t('adding it raises no page error', errs.length === errsBefore, errs.slice(errsBefore).join(' | ').slice(0, 200));
  const cardCount = await page.evaluate(() => document.querySelectorAll('[data-med-purpose]').length +
    [...document.querySelectorAll('button')].filter(b => /^Edit /.test(b.getAttribute('aria-label') || '')).length);
  t('the medication list still renders', cardCount > 0, cardCount + ' cards/rows');
  // AND IT MUST SURVIVE A RELOAD -- the config is persisted, so a render that throws once throws forever.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await goMeds();
  const afterReload = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter(b => /^Edit /.test(b.getAttribute('aria-label') || '')).length);
  t('after a reload the Meds screen still lists medications', afterReload > 0, afterReload + ' editable rows');
}

console.log('\n-- nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
process.exit(fail ? 1 : 0);
