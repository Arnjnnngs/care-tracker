const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function sendToAll(title, body, tag) {
  const tokensSnap = await db.collection('fcm_tokens').get();
  if (tokensSnap.empty) { console.log('No FCM tokens found.'); return; }
  const tokens = tokensSnap.docs.map(d => d.data().token);
  console.log('Sending "' + title + '" to ' + tokens.length + ' device(s)');
  const results = await Promise.allSettled(
    tokens.map(token =>
      admin.messaging().send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            icon: 'https://arnjnnngs.github.io/care-tracker/icon-192.png',
            badge: 'https://arnjnnngs.github.io/care-tracker/icon-192.png',
            tag: tag || 'caretracker-reminder',
            requireInteraction: true,
            vibrate: [200, 100, 200]
          },
          fcmOptions: { link: 'https://arnjnnngs.github.io/care-tracker/' }
        }
      }).catch(async (err) => {
        if (err.code === 'messaging/registration-token-not-registered' ||
            err.code === 'messaging/invalid-registration-token') {
          console.log('Removing invalid token: ' + token.slice(0, 20) + '...');
          await db.collection('fcm_tokens').doc(token).delete();
        }
        throw err;
      })
    )
  );
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log('Done: ' + sent + ' sent, ' + failed + ' failed');
}

// Real epoch ms (comparable to Firestore `ts` fields, which are Date.now() values)
// for Central-time midnight "today". Works across CDT/CST without a tz table:
// toLocaleString(...,{timeZone}) + new Date(...) reinterprets the Central wall
// clock as if it were the runner's local time (the runner is UTC on GitHub
// Actions), so its getHours/getMinutes/etc. give us ms-since-midnight in
// Central time, which we subtract from the real "now" epoch.
function centralMidnightTodayMs(now) {
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const msSinceMidnight = ct.getHours() * 3600000 + ct.getMinutes() * 60000 + ct.getSeconds() * 1000 + ct.getMilliseconds();
  return now.getTime() - msSinceMidnight;
}

// Mirrors the client's protonixEveningLogTs(d0): finds today's Protonix PM
// dose (logged at/after noon, i.e. not the 8 AM morning dose) and returns its
// real timestamp, or null if not logged yet today (or if the lookup fails,
// so a Firestore hiccup falls back to the static 10 PM window instead of
// silently dropping the evening-meds reminder entirely).
//
// Filters only on medId ('==') so this relies solely on Cloud Firestore's
// automatic single-field index - no manual composite index needed. (A
// compound "medId == && ts >=" query would require one, and this project
// has none defined, which would throw at query time.) The date-range check
// runs in JS instead.
async function protonixEveningLogTs(d0) {
  try {
    const snap = await db.collection('caretracker_entries')
      .where('medId', '==', 'protonix')
      .get();
    let earliest = null;
    snap.forEach(doc => {
      const ts = doc.data().ts;
      if (ts >= d0 + 12 * 3600000 && ts < d0 + 86400000) {
        if (earliest === null || ts < earliest) earliest = ts;
      }
    });
    return earliest;
  } catch (err) {
    console.log('protonixEveningLogTs lookup failed, falling back to static window: ' + err.message);
    return null;
  }
}

async function sendReminders() {
  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = centralTime.getHours();
  const minute = centralTime.getMinutes();
  console.log('Central Time: ' + centralTime.toLocaleString() + ', hour=' + hour + ', min=' + minute);
  // Quiet hours: no notifications from 10:05 PM to 8 AM
  if (hour >= 23 || hour < 8 || (hour === 22 && minute > 5)) {
    console.log('Quiet hours, skipping all.');
    return;
  }
  // 8:30 AM morning meds (fire between 8:00-8:59)
  if (hour === 8 && minute >= 25 && minute <= 35) {
    await sendToAll('Morning Meds Due', 'Protonix - time for morning doses', 'morning-meds');
  }
  // 8:00 PM Protonix (its evening window in the app is 8-10 PM; fire between 7:55-8:05 PM)
  if ((hour === 19 && minute >= 55) || (hour === 20 && minute <= 5)) {
    await sendToAll('Protonix Due', 'Protonix - evening dose (window closes 10 PM)', 'evening-protonix');
  }
  // Evening meds (Iron/Buspirone/Paroxetine open 2h after Protonix's actual
  // logged evening dose, per the app's dynamic-window logic - default to the
  // static 10 PM window if Protonix hasn't been logged yet today).
  const d0 = centralMidnightTodayMs(now);
  const protonixTs = await protonixEveningLogTs(d0);
  if (protonixTs) {
    const targetTs = protonixTs + 2 * 3600000;
    const nowTs = now.getTime();
    // Fire on the first ~30-min cron tick at/after the dynamic target time.
    // Ticks are spaced exactly 30 min apart, so a 12-min tolerance window
    // reliably catches exactly one tick without double-firing or (usually)
    // missing the run.
    if (Math.abs(nowTs - targetTs) <= 12 * 60000 && targetTs < d0 + 86400000) {
      const targetCentral = new Date(targetTs).toLocaleString('en-US', { timeZone: 'America/Chicago' });
      console.log('Protonix logged evening dose - dynamic evening-meds window target: ' + targetCentral);
      await sendToAll('Evening Meds Due', 'Iron, Buspirone, Paroxetine, Compazine - time for evening doses', 'evening-meds');
    }
  } else {
    // Protonix not logged yet today - fall back to the static 10 PM window (9:55-10:05 PM)
    if ((hour === 21 && minute >= 55) || (hour === 22 && minute <= 5)) {
      await sendToAll('Evening Meds Due', 'Iron, Buspirone, Paroxetine, Compazine - time for evening doses', 'evening-meds');
    }
  }
}
sendReminders().catch(console.error);
