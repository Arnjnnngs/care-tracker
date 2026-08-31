/**
 * swfresh-test.mjs — reproduces Aaron's "don't see changes on caretracker", then proves the fix.
 *
 * HIS REPORT, 2026-08-21: v52 was live and correct on the server. His phone showed v51. He had no
 * way to tell the difference, and this was at least the fourth release it had happened on.
 *
 * THE REPRODUCTION, which is the whole point of this file:
 *   1. serve build A, load it, wait for the service worker to take control
 *   2. change what the server serves to build B -- exactly what a git push does
 *   3. reload ONCE, the way a person opening the app does
 *   4. assert build B is on screen
 * Under the old cache-first worker step 4 fails, because the shell is answered from cache and the
 * new build is never requested. That is the bug, and CACHE-2 below is red on the old sw.js.
 *
 * SAFETY: no Firebase, no network beyond 127.0.0.1. The app is served with its module script
 * stripped down to a version marker -- this file tests the SERVICE WORKER, not the app.
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
const SW_FILE = arg('--sw') || path.join(HERE, '..', 'sw.js');
for (const v of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy'])
  if (process.env[v]) { console.error('REFUSING: ' + v + ' set.'); process.exit(3); }

const swSrc = fs.readFileSync(SW_FILE, 'utf-8');
const R = [];
const assert = (c,m) => { if(!c) throw new Error(m); };
async function run(n,d,fn){ try{ await fn(); R.push(1); console.log('  PASS  '+n+' — '+d);}catch(e){ R.push(0); console.log('  FAIL  '+n+' — '+d+'\n          '+e.message);} }

// A minimal shell that registers the REAL sw.js and prints which build it is.
const shell = (tag) => `<!doctype html><html><head><title>shell</title></head><body>
<h1 id="build">${tag}</h1>
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update().catch(()=>{})).catch(()=>{});
}
</script></body></html>`;

let served = 'BUILD-A';
const escaped = [];
const server = http.createServer((rq, rs) => {
  const u = rq.url.split('?')[0];
  if (u === '/sw.js') { rs.writeHead(200, {'Content-Type':'application/javascript','Cache-Control':'max-age=600'}); rs.end(swSrc); return; }
  if (u === '/' || u === '/index.html') { rs.writeHead(200, {'Content-Type':'text/html','Cache-Control':'max-age=600'}); rs.end(shell(served)); return; }
  if (u === '/manifest.webmanifest') { rs.writeHead(200, {'Content-Type':'application/manifest+json'}); rs.end('{"name":"t"}'); return; }
  if (u === '/icon-192.png' || u === '/icon-512.png') { rs.writeHead(200, {'Content-Type':'image/png'}); rs.end(Buffer.alloc(8)); return; }
  rs.writeHead(404); rs.end();
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT + '/';

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', args:['--no-sandbox'] });
const ctx = await browser.newContext();
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  escaped.push(u); return route.abort();
});
const page = await ctx.newPage();
const buildOnScreen = () => page.evaluate(() => document.getElementById('build') ? document.getElementById('build').textContent : '(none)');

console.log('\nBUILD FRESHNESS — a pushed build must reach the phone on the next load\n');

await run('CACHE-1-worker-takes-control',
  'the service worker installs and controls the page', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  assert(await buildOnScreen() === 'BUILD-A', 'the first build did not render');
});

await run('CACHE-2-a-new-build-lands-on-the-next-load',
  'after the server changes, ONE ordinary reload shows the new build', async () => {
  served = 'BUILD-B';                       // this is what a git push does
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const shown = await buildOnScreen();
  assert(shown === 'BUILD-B',
    'the phone is still showing ' + shown + ' after the server moved to BUILD-B — this is exactly Aaron\'s report');
});

await run('CACHE-3-still-works-offline',
  'with the network gone, the last seen build is still served from cache', async () => {
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(900);
  const shown = await buildOnScreen();
  await ctx.setOffline(false);
  assert(shown === 'BUILD-B',
    'offline fallback served ' + shown + ' — it must serve the most recent build seen, not the first one installed');
});

await run('CACHE-4-back-online-picks-up-the-next-build',
  'a third build after an offline spell still lands immediately', async () => {
  served = 'BUILD-C';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  assert(await buildOnScreen() === 'BUILD-C', 'a build pushed after an offline period did not land');
});

await run('CACHE-5-icons-stay-cache-first',
  'non-shell assets are still answered from cache, so offline is cheap', () => {
  assert(/caches\.match\(e\.request\)\.then\(r => r \|\| fetch\(e\.request\)\)/.test(swSrc),
    'the cache-first path for icons and the manifest was removed');
});
await run('CACHE-6-never-caches-a-failure',
  'a non-OK response is never written to the cache', () => {
  assert(/res\.ok/.test(swSrc), 'a 404 or error page could be cached as the offline shell');
});
await run('NET-1','nothing reached the network beyond 127.0.0.1',()=>{
  assert(escaped.length===0,'escaped: '+escaped.slice(0,3).join(', '));});

await browser.close(); server.close();
const p=R.reduce((a,b)=>a+b,0);
console.log('\n'+p+'/'+R.length+' checks passed');
process.exit(p===R.length?0:1);
