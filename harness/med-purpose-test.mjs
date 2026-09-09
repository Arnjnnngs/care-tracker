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
// THE PARSER IS A GUARD TOO, AND PASS 5 FOUND IT WAS THE HOLE IN ALL THE OTHERS.
// It matched only a SINGLE-quoted value with an all-lowercase key. One entry written with DOUBLE
// quotes -- the natural thing to reach for the moment a sentence contains an apostrophe, in a table
// made of prose about medicines -- was invisible to every check in this file at once:
//     'promethazine': "Settles nausea, and brings down a fever. One tablet under the tongue every 4 hours."
// The suite printed "42 entries" for a 43-entry table and a FULL GREEN BOARD -- fever guard, number
// guard, form/route guard, schedule guard and all four liveness lines -- while the app rendered that
// sentence under the medication on the patient's Meds screen. No typo was needed. The only assertion
// on the parse was that it found more than zero entries.
// It reads both quote styles now, AND the count is asserted against the number of lines that look
// like entries, because the next thing this parser cannot read will not be a quote style.
const tableMatch = html.match(/const MED_PURPOSE = \{([\s\S]*?)\n\};/);
const TABLE = {};
let entryLines = 0;
if (tableMatch) {
  for (const m of tableMatch[1].matchAll(/'([^'\n]+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g))
    TABLE[m[1]] = m[2] !== undefined ? m[2] : m[3];
  entryLines = tableMatch[1].split('\n').filter(l => /^\s*['"][^'"\n]+['"]\s*:/.test(l)).length;
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
  // THE CHECK THAT CLOSES THE HOLE. Every guard below reads TABLE; if the parser cannot see an
  // entry, every one of them passes it in silence. This compares what was parsed against what looks
  // like an entry in the source, so an unreadable line is a RED check rather than an absent one.
  t('the suite can read EVERY entry in the table', ids.length === entryLines,
    ids.length + ' parsed of ' + entryLines + ' entry lines');
  // The app normalises its lookup key to lowercase, so an entry keyed with a capital could never be
  // found at runtime. That used to be enforced by accident, by a parser that could not see such a
  // key -- which is the worst way to enforce anything. It is a check now.
  const shouty = ids.filter(k => k !== k.toLowerCase());
  t('every key is lowercase, so the app can actually find it', shouty.length === 0, shouty.join(', '));
  const empty = ids.filter(k => !TABLE[k].trim());
  t('no entry is blank', empty.length === 0, empty.join(', '));
  // THE GUARD THAT MATTERS. A digit here is a dose, a frequency or a duration creeping into text
  // that is only ever meant to say what a medication is generally for.
  const NUMBERY = /\d/;
  const withDigits = ids.filter(k => NUMBERY.test(TABLE[k]));
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
  const FEVERY = /fever|antipyretic|temperature/i;
  const fevery = ids.filter(k => FEVERY.test(TABLE[k]));
  t('NO entry tells anyone a medication brings down a fever', fevery.length === 0,
    fevery.map(k => k + ': ' + TABLE[k]).join(' | '));
  // A LINE DESCRIBES THE DRUG. IT NEVER SAYS WHAT THE THING LOOKS LIKE OR WHERE TO PUT IT.
  // Three audit passes went at this one check and the list was too short every time:
  //   pass 1 blocked  "a numbing CREAM ... ON THE SKIN"          -> cream, on the skin added
  //   pass 2 blocked  "This is Tylenol in LIQUID form"           -> liquid, tablet, capsule added,
  //                   and the check written for that exact case had reported PASS on it
  //   pass 3 broke it with "a PILL you SWALLOW", "as a SHOT under the skin", "through a DRIP",
  //                   "Numbs the SKIN", "under your TONGUE", "RUB onto", "APPLIED where it hurts"
  //                   -- eight sentences, every one green.
  // THE LESSON, WRITTEN DOWN SO A FOURTH PASS DOES NOT HAVE TO FIND IT AGAIN. A list of words can
  // never enforce "names no dosage form", so this check no longer CLAIMS to. It is named for exactly
  // what it does: it rejects a word from the list. A check that prints a false sentence in green is
  // worse than no check -- the app-v70 ruling, on this same class.
  // THE LIST BANS FORM AND ROUTE, NOT ANATOMY -- and pass 4 caught this sentence being FALSE of the
  // code beside it, for the third time on this one check. The list held bare `skin`, `tongue`, `vein`
  // and `rectal`, so "Eases itching and swelling of the skin" was rejected while "Settles the
  // stomach" was not. Skin drugs are a large part of supportive care: that would have bitten a real
  // entry, and the next person to edit this table was being told the opposite in the comment AND in
  // the shipped release note. The bare anatomy words are gone. The ROUTE PHRASES that contain them
  // stay -- "on the skin" is where you put it, "of the skin" is what it acts on -- and so do the
  // plurals, the inflections and IV, all of which walked through the previous list.
  // "Numbs the skin" now PASSES, deliberately. It says what the drug does. Whether it is TRUE of a
  // particular medication is a question for a reader, and no list of words was ever going to answer it.
  // TWO WORDS ARE LEFT OUT ON PURPOSE, SAID OUT LOUD because an exemption nobody wrote down is
  // indistinguishable from an oversight. `oral` would reject "Treats oral thrush", a condition
  // rather than a route, and nystatin is a supportive-care drug this table may well gain.
  // `dissolve` would reject "Dissolves clots", which is what a drug does rather than how it is
  // taken. Both mean this list lets "An oral steroid" and "Dissolves on the tongue" through --
  // "under the tongue" is caught, "on the tongue" is not. That is the accepted cost of a list
  // that must not reject true descriptions, and it is why the reader, not the list, is the gate.
  const FORMY = /\b(pills?|tablets?|capsules?|caplets?|troches?|lozenges?|liquids?|syrups?|elixirs?|powders?|sachets?|patches|patch|creams?|ointments?|gels?|lotions?|rinses?|mouthwash|gargle|suppositor(?:y|ies)|enemas?|sprays?|sprayed|inhalers?|inhaled|nebuli[sz]ed|injections?|injected|inject|shots?|infusions?|infused|drips?|intravenous(?:ly)?|iv|subcutaneous(?:ly)?|intramuscular(?:ly)?|sublingual(?:ly)?|transdermal|intranasal|swallow(?:ed)?|chew(?:able)?|topical(?:ly)?|orally|by mouth|rub|rubs|rubbed|applied|apply|smear|dab|rectally|on the skin|onto the skin|into the skin|under the skin|under the tongue|under your tongue|into a vein|through a vein|into a muscle|in a drip|through a drip)\b/i;
  const formy = ids.filter(k => FORMY.test(TABLE[k]));
  t('NO entry uses a word from the dosage-form / route list', formy.length === 0,
    formy.map(k => k + ': ' + TABLE[k]).join(' | '));

  // ---- CAN THESE CHECKS FIRE AT ALL? -----------------------------------------------------------
  // The beta's copy of the form guard was written with a DOUBLED backslash, so the pattern looked
  // for a literal backslash and could never match anything. It sat green for weeks over the exact
  // sentence the first audit had blocked, in a suite that ran on every release.
  // A guard nobody can prove fires is not a guard. Each one is now handed a sentence it MUST reject,
  // so a typo that kills the pattern turns this red instead of turning the whole table green.
  // AND EACH CHECK MUST TOUCH THE GUARD IT VOUCHES FOR. The first version of this block re-typed two
  // of the four patterns instead of naming them, so the fever guard could be killed with the very
  // typo this block exists to catch and the suite stayed 34/34 GREEN -- with an entry reading "Eases
  // pain and brings down a fever" and the line "the fever guard can actually fire" printed in green
  // above it. A copy of a pattern proves nothing about the original. All four are constants now.
  t('the form/route guard can actually fire', FORMY.test('A numbing cream you rub on the skin.'), '');
  t('the schedule guard can actually fire', SCHEDULEY.test('Take one at bedtime as needed.'), '');
  t('the fever guard can actually fire', FEVERY.test('Brings down a fever.'), '');
  t('the number guard can actually fire', NUMBERY.test('Eases pain for 4 hours.'), '');
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

