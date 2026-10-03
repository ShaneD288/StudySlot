// Keeps the app itself available offline. Timetable data is saved by the app on the device;
// /api requests always go to the network.
const VERSION = "studyslot-v5";
const SHELL = [
  "/",
  "/app.css",
  "/app.js",
  "/lib/dates.js",
  "/lib/weeks.js",
  "/lib/classes.js",
  "/lib/free-time.js",
  "/lib/share-links.js",
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
// Network first, falling back to the saved copy when offline.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // Timetable data and personal calendar feeds are never saved by the service worker.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/feed/")) return;
  const navigation = event.request.mode === "navigate";
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Save only successful responses, and save pages without their query (e.g. ?friend=…).
        if (res.ok) {
          const copy = res.clone();
          const key = navigation ? url.origin + url.pathname : event.request;
          caches.open(VERSION).then((cache) => cache.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: navigation })),
  );
});
