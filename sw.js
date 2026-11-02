// Service worker: la app funciona sin conexión y muestra los recordatorios.
const CACHE = "diario-v5";
const SHELL = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero para la app (así recibe las actualizaciones), caché si no hay conexión.
// Las librerías de Firebase y las fuentes se guardan la primera vez y se sirven desde caché.
self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  const isStatic = url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname === "fonts.gstatic.com";
  if(url.origin === self.location.origin){
    e.respondWith(fetch(req).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match("./index.html"))));
  } else if(isStatic){
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if(res.ok || res.type === "opaque"){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});

// Recordatorio recibido (mensaje de datos de Firebase Cloud Messaging).
self.addEventListener("push", e => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch(err) {}
  const d = j.data || j.notification || {};
  const scope = self.registration.scope;
  const meal = d.meal || "";
  const query = new URLSearchParams({ marcar: meal, dia: d.dia || "", d: d.diario || "" }).toString();
  e.waitUntil(self.registration.showNotification(d.title || "Diario de Alineadores", {
    body: d.body || "¿Te has lavado los dientes?",
    icon: scope + "icons/icon-192.png",
    badge: scope + "icons/badge-96.png",
    tag: d.tipo === "aviso" ? "aviso-" + Date.now() : "cepillado-" + meal,
    renotify: true,
    requireInteraction: d.tipo !== "aviso",
    actions: meal ? [{ action: "hecho", title: "✓ Ya me los he lavado" }] : [],
    data: { open: scope, mark: scope + "?" + query }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = e.action === "hecho" ? e.notification.data.mark : e.notification.data.open;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for(const w of wins){
      if(w.url.startsWith(self.registration.scope)){
        await w.navigate(target).catch(() => {});
        return w.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
