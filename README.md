# NuweNet

Plan de trabajo: [implementación de mejoras, prioridades y criterios de aceptación](docs/plan-implementacion-mejoras.md).

Interfaz: preferencias, perfil, planes y departamentos (listado, formularios y diálogos) utilizan islas React con shadcn/ui y Tailwind; la migración es gradual. La gráfica de consumo sigue compartida con el portal. Consulta [estilos, componentes y alcance migrado](docs/estilos-y-componentes.md).

Sistema de gestión de internet para edificios: **NestJS + Astro + Bun**, con **SQLite local** o **PostgreSQL** seleccionable por entorno.

El panel incluye **Routers** para registrar conexiones y probar consultas reales mediante adaptadores ARRIS Touchstone, MikroTik REST y OpenWrt ubus. MikroTik puede actuar como equipo central para aplicar acceso y velocidad mediante una cola persistente. Consulta [la guía de operación, permisos, automatizaciones y respaldos](docs/operacion.md) y [la API de routers](docs/router-api.md).

## Instalación

Requiere Bun 1.4 o superior. Bun instala dependencias, ejecuta el backend, compila la interfaz y corre las pruebas.

```sh
bun install --frozen-lockfile
```

El archivo de dependencias es `bun.lock`. NestJS se compila con TypeScript para conservar los metadatos de decoradores usados en inyección de dependencias y validaciones.

## Desarrollo local con SQLite

Copia `.env.example` como `.env` si todavía no existe. La configuración predeterminada utiliza SQLite.

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

Copia `.env.postgres.example` como `.env.postgres` y configura la conexión. Si ya existe un archivo local con tus credenciales, consérvalo. Los archivos `.env` y `.env.postgres` están excluidos del repositorio; los ejemplos no contienen contraseñas reales.

```dotenv
DB_DRIVER=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nuwenet
PGUSER=postgres
PGPASSWORD=tu_contraseña
PGSSLMODE=disable
```

Prepara la base si no existe y ejecuta el sistema:

```sh
bun run db:postgres:create
bun run build
bun run start:postgres
```

`db:postgres:create` conecta a la base de mantenimiento `postgres` mediante las variables `PG*`; requiere permiso para crear bases y no modifica una base existente. Las tablas y el registro de migraciones se crean al iniciar NestJS.

Para desarrollar con PostgreSQL:

```sh
bun --env-file=.env.postgres run dev
```

SQLite y PostgreSQL son **alternativas por entorno**. Cambiar el motor no copia ni sincroniza los datos. La base SQLite original se conserva en `data/nuwenet.sqlite`; PostgreSQL guarda sus propios registros.

En un alojamiento web configura sus variables de entorno: `DB_DRIVER=postgres`, la conexión PostgreSQL y `HOST=0.0.0.0` si la plataforma lo requiere. `DATABASE_URL` también se admite y tiene prioridad sobre las variables `PG*`; en ese caso el SSL debe ir en la URL, por ejemplo `?sslmode=verify-full`. Con variables separadas utiliza `PGSSLMODE` según el proveedor. La configuración local no publica automáticamente la aplicación en internet.

## Configuración

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `DB_DRIVER` | `sqlite` | `sqlite` o `postgres` |
| `DATA_DIR` | `data` | Directorio SQLite, relativo a la raíz del proyecto o absoluto |
| `PGHOST` / `PGPORT` | `127.0.0.1` / `5432` | Servidor PostgreSQL |
| `PGDATABASE` | `nuwenet` | Base PostgreSQL |
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

- `apps/api/src/database`: conexión mediante Bun SQL, selección de motor, migración inicial y transacciones.
- `apps/api/src/management`: controladores, DTOs y reglas de planes, departamentos, cobros y acceso.
- `apps/web/src`: páginas, componentes, layout, estilos e interacción del panel Astro.
- `test`: integración SQLite y PostgreSQL.
- `scripts`: preparación PostgreSQL y prueba del navegador.

Las consultas de negocio se parametrizan con Bun SQL. SQLite serializa el acceso a su conexión; PostgreSQL utiliza un bloqueo transaccional compartido entre instancias para evitar duplicar pagos y decisiones de acceso simultáneas. El esquema inicial conserva las tablas de la primera versión SQLite. Las migraciones posteriores deben añadirse como nuevas versiones.

## Validación

