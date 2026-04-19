/*
 * Service Worker — Cache strategy rewritten to avoid stale-HTML rollback.
 *
 * Old behaviour: network-first on *everything* with a pre-cache of HTML routes.
 * That meant slow / flaky network could silently serve an older deploy's HTML
 * from cache, and the stale HTML referenced chunk hashes that had already been
 * rotated on Vercel — users perceived this as the UI "rolling back".
 *
 * New split:
 *   1. Navigations (HTML) → network-only while online, cache as emergency
 *      offline fallback only. Never serve stale HTML to an online client.
 *   2. /_next/static/* → cache-first (these filenames are content-hashed so a
 *      new deploy gets a new URL and cleanly misses cache).
 *   3. Anything else → pass-through (no cache).
 *
 * CACHE_VERSION is bumped per notable deploy so activation cleans up old
 * caches that may contain the previous deploy's stale HTML.
 */
const CACHE_VERSION = "toritavi-v8";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const HTML_FALLBACK = `${CACHE_VERSION}-html`;

self.addEventListener("install", (event) => {
  // Activate immediately — do not let a previous SW keep serving stale pages.
  self.skipWaiting();
  event.waitUntil(
    caches.open(HTML_FALLBACK).then((cache) =>
      // Best-effort offline fallback only. These entries are overwritten on
      // every successful HTML fetch, so they stay recent when the user is
      // online and merely serve as a graceful offline view.
      cache.addAll(["/"]).catch(() => undefined)
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1) Navigations: network-only, with a cached fallback *only* when the
  //    network actually rejects (i.e. the user is offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(HTML_FALLBACK).then((cache) => cache.put("/", clone));
          }
          return response;
        })
        .catch(() => caches.match("/", { cacheName: HTML_FALLBACK }))
    );
    return;
  }

  // 2) Immutable hashed bundles: cache-first. Safe because Next.js renames
  //    chunks per build, so a new deploy shows up as a cache miss.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request, { cacheName: STATIC_CACHE }).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3) Everything else — no SW-level caching. Let the browser + CDN handle it.
});
