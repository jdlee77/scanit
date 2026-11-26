// Service worker: keeps every app file on the phone, so scanit opens, scans and exports with no
// signal (in cages, basements and trailers). The list of files and the version are in app-files.js.
//
// Updates: when app-files.js changes (a new APP_VERSION), the phone fetches the new files in the
// background while the old version keeps running. The new version takes over on a later visit,
// once no scanit window is still using the old one (see src/offline.js). Kits are in IndexedDB,
// not in these caches, so an update never touches them.
importScripts("app-files.js");

const CACHE = `scanit-${self.APP_VERSION}`;

self.addEventListener("install", event => {
  // cache: "reload" skips the browser's ordinary web cache, so a new version gets new files.
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(self.APP_FILES.map(file => new Request(file, { cache: "reload" })))));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("scanit-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim(); // look after the page that installed us, without a reload
  })());
});

// The page asks the waiting new version to take over (only when it's safe: see src/offline.js).
self.addEventListener("message", event => {
  if (event.data === "take over") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Any page address (scanit's screens are all one page) opens the saved index.html.
    const saved = request.mode === "navigate"
      ? await cache.match("index.html")
      : await cache.match(request, { ignoreSearch: true });
    return saved ?? fetch(request);
  })());
});
