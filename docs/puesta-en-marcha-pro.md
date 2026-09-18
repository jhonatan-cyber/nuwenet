# Puesta en marcha de NuweNet Pro — diagnóstico del 11/09/2026

Documento histórico: describe observaciones de esa fecha. No debe interpretarse como un diagnóstico en vivo. Consulta el [plan y registro de implementación](plan-implementacion-mejoras.md) y vuelve a ejecutar `bun scripts/preflight-pro.mjs` para inspeccionar la instalación actual sin modificarla.

Estado: **aplicación disponible localmente; no preparada aún para servicio de residentes, control MikroTik**. No se enviaron mensajes, no se accedió a banca ni se modificaron routers, credenciales, base operativa, cortafuegos o servicios en ejecución.

## Evidencia local

| Elemento | Resultado observado |
|---|---|
| Proyecto | `D:\DEV\nuwenet` |
| Base de datos | PostgreSQL `nuwenet`; repetir diagnóstico en la VPS |
| Esquema | Migración 17 aplicada; clave de firma de recibos presente |
| Edificio | Edificio Norte, ID 1, habilitado |
| Departamentos vigentes | 0; todavía no se puede validar un residente real |
| Router registrado | ARRIS Touchstone, `192.168.0.1:80`; estado guardado «connected», última consulta 10/09/2026. No se hizo una nueva consulta al dispositivo |
| MikroTik central | No registrado ni asignado |
| Servidor | IPv4 Wi-Fi observada `192.168.0.2`; no se comprobó reserva DHCP |
| Servicios | Escuchas observadas en `127.0.0.1:3000` y `127.0.0.1:4321` |
| HTTP local | `/api/auth/status`, `/portal/` y `/corte/`: 200 en ambos puertos |
| Puerto de corte 3080 | Sin escucha al inspeccionar; comprobar nuevamente al activar |

El archivo `.env` configura `HOST=127.0.0.1`, `PORT=3000`. La terminal del agente heredaba `PORT=0`: es una discrepancia de entorno de esa terminal, no el puerto del servicio observado. Al iniciar un servicio, establecer explícitamente el puerto fijo y evitar heredar variables de pruebas.

## MikroTik: datos y configuración que faltan

1. Identificar el equipo MikroTik, su modelo, versión RouterOS, IP privada de administración y recorrido de tráfico de residentes. El ARRIS registrado no puede asignarse como central MikroTik.
2. Preparar RouterOS con REST habilitado mediante `www-ssl`, certificado confiable para el servidor y cuenta de servicio. La conexión actual de la aplicación verifica certificados; un certificado autofirmado no confiable puede impedir el acceso.
3. Para operación REST, usar políticas válidas `read,write,rest-api`. La cuenta que cree grupos/usuarios debe disponer de los permisos administrativos correspondientes; no confundirla con la cuenta operativa.
4. El aprovisionador y el script CLI usan `read,write,rest-api` desde la corrección del 15/09/2026. La creación del usuario requiere una cuenta administrativa del equipo.
5. Registrar el router en NuweNet, asociarlo al edificio 1, probar su conexión y asignarlo como central. Registrar un plan y un departamento piloto con su IP/MAC reales antes de controlar tráfico.
6. Confirmar una IP fija/reservada del servidor. La observada `192.168.0.2` es candidata, no una dirección estable garantizada. Definir IP y URL del portal y habilitar escucha de la API accesible desde LAN; la interfaz de desarrollo 4321 no es el servicio de producción propuesto.
7. Validar puertos del servidor, segmentos/VLAN, DNS si hay nombre de dominio, rutas de retorno y FastTrack. El corte implementado es IPv4/HTTP; no intercepta HTTPS externo ni evita por sí mismo un acceso IPv6 paralelo.
8. Con un departamento piloto, verificar tráfico, DHCP, suspensión, acceso a `/corte` y `/portal`, y limpieza de reglas al reactivar. No usar una suspensión masiva para la primera validación.

Los campos pendientes de red e integraciones se configuran en el único `.env`. La puesta en marcha de HTTPS y el cortafuegos depende del servidor definitivo.

Fuentes para REST y permisos: [REST API RouterOS](https://manual.mikrotik.com/docs/developer-guides/rest-api/) y [políticas de usuarios RouterOS](https://manual.mikrotik.com/docs/authentication-authorization-accounting/user/).

## Secuencia propuesta de activación

1. Corregir el generador de políticas MikroTik o preparar manualmente la cuenta válida; confirmar el equipo y la topología.
2. Fijar servidor/IP/URL, preparar respaldo de la base y clave de routers, configurar acceso LAN/HTTPS y activar el servicio con puerto fijo.
3. Registrar plan y departamento piloto; conectar y asignar el central; comprobar suspensión y reactivación solo del piloto.
4. Completar Meta, plantilla y webhook; autorizar un mensaje de prueba y comprobar su estado de entrega.
6. Validar desde el teléfono del residente y con la impresora física; ampliar a otros departamentos después de esa verificación.

Repetir el diagnóstico de solo lectura con:

```powershell
Set-Location D:\DEV\nuwenet
bun scripts/preflight-pro.mjs
```

El script inspecciona PostgreSQL dentro de una transacción de solo lectura y realiza GET locales. Usa las variables de entorno efectivas sin imprimir secretos. El inventario anterior corresponde a la instalación histórica; debe repetirse en la VPS.
