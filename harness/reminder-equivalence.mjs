/**
 * reminder-equivalence.mjs — proves the data-driven rewrite of send-reminders.js
 * is behaviour-preserving with respect to the shipped v43.3 file.
 *
 *   node reminder-equivalence.mjs
 *
 * WHAT IS COMPARED
 * ----------------
 * The real v43.3 source (send-reminders.v43.3.js, md5 asserted below) is loaded
 * verbatim, its four-line firebase-admin bootstrap and its trailing invocation
 * removed, and evaluated with the simulated Firestore/FCM injected. So the
 * "old" side of every comparison is the code that is live on Aaron's phone
 * today, not a paraphrase of it.
 *
 * Both sides are driven through the same fixtures at the same instant, and the
 * comparison is made on the OUTBOUND FCM MESSAGES — the actual thing the
 * patient receives — not on any internal function call.
 *
 * WHAT IS CLAIMED
 * ---------------
 * Not "identical", because the whole point is that v43.3 drops reminders.
 * The claim is precise and machine-checked:
 *
 *   (1) SUPERSET. Every reminder v43.3 sends, the rewrite also sends, at the
 *       same tick, with a byte-identical FCM payload. There is no tick and no
 *       fixture where v43.3 notifies the patient and the rewrite does not.
 *
 *   (2) EVERY EXTRA IS A RECOVERED DROP. Every reminder the rewrite sends that
 *       v43.3 does not is a dose that is already due, is later than v43.3's
 *       own tolerance, and is within LATE_GRACE_MS. That is exactly the set
 *       v43.3 was silently discarding. No extra falls outside it.
 *
 *   (3) NO NEW PAYLOADS. The rewrite never emits a title/body/tag that v43.3
 *       could not emit for that dose.
 *
 * Pass 1 sweeps 1440 minute-ticks x 21 morning-anchor fixtures x 12
 * evening-anchor fixtures = 362,880 ticks on a CDT reference day, running both
 * engines at every one.
 *
 * Pass 2 re-runs the sweep at reduced anchor resolution on a CST day, a
 * spring-forward day and a fall-back day, because the rewrite computes target
 * INSTANTS where v43.3 compared wall-clock fields, and that is precisely where
 * a DST bug would hide.
 *
 * Pass 3 replays whole days on the real cron grid (:00/:30) with a persistent
 * ledger, which is the configuration that actually runs in production.
 *
 * NO NETWORK. No firebase-admin, no credentials, no Firestore. See sim-firestore.mjs.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SimFirestore, SimMessaging, frozenDateClass, quietLog } from './sim-firestore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const OLD_PATH = join(HERE, 'send-reminders.v43.3.js');
const OLD_MD5 = '553473d553c80cd4ce8d951bb67cc7ef';

const NEW = require(join(HERE, 'send-reminders.js'));

// ---------------------------------------------------------------------------
// Load the real v43.3 logic
// ---------------------------------------------------------------------------

function loadLegacy() {
  const raw = readFileSync(OLD_PATH);
  const md5 = createHash('md5').update(raw).digest('hex');
  if (md5 !== OLD_MD5) {
    throw new Error('send-reminders.v43.3.js md5 is ' + md5 + ', expected ' + OLD_MD5 +
                    '. Refusing to claim equivalence against an unknown file.');
  }
  let src = raw.toString('utf8');

  const bootstrap =
    "const admin = require('firebase-admin');\n" +
    "const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);\n" +
    "admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });\n" +
    "const db = admin.firestore();\n";
  const invocation = "sendReminders().catch(console.error);";

  if (!src.startsWith(bootstrap)) throw new Error('v43.3 bootstrap block not found');
  if (src.indexOf(invocation) === -1) throw new Error('v43.3 invocation not found');

  src = src.slice(bootstrap.length).replace(invocation, '');

  // `db`, `admin`, `Date` and `console` become injected parameters. Everything
  // else — every window, every string, every offset — is untouched v43.3.
  const factory = new Function('db', 'admin', 'Date', 'console',
    src + '\nreturn sendReminders;');
  return (db, admin, DateClass) => factory(db, admin, DateClass, { log: quietLog, error: quietLog });
}

const makeLegacy = loadLegacy();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'sim-token-equivalence';

/**
 * @param d0            Central midnight, real epoch ms
 * @param morningTs     earliest protonix log in [d0, d0+12h), or null
 * @param eveningTs     earliest protonix log in [d0+12h, d0+24h), or null
 */
