const admin = require('firebase-admin');

// Initialize with service account from GitHub secret
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sendReminders() {
  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = centralTime.getHours();
  const minute = centralTime.getMinutes();

  console.log('Central Time: ' + centralTime.toLocaleString() + ', hour=' + hour + ', min=' + minute);

  let title, body;

  if (hour >= 8 && hour < 9) {
    title = 'Morning Meds Due';
    body = 'Protonix (morning) & Zofran - time for morning doses';
  } else if (hour >= 19 && hour <= 21) {
    title = 'Evening Meds Due';
    body = 'Protonix, Iron, Buspirone, Paroxetine, Compazine - time for evening doses';
  } else {
    console.log('Outside reminder windows, skipping.');
    return;
  }

  const tokensSnap = await db.collection('fcm_tokens').get();
  if (tokensSnap.empty) {
    console.log('No FCM tokens found.');
    return;
  }

  const tokens = tokensSnap.docs.map(d => d.data().token);
  console.log('Sending to ' + tokens.length + ' device(s)');

  const results = await Promise.allSettled(
    tokens.map(token =>
      admin.messaging().send({
        token,
        notification: { title, body },
        webpush: {
          notification: {
            icon: 'https://arnjnnngs.github.io/care-tracker/icon-192.png',
            badge: 'https://arnjnnngs.github.io/care-tracker/icon-192.png',
            tag: 'caretracker-reminder',
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

sendReminders().catch(console.error);
