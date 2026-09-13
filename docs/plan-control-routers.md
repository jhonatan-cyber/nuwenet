# Plan – Control de routers secundarios vía MikroTik central

> Objetivo: pasar de control simulado a control real centralizado en el MikroTik.
> Topología: `ISP -> Router principal -> MikroTik -> Switch -> Routers secundarios (en modo AP Bridge) -> Departamentos`.
> Estado inicial: NuweNet solo consulta (`GET /rest/system/resource`, `/rest/interface`). `POST /api/routers/:id/actions` devuelve 422 y `commands` son `mode='simulated'`.

## Cómo usar este archivo para seguimiento

* Cada ítem es un checkbox `- [ ]`. Cuando terminemos un punto, lo cambiamos a `- [x]` en este mismo archivo.
* No borrar ítems, solo marcarlos. Añadir fecha y responsable en `Registro de avances`.
* Orden sugerido: Fase 0 → 1 → 2 → 3 → 4 → 5. No saltar Fase 0.
* Verificación rápida tras cada fase: `bun run check` y `bun run test`.

---

## Fase 0 – Inventario y diagnóstico (sin tocar código)

- [ ] 0.1 Registrar modelo del MikroTik y versión RouterOS (`/system resource print`).
- [ ] 0.2 Registrar modelos/firmware de cada router secundario y su IP actual.
- [ ] 0.3 Confirmar si el switch es no gestionable o gestionable (marca/modelo).
- [ ] 0.4 Confirmar quién da DHCP hoy (router principal, MikroTik o routers secundarios).
- [ ] 0.5 Dibujar mapa: ISP, IP del MikroTik, IP de cada AP, rango DHCP, deptos por AP.
- [ ] 0.6 Definir mapeo `departamento -> MAC/IP/AP` (tabla inicial, aunque sea en papel).
- [ ] 0.7 Decidir: control central en MikroTik (recomendado) vs control individual por router.

> Hecho cuando: tenemos tabla completa de equipos + decisión documentada abajo en Registro.

## Fase 1 – Preparar MikroTik como controlador

- [ ] 1.1 Fijar IP privada administrativa al MikroTik (ej. `192.168.88.1`), acceso por LAN/VPN.
- [ ] 1.2 Habilitar REST seguro: `/ip service enable www-ssl`, deshabilitar `www` sin TLS si es posible.
- [ ] 1.3 Crear usuario exclusivo `nuwenet` con permisos mínimos: `read,write,api,firewall,queue,dhcp,rest-api` (el código aprovisiona esto en `provisionNuwenetUser`; `test` del plan inicial quedó sustituido por `rest-api`).
- [ ] 1.4 Probar manual: `GET https://<mikrotik>/rest/system/resource` con Basic auth, ver `board-name` y `version`.
- [ ] 1.5 Probar manual: `GET https://<mikrotik>/rest/interface`, ver interfaces `running`.
- [ ] 1.6 Registrar el MikroTik en NuweNet: `POST /api/routers` con `adapter: mikrotik-rest`, `protocol: https`, puerto 443.
- [ ] 1.7 Probar en panel Routers: `Probar conexión` → debe dar `connected` y mostrar firmware/interfaces.
- [ ] 1.8 Respaldar `ROUTER_ENCRYPTION_KEY` y `data/router.key` (sin esto no se descifran credenciales). Revisión 2026-09-13: también `BACKUP_ENCRYPTION_KEY` (Fase D: sin ella no se descifra el paquete de respaldo).

> Hecho cuando: el MikroTik aparece en `GET /api/routers` con `status: connected`.

## Fase 2 – Normalizar red (requisito para cortar por depto)

