/* Service worker — Mie Cose. Rete prima, cache come riserva per l'uso offline. */
const VERSION = "mie-cose-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./motion.css",
  "./motion.js",
  "./app.js",
  "./frasi.js",
  "./push-config.js",
  "./manifest.json",
  "./logo.svg",
  "./logo.png",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/favicon.png",
  "./arm3d.js",
  "./arm-textures.js",
  "./vendor/three.module.min.js",
  "./vendor/OrbitControls.js",
  "./vendor/RoomEnvironment.js",
  "./vendor/cannon-es.min.js",
  "./vendor/RoundedBoxGeometry.js",
  "./vendor/BufferGeometryUtils.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});

self.addEventListener("push", (event) => {
  let title = "Mie Cose";
  let options = {
    body: "Hai una nuova frase del momento.",
    icon: "./icons/icon-192.png",
    badge: "./icons/favicon.png",
    lang: "it",
    tag: "frase-push",
    data: { url: "./" }
  };
  if (event.data) {
    try {
      const payload = event.data.json();
      if (payload && typeof payload === "object") {
        title = payload.title || title;
        options = Object.assign(options, payload, { title: undefined });
        if (payload.body) options.body = payload.body;
        if (payload.tag) options.tag = payload.tag;
        if (payload.data) options.data = payload.data;
      }
    } catch (err) {
      const text = event.data.text();
      if (text) options.body = text;
    }
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if (client.navigate) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
