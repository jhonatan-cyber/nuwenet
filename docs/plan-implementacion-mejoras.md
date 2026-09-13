# Plan de implementación de mejoras de NuweNet

Fecha: 12 de septiembre de 2026. Estado: en implementación; fases A y B (B1–B9) validadas localmente. Integración continua remota pendiente de repositorio/proveedor.

Objetivo: completar la operación con residentes, corregir los riesgos detectados y preparar el crecimiento sin perder la integridad de cobros, el aislamiento entre edificios ni el control de red existente.

Este documento organiza el trabajo y registra los avances verificados. Las estimaciones son orientativas para una persona que conoce el proyecto; excluyen esperas por equipos, banco, proveedor de WhatsApp e infraestructura.

**Registro de ejecución — 12/09/2026**

**Actualización — 13/09/2026: departamentos con shadcn**

- [x] Listado de Departamentos y Resumen, búsqueda, filtros, paginación, alta y edición migrados a componentes compartidos.
- [x] Conservados permisos, edificio activo, plan opcional y entrega única del portal. Eliminados el generador anterior y cuatro reglas CSS del buscador.
- [x] Tipos sin errores, compilación y recorrido UI ampliado aprobados; aislamiento entre edificios y portal aprobados. Revisión móvil/escritorio con ambos temas.
- [x] Diálogos de consumo, portal/enlace único, regeneración, cambio de titular, IP, archivo/restauración y corte/reactivación migrados a React/shadcn. La gráfica de consumo conserva su implementación compartida con el portal; Estado de cuenta sigue navegando a los cobros filtrados.
- [x] Validación ampliada: error/reintento en consumo, selección de día con teclado, IP inválida/asignación/eliminación, regeneración sin doble envío, enlace disponible aunque falle la recarga, invalidación del acceso anterior y cambio de titular. Diálogos comprobados en 1440/390 px, claro/oscuro, sin desbordamiento horizontal.
- [x] Mensualidades y pagos migrados a React/shadcn (`BillingPanel` + `billing-store`; generar, pagar/abonar, revertir, recibo/impresión, vencimientos, paginación y estado de cuenta). Reportes WhatsApp/banco conservados vía `data-action`.
- [x] Operaciones migradas a React/shadcn (`OperationsPanel` + `operations-store`; edificios, configuración con `operations-form`, usuarios, respaldos y auditoría). Eliminado `scripts/operations.js`.
- [x] Routers migrados a React/shadcn (`RoutersPanel` + `routers-store`; listado, detalle, controles por IP, tráfico, descubrimiento, vinculación, servicios y aprovisionamiento). Eliminado `scripts/routers.js`. F2–F3 del panel completadas: cuenta, planes, departamentos, cobros, operaciones y routers.

**Actualización — 13/09/2026: planes con shadcn**

- [x] Listado y formularios de planes migrados a React/shadcn; eliminado el generador HTML anterior.
- [x] Integración con permisos, moneda y edificio del dashboard; cierre al cambiar de contexto, errores visibles y bloqueo de envíos duplicados.
- [x] Pruebas de creación/edición, precio histórico y futuro, velocidades y aislamiento entre edificios; vista móvil/escritorio y ambos temas. Retirados 16 selectores antiguos de planes.
- [x] Listado y formularios de departamentos implementados en la siguiente entrega. La migración completa de F2–F3 sigue pendiente.

Detalle y evidencia de las entregas (cuenta, planes, departamentos y cobros) en [estilos y componentes](estilos-y-componentes.md).

**Actualización — 13/09/2026: piloto shadcn**

- [x] Integración React + Tailwind y componentes locales shadcn Button, Input, Card, Dialog y Switch, con configuración y licencia.
- [x] Preferencias y perfil migrados a una isla React tipada; estado compartido con la barra del panel, persistencia y cambio de contraseña real.
- [x] CSS nuevo delimitado, sin Preflight global; retirados selectores exclusivos del diálogo anterior. [Detalles de la migración](estilos-y-componentes.md).
- [x] Validación del piloto: tipos sin errores/advertencias/hints, compilación sin advertencias CSS, recorrido UI ampliado y prueba del portal aprobados; revisión visual de claro/oscuro, móvil y escritorio. La prueba de contraseña usa una cuenta temporal.
- [ ] Migración de los demás módulos a componentes: continúa pendiente en F2–F3.

- [x] Limpieza inicial de estilos (adelanto parcial de F3): retiradas 35 apariciones de clases sin referencias y 839 declaraciones reemplazadas por reglas posteriores; eliminados comentarios de temas antiguos. Detalles y propuesta de migración gradual a shadcn en [estilos y componentes](estilos-y-componentes.md). F3 no se considera terminado: la conversión de vistas a componentes sigue pendiente.

