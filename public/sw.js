// Spektra Service Worker — offline + notifications
const CACHE_NAME = 'spektra-v3';
const POLL_INTERVAL = 60000; // co 60s sprawdzaj nowe eventy

// Cache dashboard assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(['/dashboard', '/manifest.json']);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fetch with cache fallback
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Background sync — poll for notifications
let lastCheck = Date.now();

async function checkForUpdates() {
  try {
    const res = await fetch('/api/notifications?since=' + lastCheck);
    if (!res.ok) return;
    const data = await res.json();
    lastCheck = Date.now();

    for (const notif of data.notifications || []) {
      await self.registration.showNotification(notif.title, {
        body: notif.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: notif.tag || 'spektra-' + Date.now(),
        data: { url: '/dashboard' },
        vibrate: [200, 100, 200],
      });
    }
  } catch {}
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow(event.notification.data?.url || '/dashboard')
  );
});

// Periodic check (when browser allows)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'spektra-check') {
    event.waitUntil(checkForUpdates());
  }
});

// Message from main page — trigger check
self.addEventListener('message', (event) => {
  if (event.data === 'check-notifications') {
    checkForUpdates();
  }
});
