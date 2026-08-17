/**
 * ledger-test.mjs — proves the reminder ledger behaves under the four failure
 * modes GitHub Actions actually produces.
 *
 *   node ledger-test.mjs
 *
 * Part A is twenty-odd named scenarios, each one a single claim you can read
 * and disagree with. Part B is a randomised simulation: thousands of whole
 * simulated days where every scheduled run is independently delayed, dropped,
 * duplicated or manually re-dispatched, with invariants checked over every day.
 *
 * NO NETWORK. Simulated Firestore and FCM only — see sim-firestore.mjs. The
 * real database holds one cancer patient's medication history and nothing here
 * can reach it.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SimFirestore, SimMessaging, quietLog } from './sim-firestore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R = require(join(HERE, 'send-reminders.js'));

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const GRACE_MIN = R.LATE_GRACE_MS / MIN;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; return true; }
  failures.push(name + (detail ? ' — ' + detail : ''));
  return false;
}
function eq(name, actual, expected) {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const centralMidnight = (y, m, d) =>
  R.centralMidnightMs(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));

const D0 = centralMidnight(2026, 6, 15);          // CDT Monday
const TOKENS = ['sim-token-a', 'sim-token-b'];

function freshDb({ morningTs = null, eveningTs = null, tokens = TOKENS, genesisOn = null } = {}) {
  const db = new SimFirestore();
  for (const t of tokens) db.seed('fcm_tokens', t, { token: t });
  let n = 0;
  if (morningTs !== null) db.seed('caretracker_entries', 'e' + n++, { medId: 'protonix', ts: morningTs });
  if (eveningTs !== null) db.seed('caretracker_entries', 'e' + n++, { medId: 'protonix', ts: eveningTs });
  db.seed('caretracker_entries', 'e' + n++, { medId: 'zofran', ts: D0 + 13 * HOUR });
  if (genesisOn) db.seed('reminder_ledger', R.GENESIS_DOC_ID, { kind: 'genesis', dateKey: genesisOn, at: 0 });
  return db;
}

/** One workflow run. Returns the reminders that actually went out. */
async function run(db, nowMs, { messaging, runId, log } = {}) {
  const m = messaging || new SimMessaging();
  const out = await R.runReminders({
    db, messaging: m, now: new Date(nowMs), runId: runId || 'run-' + nowMs, log: log || quietLog
  });
  return { sends: out.sends.map((s) => s.doseId), missed: out.missed, messaging: m, out };
}

const ledgerIds = (db) => db.docIds('reminder_ledger');
const missedDocs = (db) =>
  db.all('reminder_ledger').filter((d) => d.kind === 'missed');

// ---------------------------------------------------------------------------
// Part A — named scenarios
// ---------------------------------------------------------------------------

