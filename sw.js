// Service worker: la app funciona sin conexión y muestra los recordatorios.
const CACHE = "diario-v9";
const SHELL = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "diario-log").map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
// Registro de los avisos recibidos en este móvil (los últimos 20), para poder comprobar
// desde la app si un aviso llegó al móvil y si se pudo mostrar.
async function logPush(entry){
  try{
    const c = await caches.open("diario-log");
    const r = await c.match("./__avisos");
    const list = r ? await r.json() : [];
    list.unshift({ at: Date.now(), ...entry });
    await c.put("./__avisos", new Response(JSON.stringify(list.slice(0, 20)), { headers: { "Content-Type": "application/json" } }));
  }catch(err){}
}

self.addEventListener("push", e => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch(err) {}
  const d = j.data || j.notification || {};
  const scope = self.registration.scope;
  const meal = d.meal || "";
  const query = new URLSearchParams({ marcar: meal, dia: d.dia || "", d: d.diario || "" }).toString();
  const title = d.title || "Diario de Alineadores";
  const base = {
    body: d.body || "¿Te has lavado los dientes?",
    icon: scope + "icons/icon-192.png",
    badge: scope + "icons/badge-96.png",
    tag: d.tipo === "aviso" ? "aviso-" + Date.now() : "cepillado-" + meal + "-" + Date.now(),
    silent: false,
    vibrate: [200, 100, 200],
    data: { open: scope, mark: scope + "?" + query }
  };
  e.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, {
        ...base,
        requireInteraction: d.tipo !== "aviso",
        actions: meal ? [{ action: "hecho", title: "✓ Ya me los he lavado" }] : []
      });
      await logPush({ title, ok: true });
    } catch (err) {
      // si el móvil no acepta botones en la notificación, se muestra sin ellos
      try { await self.registration.showNotification(title, base); await logPush({ title, ok: true, simple: true, err: String(err) }); }
      catch (err2) { await logPush({ title, ok: false, err: String(err2) }); }
    }
  })());
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
