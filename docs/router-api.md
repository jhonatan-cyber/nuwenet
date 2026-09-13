# API de integración de routers

El módulo NestJS `RoutersModule` separa la API del protocolo de cada equipo. Los adaptadores implementan `RouterAdapter` y devuelven un `RouterSnapshot` normalizado. Se almacenan conexiones, credenciales cifradas y resultados de consultas en PostgreSQL mediante la migración 2.

## Compatibilidad actual

| Adaptador | Protocolo | Funciones implementadas | Validación |
| --- | --- | --- | --- |
| `arris-touchstone` | Sesión web con Playwright | Modelo, firmware, hardware, serie, WAN/LAN, Wi-Fi 2,4/5 GHz y clientes con IPv4/IPv6 desde la IP de administración. Diagnóstico DOCSIS adicional opcional | Equipo TG2492LG-NA, firmware 9.1.103HB; consulta real de 5 clientes únicos |
| `mikrotik-rest` | RouterOS REST con autenticación Basic | Identificación, versión, tiempo activo e interfaces | Pruebas con respuestas simuladas; falta equipo físico |
| `openwrt-ubus` | ubus JSON-RPC | Login, identificación, versión, tiempo activo e interfaces | Pruebas con respuestas simuladas; falta equipo físico |

La compatibilidad depende del modelo, firmware, servicios habilitados y permisos. No hay una API universal que convierta cualquier router en un equipo administrable. Un adaptador web ARRIS puede necesitar ajustes cuando cambia su firmware. Un firewall disponible en el panel del equipo no implica que este adaptador implemente su modificación.

OpenWrt es de consulta. ARRIS TG2492LG-NA con firmware 9.1.103HB integra filtros IPv4 TCP/UDP por IP, puertos y horarios. MikroTik REST implementa suspensión, reactivación, velocidad, bloqueo por destino y control parental. Solo MikroTik está habilitado como equipo central para las órdenes de departamentos: ARRIS no proporciona un corte completo de IPv6 ni límites de velocidad por cliente. Consulta [la guía de operación](operacion.md) para estados, reintentos, cambios de IP y limpieza de reglas.

### Controles ARRIS

En **Controlar dispositivo** se puede bloquear TCP/UDP IPv4 de una IP, quitar ese bloqueo, filtrar puertos o configurar horarios. La escritura verifica modelo y firmware antes de modificar reglas. Las operaciones se serializan por equipo, utilizan el mecanismo del panel `FWIPFilterTable` y aplican mediante `ApplyAllSettings`, sin reiniciar el equipo. La lectura posterior debe coincidir con la regla solicitada antes de informar éxito.

- `suspend` y `reactivate`: agregar/quitar exclusivamente el filtro `nuwenet:suspend:<IP>:`. No constituyen una suspensión completa de internet: no cubren IPv6, ICMP ni otros protocolos.
- `firewall`: `target` es un protocolo y rango de puertos, por ejemplo `tcp:80`, `udp:53` o `both:1000-2000`. `remove: true` quita únicamente ese filtro. No se reinterpretan destinos IP o dominios como filtros globales.
- `parental_control`: `schedule` admite `22h-7h,mon,tue` u `off`. Los cruces de medianoche se separan y desplazan al día siguiente. La hora corresponde al reloj del router. Quitar un horario conserva el bloqueo manual.
- `speed_limit`: no disponible por dispositivo en este firmware; continúa deshabilitado. Los controles globales de LAN encontrados en las definiciones del firmware no se usan como límites individuales.

Se conservan las reglas externas y las de otras funciones. Un error de escritura puede dejar cambios parciales y se informa como fallo; la lectura de reglas permite revisar el resultado antes de reintentar. Validación: formularios y funciones de escritura inspeccionados en el equipo real, pruebas de operaciones con un controlador simulado. No se aplicaron filtros reales durante el desarrollo para comprobar cortes de tráfico.

## Endpoints

### Conexión automática

`POST /api/routers/test` prueba los datos sin guardar conexiones, credenciales ni resultados en la base. Recibe `host`, `username` y `password`; opcionalmente `adapter`, `protocol`, `port` y `diagnostic_host` para una prueba manual. En configuración manual, adaptador, protocolo y puerto se proporcionan juntos. Devuelve `success`, `adapter`, `target` y `snapshot`. El botón Probar conexión del modal muestra el resultado y mantiene el formulario abierto; guardar es una acción separada.

`POST /api/routers/connect` recibe únicamente `host` (IPv4 privada), `username` y `password`. Consulta HTTPS en 443 y luego HTTP en 80, detecta los adaptadores compatibles y guarda el equipo con su primera consulta solo si la autenticación e identificación tienen éxito. El nombre se obtiene del fabricante y modelo disponibles. No sigue redirecciones ni consulta otras IP.

La interfaz ofrece este flujo por defecto con una sola IP. Configuración avanzada conserva la selección manual de adaptador, puerto y protocolo. La detección no habilita servicios ni amplía los permisos del usuario del router; solo consulta los datos implementados por cada adaptador. ARRIS requiere que su página de acceso identifique ARRIS/Touchstone y el campo `UserName`. El modelo se obtiene de la sesión del panel. Otros puertos, interfaces y equipos no compatibles requieren configuración manual o un adaptador adicional.

