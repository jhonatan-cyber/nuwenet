# Equipos de red y configuración por edificio

El módulo **Equipos de red** mantiene las conexiones administradas y ofrece
**Configurar red del edificio** para definir el inventario y el cableado.
El asistente es exclusivo del superadministrador. Los administradores pueden
consultar los equipos de los edificios a los que tienen acceso.

## Flujo

1. Registrar las conexiones administradas con IP, adaptador y credenciales en
   Equipos de red. Se permiten varias conexiones en un edificio y el edificio
   es opcional: el pool sin asignar se adopta al elegirlo como central o al
   editarlo. Vincular dispositivos exige edificio asignado.
2. Probar la conexión desde la ficha. Un MikroTik central debe estar habilitado
   y tener una consulta correcta antes de seleccionarlo mediante el asistente.
3. Elegir un edificio. Añadir el proveedor, control central, switches y equipos
   de acceso. **Crear estructura inicial** propone equipos por departamento y
   puertos de ejemplo; no descubre ni certifica el cableado físico.
4. Confirmar las conexiones y puertos. Cada equipo admite una entrada en este
   flujo; no se modelan enlaces redundantes, agregación ni anillos. Se rechazan
   ciclos, puertos duplicados y referencias a otro edificio.
5. Revisar los planes e IP actuales de los departamentos. Sus modificaciones
   continúan en Departamentos. VLAN y SSID se guardan como pendientes y
   bloquean la aplicación mientras no haya soporte. La clave Wi-Fi no se
   persiste en el servidor: vive solo en la pantalla del asistente.
6. Guardar el borrador, revisar y aplicar explícitamente los cambios disponibles.

## Alcance actual de Aplicar

- Publica una copia de la topología guardada.
- Selecciona el MikroTik central mediante la lógica existente del sistema.
- Cuando cambia el central, pone en cola las operaciones necesarias para los
  departamentos con IP. Consultar el resultado en **Control de acceso**.
- No modifica puertos, DHCP, VLAN, WAN, Wi-Fi ni contraseñas de los equipos.
- Los equipos sin adaptador se registran como inventario sin integración.
- Niveles por equipo: MikroTik = administración completa; ARRIS validado
  (TG2492LG-NA, firmware 9.1.103HB) = administración parcial; OpenWrt, TR-369
  base y ARRIS no validado = solo consulta o sin integración compatible. La
  ficha de cada equipo muestra su nivel; las acciones no soportadas no se
  ofrecen. Los switches MikroTik CRS usan el adaptador RouterOS (incluye
  habilitación de puertos con verificación desde la ficha); los CSS con SwOS
  y demás switches sin API quedan como inventario.

Guardar un borrador no activa control ni envía instrucciones a equipos. La
publicación y la selección del central se realizan en una misma transacción;
si falla, ninguna de esas dos modificaciones se confirma. Las órdenes físicas
se ejecutan posteriormente por la cola existente y pueden fallar o reintentarse.
No se promete recuperación automática de configuraciones físicas no soportadas.

## Persistencia y validación

Migración 25: `building_networks`, una fila por edificio con borrador, revisión,
copia publicada y fecha. Los respaldos PostgreSQL incluyen esta tabla.

API: `GET/POST /api/building-networks/:id`,
`GET /api/building-networks/:id/review`,
`POST /api/building-networks/:id/apply`.

Guardar exige la revisión vigente. Aplicar exige revisión y huella de la revisión
previa; se vuelven a comprobar equipos, capacidades, departamentos y órdenes
dentro de la transacción. No se almacenan credenciales en el diseño. Las
conexiones administradas usan el almacén cifrado existente.

## Ampliaciones por modelo

El flujo admite inventario de distintas marcas. Para habilitar una configuración
física nueva hace falta implementar el adaptador correspondiente, comprobar sus
capacidades por modelo/firmware y añadir planificación, verificación y recuperación
específicas. Un protocolo de administración disponible no garantiza soporte de
todas las funciones. El acceso remoto inicial sigue siendo necesario.

## Puesta en marcha recomendada (kit MikroTik)

1. Cablea proveedor → ether1 del central, central ether2 → puerto 1 del switch, switch → WAN de cada router de departamento. UPS para central y switch.
2. Enciende el central y dale IP inicial (fábrica: 192.168.88.1, `admin` sin clave).
3. En Equipos de red usa **Puesta en marcha inicial**: identidad (`edificio-norte-central`), IP de gestión /24, DNS, usuario de servicio y HTTPS. Verifica en la nueva IP.
4. **Registra** el equipo desde el resultado y **aprovisiona** puertos y permisos.
5. En la pestaña **Red WAN/LAN** aplica el bloque WAN (DHCP + NAT en ether1) y LAN/DHCP (red /24, pool dinámico, leases del switch y deptos) directo en el equipo con verificación; los comandos equivalentes quedan como referencia. Si prefieres WinBox/SSH, cópialos desde «Ver comandos equivalentes».
6. Repite 3–5 con el switch CRS y, si los deptos son MikroTik, con cada acceso.
7. En el asistente **Configurar red del edificio** documenta inventario y cableado, revisa y publica; el central queda seleccionado y las órdenes corren en Control de acceso.

## Validación

`test/network-design.test.js` verifica aislamiento, varios equipos por edificio,
puertos duplicados, ciclos, borradores, funciones no disponibles (VLAN, SSID y
clave Wi-Fi), revisiones obsoletas, selección del central y reversión
transaccional. `test/router-contract.js` exige 4 adaptadores (`mikrotik-rest`,
`arris-touchstone`, `openwrt-ubus`, `tr369-usp`) con sus capacidades. `scripts/smoke-ui.mjs`
recorre el asistente, persiste el inventario y comprueba que una configuración
incompleta no se pueda aplicar, también en móvil.