- [x] A1. Servidor UI con `--no-env-file`, lista permitida de variables del sistema, PostgreSQL y respaldos temporales, WhatsApp deshabilitado y bloqueo de HTTP saliente. Limpieza limitada al directorio temporal verificado. Captura de errores fuera de `data/`.
- [x] A2. Smoke UI actualizado y aprobado: confirma vencimientos, archivo, restauración, reactivación y eliminación de conexión; utiliza el formulario actual de administradores, opciones avanzadas de router y etiquetas actuales de respaldo/auditoría. Verifica persistencia tras recarga y vista móvil.
- [x] A3. Código de instalación ausente e incorrecto rechazados por HTTP; código válido utilizado desde el navegador. La suite de autenticación conserva y aprueba la instalación local sin código.
- [x] A4 (local). Añadido `bun run verify`: tipos, compilación, suite e interfaz en secuencia, con una sola compilación.
- [ ] A4 (remoto). Integración continua pendiente: no hay repositorio Git ni proveedor CI configurados en esta carpeta.
- [x] A5. Suite PostgreSQL ejecutada con `.env.postgres`: 1 prueba aprobada, 0 fallos. Utiliza una base `nuwenet_test_*`, dos instancias y limpieza al terminar; avisos y portal de corte deshabilitados en los procesos de prueba.
- [x] A6. README, operación y guía Pro actualizados para WhatsApp, capacidades ARRIS/OpenWrt, consumo persistente y límites de verificación física. Diagnóstico del 11/09 identificado como histórico.

Evidencia: `bun run verify` terminó con código 0: tipos sin errores/advertencias, compilación correcta, 37 pruebas aprobadas y una omitida por motor, más el recorrido UI completo. La prueba omitida fue ejecutada por separado mediante `bun --env-file=.env.postgres test ./test/postgres.test.js` y aprobó. Estas pruebas no acreditan cortes físicos ni envíos reales.

Archivos de esta entrega: `scripts/smoke-ui.mjs`, `scripts/ui-test-server.mjs`, `test/postgres.test.js`, `package.json`, README y guías. Las fases B–G siguen pendientes; la próxima entrega es B1–B4 (ciclo de vida del enlace y validación coherente del portal).

**Registro de ejecución — 12/09/2026 (B1–B4)**

- [x] B1. Migración 21 (`access_issued_at`, `access_expires_at`, `access_version`): enlaces existentes conservados sin caducidad, solo con emisión registrada. Nuevo ajuste `portal_link_days` (0 = sin caducidad) aplicado al crear/rotar. Pagos e historial intactos.
- [x] B2. `POST /api/customers/portal-link`: rotación atómica, solo super-admin o admin autorizado del edificio; invalida el anterior de inmediato y audita sin guardar el token.
- [x] B3. `POST /api/customers/change-holder`: cambio explícito de titular (nombre + teléfono opcional) que invalida el acceso anterior; separado de `customers/update`. La entrega del nuevo enlace es otra operación (modal “Portal del residente”).
- [x] B4. Validación única del portal para datos, tráfico, consumo (`UsageService.history`) y reportes: formato, archivo, edificio deshabilitado y caducidad con el mismo mensaje genérico. Dashboard muestra emisión/caducidad/versión y acciones de regenerar/cambio.
- [x] Verificación: `bun run check` y `bun run build` sin errores; suites `pro`, `usage`, `auth`, `building-isolation`, `pro-http`, `reliability`, `integration` y `router-adapters` aprobadas por separado; script ad-hoc B1–B4 (rotación concurrente, expiración, cambio titular, auditoría sin token) aprobado. `bun test ./test` completo no se pudo cerrar en una sola pasada en Windows (tiempos de arranque de servidores); `department-adapter`/`router-detection` fallan al cargarse juntos por `require(@nestjs/common)` frente a import ESM, preexistente y ajeno a este cambio.

Archivos de esta entrega B: `apps/api/src/database/database.service.ts` (migración 21), `apps/api/src/management/management.service.ts`, `usage.service.ts`, `management.controllers.ts`, `dto.ts`, `apps/web/src/scripts/dashboard.js`. Siguen pendientes B5–B9 (hash de tokens, rate-limit central, guards, auditoría transaccional) y fases C–G.

**Registro de ejecución — 12/09/2026 (B5–B9)**