En ARRIS, la tabla de clientes adjuntos se agrupa por MAC y conserva todas las direcciones IPv4/IPv6; las reservas DHCP no se incluyen como dispositivos conectados. Los contadores de clientes por banda y LAN se muestran tal como los informa el equipo. La presencia en la tabla no garantiza conectividad en tiempo real. Si falla esta lectura opcional, se mantienen los datos del estado general y se añade una nota. Las consultas no leen ni guardan claves Wi-Fi. El diagnóstico DOCSIS y los estados físicos de los puertos siguen dependiendo de la interfaz de diagnóstico, disponible mediante `diagnostic_host` en la API para configuraciones existentes; no se pide una segunda IP en el modal.

La selección del router central sigue siendo explícita en Edificio y automatización.

Base: `/api/routers`. En desarrollo se puede utilizar a través de Astro en el puerto 4321 o directamente en NestJS en el 3000.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/api/routers/adapters` | Adaptadores, requisitos y capacidades implementadas |
| GET | `/api/routers` | Conexiones, última consulta y capacidades; nunca credenciales |
| POST | `/api/routers` | Guardar una conexión; todavía no contacta al equipo |
| GET | `/api/routers/:id` | Conexión y últimas 20 consultas |
| POST | `/api/routers/:id/update` | Actualizar conexión e invalidar el estado anterior |
| POST | `/api/routers/:id/check` | Autenticar y consultar el equipo; guarda resultado e historial |
| POST | `/api/routers/:id/remove` | Quitar conexión e historial del sistema; no modifica el router |
| POST | `/api/routers/:id/actions` | Central: `{"action":"suspend"|"reactivate","ip":"192.168.x.x"}`, `{"action":"speed_limit","ip":"...","down":50,"up":20}`, `{"action":"firewall","ip":"...","target":"tiktok.com"}` (o `"remove":true` para permitir) o `{"action":"parental_control","ip":"...","schedule":"22h-7h,mon"}` (`"off"` quita el horario); ARRIS/OpenWrt rechazan con HTTP 422; sin `ip` devuelve 400 |
| POST | `/api/customers/ip` | Asignar o quitar (`{}` sin `ip`) la IP privada del departamento; valida RFC1918 y duplicados |

Registro de ejemplo, sin credenciales reales:

```json
{
  "name": "Router principal",
  "adapter": "arris-touchstone",
  "host": "192.168.0.1",
  "port": 80,
  "protocol": "http",
  "diagnostic_host": "192.168.100.1",
  "username": "usuario_del_router",
  "password": "contraseña_del_router"
}
```

`diagnostic_host` es opcional y se utiliza exclusivamente con ARRIS. Debe corresponder al diagnóstico DOCSIS del mismo equipo; no se descubre automáticamente. Sin esa dirección puede verificarse el acceso administrativo y consultarse el firmware, pero no el modelo DOCSIS ni las interfaces.

Las direcciones admitidas son IPv4 privadas RFC1918, accesibles por LAN o VPN. No se aceptan URLs arbitrarias, DNS, direcciones públicas, loopback ni endpoints de metadatos. No hay exploración automática de redes. HTTPS valida el certificado del router; no se deshabilita la validación TLS.

Para editar, envía los campos de conexión completos. Omite **ambos** campos `username` y `password` si quieres conservar las credenciales existentes; para cambiarlas envía los dos.

Una consulta completada devuelve HTTP 200 con `success: true` o `success: false`. En caso de fallo se guarda `status: error` y un mensaje sin contraseñas; no se conserva un estado antiguo como si fuera actual. `connected` significa que la **última consulta** fue correcta, no que haya monitoreo continuo. Las lecturas opcionales que falten se describen en `snapshot.notes`.

La consulta ARRIS puede tardar hasta dos minutos. Ajusta el timeout del proxy si utilizas otro servidor intermedio. Hay un máximo de dos consultas simultáneas por instancia y una por conexión. Si otra instancia cambia o elimina la conexión mientras se consulta, el resultado obsoleto se descarta.

## Autenticación del panel

Las operaciones de negocio exigen sesión incluso antes de crear el primer usuario, que es el super-admin único y global. Solo status/setup/login/logout/me son públicos. Setup es atómico y requiere código para acceso remoto; las cookies son HttpOnly y SameSite=Lax, con Secure al usar HTTPS o COOKIE_SECURE=true. Los roles son superadmin (dueño del sistema: usuarios, edificios y red) y admin (solo sus edificios; la red la configura el super-admin). Las contraseñas se procesan con Bun.password y los tokens se guardan como hashes SHA-256. Consulta [permisos y acceso remoto](operacion.md#usuarios-y-acceso-remoto).

## Operación diaria (runbook)

1. **Alta:** crea el plan, registra el depto con su IP privada (lease estático del MikroTik). Al guardar con IP se aplica la velocidad del plan.
2. **Cobro:** genera mensualidades, registra el pago completo. Si no quedan cuotas vencidas, el depto se reactiva solo en el MikroTik.
3. **Mora:** pulsa Revisar vencimientos. Los deptos con cuota vencida se suspenden en el MikroTik; sin IP quedan simulados.
4. **Verificación:** en Routers, Probar conexión muestra bloqueadas (`nuwenet-suspend-*`), colas (`nuwenet-*`) y leases. La tarjeta manual permite suspender/reactivar una IP suelta.
5. **Fallo de red:** la orden queda `mikrotik-failed` en Control de acceso con evento explicativo; la base sigue siendo la verdad. Reintenta la acción manual o revisa credenciales/conectividad.
6. **Rollback a simulado:** quita la IP del depto (`POST /api/customers/ip` sin `ip`) o quita el router de NuweNet (no toca el router). Limpia a mano en WinBox las reglas `nuwenet-suspend-*` y colas `nuwenet-*` si ya no las quieres.

## Cifrado y navegador

Las credenciales se cifran con AES-256-GCM. La API nunca devuelve ni el texto plano ni el cifrado. Usa `ROUTER_ENCRYPTION_KEY`, una clave de 32 bytes en base64, compartida entre las instancias del mismo despliegue. No debe estar en una variable `PUBLIC_*`.

Es obligatorio configurar la variable antes de guardar credenciales. Respalda la clave junto con la base: sin ella no se pueden descifrar las conexiones. Cambiarla no recifra automáticamente los datos existentes.

Generar una clave para un **despliegue nuevo**:

```sh
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Para el adaptador ARRIS instala Chromium:

```sh
bunx playwright install chromium
```

En una computadora con Chrome instalado puedes configurar `ROUTER_BROWSER_CHANNEL=chrome`. El navegador se ejecuta sin ventana visible, solo permite solicitudes a los orígenes configurados y destruye su sesión al terminar. No se guardan cookies, contraseñas Wi-Fi, números de serie ni datos brutos de diagnóstico.

La aplicación mantiene su alcance de administrador local. Antes de exponerla en la web deben implementarse la autenticación y los permisos generales de NuweNet; cifrar las credenciales no sustituye el control de acceso a la API.

## Equipos centrales y dispositivos por edificio

El central se asigna con `POST /api/buildings/central`, usando `building_id` y `central_router_id` (o `null` para modo simulado). El router debe pertenecer al mismo edificio. `/api/settings` ya no acepta un central global. Antes de ejecutar cada orden se comprueban el edificio del cliente, el router actual y el equipo anterior si hay limpieza pendiente.

`GET /api/state?building_id=ID` devuelve `enforcement.state`: `simulated`, `unverified`, `real` o `error`; la vista conjunta también puede devolver `mixed`. Una consulta correcta del router no confirma por sí sola que todas las órdenes se hayan aplicado; el resultado de cada departamento permanece en Control de acceso.

`POST /api/routers/:id/devices` recibe `{ "mac": "AA:BB:CC:DD:EE:FF", "customer_id": 123 }`. La MAC debe figurar en la última consulta y el departamento debe estar vigente y pertenecer al mismo edificio. `customer_id: null` retira la asociación. Los administradores pueden gestionar estos vínculos dentro de sus edificios; configurar el hardware sigue reservado al superadministrador.

El detalle del router devuelve `devices` y los departamentos disponibles. Las asociaciones persisten cuando cambia la IP o el dispositivo deja de aparecer en una consulta. El control automático incluye la IP de servicio y las IPv4 activas de las MAC vinculadas. En MikroTik se aplica una cola compartida por departamento y se limpian las direcciones anteriores; consulta configuracion-operativa.md para requisitos y validación física.

La migración 14 elimina el campo global heredado sin asignarlo automáticamente a otro edificio ni modificar el equipo físico. Los edificios que carezcan de central deben configurarlo expresamente.

## Añadir otro fabricante

1. Implementa `RouterAdapter` en `apps/api/src/routers/adapters`.
2. Declara únicamente las capacidades implementadas y los requisitos del protocolo.
3. Regístralo en `AdapterRegistry`, en `RoutersModule` y en el tipo/DTO de identificadores admitidos. Si implementa escritura por IP (`suspend`/`reactivate`/`setSpeedLimit`), añade su id a `enforcingAdapters` en `router.types.ts` para que el control automático lo use.
4. Normaliza las respuestas en `RouterSnapshot`; no devuelvas respuestas brutas ni secretos.
5. Añade pruebas del protocolo y valida con un equipo físico compatible antes de anunciar soporte verificado.

No se ejecutan comandos arbitrarios ni scripts aportados desde la API. Incorporar acciones de escritura requiere implementar el contrato de ejecución, confirmar su resultado y conectarlas explícitamente con los departamentos.

Referencias de protocolos: [RouterOS REST](https://manual.mikrotik.com/docs/developer-guides/rest-api/), [OpenWrt ubus](https://openwrt.org/docs/techref/ubus), [OpenWrt system](https://openwrt.org/docs/guide-developer/ubus/system).
