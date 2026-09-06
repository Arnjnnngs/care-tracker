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
  { id: 'seed_cyc_end',   medId: 'cycle_end',   dose: null, mg: 0, ts: NOW - 6 * DAY },
  // WEIGHT READINGS ARE SEEDED ON PURPOSE. v66 shipped the Weight add row visible ONLY when there
  // were no readings -- exactly backwards, and invisible on Brandi's phone, which has months of
  // them. The suite tested the empty state and went green. Whichever state a real device is in is
  // the state the test has to be in.
  // NINE AND TWENTY DAYS OLD, BOTH WELL PAST THE 48-HOUR DELETE WINDOW. The first version of this
  // suite seeded a 2-day-old reading and edited THAT, so it exercised the only age at which a
  // delete-based edit could have worked. Every reading on a real phone is older than this window.
  { id: 'seed_w1', medId: 'weight', weight: 156.2, dose: '156.2 lbs', mg: 0, ts: NOW - 9 * DAY },
  { id: 'seed_w2', medId: 'weight', weight: 154.8, dose: '154.8 lbs', mg: 0, ts: NOW - 20 * DAY }
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
export async function deleteDoc(ref){const id=ref&&ref.id;
 // EVERY DELETE IS RECORDED. STATUS.md's v52 section states the Firestore rules refuse a delete by
 // document AGE with no medId exemption -- which is why a paracentesis is removed by appending a
 // tombstone. The first draft of the v69 weight edit called deleteDoc on every row; on Brandi's
 // phone, where readings are months old, the correction would have been added and the old reading
 // left behind. The rules are not in this repo and cannot be read from here, so the suite asserts
 // the app never DEPENDS on a delete rather than asserting what the rules do.
 const hit=store.entries.find(e=>String(e.id)===String(id));
 globalThis.__deleted.push({id:String(id),medId:hit?hit.medId:null});
 store.entries=store.entries.filter(e=>String(e.id)!==String(id));push();}
