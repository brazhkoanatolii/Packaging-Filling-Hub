const CACHE_NAME = "packaging-filling-hub-v0.8.90-1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./runtime-config.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/providers/cyclone-gateway-provider.js",
  "./src/repositories/cyclone-repository.js",
  "./src/services/cyclone-service.js",
  "./src/providers/packaging-gateway-provider.js",
  "./src/repositories/packaging-repository.js",
  "./src/services/packaging-service.js",
  "./src/config/product-specification-config.js",
  "./src/providers/product-specification-gateway-provider.js",
  "./src/services/product-specification-service.js?v=0.8.1",
  "./src/config/app-config.js",
  "./src/config/workforce-config.js",
  "./src/config/workspace-journals.js",
  "./src/domain/scale-check.js",
  "./src/providers/indexed-db-data-provider.js",
  "./src/providers/google-sheets-gateway-provider.js",
  "./src/providers/workforce-gateway-provider.js",
  "./src/repositories/journal-repository.js",
  "./src/repositories/workforce-repository.js",
  "./src/services/auth-service.js",
  "./src/services/shift-service.js",
  "./src/services/workforce-service.js",
  "./src/services/journal-service.js"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  // API availability must reflect the network, not a cached success response.
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request, { cache: "no-cache" }).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(match => match || caches.match("./index.html"))));
});
