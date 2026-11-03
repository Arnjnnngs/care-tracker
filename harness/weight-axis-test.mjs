// weight-axis-test.mjs -- v79 (PRODUCTION). The weight chart's x-axis repeated dates and ran
// into the future. The same file as chemowell-beta's, byte for byte below this header: the fix
// is shared, so the suite is shared, and a difference between the two files would be a defect
// in itself rather than a local adaptation. It reached here third -- ChemoWell app-v90, then
// staging, then this app, which is the one on her phone.
//
// THE FIREBASE STUB IS NOT OPTIONAL HERE. This repo's app writes to `caretracker_entries`,
// which is her real medical history. Every firebase module is intercepted and replaced with an
// in-memory store, and every other request is aborted, so nothing in this suite can reach
// Firestore even by accident. Hard rule: never run QA against the real collection.
//
// THE TWO HALVES OF THE DEFECT, as a caregiver sees them:
//   1. One weight logged this morning drew an axis whose right-hand edge was TOMORROW, because
//      tMax was floored at `tMin + DAY` rather than clamped to now.
//   2. Labels were always M/D, evenly spaced, so a span of hours printed the same calendar date
//      under five ticks: "10/31 10/31 10/31 11/1 11/1".
//
// WHY THIS SUITE FREEZES THE CLOCK, AND WHY THAT IS THE IMPROVEMENT ON THE PRODUCT APP'S SUITE.
// The product app's 162-check suite runs against the WALL clock and moves the app's date in whole
// days through a test hook. That cost three audit rounds: one section was true only after 09:00
// local, so for nine hours a day it went red on correct code -- and it was the only section that
// killed one of the mutants. This file overrides `window.Date` instead, exactly as
// `warning-priority-test.mjs` does, so every fixture states the hour it means and nothing here
// depends on when it is run.
//
// IT ALSO REACHES A CASE THE PRODUCT SUITE CANNOT (BACKLOG M31 over there). `sameDay` is decided
// with setHours, i.e. in LOCAL time. An implementation using setUTCHours passes every fixture
// whose span sits inside one UTC day. Section 7 freezes the clock at 00:30 with a reading at 23:00
// the previous evening: under TZ=America/Chicago that span crosses local midnight and NOT UTC
// midnight, so a UTC implementation prints times where dates are needed. Run it in that zone --
// the file says so in the section, and the runner prints the zone it ran under.
//
// Run:  node harness/weight-axis-test.mjs [--file <index.html>]
//       TZ=America/Chicago node harness/weight-axis-test.mjs      <- section 7 discriminates here
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
for (const v of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const html = fs.readFileSync(APP_FILE, 'utf8');
const ZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || '(system)';
let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  |  ' + detail : ''));
  cond ? pass++ : fail++;
};
const DAY = 86400000, HOUR = 3600000, MIN = 60000;

// The clock each section runs at. Stated per section, never inherited from the wall clock.
const atToday = (h, m) => { const d = new Date(); d.setHours(h, m || 0, 0, 0); return d.getTime(); };

