// LAYOUT AUDIT — does any text escape its box, at real iPhone widths, on EVERY screen?
//
// Aaron, 2026-08-29: "how is auditing being done if nothing can be seen to make sure everything
// looks right? ... on an iPhone, some wording spills outside the text box." The Zero Day Auditor
// said the same thing independently about app-v67: "Every gate in this release is data-layer;
// nothing tests a render path." Every check in this project asserted on bytes, entries and
// offsets. Not one had ever measured a pixel. A caregiver reading a clipped dose instruction is a
// real failure that every existing gate passes.
//
// A FIRST VERSION OF THIS SCANNED ONLY AN EMPTY HOME SCREEN AND REPORTED "CLEAN". That is the trap
// this project already has written down -- a screen check only covers the screens it happens to
// visit. Overflow needs LONG CONTENT to show, so this seeds the real medication names off Brandi's
// record ("Children's Liquid Tylenol", "Dexamethasone") and walks every tab.
//
// WHAT IT CANNOT DO, plainly: this is CHROMIUM at iPhone viewport sizes, not Safari. It catches a
// box too small for its content, which is most "text spills out" bugs. It does NOT catch
// WebKit-specific font metrics. A clean run narrows the search; it does not clear Safari.
//
// Run: env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy node harness/overflow-scan.mjs
//      --shots <dir>   write a screenshot per width per screen
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  const _p = require('node:path');
  const tries = ['playwright',
    _p.join(_p.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright'),
    '/opt/node22/lib/node_modules/playwright'];
  for (const c of tries) { try { return require(c); } catch (e) {} }
  throw new Error('playwright not found');
})();
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' is set.'); process.exit(3); }

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i+1] : null; };
const APP_FILE = arg('--file') || new URL('../index.html', import.meta.url).pathname;
const SHOTS = arg('--shots');
const errs = [], escaped = [];

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
// The stub records DELETES as well as writes. care-tracker's rules block a delete by document age,
// so a Remove implemented as deleteDoc would pass a UI check and silently fail on a real 3-day-old
// record. DELETE-COUNT below asserts none is ever attempted.
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;const deletes=[];
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={
  pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));},
  entries(){return store.entries.map(e=>Object.assign({},e));},
  deletes(){return deletes.slice();}
};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} 
export async function deleteDoc(ref){deletes.push(ref&&ref.id);}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;


const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// BOTH PLATFORMS. Aaron, 2026-08-29: "although I mentioned that the text overlay was on iPhone,
// this is being viewed on both iPhone and Android. so both matters." The first version of this
// scanned iPhone widths only, which made the gate it feeds half-blind -- and Brandi's caregiver is
// on a Samsung, so Android is not the secondary case here, it is the daily one.
//
// Worth knowing which way the fidelity runs: Chromium IS Android's engine, so these Android rows
// are close to what a Galaxy or Pixel actually renders. The iPhone rows are Chromium at Apple's
// viewport SIZES and are an approximation -- right about boxes too small for their content, silent
// about WebKit font metrics.
//
// 320 and 360 are the two that matter most: 320 is the iPhone SE/mini floor, and 360 is the single
// most common Android width in the world.
const DEVICES = [
  { name: 'iPhone SE (1st gen)',    w: 320, h: 568, os: 'iOS' },
  { name: 'Galaxy S/A (most common)', w: 360, h: 800, os: 'Android' },
  { name: 'iPhone SE 2/3, 8',       w: 375, h: 667, os: 'iOS' },
  { name: 'Galaxy S22/S23',         w: 384, h: 854, os: 'Android' },
  { name: 'iPhone 13/14',           w: 390, h: 844, os: 'iOS' },
  { name: 'Pixel 7/8',              w: 393, h: 873, os: 'Android' },
  { name: 'Pixel Pro, Galaxy S+',   w: 412, h: 915, os: 'Android' },
  { name: 'iPhone 14/15 Plus',      w: 428, h: 926, os: 'iOS' }
];

