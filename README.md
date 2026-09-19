# NuweNet

Plan de trabajo: [implementación de mejoras, prioridades y criterios de aceptación](docs/plan-implementacion-mejoras.md).

Interfaz: todas las secciones del panel son islas React con shadcn/ui y Tailwind; el portal y la página de suspensión comparten las mismas utilidades y tokens. La gráfica de consumo sigue compartida con el portal.

Sistema de gestión de internet para edificios: **NestJS + Astro + Bun**, con **PostgreSQL** como único motor de base de datos para despliegue en VPS.

El panel incluye **Equipos de red** para registrar conexiones y probar consultas reales mediante adaptadores ARRIS Touchstone, MikroTik REST, OpenWrt ubus y TR-369/USP (base). Cada ficha muestra su nivel de administración (completa, parcial, solo consulta o sin integración). MikroTik puede actuar como equipo central para aplicar acceso y velocidad mediante una cola persistente, y el asistente **Configurar red del edificio** organiza inventario, conexiones y revisión antes de aplicar. Consulta [la API de routers](docs/router-api.md) (autenticación y permisos, operación diaria, cifrado) y [equipos de red](docs/equipos-de-red.md).

## Instalación

Requiere Bun 1.4 o superior. Bun instala dependencias, ejecuta el backend, compila la interfaz y corre las pruebas.

```sh
bun install --frozen-lockfile
```

El archivo de dependencias es `bun.lock`. NestJS se compila con TypeScript para conservar los metadatos de decoradores usados en inyección de dependencias y validaciones.

## Desarrollo

Crea un único archivo `.env` en la raíz del proyecto si todavía no existe. Configura la conexión PostgreSQL y `ROUTER_ENCRYPTION_KEY` antes de iniciar.

```sh
bun run dev
```

Abre http://127.0.0.1:4321. Astro redirige `/api` a NestJS en el puerto 3000. Ambos se actualizan al modificar sus archivos.

Para ejecutar la versión compilada en un solo servidor:

```sh
bun run build
bun run start
```

Abre http://127.0.0.1:3000. NestJS sirve la API y el frontend compilado por Astro.

## PostgreSQL

Toda la configuración reside en `.env`, excluido de Git por contener secretos. Configura la conexión a la base existente `nuwenet`; la aplicación y las pruebas usan esa misma base.

```dotenv
DB_DRIVER=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nuwenet
PGUSER=postgres
PGPASSWORD=tu_contraseña
PGSSLMODE=disable
HOST=127.0.0.1
PORT=3000
ROUTER_ENCRYPTION_KEY=clave_aleatoria_de_32_bytes_en_base64
SETUP_TOKEN=codigo_privado_de_instalacion
```

Prepara `nuwenet` desde la administración de PostgreSQL y ejecuta el sistema:

```sh
bun run build
bun run start
```

La aplicación crea las tablas y aplica las migraciones en `nuwenet`. Ningún comando de la aplicación ni de pruebas crea o elimina bases de datos.

El contenido de las tablas heredadas que una migración retira queda archivado dentro del esquema. Se consulta y se exporta con `bun run db:archive` (inventario sin argumentos, `bun run db:archive <tabla>` para una tabla y `--export` para exportarla); con sesión de super-admin, `GET /api/retired-rows`, `GET /api/retired-rows/:tabla` y `GET /api/retired-rows/:tabla/export` ofrecen lo mismo.

Para desarrollar con PostgreSQL:

```sh
bun run dev
```


En un alojamiento web configura sus variables de entorno: `DB_DRIVER=postgres`, la conexión PostgreSQL y `HOST=0.0.0.0` si la plataforma lo requiere. `DATABASE_URL` también se admite y tiene prioridad sobre las variables `PG*`; en ese caso el SSL debe ir en la URL, por ejemplo `?sslmode=verify-full`. Con variables separadas utiliza `PGSSLMODE` según el proveedor. La configuración local no publica automáticamente la aplicación en internet.