- [ ] 2.1 Poner routers secundarios en modo AP Bridge (desactivar NAT y DHCP en ellos).
- [ ] 2.2 Dejar al MikroTik como único gateway + DHCP server.
- [ ] 2.3 Unificar subred (todos los AP y clientes en el mismo rango del MikroTik).
- [ ] 2.4 Crear leases estáticos en MikroTik: `/ip dhcp-server lease` por depto/MAC.
- [ ] 2.5 Etiquetar cada AP con IP estática y nombre (`Dpto-101-AP`, etc.).
- [ ] 2.6 Verificar desde MikroTik que se ven las MAC/IP finales (no solo 1 IP por router).
- [ ] 2.7 Prueba manual de bloqueo: añadir regla `forward drop src-address=<IP> comment=nuwenet-suspend-<IP>` y confirmar que pierde internet, luego quitar. Nota revisión 2026-09-13: el código ya no usa `address-list=blocked`; `suspend/reactivate` operan sobre `/rest/ip/firewall/filter` (+ reglas de portal cautivo si `NUWENET_PORTAL_IP` está definido).

> Hecho cuando: cada depto es visible y bloqueable individualmente desde el MikroTik.

## Fase 3 – Backend: implementar acciones reales en MikroTik

Archivos clave: `apps/api/src/routers/router.types.ts`, `apps/api/src/routers/adapters/mikrotik.adapter.ts`, `apps/api/src/routers/routers.service.ts`, `apps/api/src/routers/router.dto.ts`, `apps/api/src/management/management.service.ts`, `apps/api/src/management/department-control.ts`, `apps/api/src/routers/router-network.ts`. Nota: las líneas citadas en versiones viejas del plan se movieron; buscar por nombre de método.

- [x] 3.1 Extender interfaz `RouterAdapter` con `suspend()`, `reactivate()`, `setSpeedLimit()` (mantener `inspect()` intacto). Además existen `firewall()`, `parental()`, `releaseClient()`, `departmentSpeed()`, `getTrafficStats()`, `getUnlinkedDevices()`.
- [x] 3.2 Implementar `suspend` en `mikrotik.adapter.ts`: `PUT /rest/ip/firewall/filter` con `chain=forward action=drop src-address=<IP> comment=nuwenet-suspend-<IP>` (idempotente; + reglas de portal cautivo si aplica). No usa `address-list blocked` ni MAC directa.
- [x] 3.3 Implementar `reactivate`: eliminar por `comment=nuwenet-suspend-<IP>` (devuelve `ya-activo` si no hay regla).
- [x] 3.4 Implementar `speed_limit`: crear/actualizar `/rest/queue/simple` con `max-limit=<up>M/<down>M`. Implementación actual: cola compartida por departamento `nuwenet-department-<customerId>` vía `departmentSpeed()` (múltiples IP → `target=ip1/32,ip2/32`), con limpieza de colas legacy `nuwenet-<IP>`, rechazo si hay cola ajena o FastTrack activo, y verificación de escritura.
- [x] 3.5 Actualizar `capabilities` en `mikrotik.adapter.ts`: `suspend: true, reactivate: true, speed_limit: true, firewall: true, parental_control: true`, actualizar `requirements` y `notes`.
- [x] 3.6 Cambiar `RoutersService.action()`: llamar al adaptador en vez de lanzar `UnprocessableEntityException`. Registrar en `router_checks` + `events`. Incluye guarda contra IP de departamento (`409`: usar flujo Departamentos) y serialización por router (`acting`/`checking`).
- [x] 3.7 Extender `RouterActionDto` con `ip` / `down` / `up` / `target` / `schedule` / `remove`. Nota revisión 2026-09-13: `customer_id`/`mac` NO van en el DTO; la resolución depto→IP/MAC vive en `ManagementService` + `customer_devices` / `customer_network_targets`.
- [x] 3.8 Conectar `ManagementService` con `RoutersService`: `access()` + `queue()` + `processQueue()` encolan órdenes por departamento y las aplican en el central (`suspend/reactivate` + `speed_limit` al activar, o `controlDepartment()` si es agrupado). `commands.mode=mikrotik|simulated`, `mikrotik-failed` + `next_attempt` con backoff si falla; `customers.network_state` refleja el resultado.
- [x] 3.9 Manejo de errores: credencial inválida, equipo offline, IP no encontrada → `status: error`, `last_error` sin filtrar secretos.
- [x] 3.10 Añadir tests: mock REST MikroTik para `suspend/reactivate/speed_limit` + caso concurrente. Extender `test/router-adapters.test.js` y `test/router-contract.js`.
- [x] 3.11 Verificar: `bun run check`, `bun run build`, `bun run test`.