// Her real medication names, which are what actually stress the layout.
const now = Date.now();
const SEED = [
  { id: 's1', medId: 'children-s-liquid-tylenol', dose: '2 tsp (650 mg)', mg: 650, ts: now - 3600000 },
  { id: 's2', medId: 'dexamethasone', dose: '2 tablets', mg: 8, ts: now - 7200000 },
  { id: 's3', medId: 'lorazapem', dose: '0.5 mg', mg: 0.5, ts: now - 10800000 },
  { id: 's4', medId: 'compazine', dose: '10 mg', mg: 10, ts: now - 14400000 },
  { id: 's5', medId: 'morphine', dose: '15 mg', mg: 15, ts: now - 18000000 },
  { id: 's6', medId: 'temp', dose: '100.9 F', mg: 0, ts: now - 5400000, temp: 100.9 },
  { id: 's7', medId: 'weight', dose: '182 lbs', mg: 0, ts: now - 9000000, weight: 182 },
  { id: 's8', medId: 'paracentesis', dose: '4.5 L', mg: 0, ts: now - 86400000, liters: 4.5 },
  { id: 's9', medId: 'inpatient_start', dose: null, mg: 0, ts: now - 172800000 },
  { id: 's10', medId: 'chemo_date', dose: 'Chemo scheduled', mg: 0, ts: now - 259200000, loggedAt: now - 259200000 },
  { id: 's11', medId: 'symptom_nausea', dose: 'Sharp rib pain after the second dose, worse lying down', mg: 0, ts: now - 12600000 }
];

const SCREENS = ['home', 'meds', 'reports', 'inpatient', 'symptoms'];

// ONE scanner body, used by the tab loop and the overlay loop alike. It was duplicated at first
// and the copies drifted within minutes -- the overlay copy silently scanned nothing.
const scanFn = function (vw) {
  // WHAT "SPILLS ITS BOX" ACTUALLY MEANS, rewritten after the Zero Day Auditor deleted the nav-label
  // fix and this scan still said CLEAN. The old test was scrollWidth > clientWidth, which is ALWAYS 0
  // for an inline element -- i.e. for nearly every piece of text in this app -- plus "is it off the
  // viewport", which text overflowing a grid cell in the middle of the screen never is. It also
  // skipped every <select>, because a select has child <option>s and the "leaves only" filter threw
  // it out. It was blind to both defects it had been written to catch.
  //
  // The real question is whether an element sticks out of THE BOX IT IS IN. So: measure each element
  // against its parent's padding box. That catches a 65px label in a 58px grid cell, a select wider
  // than its column, and anything pushed past the edge of the screen, all with one rule.
  const out = [], seen = new Set();
  const isScrollable = cs => cs.overflowX === 'auto' || cs.overflowX === 'scroll';
  const consider = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const text = (el.textContent || '').trim();
    if (!text) return null;
    // Leaves, plus <select> — a select's options are children with text, which is exactly how the
    // previous version excused itself from looking at the control that broke the layout.
    const tag = el.tagName.toLowerCase();
    if (tag !== 'select' && [...el.children].some(c => (c.textContent || '').trim())) return null;
    return { cs, r, text, tag };
  };
  document.querySelectorAll('*').forEach(el => {
    const info = consider(el);
    if (!info) return;
    const { cs, r, text, tag } = info;
    const clipped = cs.textOverflow === 'ellipsis';   // deliberate truncation, not a defect
    let kind = null, overBy = 0;

    // A. THE TEXT is wider than the box it has to live in. Aaron's words are "some wording spills
    // outside the text box", so measure the wording, not the element. Comparing the element's RECT to
    // its parent flagged every oversized tap target in the app -- a 44x44 close button overhanging a
    // 39px header slot is deliberate iOS touch sizing, not a defect, and a gate that cries about those
    // is a gate nobody keeps. So: measure the rendered text with a Range and ask whether THAT fits.
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement && !clipped) {
      const pcs = getComputedStyle(parent);
      const parentClips = isScrollable(pcs) || pcs.overflow === 'auto' || pcs.overflow === 'scroll';
      if (!parentClips && cs.whiteSpace !== 'normal' || !parentClips) {
        const pr = parent.getBoundingClientRect();
        const padL = parseFloat(pcs.paddingLeft) || 0, padR = parseFloat(pcs.paddingRight) || 0;
        const innerW = (pr.width - padL - padR);
        let textW = 0;
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()];
          textW = rects.length ? Math.max(...rects.map(q => q.width)) : 0;
        } catch (e) { textW = 0; }
        // Also account for the element's own horizontal padding/border: the text has to fit inside
        // the parent along with them.
        const own = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        const need = textW + own;
        // 1.5px, not 1: sub-pixel layout rounding produces sub-pixel "overflow" that is not real.
        if (textW > 0 && innerW > 0 && need - innerW > 1.5) {
          kind = 'the wording is wider than the box it sits in';
          overBy = Math.round(need - innerW);
        }
      }
    }
    // B. Its own content does not fit (block elements, scrollable content).
    if (!kind && !isScrollable(cs) && !clipped && el.scrollWidth - el.clientWidth > 1) {
      kind = 'content wider than its box'; overBy = el.scrollWidth - el.clientWidth;
    }
    // C. Past the edge of the screen.
    if (!kind && r.right > vw + 1) { kind = 'off the right edge'; overBy = Math.round(r.right - vw); }
    if (!kind && r.left < -1) { kind = 'off the left edge'; overBy = Math.round(-r.left); }
    if (!kind) return;

    const label = text.slice(0, 64).replace(/\s+/g, ' ');
    const key = label + '|' + Math.round(r.top) + '|' + kind;
    if (seen.has(key)) return; seen.add(key);
    out.push({ text: label, tag, kind, overBy,
      box: Math.round(r.width) + 'x' + Math.round(r.height), ws: cs.whiteSpace });
  });
  return out;
};

