# Operación de NuweNet

## Puesta en marcha

1. Ejecuta `bun run build` y `bun run start`. Abre `http://127.0.0.1:3000`.
2. Crea el primer usuario: es el super-admin único y global, dueño del sistema (no pertenece a ningún edificio). Hasta entonces, las operaciones de negocio y las automatizaciones están bloqueadas.
3. Como super-admin, crea cada edificio en **Edificios y accesos**, da de alta a sus administradores en **Usuarios y permisos** y asígnales sus edificios. Un administrador puede tener varios edificios.
4. Registra el router de cada edificio y selecciona expresamente su equipo central en Configuración. No existe router global ni herencia entre edificios. Sin central asignado, el edificio funciona en modo simulado. Registrar un router no lo selecciona automáticamente.
5. Asigna IP privadas estables a los departamentos (se validan por edificio). MikroTik permite consultar clientes DHCP y vincular dispositivos con departamentos; esto no equivale a crear reservas DHCP automáticamente. Verifica la estabilidad de las direcciones en la red.

Para crear el super-admin desde una conexión remota configura `SETUP_TOKEN` en el servidor y escribe ese código en la pantalla inicial. Las peticiones directas de loopback pueden crear el super-admin sin código cuando no hay uno configurado. La comprobación del primer usuario y su inserción se realizan en la misma transacción. Solo puede existir un super-admin.

## Cobros y departamentos

- Los importes se almacenan en centavos. **Saldo vencido** descuenta los abonos no revertidos. **Cobrado este mes** suma pagos no revertidos por su fecha de recepción, con límites mensuales en America/La_Paz.
- Un pago parcial tiene método, referencia, usuario y un identificador de operación. El panel conserva ese identificador al reintentar la misma solicitud para evitar cobrar dos veces.
- Los recibos imprimibles son comprobantes internos, no facturas fiscales. Las reversiones conservan el pago original, registran motivo y usuario, reabren el saldo y solicitan suspensión si queda mora fuera de la gracia.
- Editar el precio de un plan afecta a futuras mensualidades; no reescribe cuotas existentes. Editar su velocidad solicita la actualización de sus departamentos vigentes.
- Archivar conserva clientes, pagos y deudas, solicita suspensión y excluye nuevas cuotas. Restaurar conserva un bloqueo manual hasta que se reactive expresamente.
- Pagar no elimina una suspensión manual. Una suspensión por mora sí puede levantarse al liquidar las cuotas vencidas, respetando la gracia configurada.
- Las cuotas con importe cero se generan saldadas.

## Control de red

Los estados solicitados de servicio y los resultados de red son independientes. Cada orden aparece como **simulada**, **pendiente**, **aplicando**, **aplicada** o **fallida**. “Aplicada” significa que las escrituras del adaptador terminaron correctamente; no sustituye una prueba física de conectividad ni verifica el orden de las reglas externas al sistema.

Las órdenes se guardan en la misma transacción que el cambio de negocio. Un trabajador las procesa cada 10 segundos, conserva el orden por departamento y reintenta fallos entre 30 segundos y 15 minutos. El botón Reintentar adelanta el siguiente intento. Los arrendamientos en la base coordinan varias instancias; una orden que quedó en ejecución se recupera al vencer el arrendamiento (cinco minutos desde su última renovación).

Cambiar una IP elimina las reglas de suspensión, firewall, horario y la cola con nombres propios de NuweNet en la dirección anterior; solicita acceso y velocidad en la nueva. Las restricciones adicionales por destino u horario de la IP anterior deben configurarse de nuevo en la nueva dirección. No se eliminan reglas ajenas a NuweNet. Una IP con limpieza pendiente no puede asignarse a otro departamento.

Los bloqueos por destino tienen una lista distinta por IP. Al ejecutar una acción de firewall se migran las listas compartidas de versiones anteriores. Eliminar un destino conserva los demás bloqueos de ese departamento. Las acciones de acceso y velocidad de IP registradas deben ejecutarse desde Departamentos/Planes, para conservar la cola y el historial.

Cambiar el equipo central solicita limpiar el anterior y aplicar el nuevo. Antes deben resolverse las órdenes pendientes; un equipo central o con trabajos pendientes no puede eliminarse ni cambiar de dirección. Sí pueden corregirse sus credenciales para recuperar la conexión.