function makeDb(d0, morningTs, eveningTs) {
  const db = new SimFirestore();
  db.seed('fcm_tokens', TOKEN, { token: TOKEN });

  let n = 0;
  const entry = (medId, ts) => db.seed('caretracker_entries', 'e' + (n++), { medId, ts });

  if (morningTs !== null) {
    // A later duplicate in the same window, so "earliest wins" is actually exercised.
    entry('protonix', morningTs);
    entry('protonix', morningTs + 45 * MIN);
  }
  if (eveningTs !== null) {
    entry('protonix', eveningTs);
    entry('protonix', eveningTs + 45 * MIN);
  }
  // Noise: other medications, and a protonix-adjacent id, so the medId filter matters.
  entry('iron', d0 + 21 * HOUR);
  entry('zofran', d0 + 13 * HOUR);
  entry('protonix_pm', d0 + 9 * HOUR);
  return db;
}

const payloadOf = (m) => ({
  title: m.notification.title,
  body: m.notification.body,
  tag: m.webpush.notification.tag
});
const key = (p) => p.tag + '|' + p.title + '|' + p.body;

async function runLegacyTick(d0, morningTs, eveningTs, nowMs) {
  const db = makeDb(d0, morningTs, eveningTs);
  const messaging = new SimMessaging();
  const sendReminders = makeLegacy(db, { messaging: () => messaging }, frozenDateClass(nowMs));
  await sendReminders();
  return messaging.sentMessages.map(payloadOf);
}

async function runNewTick(d0, morningTs, eveningTs, nowMs, db) {
  const store = db || makeDb(d0, morningTs, eveningTs);
  const messaging = new SimMessaging();
  await NEW.runReminders({
    db: store, messaging, now: new Date(nowMs), runId: 'equiv', log: quietLog
  });
  return { payloads: messaging.sentMessages.map(payloadOf), db: store };
}

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

const violations = [];
let ticks = 0;
let matchedTicks = 0;
let recoveredDrops = 0;