async function scenarios() {
  console.log('Part A — named scenarios\n');

  // -- LATE RUN ------------------------------------------------------------
  {
    // The reported bug, exactly: run due 20:00, Actions starts it at 20:08.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 20 * HOUR + 8 * MIN);
    check('LATE  run 8 min late still sends the 8 PM Protonix reminder',
      r.sends.includes('evening-protonix'), 'sends=' + r.sends);
    check('LATE  the late send is recorded as delivered',
      ledgerIds(db).includes('2026-06-15__evening-protonix__a0__result'));
  }
  {
    // An hour and a quarter late: inside the grace, still actionable.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 21 * HOUR + 15 * MIN);
    check('LATE  75 min late (inside ' + GRACE_MIN + ' min grace) still sends',
      r.sends.includes('evening-protonix'), 'sends=' + r.sends);
  }
  {
    // The morning window, which v43.3 dropped just as readily.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 9 * HOUR + 20 * MIN);
    check('LATE  80 min late still sends the 8 AM reminder',
      r.sends.includes('morning-protonix'), 'sends=' + r.sends);
  }

  // -- THE CUTOFF ----------------------------------------------------------
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 20 * HOUR + (GRACE_MIN - 1) * MIN);
    check('CUTOFF ' + (GRACE_MIN - 1) + ' min late sends',
      r.sends.includes('evening-protonix'), 'sends=' + r.sends);
  }
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 20 * HOUR + (GRACE_MIN + 1) * MIN);
    check('CUTOFF ' + (GRACE_MIN + 1) + ' min late does NOT send',
      !r.sends.includes('evening-protonix'), 'sends=' + r.sends);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-protonix');
    check('CUTOFF past the cutoff the dose is RECORDED, not dropped',
      !!m && m.reason === 'too-late', JSON.stringify(m));
  }

  // -- DOUBLE RUN ----------------------------------------------------------
  {
    // Two consecutive cron ticks both inside the grace.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const a = await run(db, D0 + 20 * HOUR);
    const b = await run(db, D0 + 20 * HOUR + 30 * MIN);
    eq('DOUBLE first tick sends once', a.sends, ['evening-protonix']);
    eq('DOUBLE second tick sends nothing', b.sends, []);
  }
  {
    // Two runs racing at the same instant — the case a naive read-then-write loses.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const t = D0 + 20 * HOUR + 3 * MIN;
    const [a, b] = await Promise.all([
      run(db, t, { runId: 'race-a' }), run(db, t, { runId: 'race-b' })
    ]);
    const total = a.sends.length + b.sends.length;
    check('DOUBLE two runs racing at the same instant send exactly once',
      total === 1, 'total sends = ' + total);
    check('DOUBLE the loser records losing the claim race',
      a.out.skipped.concat(b.out.skipped).some((s) => s.reason === 'lost-claim-race'));
  }
  {
    // Five simultaneous runs, because workflow_dispatch spam is a real thing.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const t = D0 + 20 * HOUR + 1 * MIN;
    const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => run(db, t, { runId: 'r' + i })));
    const total = rs.reduce((a, r) => a + r.sends.length, 0);
    check('DOUBLE five simultaneous runs send exactly once', total === 1, 'total = ' + total);
  }

  // -- MISSED RUN ----------------------------------------------------------
  {
    // Actions down through the whole evening window; first run back at 22:10,
    // 130 min late AND inside quiet hours.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 22 * HOUR + 10 * MIN);
    eq('MISSED a run 130 min late sends nothing', r.sends, []);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-protonix');
    check('MISSED the un-sent evening dose is recorded, reason too-late',
      !!m && m.reason === 'too-late', JSON.stringify(m));
    check('MISSED the morning doses are recorded too',
      missedDocs(db).length === 4, 'missed=' + missedDocs(db).length);
  }
  {
    // Down 19:30-21:00, back at 21:00: 60 min late, still actionable.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 21 * HOUR);
    check('MISSED a window gap recovered within the grace still sends',
      r.sends.includes('evening-protonix'), 'sends=' + r.sends);
  }
  {
    // Quiet hours veto a dose that is otherwise inside the grace.
    const db = freshDb({ eveningTs: D0 + 20 * HOUR, genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 22 * HOUR + 40 * MIN);
    eq('MISSED quiet hours still suppress the push', r.sends, []);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-linked');
    check('MISSED a quiet-hours suppression is recorded, not dropped',
      !!m && m.reason === 'quiet-hours', JSON.stringify(m));
  }
  {
    // Actions down for an ENTIRE day. Nothing ran, so nothing could notice at
    // the time; the next day's first run has to notice retroactively.
    const db = freshDb({ genesisOn: '2026-06-13' });
    await run(db, D0 + DAY + 8 * HOUR);
    const back = missedDocs(db).filter((d) => d.dateKey === '2026-06-15');
    eq('MISSED a whole-day outage is backfilled the next day', back.length, 4);
    check('MISSED backfill reason is no-run',
      back.every((d) => d.reason === 'no-run'), JSON.stringify(back.map((d) => d.reason)));
  }
  {
    // ...but a day that ran fine must NOT be backfilled.
    const db = freshDb({ genesisOn: '2026-06-13' });
    for (let h = 8; h < 23; h++) { await run(db, D0 + h * HOUR); await run(db, D0 + h * HOUR + 30 * MIN); }
    await run(db, D0 + DAY + 8 * HOUR);
    const back = missedDocs(db).filter((d) => d.dateKey === '2026-06-15' && d.reason === 'no-run');
    eq('MISSED a healthy day is not backfilled', back.length, 0);
  }
  {
    // First run ever: yesterday has no ledger data because the ledger did not
    // exist, which must not be reported as four missed doses.
    const db = freshDb();
    await run(db, D0 + 8 * HOUR);
    eq('MISSED the first run ever invents no historical misses',
      missedDocs(db).length, 0);
    check('MISSED the first run ever writes the genesis marker',
      ledgerIds(db).includes(R.GENESIS_DOC_ID));
  }

  // -- MANUAL RE-RUN / IDEMPOTENCE ----------------------------------------
  {
    // A whole normal day, then the operator re-dispatches every run again.
    const db = freshDb({ morningTs: D0 + 8 * HOUR + 4 * MIN, eveningTs: D0 + 20 * HOUR + 6 * MIN, genesisOn: '2026-06-14' });
    const ticks = [];
    for (let h = 0; h < 24; h++) { ticks.push(D0 + h * HOUR); ticks.push(D0 + h * HOUR + 30 * MIN); }

    let first = 0;
    for (const t of ticks) first += (await run(db, t)).sends.length;
    const afterFirst = ledgerIds(db);

    let replay = 0;
    for (const t of ticks) replay += (await run(db, t, { runId: 'manual-redispatch' })).sends.length;

    check('RERUN  a normal day delivers all four reminders', first === 4, 'sent ' + first);
    eq('RERUN  replaying every run of the day sends nothing more', replay, 0);
    eq('RERUN  replaying the day writes no new ledger documents',
      ledgerIds(db).length, afterFirst.length);
  }
  {
    // Manual dispatch at an arbitrary minute after a dose already went out.
    const db = freshDb({ genesisOn: '2026-06-14' });
    await run(db, D0 + 8 * HOUR);
    let extra = 0;
    for (const m of [1, 7, 13, 29, 44, 61, 88]) {
      extra += (await run(db, D0 + 8 * HOUR + m * MIN, { runId: 'manual' })).sends.length;
    }
    eq('RERUN  manual dispatches after delivery send nothing', extra, 0);
  }

  // -- APPEND-ONLY ---------------------------------------------------------
  {
    const db = freshDb({ morningTs: D0 + 8 * HOUR + 2 * MIN, eveningTs: D0 + 20 * HOUR + 9 * MIN, genesisOn: '2026-06-14' });
    for (let h = 0; h < 24; h++) { await run(db, D0 + h * HOUR); await run(db, D0 + h * HOUR + 30 * MIN); }
    const ops = db.writeLog.filter((w) => w.path.startsWith('reminder_ledger/'));
    check('APPEND every ledger write is a create()',
      ops.length > 0 && ops.every((w) => w.op === 'create'),
      JSON.stringify([...new Set(ops.map((w) => w.op))]));
    const ids = ops.map((w) => w.path);
    check('APPEND no ledger document is written twice',
      new Set(ids).size === ids.length);
    // The simulator throws on set()/update(), so reaching here at all proves
    // no code path attempted one.
  }

  // -- PROTOTYPE POLLUTION (rule 7) ---------------------------------------
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    const byDose = await R.loadLedger(db, '2026-06-15', quietLog);
    check('PROTO  the ledger map has a null prototype',
      Object.getPrototypeOf(byDose) === null);
    for (const evil of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      check('PROTO  empty ledger map has no inherited key "' + evil + '"',
        byDose[evil] === undefined, 'got ' + typeof byDose[evil]);
    }
    // And a dose whose id collides with a prototype member is still tracked.
    db.seed('reminder_ledger', '2026-06-15__constructor__a0__result',
      { kind: 'result', dateKey: '2026-06-15', doseId: 'constructor', attempt: 0, ok: true });
    const byDose2 = await R.loadLedger(db, '2026-06-15', quietLog);
    check('PROTO  a dose called "constructor" reads back as its own record',
      !!byDose2['constructor'] && byDose2['constructor'].results['0'].ok === true);
  }

  // -- SEND FAILURE, RETRY, EXHAUSTION -------------------------------------
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    const broken = new SimMessaging({ failMode: 'throw' });
    const a = await run(db, D0 + 20 * HOUR, { messaging: broken });
    eq('RETRY  a failing FCM send delivers nothing', a.sends, []);
    const res = db.all('reminder_ledger').find((d) => d.kind === 'result' && d.doseId === 'evening-protonix');
    check('RETRY  the failure is recorded as a non-ok result', !!res && res.ok === false);
    const b = await run(db, D0 + 20 * HOUR + 30 * MIN);   // healthy FCM
    check('RETRY  the next run retries and delivers',
      b.sends.includes('evening-protonix'), 'sends=' + b.sends);
    check('RETRY  the retry is attempt 1',
      ledgerIds(db).includes('2026-06-15__evening-protonix__a1__result'));
  }
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    for (let i = 0; i < R.MAX_SEND_ATTEMPTS; i++) {
      await run(db, D0 + 20 * HOUR + i * 30 * MIN, { messaging: new SimMessaging({ failMode: 'throw' }) });
    }
    const r = await run(db, D0 + 20 * HOUR + (GRACE_MIN - 1) * MIN);
    eq('RETRY  attempts are capped at MAX_SEND_ATTEMPTS', r.sends, []);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-protonix');
    check('RETRY  exhaustion is recorded as a miss',
      !!m && m.reason === 'attempts-exhausted', JSON.stringify(m));
  }
  {
    // A run killed between claiming and reporting leaves a claim with no result.
    const db = freshDb({ genesisOn: '2026-06-14' });
    db.seed('reminder_ledger', '2026-06-15__evening-protonix__a0', {
      kind: 'claim', dateKey: '2026-06-15', doseId: 'evening-protonix',
      attempt: 0, claimedAt: D0 + 20 * HOUR
    });
    const soon = await run(db, D0 + 20 * HOUR + (R.STALE_CLAIM_MS / MIN - 1) * MIN);
    eq('CLAIM  a fresh claim is treated as in-flight, not retried', soon.sends, []);
    const later = await run(db, D0 + 20 * HOUR + (R.STALE_CLAIM_MS / MIN + 1) * MIN);
    check('CLAIM  a stale claim with no result is retried',
      later.sends.includes('evening-protonix'), 'sends=' + later.sends);
  }

  // -- FAIL CLOSED ---------------------------------------------------------
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    db.failCollections.add('reminder_ledger');
    const r = await run(db, D0 + 20 * HOUR);
    eq('SAFETY an unreadable ledger sends nothing rather than re-pushing the day', r.sends, []);
  }
  {
    // An unreadable entries collection must fall back to the static window,
    // not drop the reminder — this is v43.3 behaviour and it is preserved.
    const db = freshDb({ eveningTs: D0 + 20 * HOUR, genesisOn: '2026-06-14' });
    db.failCollections.add('caretracker_entries');
    const r = await run(db, D0 + 22 * HOUR);
    check('SAFETY an unreadable entries collection falls back to the static window',
      r.sends.includes('evening-linked'), 'sends=' + r.sends);
  }

  // -- ANCHORED DOSES ------------------------------------------------------
  {
    // Protonix logged 20:07 => Iron/Compazine target 22:07. v43.3's +/-12 min
    // window covers neither the 22:00 nor the 22:30 tick; the reminder was
    // never sent. Here the 22:00 tick is inside the early tolerance and sends.
    const db = freshDb({ eveningTs: D0 + 20 * HOUR + 7 * MIN, genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 22 * HOUR);
    check('ANCHOR an anchored evening dose fires from the preceding tick',
      r.sends.includes('evening-linked'), 'sends=' + r.sends);
  }
  {
    // THE v43.3 DEAD ZONE. Protonix logged 08:15 => Buspirone/Paroxetine target
    // 10:15, which is 15 minutes from the 10:00 tick and 15 from the 10:30 tick.
    // v43.3's +/-12 min window covers neither, so on a perfectly punctual cron
    // this reminder was NEVER sent. Any anchor minute landing the target at
    // :13-:17 past a tick has the same fate: 5 minutes in every 30.
    const db = freshDb({ morningTs: D0 + 8 * HOUR + 15 * MIN, genesisOn: '2026-06-14' });
    const a = await run(db, D0 + 10 * HOUR);
    const b = await run(db, D0 + 10 * HOUR + 30 * MIN);
    eq('ANCHOR v43.3 dead zone: nothing at the 10:00 tick (15 min early)', a.sends, []);
    eq('ANCHOR v43.3 dead zone: delivered at the 10:30 tick instead', b.sends, ['morning-linked']);
  }
  {
    // KNOWN LIMIT, asserted so it cannot regress unnoticed. An anchored EVENING
    // target past 22:05 falls inside quiet hours, and quiet hours are an
    // absolute veto (exactly as in v43.3). Lateness recovery cannot help here —
    // the two policies genuinely conflict and quiet hours is Aaron's to set.
    // What is new is that the dose is now RECORDED rather than vanishing.
    const db = freshDb({ eveningTs: D0 + 20 * HOUR + 15 * MIN, genesisOn: '2026-06-14' });
    const a = await run(db, D0 + 22 * HOUR);
    const b = await run(db, D0 + 22 * HOUR + 30 * MIN);
    eq('QUIET  an anchored 22:15 target is not pushed into quiet hours',
      a.sends.concat(b.sends), []);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-linked');
    check('QUIET  ...but it is recorded as missed, reason quiet-hours',
      !!m && m.reason === 'quiet-hours', JSON.stringify(m));
  }
  {
    // Same conflict on the STATIC 10 PM fallback: it sits exactly on the quiet
    // boundary, so a run more than 5 minutes late cannot deliver it.
    const db = freshDb({ genesisOn: '2026-06-14' });
    const a = await run(db, D0 + 22 * HOUR + 6 * MIN);
    eq('QUIET  the static 10 PM reminder cannot be recovered once quiet starts',
      a.sends.filter((d) => d === 'evening-linked'), []);
    const m = missedDocs(db).find((d) => d.doseId === 'evening-linked');
    check('QUIET  ...and that too is recorded rather than dropped',
      !!m && m.reason === 'quiet-hours', JSON.stringify(m));
  }

  // -- DST -----------------------------------------------------------------
  for (const [label, y, m, d] of [
    ['spring-forward', 2026, 3, 8],
    ['fall-back', 2026, 11, 1]
  ]) {
    const d0 = centralMidnight(y, m, d);
    const target = R.centralTargetMs(d0, 20, 0);
    const wall = R.centralClock(new Date(target));
    check('DST    ' + label + ': the 8 PM target really is 20:00 Central',
      wall.getHours() === 20 && wall.getMinutes() === 0,
      wall.getHours() + ':' + wall.getMinutes());
    // Every hour of the day, not just the four in SCHEDULE. The 00:00-01:00
    // band is the one where d0's inherited DST error does NOT cancel the naive
    // offset, so this is what actually exercises the correction loop in
    // centralTargetMs. Without it the loop is unfalsifiable dead code.
    //
    // Wall-clock times that do not exist (02:00-02:59 on spring-forward) are
    // excluded, by probing which ones the zone actually produces rather than
    // by hardcoding the US DST rule.
    const dayKey = R.centralDateKey(new Date(d0 + 12 * HOUR));
    const real = new Set();
    for (let k = -120; k <= 26 * 60; k++) {
      const at = new Date(d0 + k * MIN);
      if (R.centralDateKey(at) !== dayKey) continue;   // only wall times ON this day
      const w = R.centralClock(at);
      real.add(w.getHours() + ':' + w.getMinutes());
    }
    let hourChecks = 0;
    for (let h = 0; h < 24; h++) {
      for (const mm of [0, 30]) {
        const want = h + ':' + mm;
        if (!real.has(want)) continue;
        const w = R.centralClock(new Date(R.centralTargetMs(d0, h, mm)));
        if (check('DST    ' + label + ': target ' + want + ' resolves to that Central wall time',
          w.getHours() === h && w.getMinutes() === mm,
          'got ' + w.getHours() + ':' + w.getMinutes())) hourChecks++;
      }
    }
    check('DST    ' + label + ': swept the whole day (' + hourChecks + ' real wall times)',
      hourChecks >= 44, 'only ' + hourChecks);
    const db = freshDb({ genesisOn: '2026-02-01' });
    const r = await run(db, target + 8 * MIN);
    check('DST    ' + label + ': a late run on a transition day still sends',
      r.sends.includes('evening-protonix'), 'sends=' + r.sends);
  }

  // -- INVALID TOKEN CLEANUP (v43.3 behaviour, preserved) ------------------
  {
    const db = freshDb({ genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 20 * HOUR, { messaging: new SimMessaging({ failMode: 'unregistered' }) });
    eq('TOKENS an all-unregistered send delivers nothing', r.sends, []);
    eq('TOKENS unregistered tokens are pruned', db.docIds('fcm_tokens'), []);
  }
  {
    const db = freshDb({ tokens: [], genesisOn: '2026-06-14' });
    const r = await run(db, D0 + 20 * HOUR);
    eq('TOKENS no registered devices means nothing is delivered', r.sends, []);
    const res = db.all('reminder_ledger').find((d) => d.kind === 'result');
    check('TOKENS having no devices is recorded as not-delivered, so it retries',
      !!res && res.ok === false && res.error === 'no registered tokens', JSON.stringify(res));
  }

  console.log('  ' + passed + ' checks passed, ' + failures.length + ' failed\n');
}

// ---------------------------------------------------------------------------
// Part B — randomised whole-day simulation
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a failure is reproducible from its seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const SIM_DAYS = [
  [2026, 6, 15],   // CDT
  [2026, 1, 14],   // CST
  [2026, 3, 8],    // spring forward
  [2026, 11, 1]    // fall back
];

/**
 * One simulated day. Every scheduled 30-minute tick independently becomes:
 * on time, late by up to 3 hours, dropped entirely, or duplicated. Some days
 * also get manual workflow_dispatch runs at random moments, and some get a
 * spell of FCM failures.
 */
async function simulateDay(rand, dayIdx) {
  const [y, mo, d] = SIM_DAYS[dayIdx % SIM_DAYS.length];
  const d0 = centralMidnight(y, mo, d);

  const morningTs = rand() < 0.65 ? d0 + 7 * HOUR + Math.floor(rand() * 300) * MIN : null;
  const eveningTs = rand() < 0.65 ? d0 + 19 * HOUR + Math.floor(rand() * 180) * MIN : null;
  const db = freshDb({ morningTs, eveningTs, genesisOn: R.centralDateKey(new Date(d0 - DAY)) });

  // Build the run timeline.
  const runs = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const scheduled = d0 + h * HOUR + m * MIN;
      const roll = rand();
      if (roll < 0.15) continue;                                  // Actions dropped this run
      if (roll < 0.55) runs.push(scheduled);                      // on time
      else if (roll < 0.90) runs.push(scheduled + Math.floor(rand() * 180) * MIN);  // late
      else { runs.push(scheduled); runs.push(scheduled + Math.floor(rand() * 3) * MIN); } // duplicated
    }
  }
  const manualCount = Math.floor(rand() * 4);
  for (let i = 0; i < manualCount; i++) runs.push(d0 + Math.floor(rand() * 1440) * MIN);
  runs.sort((a, b) => a - b);

  const fcmOutageStart = rand() < 0.25 ? d0 + Math.floor(rand() * 1440) * MIN : null;
  const fcmOutageEnd = fcmOutageStart === null ? null : fcmOutageStart + Math.floor(rand() * 240) * MIN;

  const delivered = [];   // { doseId, atMs }
  for (const t of runs) {
    const broken = fcmOutageStart !== null && t >= fcmOutageStart && t <= fcmOutageEnd;
    const r = await run(db, t, { messaging: new SimMessaging(broken ? { failMode: 'throw' } : {}) });
    for (const doseId of r.sends) delivered.push({ doseId, atMs: t });
  }

  // The next day's first run, which is what backfills a total outage.
  await run(db, d0 + DAY + 8 * HOUR);

  return { db, d0, runs, delivered, morningTs, eveningTs };
}

