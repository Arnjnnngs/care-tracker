/**
 * send-reminders.js — CareTracker push reminders, run from GitHub Actions cron.
 *
 * Two changes from v43.3:
 *
 *  1. DATA-DRIVEN. The four hand-written if-statements that named five
 *     medications inline are replaced by one SCHEDULE table. Adding, removing
 *     or retiming a dose is a table edit; no control flow changes. The two
 *     near-identical Protonix lookup functions collapse into one parameterised
 *     anchor lookup that now runs a single Firestore query instead of two.
 *
 *  2. A LEDGER. v43.3 decided "send?" by asking *is it 8:00 right now?* — a
 *     +/-5-minute wall-clock window on a cron that GitHub Actions runs late
 *     whenever it feels like it. A run due at 13:00 that started at 13:08 sent
 *     nothing: no error, no retry, no log, no trace. The dose reminder simply
 *     never happened and nobody could tell afterwards.
 *
 *     It now asks *has this dose's reminder already gone out today?* and keeps
 *     the answer in Firestore. A late run still sends. A second run does not
 *     double-send. A run that is SO late the reminder would be misleading does
 *     not send, but records the miss instead of dropping it on the floor.
 *
 * APPEND-ONLY BY CONSTRUCTION
 * ---------------------------
 * The ledger only ever CREATEs documents at deterministic IDs. It never
 * updates and never deletes. State is expressed by which documents exist, not
 * by any document's contents changing. This satisfies the project's
 * append-only Firestore rules without needing them relaxed.
 *
 * (Note for the record: firebase-admin, which this file uses, bypasses
 * security rules entirely, so these writes would succeed regardless. The
 * append-only shape is deliberate anyway — it is the stated constraint, and it
 * is what lets the app UI read the ledger later under the existing rules
 * without anyone touching Firebase config.)
 *
 * The deterministic ID is also the concurrency primitive. Firestore's
 * `create()` fails with ALREADY_EXISTS if the document is there. Two runs
 * racing on the same dose both read "not sent", both call create(), and
 * exactly one wins. The loser does not send. No transaction, no update, no
 * lock document.
 */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CENTRAL_TZ = 'America/Chicago';

const ENTRIES_COLLECTION = 'caretracker_entries';
const TOKENS_COLLECTION = 'fcm_tokens';
const LEDGER_COLLECTION = 'reminder_ledger';
// Fixed-ID marker created on the very first run, so "no ledger data" can be told
// apart from "no runs happened". Contains no doseId, so loadLedger ignores it.
const GENESIS_DOC_ID = '__genesis';

const APP_URL = 'https://arnjnnngs.github.io/care-tracker/';
const ICON_URL = APP_URL + 'icon-192.png';
const DEFAULT_TAG = 'caretracker-reminder';

/**
 * How late a reminder may be and still be worth sending.
 *
 * Reasoning, because this is the number that decides whether a cancer patient
 * gets told to take a dose she should no longer take:
 *
 *  - Every dose in this schedule has a real clinical window, and the NARROWEST
 *    one is two hours (evening Protonix: the app's own copy says "window
 *    closes 10 PM" for a dose due at 8 PM). A reminder that lands 90 minutes
 *    late still leaves half an hour of that window to act in. It is late, but
 *    it is true.
 *  - Past 90 minutes into a 2-hour window the push starts lying. "Time for
 *    your evening dose" at 21:45 is not a reminder, it is a prompt to take a
 *    dose out of schedule — and these meds are CHAINED (Iron opens two hours
 *    after the logged evening Protonix), so a very late reminder collides with
 *    the next dose's reminder. Two pushes minutes apart naming different
 *    medications is exactly how a double-dose happens.
 *  - 90 minutes comfortably clears real GitHub Actions lateness. Queue delays
 *    are usually under 15 minutes and pathologically reach roughly an hour;
 *    scheduled workflows are explicitly best-effort and can be dropped under
 *    load. 90 minutes covers essentially all of the recoverable cases while
 *    still being bounded.
 *  - Beyond the cutoff the right surface is the app's own missed-dose UI,
 *    which shows the dose in context against everything else logged that day.
 *    A push cannot do that. So past the cutoff we record the miss and stay
 *    quiet rather than pushing something misleading.
 *
 * Shorter (say 30 min) and a merely-annoying Actions delay still drops the
 * dose, which is the bug. Longer (say 4 h) and a morning reminder can arrive
 * at lunchtime. 90 minutes is the widest value that keeps every reminder
 * inside the window it is about.
 */