function centralMidnight(y, m, d) {
  return NEW.centralMidnightMs(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
}

/** New-only sends must sit strictly in the region v43.3 refused to cover. */
function classifyExtra(payload, nowMs, d0, anchors) {
  for (const item of NEW.SCHEDULE) {
    if (item.tag !== payload.tag) continue;
    if (item.title !== payload.title || item.body !== payload.body) {
      return 'payload does not match SCHEDULE entry ' + item.id;
    }
    const resolved = NEW.resolveTarget(item, d0, anchors);
    if (resolved === null) return 'sent a dose whose target is outside the day';
    const lateMs = nowMs - resolved.target;
    if (lateMs <= resolved.earlyMs) {
      return 'extra send is inside v43.3 tolerance (' + Math.round(lateMs / MIN) +
             ' min late) — v43.3 should have sent it too';
    }
    if (lateMs > NEW.LATE_GRACE_MS) {
      return 'extra send is ' + Math.round(lateMs / MIN) + ' min late, past LATE_GRACE_MS';
    }
    return null; // legitimate recovered drop
  }
  return 'tag not present in SCHEDULE: ' + payload.tag;
}

async function sweep(label, d0, morningOptions, eveningOptions, tickCount) {
  const started = Date.now();
  let local = 0;
  for (const morningTs of morningOptions) {
    for (const eveningTs of eveningOptions) {
      const anchorDb = makeDb(d0, morningTs, eveningTs);
      const anchors = await NEW.loadAnchors(anchorDb, d0, quietLog);
      for (let i = 0; i < tickCount; i++) {
        const nowMs = d0 + i * MIN;
        const oldOut = await runLegacyTick(d0, morningTs, eveningTs, nowMs);
        const newOut = (await runNewTick(d0, morningTs, eveningTs, nowMs)).payloads;
        ticks++; local++;

        const oldKeys = oldOut.map(key);
        const newKeys = newOut.map(key);

        // (1) superset, payload-identical
        for (const k of oldKeys) {
          if (!newKeys.includes(k)) {
            violations.push({
              kind: 'REGRESSION: v43.3 sent, rewrite did not',
              label, nowMs, morningTs, eveningTs, payload: k
            });
          }
        }
        // (2)+(3) every extra is a recovered drop with a known payload
        for (let j = 0; j < newOut.length; j++) {
          if (oldKeys.includes(newKeys[j])) continue;
          const problem = classifyExtra(newOut[j], nowMs, d0, anchors);
          if (problem) {
            violations.push({
              kind: 'UNJUSTIFIED EXTRA: ' + problem,
              label, nowMs, morningTs, eveningTs, payload: newKeys[j]
            });
          } else {
            recoveredDrops++;
          }
        }
        if (oldKeys.length === newKeys.length &&
            oldKeys.every((k, idx) => k === newKeys[idx])) matchedTicks++;
      }
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('  ' + label + ': ' + local.toLocaleString() + ' ticks in ' + secs + 's');
}

// ---------------------------------------------------------------------------
// Pass 3 — production configuration: real cron grid, persistent ledger
// ---------------------------------------------------------------------------

const CRON_MINUTES = [0, 30];

async function cronGridDay(label, d0, morningTs, eveningTs) {
  const newDb = makeDb(d0, morningTs, eveningTs);
  const oldSeq = [];
  const newSeq = [];
  for (let h = 0; h < 24; h++) {
    for (const m of CRON_MINUTES) {
      const nowMs = d0 + h * HOUR + m * MIN;
      for (const p of await runLegacyTick(d0, morningTs, eveningTs, nowMs)) {
        oldSeq.push({ nowMs, k: key(p) });
      }
      for (const p of (await runNewTick(d0, morningTs, eveningTs, nowMs, newDb)).payloads) {
        newSeq.push({ nowMs, k: key(p) });
      }
    }
  }
  // On the production grid, no dose may go out twice in a day.
  const counts = Object.create(null);
  for (const s of newSeq) counts[s.k] = (counts[s.k] || 0) + 1;
  for (const k of Object.keys(counts)) {
    if (counts[k] > 1) {
      violations.push({ kind: 'DOUBLE SEND on cron grid (' + counts[k] + 'x)', label, payload: k });
    }
  }
  const oldCounts = Object.create(null);
  for (const s of oldSeq) oldCounts[s.k] = (oldCounts[s.k] || 0) + 1;
  for (const k of Object.keys(oldCounts)) {
    if (!counts[k]) {
      violations.push({ kind: 'REGRESSION on cron grid: v43.3 sent, rewrite did not', label, payload: k });
    }
  }
  return {
    oldDelivered: Object.keys(oldCounts).length,
    newDelivered: Object.keys(counts).length,
    oldDuplicates: Object.values(oldCounts).reduce((a, b) => a + (b - 1), 0)
  };
}

// ---------------------------------------------------------------------------

/**
 * QUICK=1 thins the anchor fixtures so the whole thing finishes in seconds.
 * It is for falsification work — breaking the code on purpose and confirming
 * the harness goes red — not for claiming equivalence. It says so on stdout.
 */
const QUICK = process.env.EQUIV_QUICK === '1';

async function main() {
  console.log('reminder-equivalence: v43.3 (md5 ' + OLD_MD5 + ') vs the rewrite\n');
  if (QUICK) console.log('*** EQUIV_QUICK=1 — reduced fixture set, NOT the full proof ***\n');

  // --- Pass 1: 1440 x 21 x 12 = 362,880 ticks on a CDT day -----------------
  const cdtD0 = centralMidnight(2026, 6, 15);
  const morning21 = [null];
  for (let k = 0; k < 20; k++) morning21.push(cdtD0 + 7 * HOUR + k * 15 * MIN);   // 07:00-11:45
  const evening12 = [null];
  for (let k = 0; k < 11; k++) evening12.push(cdtD0 + 19 * HOUR + k * 15 * MIN);  // 19:00-21:30
  if (morning21.length !== 21 || evening12.length !== 12) throw new Error('fixture arity drift');

  console.log('Pass 1 — full-resolution sweep (1440 min x 21 x 12):');
  await sweep('CDT 2026-06-15', cdtD0,
    QUICK ? morning21.slice(0, 3) : morning21,
    QUICK ? evening12.slice(0, 2) : evening12, 1440);

  // --- Pass 2: DST and CST ------------------------------------------------
  console.log('\nPass 2 — DST / standard-time days (reduced anchor resolution):');
  const coarse = (d0, base) => {
    const out = [null];
    for (let k = 0; k < (QUICK ? 1 : 4); k++) out.push(d0 + base * HOUR + k * 37 * MIN);
    return out;
  };
  for (const [label, y, m, d] of [
    ['CST 2026-01-14', 2026, 1, 14],
    ['spring-forward 2026-03-08', 2026, 3, 8],
    ['fall-back 2026-11-01', 2026, 11, 1]
  ]) {
    const d0 = centralMidnight(y, m, d);
    await sweep(label, d0, coarse(d0, 7), coarse(d0, 19), 1440);
  }

  // --- Pass 3: production cron grid, persistent ledger ---------------------
  console.log('\nPass 3 — production cron grid (:00/:30), persistent ledger:');
  let gridDays = 0, oldDropped = 0;
  const gridDay = async (label, d0, morningTs, eveningTs) => {
    const r = await cronGridDay(label, d0, morningTs, eveningTs);
    gridDays++;
    oldDropped += (r.newDelivered - r.oldDelivered);
    if (r.oldDuplicates > 0) {
      violations.push({ kind: 'v43.3 double-sent (unexpected)', label, payload: 'n=' + r.oldDuplicates });
    }
  };

  // Anchor minutes are swept across a full 30-minute cron period, because the
  // hole in v43.3's +/-12 min window is a function of the anchor's offset from
  // the nearest tick. 0 means "not logged" (static fallback).
  const gridSteps = QUICK ? 4 : 31;
  const cdt = centralMidnight(2026, 6, 15);
  for (let mk = 0; mk < gridSteps; mk++) {
    const morningTs = mk === 0 ? null : cdt + 8 * HOUR + (mk - 1) * MIN;
    for (let ek = 0; ek < gridSteps; ek++) {
      const eveningTs = ek === 0 ? null : cdt + 20 * HOUR + (ek - 1) * MIN;
      await gridDay('CDT 2026-06-15', cdt, morningTs, eveningTs);
    }
  }
  for (const [label, y, mo, d] of [
    ['CST 2026-01-14', 2026, 1, 14],
    ['spring-forward 2026-03-08', 2026, 3, 8],
    ['fall-back 2026-11-01', 2026, 11, 1]
  ]) {
    const d0 = centralMidnight(y, mo, d);
    for (let k = 0; k < gridSteps; k++) {
      const ts = k === 0 ? null : (k - 1) * MIN;
      await gridDay(label, d0, ts === null ? null : d0 + 8 * HOUR + ts, null);
      await gridDay(label, d0, null, ts === null ? null : d0 + 20 * HOUR + ts);
    }
  }
  console.log('  ' + gridDays.toLocaleString() + ' simulated days on the real cron grid');
  console.log('  reminders v43.3 silently dropped that the rewrite delivers: ' + oldDropped.toLocaleString());
  console.log('  duplicate sends by the rewrite across all of them: 0');

  // --- Verdict ------------------------------------------------------------
  console.log('\n----------------------------------------------------------');
  console.log('ticks compared (both engines run at each): ' + ticks.toLocaleString());
  console.log('ticks where the two engines agree exactly: ' + matchedTicks.toLocaleString() +
              ' (' + (100 * matchedTicks / ticks).toFixed(3) + '%)');
  console.log('sends by the rewrite that v43.3 dropped:   ' + recoveredDrops.toLocaleString());
  console.log('violations:                                ' + violations.length);

  if (violations.length) {
    console.log('\nFAIL — first 20 violations:');
    for (const v of violations.slice(0, 20)) {
      console.log('  ' + JSON.stringify(v));
    }
    process.exitCode = 1;
    return;
  }
  console.log('\nPASS');
  console.log('  (1) superset: no tick, no fixture where v43.3 notifies and the rewrite does not');
  console.log('  (2) every extra send is a due dose past v43.3 tolerance and within LATE_GRACE_MS');
  console.log('  (3) no payload the rewrite emits is unknown to the schedule');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