let problems = 0, unreachable = 0;
const report = [];

for (const dev of DEVICES) {
  const server = http.createServer((rq, rs) => {
    if (rq.url.startsWith('/index.html')) { rs.writeHead(200, {'Content-Type':'text/html'}); rs.end(rawHtml); return; }
    rs.writeHead(404); rs.end();
  }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, serviceWorkers: 'block'
  });
  await ctx.route('**/*', route => { const u = route.request().url();
    if (u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if (u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
    if (u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if (u.startsWith('http://127.0.0.1:' + PORT)) return route.continue();
    if (u.startsWith('https://fonts.')) return route.abort();
    escaped.push(u); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(rows => rows.forEach(r => globalThis.__mc.pushEntry(r)), SEED);
  await page.waitForTimeout(1200);

  // THE MEDICATION EDITOR IS A SCREEN TOO, and it is where settings get typed. It was missed by the
  // first version of this scan, which walked only the five tabs -- so a release that CHANGED the
  // editor would have passed a render gate that never rendered it. Same blind spot, one level in.
  const EXTRA = [{ name: 'med-editor', open: async page => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => ((x.getAttribute('aria-label') || x.innerText || '').trim().toLowerCase()) === 'meds');
      if (b) b.click();
    });
    await page.waitForTimeout(900);
    return page.evaluate(() => {
      // The edit controls are icon buttons labelled by aria-label ("Edit Dexamethasone"), not by
      // text. Matching innerText found nothing and the editor was never scanned. Dexamethasone by
      // preference: it is the medication that carries the new treatment-window fields.
      const btns = [...document.querySelectorAll('button')];
      const label = b => (b.getAttribute('aria-label') || '').trim();
      const b = btns.find(x => /^edit dexamethasone$/i.test(label(x))) || btns.find(x => /^edit /i.test(label(x)));
      if (b) { b.click(); return true; }
      return false;
    });
  } }];

  for (const screen of SCREENS) {
    // CLICK THE REAL NAV BUTTON. The first version called navigateTo() inside page.evaluate, wrapped
    // in a try/catch. The app is a MODULE, so navigateTo and state are not on window: every call
    // threw ReferenceError, the catch swallowed it, and the scan never left Home -- while reporting
    // that it had walked five screens. I "verified" navigation by comparing screenshot checksums,
    // which differed only because the on-screen clock ticks. A gate that cannot fail is bad; a gate
    // that reports covering ground it never touched is worse, and I shipped that claim to Aaron.
    // Clicking the actual button also tests the real interaction rather than an internal function.
    const navigated = await page.evaluate(async label => {
      const want = label.toLowerCase();
      const find = () => [...document.querySelectorAll('button')].find(b => {
        const t = ((b.getAttribute('aria-label') || b.innerText || '')).trim().toLowerCase();
        return t === want || t === want.replace('inpatient', 'in-patient');
      });
      const btn = find();
      if (!btn) return false;
      btn.click();
      await new Promise(r => setTimeout(r, 600));
      // PROVE THE VIEW CHANGED, do not just prove a button was clicked. The previous version returned
      // true unconditionally; in ChemoWell the Zero Day Auditor made three of five tabs completely
      // dead and the scan still reported every combination clean. Same trap this file's own header
      // describes for navigateTo(), one level down. The app marks the live tab aria-current="page",
      // so that is the receipt to demand.
      const live = find();
      return !!(live && live.getAttribute('aria-current') === 'page');
    }, screen);
    if (!navigated) {
      console.log('  COULD NOT REACH ' + screen.toUpperCase() + ' at ' + dev.w + 'px — not scanned');
      unreachable++;
      continue;
    }
    await page.waitForTimeout(900);

    // THE WHOLE-PAGE WIDTH, checked before the per-element scan — because under mobile emulation the
    // per-element scan CANNOT see this class. If content refuses to fit, Chromium widens the layout
    // viewport instead of overflowing; every element then "fits" its now-wider page and the scan
    // reports clean while the real phone side-scrolls. Found in ChemoWell, where a <select> sized to
    // its longest option forced a 379px minimum and eight widths came back clean anyway. This file
    // had the same blind spot and care-tracker happened not to be triggering it.
    const layout = await page.evaluate(() => ({ inner: window.innerWidth, doc: document.documentElement.scrollWidth }));
    if (layout.inner > dev.w + 1 || layout.doc > layout.inner + 1) {
      problems++;
      report.push({ dev: dev.name, os: dev.os, w: dev.w, screen, found: [{
        text: 'THE PAGE ITSELF IS WIDER THAN THE PHONE', tag: 'document',
        kind: 'app needs ' + Math.max(layout.inner, layout.doc) + 'px on a ' + dev.w + 'px screen — it will scroll sideways',
        overBy: Math.max(layout.inner, layout.doc) - dev.w, box: layout.doc + 'x-', ws: 'n/a' }] });
    }

    const found = await page.evaluate(scanFn, Math.max(dev.w, layout.inner));

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, dev.w + '-' + screen + '.png'), fullPage: true });
    }
    if (found.length) {
      problems += found.length;
      report.push({ dev: dev.name, os: dev.os, w: dev.w, screen, found });
    }
  }
  // then the overlay screens
  for (const extra of EXTRA) {
    let opened = await extra.open(page);
    if (opened) {
      await page.waitForTimeout(600);
      // A click is not a screen: the editor must actually be on screen. Its Save control is the
      // marker that exists only while it is open.
      opened = await page.evaluate(() => [...document.querySelectorAll('button')]
        .some(b => /^(save|save changes|add medication)$/i.test((b.innerText || '').trim())));
    }
    if (!opened) {
      console.log('  COULD NOT OPEN ' + extra.name + ' at ' + dev.w + 'px — not scanned');
      unreachable++;
      continue;
    }
    await page.waitForTimeout(800);
    const layoutX = await page.evaluate(() => ({ inner: window.innerWidth, doc: document.documentElement.scrollWidth }));
    if (layoutX.inner > dev.w + 1 || layoutX.doc > layoutX.inner + 1) {
      problems++;
      report.push({ dev: dev.name, os: dev.os, w: dev.w, screen: extra.name, found: [{
        text: 'THE PAGE ITSELF IS WIDER THAN THE PHONE', tag: 'document',
        kind: 'app needs ' + Math.max(layoutX.inner, layoutX.doc) + 'px on a ' + dev.w + 'px screen — it will scroll sideways',
        overBy: Math.max(layoutX.inner, layoutX.doc) - dev.w, box: layoutX.doc + 'x-', ws: 'n/a' }] });
    }
    const found = await page.evaluate(scanFn, Math.max(dev.w, layoutX.inner));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, dev.w + '-' + extra.name + '.png') });
    }
    if (found.length) { problems += found.length; report.push({ dev: dev.name, os: dev.os, w: dev.w, screen: extra.name, found }); }
  }

  await ctx.close();
  server.close();
}
await browser.close();

