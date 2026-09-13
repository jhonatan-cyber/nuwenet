# NuweNet

Plan de trabajo: [implementación de mejoras, prioridades y criterios de aceptación](docs/plan-implementacion-mejoras.md).

Interfaz: preferencias, perfil, planes y departamentos (listado, formularios y diálogos) utilizan islas React con shadcn/ui y Tailwind; la migración es gradual. La gráfica de consumo sigue compartida con el portal. Consulta [estilos, componentes y alcance migrado](docs/estilos-y-componentes.md).

Sistema de gestión de internet para edificios: **NestJS + Astro + Bun**, con **PostgreSQL** como único motor de base de datos para despliegue en VPS.

El panel incluye **Routers** para registrar conexiones y probar consultas reales mediante adaptadores ARRIS Touchstone, MikroTik REST y OpenWrt ubus. MikroTik puede actuar como equipo central para aplicar acceso y velocidad mediante una cola persistente. Consulta [la guía de operación, permisos, automatizaciones y respaldos](docs/operacion.md) y [la API de routers](docs/router-api.md).

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
NOTIFY_CHANNEL=log
WHATSAPP_SEND_ENABLED=false
```

Prepara `nuwenet` desde la administración de PostgreSQL y ejecuta el sistema:

```sh
bun run build
bun run start
```

La aplicación crea las tablas y aplica las migraciones en `nuwenet`. Ningún comando de la aplicación ni de pruebas crea o elimina bases de datos.

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
| `NOTIFY_CHANNEL` | `log` | Canal de avisos (base + consola) |

No uses variables `PUBLIC_*` para credenciales: Astro puede incluirlas en el navegador.

## Estructura

- `apps/api/src/database`: conexión PostgreSQL mediante Bun SQL, migración inicial y transacciones.
- `apps/api/src/management`: controladores, DTOs y reglas de planes, departamentos, cobros y acceso.
- `apps/web/src`: páginas, componentes, layout, estilos e interacción del panel Astro.
- `test`: integración PostgreSQL.
- `scripts`: diagnóstico, recuperación de respaldos y prueba del navegador.

Las consultas de negocio se parametrizan con Bun SQL. PostgreSQL utiliza un bloqueo transaccional compartido entre instancias para evitar duplicar pagos y decisiones de acceso simultáneas. Las migraciones posteriores deben añadirse como nuevas versiones.

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

La prueba de interfaz arranca su servidor con `--no-env-file`, un entorno limitado a variables del sistema y la conexión a un esquema temporal dentro de `nuwenet`. Comprueba el código de instalación ausente, incorrecto y válido; bloquea HTTP saliente desde el backend y no habilita WhatsApp. Los fallos de navegador guardan una captura `nuwenet-ui-smoke-failure.png` en el directorio temporal del sistema. La suite de autenticación conserva el escenario local sin código. PostgreSQL se valida por separado con `bun run test:postgres` y su esquema temporal.

También puedes definir `BROWSER_CHANNEL=chrome` para usar Chrome instalado. La prueba del navegador siempre utiliza un esquema temporal dentro de `nuwenet`.

## Funciones y alcance

Planes, departamentos con IP privada opcional, mensualidades, pagos completos o abonos parciales, revisión manual o automática de vencimientos, suspensión y reactivación e historial. Sin IP o sin equipo central el control queda simulado; con IP y equipo central registrado se aplica en red. Los importes se guardan en centavos con la moneda de `CURRENCY` solo en presentación. Los vencimientos usan America/La_Paz y el historial muestra fechas UTC.

El panel y las operaciones de negocio exigen sesión. Sin usuarios solo se permite crear el primer usuario, que es el super-admin único y global (dueño del sistema). El super-admin da de alta a los administradores, les asigna edificios y configura la red de cada uno. Sin roles de caja ni técnico. Los avisos se registran internamente o se envían por WhatsApp si se configura el proveedor y se habilita expresamente el envío. La integración incluye cola, reintentos y webhook de estados; que exista código no implica que esté habilitado en esta instalación. SMS no está implementado.

La generación incluye departamentos suspendidos y excluye archivados. El día del vencimiento y los días de gracia configurados no provocan corte. Un pago puede reactivar si no quedan cuotas vencidas; nunca elimina un bloqueo manual. Los abonos, referencias, recibos y reversiones conservan el historial.

El control de acceso es **mixto**: real en el equipo central por IP (`suspend`, `reactivate`, `speed_limit`, `firewall` por destino y `parental_control` por horario) y simulado en el resto. Cada edificio tiene su propio equipo central MikroTik, sus planes, departamentos e IPs (el departamento y la IP se validan por edificio y pueden repetirse en edificios distintos). ARRIS TG2492LG-NA con firmware 9.1.103HB admite filtros IPv4 TCP/UDP por IP, puertos y horarios; no ofrece límites de velocidad ni sustituye al central MikroTik. OpenWrt permite consulta. El estado guardado de un router no acredita conectividad física actual.

El portal permite consultar la cuenta, reportar transferencias y mostrar datos bancarios/QR por edificio; administración verifica el ingreso antes de aprobar. No hay conciliación bancaria automática ni facturación fiscal. El consumo incluye historial diario y mensual persistente a partir de muestras de colas MikroTik, con indicación de reinicios y huecos; el tráfico en vivo es una consulta distinta. La puesta en marcha con residentes exige validar servidor, red e integraciones en su entorno real.

Desde **Respaldos** puedes crear y verificar copias; los intervalos se configuran en **Edificio y automatización**. PostgreSQL utiliza `pg_dump` y `pg_restore`; instala estas herramientas en la VPS. Para restaurar a un directorio nuevo utiliza `scripts/restore-backup.mjs`; consulta el procedimiento en [la guía de operación](docs/operacion.md#respaldos-y-restauración).

Documentación: [NestJS](https://docs.nestjs.com/first-steps), [Astro](https://docs.astro.build/en/guides/client-side-scripts/) y [Bun SQL](https://bun.com/docs/runtime/sql).

## Despliegue en VPS

Configura `.env` con PostgreSQL, `ROUTER_ENCRYPTION_KEY` (32 bytes aleatorios en base64) y un `SETUP_TOKEN` privado para crear el primer administrador. Conserva las claves entre despliegues. Compila con `bun run build` y ejecuta `bun run start` mediante un servicio del sistema. Publica el dominio con un proxy HTTPS hacia `127.0.0.1:3000`; configura `COOKIE_SECURE=true`, `TRUST_PROXY=loopback` y `ALLOWED_ORIGINS=https://tu-dominio`.

La VPS necesita conectividad hacia los routers de cada edificio mediante una red privada o VPN. Las direcciones privadas de los routers requieren esa conexión desde la VPS.

Las pruebas utilizan la conexión del único `.env` y requieren `pg_dump` y `pg_restore`. `bun run verify` comprueba tipos, compilación, pruebas de API y navegador. Los ensayos de restauración usan exclusivamente el esquema del escenario de prueba dentro de `nuwenet`.