La migración conserva las suspensiones anteriores como manuales porque su causa no estaba estructurada. No ejecuta órdenes antiguas ni elige automáticamente un router. Revisa el equipo central y los departamentos antes de activar el control real.

## Automatización y avisos

La configuración se guarda en la base y se comparte entre instancias. Por defecto las tareas optativas están desactivadas, salvo la revisión de mora si ya estaba configurada mediante `OVERDUE_CRON_MINUTES`.

- Generación mensual: comprueba cada hora, a partir del día elegido, y crea el periodo actual sin duplicarlo. No genera retroactivamente meses anteriores. Los días de generación y vencimiento admiten 1–28.
- Mora: comprueba según el intervalo elegido. El día de vencimiento y los días de gracia no provocan corte.
- Recordatorios: una entrada interna por cuota pendiente y día, desde la anticipación elegida, incluidas las vencidas.
- Monitoreo: consulta cada equipo según su intervalo y registra avisos de fallo o recuperación.
- Respaldos: se ejecutan según el intervalo en horas.

Las tareas requieren el servidor encendido. Los avisos quedan en Actividad. WhatsApp está implementado con cola, reintentos y estados de entrega: requiere credenciales, plantilla y `WHATSAPP_SEND_ENABLED=true`, además de `NOTIFY_CHANNEL=whatsapp`. Revisa la cola antes de habilitarlo. La aceptación del proveedor no confirma entrega; el webhook informa entrega y lectura. SMS y correo no están implementados. Los datos bancarios y QR se configuran por edificio; los reportes de transferencia requieren verificación manual del ingreso, sin conciliación automática.

Cada tarea registra su última ejecución, último éxito, duración y último error (sección Tareas automáticas en Actividad y campo `automation` del estado). Si una tarea falla, las demás continúan; el fallo queda visible para diagnosticar sin tumbar el ciclo. La cola de red procesa hasta 10 órdenes por pasada con un presupuesto de 4 minutos para que un equipo lento no la monopolice. Un aviso que falla después de aplicarse la orden no la marca como fallida ni la repite: revisa el aviso en Actividad.

Umbrales iniciales: cola con más de 50 pendientes/fallidas o la más antigua con más de 24 h indica atraso (revisa conectividad del central y `/api/health`, que expone los conteos); una tarea con errores repetidos en su último error indica causa raíz (credenciales, permisos o equipo); un respaldo con más de 48 h en Respaldos indica riesgo de pérdida. Ajusta estos valores con el piloto.

El consumo histórico se acumula por día y mes desde muestras de las colas MikroTik, con zona America/La_Paz. Reinicios, huecos y estimaciones aparecen como información de cobertura. Un estado guardado «conectado» o una orden «aplicada» no sustituye la comprobación de conectividad física actual. ARRIS ofrece filtros IPv4 TCP/UDP limitados al modelo/firmware admitido; OpenWrt sigue siendo de consulta y solo MikroTik puede ser central de automatización.

## Usuarios y acceso remoto

| Rol | Operaciones |
| --- | --- |
| Super-admin | Todo el sistema: edificios, usuarios, red/routers, equipo central por edificio, respaldos, auditoría |
| Administrador | Solo sus edificios asignados: departamentos, planes, cobros, acceso (las órdenes usan el central que configuró el super-admin) |

Solo el super-admin crea edificios y usuarios, asigna accesos y configura routers y centrales. El super-admin no se vincula a ningún edificio: ve todo el sistema por rol. El administrador no ve Usuarios, Edificios ni automatización global. Los permisos se verifican en la API; ocultar botones no es el mecanismo de protección. Cada usuario cambia su contraseña desde Perfil. Cambiar contraseña o deshabilitar un usuario revoca sus sesiones. Siempre debe existir un super-admin habilitado. Las operaciones autenticadas exitosas se registran en Auditoría (últimas 200 en pantalla); los movimientos de negocio se muestran en Actividad.

Para HTTPS configura:

```dotenv
COOKIE_SECURE=true
ALLOWED_ORIGINS=https://panel.ejemplo.com
# Solo las IP o redes del proxy que administras; omitir si no hay proxy.
TRUST_PROXY=loopback
```

No configures confianza en proxies arbitrarios. El inicio de sesión y el setup admiten hasta 30 intentos por IP en diez minutos, coordinados en la base; los reportes del portal están limitados a 10 por minuto por IP. Las cookies son HttpOnly/SameSite=Strict; incluyen Secure con HTTPS detectado o con `COOKIE_SECURE=true`.