## Configuración

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `DB_DRIVER` | `postgres` | Único motor admitido |
| `PGHOST` / `PGPORT` | `127.0.0.1` / `5432` | Servidor PostgreSQL |
| `PGDATABASE` | `nuwenet` | Única base admitida |
| `PGSCHEMA` | `public` | Esquema de la aplicación; las pruebas generan su propio esquema |
| `PGUSER` | `postgres` | Usuario PostgreSQL |
| `PGPASSWORD` | Sin valor | Contraseña privada del backend |
| `PGSSLMODE` | `disable` | SSL de PostgreSQL con variables separadas |
| `DATABASE_URL` | Sin valor | URL PostgreSQL opcional, con prioridad sobre `PG*` |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Dirección del servidor |
| `API_PROXY_TARGET` | `http://127.0.0.1:3000` | Destino del proxy Astro en desarrollo |
| `SESSION_TTL_HOURS` | `72` | Vigencia de la sesión del panel |
| `OVERDUE_CRON_MINUTES` | `0` | Revisión automática de vencidos cada N minutos; `0` = solo manual |
| `CURRENCY` | Sin valor | Símbolo de moneda mostrado en el panel |

No uses variables `PUBLIC_*` para credenciales: Astro puede incluirlas en el navegador.

## Estructura

- `apps/api/src/config`: constantes y validación de entorno (`app.config`).
- `apps/api/src/infrastructure/http`: middlewares (rate-limit, cabeceras, auth) y `infrastructure/captive-portal`.
- `apps/api/src/modules/<dominio>`: un servicio y un controlador por responsabilidad (`buildings`, `plans`, `customers`, `billing`, `access`, `portal`, `network`, `settings`, `state`, `backups`, `usage`, `network-design`, `retired-rows`, `jobs`, `shared`). `management/management.service.ts` queda como fachada que delega.
- `apps/api/src/routers/services`: `operation` (estado compartido), `crud`, `discovery`, `actions`, `provisioning`; `routers.service.ts` delega y `routers-crud/routers-ops` separan los endpoints.
- `apps/api/src/database`: conexión PostgreSQL mediante Bun SQL y transacciones; el mapa de la capa de datos está en `apps/api/src/database/migrations/index.ts`.
- `apps/web/src/features/<dominio>`: estado por dominio (`auth`, `billing`, `customers`, `plans`, `operations`, `routers-network`, `overview`); `shared/lib` para lo transversal (`panel-query`, `api-client`).
- `test/{unit,integration,contract,fixtures}`: unitarias, integración PostgreSQL, contrato de routers y fixtures.
- `tools/{db,ops,e2e,dev}`: base de datos, operaciones, pruebas de navegador y desarrollo.

Las consultas de negocio se parametrizan con Bun SQL. PostgreSQL utiliza un bloqueo transaccional compartido entre instancias para evitar duplicar pagos y decisiones de acceso simultáneas. Las migraciones posteriores deben añadirse como nuevas versiones.

Todas las tablas usan un `id UUID` primario generado con UUID v7 (`apps/api/src/common/uuid.ts`): ordenable por fecha de creación y sin exponer volumen. Las claves naturales (correo de usuario, departamento por edificio, token de sesión, día de consumo) se conservan como restricciones UNIQUE y las escrituras envían siempre el identificador explícito, así que el esquema no depende de valores por defecto del motor.

## Validación

Ejecuta estos comandos por separado: Astro comparte caché entre comprobación y compilación.

```sh
bun run check
bun run test
bun run test:postgres
```

Las pruebas verifican registros, validaciones, cobros concurrentes y persistencia dentro de `nuwenet`. Cada escenario crea un esquema `nuwenet_test_*` y elimina solo ese esquema al terminar. Las tablas operativas permanecen en `public`. Se necesita permiso `CREATE` sobre `nuwenet` para crear esquemas, sin permisos de creación de bases.

Para validar la interfaz:

```sh
bunx playwright install chromium
bun run test:ui
```

Para ejecutar tipos, compilación, suite e interfaz en secuencia, sin compilar dos veces:

```sh
bun run verify
```

La prueba de interfaz arranca su servidor con `--no-env-file`, un entorno limitado a variables del sistema y la conexión a un esquema temporal dentro de `nuwenet`. Comprueba el código de instalación ausente, incorrecto y válido; bloquea HTTP saliente desde el backend. Los fallos de navegador guardan una captura `nuwenet-ui-smoke-failure.png` en el directorio temporal del sistema. La suite de autenticación conserva el escenario local sin código. PostgreSQL se valida por separado con `bun run test:postgres` y su esquema temporal.