> Hecho cuando: `POST /api/routers/:id/actions` suspende y reactiva de verdad un cliente de prueba.

## Fase 4 – Frontend y operación diaria

Archivos (revisión 2026-09-13): `apps/web/src/components/RoutersPanel.tsx`, `CustomerActions.tsx`, `BillingPanel.tsx`, `OperationsPanel.tsx`, `apps/web/src/scripts/dashboard.js` (enrutador), `apps/web/src/lib/*-store.ts`. `scripts/routers.js` y `scripts/operations.js` se eliminaron al migrar el panel a React/shadcn.

- [x] 4.1 Mostrar estado real en tarjeta MikroTik: bloqueados, colas, leases.
- [x] 4.2 `Cortar/Reactivar internet` por departamento (diálogo `CustomerActions` con confirmación) + botones por dispositivo en la tarjeta del router, conectados a acción MikroTik.
- [x] 4.3 Mostrar plan aplicado (`down/up` de `queue/simple`) en vista Departamentos.
- [x] 4.4 Avisos en línea y errores claros cuando falla el router (offline, auth, timeout). Revisión 2026-09-13: los paneles React usan avisos `role=status`; el toast legacy queda para reportes/banco y vistas no migradas (portal, recibos).
- [x] 4.5 Documentar flujo operador: generar mensualidad → pagar → auto-reactivar, revisar vencidos → suspender.

## Fase 5 – Pruebas, seguridad y puesta en producción

- [ ] 5.1 Prueba punta a punta en 1 AP + 1 depto de prueba (suspender, navegar bloqueado, reactivar, velocidad limitada).
- [x] 5.2 Prueba de concurrencia: 2 pagos simultáneos no duplican ni dejan estado inconsistente (idempotencia por `request_key`, `acting`/`checking` por router, `task_locks` en `processQueue`, reintento ordenado por `commands.id`).
- [x] 5.3a Endurecer (código): IPs RFC1918 en `router-network.ts`, sin redirecciones, timeout 12s, tope 1MB, TLS por defecto de `fetch`, `ROUTER_ENCRYPTION_KEY` 32 bytes, credenciales AES-256-GCM nunca expuestas.
- [ ] 5.3b Endurecer (prod física): HTTPS al MikroTik con cert válido, `ROUTER_ENCRYPTION_KEY` en prod, dump PostgreSQL. Revisión 2026-09-13: la parte de backup en código está hecha (Fase D: paquete AES-256-GCM, custodia/rotación, streaming); queda el entorno físico.
- [x] 5.4 Definir rollback: cómo volver a modo simulado si falla el MikroTik (quitar IP / quitar central / limpiar `nuwenet-suspend-*` y `nuwenet-*` en WinBox; ver `router-api.md`).
- [x] 5.5 Actualizar `docs/router-api.md` y `README.md`: capacidades reales, requisitos MikroTik, límites.
- [x] 5.6 Smoke UI: `bunx playwright install chromium` + `bun run test:ui`. Revisión 2026-09-13 (tarde): verde tras Billing, Operaciones, Routers, Fase C y Fase D; re-ejecutar tras cada cambio (`bun run check`, `bun run test`).

---

## Fase 6 – Cierre funcional (sin hardware)