- [x] B5. Enlace como hash SHA-256 en reposo (migración 22 + reparación en arranque): el completo solo existe al emitirlo y se devuelve una sola vez (`portal_link` en crear/rotar/cambiar titular); el estado expone metadatos (`has_portal_link`, emisión, caducidad, versión), nunca el token. Filas heredadas con plain válido se hashean preservando validez; filas sin hash utilizable reciben enlace nuevo. Dashboard muestra el enlace una vez con aviso de copia. `portal_link_days` configurable también en la pantalla de configuración.
- [x] B6. Límites por IP en portal público (`/portal/traffic` 20/min, `/portal` y `/portal/usage` 60/min; `/portal/report` ya tenía 10/min) más caché breve de tráfico por router (20 s, memoria por instancia). Coordinación central entre instancias queda documentada como pendiente.
- [x] B7. `Roles()` + `RolesGuard` global como autorización canónica (el middleware de rutas de `main.ts` se conserva como defensa en profundidad). Actor de sistema explícito (`SYSTEM_ACTOR`/`runAsSystem`): la ausencia de contexto ya no otorga privilegios; el scheduler corre como sistema y la lectura de router del portal público usa alcance del token + sistema. Guards verificados: admin no gestiona red/usuarios/auditoría/respaldos, otro edificio no rota ni cambia titular, sin sesión 401.
- [x] B8. `security_events` independiente del rollback del negocio (login, login fallido, throttling, setup denegado); el logout nunca se bloquea por un fallo secundario de registro. Eventos de negocio críticos ya se registraban dentro de su transacción (`events`).
- [x] B9. `audit_log` con edificio, operación, recurso, resultado, fecha y correlación (formato histórico de `action` conservado para la interfaz); sin cuerpos, contraseñas, cookies ni tokens. Sin descarte silencioso: fallos visibles en stderr y contador en `GET /api/health` (público, sin secretos). Retención de 180 días para auditoría y seguridad en la tarea de sesiones. Acceso a auditoría solo super-admin.
- [x] Verificación: `bun run check` y `bun run build` sin errores; suites `pro`, `usage`, `reliability`, `auth`, `integration`, `router-adapters`, `building-isolation` y `pro-http` aprobadas; `scripts/smoke-ui.mjs` completo aprobado (incluye enlace único al crear y fila de auditoría con id). Scripts ad-hoc: hash/rotación concurrente/caducidad/titular/migración heredada/seguridad-independiente y HTTP (health, 429 en tráfico, guards, 403 entre edificios, `login_failed` en `security_events`) aprobados. Preexistentes sin tocar: `department-adapter`/`router-detection` fallan al cargarse juntos por `require(@nestjs/common)` frente a import ESM; `bun test ./test` completo en una pasada excede tiempos en Windows, por eso se corrió por grupos.

Archivos de esta entrega B5–B9: `database.service.ts` (migraciones 22–23 + reparación), `management.service.ts`, `usage.service.ts`, `management.controllers.ts`, `usage.controllers.ts`, `routers.controller.ts`, `routers.service.ts`, `auth.controller.ts`, `scheduler.service.ts`, `main.ts`, `app.module.ts`, `common/` (`request-context.ts`, `roles.decorator.ts`, `roles.guard.ts`, `audit.interceptor.ts`, `security.ts`, `health.controller.ts`), `dto.ts`, `dashboard.js`, `operations.js` (campo `portal_link_days`), `scripts/smoke-ui.mjs`, `test/` (`pro`, `usage`, `reliability`, `router-adapters`, `pro-http`, `building-isolation`). Siguen pendientes las fases C–G.

**Registro de ejecución — 13/09/2026 (Fase C)**

- [x] C4. El aviso de una orden ya no decide su resultado: si `notify` falla tras aplicarse la regla, la orden conserva `applied`/`simulated` y solo se registra el fallo en stderr. Nueva prueba en `test/tasks.test.js` (el aviso caído no repite la orden).
- [x] C1/C2. Cada trabajo del tick (`linked`, `network`, `notifications`, más `usage` y las tareas por intervalo) falla aislado con aviso en log; la exclusión distribuida por `task_locks` y el orden por departamento se conservan.
- [x] C3. La cola procesa hasta 10 órdenes por pasada con presupuesto de 4 minutos; el timeout REST de 12 s se mantiene.
- [x] C5/C6. Diagnóstico por tarea en `settings` (`task:<nombre>` con última ejecución, éxito, duración y error), expuesto en `automation.tasks` y rezago de cola en `automation.queue` del estado, conteos en `GET /api/health` y tabla Tareas automáticas en Actividad. Umbrales iniciales en la guía de operación. El contrato anterior del tick (propagar el error) se actualizó en `test/usage.test.js`.
- [x] Verificación: `tsc` API y `astro check` limpios, compilación correcta, smoke UI y suites `tasks/usage/reliability/pro/auth/integration/router-adapters/building-isolation/pro-http` en verde por grupos.

