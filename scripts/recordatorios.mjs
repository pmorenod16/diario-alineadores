// Lo ejecuta GitHub Actions (revisa cada 5 minutos) y hace cuatro cosas:
// 1. Recordatorios: para cada persona con recordatorios, si ya ha pasado su hora (y no hace
//    más de 90 min), todavía no se ha avisado hoy y el cepillado no está marcado, la avisa.
// 2. Avisos a quien sigue un diario: junta lo que se ha marcado desde la última vez
//    (cepillados, cambios, limpiezas) y se lo notifica a las personas con acceso que
//    tienen los avisos activados.
// 3. Avisa al dueño de un diario cuando alguien pide acceso con su código.
// 4. Cada 30 minutos, trae las citas del dentista del Google Calendar del dueño.
// (cron-job.org la lanza cada 5 minutos; el horario de GitHub queda de respaldo.)

import { parseICS, dentistVisits, isValidIcsUrl } from "./calendario.mjs";

export const WINDOW_MIN = 90;
export const MEALS = ["desayuno", "comida", "cena"];
// Si alguien guardó sus horas antes de que existiera el aviso de la comida, se usa este.
export const DEFAULT_REM = { comida: { time: "16:00", on: true } };

/** Fecha y minuto del día en la zona horaria dada. */
export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, mins: Number(p.hour) * 60 + Number(p.minute) };
}

/** Hora configurada de una comida ("HH:MM"), o null si está apagada. */
export function remTime(rem, meal) {
  const r = rem?.[meal] ?? DEFAULT_REM[meal];
  return !r || r.on === false || typeof r.time !== "string" ? null : r.time;
}

/** Marca de "ya avisado": el día y la hora del aviso. Si cambias la hora, vuelve a avisar. */
export const sentKey = (dia, time) => `${dia} ${time}`;

// ---------- aviso de cambio de alineador ----------
export const DEFAULT_CAMBIO = { time: "10:00", on: true };
const dayNum = dia => Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10)) / 864e5;
const addDia = (dia, n) => new Date((dayNum(dia) + n) * 864e5).toISOString().slice(0, 10);

/** ¿Toca cambiar hoy? lastChange "YYYY-MM-DD" (último cambio marcado), interval en días. */
export function changeDue(lastChange, interval, hoy) {
  if (!lastChange) return null;
  const due = addDia(lastChange, Math.max(1, Number(interval) || 7));
  const late = dayNum(hoy) - dayNum(due);
  return late >= 0 ? { due, late } : null;
}

/** Nº de alineador que se lleva puesto hasta upTo (misma regla que la app). */
export function alignerNumberAt(alineador, changeDays, upTo) {
  const changes = changeDays.filter(d => d <= upTo);
  if (!alineador?.num) return changes.length;
  return Number(alineador.num) + changes.filter(d => d > (alineador.tras || "")).length;
}

/** Solo una revisión envía cada aviso aunque coincidan dos a la vez. */
async function claimSent(db, ref, field, key) {
  return db.runTransaction(async t => {
    const cur = (await t.get(ref)).data()?.lastSent?.[field];
    if (cur === key) return false;
    t.update(ref, { [`lastSent.${field}`]: key });
    return true;
  });
}