export async function setDoc(){}
export async function getDocs(){return snap(store.entries);} export function serverTimestamp(){return Date.now();}
globalThis.__entryCount=()=>store.entries.length;
globalThis.__deleted=[];
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
  // COUNT THE ROW, NOT THE EDIT BUTTON -- the same trap that produced a false red in the weight
  // section. A row showing Delete/Keep has no Edit button.
  window.__paraCount = () => document.querySelectorAll('[data-para-row]').length;
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
  // TOTAL DRAINED IS A FEATURE AARON ASKED FOR, not a leftover. STATUS.md records the request:
  // "there can be notes for weight that can add the para together to see how much was drained."
  // The v69 patch very nearly deleted it by carrying over the reasoning that retired the AVERAGE.
  // Scoped to the stat grid, never document.body -- in a single-file app the source is in the body
  // and any text match hits the source itself.
  const totalCard = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('div')].find(d => /repeat\(3/.test(d.style.gridTemplateColumns || ''));
    // CASE-INSENSITIVE: the card label is uppercased by CSS and innerText returns what is
    // RENDERED, so /Total drained/ went red against a build that shows it perfectly.
    return grid ? /total drained/i.test(grid.innerText || '') : false;
  });
  t('the Total drained figure is still on the Paracentesis report', totalCard, totalCard ? '' : 'stat grid missing Total drained');
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
  // PROVE WHICH PATH WE ARE ON. The Weeks/Months toggle only renders once readings exist, so its
  // presence is what stops this check quietly passing on the empty state -- the state v66's version
  // of this check was stuck in while the real one was broken.
  const populated = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /^Weeks$/.test((b.innerText||'').trim())));
  t('the Weight report is showing its populated view', populated, populated ? '' : 'no Weeks/Months toggle - still the empty state');
  t('an add control exists on the Weight report with readings', !!box && populated, box ? '' : 'no [data-weight-report-add]');

  // v69. A weight typed wrong could be added from here but not fixed from here -- the correction
  // lived on a different screen (History). Same shape of gap as the paracentesis one, one screen
  // over.
  // COUNT THE ROW, NOT THE EDIT BUTTON. A row showing the Delete/Keep confirmation has no Edit
  // button, so counting those made arming the confirmation look like a deletion that had not
  // happened -- a false RED that would have sent someone hunting a data-loss bug that was not there.
  const wCount = () => page.evaluate(() => document.querySelectorAll('[data-weight-row]').length);
  const wRows = () => page.evaluate(() => [...document.querySelectorAll('[data-weight-row]')]
    .map(r => r.innerText).join(' | '));
  const beforeW = await wCount();
  // Same guard as the paracentesis edit: "count unchanged" is trivially true of an empty list, and
  // that is exactly how the first version of the para check went green against a build with no
  // controls at all.
  t('there were weight readings to correct in the first place', beforeW > 0, beforeW + ' row(s)');
  if (beforeW > 0) {
    await page.evaluate(() => document.querySelector('[data-weight-edit]').click());
    await page.waitForTimeout(500);
    const field = await page.$('[data-weight-edit-value]');
    t('the weight edit step lets the number be corrected', !!field, field ? '' : 'no [data-weight-edit-value]');
    const titled = await page.evaluate(() => {
      const inp = document.querySelector('input[type="datetime-local"]');
      const dlg = inp && inp.closest('div').parentElement;
      return !!dlg && /Edit Weight/.test(dlg.innerText || '');
    });
    t('the weight edit step says Edit, not Log', titled, '');
    if (field) { await field.fill('150.3'); await confirmModal('weight-edit'); }
    const afterW = await wCount();
    // BOTH halves, for the same reason as the paracentesis edit: asserting only that 150.3 shows
    // would pass just as happily on a build that left the old reading behind as well.
    t('correcting a weight does not leave the old reading behind', afterW === beforeW, beforeW + ' -> ' + afterW);
    t('the corrected weight is the one displayed', /150\.3 lbs/.test(await wRows()), (await wRows()).replace(/\n/g,' ').slice(0, 90));
  }

  // The remove is TWO-STEP on purpose. v66 shipped a one-tap delete on Cycle History and it
  // destroyed a whole period; this asserts the second tap exists rather than trusting the label.
  {
    const beforeR = await wCount();
    await page.evaluate(() => { const b = document.querySelector('[data-weight-remove]'); if (b) b.click(); });
    await page.waitForTimeout(400);
    const armed = await page.evaluate(() => [...document.querySelectorAll('button')]
      .some(b => /^Delete$/.test((b.innerText || '').trim())));
    t('removing a weight asks a second time before deleting', armed, armed ? '' : 'no Delete step');
    const midway = await wCount();
    // Guarded like every other "unchanged" assertion here: 0 -> 0 is trivially unchanged, and this
    // one passed vacuously against v68 where no weight rows have controls at all.
    t('nothing is deleted on the first tap', beforeR > 0 && midway === beforeR, beforeR + ' -> ' + midway);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Delete$/.test((x.innerText || '').trim())); if (b) b.click(); });
    await page.waitForTimeout(600);
    const afterR = await wCount();
    t('confirming removes exactly one reading', beforeR > 0 && afterR === beforeR - 1, beforeR + ' -> ' + afterR);

    // THE GUARANTEE, not the symptom. Both flows above ran against readings 9 and 20 days old, so
    // if either had reached for deleteDoc this is where it shows -- age-independently, without the
    // suite having to know what the Firestore rules actually say. Mirrors PARA-7.
    const dels = await page.evaluate(() => (globalThis.__deleted || []).filter(d => d.medId === 'weight'));
    // `anyWeightWrites >= 0` used to sit inside this guard. A count is never negative, so that
    // clause could not fail and contributed nothing -- the delta audit called it out. What the
    // check is actually for is proving the two flows above ran against real rows, so the
    // never-deletes assertion below is not passing on a screen where nothing happened.
    t('a weight edit and a weight removal both actually ran', beforeW > 0 && beforeR > 0,
      'edited ' + beforeW + ' row(s), removed from ' + beforeR);
    t('correcting or removing a weight NEVER deletes a document', dels.length === 0,
      dels.length ? JSON.stringify(dels) : 'no deleteDoc on any weight');
  }
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
  // ASSERT ITS ABSENCE. v66 shipped a Remove here that destroyed a whole period on one unconfirmed
  // tap -- removing the END reopened the period and the next start merged into it, unrecoverably.
  // It is withdrawn, and this check exists so it cannot come back without someone deciding to.
  t('there is NO one-tap period delete', !rmBtn, rmBtn ? 'data-cycle-remove is back' : '');
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
    // NAMED FOR WHAT IT ACTUALLY ASSERTS. It was called "did not create a second period", which
    // implied it covered cyclePeriods()'s UC20 merge rule; the auditor deleted that whole branch
    // and this stayed green. It cannot cover UC20 -- when the remove succeeds there is only ever
    // one start, so the merge rule is never reached. What it does check is that the move did not
    // duplicate the period, which is worth checking under its own name.
    t('the move replaced the period rather than duplicating it', stillOne === 1, stillOne + ' period(s)');

    // v70. THE GUARANTEE, not the symptom. The seeded markers are 10 and 6 days old -- well past
    // the 48-hour window in which a delete can be relied on -- so if the move had reached for
    // deleteDoc this is where it shows, age-independently, without the suite needing to know what
    // the Firestore rules actually say. Same shape as the weight check above and as PARA-7.
    const mdels = await page.evaluate(() => (globalThis.__deleted || [])
      .filter(d => d.medId === 'cycle_start' || d.medId === 'cycle_end'));
    t('moving a period date NEVER deletes a document', mdels.length === 0,
      mdels.length ? JSON.stringify(mdels) : 'no deleteDoc on any cycle marker');

    // MOVE THE SAME START A SECOND TIME. The correction has to edit the same GROUP, not spawn a
    // second independent one -- otherwise the third date would land beside the second instead of
    // replacing it, and cyclePeriods()'s UC20 merge rule would be the only thing hiding it.
    const beforeSecond = await page.evaluate(() => {
      const b = document.querySelector('[data-cycle-edit-start]');
      return b ? b.closest('div').parentElement.innerText : '';
    });
    await page.evaluate(() => { const b = document.querySelector('[data-cycle-edit-start]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const inp = document.querySelector('input[type="datetime-local"]');
      if (!inp) return;
      const d = new Date(inp.value); d.setDate(d.getDate() - 3);
      const p2 = (n) => String(n).padStart(2, '0');
      inp.value = d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await confirmModal('cycle-move-2');
    const afterSecond = await page.evaluate(() => {
      const b = document.querySelector('[data-cycle-edit-start]');
      return b ? b.closest('div').parentElement.innerText : '(gone)';
    });
    const stillOneAfterTwo = await page.evaluate(() => document.querySelectorAll('[data-cycle-edit-start]').length);
    t('a second move corrects the first rather than adding another period', stillOneAfterTwo === 1, stillOneAfterTwo + ' period(s)');
    t('the second move actually changed the date again', afterSecond !== beforeSecond,
      beforeSecond.replace(/\n/g,' ').slice(0,34) + '  ->  ' + afterSecond.replace(/\n/g,' ').slice(0,34));
  }
}

console.log('\n5. Nothing broke on the way');
t('no page errors', errs.length === 0, errs.join(' / ').slice(0, 200));

await browser.close(); server.close();
console.log('\n' + pass + '/' + (pass + fail) + ' checks passed');
process.exit(fail ? 1 : 0);