Archivos de esta entrega C: `management.service.ts` (C3/C4), `scheduler.service.ts` (diagnóstico y aislamiento), `snapshot.ts` (`automation.tasks/queue`), `health.controller.ts` (conteos de cola), `dashboard.js` (tabla en Actividad), `test/tasks.test.js`, `test/usage.test.js`, `docs/operacion.md`. Siguen pendientes D–G (más F1/F4 y A4 remoto).

**Registro de ejecución — 13/09/2026 (Fase D)**

- [x] D1. Paquete cifrado con clave de recuperación separada (`BACKUP_ENCRYPTION_KEY`, AES-256-GCM por streaming, huella de clave en el manifiesto); sin la variable se conserva el formato heredado sin cifrar (no apto para producción).
- [x] D2. Custodia, rotación y permisos documentados en la guía de operación (clave separada, offline, rotación hacia adelante, ACL en Windows).
- [x] D3. Hashes y cifrado por streaming (sin cargar archivos completos en memoria); copia externa real con fallo visible por volumen ausente; retención que nunca borra copias no verificables.
- [x] D4. Verificación y restauración para ambos formatos (clave incorrecta, ausente, corrupción y truncado rechazados con mensajes distintos); `restore-backup.mjs` restaura a directorio nuevo y verifica la copia restaurada.
- [x] D5. PostgreSQL: el script verifica el paquete y muestra el `pg_restore` hacia una base nueva sin tocar la base en uso; documentado con `ROUTER_ENCRYPTION_KEY`.
- [x] D6. Objetivos RPO 24 h y RTO 2 h documentados con simulacro obligatorio.
- [x] Verificación: `tsc`/`astro check` limpios, compilación correcta, smoke UI y suites `backup/reliability/tasks/usage/pro/auth/integration/router-adapters/building-isolation/pro-http` en verde por grupos.

Archivos de esta entrega D: `backup-crypto.ts` (nuevo), `backup.service.ts`, `backup-policy.ts`, `scripts/restore-backup.mjs`, `test/backup.test.js`, `test/reliability.test.js` (verify asíncrono), `docs/operacion.md`. Siguen pendientes E–G (más F1/F4 y A4 remoto).

**1. Punto de partida y alcance**

La revisión del 12/09/2026 obtuvo: comprobación de tipos sin errores ni advertencias, compilación correcta, 37 pruebas aprobadas, ninguna fallida y una prueba PostgreSQL omitida. La prueba general de interfaz no terminó: heredaba SETUP_TOKEN y, al aislar esa variable, no atendía la confirmación de revisión de vencimientos.

La inspección local encontró SQLite con migraciones hasta la versión 20, un edificio, un ARRIS registrado y ningún departamento. Faltan MikroTik central, datos bancarios, configuración del portal accesible por residentes y credenciales de WhatsApp; el envío está deshabilitado. El estado guardado del ARRIS no equivale a una comprobación física reciente.

Se conservan los importes en centavos, las claves de idempotencia, las reversiones con historial, los bloqueos manuales, la separación por edificio y las órdenes persistentes. No se presume capacidad para un número determinado de clientes hasta medirla.

| Prioridad | Significado |
|---|---|
| P0 | Necesario antes de depender del sistema para un piloto operativo. |
| P1 | Necesario antes de ampliar el piloto o publicar el portal. |
| P2 | Mejora de capacidad y mantenimiento posterior a una base estable. |

El alcance comprende las ocho debilidades de la revisión y la configuración pendiente. No incluye facturación fiscal, conciliación bancaria automática, nuevos adaptadores completos ni una implementación general de IPv6. Si la red piloto permite eludir el corte por IPv6, resolver esa condición es requisito de activación; no se declarará corte completo mientras persista.

**2. Fases, dependencias y esfuerzo**