const LATE_GRACE_MS = 90 * MIN;

/**
 * A claim with no recorded outcome older than this is presumed dead — the
 * runner was killed between claiming the dose and finishing the send — and the
 * dose becomes eligible for one more attempt. Must be comfortably longer than
 * a real run (seconds) and shorter than the 30-minute cron cadence, so a
 * genuinely in-flight run is never treated as dead by a concurrent run.
 */
const STALE_CLAIM_MS = 10 * MIN;

/** Hard cap on send attempts per dose per day, so a persistent failure cannot loop. */
const MAX_SEND_ATTEMPTS = 3;

/** Quiet hours: nothing is pushed from 10:05 PM through 8:00 AM Central. */
const QUIET_END_HOUR = 8;
const QUIET_LATE_HOUR = 22;
const QUIET_LATE_MINUTE = 5;
const QUIET_HARD_HOUR = 23;

/**
 * How early a reminder may fire relative to its target.
 *
 * Preserved from v43.3, which used symmetric windows. It is not cosmetic: the
 * anchored doses have targets at arbitrary minutes (Protonix logged 20:07 =>
 * Iron target 22:07) while cron only ticks on :00 and :30, so without the
 * wider tolerance an anchored evening dose would first become due at 22:30 —
 * inside quiet hours — and be suppressed. The tolerances below are exactly the
 * ones v43.3 shipped.
 */
const STATIC_EARLY_MS = 5 * MIN;
const ANCHORED_EARLY_MS = 12 * MIN;

/**
 * The schedule. This is the only place a medication is named.
 *
 *   id       stable key; used in ledger document IDs, so it must never contain '__'
 *   at       Central wall-clock time the dose is due
 *   anchor   optional: the dose actually opens `offsetMs` after another med's
 *            logged dose that day, and `at` is only the fallback for when that
 *            med has not been logged yet. `fromMs`/`toMs` bound the search to
 *            the right half of the Central day, measured from Central midnight.
 */
const SCHEDULE = [
  {
    id: 'morning-protonix',
    at: { hour: 8, minute: 0 },
    title: 'Morning Meds Due',
    body: 'Protonix - time for morning doses',
    tag: 'morning-meds'
  },
  {
    id: 'morning-linked',
    at: { hour: 10, minute: 0 },
    anchor: { medId: 'protonix', fromMs: 0, toMs: 12 * HOUR, offsetMs: 2 * HOUR },
    title: 'Morning Meds Due',
    body: 'Buspirone, Paroxetine - time for morning doses',
    tag: 'morning-meds-buspar'
  },
  {
    id: 'evening-protonix',
    at: { hour: 20, minute: 0 },
    title: 'Protonix Due',
    body: 'Protonix - evening dose (window closes 10 PM)',
    tag: 'evening-protonix'
  },
  {
    id: 'evening-linked',
    at: { hour: 22, minute: 0 },
    anchor: { medId: 'protonix', fromMs: 12 * HOUR, toMs: 24 * HOUR, offsetMs: 2 * HOUR },
    title: 'Evening Meds Due',
    body: 'Iron, Compazine - time for evening doses',
    tag: 'evening-meds'
  }
];

// Ledger IDs are built by joining fields with '__', so no field may contain it.
for (const item of SCHEDULE) {
  if (item.id.includes('__')) {
    throw new Error('SCHEDULE id must not contain "__": ' + item.id);
  }
}

// ---------------------------------------------------------------------------
// Central time
// ---------------------------------------------------------------------------

/**
 * A Date whose LOCAL fields read as the Central wall clock at instant `now`.
 * Same trick v43.3 used: format in Central, re-parse as runner-local. Correct
 * for any runner timezone, and needs no tz database.
 */
function centralClock(now) {
  return new Date(now.toLocaleString('en-US', { timeZone: CENTRAL_TZ }));
}

