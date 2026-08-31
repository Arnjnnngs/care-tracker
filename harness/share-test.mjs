/**
 * share-test.mjs — a saved file says where it went, and sharing the tracker warns before it shares.
 *
 * Aaron, 2026-08-22: "I just tap it and it says how many records were saved, but where it was
 * saved. for either phone, it's going to be difficult to share to others if there are multiple
 * caregivers"
 *
 * Two defects and one gap:
 *   - the backup path threw away deliverFile()'s return value, so it never named a location, and
 *     then told EVERY user to "check it landed in your Files app" -- Apple's wording, on Android.
 *   - the three buttons were named after file formats, not after what each one is for.
 *   - there was no way to bring a second caregiver in, even though there is no login and every
 *     device on the URL already shares the same live records.
 *
 * The share button carries a risk that must never be shipped silently: no login means the link is
 * the password, permanently and irrevocably. SHARE-4 fails if that warning ever disappears.
 *
 * SAFETY: all three gstatic Firebase modules stubbed, service worker blocked, catch-all abort.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Playwright's location is environment-specific: the old sandbox kept it under a user-global npm
// prefix, this one ships it alongside node. Resolving a LIST of candidates instead of one pinned
// absolute path is what lets the same suite run in both. The pinned path made all 39 browser
// suites in these three repos unrunnable the moment the environment changed -- a gate that cannot
// start is indistinguishable from a gate that passes, which is the failure Rule 5 is about.
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
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i+1] : null; };
const APP_FILE = arg('--file') || path.join(HERE, '..', 'index.html');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const STUB_APP = `export function initializeApp(c){return{name:'[DEFAULT]',options:c};}`;
const STUB_MSG = `export function getMessaging(){throw new Error('off');}
export async function getToken(){return null;} export function onMessage(){return()=>{};}`;
const STUB_FS = `
const store={entries:[],prefs:{}};const eL=[],pL=[];let n=0;
function snap(l){return{docs:l.map(e=>({id:e.id,data:()=>{const c=Object.assign({},e);delete c.id;return c;}}))};}
globalThis.__mc={pushEntry(e){store.entries.push(Object.assign({id:'e'+(++n)},e));for(const cb of eL)cb(snap(store.entries));},
 entries(){return store.entries.map(e=>Object.assign({},e));}};
export function getFirestore(){return{__db:true};}
export function collection(){return{__kind:'col'};}
export function doc(db,col,id){return{__kind:'doc',id:id};}
export function query(){return{__kind:'q'};}
export function orderBy(){return{};}
export function onSnapshot(ref,cb){if(ref&&ref.__kind==='q'){eL.push(cb);cb(snap(store.entries));return()=>{};}
 pL.push(cb);cb({exists:()=>true,data:()=>store.prefs});return()=>{};}
export async function addDoc(c,d){store.entries.push(Object.assign({id:'a'+(++n)},d));for(const cb of eL)cb(snap(store.entries));return{id:'a'+n};}
export async function setDoc(){} export async function deleteDoc(){}
export async function getDocs(){return snap(store.entries);}
export function serverTimestamp(){return Date.now();}
`;

const rawHtml = fs.readFileSync(APP_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
const brief = (v) => JSON.stringify(v === null ? null : String(v).replace(/\s+/g,' ').slice(0, 240));
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

const escaped = [], errs = [];
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });

// `mode` decides which delivery route deliverFile() takes, so both messages can be checked:
//   'download' — no navigator.share at all, the Android/desktop path
//   'share'    — navigator.share present and resolving, the iPhone path
async function boot(mode) {
  const at = new Date(); at.setHours(14, 0, 0, 0);
  const i = rawHtml.indexOf('function simNow()');
  const brace = rawHtml.indexOf('{', i);
  let depth = 0, end = -1;
  for (let k = brace; k < rawHtml.length; k++) {
    if (rawHtml[k] === '{') depth++;
    else if (rawHtml[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  const html = rawHtml.slice(0, i) + 'function simNow() { return ' + at.getTime() + '; }' + rawHtml.slice(end + 1);
  const server = http.createServer((rq,rs)=>{ if(rq.url.startsWith('/index.html')){rs.writeHead(200,{'Content-Type':'text/html'});rs.end(html);return;} rs.writeHead(404);rs.end(); }).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const PORT = server.address().port;
  const ctx = await browser.newContext({ viewport:{width:375,height:812}, serviceWorkers:'block' });
  await ctx.route('**/*',(route)=>{ const u=route.request().url();
    if(u.includes('firebase-app.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_APP});
    if(u.includes('firebase-firestore.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_FS});
    if(u.includes('firebase-messaging.js')) return route.fulfill({status:200,contentType:'application/javascript',body:STUB_MSG});
    if(u.startsWith('http://127.0.0.1:'+PORT)) return route.continue();
    if(u.startsWith('https://fonts.')) return route.abort();
    escaped.push(u); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror',e=>errs.push(String(e)));
  await page.addInitScript((m) => {
    window.__shared = [];
    if (m === 'share') {
      // Record every share, but the checks below count only shares carrying a URL. deliverFile()
      // also uses navigator.share to hand over the backup FILE, and the first version of this file
      // counted that as a link share -- so SHARE-4 reported "something was shared before the button
      // was even pressed" about a file share from the previous check.
      navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); };
      window.__linkShares = () => window.__shared.filter(d => d && typeof d.url === 'string');
      navigator.canShare = () => true;
    } else {
      try { delete navigator.share; } catch (e) {}
      try { delete navigator.canShare; } catch (e) {}
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    }
  }, mode);
  await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1100);
  await page.evaluate((ts) => globalThis.__mc.pushEntry({ medId:'weight', weight:150, dose:'150 lbs', mg:0, ts }), at.getTime() - 3600000);
  await page.waitForTimeout(1200);
  const gotoReports = async () => {
    await page.evaluate(async () => {
      const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Reports'||x.textContent.trim()==='Reports');
      if(b) b.click(); await new Promise(r=>setTimeout(r,800));
    });
  };
  // v58 (Aaron: "all the backup stuff shouldn't live under reports. it should be under settings")
  // moved the backup button, its password switch and the share control into a new Settings screen.
  // Settings is a drawer destination, not a bottom-nav tab: renderBottomNav hardcodes a
  // five-column grid and a sixth item silently overflows it.
  const gotoSettings = async () => {
    await page.evaluate(async () => {
      const m = document.querySelector('[data-cal-menu-button]');
      if (m) m.click();
      await new Promise(r => setTimeout(r, 450));
      const s = document.querySelector('[data-cal-drawer-item="settings"]');
      if (s) { s.click(); await new Promise(r => setTimeout(r, 900)); }
      else { const c = document.querySelector('[data-cal-drawer-close]'); if (c) c.click(); await new Promise(r => setTimeout(r, 300)); }
    });
  };
  return { page, ctx, server, gotoReports, gotoSettings, close: async () => { await ctx.close(); server.close(); } };
}