| Fase | Resultado | Prioridad | Dependencias | Esfuerzo orientativo |
|---|---|---|---|---|
| A | Validación reproducible y documentación coherente | P0 | Ninguna | 2–3 días |
| B | Portal revocable, permisos explícitos y auditoría confiable | P0/P1 | A | 4–6 días |
| C | Automatizaciones independientes y diagnóstico operativo | P0/P1 | A; eventos de B para trazabilidad | 3–5 días |
| D | Respaldos protegidos y recuperación demostrada | P0/P1 | A | 2–4 días |
| E | Configuración y piloto de un departamento | P0 | A–D; equipos y datos operativos | 3–5 días |
| F | Separación de servicios y comprobación del frontend | P2 | A; contratos estables de B–E | 4–6 días |
| G | Prueba PostgreSQL, carga y mejora de concurrencia | P2 | A para validar PostgreSQL; C y F antes de optimizar | 3–5 días |

Total orientativo: 21–34 días efectivos, aproximadamente 5–7 semanas de trabajo. La preparación de datos e infraestructura de E puede avanzar desde A. La ejecución PostgreSQL comienza en A si existe un entorno de pruebas, aunque la optimización corresponde a G.

**3. Fase A — Recuperar una base de validación confiable**

- A1. Aislar el entorno de `scripts/smoke-ui.mjs`: base y respaldos temporales, control explícito de SETUP_TOKEN y variables de integración. Deshabilitar envíos y conexiones a equipos reales dentro de las pruebas. Comprobar que la limpieza solo alcance los directorios temporales creados por la ejecución.
- A2. Actualizar el flujo para confirmar el diálogo de vencimientos antes de intentar registrar el pago. Esperar resultados visibles y respuestas relevantes; evitar pausas fijas. Recorrer el resto del script y ajustar otras expectativas desactualizadas que aparezcan.
- A3. Conservar escenarios separados para instalación local y creación inicial protegida por token. El aislamiento del smoke test no debe suprimir la prueba del requisito de seguridad.
- A4. Establecer una ejecución reproducible de `bun run check`, `bun run test` y `bun run test:ui`, en secuencia por la caché compartida de Astro. Incorporarla a integración continua cuando se disponga del repositorio y proveedor; en esta carpeta no se encontró `.git`.
- A5. Ejecutar la suite PostgreSQL en su base temporal si hay servicio y permisos disponibles. Mientras no se ejecute, registrar esa limitación y no declarar equivalencia comprobada con SQLite.
- A6. Actualizar README y guías: WhatsApp implementado frente a habilitado; ARRIS con controles limitados; OpenWrt de consulta; acumulación histórica de consumo; diferencia entre estado guardado y prueba reciente. Mantener los diagnósticos antiguos fechados como históricos.

Archivos principales: `scripts/smoke-ui.mjs`, `test/`, `README.md`, `docs/operacion.md`, `docs/nuwenet-pro.md`, `docs/puesta-en-marcha-pro.md`.

Criterio de aceptación: el flujo de interfaz termina con configuración local protegida, sin tocar la base operativa; las suites existentes pasan; los resultados identifican con claridad qué motores y equipos se probaron.

**4. Fase B — Seguridad del portal, permisos y auditoría**

- B1. Añadir una nueva migración para el ciclo de vida del acceso del residente. Decisión inicial: enlaces revocables con fecha de emisión y caducidad configurable; no imponer una caducidad arbitraria a enlaces existentes. La transición debe informar al administrador y permitir reemplazarlos sin afectar pagos ni historial.
- B2. Implementar regeneración del enlace desde la ficha del departamento. Solo podrán hacerlo el super-admin y un administrador autorizado del edificio. La rotación será atómica, invalidará inmediatamente el enlace anterior y quedará auditada sin guardar el token en el evento.
- B3. Añadir una acción explícita de cambio de titular que permita invalidar el acceso anterior. Separarla de una simple corrección de nombre. La entrega del nuevo enlace será una operación distinta de su generación.
- B4. Aplicar la misma validación de token, expiración, archivo y edificio deshabilitado a datos del portal, consumo, tráfico y reportes. Conservar respuestas que no revelen datos de otros departamentos.
- B5. Evitar tokens en logs, errores y herramientas de diagnóstico. Mantener `no-referrer` y `no-store`. Diseñar el almacenamiento de tokens como hash si se acepta que el enlace completo solo sea visible al emitirlo; migrar los enlaces existentes mediante hash preservando su validez y cambiar la interfaz que hoy recupera el token desde el estado.
- B6. Limitar las consultas del portal, especialmente tráfico en vivo, por identidad/IP. Añadir una caché breve o agrupación de consultas por router para evitar que cada visitante dispare una lectura completa. En varias instancias, usar coordinación compartida o un límite central.
- B7. Sustituir gradualmente las reglas de autorización basadas en rutas dentro de `main.ts` por guards y metadatos de roles. Conservar pruebas de aislamiento. Distinguir un actor de sistema explícito de la ausencia accidental de contexto, que hoy permite acceso amplio en varios servicios.
- B8. Registrar los eventos de negocio críticos dentro de su transacción o mediante una salida persistente transaccional. Para intentos de login, denegaciones y fallos, definir un registro de seguridad independiente que no pierda el evento por el rollback del negocio. No bloquear un logout por un fallo secundario de registro.
- B9. Eliminar el descarte silencioso de errores de auditoría. Incluir actor, edificio, operación, recurso, resultado, fecha e identificador de correlación; excluir contraseñas, cookies, tokens y cuerpos completos. Limitar el acceso a auditoría y definir retención.

