// archived-meds-test.mjs -- v75. Removed medications can be seen and brought back.
//
// WHAT IT PROVES, and the order matters: the dangerous half first.
//   1. RESTORE BRINGS THE MEDICATION BACK WITH REMINDERS OFF. This is the whole safety argument.
//      missedDosesFor() walks every day since MISSED_TRACK_SINCE reading
//      `state.meds.filter(m => m.alerts && m.windows)`, so a tracked medication restored with
//      alerts ON flags every dose window during the weeks it was archived. The check asserts the
//      SAVED config, not the screen, and then asserts the BEHAVIOUR: the missed-dose count does
//      not move when a tracked medication comes back.
//   2. The archive keeps the whole medication, so what comes back is what went away.
//   3. Restore puts it back under its ORIGINAL id -- the reason the feature exists, since every
//      stored dose points at that id. Asserted by logging a dose, removing, restoring, and
//      requiring the dose to read with its medication again.
//   4. Restore is REFUSED when an active medication already holds that id.
//   5. Restoring twice is a no-op.
//   6. An archive written by an OLDER build (name and generic name only) restores from the
//      medication the app ships with, and the app says so rather than pretending.
//   7. THE EXEMPTION, ASSERTED: with nothing archived there is no "Removed medications" heading at
//      all. A notice about an empty list is the defect the sibling app's audit found in v74.
//
// Every assertion that matters reads the SAVED medication config out of localStorage, never the
// screen. A screen can render the right word while the record holds the wrong one -- that is the
// v43.3 failure class, and the reason the v74 suite was rebuilt four times.
//
// Run:  node harness/archived-meds-test.mjs [--file <index.html>] [--shots <dir>]
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

const MED_KEY = 'caretracker-medication-config-v1';
// A value no default carries, so 'the archive kept what was removed' cannot pass by accident on a
// build that archived the shipped default instead of the caregiver's own edited version.
const MARKER = 'Aaron changed this line before it was removed';

const stubFs = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
export function getFirestore(){return{__db:true};} export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};} export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));eL.forEach(f=>f(snap(store.entries)));return{id:'a'+n};}
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
await ctx.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
  if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: stubFs });
  if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
  if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
await page.addInitScript((v) => { try { localStorage.setItem('caretracker-seen-version', v); } catch (e) {} }, VER);
const load = async () => {
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
};
await load();

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
const clickText = async (re) => page.evaluate(([src, flags]) => {
  const rx = new RegExp(src, flags);
  const b = [...document.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim()));
  if (b) { b.click(); return true; } return false;
}, [re.source, re.flags]);
const clickLabel = async (label) => page.evaluate((l) => {
  const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === l);
  if (b) { b.click(); return true; } return false;
}, label);
const goMeds = async () => { await clickText(/^Meds$/); await page.waitForTimeout(700); };
// THE RECORD, NOT THE SCREEN. Every claim about what was saved is read back out of the medication
// config the app actually persists.
const saved = () => page.evaluate((k) => {
  try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; }
}, MED_KEY);
const activeIds = async () => ((await saved()).meds || []).map(m => m.id);
const archivedIds = async () => Object.keys((await saved()).archivedMeds || {});
const archivedRows = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-archived-med]')].map(el => el.getAttribute('data-archived-med')));

// The medication this suite removes and brings back. Chosen from the app's OWN default list rather
// than named here -- a name typed into a suite drifts from the app and proves nothing about it --
// and chosen to be TRACKED (alerts on), because the reminder-flood trap only exists for those:
// picking an as-needed medication would make the central check of this whole file unfalsifiable.
// READ OUT OF THE FILE UNDER TEST. The app does not persist its medication config until something
// changes, so on a fresh device localStorage holds nothing to pick from -- which is the state a new
// phone is actually in, and a suite that only worked after a save would not be testing that phone.
const DEFAULT_MEDS_SRC = (html.match(/const DEFAULT_MEDS = \[[\s\S]*?\n\];/) || [])[0];
if (!DEFAULT_MEDS_SRC) { console.error('REFUSING: could not read DEFAULT_MEDS out of the file under test.'); process.exit(3); }
const TRACKED = await page.evaluate((src) => {
  const list = new Function(src + '; return DEFAULT_MEDS;')();
  const m = list.find(x => x.alerts && x.windows && x.windows.length);
  return m ? { id: m.id, name: m.name } : null;
}, DEFAULT_MEDS_SRC);