También puedes definir `BROWSER_CHANNEL=chrome` para usar Chrome instalado. La prueba del navegador siempre utiliza un esquema temporal dentro de `nuwenet`.

## Funciones y alcance

Planes, departamentos con IP privada opcional, mensualidades, pagos completos o abonos parciales, revisión manual o automática de vencimientos, suspensión y reactivación e historial. El control de red exige IP y equipo central registrado; sin ellos la orden queda en fallo con el motivo. Los importes se guardan en centavos con la moneda de `CURRENCY` solo en presentación. Los vencimientos usan America/La_Paz y el historial muestra fechas UTC.

El panel y las operaciones de negocio exigen sesión. Sin usuarios solo se permite crear el primer usuario, que es el super-admin único y global (dueño del sistema). El super-admin da de alta a los administradores, les asigna edificios y configura la red de cada uno. Sin roles de caja ni técnico. El sistema no genera ni envía notificaciones a residentes.

La generación incluye departamentos suspendidos y excluye archivados. El día del vencimiento y los días de gracia configurados no provocan corte. Un pago puede reactivar si no quedan cuotas vencidas; nunca elimina un bloqueo manual. Los abonos, referencias, recibos y reversiones conservan el historial.

El control de acceso es **real** en el equipo central por IP (`suspend`, `reactivate`, `speed_limit`, `firewall` por destino y `parental_control` por horario). Cada edificio tiene su propio equipo central MikroTik obligatorio, sus planes, departamentos e IPs (el departamento y la IP se validan por edificio y pueden repetirse en edificios distintos). ARRIS TG2492LG-NA con firmware 9.1.103HB admite filtros IPv4 TCP/UDP por IP, puertos y horarios; no ofrece límites de velocidad ni sustituye al central MikroTik. OpenWrt permite consulta. El estado guardado de un router no acredita conectividad física actual.

El portal permite consultar la cuenta, las cuotas, los pagos y los recibos. Los pagos y abonos se registran manualmente en administración; no se generan cobros bancarios ni QR. No hay facturación fiscal. El consumo incluye historial diario y mensual persistente a partir de muestras de colas MikroTik, con indicación de reinicios y huecos; el tráfico en vivo es una consulta distinta. La puesta en marcha con residentes exige validar servidor, red e integraciones en su entorno real.

Desde **Respaldos** puedes crear y verificar copias; los intervalos se configuran en **Edificio y automatización**. PostgreSQL utiliza `pg_dump` y `pg_restore`; instala estas herramientas en la VPS. Para restaurar a un directorio nuevo utiliza `tools/db/restore-backup.ts` (ver su ayuda con `bun tools/db/restore-backup.ts --help`).

Documentación: [NestJS](https://docs.nestjs.com/first-steps), [Astro](https://docs.astro.build/en/guides/client-side-scripts/) y [Bun SQL](https://bun.com/docs/runtime/sql).

## Despliegue en VPS

Configura `.env` con PostgreSQL, `ROUTER_ENCRYPTION_KEY` (32 bytes aleatorios en base64) y un `SETUP_TOKEN` privado para crear el primer administrador. Conserva las claves entre despliegues. Compila con `bun run build` y ejecuta `bun run start` mediante un servicio del sistema. Publica el dominio con un proxy HTTPS hacia `127.0.0.1:3000`; configura `COOKIE_SECURE=true`, `TRUST_PROXY=loopback` y `ALLOWED_ORIGINS=https://tu-dominio`.

La VPS necesita conectividad hacia los routers de cada edificio mediante una red privada o VPN. Las direcciones privadas de los routers requieren esa conexión desde la VPS.

Las pruebas utilizan la conexión del único `.env` y requieren `pg_dump` y `pg_restore`. `bun run verify` comprueba tipos, compilación, pruebas de API y navegador. Los ensayos de restauración usan exclusivamente el esquema del escenario de prueba dentro de `nuwenet`.
