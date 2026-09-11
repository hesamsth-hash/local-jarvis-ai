// JARVIS offline shell service worker (production only — see src/lib/pwa.ts).
// Caches the built app shell so the PWA opens without a network. Never touches
// cross-origin requests (Convex, models, fonts) or the /api/ prefix.
const CACHE = "jarvis-v1";
const CORE = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (
          res.ok &&
          (req.destination === "document" ||
            req.destination === "script" ||
            req.destination === "style")
        ) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        req.destination === "document"
          ? caches.match("/index.html")
          : caches.match(req),
      ),
  );
});