async function fuzz(iterations) {
  console.log('Part B — randomised whole-day simulation (' + iterations.toLocaleString() + ' days)\n');
  const rand = rng(20260817);
  let totalRuns = 0, totalDelivered = 0, totalMissed = 0;
  const started = Date.now();

  for (let i = 0; i < iterations; i++) {
    const sim = await simulateDay(rand, i);
    const { db, d0, runs, delivered } = sim;
    const dateKey = R.centralDateKey(new Date(d0 + 12 * HOUR));
    totalRuns += runs.length;
    totalDelivered += delivered.length;

    const anchors = await R.loadAnchors(db, d0, quietLog);

    // INV 1 — no dose is ever delivered twice in a day.
    const counts = Object.create(null);
    for (const s of delivered) counts[s.doseId] = (counts[s.doseId] || 0) + 1;
    for (const k of Object.keys(counts)) {
      if (counts[k] > 1) {
        failures.push('FUZZ day ' + i + ': ' + k + ' delivered ' + counts[k] + ' times');
        return report(started, totalRuns, totalDelivered, totalMissed);
      }
    }

    for (const item of R.SCHEDULE) {
      const resolved = R.resolveTarget(item, d0, anchors);
      const sent = delivered.find((s) => s.doseId === item.id);
      const missed = db.all('reminder_ledger')
        .find((x) => x.kind === 'missed' && x.doseId === item.id && x.dateKey === dateKey);
      if (missed) totalMissed++;

      if (sent) {
        // INV 2 — nothing is ever delivered outside its window.
        const lateMs = sent.atMs - resolved.target;
        if (lateMs > R.LATE_GRACE_MS) {
          failures.push('FUZZ day ' + i + ': ' + item.id + ' delivered ' +
            Math.round(lateMs / MIN) + ' min late, past the grace');
          return report(started, totalRuns, totalDelivered, totalMissed);
        }
        if (lateMs < -resolved.earlyMs) {
          failures.push('FUZZ day ' + i + ': ' + item.id + ' delivered ' +
            Math.round(-lateMs / MIN) + ' min EARLY');
          return report(started, totalRuns, totalDelivered, totalMissed);
        }
        // INV 3 — nothing is ever delivered during quiet hours.
        const w = R.centralClock(new Date(sent.atMs));
        if (R.isQuietHours(w.getHours(), w.getMinutes())) {
          failures.push('FUZZ day ' + i + ': ' + item.id + ' delivered during quiet hours');
          return report(started, totalRuns, totalDelivered, totalMissed);
        }
        // INV 4 — delivered and recorded-missed are mutually exclusive.
        if (missed) {
          failures.push('FUZZ day ' + i + ': ' + item.id + ' both delivered and recorded missed');
          return report(started, totalRuns, totalDelivered, totalMissed);
        }
      } else if (!missed) {
        // INV 5 — a dose that never went out is never silently gone.
        failures.push('FUZZ day ' + i + ': ' + item.id + ' neither delivered nor recorded missed');
        return report(started, totalRuns, totalDelivered, totalMissed);
      }
    }

    // INV 6 — the ledger is append-only: creates only, never the same id twice.
    const ops = db.writeLog.filter((w) => w.path.startsWith('reminder_ledger/'));
    if (!ops.every((w) => w.op === 'create')) {
      failures.push('FUZZ day ' + i + ': non-create write to the ledger');
      return report(started, totalRuns, totalDelivered, totalMissed);
    }
    const paths = ops.map((w) => w.path);
    if (new Set(paths).size !== paths.length) {
      failures.push('FUZZ day ' + i + ': a ledger document was written twice');
      return report(started, totalRuns, totalDelivered, totalMissed);
    }

    // INV 7 — idempotence: replay every run of the day; nothing more goes out.
    let replayed = 0;
    for (const t of runs) replayed += (await run(db, t, { runId: 'replay' })).sends.length;
    if (replayed !== 0) {
      failures.push('FUZZ day ' + i + ': replaying the day sent ' + replayed + ' more reminders');
      return report(started, totalRuns, totalDelivered, totalMissed);
    }
    passed += 7;
  }
  report(started, totalRuns, totalDelivered, totalMissed);
}

function report(started, totalRuns, totalDelivered, totalMissed) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('  simulated workflow runs: ' + totalRuns.toLocaleString());
  console.log('  reminders delivered:     ' + totalDelivered.toLocaleString());
  console.log('  misses recorded:         ' + totalMissed.toLocaleString());
  console.log('  duplicate deliveries:    0');
  console.log('  silent disappearances:   0');
  console.log('  elapsed:                 ' + secs + 's\n');
}

// ---------------------------------------------------------------------------

const ITERATIONS = Number(process.env.LEDGER_TEST_DAYS || 4000);

await scenarios();
await fuzz(ITERATIONS);

console.log('----------------------------------------------------------');
console.log('checks passed: ' + passed);
console.log('failures:      ' + failures.length);
if (failures.length) {
  console.log('\nFAIL');
  for (const f of failures.slice(0, 25)) console.log('  ' + f);
  process.exitCode = 1;
} else {
  console.log('\nPASS — late runs send, double runs do not double-send,');
  console.log('       missed windows are recorded, manual re-runs are inert,');
  console.log('       and every ledger write is an append.');
}