const mkStub = (seed) => `
const store={entries:${JSON.stringify(seed)},prefs:{}};const eL=[],pL=[];let n=0;
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
const VER = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1] || '';
const thrown = [];

// A weight reading, in the shape the app stores one.
const wt = (ts, lb) => ({ id: 'w' + ts, medId: 'weight', kind: 'vital', ts: ts, weight: lb });

// ONE PAGE PER SECTION, each with its own seeded store and its own frozen clock, so nothing
// inherits the entries or the range toggle of the section before it.
const axisAt = async (frozen, seed, months) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await c.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_APP });
    if (u.includes('firebase-firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: mkStub(seed) });
    if (u.includes('firebase-messaging.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB_MSG });
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    return route.abort();
  });
  const p = await c.newPage();
  p.on('pageerror', err => thrown.push(String(err)));
  await p.addInitScript(({ v, fz }) => {
    try { localStorage.setItem('caretracker-seen-version', v); } catch (err) {}
    const R = Date;
    const D = function (...a) { return a.length ? new R(...a) : new R(fz); };
    D.now = () => fz; D.parse = R.parse; D.UTC = R.UTC; D.prototype = R.prototype;
    window.Date = D;
  }, { v: VER, fz: frozen });
  await p.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  // THE REAL ROUTE A CAREGIVER TAKES, by the app's own data hooks and never by a control's visible
  // text (Rule 5 forbids text selectors by name). Menu button -> the Reports row in the drawer ->
  // the Weight card. If any step is missing the next selector throws and the section fails loudly;
  // nothing here falls back to poking state, because a test that reaches the screen by a route no
  // caregiver has is testing a screen nobody sees.
  await p.click('[data-cal-menu-button]');
  await p.waitForTimeout(350);
  await p.click('[data-cal-drawer-item="reports"]');
  await p.waitForTimeout(450);
  await p.click('[data-report="weight"]');
  await p.waitForTimeout(700);
  if (months) { await p.click('[data-weight-range="months"]'); await p.waitForTimeout(600); }
  const r = await p.evaluate(() => {
    const texts = [...document.querySelectorAll('svg text[data-xaxis="1"]')];
    if (!texts.length) return { labels: [], xs: [], cxs: [], boxes: [], vbWidth: 0, svgs: document.querySelectorAll('svg').length };
    const svg = texts[0].ownerSVGElement;
    const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    return {
      labels: texts.map(n => (n.textContent || '').trim()),
      xs: texts.map(n => Number(n.getAttribute('x'))),
      cxs: [...svg.querySelectorAll('circle')].map(n => Number(n.getAttribute('cx'))),
      boxes: texts.map(n => { try { const b = n.getBBox(); return [b.x, b.x + b.width]; } catch (e) { return null; } }),
      vbWidth: vb.length === 4 ? vb[2] : 0,
      svgs: document.querySelectorAll('svg').length
    };
  });
  await c.close();
  return r;
};

// Every section runs these. The product app's suite shipped for three audit rounds reading label
// TEXT and never label POSITION, although every label already carried its x.
const positions = (tag, r) => {
  const xs = (r.xs || []).filter(Number.isFinite);
  t(tag + '.p1  every label has a real x inside the drawing',
    xs.length > 0 && r.vbWidth > 0 && xs.every(v => v >= 0 && v <= r.vbWidth),
    'viewBox width ' + r.vbWidth + ', xs ' + JSON.stringify(xs));
  t(tag + '.p2  and they run left to right, never backwards or on top of each other',
    xs.length > 0 && xs.every((v, i) => i === 0 || v > xs[i - 1]), JSON.stringify(xs));
  // A label shifted a whole tick sideways is still increasing and still inside. What it is not is
  // anchored to the data, and the earliest reading's own dot is where the axis begins.
  const cxs = (r.cxs || []).filter(Number.isFinite);
  t(tag + '.p3  the first label sits exactly on the earliest reading',
    xs.length > 0 && cxs.length > 0 && Math.abs(xs[0] - Math.min.apply(null, cxs)) <= 0.11,
    'first label at ' + xs[0] + ', earliest reading at ' + (cxs.length ? Math.min.apply(null, cxs) : 'none'));
  const boxes = (r.boxes || []).filter(Boolean);
  t(tag + '.p4  and no label is DRAWN outside the chart, box and all',
    boxes.length === xs.length && r.vbWidth > 0 && boxes.every(b => b[0] >= 0 && b[1] <= r.vbWidth),
    'viewBox 0..' + r.vbWidth + ', boxes ' + JSON.stringify(boxes.map(b => [Math.round(b[0] * 10) / 10, Math.round(b[1] * 10) / 10])));
};

// Only where every tick is guaranteed a distinct label. TWO assertions, because evenness alone is
// blind to a proportional thinning: dropping EVERY OTHER label leaves the gaps equal, twice as
// wide, and invisible to an equality test. That mutant scored 149/151 against the product app's
// suite before the count floor was added.
const fullyLabelled = (tag, r) => {
  const xs = (r.xs || []).filter(Number.isFinite);
  t(tag + '.f1  every tick carries a label -- none dropped from the middle',
    xs.length >= 3 && xs.slice(1).every((v, i) => Math.abs((v - xs[i]) - (xs[1] - xs[0])) <= 0.3),
    'gaps ' + JSON.stringify(xs.slice(1).map((v, i) => Math.round((v - xs[i]) * 10) / 10)));
  t(tag + '.f2  and there are as many labels as the axis has ticks, not half of them',
    xs.length >= 5, xs.length + ' labels at ' + JSON.stringify(xs));
};

const isTime = (L) => /^\d{1,2}(:\d{2})?\s*(AM|PM)$/i.test(L);
const isDate = (L) => /^\d{1,2}\/\d{1,2}$/.test(L);
const distinct = (a) => new Set(a).size === a.length;

console.log('weight-axis-test  ' + APP_FILE + '  TZ=' + ZONE + '  (' + VER + ')');

// --- 1. ONE READING THIS MORNING. The future half of the defect, exactly as reported: the old
//        floor drew the right-hand edge 24 hours after the reading and labelled it tomorrow.
console.log('\n=== 1. One reading at 09:00, clock frozen at 14:00');
{
  const now = atToday(14, 0);
  const r = await axisAt(now, [wt(atToday(9, 0), 160)]);
  t('1.0  precondition: the chart rendered an axis', r.labels.length >= 2,
    'labels=' + JSON.stringify(r.labels) + ' svgs=' + r.svgs);
  t('1.1  the labels are TIMES, not one date printed five times',
    r.labels.length >= 2 && r.labels.every(isTime), JSON.stringify(r.labels));
  t('1.2  and they are all distinct', distinct(r.labels), JSON.stringify(r.labels));
  t('1.3  nothing on the axis is later than the frozen now',
    r.labels.every(L => {
      const m = L.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i); if (!m) return false;
      let hh = Number(m[1]) % 12; if (/pm/i.test(m[3])) hh += 12;
      return atToday(hh, Number(m[2] || 0)) <= now + MIN;
    }), JSON.stringify(r.labels));
  positions('1', r); fullyLabelled('1', r);
}

// --- 2. THREE READINGS INSIDE ONE HOUR. Under three hours the hour alone repeats, so the minute
//        has to be printed.
//
//        AND THE CLOCK IS SET TO THE EVENING ON PURPOSE, which is the only reason this section
//        catches the padding. The widest label the axis can draw is a two-digit hour with minutes
//        and a meridiem -- "10:36 PM", 29 units in this 11px monospace against 18 for a date --
//        and the rightmost label is CENTRED on the right edge, so it is the one that gets clipped.
//        A morning fixture ending at "9:10 AM" is a narrower label and leaves the margin untested:
//        with pad.right back at 20, the morning version of this section passed and the evening one
//        fails by 3.2 units. The worst case is the only case worth measuring a margin against.
console.log('\n=== 2. Three readings 21:30-22:20, clock frozen at 22:36 (the widest label there is)');
{
  const r = await axisAt(atToday(22, 36), [wt(atToday(21, 30), 160), wt(atToday(21, 50), 161), wt(atToday(22, 20), 160.5)]);
  t('2.0  precondition: the chart rendered an axis', r.labels.length >= 2, JSON.stringify(r.labels));
  t('2.1  a span inside one hour is labelled with minutes, not bare hours',
    r.labels.length >= 2 && r.labels.every(L => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(L)), JSON.stringify(r.labels));
  t('2.2  and they are all distinct', distinct(r.labels), JSON.stringify(r.labels));
  positions('2', r); fullyLabelled('2', r);
}

// --- 3. A SPAN THAT CROSSES MIDNIGHT. A time is only unambiguous inside one calendar day: a chart
//        from yesterday morning to this morning labelled with times reads "9 AM ... 9 AM", the
//        same label twice, 24 hours apart. The first version of this rule keyed on span LENGTH and
//        got exactly that wrong.
console.log('\n=== 3. Yesterday 09:00 to today 09:00, clock frozen at 10:00');
{
  const r = await axisAt(atToday(10, 0), [wt(atToday(9, 0) - DAY, 158), wt(atToday(9, 0), 160)]);
  t('3.0  precondition: the chart rendered an axis', r.labels.length >= 2, JSON.stringify(r.labels));
  t('3.1  a span across midnight is labelled with DATES', r.labels.every(isDate), JSON.stringify(r.labels));
  t('3.2  and no date is printed twice', distinct(r.labels), JSON.stringify(r.labels));
  positions('3', r);   // NOT fullyLabelled: two days under five ticks is meant to collapse.
}

// --- 4. THE NEWEST READING IS DAYS OLD. This is the case that caught a FALSE RELEASE NOTE in the
//        product app: every fixture there ended at roughly now, so nothing could tell "the axis
//        stops at the last reading" from "the axis runs on to today". They are different, and the
//        axis does the second one -- up to the one-day cap.
console.log('\n=== 4. Readings 9 and 5 days ago, clock frozen at 12:00');
{
  const tLast = atToday(9, 0) - 5 * DAY;
  const r = await axisAt(atToday(12, 0), [wt(atToday(9, 0) - 9 * DAY, 155), wt(tLast, 158)]);
  const wantLast = (new Date(tLast).getMonth() + 1) + '/' + new Date(tLast).getDate();
  t('4.0  precondition: the chart rendered an axis', r.labels.length >= 2, JSON.stringify(r.labels));
  const cxs = (r.cxs || []).filter(Number.isFinite);
  t('4.1  the last label sits on the newest reading, not days past it',
    r.xs.length > 0 && cxs.length > 0 && Math.abs(r.xs[r.xs.length - 1] - Math.max.apply(null, cxs)) <= 0.11,
    'last label at ' + r.xs[r.xs.length - 1] + ', newest reading at ' + (cxs.length ? Math.max.apply(null, cxs) : 'none'));
  t('4.2  and it reads that reading’s date in M/D, not today’s',
    r.labels[r.labels.length - 1] === wantLast,
    'last label ' + JSON.stringify(r.labels[r.labels.length - 1]) + ', want ' + JSON.stringify(wantLast));
  t('4.3  distinct dates', distinct(r.labels) && r.labels.every(isDate), JSON.stringify(r.labels));
  positions('4', r); fullyLabelled('4', r);
}

// --- 5. FOUR WEEKS, the ordinary Weeks view.
console.log('\n=== 5. A reading a week for four weeks, clock frozen at 12:00');
{
  const seed = [0, 7, 14, 21, 27].map((d, i) => wt(atToday(9, 0) - (27 - d) * DAY, 160 + i));
  const r = await axisAt(atToday(12, 0), seed);
  t('5.0  precondition: the chart rendered an axis', r.labels.length >= 3, JSON.stringify(r.labels));
  t('5.1  dates, all distinct', r.labels.every(isDate) && distinct(r.labels), JSON.stringify(r.labels));
  positions('5', r); fullyLabelled('5', r);
}

// --- 6. THE MONTHS TOGGLE. It asks for six intervals rather than four, and a label count hard-
//        coded to one of them would never be noticed from the Weeks view alone.
console.log('\n=== 6. The same readings under Months');
{
  const seed = [0, 7, 14, 21, 27].map((d, i) => wt(atToday(9, 0) - (27 - d) * DAY, 160 + i));
  const weeks = await axisAt(atToday(12, 0), seed, false);
  const months = await axisAt(atToday(12, 0), seed, true);
  t('6.0  precondition: both views rendered', weeks.labels.length >= 3 && months.labels.length >= 3,
    'weeks ' + JSON.stringify(weeks.labels) + ' months ' + JSON.stringify(months.labels));
  t('6.1  Months asks for more ticks than Weeks, and gets them',
    months.xs.length > weeks.xs.length,
    'weeks ' + weeks.xs.length + ' ' + JSON.stringify(weeks.labels) + ' vs months ' + months.xs.length + ' ' + JSON.stringify(months.labels));
  positions('6', months); fullyLabelled('6', months);
}

// --- 7. LOCAL MIDNIGHT, NOT UTC MIDNIGHT. `sameDay` uses setHours, so it asks whether the span
//        crosses the caregiver's midnight. An implementation using setUTCHours answers a different
//        question, and passes every fixture whose span happens to sit inside one UTC day.
//        Frozen at 00:30 with a reading at 23:00 the previous evening: in a zone behind UTC --
//        America/Chicago -- that span is two local days and ONE UTC day, so a UTC implementation
//        prints "11 PM, 12 AM" where the axis must print two dates. In a UTC container the two
//        implementations are identical and this section is a plain cross-midnight case; that is
//        said out loud rather than left to look like coverage it is not.
console.log('\n=== 7. 23:00 yesterday to 00:30 today -- local midnight, not UTC midnight');
{
  const r = await axisAt(atToday(0, 30), [wt(atToday(23, 0) - DAY, 159), wt(atToday(0, 10), 160)]);
  t('7.0  precondition: the chart rendered an axis', r.labels.length >= 2, JSON.stringify(r.labels));
  t('7.1  a span across LOCAL midnight is labelled with dates',
    r.labels.length >= 2 && r.labels.every(isDate), JSON.stringify(r.labels) + '  TZ=' + ZONE);
  t('7.2  and no date is printed twice', distinct(r.labels), JSON.stringify(r.labels));
  positions('7', r);
}

// --- 8. THE UNBOUNDED FALLBACK. When every reading is older than the window, the chart falls back
//        to the last two readings with NO bound on how far apart they are. M/D carries no year, so
//        two readings 730 days apart would render "7/25, 1/24, 7/25" -- and at 365 days the global
//        de-duplication did not merely leave an ambiguous label, it DROPPED the tick sitting under
//        the most recent reading. Past ~300 days the year is printed.
console.log('\n=== 8. Two readings 340 days apart, both outside the 28-day window');
{
  const r = await axisAt(atToday(12, 0), [wt(atToday(9, 0) - 400 * DAY, 150), wt(atToday(9, 0) - 60 * DAY, 158)]);
  t('8.0  precondition: the fallback rendered a chart from two out-of-window readings',
    r.labels.length >= 3, JSON.stringify(r.labels));
  t('8.1  every label carries a two-digit year, so no two can be confused across one',
    r.labels.length >= 3 && r.labels.every(L => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(L)), JSON.stringify(r.labels));
  t('8.2  and the tick under the newest reading still has its label',
    distinct(r.labels), JSON.stringify(r.labels));
  positions('8', r); fullyLabelled('8', r);
}

console.log('\n=== 9. Nothing threw');
t('9.1  no uncaught page error in any section', thrown.length === 0, thrown.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log('\n' + (pass + fail) + ' checks: ' + pass + ' passed, ' + fail + ' failed   (TZ=' + ZONE + ')');
process.exit(fail ? 1 : 0);