const tapBackup = async (page) => {
  await page.evaluate(async () => {
    const b = document.querySelector('[data-backup-btn="backup"]');
    if (b) b.click();
    await new Promise(r => setTimeout(r, 1600));
  });
};
const noticeText = (page) => page.evaluate(() => {
  const n = document.querySelector('[data-backup-notice]');
  return n ? n.innerText : null;
});

console.log('\nSAVING AND SHARING — where a file went, and who else can see the records\n');

// ---------- the Android / download route ----------
{
  const b = await boot('download');
  await b.gotoReports();

  await run('SHARE-1-buttons-say-what-they-are-for',
    'every save button names its purpose, not its file format', async () => {
    const inReports = await b.page.evaluate(() =>
      [...document.querySelectorAll('[data-backup-btn]')].map(x => x.innerText.trim()));
    await b.gotoSettings();
    const inSettings = await b.page.evaluate(() =>
      [...document.querySelectorAll('[data-backup-btn]')].map(x => x.innerText.trim()));
    const all = inReports.concat(inSettings);
    assert(all.length === 3, 'expected three save buttons across the two screens, got ' + all.length + ': ' + brief(all));
    // Reports holds the two DOCUMENTS; Settings holds the one file that can be loaded back.
    assert(inReports.length === 2 && inSettings.length === 1,
      'the split is wrong — Reports has ' + inReports.length + ' and Settings has ' + inSettings.length + ': ' + brief(all));
    assert(inSettings.some(l => /backup/i.test(l)), 'nothing in Settings tells you which file can be put back: ' + brief(inSettings));
    assert(inReports.some(l => /send|print/i.test(l)), 'nothing in Reports tells you which file can be handed to a doctor: ' + brief(inReports));
    await b.gotoReports();
  });

  await run('SHARE-2-download-route-names-the-location',
    'on the download route the message says Downloads and names the file', async () => {
    await b.gotoSettings();
    await tapBackup(b.page);
    const n = await noticeText(b.page);
    assert(n, 'no confirmation appeared after saving a backup');
    assert(/downloads folder/i.test(n), 'the message never says where the file went: ' + brief(n));
    assert(/\.json/i.test(n), 'the message does not name the file: ' + brief(n));
    assert(!/Files app/i.test(n),
      'Android is still being told to check its "Files app", which it does not have: ' + brief(n));
  });
  await b.close();
}

