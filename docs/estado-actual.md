# Estado actual — 18/09/2026

## Alcance

- Administración de edificios, departamentos, planes, mensualidades y pagos manuales.
- Abonos, recibos firmados, impresión y reversión de pagos conservados.
- Portal de consulta de cuenta, recibos y consumo.
- Sin cobros bancarios, transferencias reportadas, configuración bancaria ni QR. Los métodos bancarios de pagos antiguos se conservan como historial; no se admiten para nuevos pagos (solo `cash` y `other`).
- Sin envíos de notificaciones a residentes: la función de WhatsApp y las tablas de recordatorios, notificaciones y reportes bancarios se retiraron del código y de la base.
- El mensaje de suspensión y el contacto del portal se configuran mediante `NUWENET_SUSPENSION_MESSAGE` y `NUWENET_ADMIN_CONTACT`.

## Capa de datos

El mapa de la capa de datos —qué archivo es dueño de qué pieza, en qué orden se aplican las migraciones y cómo se añade una— vive en el encabezado de `apps/api/src/database/migrations/index.ts`. Este documento no lo repite: aquí solo queda el estado.

- Migraciones 1 a 28 aplicadas en `nuwenet`, esquema `public`, más los dos pasos que se repiten en cada arranque (reparación de enlaces sin hash y semilla de la clave de firma de recibos). Se añade una migración como una entrada más en ese registro.
- 27 tablas, todas con `id UUID` (versión 7) como clave primaria; las claves naturales anteriores quedaron como restricciones únicas y ninguna columna de identificador numérica sobrevive. La migración 26 convirtió las claves que eran enteros y la 27 las tablas que aún tenían clave natural o ningún `id`.
- La migración 28 archivó y retiró `payment_reports`, `reminder_deliveries`, `notifications` y `whatsapp_receipts`, funciones que el código ya no usa. El contenido retirado queda en `retired_rows` dentro del esquema, así que viaja en cualquier respaldo posterior; en `nuwenet` está vacío porque esa base nunca tuvo esas tablas.

## Trabajo realizado en la instalación local

- Base `nuwenet`, esquema `public`, actualizada de la migración 1 a la 28.
- Conteos comprobados antes y después: 0 departamentos y 0 mensualidades.
- **Respaldos:** el paquete verificado más reciente es del **15/09 19:15 UTC**, anterior a las migraciones 26–28: **no hay ningún respaldo posterior a la conversión de identificadores**. Ese volcado trae 25 tablas (ninguna `retired_rows`) y sí los datos de `schema_migrations`, así que restaurarlo devuelve el registro a la era previa y el siguiente arranque vuelve a ejecutar 25–28, incluida la conversión de identificadores. Los tres paquetes anteriores (10/09 y 11/09) están vaciados y solo conservan un `router.key` huérfano. El camino de vuelta desde una base con identificadores enteros está ensayado con `bun scripts/upgrade-rehearsal.mjs`.
- Clave de recuperación generada y guardada en `BACKUP_ENCRYPTION_KEY` dentro del `.env` local. Conservarla para restaurar los respaldos.
- Servidor local iniciado en `http://127.0.0.1:3000` (API y frontend compilado) con el código actual: autenticación, portal y página de corte responden 200 y la ruta del archivo responde 401 sin sesión. El servidor de desarrollo Astro escucha en `http://127.0.0.1:4321`.
- El proceso iniciado es local; no se ha instalado una tarea ni un servicio de arranque automático, ni publicado un dominio.
- Corregidos los permisos del aprovisionador y del script CLI de MikroTik a `read,write,rest-api`, conforme a la [documentación oficial](https://manual.mikrotik.com/docs/authentication-authorization-accounting/user/). Verificado con respuestas simuladas.

## Pendientes que requieren datos reales

1. Definir si se usará este equipo o una VPS, y el dominio o dirección de acceso.
2. Identificar y registrar el MikroTik central de cada edificio y configurar su acceso desde el servidor.
3. Registrar el departamento piloto, su plan y sus dispositivos/IP reales.
4. Configurar conjuntamente `NUWENET_PORTAL_IP` y `NUWENET_PUBLIC_URL`, la conectividad y el acceso al servidor.
5. Probar físicamente suspensión, reactivación, límite compartido de velocidad y acceso al portal durante el corte; comprobar IPv6 y FastTrack en la red elegida.

La instalación actual tiene un edificio predeterminado, ningún router y ningún departamento. No se realizaron cortes físicos ni se inventaron datos de residentes. El diagnóstico del 11/09 es histórico y no describe esta instalación actual.

## Verificación

Comprobación de tipos y avisos sin errores. La suite quedó en **67 pruebas aprobadas en 21 archivos, 0 fallos**, y la prueba completa de interfaz (Chromium) también pasó. Las versiones aplicadas y pendientes se consultan, sin efectos, con `bun run db:status`; aplicar lo pendiente es `bun run db:migrate`, el mismo código que usa el arranque de la API.

Además del recorrido habitual (registros, validaciones, cobros concurrentes, permisos), la suite cubre la capa de datos: esquema recién creado, doble arranque simultáneo, base anterior a la migración 27 con datos, base anterior a la 28 con datos, retiro concurrente de las tablas heredadas, identificadores UUID v7 (formato, versionado, orden temporal) y el archivo retirado.

Los endpoints bancarios retirados devuelven 404 con sesión; los métodos de pago `transfer` y `qr` se rechazan con 400.

Para repetir el diagnóstico de instalación (requisitos de puesta en marcha, no del esquema): `bun scripts/preflight-pro.mjs`.

## Optimizaciones aplicadas

La migración 24 incorporó índices de vencimiento y la aplicación reparte el trabajo en ciclos independientes. El detalle y las mediciones están en [optimizaciones aplicadas](optimizaciones-aplicadas.md); las migraciones posteriores no revirtieron ninguna de esas decisiones.