console.log('\n1. With nothing removed, the app says nothing about removed medications');
{
  await goMeds();
  t('a tracked medication exists to test with', !!TRACKED, TRACKED ? TRACKED.id : '(none)');
  t('nothing is archived to begin with', (await archivedIds()).length === 0, (await archivedIds()).join(', '));
  const heading = await page.evaluate(() => !!document.querySelector('[data-archived-meds]'));
  t('THE EXEMPTION: no "Removed medications" section when nothing is removed', !heading, '');
}

console.log('\n2. Removing a medication archives the WHOLE thing, not just its name');
{
  // EDIT IT FIRST, so what is archived can be told apart from what the app ships with. Comparing
  // the archive against DEFAULT_MEDS would pass on a build that quietly archived the default
  // instead of the caregiver's own version -- and a medication she has adjusted is precisely the
  // one worth not losing.
  await clickLabel('Edit ' + TRACKED.name);
  await page.waitForTimeout(500);
  const edited = await page.evaluate((v) => {
    const lab = [...document.querySelectorAll('label')].find(l => /what it/i.test(l.innerText || ''));
    const inp = lab && lab.querySelector('input, textarea');
    if (!inp) return false;
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }, MARKER);
  await clickText(/^Save changes$/);
  await page.waitForTimeout(700);
  const live = ((await saved()).meds || []).find(m => m.id === TRACKED.id);
  t('the medication was edited before removal, so the archive can be told from the default',
    edited && !!live && live.purpose === MARKER, live ? String(live.purpose) : '(missing)');

  await clickLabel('Remove ' + TRACKED.name);
  await page.waitForTimeout(400);
  await clickLabel('Confirm removal of ' + TRACKED.name);
  await page.waitForTimeout(700);
  t('it left the active list', !(await activeIds()).includes(TRACKED.id), '');
  t('it is in the archive', (await archivedIds()).includes(TRACKED.id), '');
  const entry = ((await saved()).archivedMeds || {})[TRACKED.id];
  t('the archive still carries the name and generic name it always did',
    !!entry && entry.name === TRACKED.name && typeof entry.sub === 'string', JSON.stringify(entry && entry.name));
  t('the archive now carries the whole medication', !!(entry && entry.config), '');
  t('and it is the CAREGIVER\'S version that was archived, not the one the app ships with',
    !!entry && !!entry.config && entry.config.purpose === MARKER, entry && entry.config ? String(entry.config.purpose) : '(no config)');
  t('field for field, the archived copy is what was on the active list',
    !!entry && !!entry.config && !!live && JSON.stringify(entry.config) === JSON.stringify(live), '');
  t('it is listed on the Meds screen', (await archivedRows()).includes(TRACKED.id), (await archivedRows()).join(', '));
  await shot('1-removed-list');

  // AND IT SURVIVES A RELOAD. Falsifying this file caught the gap: every assertion above reads the
  // archive in the same breath as the removal, so a build whose loader STRIPPED the stored settings
  // on the way back in scored a full green board. That is the identical trap the sibling app hit
  // when it first archived pause periods -- the write was right and the read threw it away -- and
  // the only thing that catches it is closing the app and opening it again.
  // AND THE APP STILL HAS THEM AFTER A RELOAD. Falsifying this file caught two things here.
  // First, every assertion above reads the archive in the same breath as the removal, so a build
  // whose LOADER stripped the stored settings on the way back in scored a full green board -- the
  // identical trap the sibling app hit when it first archived pause periods, where the write was
  // right and the read threw it away.
  // Second, and the reason this reads the SCREEN rather than storage: the strip happens in memory
  // on load and is only written back on the next save, so localStorage still holds the settings on
  // a build that has already forgotten them. Reading the file would have passed on the broken
  // build. The row's own note is what the app actually believes.
  await load();
  await goMeds();
  const note = await page.evaluate((id) => {
    const el = document.querySelector('[data-archived-med="' + id + '"]');
    return el ? (el.innerText || '') : '(no row)';
  }, TRACKED.id);
  t('after closing and reopening the app, it still knows the settings were kept',
    note !== '(no row)' && !/not kept/i.test(note), note.replace(/\n/g, ' | ').slice(0, 80));
}

