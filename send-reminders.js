const admin = require('firebase-admin');

// Initialize with service account from GitHub secret
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


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
      'Protonix - time for morning doses',
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

}

sendReminders().catch(console.error);