async function changeReminders(admin, db, users, now) {
  let sent = 0;
  for (const u of users.docs) {
    const data = u.data(), rem = data.rem;
    if (!rem?.diarioId || !hasDevices(data)) continue;
    const cfg = { ...DEFAULT_CAMBIO, ...(rem.cambio || {}) };
    if (cfg.on === false || typeof cfg.time !== "string") continue;
    const parts = localParts(now, rem.tz || "Europe/Madrid");
    const [h, m] = cfg.time.split(":").map(Number);
    const at = h * 60 + m;
    if (!(parts.mins >= at && parts.mins < at + WINDOW_MIN)) continue;
    const key = sentKey(parts.dia, cfg.time);
    if (data.lastSent?.cambio === key) continue;

    const diario = await db.doc(`diarios/${rem.diarioId}`).get();
    if (!diario.exists) continue;
    const dd = diario.data();
    if (dd.ownerUid !== u.id) {
      const acc = await db.doc(`accesos/${rem.diarioId}__${String(data.email || "").toLowerCase()}`).get();
      if (!acc.exists || acc.data().role !== "editar") continue;
    }
    const changeDays = (await db.collection(`diarios/${rem.diarioId}/dias`).where("cambio", "==", true).get())
      .docs.map(d => d.id).filter(d => d <= parts.dia).sort();
    const st = changeDue(changeDays[changeDays.length - 1], dd.interval, parts.dia);
    if (!st) continue;
    if (!(await claimSent(db, u.ref, "cambio", key))) continue;
    const next = alignerNumberAt(dd.alineador, changeDays, parts.dia) + 1;
    const res = await sendToUser(admin, data, {
      title: "😁 Toca cambiar de alineador",
      body: st.late > 0
        ? `Te toca ponerte el alineador nº ${next} (vas ${st.late} día${st.late > 1 ? "s" : ""} tarde). Toca aquí cuando lo hayas cambiado.`
        : `Hoy toca ponerte el alineador nº ${next}. Toca aquí cuando lo hayas cambiado.`,
      meal: "cambio", dia: parts.dia, diario: rem.diarioId, tipo: "recordatorio"
    }, WINDOW_MIN * 60);
    sent += res.ok;
    console.log(`  cambio de alineador (nº ${next}): enviado a ${res.ok} aparato(s)`);
    const c = cleanup(admin, res);
    if (Object.keys(c).length) await u.ref.update(c);
  }
  return sent;
}

/** Comidas cuyo aviso toca ahora. */
export function dueMeals(rem, parts, lastSent = {}) {
  const out = [];
  for (const meal of MEALS) {
    const r = rem?.[meal] ?? DEFAULT_REM[meal];
    if (!r || r.on === false || typeof r.time !== "string") continue;
    const [h, m] = r.time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const at = h * 60 + m;
    if (parts.mins >= at && parts.mins < at + WINDOW_MIN && lastSent[meal] !== sentKey(parts.dia, r.time)) out.push(meal);
  }
  return out;
}

const LABEL = {
  desayuno: "se ha cepillado después de desayunar",
  comida: "se ha cepillado después de comer",
  cena: "se ha cepillado después de cenar",
  cambio: "ha cambiado de alineador",
  limpieza: "ha limpiado los alineadores"
};
const ORDER = ["cambio", "limpieza", "desayuno", "comida", "cena"];
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

/**
 * Texto del aviso para un seguidor.
 * events: [{campo, dia, por, porNombre}]; done: {dia: {campo: bool}} (estado actual);
 * hoy: "YYYY-MM-DD". Devuelve null si no queda nada que contar.
 */
export function buildFollowMessage(events, done, hoy) {
  const seen = new Set();
  const items = [];
  for (const e of events) {
    if (!LABEL[e.campo] || !e.dia) continue;
    if (!done[e.dia]?.[e.campo]) continue;            // se desmarcó antes de avisar
    const k = e.campo + "|" + e.dia;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push(e);
  }
  if (!items.length) return null;
  items.sort((a, b) => (a.dia === b.dia ? ORDER.indexOf(a.campo) - ORDER.indexOf(b.campo) : a.dia < b.dia ? -1 : 1));
  const names = [...new Set(items.map(e => e.porNombre).filter(Boolean))];
  const who = names.length === 1 ? names[0] : "Diario de Alineadores";
  const lines = items.map(e => {
    const [y, m, d] = e.dia.split("-").map(Number);
    const when = e.dia === hoy ? "" : ` (${d} ${MESES[m - 1]})`;
    const txt = LABEL[e.campo] + when;
    return names.length === 1 ? txt : `${e.porNombre || "Alguien"} ${txt}`;
  });
  const body = lines.map(l => l.charAt(0).toUpperCase() + l.slice(1)).join(" · ");
  return { title: `🦷 ${who}`, body };
}

const isDead = code => code.includes("registration-token-not-registered") || code.includes("invalid-registration-token") || code.includes("invalid-argument");

/**
 * Envía un aviso a todos los aparatos de una persona.
 * - App Android (apptokens): notificación nativa de alta prioridad, como WhatsApp.
 * - Web (tokens): mensaje de datos que muestra el service worker.
 * Devuelve cuántos han llegado a Google y qué registros ya no existen, para borrarlos.
 */
