# Puesta en marcha de NuweNet Pro — diagnóstico del 11/09/2026

Documento histórico: describe observaciones de esa fecha. No debe interpretarse como un diagnóstico en vivo. Consulta el [plan y registro de implementación](plan-implementacion-mejoras.md) y vuelve a ejecutar `bun scripts/preflight-pro.mjs` para inspeccionar la instalación actual sin modificarla.

Estado: **aplicación disponible localmente; no preparada aún para servicio de residentes, control MikroTik ni envío WhatsApp**. Banco pendiente de elección en Bolivia, confirmado por el usuario. No se enviaron mensajes, no se accedió a banca ni se modificaron routers, credenciales, base operativa, cortafuegos o servicios en ejecución.

## Evidencia local

| Elemento | Resultado observado |
|---|---|
| Proyecto | `D:\DEV\nuwenet` |
| Base inspeccionada | SQLite `data/nuwenet.sqlite`, abierta solo para lectura |
| Esquema | Migración 17 aplicada; clave de firma de recibos presente |
| Edificio | Edificio Norte, ID 1, habilitado |
| Departamentos vigentes | 0; todavía no se puede validar un residente real |
| Router registrado | ARRIS Touchstone, `192.168.0.1:80`; estado guardado «connected», última consulta 10/09/2026. No se hizo una nueva consulta al dispositivo |
| MikroTik central | No registrado ni asignado |
| Servidor | IPv4 Wi-Fi observada `192.168.0.2`; no se comprobó reserva DHCP |
| Servicios | Escuchas observadas en `127.0.0.1:3000` y `127.0.0.1:4321` |
| HTTP local | `/api/auth/status`, `/portal/` y `/corte/`: 200 en ambos puertos |
| Puerto de corte 3080 | Sin escucha al inspeccionar; comprobar nuevamente al activar |
| WhatsApp | Canal `whatsapp`, envío deshabilitado, sin credenciales ni plantilla |
| Cola de avisos | Vacía al inspeccionar |
| Banco/QR | Ninguna configuración bancaria guardada para el edificio |

El archivo `.env` configura `HOST=127.0.0.1`, `PORT=3000`. La terminal del agente heredaba `PORT=0`: es una discrepancia de entorno de esa terminal, no el puerto del servicio observado. Al iniciar un servicio, establecer explícitamente el puerto fijo y evitar heredar variables de pruebas.

## MikroTik: datos y configuración que faltan

1. Identificar el equipo MikroTik, su modelo, versión RouterOS, IP privada de administración y recorrido de tráfico de residentes. El ARRIS registrado no puede asignarse como central MikroTik.
2. Preparar RouterOS con REST habilitado mediante `www-ssl`, certificado confiable para el servidor y cuenta de servicio. La conexión actual de la aplicación verifica certificados; un certificado autofirmado no confiable puede impedir el acceso.
3. Para operación REST, usar políticas válidas `read,write,rest-api`. La cuenta que cree grupos/usuarios debe disponer de los permisos administrativos correspondientes; no confundirla con la cuenta operativa.
4. **Bloqueo detectado en el código actual:** `mikrotik.adapter.ts` genera `read,write,api,firewall,queue,dhcp,rest-api`. `firewall`, `queue` y `dhcp` no son políticas válidas de usuarios RouterOS. Corregir el aprovisionador y su script antes de usar ese botón; alternativamente, crear la cuenta válida mediante la administración del router y registrar sus credenciales en NuweNet. No se aplicó una modificación a este código mientras hay servicios de desarrollo activos.
5. Registrar el router en NuweNet, asociarlo al edificio 1, probar su conexión y asignarlo como central. Registrar un plan y un departamento piloto con su IP/MAC reales antes de controlar tráfico.
6. Confirmar una IP fija/reservada del servidor. La observada `192.168.0.2` es candidata, no una dirección estable garantizada. Definir IP y URL del portal y habilitar escucha de la API accesible desde LAN; la interfaz de desarrollo 4321 no es el servicio de producción propuesto.
7. Validar puertos del servidor, segmentos/VLAN, DNS si hay nombre de dominio, rutas de retorno y FastTrack. El corte implementado es IPv4/HTTP; no intercepta HTTPS externo ni evita por sí mismo un acceso IPv6 paralelo.
8. Con un departamento piloto, verificar tráfico, DHCP, suspensión, acceso a `/corte` y `/portal`, y limpieza de reglas al reactivar. No usar una suspensión masiva para la primera validación.

