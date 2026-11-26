// Service worker: keeps every app file on the phone, so scanit opens, scans and exports with no
// signal (in cages, basements and trailers). The list of files and the version are in app-files.js.
//
// Updates: when app-files.js changes (a new APP_VERSION), the phone fetches the new files in the
// background while the old version keeps running. The new version takes over only when the page
// asks (see src/offline.js) and no other scanit window is open, or once every scanit window has
// closed, so a running page never loads files from a different version. Kits are in IndexedDB,
// not in these caches, so an update never touches them.
importScripts("app-files.js");

const CACHE = `scanit-${self.APP_VERSION}`;
const TAKE_OVER = "take over"; // the message src/offline.js sends; keep the two the same

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    // Fetch every file before keeping any, so a phone never holds half of a version. The ?v= part
    // gets fresh copies past the browser's and the hosting service's caches; each file is kept
    // under its plain name. If any file fails, nothing is kept and the browser tries again later.
    const responses = await Promise.all(self.APP_FILES.map(async file => {
      const response = await fetch(`${file}?v=${self.APP_VERSION}`, { cache: "reload" });
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return [file, response];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map(([file, response]) => cache.put(file, response)));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("scanit-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim(); // look after the page that installed us, without a reload
  })());
});

self.addEventListener("message", event => {
  if (event.data !== TAKE_OVER) return;
  event.waitUntil((async () => {
    // Another open scanit window would be left running old code against new files: wait instead.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length <= 1) await self.skipWaiting();
  })());
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