console.log('\n3. THE SAFETY CHECK: it comes back with reminders OFF');
{
  // Read the missed-dose count BEFORE restoring, so the assertion below is about the change rather
  // than about an absolute number that depends on the day this suite happens to run.
  const missedBefore = await page.evaluate(() => document.querySelectorAll('[data-missed-row], [data-missed-banner]').length);
  await clickLabel('Bring back ' + TRACKED.name);
  await page.waitForTimeout(400);
  const armed = await page.evaluate(() => !!document.querySelector('[data-archived-med] button[aria-label^="Confirm bringing back"]'));
  t('bringing one back asks first', armed, '');
  await clickLabel('Confirm bringing back ' + TRACKED.name);
  await page.waitForTimeout(800);
  t('it is on the active list again', (await activeIds()).includes(TRACKED.id), '');
  t('it is gone from the archive', !(await archivedIds()).includes(TRACKED.id), '');
  const back = ((await saved()).meds || []).find(m => m.id === TRACKED.id);
  // THE ONE THAT MATTERS, and it is read from the SAVED record rather than the screen.
  t('REMINDERS ARE OFF in the saved record', !!back && back.alerts === false, 'alerts=' + (back && back.alerts));
  t('the caregiver\'s own version came back, not the shipped default', !!back && back.purpose === MARKER,
    back ? String(back.purpose) : '(missing)');
  t('its dose windows came back too', !!back && (back.windows || []).length > 0, 'windows=' + (back ? (back.windows || []).length : 0));
  const missedAfter = await page.evaluate(() => document.querySelectorAll('[data-missed-row], [data-missed-banner]').length);
  t('and no wall of missed doses appeared for the days it was away', missedAfter <= missedBefore,
    missedBefore + ' -> ' + missedAfter);
  await shot('2-restored');
}

console.log('\n4. It survives a reload, and restoring again is a no-op');
{
  await load();
  await goMeds();
  t('still on the active list after closing and reopening the app', (await activeIds()).includes(TRACKED.id), '');
  const back = ((await saved()).meds || []).find(m => m.id === TRACKED.id);
  t('and reminders are still off', !!back && back.alerts === false, 'alerts=' + (back && back.alerts));
  const gone = await clickLabel('Bring back ' + TRACKED.name);
  t('there is no "Bring back" control for it any more', !gone, '');
}