/**
 * Real epoch ms of Central midnight on the Central day containing `now`.
 *
 * Carried over from v43.3 unchanged, including its one quirk: on the two DST
 * transition days "hours since midnight" is not the same as the wall-clock
 * hour, so this lands an hour early on spring-forward (23:00 the previous day)
 * and an hour late on fall-back (01:00). Verified:
 *
 *   2026-03-08  d0 -> Mar 7, 11:00 PM   d0+12h -> 12:00 PM   d0+24h -> 12:00 AM Mar 9
 *   2026-11-01  d0 -> Nov 1, 01:00 AM   d0+12h -> 12:00 PM   d0+24h -> 12:00 AM Nov 2
 *
 * The offset cancels for every instant after the 2 AM transition, so the noon
 * split and the day end that the anchor windows depend on are exactly right;
 * only the window's opening boundary is off by an hour, for one hour, twice a
 * year, at 23:00-00:00 / 00:00-01:00 — hours in which nothing is dosed (the
 * doses are 8 AM and 8 PM). It is left alone deliberately: changing it would
 * be a behaviour change beyond this rewrite's remit, and the client in
 * index.html computes its day boundary the same way, so the two must agree.
 */
function centralMidnightMs(now) {
  const ct = centralClock(now);
  const since = ct.getHours() * HOUR + ct.getMinutes() * MIN +
                ct.getSeconds() * 1000 + ct.getMilliseconds();
  return now.getTime() - since;
}

/** 'YYYY-MM-DD' for the Central day containing `now`. */
function centralDateKey(now) {
  const ct = centralClock(now);
  const pad = (n) => String(n).padStart(2, '0');
  return ct.getFullYear() + '-' + pad(ct.getMonth() + 1) + '-' + pad(ct.getDate());
}

/**
 * Real epoch ms for Central wall-clock hour:minute on the Central day that
 * starts at `d0`.
 *
 * Naive `d0 + hour*HOUR` is only right when no DST transition falls between d0
 * and the target. This measures the Central wall clock at the naive instant and
 * shifts by the difference. One correction converges (a DST shift cannot itself
 * cross another DST shift); the loop bound is belt and braces.
 *
 * For the four times currently in SCHEDULE the correction happens to be a
 * no-op, because d0's own DST error (see centralMidnightMs) cancels the naive
 * offset error at every instant after the 2 AM transition. It is not
 * decoration, though: the moment anything is scheduled before 2 AM the naive
 * value is an hour wrong. ledger-test.mjs pins that with a 01:00 target on
 * spring-forward day, so this stays honest instead of being correct only for
 * the rows that happen to be in the table today — which is the opposite of
 * what a data-driven schedule is for.
 */
function centralTargetMs(d0, hour, minute) {
  let t = d0 + hour * HOUR + minute * MIN;
  for (let i = 0; i < 2; i++) {
    const w = centralClock(new Date(t));
    const delta = (hour * 60 + minute) - (w.getHours() * 60 + w.getMinutes());
    if (delta === 0) break;
    t += delta * MIN;
  }
  return t;
}

function isQuietHours(hour, minute) {
  return hour >= QUIET_HARD_HOUR ||
         hour < QUIET_END_HOUR ||
         (hour === QUIET_LATE_HOUR && minute > QUIET_LATE_MINUTE);
}

// ---------------------------------------------------------------------------
// Anchor lookup
// ---------------------------------------------------------------------------

/**
 * Earliest logged timestamp for each anchor medication, per half-day window.
 *
 * Replaces protonixMorningLogTs + protonixEveningLogTs, which were the same
 * function twice with a different time range and each ran its own query.
 * One query per distinct anchor medId now serves every window over it.
 *
 * Filters only on medId ('=='), exactly as v43.3 did, so this rides Cloud
 * Firestore's automatic single-field index. A compound "medId == && ts >="
 * query would demand a composite index and this project defines none; it would
 * throw at query time. The range check stays in JS.
 *
 * A lookup failure yields null for that anchor, which falls the dose back to
 * its static time rather than dropping the reminder — same as v43.3.
 */
