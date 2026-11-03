// Prepara todo lo que necesita la app Android antes de compilarla. Lo ejecuta GitHub Actions.
// 1. Registra la app Android en Firebase (si aún no existe).
// 2. Crea o recupera la clave de firma del APK (guardada en Firestore, en un sitio que
//    ninguna persona puede leer desde la app; solo esta cuenta de servicio).
// 3. Registra la huella de esa clave en Firebase (necesario para «Entrar con Google»).
// 4. Descarga google-services.json para la compilación.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const PACKAGE = "io.github.pmorenod16.diario";
const ALIAS = "diario";
const [, , ksPath, gsPath] = process.argv;
if (!ksPath || !gsPath) throw new Error("Uso: node android-setup.mjs <keystore> <google-services.json>");

const { default: admin } = await import("firebase-admin");
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const PID = sa.project_id;
const cred = admin.credential.cert(sa);
admin.initializeApp({ credential: cred });
const db = admin.firestore();
const API = "https://firebase.googleapis.com/v1beta1";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
  const { access_token } = await cred.getAccessToken();
  const res = await fetch(path.startsWith("http") ? path : `${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// ---------- 1. App Android en Firebase ----------
let appId;
const list = await api("GET", `projects/${PID}/androidApps?pageSize=100`);
const found = (list.apps || []).find(a => a.packageName === PACKAGE);
if (found) { appId = found.appId; console.log(`✓ App Android ya registrada en Firebase (${PACKAGE})`); }
else {
  console.log(`Registrando la app Android ${PACKAGE} en Firebase…`);
  let op = await api("POST", `projects/${PID}/androidApps`, { packageName: PACKAGE, displayName: "Diario de Alineadores (Android)" });
  for (let i = 0; i < 30 && !op.done; i++) { await sleep(2000); op = await api("GET", op.name); }
  if (op.error) throw new Error("Firebase no ha podido crear la app Android: " + JSON.stringify(op.error));
  appId = op.response?.appId;
  if (!appId) throw new Error("Firebase no ha devuelto el identificador de la app Android.");
  console.log("✓ App Android registrada en Firebase");
}

// ---------- 2. Clave de firma ----------
const ref = db.doc("_privado/android");
const snap = await ref.get();
let pass;
if (snap.exists && snap.data().keystore) {
  pass = snap.data().pass;
  writeFileSync(ksPath, Buffer.from(snap.data().keystore, "base64"));
  console.log("✓ Clave de firma recuperada");
} else {
  pass = randomBytes(18).toString("base64url");
  execFileSync("keytool", ["-genkeypair", "-keystore", ksPath, "-alias", ALIAS, "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000", "-storepass", pass, "-keypass", pass, "-dname", "CN=Diario de Alineadores"], { stdio: "ignore" });
  await ref.set({ keystore: readFileSync(ksPath).toString("base64"), pass, creada: new Date() });
  console.log("✓ Clave de firma nueva creada y guardada");
}
if (process.env.GITHUB_ENV) {
  console.log(`::add-mask::${pass}`);
  appendFileSync(process.env.GITHUB_ENV, `KS_FILE=${ksPath}\nKS_PASS=${pass}\n`);
}

// ---------- 3. Huellas SHA en Firebase ----------
const out = execFileSync("keytool", ["-list", "-v", "-keystore", ksPath, "-alias", ALIAS, "-storepass", pass], { encoding: "utf8" });
const sha = name => (out.match(new RegExp(`${name}:\\s*([0-9A-F:]+)`, "i")) || [])[1]?.replace(/:/g, "").toLowerCase();
const sha1 = sha("SHA1"), sha256 = sha("SHA256");
if (!sha1 || !sha256) throw new Error("No he podido leer las huellas de la clave de firma.");
const have = (await api("GET", `projects/${PID}/androidApps/${appId}/sha`)).certificates || [];
for (const [hash, type] of [[sha1, "SHA_1"], [sha256, "SHA_256"]]) {
  if (have.some(c => c.shaHash?.toLowerCase() === hash)) { console.log(`✓ Huella ${type} ya registrada`); continue; }
  await api("POST", `projects/${PID}/androidApps/${appId}/sha`, { shaHash: hash, certType: type });
  console.log(`✓ Huella ${type} registrada en Firebase`);
}

// ---------- 4. google-services.json ----------
let cfg, tries = 0;
do {
  if (tries) await sleep(5000);
  const r = await api("GET", `projects/${PID}/androidApps/${appId}/config`);
  cfg = JSON.parse(Buffer.from(r.configFileContents, "base64").toString("utf8"));
  tries++;
} while (tries < 6 && !(cfg.client?.[0]?.oauth_client || []).some(c => c.client_type === 1));
writeFileSync(gsPath, JSON.stringify(cfg, null, 2));
const types = (cfg.client?.[0]?.oauth_client || []).map(c => c.client_type);
console.log(`✓ google-services.json descargado (clientes OAuth: ${types.join(", ") || "ninguno"})`);
if (!types.includes(1)) console.log("⚠️ Aún no hay cliente OAuth de Android: «Entrar con Google» en la app podría fallar hasta la próxima compilación.");
if (!types.includes(3)) console.log("⚠️ No hay cliente OAuth web: activa Google en Authentication → Método de acceso.");
