# NuweNet Pro: implementación y puesta en marcha

Los cambios se realizaron en `D:\DEV\nuwenet`. El worktree abierto pertenecía a otro proyecto (`biometric`). Se conservó una copia previa de fuentes, compilados, pruebas y manifiestos en `backups/pro-source-20260911-163632`. No se modificó la base operativa ni se reiniciaron servicios operativos durante la implementación.

## Funciones implementadas

- **Portal del residente:** enlace privado desde Departamentos; plan, velocidad, estado solicitado del servicio, facturas con abonos y saldo, pagos firmados e impresión, transferencia reportada y consulta de contadores de su propia cola. No expone los dispositivos ni las colas de otros departamentos.
- **Migración 17:** columna e índice único de tokens y tabla de reportes. Los tokens nuevos usan 32 bytes criptográficos. En el siguiente inicio, también se reparan tokens ausentes o cortos de una instalación parcial anterior; los enlaces antiguos inseguros dejan de funcionar y deben compartirse nuevamente. Los tokens seguros existentes se conservan.
- **Reportes:** administradores limitados a sus edificios. Aprobar distribuye el importe entre cuotas pendientes por vencimiento en una transacción; una segunda aprobación se rechaza. Rechazar conserva el reporte sin contabilizar un pago. Los importes superiores al saldo pendiente requieren revisión y no generan crédito implícito. Se respetan las suspensiones manuales.
- **WhatsApp:** botones en mensualidades y pagos, conectados con la cola persistente de `NotifierService`. Endpoints `POST /api/invoices/:id/send-whatsapp` y `POST /api/payments/:id/send-whatsapp`. El registro interno o la entrada en cola no se presentan como entrega confirmada. Los pagos revertidos no generan recibos de pago confirmado.
- **Tickets:** vista previa, papel de 80 o 58 mm, impresión aislada de la interfaz, edificio, titular, periodo, importe, método, referencia, operador e identificador NNW. Firma de integridad HMAC-SHA256 generada por el servidor; no es una firma personal con certificado ni una factura fiscal. La clave queda en la base y debe conservarse con sus respaldos.
- **Cobro bancario:** datos por edificio en Mensualidades → Datos bancarios / QR. Banco, titular, cuenta, imagen QR o contenido QR, contacto y mensaje de suspensión. El importe visible se actualiza al introducir un abono. El QR de texto se genera localmente, sin enviar datos a servicios de imágenes.
- **Red:** botones de tráfico (cada 3 segundos mientras el diálogo permanece abierto) y descubrimiento DHCP, con vinculación a departamentos. Se corrige el orden subida/bajada de RouterOS y se reconocen tasas con unidades decimales. `GET /api/routers/:id/traffic?target=IP_O_NOMBRE_DE_COLA` admite filtrado.

## QR bancario y monto exacto

Una imagen es un QR estático; mostrar otro importe junto a ella no cambia su contenido. El residente debe comprobar el importe en la aplicación bancaria.

Si el banco ofrece una plantilla de contenido QR que acepta el importe, se puede configurar el marcador literal `{amount}` en **Contenido QR del banco**. Se sustituye por el importe con dos decimales y se regenera el QR al cambiar el abono. La imagen, si está configurada, tiene prioridad sobre el texto.

Este mecanismo necesita una plantilla válida proporcionada por el banco. No genera credenciales bancarias, no modifica estructuras firmadas/cifradas y no certifica compatibilidad con todos los bancos. Los QR que exigen una API bancaria, firma o vencimiento deben obtenerse del proveedor; no se inventa ese protocolo. Una URL bancaria con `{amount}` es utilizable solamente si el banco documenta ese formato.

La aprobación sigue siendo manual tras verificar el ingreso bancario; reportar una transferencia no acredita fondos automáticamente.

## Activación de WhatsApp