console.log('\nTyped text — it survives a reload, and nothing a caregiver pastes scrolls the page sideways');
{
  // PASS 4 BROKE THE FIRST VERSION OF THIS CHECK, AND THE WAY IT BROKE IT IS THE LESSON.
  // It compared document.scrollWidth to window.innerWidth -- and under this suite's mobile emulation
  // innerWidth GROWS to swallow the overflow, so the ruler stretched with the thing being measured.
  // A pasted no-space pharmacy name (447px), a pasted portal link (413px) and a long generic name
  // (413px) every one scrolled sideways at a 320px viewport, and the check said PASS on all three.
  // It caught the 300-character mutant only because that finally exceeded the emulator's clamp.
  // THE RULER IS NOW THE WIDTH THIS TEST ITSELF SET, passed in from Node and never read back out of
  // the page, and the cases are what a caregiver actually pastes rather than one absurd one.
  // EVERY ONE OF THESE FOUR STRINGS WAS LENGTHENED UNTIL IT COULD ACTUALLY FAIL. The first draft
  // used a 48-character pharmacy name and a 71-character link, and BOTH stayed green on a build
  // with the wrapping rule deleted -- they simply fit. Two of the four cases could not fail, in a
  // suite added because a check that could not fail sat green for weeks.
  // ONE RULE, ON THE WHOLE CARD. The previous version put it on the card's text COLUMN and left a
  // second copy on the purpose line, and claimed the two were proved non-redundant -- a claim the
  // audit disproved in one run, because overflow-wrap is INHERITED and the line's copy did
  // nothing. Worse, the note and the dose summary render in a different container from that
  // column, so a pasted pharmacy name in the note measured 668px at a 320px viewport while these
  // four cases stayed green. The rule is on the article now and every string the card renders is
  // inside it, the note included -- which is why there is a note case below.
  const VW = 320;
  const LONG = 'Prescribed' + 'x'.repeat(300) + 'end';
  const setField = (labelRe, v) => page.evaluate(([lr, val]) => {
    const rx = new RegExp(lr, 'i');
    const lab = [...document.querySelectorAll('label')].find(l => rx.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    if (!inp) return false;
    inp.value = val; inp.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }, [labelRe, v]);
  const openZofran = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^Edit Zofran$/i.test(x.getAttribute('aria-label') || ''));
    if (b) { b.click(); return true; } return false;
  });
  const pageWidthAt = async (w) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(400);
    const doc = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    return doc;
  };

  await goMeds();
  const CASES = [
    ['what it', 'a pasted pharmacy name with no spaces', 'ONDANSETRONHYDROCHLORIDEDIHYDRATEORALLYDISINTEGRATINGTABLETEIGHTMILLIGRAMFILMCOATED'],
    ['what it', 'a link pasted from the hospital portal', 'https://mychart.example-hospital.org/inside/visit/summary/medications/2026-09-08/detail?ref=printout'],
    ['generic name', 'a very long generic name', 'ONDANSETRONHYDROCHLORIDEDIHYDRATEORALLYDISINTEGRATINGTABLETEIGHTMILLIGRAMFILMCOATED'],
    ['note', 'a pasted pharmacy name in the note field', 'ONDANSETRONHYDROCHLORIDEDIHYDRATEORALLYDISINTEGRATINGTABLETEIGHTMILLIGRAMFILMCOATED'],
    ['what it', 'three hundred characters with no break in them', LONG],
  ];
  // EACH CASE PUTS THE FIELD BACK BEFORE THE NEXT ONE RUNS. The first draft did not, so the long
  // GENERIC NAME from one case was still on the card during the next, and that case went red for a
  // reason that had nothing to do with what it was testing. A check that fails for the wrong reason
  // is no better evidence than one that passes for the wrong reason.
  const SAFE = { 'generic name': 'Ondansetron', 'what it': '', 'note': '' };
  for (const [field, what, value] of CASES) {
    await openZofran();
    await page.waitForTimeout(500);
    const ok = await setField(field, value);
    await clickText(/^Save changes$/);
    await page.waitForTimeout(700);
    const doc = await pageWidthAt(VW);
    t('the page does not scroll sideways at ' + VW + 'px: ' + what,
      ok && doc <= VW + 1, 'field=' + (ok ? 'set' : 'MISSING') + ' page=' + doc + 'px');
    await openZofran();
    await page.waitForTimeout(400);
    await setField(field, SAFE[field]);
    await clickText(/^Save changes$/);
    await page.waitForTimeout(600);
  }
  await openZofran(); await page.waitForTimeout(400);
  await setField('what it', LONG);
  await clickText(/^Save changes$/);
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await goMeds();
  const back = (await purposeMap())['zofran'] || '';
  t('the typed line is still there after closing and reopening the app', back === LONG,
    back.slice(0, 24) + ' (' + back.length + ' chars)');
}

console.log('\n-- nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
process.exit(fail ? 1 : 0);