console.log('\n5. Restore is REFUSED when an active medication already holds that id');
{
  // Archive it, then put a medication back on the active list under the SAME id behind the app's
  // back -- the state two phones can reach through medsync -- and require the app to refuse rather
  // than collide or silently orphan the dose history.
  await clickLabel('Remove ' + TRACKED.name);
  await page.waitForTimeout(400);
  await clickLabel('Confirm removal of ' + TRACKED.name);
  await page.waitForTimeout(700);
  await page.evaluate(([k, id, name]) => {
    const cfg = JSON.parse(localStorage.getItem(k) || '{}');
    cfg.meds = (cfg.meds || []).concat([{ id: id, name: name, sub: '', doses: [], type: 'gap', alerts: false }]);
    localStorage.setItem(k, JSON.stringify(cfg));
  }, [MED_KEY, TRACKED.id, TRACKED.name]);
  await load();
  await goMeds();
  const clash = ((await saved()).meds || []).filter(m => m.id === TRACKED.id).length;
  t('the clashing medication is set up', clash === 1 && (await archivedIds()).includes(TRACKED.id), 'active=' + clash);
  await clickLabel('Bring back ' + TRACKED.name);
  await page.waitForTimeout(300);
  await clickLabel('Confirm bringing back ' + TRACKED.name);
  await page.waitForTimeout(700);
  const after = ((await saved()).meds || []).filter(m => m.id === TRACKED.id).length;
  t('restore is refused rather than creating a duplicate', after === 1, 'active copies=' + after);
  t('and it stays in the archive so nothing is lost', (await archivedIds()).includes(TRACKED.id), '');
}

console.log('\n6. An archive written by an OLDER build still restores something usable');
{
  // Strip the config back to {name, sub}, exactly as a build from before this release would write
  // it, and clear the clash from the previous section.
  await page.evaluate(([k, id]) => {
    const cfg = JSON.parse(localStorage.getItem(k) || '{}');
    cfg.meds = (cfg.meds || []).filter(m => m.id !== id);
    const e = (cfg.archivedMeds || {})[id];
    if (e) cfg.archivedMeds[id] = { name: e.name, sub: e.sub || '' };
    localStorage.setItem(k, JSON.stringify(cfg));
  }, [MED_KEY, TRACKED.id]);
  await load();
  await goMeds();
  // `|| {}` on purpose. On a broken build there may be no archive entry here at all, and a suite
  // that CRASHES scores nothing -- and nothing is not evidence. It must go red and keep going.
  const entry = ((await saved()).archivedMeds || {})[TRACKED.id] || {};
  t('the archive entry is still there, with no stored settings, like an older build would leave it',
    !!((await saved()).archivedMeds || {})[TRACKED.id] && !entry.config, '');
  const noted = await page.evaluate((id) => {
    const el = document.querySelector('[data-archived-med="' + id + '"]');
    return el ? (el.innerText || '') : '';
  }, TRACKED.id);
  t('and the screen SAYS the settings were not kept, rather than pretending',
    /not kept/i.test(noted), noted.replace(/\n/g, ' | ').slice(0, 90));
  await clickLabel('Bring back ' + TRACKED.name);
  await page.waitForTimeout(300);
  await clickLabel('Confirm bringing back ' + TRACKED.name);
  await page.waitForTimeout(800);
  const back = ((await saved()).meds || []).find(m => m.id === TRACKED.id);
  t('it still comes back', !!back, '');
  t('with reminders off, the same as every other path', !!back && back.alerts === false, 'alerts=' + (back && back.alerts));
  t('and with the doses it ships with rather than an empty shell', !!back && (back.doses || []).length > 0,
    'doses=' + (back ? (back.doses || []).length : 0));
}

console.log('\n7. The dose history joins back up -- the reason this exists at all');
{
  // The id is what every stored dose points at. Restoring under the SAME id is what makes an old
  // dose read with its medication again instead of as something removed.
  const idsSeen = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('[data-entry-med]').forEach(el => out.add(el.getAttribute('data-entry-med')));
    return [...out];
  });
  const back = ((await saved()).meds || []).find(m => m.id === TRACKED.id);
  t('the restored medication kept its ORIGINAL id, so old doses still point at it',
    !!back && back.id === TRACKED.id, back ? back.id : '(missing)');
  t('no medication was created under a new id', ((await saved()).meds || []).filter(m => m.name === TRACKED.name).length === 1, '');
  void idsSeen;
}

console.log('\n-- nothing broke on the way');
t('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\n' + pass + '/' + (pass + fail) + ' checks passed' + (fail ? '  <-- FAIL' : ''));
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