- [x] 6.1 Autenticación: setup del primer admin, login/logout por cookie, 401 sin sesión (modo setup abierto antes).
- [x] 6.2 Revisión automática de vencidos (`OVERDUE_CRON_MINUTES`, desactivada por defecto).
- [x] 6.3 Abonos parciales (`POST /pay` con `amount` opcional, saldos y reactivación solo al completar).
- [x] 6.4 Moneda de presentación (`CURRENCY`) y modo `mixed` en el estado.
- [x] 6.5 Avisos a clientes (canal `log`, extensible) en suspensión, reactivación y fallos.
- [x] 6.6 `firewall` por destino y `parental_control` por horario en MikroTik, con lectura en la tarjeta.
- [x] 6.7 Paginación de mensualidades en el panel (25 por página).
- [x] 6.8 Panel para no técnicos: guía de primeros pasos con progreso, estados en lenguaje claro (Al día / En mora / Cortado con deuda) y confirmaciones antes de cortar.
- [ ] Backends de escritura OpenWrt/ARRIS: no implementados sin equipo físico que valide (escribir a ciegas en red es riesgoso).
- [ ] Cobros bancarios y facturación fiscal: requieren proveedor y normativa local.
- [ ] RADIUS / TR-069 / SNMP: roadmap según el parque instalado.

## Decisión de arquitectura (rellenar en Fase 0)

* MikroTik modelo/versión:
* Switch gestionable o no:
* DHCP actual:
* Modo routers secundarios (Router / AP):
* Estrategia elegida: [ ] central MikroTik / [ ] individual por router

---

## Registro de avances

| Fecha | Fase/Ítem | Hecho por | Notas |
|-------|-----------|-----------|-------|
| 2026-09-08 | Fase 3 backend manual (3.1-3.6, 3.10-3.11) | opencode | `suspend/reactivate/speed_limit` MikroTik por IP, `check+build+integration+router-adapters` en verde. Falta 3.7-3.8 (IP por depto + auto) y Fases 0-2 físicas. |
| 2026-09-08 | Fase 3 auto + Fase 4 UI (3.7-3.9, 4.2-4.4) | opencode | Migración 3 (`customers.ip`), `POST /api/customers/ip`, enforcement auto en cambio/pago/vencidos con `commands.mode=mikrotik\|mikrotik-failed\|simulated`, UI IP por depto + acciones manuales en Routers. `check+build+5 tests` en verde. Pendiente: 4.1 (listar bloqueos/colas), 4.5, Fase 5 y Fases 0-2 físicas. |
| 2026-09-08 | Fase 4 lectura+docs (4.1, 4.5, 5.2, 5.4, 5.5) | opencode | inspect trae bloqueadas/colas/leases a la tarjeta; runbook+rollback en router-api.md; alcance mixto en README. Queda fisico: 0-2, 5.1, 5.3, 5.6. |
| 2026-09-08 | Fase 6 cierre funcional | opencode | Auth+setup, cron vencidos, abonos parciales, CURRENCY, avisos log, firewall/parental MikroTik, paginacion. check+build+7 tests+smoke UI en verde. |
| 2026-09-13 | Revisión doc vs código | opencode | Sin cambios de código. Se corrigen 1.3 (`rest-api` no `test`), 2.7/3.2-3.4 (filter `nuwenet-suspend-*`, cola compartida `nuwenet-department-*`), 3.6-3.8 (sin líneas fijas; DTO sin `customer_id/mac`; `queue+processQueue`), Fase 4 (+`operations.js`), 5.3 dividida en 5.3a código `[x]` / 5.3b prod física `[ ]`, Registro movido al final. Pendiente físico: 0, 1, 2, 5.1, 5.3b + re-ejecutar `check/test/test:ui`. |
| 2026-09-13 | Revisión vespertina + panel shadcn y Fases C/D | opencode | Fase 4 actualizada (`routers.js`/`operations.js` eliminados → `RoutersPanel`/`OperationsPanel`/`BillingPanel`/`CustomerActions`; 4.2 diálogo Cortar/Reactivar; 4.4 avisos en línea); 1.8 suma `BACKUP_ENCRYPTION_KEY`; 5.3b nota Fase D en código; 5.6 verde de hoy. Fases C (avisos desacoplados, diagnóstico por tarea, `test/tasks.test.js`) y D (respaldo cifrado, `test/backup.test.js`) hechas en el otro plan. Pendiente físico: 0, 1, 2, 5.1, 5.3b. |
