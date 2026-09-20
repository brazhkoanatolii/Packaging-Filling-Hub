const CACHE_NAME = "packaging-filling-hub-v0.7.3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./runtime-config.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./src/styles.css",
  "./src/app.js",
  "./src/config/app-config.js",
  "./src/config/workforce-config.js",
  "./src/config/workspace-journals.js",
  "./src/domain/scale-check.js",
  "./src/providers/indexed-db-data-provider.js",
  "./src/providers/demo-google-sheets-provider.js",
  "./src/providers/google-sheets-gateway-provider.js",
  "./src/providers/workforce-gateway-provider.js",
  "./src/repositories/journal-repository.js",
  "./src/repositories/workforce-repository.js",
  "./src/services/auth-service.js",
  "./src/services/shift-service.js",
  "./src/services/workforce-service.js",
  "./src/services/journal-service.js",
  "./src/data/demo-records.js"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(match => match || caches.match("./index.html"))));
});