export async function sendToUser(admin, person, data, ttlSec = 21600) {
  const strData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? "")]));
  const out = { ok: 0, deadWeb: [], deadApp: [] };
  const web = person.tokens || [], app = person.apptokens || [];
  if (app.length) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: app,
      notification: { title: strData.title, body: strData.body },
      data: strData,
      android: {
        priority: "high",
        ttl: ttlSec * 1000,
        notification: { channelId: "recordatorios", sound: "default", defaultVibrateTimings: true, color: "#17806F" }
      }
    });
    out.ok += res.successCount;
    res.responses.forEach((r, i) => { if (!r.success && isDead(r.error?.code || "")) out.deadApp.push(app[i]); });
  }
  if (web.length) {
    const res = await admin.messaging().sendEachForMulticast({
      tokens: web, data: strData, webpush: { headers: { Urgency: "high", TTL: String(ttlSec) } }
    });
    out.ok += res.successCount;
    res.responses.forEach((r, i) => { if (!r.success && isDead(r.error?.code || "")) out.deadWeb.push(web[i]); });
  }
  return out;
}

function cleanup(admin, r) {
  const u = {};
  if (r.deadWeb.length) u.tokens = admin.firestore.FieldValue.arrayRemove(...r.deadWeb);
  if (r.deadApp.length) u.apptokens = admin.firestore.FieldValue.arrayRemove(...r.deadApp);
  return u;
}
const hasDevices = d => (d.tokens || []).length + (d.apptokens || []).length > 0;

async function hasAccess(db, diarioId, diarioData, uid, email) {
  if (diarioData.ownerUid === uid) return true;
  if (!email) return false;
  const acc = await db.doc(`accesos/${diarioId}__${String(email).toLowerCase()}`).get();
  return acc.exists && ["ver", "editar"].includes(acc.data().role);
}