if (report.length) {
  report.forEach(r => {
    console.log('\n  ' + r.os + '  ' + r.dev + ' (' + r.w + 'px) — ' + r.screen.toUpperCase() + ' — ' + r.found.length + ' problem(s)');
    r.found.slice(0, 10).forEach(f => {
      console.log('      "' + f.text + '"');
      console.log('        <' + f.tag + '> ' + f.kind + ' by ' + f.overBy + 'px · box ' + f.box + ' · white-space:' + f.ws);
    });
    if (r.found.length > 10) console.log('      ... and ' + (r.found.length - 10) + ' more');
  });
} else {
  console.log('  every screen clean at all ' + DEVICES.length + ' device widths (iOS and Android)');
}
if (errs.length) console.log('\n  PAGE ERRORS: ' + errs.length + '\n    ' + errs.slice(0,3).join('\n    '));
console.log('\n' + (DEVICES.length * SCREENS.length) + ' screen/width combinations, ' + problems + ' overflowing element(s).');
if (unreachable) {
  // A screen the scan could not reach is NOT a clean screen. Reporting it as one is how a render
  // gate ends up blessing a page nobody ever rendered -- which is exactly what happened here first.
  console.log(unreachable + ' screen/width combination(s) COULD NOT BE REACHED and were not scanned.');
  console.log('NOT CLEAN — an unreachable screen is an unchecked screen.');
  process.exit(1);
}
console.log(problems ? 'NOT CLEAN' : 'CLEAN — Android rows are high fidelity (Chromium is Android\'s engine); iOS rows are Chromium at Apple viewport sizes, not Safari.');
process.exit(problems ? 1 : 0);
