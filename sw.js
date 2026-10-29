/* GoBase · service worker: la aplicación funciona sin conexión una vez instalada.
   Las páginas se piden primero a la red (para tener siempre la última versión) y, sin conexión, se sirven de la caché. */
const CACHE = "gobase-1.0.0";
const SHELL = ["./", "index.html", "manifest.webmanifest", "assets/icon.svg", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png", "assets/icon-180.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("gobase-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const cache = await caches.open(CACHE); cache.put("index.html", res.clone()); }
        return res;
      } catch (e) {
        return (await caches.match("index.html")) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) { const cache = await caches.open(CACHE); cache.put(req, res.clone()); }
    return res;
  })());
});
