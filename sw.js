/* Makes the site open instantly the second time, and still open with no internet.
 *
 * On purpose it only ever keeps the public front page and the shared files (styles, scripts, icons).
 * Anything private or personal is waved straight through to the network and never stored:
 * /api/, /trading/, /profile/ and /login/ are all skipped. That is the important part - a saved copy
 * of a private page could otherwise be read by the next person on the same device.
 */
const VERSION = "sdl-v3";
const SHELL = [
  "/",
  "/404.html",
  "/assets/style.css",
  "/assets/theme.js",
  "/assets/account.js",
  "/assets/icon-192.png",
  "/site.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isPrivate(url) {
  const p = url.pathname;
  return p.startsWith("/api/") || p.startsWith("/trading") || p.startsWith("/special") || p.startsWith("/profile") || p.startsWith("/login");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fonts and prices go straight out
  if (isPrivate(url)) return;                         // never stored, never served from a copy

  // Pictures never change once drawn, and shared files carry a fingerprint (?v=...) or a versioned name,
  // so the saved copy is served straight away (speed fix, 24 Sep 2026).
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i.test(url.pathname) ||
      (url.pathname.startsWith("/assets/") && (/[?&]v=[0-9a-f]+/.test(url.search) || /-\d+\.\d+\.\d+\.js$/.test(url.pathname)))) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Pages: try the network first so the numbers are current, fall back to the saved copy offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
