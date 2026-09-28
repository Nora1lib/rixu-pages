const CACHE = "rixu-static-v23";
const FILES = ["./", "./index.html", "./widget.html", "./widget.css", "./widget-runtime.js", "./styles.css", "./app.js", "./schedule-controls.css", "./schedule-controls.js", "./planner.js", "./deepseek.js", "./manifest.webmanifest", "./assets/day-landscape.png", "./assets/night-landscape.png", "./assets/adventure-camp-night.png", "./assets/pixel-panel-frame.png", "./assets/quest-mountain-flag.png", "./assets/zlabs-pixel-cn.woff2"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