async function loadAnchors(db, d0, log) {
  const byKey = Object.create(null);
  const medIds = [];
  for (const item of SCHEDULE) {
    if (item.anchor && !medIds.includes(item.anchor.medId)) medIds.push(item.anchor.medId);
  }

  for (const medId of medIds) {
    let docs = null;
    try {
      const snap = await db.collection(ENTRIES_COLLECTION).where('medId', '==', medId).get();
      docs = [];
      snap.forEach((doc) => docs.push(doc.data()));
    } catch (err) {
      log('anchor lookup failed for ' + medId + ', falling back to static windows: ' + err.message);
      docs = null;
    }

    for (const item of SCHEDULE) {
      if (!item.anchor || item.anchor.medId !== medId) continue;
      const key = anchorKey(item.anchor);
      if (key in byKey) continue;
      if (docs === null) { byKey[key] = null; continue; }
      const from = d0 + item.anchor.fromMs;
      const to = d0 + item.anchor.toMs;
      let earliest = null;
      for (const data of docs) {
        const ts = data.ts;
        if (typeof ts !== 'number') continue;
        if (ts >= from && ts < to && (earliest === null || ts < earliest)) earliest = ts;
      }
      byKey[key] = earliest;
    }
  }
  return byKey;
}

function anchorKey(anchor) {
  return anchor.medId + '@' + anchor.fromMs + '-' + anchor.toMs;
}

/**
 * When this dose is actually due, and how much early tolerance it carries.
 * Returns null if the target falls outside the Central day (v43.3 refused to
 * fire an anchored dose whose target spilled past midnight; so do we).
 */
