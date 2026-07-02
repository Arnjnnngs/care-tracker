const admin = require('firebase-admin');

// Initialize with service account from GitHub secret
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const ZOFRAN_GAP_HOURS = 8;

async function sendToAll(title, body, tag) {
  const tokensSnap = await db.collection('fcm_tokens').get();
  if (tokensSnap.empty) {
    console.log('No FCM tokens found.');
    return;
  }

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
          fcmOptions: {
            link: 'https://arnjnnngs.github.io/care-tracker/'
          }
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

async function checkZofranGap() {
  // Look at caretracker_entries for the most recent zofran dose
  const entriesSnap = await db.collection('caretracker_entries')
    .where('medId', '==', 'zofran')
    .orderBy('ts', 'desc')
    .limit(1)
    .get();

  if (entriesSnap.empty) {
    console.log('No zofran entries found, skipping gap check.');
    return false;
  }

  const lastDose = entriesSnap.docs[0].data();
  const lastTs = lastDose.ts;
  const nowMs = Date.now();
  const gapMs = ZOFRAN_GAP_HOURS * 3600000;
  const elapsed = nowMs - lastTs;
  const elapsedHours = (elapsed / 3600000).toFixed(1);

  console.log('Last zofran dose: ' + new Date(lastTs).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  console.log('Elapsed: ' + elapsedHours + ' hours');

  if (elapsed < gapMs) {
    console.log('Zofran gap not yet expired (' + elapsedHours + 'h / ' + ZOFRAN_GAP_HOURS + 'h), skipping.');
    return false;
  }

  // Check if we already sent a reminder for this gap window
  // Use a Firestore doc to track the last notified dose timestamp
  const trackRef = db.collection('fcm_tracking').doc('zofran_gap');
  const trackDoc = await trackRef.get();
  const lastNotifiedTs = trackDoc.exists ? trackDoc.data().lastDoseTs : 0;

  if (lastNotifiedTs === lastTs) {
    console.log('Already sent reminder for this zofran gap window, skipping.');
    return false;
  }

  // Send the reminder
  await sendToAll(
    'Zofran Available',
    'Zofran 8-hour gap is up - ready to dose',
    'zofran-gap'
  );

  // Mark this gap as notified
  await trackRef.set({ lastDoseTs: lastTs, notifiedAt: nowMs });
  return true;
}

async function sendReminders() {
  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = centralTime.getHours();
  const minute = centralTime.getMinutes();

  console.log('Central Time: ' + centralTime.toLocaleString() + ', hour=' + hour + ', min=' + minute);

  // Quiet hours: no notifications between 10 PM and 8 AM
  if (hour >= 22 || hour < 8) {
    console.log('Quiet hours, skipping all.');
    return;
  }

  // --- SCHEDULED REMINDERS (only at specific times) ---

  // 8:30 AM morning meds (fire between 8:00-8:59)
  if (hour === 8 && minute >= 25 && minute <= 35) {
    await sendToAll(
      'Morning Meds Due',
      'Protonix (morning) & Zofran - time for morning doses',
      'morning-meds'
    );
  }

  // 8:00 PM evening meds (fire between 7:55-8:05 PM)
  if ((hour === 19 && minute >= 55) || (hour === 20 && minute <= 5)) {
    await sendToAll(
      'Evening Meds Due',
      'Protonix, Iron, Buspirone, Paroxetine, Compazine - time for evening doses',
      'evening-meds'
    );
  }

  // --- GAP-BASED: Zofran (runs every 30 min, checks if 8h gap expired) ---
  await checkZofranGap();
}

sendReminders().catch(console.error);
