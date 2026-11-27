// Fungu service worker: the app shell works offline; money data is never cached.
// /api/* (sponsor, rpc, faucet) always goes to the network, so balances are never served stale.
const V = "fungu-v1";
const SHELL = ["/app", "/offline.html", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;

  // content-hashed build files and icons: cache first
  if (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(V).then((c) => c.put(e.request, copy));
        return res;
      })),
    );
    return;
  }

  // pages: network first; with no signal, the cached app shell or the offline page
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (u.pathname === "/app" && res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put("/app", copy)); }
          return res;
        })
        .catch(() => caches.match(u.pathname === "/app" ? "/app" : e.request).then((hit) => hit || caches.match("/offline.html"))),
    );
  }
});
