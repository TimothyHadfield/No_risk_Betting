/* Service worker: caches the static app shell for offline loading.
   Live data (/api/*) is always fetched from the network. */
const CACHE = "nrb-shell-v27";
const SHELL = [
  "/", "/index.html",
  "/styles.css", "/browse.css", "/detail.css", "/views.css", "/profile.css", "/slip.css", "/social.css", "/notifs.css",
  "/util.js", "/browse.js", "/detail.js", "/portfolio.js", "/analytics.js", "/profile.js", "/slip.js", "/social.js", "/notifs.js",
  "/manifest.json", "/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // never cache live data or cross-origin (Kalshi/ESPN via our API, Chart.js CDN)
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return; // default network behavior
  }
  // static shell: NETWORK-FIRST so online users always get the latest files;
  // fall back to cache only when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
