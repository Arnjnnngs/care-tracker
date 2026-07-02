importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCHn2cS3uDB4mvFMJcV-Z3QCK0kp2y11Y0",
  authDomain: "fuelforge-7c132.firebaseapp.com",
  projectId: "fuelforge-7c132",
  storageBucket: "fuelforge-7c132.firebasestorage.app",
  messagingSenderId: "368300007566",
  appId: "1:368300007566:web:1ecf9ac9926c80c87769df"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const title = n.title || 'CareTracker';
  const options = {
    body: n.body || 'Time for meds',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'caretracker-reminder',
    requireInteraction: true,
    vibrate: [200, 100, 200]
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      if (cls.length > 0) {
        cls[0].focus();
      } else {
        clients.openWindow('./');
      }
    })
  );
});
