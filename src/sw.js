const SCOPE = new URL(self.registration.scope).pathname;
const PREFIX = `saantayo-shell-${SCOPE}-`;
const CACHE = `${PREFIX}__VERSION__`;
const FILES = __FILES__;
const URLS = new Set(
  FILES.map((file) => new URL(file, self.registration.scope).href),
);
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
});
// No forced activation: let open tabs finish using their coherent version.
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !URLS.has(request.url)) return;
  // Explicit app-shell allowlist only. Never cache AI/FX responses, external pages or credentials.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || fetch(request);
    })(),
  );
});
