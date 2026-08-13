/* Task2Day service worker — offline app shell.

   The app IS index.html and its name never changes, so a cache-first rule for
   it is a trap: the page is served from cache forever, and the only thing that
   can break the loop is a new service worker — which the stale page has no
   reason to go looking for. That is how a device ends up pinned to a build
   from weeks ago with no way to refresh out of it.

   So: the page and the worker are NETWORK-FIRST, cache only as the offline
   fallback. Everything else — icons, the manifest — stays cache-first, since
   those genuinely do not change and are what make an offline open fast.

   Bump CACHE when you redeploy anyway; it clears the old entries out. */
const CACHE = 'task2day-v34';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A page load, or a request for the app document itself.
const isDocument = req =>
  req.mode === 'navigate' ||
  req.destination === 'document' ||
  /\/(index\.html)?$/.test(new URL(req.url).pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;   // let the network own everything else

  if (isDocument(req)) {
    // Network first: whatever is deployed wins, every single load.
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(hit => hit || caches.match('./')))
    );
    return;
  }

  // Static assets: cache first, but refresh the copy in the background so a
  // changed icon or manifest is picked up by the load after next.
  e.respondWith(
    caches.match(req).then(hit => {
      const live = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || live;
    })
  );
});

// The page asks for this when it sees a waiting worker, so an update does not
// have to sit behind every tab being closed.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* A push from the server. This is the only thing in the app that can reach you
   with the app closed: nothing on the page runs once the tab is gone, so an
   in-page timer can only ever fire while you are already looking at it.

   The payload is JSON written by the Cloud Function in functions/index.js. A
   push with no body at all still has to show something — every browser that
   supports Web Push requires a visible notification for each push received,
   and silently swallowing one costs the app its permission. */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {
    try { data = { body: e.data.text() }; } catch (err2) { data = {}; }
  }
  const title = data.title || 'Task2Day';
  const options = {
    body: data.body || 'You have work due today.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    // one tag per kind, so this morning's reminder replaces this morning's
    // reminder rather than stacking three of them up the lock screen
    tag: data.tag || 'task2day-push',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || './index.html' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

/* The browser can retire a subscription on its own — a long silence, a cleared
   profile, a rotated key. The old endpoint is dead at that moment, so the page
   has to be told to register the new one; it re-subscribes on its next open. */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(list => {
    list.forEach(c => c.postMessage({ type: 'PUSH_SUBSCRIPTION_LOST' }));
  }));
});

// If a notification is clicked, focus the app rather than opening a second window.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(self.clients.matchAll({type:'window'}).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
