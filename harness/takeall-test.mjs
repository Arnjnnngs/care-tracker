/**
 * takeall-test.mjs — "Take all" must log every medication it can, and never lie about what it did.
 *
 * Aaron, 2026-09-01: "it would only log 1 of 2 meds or something like that. that has been annoying
 * me for a long time."
 *
 * He was right, and it was two separate defects in one button:
 *
 *   1. ONE REFUSED WRITE CANCELLED EVERY DOSE BEHIND IT. The loop awaited addEntryDB() with no
 *      catch, so the first refusal threw straight out of the loop. Measured on the shipped v62
 *      build with a single medication refused in the middle of five: ONE dose saved, four lost.
 *   2. AND THEN IT SAID THE OPPOSITE OF THE TRUTH. The banner read "That didn't save. Nothing was
 *      lost — check your connection and log it again." A dose HAD been saved. A caregiver
 *      following that instruction logs it a second time, and a dose that appears twice in a
 *      medication record is not a cosmetic error.
 *
 * A third, quieter one: "Take all" excludes medications that are not due — correctly, since gap
 * timers and daily ceilings exist precisely to stop those — but it did so SILENTLY. The card lists
 * six medications, the button says "Take all (5)", and nothing ever named the one left behind.
 * That is what "only logged 1 of 2" looks like from the outside even when every write succeeds.
 *
 * SAFETY: all three gstatic Firebase modules are stubbed and every other request is aborted.
 * Brandi's real Firestore is never reachable from this file.
 *
 * Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/takeall-test.mjs
 *      --file <path>   to point at a scratch copy during falsification
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Resolved from a candidate list, not a pinned path: a pinned one made every browser suite in
// these repos unrunnable the last time the environment moved, and a gate that cannot start is
// indistinguishable from a gate that passes.
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright',
    '/home/claude/.npm-global/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found; tried:\n  ' + tries.join('\n  '));
})();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APP_FILE = argv.indexOf('--file') >= 0 ? argv[argv.indexOf('--file') + 1]
                                             : path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const raw = fs.readFileSync(APP_FILE, 'utf8');
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
// refuseFor names the medication whose write is refused. Every write is recorded, in order.
const stubFs = (refuseFor) => `
const store={entries:${JSON.stringify(SEED_ENTRIES)},prefs:{}};const eL=[],pL=[];let n=0;const writes=[];
let REFUSE=${JSON.stringify(refuseFor)};
globalThis.__setRefuse=(v)=>{REFUSE=v;};
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__writes=()=>writes.slice();
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){
  if(REFUSE && (REFUSE==='__all__' || (d && String(REFUSE).split(',').indexOf(d.medId)>=0))) throw new Error('PERMISSION_DENIED (simulated)');
  writes.push(JSON.parse(JSON.stringify(d)));store.entries.push(Object.assign({id:'a'+(++n)},d));
  for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

// NON-LEGACY IDS ON PURPOSE. Seeding 'iron' or 'buspirone' pulls the app's own DEFAULT_MEDS flags
// in through backfillDefaultMedFlags -- including groupedMorning -- so the same medication renders
// on BOTH the Morning and Evening cards, and a document-wide button search then taps the wrong
// card. That cost two wrong diagnoses before it was spotted; it is a fixture trap, not an app bug.
const SEED_MEDS = { version: 1, archivedMeds: [], meds: [
  { id: 'evening-a', name: 'Evening A', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '1 tablet', mg: 0 }], windows: [{ start: 0, end: 24, name: 'All day' }] },
  { id: 'evening-b', name: 'Evening B', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '10 mg', mg: 10 }], windows: [{ start: 0, end: 24, name: 'All day' }] },
  { id: 'evening-c', name: 'Evening C', type: 'win', groupedEvening: true, groupedMorning: false,
    doses: [{ label: '5 mg', mg: 5 }], windows: [{ start: 0, end: 24, name: 'All day' }] },
  // NEVER DUE, DETERMINISTICALLY. The skipped-medication check used to lean on the app's own Iron
  // being outside its window -- which made the suite WALL-CLOCK DEPENDENT: run it at 22:30 and
  // Iron is due, nothing is skipped, and the check goes red on a perfectly good build. This one
  // is a gap-timer medication with a dose already in the store, so it is locked at every hour of
  // the day and "not due" is a property of the fixture rather than of when the suite happens to run.
  { id: 'evening-locked', name: 'Evening Locked', type: 'gap', groupedEvening: true, groupedMorning: false,
    gapH: 12, doses: [{ label: '1 tablet', mg: 0 }] },
  // THE APP'S OWN IRON, forced due at every hour. afterLog() special-cases only iron/protonix/
  // tylenol, so the Iron + Protonix advisory can only be exercised with the real 'iron' id. Left to
  // its default 22:00-24:00 window it is not due for most of the day, so it was never attempted,
  // so refusing it did nothing and the "no advisory for a refused dose" check could not fire at
  // all -- it passed against a build with the guard deliberately broken.
  // Every key that matters is set EXPLICITLY here: backfillDefaultMedFlags only fills keys that are
  // ABSENT, so naming groupedMorning and windows keeps this out of the Morning card and out of the
  // default window.
  { id: 'iron', name: 'Iron', type: 'win', groupedEvening: true, groupedMorning: false, quickLog: false,
    doses: [{ label: '1 tablet', mg: 0 }], windows: [{ start: 0, end: 24, name: 'All day' }] }
]};
// The dose that keeps Evening Locked locked. Seeded into the store before the app reads it.
const SEED_ENTRIES = [
  // Keeps Evening Locked gap-locked, so "not due" is a property of the fixture and not of the hour
  // the suite happens to run at.
  { medId: 'evening-locked', dose: '1 tablet', mg: 0, ts: Date.now() - 60000 },
  // A RECENT PROTONIX DOSE, so the Iron + Protonix advisory in afterLog() can actually fire. Without
  // it that advisory needs a nearby Protonix entry, finds none, and stays silent no matter what --
  // so the check for "no advisory about a refused dose" passed against a build where the guard was
  // deliberately broken. A check that cannot fire is a check that cannot fail.
  { medId: 'protonix', dose: '40 mg', mg: 40, ts: Date.now() - 30 * 60000 }
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function takeAll(refuseFor) {
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(raw); return; }
    rs.writeHead(204); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs(refuseFor)});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort(); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(meds => {
    try { localStorage.setItem('caretracker-medication-config-v1', JSON.stringify(meds)); } catch (e) {}
    // So the What's new notice cannot sit over the card this suite has to tap.
    try { localStorage.setItem('caretracker-seen-version', 'already-seen'); } catch (e) {}
  }, SEED_MEDS);
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // SCOPED TO THE EVENING CARD. A document-wide search finds the Morning card's button first.
  const tapped = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('main section')].find(s => /EVENING MEDS/i.test(s.innerText || ''));
    if (!sec) return null;
    const b = [...sec.querySelectorAll('button')].find(x => (x.innerText || '').trim().toLowerCase().startsWith('take all'));
    if (!b) return null;
    const label = b.innerText.trim();
    b.click();
    return { label, onCard: (sec.innerText.match(/\n/g) || []).length };
  });
  await page.waitForTimeout(900);
  // Take all opens the confirmation; Confirm is what writes.
  const confirmed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Confirm');
    if (!b) return false; b.click(); return true;
  });
  await page.waitForTimeout(1600);
  const out = await page.evaluate(() => ({
    writes: globalThis.__writes().map(w => w.medId),
    toast: (document.querySelector('[role="status"]') || {}).innerText || '',
    banner: ((document.querySelector('[role="alert"]') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
    // The Iron + Protonix advisory afterLog() raises. It must never appear for a dose that was
    // REFUSED -- it would be warning about timing between a dose in the record and one that is not.
    ironWarning: /Iron \+ Protonix timing/.test(document.body.innerText || '')
  }));
  await ctx.close(); server.close();
  return { ...out, tapped, confirmed, errs };
}

console.log('\n1. Nothing refused — every due medication is logged, and anything skipped is NAMED');
{
  const r = await takeAll(null);
  t('the Take all button is on the Evening card', !!r.tapped, r.tapped ? r.tapped.label : 'not found');
  t('the confirmation opened', r.confirmed, '');
  const mine = r.writes.filter(id => String(id).indexOf('evening-') === 0);
  t('the three DUE medications were written', mine.length === 3, r.writes.join(', '));
  // The gap-locked one must be absent: Take all is right to leave it out. The defect was never
  // that it skipped -- it was that it skipped without saying so.
  t('the gap-locked medication was correctly NOT written',
    mine.indexOf('evening-locked') < 0, mine.join(', '));
  t('the caregiver is told it worked', /logged/i.test(r.toast), r.toast || '(no toast)');
  t('no write-failure banner appears when nothing failed', !r.banner, r.banner || '(none)');
  // THE SILENT-SKIP DEFECT. The app's own Iron rides along in this fixture and is never due at the
  // hour this runs ("Opens 10:00 PM"), so Take all always leaves it out. It must be NAMED.
  // Written as a positive assertion on purpose: the first version of this check was
  // `!/not due/.test(toast) || /not due yet/.test(toast)`, which is satisfied by a toast that
  // never mentions it at all -- so it passed on the broken build too. A check with an escape
  // clause is a check that cannot fail.
  t('the medication left out because it is not due is NAMED, not dropped in silence',
    /Evening Locked/.test(r.toast) && /not due yet/.test(r.toast), r.toast || '(no toast)');
  // AND ONLY THE ONES ACTUALLY SKIPPED. Asking whether the right name is PRESENT is half a check;
  // the other half is whether wrong names are ABSENT. The auditor changed the filter to a map and
  // got "5 meds logged ... Evening A, Evening B, Evening C, Evening Locked, Iron, Compazine not due
  // yet" -- five logged and six named as not due, in one sentence -- and the suite stayed 25/25.
  // Same shape as the backwards-banner blocker one round earlier: presence checks pass on nonsense.
  const notDuePart = (r.toast.split(/·/)[1] || '');
  t('and the "not due" list names ONLY medications that were not logged',
    !/Evening A|Evening B|Evening C\b/.test(notDuePart), 'not-due clause: "' + notDuePart.trim() + '"');
  t('no page errors', r.errs.length === 0, r.errs.join(' / '));
}

console.log('\n2. ONE medication refused — the others must still be saved');
{
  const r = await takeAll('evening-b');
  const mine = r.writes.filter(id => String(id).indexOf('evening-') === 0);
  // THE DEFECT ITSELF. On the shipped v62 build this was 1 of 5: the throw left the loop and every
  // dose behind the refused one was never attempted.
  t('the refused medication did not cancel the ones after it',
    mine.indexOf('evening-c') >= 0, 'written: ' + (r.writes.join(', ') || 'nothing'));
  t('the medication that was refused is genuinely absent', mine.indexOf('evening-b') < 0, mine.join(', '));
  t('and the ones before it are still saved', mine.indexOf('evening-a') >= 0, mine.join(', '));
}

console.log('\n3. And it must never claim nothing was saved when something was');
{
  const r = await takeAll('evening-b');
  t('a banner is shown, not a success toast', !!r.banner, r.banner || '(no banner)');
  // THE SENTENCE THAT CAUSED THE HARM. "Nothing was lost -- log it again" sent the caregiver back
  // to re-log doses that were already written.
  t('it does NOT say nothing was lost', !/nothing was lost/i.test(r.banner), r.banner);
  // WHICH SIDE EACH NAME IS ON, not merely that it appears. THIS IS THE CHECK THE RELEASE RESTS ON
  // AND THE FIRST VERSION DID NOT MAKE IT. The auditor swapped only the two name lists, so the
  // banner named the refused medication as saved and the three saved ones as failed --
  // "Evening B was logged. Evening A, Evening C, Compazine were NOT. Log only the missing one
  // again." That instructs the caregiver to re-log three doses ALREADY IN THE RECORD, which is the
  // exact harm this release exists to stop, and the suite stayed 19/19 GREEN because it only asked
  // whether the names appeared anywhere in the sentence.
  // The banner reads "<saved> were logged. <failed> were NOT. ..." so the saved side ends at
  // "were/was logged." and the failed side runs from there to "were/was NOT". Splitting on
  // "was NOT" alone put the FAILED name at the tail of the saved side, because the name comes
  // before those words -- a parsing slip that made this check fail on a correct build.
  const bannerText = r.banner;
  const mLogged = bannerText.match(/\b(?:were|was) logged\./);
  const loggedPart = mLogged ? bannerText.slice(0, mLogged.index) : '';
  const rest = mLogged ? bannerText.slice(mLogged.index + mLogged[0].length) : bannerText;
  const mNot = rest.match(/\b(?:were|was) NOT\b/);
  const notPart = mNot ? rest.slice(0, mNot.index) : '';
  t('the medication that FAILED is named on the failed side, not the saved side',
    /Evening B/.test(notPart) && !/Evening B/.test(loggedPart),
    'saved side: "' + loggedPart.trim() + '"  |  failed side: "' + notPart.trim() + '"');
  t('the medications that SAVED are named on the saved side, not the failed side',
    /Evening A/.test(loggedPart) && !/Evening A/.test(notPart), 'saved side: "' + loggedPart.trim() + '"');
  t('exactly one medication is reported as failed, because exactly one was',
    (notPart.match(/Evening [A-Z]/g) || []).length === 1, notPart.trim());
  t('it tells the caregiver not to re-log the saved ones',
    /already saved|only the missing/i.test(r.banner), r.banner);
  // THE SKIP MUST BE NAMED HERE TOO. skippedNames was originally built once and used only in the
  // all-saved branch, so the silent skip this release exists to remove survived in exactly the
  // failure case the release is about -- while the notice a patient reads claimed it unqualified.
  // Dropping the tail from the failure paths left the suite fully green; this is what catches it.
  t('a medication skipped for not being due is named on the FAILURE path too',
    /Evening Locked/.test(r.banner) && /not due yet/.test(r.banner), r.banner);
}

console.log('\n4. A clinical advisory must never fire for a dose that was refused');
{
  // Iron is one of the app's own evening medications and rides along in this fixture. afterLog()
  // raises an Iron + Protonix timing advisory. It used to be gated on
  // `savedNames.length && ids.includes('iron')` -- "something saved" AND "iron was attempted",
  // which is not "iron saved". With Iron refused and the others written it warned about the timing
  // of a dose that is not in the record. On the previous build the throw skipped the line
  // entirely, so the fix introduced it. Found by the Zero Day Auditor.
  const r = await takeAll('iron');
  t('Iron really was refused', r.writes.indexOf('iron') < 0, r.writes.join(', '));
  t('something else really did save, so the guard is under load',
    r.writes.filter(id => String(id).indexOf('evening-') === 0).length > 0, r.writes.join(', '));
  t('no Iron advisory is raised about a dose that was refused', !r.ironWarning,
    r.ironWarning ? 'the Iron + Protonix advisory appeared for a dose that is not in the record' : '');
}

console.log('\n5. A stale failure banner must not survive a retry that worked');
{
  // NEW BEHAVIOUR IN THIS COMMIT AND IT HAD NO TEST -- deleting the clear left the suite fully
  // green, which the auditor found. A banner left over from a failed attempt keeps telling the
  // caregiver to "log them again" for doses that are now in the record: the same false instruction
  // this release exists to remove, just one attempt later.
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(raw); return; }
    rs.writeHead(204); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:stubFs('evening-b,evening-c')});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(meds => {
    try { localStorage.setItem('caretracker-medication-config-v1', JSON.stringify(meds)); } catch (e) {}
    try { localStorage.setItem('caretracker-seen-version', 'already-seen'); } catch (e) {}
  }, SEED_MEDS);
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const press = () => page.evaluate(() => {
    const sec = [...document.querySelectorAll('main section')].find(s => /EVENING MEDS/i.test(s.innerText || ''));
    if (!sec) return false;
    const b = [...sec.querySelectorAll('button')].find(x => (x.innerText || '').trim().toLowerCase().startsWith('take all'));
    if (!b) return false; b.click(); return true;
  });
  const confirm = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.innerText || '').trim() === 'Confirm');
    if (!b) return false; b.click(); return true;
  });
  const bannerNow = () => page.evaluate(() => ((document.querySelector('[role="alert"]') || {}).innerText || '').replace(/\s+/g, ' ').trim());
  await press(); await page.waitForTimeout(800); await confirm(); await page.waitForTimeout(1500);
  const first = await bannerNow();
  // TWO refused on the first attempt, not one, so two medications are still due for the retry --
  // Take all only appears at two or more. With one refused the button was gone and the retry could
  // not be exercised at all, which is a check that cannot fire rather than a check that fails.
  t('the first attempt leaves a failure banner up', /were NOT|was NOT/.test(first), first || '(none)');
  // Now let everything through and take all again.
  await page.evaluate(() => globalThis.__setRefuse(null));
  const pressed2 = await press();
  t('Take all is still available for the retry', pressed2, '');
  if (pressed2) {
    await page.waitForTimeout(800); await confirm(); await page.waitForTimeout(1600);
    const second = await bannerNow();
    t('the stale banner is gone after a retry that fully succeeded', !second,
      second ? 'still saying: "' + second + '"' : '');
  }
  await ctx.close(); server.close();
}

console.log('\n6. Everything refused — then "nothing was lost" is TRUE and may be said');
{
  // EVERY write refused. This is the ONLY case where "nothing was lost" is true, and it must still
  // be said here -- the fix must not replace one wrong message with another.
  const r = await takeAll('__all__');
  t('nothing at all was written', r.writes.length === 0, r.writes.join(', ') || '(nothing)');
  t('a banner is shown', !!r.banner, r.banner || '(none)');
  t('and here it MAY say nothing was lost, because that is true',
    /nothing was lost/i.test(r.banner), r.banner);
  t('it does not name anything as saved, because nothing was',
    !/already saved/i.test(r.banner), r.banner);
}

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
await browser.close();
process.exit(fail ? 1 : 0);
