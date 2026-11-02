// Lee las citas del dentista de la «dirección secreta en formato iCal» de Google Calendar.
// No necesita permisos de Google: el dueño del diario pega esa dirección en la app una vez
// y el script de GitHub la consulta cada 30 minutos.

export const KEYWORDS = /dentist|ortodon|odontol|invisalign|alineador|cl[ií]nica dental|dental/i;

/** Convierte una hora «de pared» en una zona horaria a un Date en UTC. */
export function wallTimeToDate(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = t => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);              // segunda pasada por si cae en un cambio de hora
  return new Date(t);
}

const unescape = v => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** Analiza un .ics y devuelve los eventos: [{title, desc, location, allDay, date}] (date: "YYYY-MM-DD" o ISO). */
export function parseICS(text, defaultTz = "Europe/Madrid") {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let ev = null, calTz = defaultTz;
  for (const line of lines) {
    if (line.startsWith("X-WR-TIMEZONE:")) calTz = line.slice(14).trim() || calTz;
    if (line === "BEGIN:VEVENT") { ev = {}; continue; }
    if (line === "END:VEVENT") { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const value = line.slice(i + 1);
    const prm = Object.fromEntries(params.map(p => p.split("=")));
    if (name === "SUMMARY") ev.title = unescape(value);
    else if (name === "DESCRIPTION") ev.desc = unescape(value);
    else if (name === "LOCATION") ev.location = unescape(value);
    else if (name === "STATUS") ev.status = value.trim();
    else if (name === "DTSTART") ev.start = { value: value.trim(), tz: prm.TZID, isDate: prm.VALUE === "DATE" || /^\d{8}$/.test(value.trim()) };
  }
  const out = [];
  for (const e of events) {
    if (!e.start || e.status === "CANCELLED") continue;
    const v = e.start.value;
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) continue;
    const [, y, mo, d, h, mi, s, z] = m;
    let date, allDay = false;
    if (e.start.isDate || h === undefined) { allDay = true; date = `${y}-${mo}-${d}`; }
    else if (z) date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
    else date = wallTimeToDate(+y, +mo, +d, +h, +mi, +s, e.start.tz || calTz).toISOString();
    out.push({ title: e.title || "", desc: e.desc || "", location: e.location || "", allDay, date });
  }
  return out;
}

/** Citas del dentista dentro de la ventana (120 días atrás, 365 adelante), ordenadas. */
export function dentistVisits(events, now = new Date()) {
  const from = now.getTime() - 120 * 864e5, to = now.getTime() + 365 * 864e5;
  const seen = new Set();
  return events
    .filter(e => KEYWORDS.test(e.title) || KEYWORDS.test(e.desc) || KEYWORDS.test(e.location))
    .filter(e => { const t = new Date(e.allDay ? e.date + "T12:00:00Z" : e.date).getTime(); return t >= from && t <= to; })
    .filter(e => { const k = e.title + e.date; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(e => ({ title: e.title || "Dentista", allDay: e.allDay, date: e.date }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function isValidIcsUrl(u) {
  return /^https:\/\/calendar\.google\.com\/calendar\/ical\/[^/]+\/private-[a-z0-9]+\/basic\.ics$/i.test(String(u || "").trim());
}