Archivos principales: `auth/`, `main.ts`, `common/audit.interceptor.ts`, `common/request-context.ts`, `management.service.ts`, `usage.service.ts`, `database.service.ts`, scripts de portal y dashboard.

Criterio de aceptación: el enlace antiguo falla en todos los endpoints después de rotar; otro edificio no puede rotarlo; un fallo de auditoría se detecta y las operaciones críticas conservan su evento; una petición sin actor no obtiene privilegios de sistema. Las pruebas incluyen concurrencia en rotación y rechazo de enlaces vencidos.

**5. Fase C — Automatizaciones y visibilidad operativa**

- C1. Separar facturación, vencimientos, red, notificaciones, consumo, monitoreo y respaldos en trabajos con manejo de errores independiente. Mantener al inicio el mismo despliegue si resulta suficiente; no introducir infraestructura de colas antes de justificarla.
- C2. Conservar exclusión distribuida por tarea, renovación de concesiones y recuperación tras caída. Si un trabajador pierde su concesión, debe dejar de reclamar trabajo; probar la competencia entre dos instancias y el orden por departamento.
- C3. Mantener límites de concurrencia por router y orden de comandos por departamento. Añadir límites por lote y tiempos máximos para que un equipo lento no monopolice el procesamiento.
- C4. Desacoplar el resultado de una orden de red de su notificación: si la regla se aplicó y falló el aviso, no marcar el control de red como fallido ni repetirlo por esa causa.
- C5. Mostrar última ejecución, último éxito, duración y último error por tarea. Diferenciar proceso disponible, base disponible, router inaccesible, cola atrasada y respaldo antiguo. Evitar que una caída de router vuelva no disponible toda la API.
- C6. Definir diagnósticos de salud y registros estructurados sin secretos. Establecer umbrales iniciales para retraso de colas, fallos repetidos y antigüedad del respaldo, ajustados con el piloto.

Archivos principales: `scheduler.service.ts`, `management.service.ts`, `notifier.service.ts`, `usage.service.ts`, módulos API y vistas de operaciones.

Criterio de aceptación: un router que no responde o un proveedor de avisos caído no impide facturación ni respaldo; reiniciar durante un trabajo no duplica pagos; dos instancias no ejecutan simultáneamente una orden del mismo departamento; el panel permite identificar la tarea afectada.

**6. Fase D — Respaldo y recuperación**

- D1. Mantener el conjunto restaurable de base y clave de routers, pero proteger el paquete completo mediante cifrado autenticado con una clave de recuperación separada del respaldo. No reutilizar la clave de routers como clave del paquete.
- D2. Documentar custodia, recuperación y rotación de la clave del paquete. Aplicar permisos del sistema operativo, incluyendo ACL de Windows: `mode: 0o600` por sí solo no demuestra permisos efectivos en Windows.
- D3. Verificar copia externa real, retención y fallos por volumen ausente. No borrar una copia utilizable antes de confirmar la nueva. Evitar cargar archivos completos en memoria al cifrar o calcular integridad de respaldos grandes.
- D4. Extender restauración y verificación para paquetes cifrados y conservar compatibilidad explícita con respaldos anteriores. Probar clave incorrecta, corrupción, archivo incompleto y credenciales de router restauradas.
- D5. Probar recuperación PostgreSQL en una base nueva: inspeccionar el índice del dump no sustituye una restauración completa. Ningún ejercicio sobrescribirá la base operativa.
- D6. Fijar objetivos iniciales a validar: pérdida máxima de datos de 24 horas y recuperación en 2 horas. Ajustar frecuencia y procedimiento si la operación necesita menos pérdida; registrar el tiempo real del simulacro.

Archivos principales: `backup.service.ts`, `backup-policy.ts`, `scripts/restore-backup.mjs`, `docs/operacion.md`.

