# Diario de Alineadores

App para Android (PWA) para llevar el registro de los alineadores: cepillados después de desayunar, comer y cenar, cambios y limpiezas de alineadores, y visitas al dentista leídas de Google Calendar. Con cuentas propias, permisos de **Solo ver** / **Editar** y recordatorios en el móvil.

👉 Para instalarla, sigue **[GUIA.md](GUIA.md)**.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app completa |
| `config.js` | Tus datos de Firebase (hay que rellenarlo) |
| `sw.js` | Funcionamiento sin conexión y notificaciones |
| `manifest.webmanifest`, `icons/` | Para instalarla como app |
| `firestore.rules` | Reglas de seguridad (quién puede ver y editar) |
| `scripts/recordatorios.mjs` | Envía los recordatorios |
| `.github/workflows/` | Ejecuta los recordatorios cada 10 minutos |