Se preparó `nuwenet-pro.env.example` con los campos pendientes y candidatos LAN comentados. No se cambió `.env` ni se abrieron puertos. La puesta en marcha de un proxy HTTPS o cambios al cortafuegos se decidirán una vez fijado el servidor definitivo.

Fuentes para REST y permisos: [REST API RouterOS](https://manual.mikrotik.com/docs/developer-guides/rest-api/) y [políticas de usuarios RouterOS](https://manual.mikrotik.com/docs/authentication-authorization-accounting/user/).

## WhatsApp: requisitos pendientes

Faltan todos estos campos en `.env`:

- `WHATSAPP_TOKEN`: token autorizado para enviar desde la cuenta WhatsApp Business.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número emisor de Meta, distinto del teléfono visible.
- `WHATSAPP_API_VERSION`: versión habilitada/soportada para la aplicación; no fijar una versión por suposición.
- `WHATSAPP_TEMPLATE` y `WHATSAPP_LANGUAGE`: nombre y código de idioma exactos de la plantilla aprobada.
- Para estados de entrega: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` y callback **HTTPS público** `/api/whatsapp/webhook`, configurado/suscrito en Meta. La URL privada `192.168.0.2` no puede recibir webhooks de Meta directamente.

El código actual manda una plantilla con **un parámetro de texto en el cuerpo**, que contiene el aviso completo. La plantilla de Meta tiene que corresponder a ese contrato. Esto no equivale a que cualquier texto o plantilla esté aprobado por Meta: verificar el formato en la cuenta antes de habilitar envíos.

Agregar teléfonos de residentes con código de país; para Bolivia usar `+591` seguido del número real. No compartir el token ni el secreto de la aplicación por chat; introducirlos en el entorno del servidor. Se puede inspeccionar la configuración sin revelar secretos desde el diagnóstico.

Mantener `WHATSAPP_SEND_ENABLED=false` hasta completar y verificar lo anterior. Volver a consultar la cola justo antes de habilitar: aunque hoy está vacía, puede acumular avisos posteriormente y el proceso los envía al activarse. Un envío real de prueba necesitará un destinatario definido y autorización explícita para enviar ese mensaje. Esta tarea no realizó ningún envío.

Referencia de Meta: [colección oficial WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Banco y QR: Bolivia, entidad aún no elegida

No hay banco que verificar todavía. No se configuró una cuenta, imagen, plantilla ni integración ficticia.

Cuando se elija la entidad, obtener: nombre del banco, titular, cuenta/alias de cobro y QR emitido por el banco. Guardarlos para Edificio Norte en **Mensualidades → Datos bancarios / QR**, junto con contacto de administración.

Para arrancar con QR estático, comprobar en la aplicación bancaria qué importe admite y si permite que el pagador lo ingrese. Una imagen guardada no se convierte en QR con importe exacto al cambiar el monto en NuweNet. Validar también vigencia y titular del QR.

Para generar un QR con importe exacto, solicitar al banco su documentación oficial: API, autenticación, firma, vencimiento y/o plantilla admitida. NuweNet puede sustituir `{amount}` únicamente en una plantilla bancaria que realmente soporte ese mecanismo; no debe añadirse ese marcador a un QR cifrado o firmado. No hay compatibilidad bancaria específica certificada en esta instalación.

Hasta elegir banco, puede prepararse el alta de departamentos y la operación de caja. Los reportes de transferencia siempre requieren verificar el ingreso antes de aprobarlos; la aprobación registra pagos y puede solicitar reactivación del servicio.

## Secuencia propuesta de activación

1. Corregir el generador de políticas MikroTik o preparar manualmente la cuenta válida; confirmar el equipo y la topología.
2. Fijar servidor/IP/URL, preparar respaldo de la base y clave de routers, configurar acceso LAN/HTTPS y activar el servicio con puerto fijo.
3. Registrar plan y departamento piloto; conectar y asignar el central; comprobar suspensión y reactivación solo del piloto.
4. Completar Meta, plantilla y webhook; autorizar un mensaje de prueba y comprobar su estado de entrega.
5. Elegir banco, configurar QR válido y verificar el circuito reporte → confirmación bancaria → aprobación → recibo.
6. Validar desde el teléfono del residente y con la impresora física; ampliar a otros departamentos después de esa verificación.

Repetir el diagnóstico de solo lectura con:

```powershell
Set-Location D:\DEV\nuwenet
bun scripts/preflight-pro.mjs
```

El script inspecciona PostgreSQL dentro de una transacción de solo lectura y realiza GET locales. Usa las variables de entorno efectivas sin imprimir secretos. El inventario anterior corresponde a la instalación histórica; debe repetirse en la VPS.