Criterio de aceptación: restauración completa demostrada en un destino nuevo, paquete externo ilegible sin su clave, fallo de copia visible y procedimiento que identifica quién custodia la recuperación. No borrar claves antiguas mientras existan respaldos que las necesiten.

**7. Fase E — Puesta en marcha y piloto**

- E1. Confirmar servidor definitivo, acceso LAN/VPN, direcciones estables, DNS, HTTPS y rutas de residentes. Separar administración de acceso al portal mediante reglas verificadas. No usar Astro de desarrollo como servicio operativo.
- E2. Actualizar la matriz de compatibilidad por adaptador, modelo, firmware, lectura, escritura y prueba física realizada. Verificar documentación oficial vigente de cada proveedor antes de aprovisionar servicios o permisos; revalidar los hallazgos de guías antiguas contra el código actual.
- E3. Registrar MikroTik, comprobar acceso y asignarlo al edificio. Respaldar configuración del equipo y documentar retirada de reglas NuweNet. ARRIS no sustituye al central de automatización; OpenWrt conserva su alcance de consulta.
- E4. Crear un plan y un departamento piloto con IP/MAC reales. Verificar que el tráfico atraviesa el central y evaluar VLAN, DHCP, FastTrack, IPv6 y rutas de retorno. La compatibilidad se acreditará en esa topología, sin extrapolarla a otros equipos.
- E5. Configurar datos bancarios y QR emitido por la entidad elegida. Verificar titular, importe y vigencia. Los reportes seguirán requiriendo comprobación manual del ingreso. Usar documentación bancaria vigente si se solicita QR dinámico; no inventar formatos.
- E6. Configurar WhatsApp, plantilla, webhook y seguimiento. Revisar la cola acumulada antes de habilitar el envío. Preparar el texto y destinatario del mensaje piloto; enviarlo solo con autorización explícita para ese mensaje.
- E7. Ejecutar con el departamento piloto: alta, mensualidad, abono, reporte y aprobación, pago total, corte por vencimiento, reactivación, bloqueo manual conservado, reinicio, caída de router y recuperación. Verificar consumo y mostrar huecos o estimaciones; no tratarlo como medición fiscal certificada.
- E8. Observar al menos siete días y simular un cierre mensual en entorno de pruebas. Abrir el servicio gradualmente a más departamentos únicamente después de cumplir los criterios.

Datos externos necesarios: equipo y acceso administrativo, topología y servidor, banco/QR, datos del departamento piloto, cuenta y plantilla de WhatsApp, y responsable operativo. Su falta no bloquea A–D ni F.

Criterio de aceptación: evidencia de corte y reactivación físicos, acceso al portal durante la suspensión, cobro correcto sin duplicados, funcionamiento del respaldo y entrega confirmada del mensaje autorizado. No declarar listo el flujo WhatsApp si solo se recibió aceptación del proveedor. Un fallo de integración puede dejar esa función deshabilitada, pero debe registrarse como alcance pendiente.

**8. Fase F — Mantenibilidad y frontend**

- F1. Extraer de `ManagementService` servicios de edificios/permisos, cobros, portal y comandos de red. Mover las migraciones a archivos versionados sin reescribir migraciones aplicadas. Mantener los límites transaccionales durante la extracción.
- F2. Definir contratos de entrada y salida compartidos o verificables entre API y web. Migrar scripts por módulo a TypeScript o activar `checkJs` progresivamente, empezando por pagos, portal y administración.
- F3. Sustituir gradualmente las cadenas HTML más complejas por componentes o construcción DOM con escape centralizado. Conservar texto sin interpretar para contenido de usuarios. No reescribir toda la interfaz de una vez.
- F4. Reducir consultas innecesarias: aplicar filtros y límites de reportes en SQL, separar las lecturas específicas del estado completo cuando se justifique y reutilizar consultas de tráfico.
- F5. Verificar flujos críticos con teclado, foco de diálogos, etiquetas, estados de carga/error y vista móvil. Las pruebas deberán comprobar comportamientos, no detalles internos de implementación.

Criterio de aceptación: los contratos públicos y reglas de cobro se conservan, los módulos críticos tienen comprobación estática y las pruebas de interfaz pasan en escritorio y móvil.

**9. Fase G — PostgreSQL y capacidad medida**