function resolveTarget(item, d0, anchors) {
  if (item.anchor) {
    const anchorTs = anchors[anchorKey(item.anchor)];
    if (anchorTs !== null && anchorTs !== undefined) {
      const target = anchorTs + item.anchor.offsetMs;
      if (target >= d0 + DAY) return null;
      return { target, earlyMs: ANCHORED_EARLY_MS, anchored: true };
    }
  }
  return {
    target: centralTargetMs(d0, item.at.hour, item.at.minute),
    earlyMs: STATIC_EARLY_MS,
    anchored: false
  };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------
//
// Document IDs, all created and never modified:
//
//   <dateKey>__<doseId>__a<n>            claim  — "run <runId> is sending attempt n"
//   <dateKey>__<doseId>__a<n>__result    result — outcome of attempt n
//   <dateKey>__<doseId>__missed          missed — terminal, this one is not going out
//
// The claim is written BEFORE the send so a concurrent run cannot also send.
// The result is written after, so a run that dies mid-send leaves a claim with
// no result — visibly incomplete, and retryable once it goes stale. That is
// why "sent" is inferred from a result document, not from the claim.

function claimId(dateKey, doseId, attempt) {
  return dateKey + '__' + doseId + '__a' + attempt;
}
function resultId(dateKey, doseId, attempt) {
  return claimId(dateKey, doseId, attempt) + '__result';
}
function missedId(dateKey, doseId) {
  return dateKey + '__' + doseId + '__missed';
}

/**
 * All ledger documents for one Central day, grouped by dose id.
 *
 * Queries on the single indexed field `dateKey` — no composite index, matching
 * the constraint the entries query already works under.
 *
 * Object.create(null) throughout: these maps are keyed by dose ids and date
 * keys, and a plain {} inherits Object.prototype, so `byDose['constructor']`
 * would be a truthy function on an empty map and a dose called `constructor`
 * or `toString` would read as already-sent and never be delivered.
 */
async function loadLedger(db, dateKey, log) {
  const byDose = Object.create(null);
  const ensure = (doseId) => {
    if (!(doseId in byDose)) {
      byDose[doseId] = { claims: Object.create(null), results: Object.create(null), missed: null };
    }
    return byDose[doseId];
  };

  let snap;
  try {
    snap = await db.collection(LEDGER_COLLECTION).where('dateKey', '==', dateKey).get();
  } catch (err) {
    // Fail CLOSED. If we cannot read the ledger we cannot know what already
    // went out, and re-pushing every dose of the day at once is a far worse
    // failure for the patient than one skipped reminder.
    log('LEDGER READ FAILED for ' + dateKey + ' (' + err.message + ') — sending nothing this run.');
    return null;
  }

  snap.forEach((doc) => {
    const d = doc.data();
    if (!d || typeof d.doseId !== 'string') return;
    const rec = ensure(d.doseId);
    if (d.kind === 'claim') rec.claims[String(d.attempt)] = d;
    else if (d.kind === 'result') rec.results[String(d.attempt)] = d;
    else if (d.kind === 'missed') rec.missed = d;
  });
  return byDose;
}

function doseLedger(byDose, doseId) {
  return byDose[doseId] || { claims: Object.create(null), results: Object.create(null), missed: null };
}

/**
 * The whole decision, as a pure function. No I/O, so the simulation harness
 * drives exactly the code that runs in production.
 *
 * Returns { action, ... } where action is one of:
 *   'send'        — claim attempt `attempt`, then push
 *   'skip'        — nothing to do (already delivered / not due yet / in flight / already recorded)
 *   'record-miss' — terminal, append a missed document with `reason`
 */
function decide(item, nowMs, resolved, ledger, quiet) {
  const target = resolved.target;

  // Delivered already? Any successful result for any attempt settles it.
  for (const key of Object.keys(ledger.results)) {
    if (ledger.results[key] && ledger.results[key].ok) {
      return { action: 'skip', reason: 'already-sent', target };
    }
  }

  if (ledger.missed) return { action: 'skip', reason: 'already-recorded-missed', target };

  if (nowMs < target - resolved.earlyMs) {
    return { action: 'skip', reason: 'not-due-yet', target };
  }

  const lateMs = nowMs - target;
  if (lateMs > LATE_GRACE_MS) {
    return { action: 'record-miss', reason: 'too-late', target, lateMs };
  }

  // Quiet hours veto everything, exactly as in v43.3 — but the dose is now
  // recorded as missed instead of evaporating.
  if (quiet) return { action: 'record-miss', reason: 'quiet-hours', target, lateMs };

  // How many attempts have been made, and is one still running?
  let attempts = 0;
  for (const key of Object.keys(ledger.claims)) {
    const n = Number(key);
    if (Number.isFinite(n) && n + 1 > attempts) attempts = n + 1;
    const claim = ledger.claims[key];
    const hasResult = !!ledger.results[key];
    if (!hasResult && nowMs - (claim.claimedAt || 0) < STALE_CLAIM_MS) {
      // Another run claimed this moments ago and has not reported back.
      return { action: 'skip', reason: 'in-flight', target };
    }
  }

  if (attempts >= MAX_SEND_ATTEMPTS) {
    return { action: 'record-miss', reason: 'attempts-exhausted', target, lateMs };
  }

  return { action: 'send', attempt: attempts, target, lateMs };
}

/** create() that treats ALREADY_EXISTS as "someone else got there first". */
async function createOnce(db, docId, data) {
  try {
    await db.collection(LEDGER_COLLECTION).doc(docId).create(data);
    return true;
  } catch (err) {
    if (err && (err.code === 6 || err.code === 'already-exists' ||
                /already exists/i.test(err.message || ''))) {
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function sendToAll(db, messaging, title, body, tag, log) {
  const tokensSnap = await db.collection(TOKENS_COLLECTION).get();
  if (tokensSnap.empty) {
    log('No FCM tokens found.');
    return { sent: 0, failed: 0, tokens: 0 };
  }
  const tokens = tokensSnap.docs.map((d) => d.data().token);
  log('Sending "' + title + '" to ' + tokens.length + ' device(s)');
  const results = await Promise.allSettled(
    tokens.map((token) =>
      messaging.send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            icon: ICON_URL,
            badge: ICON_URL,
            tag: tag || DEFAULT_TAG,
            requireInteraction: true,
            vibrate: [200, 100, 200]
          },
          fcmOptions: { link: APP_URL }
        }
      }).catch(async (err) => {
        if (err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token') {
          log('Removing invalid token: ' + token.slice(0, 20) + '...');
          await db.collection(TOKENS_COLLECTION).doc(token).delete();
        }
        throw err;
      })
    )
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  log('Done: ' + sent + ' sent, ' + failed + ' failed');
  return { sent, failed, tokens: tokens.length };
}

// ---------------------------------------------------------------------------
// Previous-day sweep
// ---------------------------------------------------------------------------

/**
 * If Actions was down for a whole window — or a whole day — no run existed to
 * notice. The next run that does happen looks back one Central day and writes a
 * missed document for anything that never went out and was never recorded, so
 * the gap is visible in the data instead of being invisible in its absence.
 *
 * Uses each dose's STATIC time: yesterday's anchor query would need a second
 * entries fetch and the anchored target is only informational on a record we
 * are writing precisely because nothing was sent.
 *
 * A day with no ledger entries at all is ambiguous — either Actions never ran,
 * or the ledger did not exist yet. The genesis document disambiguates: it is
 * created exactly once, on the first run ever, and records that day. Days at or
 * before it are pre-history and are never backfilled, so deploying this file
 * does not manufacture four fake misses for the day before it shipped.
 */
async function sweepPreviousDay(db, now, dateKey, log) {
  const yesterday = new Date(now.getTime() - DAY);
  const prevKey = centralDateKey(yesterday);
  if (prevKey === dateKey) return;

  let genesisKey = null;
  try {
    const snap = await db.collection(LEDGER_COLLECTION).doc(GENESIS_DOC_ID).get();
    if (snap.exists) genesisKey = (snap.data() || {}).dateKey || null;
  } catch (err) {
    log('genesis lookup failed (' + err.message + ') — skipping backfill this run.');
    return;
  }
  if (genesisKey === null) {
    await createOnce(db, GENESIS_DOC_ID, { kind: 'genesis', dateKey, at: now.getTime() });
    log('Ledger genesis recorded for ' + dateKey + '; no backfill before this day.');
    return;
  }
  // 'YYYY-MM-DD' sorts lexicographically the same as chronologically.
  if (prevKey <= genesisKey) return;

  const byDose = await loadLedger(db, prevKey, log);
  if (byDose === null) return;

  const d0 = centralMidnightMs(yesterday);
  for (const item of SCHEDULE) {
    const ledger = doseLedger(byDose, item.id);
    if (ledger.missed) continue;
    let delivered = false;
    for (const key of Object.keys(ledger.results)) {
      if (ledger.results[key] && ledger.results[key].ok) delivered = true;
    }
    if (delivered) continue;
    const target = centralTargetMs(d0, item.at.hour, item.at.minute);
    const wrote = await createOnce(db, missedId(prevKey, item.id), {
      kind: 'missed', dateKey: prevKey, doseId: item.id,
      reason: 'no-run', targetMs: target, at: now.getTime()
    });
    if (wrote) {
      log('MISSED (backfill): ' + item.id + ' on ' + prevKey + ' never sent — no run covered it.');
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 *   db        Firestore-shaped: collection().doc().create()/delete()/get(), collection().where().get()
 *   messaging FCM-shaped: send(message)
 *   now       Date for this run
 *   runId     identifier recorded on claims, for tracing a send back to a workflow run
 *   log       line logger
 */
async function runReminders(deps) {
  const db = deps.db;
  const messaging = deps.messaging;
  const now = deps.now || new Date();
  const log = deps.log || console.log;
  const runId = deps.runId || 'local';

  const ct = centralClock(now);
  const hour = ct.getHours();
  const minute = ct.getMinutes();
  const nowMs = now.getTime();
  const d0 = centralMidnightMs(now);
  const dateKey = centralDateKey(now);
  const quiet = isQuietHours(hour, minute);

  log('Central Time: ' + ct.toLocaleString() + ', hour=' + hour + ', min=' + minute +
      ', day=' + dateKey + (quiet ? ' [quiet hours]' : ''));

  const byDose = await loadLedger(db, dateKey, log);
  if (byDose === null) return { sends: [], skipped: [], missed: [] };

  const anchors = await loadAnchors(db, d0, log);

  const outcome = { sends: [], skipped: [], missed: [] };

  for (const item of SCHEDULE) {
    const resolved = resolveTarget(item, d0, anchors);
    if (resolved === null) {
      log(item.id + ': anchored target falls outside today — skipping.');
      outcome.skipped.push({ doseId: item.id, reason: 'target-outside-day' });
      continue;
    }

    const ledger = doseLedger(byDose, item.id);
    const d = decide(item, nowMs, resolved, ledger, quiet);
    // Formatting a zone-aware timestamp is not free; only do it when logging.
    const targetCentral = () => new Date(d.target).toLocaleString('en-US', { timeZone: CENTRAL_TZ });

    if (d.action === 'skip') {
      if (d.reason !== 'not-due-yet') {
        log(item.id + ': ' + d.reason + ' (target ' + targetCentral() + ') — skipping.');
      }
      outcome.skipped.push({ doseId: item.id, reason: d.reason });
      continue;
    }

    if (d.action === 'record-miss') {
      const wrote = await createOnce(db, missedId(dateKey, item.id), {
        kind: 'missed', dateKey, doseId: item.id, reason: d.reason,
        targetMs: d.target, lateMs: d.lateMs, at: nowMs, runId
      });
      log('MISSED: ' + item.id + ' (target ' + targetCentral() + ', ' +
          Math.round(d.lateMs / MIN) + ' min late) — ' + d.reason +
          (wrote ? '' : ' (already recorded)'));
      outcome.missed.push({ doseId: item.id, reason: d.reason, lateMs: d.lateMs });
      continue;
    }

    // action === 'send'. Claim first: whoever creates the claim owns the send.
    const won = await createOnce(db, claimId(dateKey, item.id, d.attempt), {
      kind: 'claim', dateKey, doseId: item.id, attempt: d.attempt,
      targetMs: d.target, lateMs: d.lateMs, claimedAt: nowMs, runId
    });
    if (!won) {
      log(item.id + ': another run already claimed attempt ' + d.attempt + ' — skipping.');
      outcome.skipped.push({ doseId: item.id, reason: 'lost-claim-race' });
      continue;
    }

    if (d.lateMs > 0) {
      log(item.id + ': running ' + Math.round(d.lateMs / MIN) + ' min after target ' +
          targetCentral() + ' — still inside the ' + Math.round(LATE_GRACE_MS / MIN) +
          ' min grace, sending.');
    }
    if (resolved.anchored) {
      log(item.id + ': anchored window, target ' + targetCentral());
    }

    let res, ok, errMessage = null;
    try {
      res = await sendToAll(db, messaging, item.title, item.body, item.tag, log);
      ok = res.sent > 0;
      if (!ok && res.tokens === 0) errMessage = 'no registered tokens';
    } catch (err) {
      res = { sent: 0, failed: 0, tokens: 0 };
      ok = false;
      errMessage = err.message;
      log(item.id + ': send threw — ' + err.message);
    }

    await createOnce(db, resultId(dateKey, item.id, d.attempt), {
      kind: 'result', dateKey, doseId: item.id, attempt: d.attempt,
      ok, sent: res.sent, failed: res.failed, tokens: res.tokens,
      error: errMessage, at: Date.now(), runId
    });

    if (ok) {
      outcome.sends.push({ doseId: item.id, title: item.title, body: item.body, tag: item.tag });
    } else {
      log(item.id + ': attempt ' + d.attempt + ' did NOT deliver (' +
          (errMessage || 'all sends failed') + '); ' +
          (d.attempt + 1 < MAX_SEND_ATTEMPTS
            ? 'will retry on a later run.'
            : 'attempts exhausted, will be recorded missed.'));
      outcome.skipped.push({ doseId: item.id, reason: 'send-failed' });
    }
  }

  await sweepPreviousDay(db, now, dateKey, log);
  return outcome;
}

module.exports = {
  runReminders,
  decide,
  resolveTarget,
  loadAnchors,
  loadLedger,
  sendToAll,
  centralClock,
  centralMidnightMs,
  centralDateKey,
  centralTargetMs,
  isQuietHours,
  anchorKey,
  claimId,
  resultId,
  missedId,
  GENESIS_DOC_ID,
  SCHEDULE,
  LATE_GRACE_MS,
  STALE_CLAIM_MS,
  MAX_SEND_ATTEMPTS,
  STATIC_EARLY_MS,
  ANCHORED_EARLY_MS,
  LEDGER_COLLECTION,
  ENTRIES_COLLECTION,
  TOKENS_COLLECTION
};

if (require.main === module) {
  const admin = require('firebase-admin');
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  runReminders({
    db: admin.firestore(),
    messaging: admin.messaging(),
    now: new Date(),
    runId: process.env.GITHUB_RUN_ID
      ? 'gh-' + process.env.GITHUB_RUN_ID + '.' + (process.env.GITHUB_RUN_ATTEMPT || '1')
      : 'manual-' + Date.now(),
    log: console.log
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