// ---------- the iPhone / share-sheet route ----------
{
  const b = await boot('share');
  await b.gotoReports();
  await run('SHARE-3-share-route-says-save-to-files',
    'on the share-sheet route the message points at Save to Files instead', async () => {
    await b.gotoSettings();
    await tapBackup(b.page);
    const n = await noticeText(b.page);
    assert(n, 'no confirmation appeared after saving a backup');
    assert(/save to files/i.test(n), 'the iPhone message does not point at Save to Files: ' + brief(n));
    assert(!/downloads folder/i.test(n),
      'the iPhone is being told to look in a Downloads folder: ' + brief(n));
  });

  await run('SHARE-4-warns-before-it-shares',
    'sharing the tracker states that the link grants full, permanent access BEFORE the sheet opens', async () => {
    const before = await b.page.evaluate(() => window.__linkShares().length);
    assert(before === 0, 'something was shared before the button was even pressed');
    await b.page.evaluate(async () => {
      const btn = document.querySelector('[data-share-btn]');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 600));
    });
    const row = await b.page.evaluate(() => {
      const r = document.querySelector('[data-share-row]'); return r ? r.innerText : null; });
    assert(row, 'the share row is not on the page');
    assert(/full access/i.test(row) && /no password/i.test(row),
      'the no-login warning is missing — this button must never ship without it: ' + brief(row));
    const after = await b.page.evaluate(() => window.__linkShares().length);
    assert(after === 0, 'the share sheet opened before the warning was acknowledged');
  });

  await run('SHARE-5-then-shares-the-live-address',
    'confirming shares the tracker URL, so the other caregiver sees the same records', async () => {
    await b.page.evaluate(async () => {
      const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Send the link');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 700));
    });
    const shared = await b.page.evaluate(() => window.__linkShares());
    assert(shared.length === 1, 'expected exactly one share, got ' + shared.length);
    assert(typeof shared[0].url === 'string' && /^http/.test(shared[0].url),
      'no URL was shared: ' + brief(JSON.stringify(shared[0])));
    assert(!/\?/.test(shared[0].url), 'the shared link carries query junk: ' + shared[0].url);
  });

  await run('SHARE-6-cancel-shares-nothing',
    'backing out of the warning shares nothing at all', async () => {
    await b.page.evaluate(async () => {
      window.__shared.length = 0;
      const btn = document.querySelector('[data-share-btn]');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 500));
      const c = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Cancel');
      if (c) c.click();
      await new Promise(r => setTimeout(r, 500));
    });
    const shared = await b.page.evaluate(() => window.__linkShares().length);
    assert(shared === 0, 'cancelling still shared the link');
  });
  await b.close();
}

await run('SHARE-7-warning-is-unconditional',
  'the access warning is not behind a flag that could switch it off', () => {
  const seg = (rawHtml.match(/function renderShareRow[\s\S]*?\n\}/) || [''])[0];
  assert(seg, 'renderShareRow not found');
  assert(/Anyone with this link has full access/.test(seg), 'the warning text is gone');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1 and the stubs',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});
await run('NET-2','no page errors',()=>{ assert(errs.length===0, errs.slice(0,2).join(' | ')); });

await browser.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
