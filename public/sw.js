// Keeps the app itself available offline. Timetable data is saved by the app on the device;
// /api requests always go to the network.
const VERSION = "studyslot-v3";
const SHELL = [
  "/",
  "/app.css",
  "/app.js",
  "/lib/dates.js",
  "/lib/weeks.js",
  "/lib/classes.js",
  "/lib/free-time.js",
  "/courses.json",
  "/fonts/bricolage-grotesque-latin.woff2",
  "/vendor/qrcode.min.js",
  "/privacy",
  "/terms",
  "/legal.css",
  "/manifest.webmanifest",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