## Respaldos y restauración

Los respaldos se almacenan en `BACKUP_DIR` (por defecto `backups`) y se podan automáticamente según la política (`BACKUP_RETENTION_DAYS`, por defecto 30 días, conservando al menos `BACKUP_KEEP_MIN`, por defecto 3 copias verificadas). Conserva una segunda copia fuera del equipo (`BACKUP_EXTERNAL_DIR`: si el volumen falta, el respaldo local se conserva y la operación falla de forma visible) y controla el espacio disponible.

**Paquete cifrado (producción).** Con `BACKUP_ENCRYPTION_KEY` configurada (32 bytes en base64, **distinta** de `ROUTER_ENCRYPTION_KEY`), cada respaldo empaqueta la base y la clave de routers cifradas con AES-256-GCM por streaming y elimina el texto plano; el manifiesto conserva la huella de la clave y los hashes. Sin esa variable se conserva el formato heredado sin cifrar (no apto para producción). Genera la clave en un despliegue nuevo con:

```sh
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

**Custodia y rotación.** Guarda la clave de recuperación fuera del servidor (papel o gestor del dueño del sistema), separada de la clave de routers. No la reutilices entre entornos. Para rotarla, configura la nueva clave (los respaldos siguientes usan la nueva), conserva la anterior mientras existan copias que la necesiten y bórrala solo cuando esas copias salgan de retención. En Windows, `mode: 0o600` no basta: restringe con ACL (`icacls BACKUP_DIR /inheritance:r /grant:r Administradores:F`) y protege también las claves del entorno.

PostgreSQL genera un volcado custom con `pg_dump` y valida su catálogo con `pg_restore --list`. La verificación comprueba hashes y descifra los paquetes cifrados.

Para restaurar **a un directorio nuevo**:

```sh
bun run build
BACKUP_ENCRYPTION_KEY=<clave-de-recuperación> bun scripts/restore-backup.mjs backups/snapshot-NOMBRE data-restaurada
```

El script rechaza destinos existentes, descifra y verifica el paquete en un directorio nuevo. Después restaura `nuwenet.dump` con `pg_restore --exit-on-error --dbname=BASE_NUEVA archivo.dump`. Configura la conexión a esa base y `ROUTER_ENCRYPTION_KEY` con la clave respaldada antes de iniciar. El script no modifica la base en uso.

**Objetivos.** Pérdida máxima aceptada: 24 h (ajusta `backup_hours` si necesitas menos); recuperación completa en menos de 2 h. Ensaya la restauración en un directorio nuevo y registra el tiempo real; no declares el procedimiento válido sin un simulacro.

PostgreSQL requiere `pg_dump` y `pg_restore` instalados; puedes indicar sus rutas mediante `PG_DUMP_PATH` y `PG_RESTORE_PATH`. Se crea un archivo custom y se valida su catálogo con `pg_restore --list`. La verificación de PostgreSQL no equivale a una restauración completa: restaura periódicamente en una base nueva con `pg_restore --exit-on-error --dbname=BASE_NUEVA archivo.dump`, verifica allí tus datos y configura la clave respaldada. No uses la base en producción como destino de una prueba.

## API y validación

`GET /api/state` devuelve agregados completos y páginas de 25 departamentos, cuotas y pagos. Admite `customer_page`, `invoice_page`, `payment_page`, `search`, `archived=0|1` y `customer_id`. Los totales se incluyen en `pagination`; los indicadores no dependen de la página visible.

Las rutas nuevas son `POST /api/plans/update`, `/api/customers/update`, `/api/customers/archive`, `/api/payments/reverse`, `/api/settings`, `/api/network/retry`; `GET /api/payments/:id/receipt`, `/api/audit`; y las rutas de usuarios y respaldos utilizadas por sus pantallas.

```sh
bun run check
bun run test
bun run test:ui
```

Las pruebas de confiabilidad cubren alta atómica, pagos con límites mensuales locales, reintentos de abonos, reversión, archivo, gracia, filtros, cola recuperable, separación de destinos y restauración SQLite. Las pruebas de dispositivos usan adaptadores/respuestas simuladas. PostgreSQL tiene una prueba separada que requiere un servidor disponible y permiso de creación de bases temporales.