Ejecuta estos comandos por separado: Astro comparte caché entre comprobación y compilación.

```sh
bun run check
bun run test
bun run test:postgres
```

Las pruebas verifican registros, validaciones, mensualidades sin duplicados, pagos concurrentes, suspensión, reactivación y persistencia. La prueba PostgreSQL crea una base temporal `nuwenet_test_*`, conecta dos instancias de NestJS y elimina únicamente esa base al terminar. Requiere permiso de creación de bases; no carga datos de prueba en `nuwenet`.

Para validar la interfaz:

```sh
bunx playwright install chromium
bun run test:ui
```

Para ejecutar tipos, compilación, suite e interfaz en secuencia, sin compilar dos veces:

```sh
bun run verify
```

La prueba de interfaz arranca su servidor con `--no-env-file`, un entorno limitado a variables del sistema y una SQLite temporal. Comprueba el código de instalación ausente, incorrecto y válido; bloquea HTTP saliente desde el backend y no habilita WhatsApp. Los fallos de navegador guardan una captura `nuwenet-ui-smoke-failure.png` en el directorio temporal del sistema. La suite de autenticación conserva el escenario local sin código. PostgreSQL se valida por separado con `bun run test:postgres` y su base temporal.

También puedes definir `BROWSER_CHANNEL=chrome` para usar Chrome instalado. La prueba del navegador siempre utiliza una SQLite temporal.

## Funciones y alcance

Planes, departamentos con IP privada opcional, mensualidades, pagos completos o abonos parciales, revisión manual o automática de vencimientos, suspensión y reactivación e historial. Sin IP o sin equipo central el control queda simulado; con IP y equipo central registrado se aplica en red. Los importes se guardan en centavos con la moneda de `CURRENCY` solo en presentación. Los vencimientos usan America/La_Paz y el historial muestra fechas UTC.

El panel y las operaciones de negocio exigen sesión. Sin usuarios solo se permite crear el primer usuario, que es el super-admin único y global (dueño del sistema). El super-admin da de alta a los administradores, les asigna edificios y configura la red de cada uno. Sin roles de caja ni técnico. Los avisos se registran internamente o se envían por WhatsApp si se configura el proveedor y se habilita expresamente el envío. La integración incluye cola, reintentos y webhook de estados; que exista código no implica que esté habilitado en esta instalación. SMS no está implementado.

La generación incluye departamentos suspendidos y excluye archivados. El día del vencimiento y los días de gracia configurados no provocan corte. Un pago puede reactivar si no quedan cuotas vencidas; nunca elimina un bloqueo manual. Los abonos, referencias, recibos y reversiones conservan el historial.

El control de acceso es **mixto**: real en el equipo central por IP (`suspend`, `reactivate`, `speed_limit`, `firewall` por destino y `parental_control` por horario) y simulado en el resto. Cada edificio tiene su propio equipo central MikroTik, sus planes, departamentos e IPs (el departamento y la IP se validan por edificio y pueden repetirse en edificios distintos). ARRIS TG2492LG-NA con firmware 9.1.103HB admite filtros IPv4 TCP/UDP por IP, puertos y horarios; no ofrece límites de velocidad ni sustituye al central MikroTik. OpenWrt permite consulta. El estado guardado de un router no acredita conectividad física actual.

El portal permite consultar la cuenta, reportar transferencias y mostrar datos bancarios/QR por edificio; administración verifica el ingreso antes de aprobar. No hay conciliación bancaria automática ni facturación fiscal. El consumo incluye historial diario y mensual persistente a partir de muestras de colas MikroTik, con indicación de reinicios y huecos; el tráfico en vivo es una consulta distinta. La puesta en marcha con residentes exige validar servidor, red e integraciones en su entorno real.

Desde **Respaldos** puedes crear y verificar copias; los intervalos se configuran en **Edificio y automatización**. SQLite permite copias consistentes en línea e incluye la clave de los routers. Para restaurar a un directorio nuevo utiliza `scripts/restore-backup.mjs`; consulta el procedimiento y las diferencias con PostgreSQL en [la guía de operación](docs/operacion.md#respaldos-y-restauración).

Documentación: [NestJS](https://docs.nestjs.com/first-steps), [Astro](https://docs.astro.build/en/guides/client-side-scripts/) y [Bun SQL](https://bun.com/docs/runtime/sql).