Utilizar la configuración existente del proyecto: `NOTIFY_CHANNEL=whatsapp`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE`, `WHATSAPP_LANGUAGE` y `WHATSAPP_SEND_ENABLED=true`. Se requiere un teléfono válido del residente y una plantilla compatible con el mensaje. Consultar los estados de la cola en Actividad. Las pruebas usan respuestas simuladas o registro interno, sin enviar mensajes reales.

## Activación del portal de corte

Configurar en el entorno del servidor, con valores reales de la LAN:

```dotenv
NUWENET_PORTAL_IP=192.168.88.10
NUWENET_PUBLIC_URL=http://192.168.88.10:3000
NUWENET_CAPTIVE_PORT=3080
NUWENET_ADMIN_CONTACT=Contacto de administración
NUWENET_SUSPENSION_MESSAGE=Comunícate con administración para regularizar tu servicio.
```

Los valores anteriores son ejemplos, no se aplicaron al entorno operativo. La IP debe pertenecer al servidor NuweNet y ser alcanzable desde las VLAN de residentes; la URL debe resolver a esa IP. Si se usa un nombre DNS, la red suspendida también debe poder resolverlo. El servicio web debe escuchar en una interfaz alcanzable y el cortafuegos del servidor debe permitir los puertos correspondientes. Comprobar antes que el puerto dedicado esté libre. Mantener esta configuración hasta retirar las reglas de los clientes suspendidos.

Al suspender, el adaptador crea excepciones TCP hacia el servidor y de retorno, y una regla `dst-nat` para HTTP 80 hacia el puerto dedicado. Coloca el bloqueo general después de las excepciones. Un pequeño servidor HTTP nativo responde con redirección a `/corte`; la traducción NAT por sí sola no puede cambiar una ruta HTTP. Al reactivar o liberar el cliente se eliminan las reglas del portal que pertenecen a NuweNet. Las suspensiones ya existentes requieren una nueva orden para incorporar el portal.

HTTPS externo no se intercepta: no se suplanta su certificado. La topología, rutas de retorno, VLAN, FastTrack, conexiones existentes e IPv6 requieren la validación habitual en el equipo físico. La implementación de control actual es IPv4. No se modificaron routers reales durante las pruebas.

El aviso genérico usa el contacto del entorno; `/corte?building_id=ID` muestra el mensaje y contacto públicos configurados para ese edificio. El portal privado necesita el enlace con token entregado por administración.

## Consumo e impresión

El tráfico en vivo consulta los contadores y tasas de las colas. Además, el sistema acumula consumo histórico diario y mensual mediante muestras persistentes, con límites de calendario en America/La_Paz. Registra reinicios, huecos y estimaciones; no reconstruye consumo anterior al inicio del registro. Si el router no está disponible o no existe cola, la interfaz lo indica. El portal limita sus respuestas al departamento autenticado por token.

Elegir el tamaño correspondiente en el controlador de impresión y desactivar encabezados/pies del navegador cuando sea necesario. Se validó el documento de impresión de 58 mm en Chromium; la salida física de las impresoras y el margen mecánico deben verificarse con el equipo disponible.

## Verificación

Ejecutar `bun run check` y `bun run test` (incluye `bun run build`). Las pruebas nuevas están en `test/pro.test.js` y `test/pro-http.test.js`. Incluyen persistencia e individualidad de tokens, aislamiento entre departamentos y edificios, reportes concurrentes, rechazo de sobrepagos, firma de recibos, endpoints WhatsApp sin bloqueo de transacciones, tasas y descubrimiento, orden/limpieza de reglas, formulario real en Chromium, generación QR al cambiar el importe y contenido del ticket de 58 mm.

La suite PostgreSQL usa la conexión de `.env` y esquemas temporales dentro de `nuwenet`. Requiere PostgreSQL disponible y permiso para crear esquemas; no crea bases adicionales.

El resultado histórico de la implementación Pro fue de 32 pruebas aprobadas, 1 omitida (PostgreSQL) y 0 fallos. Para los resultados posteriores y tareas realizadas consulta el [registro de implementación](plan-implementacion-mejoras.md). Ninguna prueba con adaptadores simulados acredita cortes físicos ni envíos reales.

Referencias de implementación: [colas RouterOS](https://help.mikrotik.com/docs/spaces/ROS/pages/328088/Queues), [NAT RouterOS](https://help.mikrotik.com/docs/spaces/ROS/pages/3211299/NAT), [generación QR local](https://github.com/soldair/node-qrcode).
