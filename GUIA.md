# Diario de Alineadores — guía

Una app para Android que funciona sola, sin Claude:

- Se entra con **Google**, sin contraseñas.
- Tú creas tu diario y das un **código de invitación** a quien quieras. Esa persona lo escribe en la app, y tú decides si la **aceptas** y con qué permiso: **Solo ver** o **Editar**.
- Notificaciones a la hora del desayuno y de la cena, con un botón **✓ Ya me los he lavado**.
- Quien tenga acceso puede recibir un aviso cada vez que marcas un cepillado, un cambio o una limpieza.
- Tus citas del dentista se leen de tu Google Calendar.
- Funciona sin conexión.

Hay dos partes:

- **Para los demás (2 minutos):** abrir un enlace, pulsar **Instalar**, entrar con Google y escribir el código. Ver [«Cómo entra otra persona»](#cómo-entra-otra-persona).
- **Para ti, una sola vez (unos 30 minutos, desde el ordenador):** crear el proyecto gratuito en Firebase y publicar la app en GitHub. Es lo que hace que la app exista y funcione sin Claude. Pasos 1 a 7.

Todo es gratis y no hace falta tarjeta.

---

## 1. Crea el proyecto de Firebase

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google.
2. **Crear un proyecto** → ponle un nombre (por ejemplo `diario-alineadores`).
3. Cuando pregunte por Google Analytics, puedes desactivarlo. Pulsa **Crear proyecto**.

## 2. Registra la app web y copia la configuración

1. En la página del proyecto, pulsa el icono **`</>`** (Web).
2. Ponle un apodo (por ejemplo `diario`). **No** marques Firebase Hosting. Pulsa **Registrar app**.
3. Te enseñará un bloque `const firebaseConfig = { ... }`.
4. Abre **`config.js`** de esta carpeta y sustituye cada `PEGA_AQUI` por su valor (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

## 3. Clave para las notificaciones

1. En Firebase, ⚙️ → **Configuración del proyecto** → pestaña **Cloud Messaging**.
2. **Configuración web** → **Certificados push web** → **Generar par de claves**.
3. Copia la clave (empieza por `B...`) y pégala en `config.js`, en `vapidKey`.

## 4. Entrar con Google y base de datos

**Entrar con Google**

1. Menú izquierdo → **Compilación → Authentication** → **Comenzar**.
2. En **Método de acceso**, elige **Google**, actívalo, pon tu email de asistencia y guarda.
3. Pulsa **Agregar proveedor nuevo** → **Correo electrónico/contraseña** → activa solo el primer interruptor → **Guardar**. Así se puede crear una cuenta con email, sin Google.

**Base de datos**

1. Menú izquierdo → **Compilación → Firestore Database** → **Crear base de datos**.
2. Ubicación: `europe-southwest1 (Madrid)` o `eur3 (europe)`. Modo: **producción**.
3. Pestaña **Reglas** → borra lo que haya → pega todo el contenido de **`firestore.rules`** → **Publicar**.

Las reglas impiden que alguien sin aceptar, o con «Solo ver», pueda cambiar nada.

## 5. Publica la app en GitHub

1. Crea una cuenta en <https://github.com> si no tienes.
2. **New repository** → nombre `diario-alineadores` → **Public** → **Create repository**.
3. Pulsa **uploading an existing file**, arrastra **todo el contenido** de esta carpeta y pulsa **Commit changes**.
4. Comprueba que se ha subido **`.github/workflows`** con dos archivos. Si no aparece (algunos ordenadores ocultan las carpetas que empiezan por punto): **Add file → Create new file**, nombre `.github/workflows/recordatorios.yml`, pega su contenido y guarda. Repite con `mantener-activo.yml`.
5. **Settings → Pages** → *Branch*: `main` y `/ (root)` → **Save**. En un minuto la app estará en `https://TU-USUARIO.github.io/diario-alineadores/`. **Este es el enlace de tu app.**
6. En Firebase → **Authentication → Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.

## 6. Permiso para enviar notificaciones

1. En Firebase: ⚙️ → **Configuración del proyecto** → **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un `.json`. **No lo compartas ni lo subas al repositorio.**
2. En GitHub, en tu repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: abre el `.json` con el bloc de notas y pega **todo** su contenido.
3. Pestaña **Actions** → si lo pide, pulsa **I understand my workflows, go ahead and enable them**.
4. Para probarlo: **Actions → Recordatorios → Run workflow**. Debe terminar en verde.

## 7. Google Calendar (citas del dentista)

Se conecta una sola vez y luego se actualiza solo cada 30 minutos. No hace falta tocar nada en Google Cloud.

1. Abre **calendar.google.com** en el navegador (en el móvil o la tablet, activa **Sitio de escritorio**).
2. ⚙️ **Configuración** → en la izquierda, toca tu calendario (el que lleva tu nombre).
3. Baja hasta **Integrar el calendario** y copia la **Dirección secreta en formato iCal**.
4. En la app, en **Visitas al dentista**, pégala y pulsa **Conectar**.

La app busca eventos con «dentista», «ortodoncista», «Invisalign» o «clínica dental» en el título, la descripción o el lugar. La dirección secreta solo la guarda tu cuenta; nadie más del diario puede verla. Si algún día la cambias en Google («Restablecer»), desconecta en la app y pega la nueva.

---

## Tu primera vez en la app

1. Abre el enlace de tu app en **Chrome** en el móvil y pulsa **📲 Instalar la app en el móvil**. Si no sale el botón: menú **⋮ → Instalar aplicación**.
2. Ábrela desde el icono y pulsa **Entrar con Google**.
3. Pulsa **Crear mi diario**.
4. En **Ciclo actual**, escribe en **Llevo puesto el nº** el alineador que llevas (por ejemplo, 10). Cada cambio que marques después suma uno. Si ese día también toca cambio, marca primero el cambio.
5. En **Recordatorios en este móvil**, pulsa **Activar**, acepta las notificaciones, elige las horas y pulsa **Guardar horas**.

## Invitar a alguien

1. En tu app, ve a **Personas con acceso**. Ahí está tu **código de invitación** (por ejemplo `K7P-4QX`).
2. Pulsa **Enviar invitación** y mándala por WhatsApp o por donde quieras. Lleva el enlace de la app con el código ya puesto.
3. Cuando esa persona lo use, te llegará una notificación «👋 Nueva solicitud» y la verás en **Pendientes de aceptar**.
4. Elige su permiso y pulsa **Aceptar**, o pulsa **Rechazar**.

| Permiso | Qué ve | Qué puede hacer |
|---|---|---|
| **Solo ver** | El calendario con lo hecho cada día (cepillados, cambios, limpiezas, citas), el nº de alineador y los días que quedan para el próximo cambio | Recibir avisos cuando marcas algo. No puede cambiar nada |
| **Editar** | Toda la app | Marcar y desmarcar todo, cambiar el nº de alineador y el intervalo, poner sus propios recordatorios y recibir avisos |

Puedes cambiar el permiso o quitar el acceso cuando quieras. Si un código ha llegado a quien no debía, pulsa **Cambiar código** y el anterior dejará de servir. Aun así, nadie entra sin que tú le aceptes.

## Cómo entra otra persona

1. Abre el enlace que le has enviado, en Chrome.
2. Pulsa **📲 Instalar la app en el móvil**. Android crea una app con su icono, como cualquier otra, sin descargar archivos ni dar permisos raros.
3. Abre la app y pulsa **Entrar con Google**.
4. El código ya viene puesto, así que la solicitud se envía sola. Si entró sin el enlace, escribe el código y pulsa **Pedir acceso**.
5. En cuanto la aceptes, el diario se le abre solo.
6. Para recibir avisos de lo que marcas: en **Avisos de lo que se marca**, pulsa **Activar**.

---

## ¿Y un archivo APK?

Al pulsar **Instalar**, Chrome crea en Android una app de verdad (una «WebAPK»): tiene su icono, se abre a pantalla completa y aparece en los ajustes como cualquier otra app. Es más sencillo y seguro que un `.apk` suelto, porque no hay que activar «instalar apps de origen desconocido».

Si aun así quieres un archivo `.apk` para pasarlo:

1. Entra en <https://www.pwabuilder.com>, pega el enlace de tu app y pulsa **Start**.
2. **Package for stores → Android → Generate Package**, y descarga el zip. Dentro está el `.apk`.
3. Para que se abra sin la barra de direcciones arriba, PWABuilder te da un archivo `assetlinks.json`. Hay que publicarlo en `https://TU-USUARIO.github.io/.well-known/assetlinks.json`, lo que necesita un segundo repositorio llamado `TU-USUARIO.github.io`. Sin ese paso el APK funciona igual, pero se ve una barra fina arriba.

---

## Bueno saber

- **Retraso de los avisos:** GitHub los envía cada 10 minutos y a veces con algo de retraso. Los recordatorios llegan unos minutos después de la hora, y los avisos a los demás entre 1 y 15 minutos después de marcar.
- **Recordatorio ya marcado:** si a la hora del aviso ya lo has marcado, no se envía. Si no se pudo enviar en los 90 minutos siguientes a la hora elegida, ese día se salta.
- **Cada móvil, sus avisos:** las notificaciones se activan en cada móvil. Si alguien cambia de móvil, vuelve a pulsar **Activar**.
- **Actualizar la app:** si cambias algún archivo, súbelo a GitHub. La app se actualiza sola la próxima vez que se abra con internet.
- **Coste:** con el uso de una familia estás muy por debajo de los límites gratuitos de Firebase y GitHub.