async function followNotices(admin, db, now) {
  const evSnap = await db.collectionGroup("eventos").get();
  if (evSnap.empty) return 0;
  const byDiario = new Map();
  for (const ev of evSnap.docs) {
    const diarioRef = ev.ref.parent.parent;
    if (!diarioRef) continue;
    if (!byDiario.has(diarioRef.id)) byDiario.set(diarioRef.id, []);
    byDiario.get(diarioRef.id).push(ev);
  }
  let sent = 0;
  for (const [diarioId, evDocs] of byDiario) {
    const diario = await db.doc(`diarios/${diarioId}`).get();
    const cutoff = now.getTime() - 24 * 3600 * 1000;
    const events = evDocs.map(d => d.data()).filter(e => !e.at || e.at.toMillis() >= cutoff);
    if (diario.exists && events.length) {
      const done = {};
      for (const dia of new Set(events.map(e => e.dia))) {
        const s = await db.doc(`diarios/${diarioId}/dias/${dia}`).get();
        done[dia] = s.exists ? s.data() : {};
      }
      const followers = await db.collection("usuarios").where("avisos.diarioId", "==", diarioId).get();
      for (const f of followers.docs) {
        const fd = f.data();
        if (fd.avisos?.on === false || !hasDevices(fd)) continue;
        if (!(await hasAccess(db, diarioId, diario.data(), f.id, fd.email))) continue;
        const tz = fd.rem?.tz || "Europe/Madrid";
        const msg = buildFollowMessage(events.filter(e => e.por !== f.id), done, localParts(now, tz).dia);
        if (!msg) continue;
        const r = await sendToUser(admin, fd, { ...msg, tipo: "aviso", diario: diarioId });
        sent += r.ok;
        const c = cleanup(admin, r);
        if (Object.keys(c).length) await f.ref.update(c);
      }
    }
    const batch = db.batch();
    evDocs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return sent;
}

async function requestNotices(admin, db) {
  const reqs = await db.collection("solicitudes").where("notificado", "==", false).get();
  let sent = 0;
  for (const r of reqs.docs) {
    const d = r.data();
    const owner = await db.doc(`usuarios/${d.ownerUid}`).get();
    if (owner.exists && hasDevices(owner.data())) {
      const res = await sendToUser(admin, owner.data(), {
        title: "👋 Nueva solicitud",
        body: `${d.nombre || d.email} quiere acceder a tu diario. Ábrelo para aceptarla o rechazarla.`,
        tipo: "aviso", diario: d.diarioId
      });
      sent += res.ok;
      const c = cleanup(admin, res);
      if (Object.keys(c).length) await owner.ref.update(c);
    }
    await r.ref.update({ notificado: true });
  }
  return sent;
}

async function calendarSync(admin, db, users, now) {
  let n = 0;
  for (const u of users.docs) {
    const cal = u.data().calendario;
    if (!cal?.ics || !cal.diarioId || !isValidIcsUrl(cal.ics)) continue;
    const last = cal.ultima?.toMillis?.() || 0;
    if (!cal.forzar && now.getTime() - last < 29 * 60 * 1000) continue;
    const diario = await db.doc(`diarios/${cal.diarioId}`).get();
    if (!diario.exists || diario.data().ownerUid !== u.id) continue;
    const upd = { "calendario.ultima": admin.firestore.Timestamp.fromDate(now), "calendario.forzar": false };
    try {
      const res = await fetch(cal.ics, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(res.status === 404 ? "no_encontrado" : `http_${res.status}`);
      const visitas = dentistVisits(parseICS(await res.text()), now);
      await diario.ref.update({ visitas, visitasAt: admin.firestore.Timestamp.fromDate(now) });
      upd["calendario.error"] = "";
      n++;
    } catch (e) {
      upd["calendario.error"] = String(e.message || e).slice(0, 80);
    }
    await u.ref.update(upd);
  }
  return n;
}

async function main() {
  const { default: admin } = await import("firebase-admin");
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.log("Aún no está el secreto FIREBASE_SERVICE_ACCOUNT (guía, paso 6). No hago nada."); return; }
  let sa;
  try { sa = JSON.parse(raw); }
  catch { throw new Error("El secreto FIREBASE_SERVICE_ACCOUNT no es un JSON válido: vuelve a pegar el archivo .json entero, desde { hasta }."); }
  console.log(`Proyecto: ${sa.project_id} · cuenta: ${sa.client_email}`);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();

  // GitHub lanza las tareas programadas con mucho retraso (a veces una vez por hora).
  // Por eso, cuando viene del horario, el script se queda revisando cada 5 minutos
  // durante LOOP_MINUTES; la siguiente ejecución toma el relevo al acabar.
  const loopMin = Number(process.env.LOOP_MINUTES || 0);
  if (process.env.DIAGNOSE === "1") await diagnose(admin, db);
  const deadline = Date.now() + loopMin * 60 * 1000;
  const every = Number(process.env.CHECK_SECONDS || 300) * 1000;   // cada cuánto revisa dentro de una ejecución
  let fails = 0;
  for (;;) {
    try { await runOnce(admin, db); fails = 0; }
    catch (e) { if (e?.code === 7 || e?.code === 5 || ++fails >= 3 || !loopMin) throw e; console.error("Fallo puntual, reintento:", e.message); }
    if (Date.now() + every > deadline) break;
    await new Promise(r => setTimeout(r, every));
  }
}

// Comprobación rápida al lanzarlo a mano: base de datos y reglas publicadas.
async function diagnose(admin, db) {
  try {
    const n = (await db.collection("usuarios").limit(50).get()).size;
    const d = (await db.collection("diarios").limit(50).get()).size;
    console.log(`✓ Base de datos accesible · usuarios: ${n} · diarios: ${d}`);
  } catch (e) { console.log(`✗ Base de datos: ${e.message}`); throw e; }
  try {
    const rs = await admin.securityRules().getFirestoreRuleset();
    const src = rs.source.map(f => f.content).join("\n");
    const ok = src.includes("Diario de Alineadores") && src.includes("match /codigos/") && src.includes("match /eventos/");
    console.log(ok ? `✓ Reglas de la app publicadas (${rs.createTime})` : "✗ Las reglas publicadas NO son las de la app: pega firestore.rules en Firestore → Reglas → Publicar.");
  } catch (e) { console.log(`? No he podido leer las reglas: ${e.message}`); }
  // Estado de cada persona (sin datos personales: el registro de GitHub es público)
  // y una notificación de prueba a cada móvil registrado.
  const us = await db.collection("usuarios").get();
  let i = 0;
  for (const u of us.docs) {
    const x = u.data(); i++;
    const tokens = [...(x.tokens || []), ...(x.apptokens || [])];
    const r = x.rem || {};
    const horas = MEALS.map(m => `${m} ${r[m]?.on === false ? "off" : (r[m]?.time || DEFAULT_REM[m]?.time || "—")}`).join(", ");
    console.log(`Persona ${i}: aparatos registrados: ${tokens.length} (app Android: ${(x.apptokens || []).length}, web: ${(x.tokens || []).length}) · recordatorios: ${r.diarioId ? horas : "sin guardar"} · último enviado: ${JSON.stringify(x.lastSent || {})}`);
  }
}

async function runOnce(admin, db) {
  const now = new Date();
  console.log(`— ${now.toISOString()}`);
  const users = await db.collection("usuarios").get();
  let sent = 0;

  for (const u of users.docs) {
    const data = u.data();
    const rem = data.rem;
    if (!rem?.diarioId || !hasDevices(data)) continue;
    const parts = localParts(now, rem.tz || "Europe/Madrid");
    const meals = dueMeals(rem, parts, data.lastSent || {});
    if (!meals.length) continue;

    // ¿Sigue teniendo permiso para marcar en ese diario?
    const diario = await db.doc(`diarios/${rem.diarioId}`).get();
    if (!diario.exists) continue;
    let allowed = diario.data().ownerUid === u.id;
    if (!allowed && data.email) {
      const acc = await db.doc(`accesos/${rem.diarioId}__${String(data.email).toLowerCase()}`).get();
      allowed = acc.exists && acc.data().role === "editar";
    }
    if (!allowed) continue;

    const day = await db.doc(`diarios/${rem.diarioId}/dias/${parts.dia}`).get();
    const done = day.exists ? day.data() : {};
    const lastSent = { ...(data.lastSent || {}) };
    const update = {};

    for (const meal of meals) {
      const key = sentKey(parts.dia, remTime(rem, meal));
      lastSent[meal] = key;
      // con revisiones cada minuto pueden coincidir dos a la vez: solo envía la que «reclama» el aviso
      const claimed = await claimSent(db, u.ref, meal, key);
      if (!claimed || done[meal]) continue;
      const res = await sendToUser(admin, data, {
        title: "🪥 Hora de cepillarse",
        body: `¿Te has lavado los dientes después de ${{ desayuno: "desayunar", comida: "comer", cena: "cenar" }[meal]}?`,
        meal, dia: parts.dia, diario: rem.diarioId, tipo: "recordatorio"
      }, WINDOW_MIN * 60);
      sent += res.ok;
      console.log(`  ${meal}: enviado a ${res.ok} aparato(s)`);
      Object.assign(update, cleanup(admin, res));
    }

    if (Object.keys(update).length) await u.ref.update(update);
  }
  // pruebas pedidas desde el botón «Probar» de la app
  for (const u of users.docs) {
    const x = u.data();
    if (!x.pruebaPedida || !hasDevices(x)) continue;
    const r = await sendToUser(admin, x, {
      title: "🔔 Prueba del Diario de Alineadores",
      body: `Si ves esto con la app cerrada, los avisos funcionan (${new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(now)}).`,
      tipo: "aviso"
    }, 900);
    console.log(`Prueba pedida desde la app: entregada a ${r.ok} aparato(s)`);
    await u.ref.update({ pruebaPedida: false, ...cleanup(admin, r) });
  }
  sent += await changeReminders(admin, db, users, now);
  console.log(`Recordatorios enviados: ${sent}`);
  const avisos = await followNotices(admin, db, now);
  console.log(`Avisos a seguidores enviados: ${avisos}`);
  const sol = await requestNotices(admin, db);
  console.log(`Avisos de solicitudes enviados: ${sol}`);
  const cal = await calendarSync(admin, db, users, now);
  console.log(`Calendarios actualizados: ${cal}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    if (e?.code === 7) console.error("⚠️ PERMISSION_DENIED: la clave no tiene permiso en este proyecto. Comprueba que la generaste en Firebase → Configuración del proyecto → Cuentas de servicio del proyecto «diario-alineadores».");
    if (e?.code === 5) console.error("⚠️ NOT_FOUND: no existe la base de datos (default) de Firestore en este proyecto.");
    console.error(e); process.exit(1);
  });
}