- G1. Ejecutar migraciones, cobros concurrentes, reversiones, aislamiento, colas y restauración contra PostgreSQL. Validar arranque simultáneo y migración desde una copia de un esquema anterior compatible.
- G2. Definir con operaciones el volumen objetivo: edificios, departamentos, operadores simultáneos, frecuencia de lectura y crecimiento anual. Usar datos sintéticos y registrar máquina, versión, volumen, latencias p50/p95 y esperas por bloqueo.
- G3. Medir primero el bloqueo global actual. Propuesta inicial de aceptación para el volumen acordado: p95 menor de 1 segundo en operaciones administrativas sin llamadas externas y cero inconsistencias en concurrencia. Es un objetivo por comprobar, no una capacidad ya demostrada.
- G4. Si las medidas muestran contención, sustituir el bloqueo global por bloqueos de fila o por recurso e índices/restricciones: factura para pagos y reversión, departamento para decisiones de acceso, unicidad para mensualidades y claves de idempotencia. Establecer orden fijo de adquisición para reducir interbloqueos.
- G5. Separar operaciones que no requieren el bloqueo financiero, como sesiones y métricas, sin debilitar sus propias garantías. Mantener la serialización SQLite mientras se use una sola conexión.
- G6. Repetir exactamente la carga y las pruebas de concurrencia después del cambio. Conservar un mecanismo de retorno al bloqueo global hasta demostrar que no hay duplicados ni pérdida de actualizaciones.

Criterio de aceptación: evidencia antes/después, pruebas con dos instancias aprobadas, aislamiento preservado y objetivo de latencia satisfecho. Si el diseño actual cumple el volumen objetivo, documentar la medida y aplazar el cambio de bloqueos.

**10. Entregas, migración y reversión**

Entregas sugeridas, cada una revisable por separado: (1) pruebas y documentación; (2) ciclo de vida de enlaces; (3) permisos y auditoría; (4) trabajos independientes y diagnóstico; (5) respaldo cifrado/restauración; (6) configuración y acta del piloto; (7) separación de servicios; (8) tipos de frontend; (9) carga y optimización PostgreSQL si procede.

Antes de cambios de esquema: crear y verificar respaldo, probar la migración en copia y definir compatibilidad con la versión anterior. Preferir ampliar el esquema y migrar datos antes de retirar columnas. No ejecutar una restauración para revertir una aplicación si eso descartaría cobros posteriores: usar corrección hacia adelante o un procedimiento explícito de conciliación.

Para enlaces revocados, una reversión de software no debe volver a habilitarlos. Para red, registrar las reglas propias y retirar únicamente esas reglas; no restablecer indiscriminadamente el router. Para WhatsApp, deshabilitar futuros envíos no revierte mensajes ya enviados. Los cambios de configuración deben conservar sus valores anteriores en almacenamiento protegido.

Responsabilidades propuestas: desarrollo implementa y prueba; el dueño del sistema aporta asignaciones y criterios de operación; administración verifica cobros y datos bancarios; quien administra la red ejecuta el piloto físico y su recuperación. Una persona puede cubrir varios roles.

**11. Criterio de finalización del plan**

- [x] Pruebas de interfaz reparadas y suites reproducibles localmente; resultados SQLite y PostgreSQL documentados. CI remota pendiente en A4.
- [x] B1–B4: rotación/revocación del portal, tratamiento de enlaces existentes y validación coherente en todos los endpoints. Permisos comprobados vía aislamiento por edificio. Quedan B5–B9.
- [x] B5–B9: enlaces como hash con emisión única, límites del portal y caché de tráfico, guards por rol con sistema explícito, eventos de seguridad independientes y auditoría estructurada sin descarte silencioso (retención 180 días, fallos visibles vía stderr y `/api/health`).
- [x] Tareas independientes, recuperación y exclusión entre instancias verificadas (Fase C: avisos desacoplados de la red, diagnóstico por tarea en Actividad/estado/salud, presupuesto de 4 min y tope de 10 por pasada, umbrales en la guía de operación; `test/tasks.test.js`).
- [x] Respaldos protegidos, copia externa y restauración ensayada (Fase D: paquete AES-256-GCM con clave separada, custodia/rotación/ACL, streaming, compatibilidad heredada, `pg_restore` a base nueva, RPO 24 h/RTO 2 h; `test/backup.test.js`).
- [ ] Matriz de routers actualizada y piloto físico documentado.
- [ ] Banco/QR y WhatsApp validados o registrados explícitamente como integración pendiente.
- [ ] Código dividido y frontend crítico con comprobación estática.
- [ ] Capacidad medida para el volumen acordado y decisión de concurrencia justificada.
- [ ] Manual de operación, recuperación y diagnóstico actualizado con los resultados finales.

La primera entrega A ya proporciona evidencia local para ejecutar y revisar el resto. Las casillas pendientes se completarán únicamente después de implementar y validar cada resultado.
