# Estilos y componentes de NuweNet

Revisión: 13/09/2026.

## Limpieza aplicada

Se revisaron las referencias de las páginas Astro y scripts que generan HTML o cambian clases en ejecución. Se retiraron `workspace`, `text-button`, `bottom-grid` y `account-details`, sin referencias en ese código: 35 apariciones en selectores, incluidas variantes de temas y media queries.

En `shell.css` se retiraron 839 declaraciones que otras posteriores del mismo selector y bajo las mismas condiciones ya reemplazaban. Se conservó el orden de la cascada, las reglas responsivas, impresión, estados de interacción y propiedades personalizadas. Se eliminaron comentarios históricos que describían temas invertidos como vigentes.

El CSS compartido pasó de 97.432 a 47.644 bytes: reducción de 49.788 bytes (51,1%) del código fuente, no una medida de descarga comprimida. `global.css` pasó de 7.367 a 7.006 bytes y `shell.css` de 90.065 a 40.638. Se mantiene CSS específico de páginas, consumo y recibos: una regla no se considera sobrante por no aparecer en la pantalla inicial.

Validación: comprobación Astro sin errores ni advertencias; compilación y `bun run test:ui` aprobados; prueba `pro-http` del portal, QR y ticket aprobada. Una comparación temporal de estilos calculados antes/después no detectó diferencias en siete puntos del recorrido (acceso, resumen, diálogo de plan, cobros, recibo, usuarios y departamentos), con temas claro/oscuro y anchos de 1440/390 px. Son 28 comparaciones en Chromium; no equivalen a una certificación en todos los navegadores y estados posibles.

## Uso de shadcn/ui

La [guía oficial de shadcn/ui para Astro](https://ui.shadcn.com/docs/installation/astro) requiere configurar React y Tailwind en proyectos existentes. NuweNet ya tiene ambas integraciones: la pantalla de cuenta es una isla React, mientras otras vistas conservan Astro y scripts de HTML.

shadcn/ui permite reutilizar componentes y sus variantes para reducir CSS artesanal. Su adopción requiere cambiar cómo se renderizan los controles actuales, además de instalar las dependencias. Los estilos generales de `button`, `input`, `dialog`, tablas y los temas pueden interferir con los nuevos componentes si ambos sistemas se mezclan sin delimitar sus estilos.

La migración se realiza por pantalla:

1. Incorporar React y Tailwind sin aplicar un reset global que cambie las pantallas existentes; definir tokens comunes de color, radio, tipografía y espaciado.
2. Usar una pantalla acotada como piloto, por ejemplo preferencias de cuenta, con Button, Input, Card y Dialog. Adaptar los eventos y la hidratación de la isla React, conservando navegación por teclado y foco.
3. Reemplazar los generadores de HTML de la pantalla piloto por componentes; comprobar tema claro/oscuro, móvil y sus operaciones reales.
4. Migrar formularios, confirmaciones y tablas por módulos, retirando CSS heredado únicamente cuando deje de tener consumidores.
5. Mantener impresión de recibos, gráficos de consumo y distribución específica donde requieren estilos propios. shadcn no elimina toda necesidad de CSS.

## Primera pantalla migrada: cuenta

- [x] React, integración Astro y Tailwind v4 instalados; `components.json` y alias `@/` configurados.
- [x] Button, Input, Card, Dialog y Switch incorporados desde el registro oficial shadcn/ui new-york-v4. El código local incluye licencia MIT y adapta imports a paquetes Radix individuales, cierre en español y delimitación de estilos.
- [x] Preferencias de cuenta y perfil renderizados con componentes tipados, sin generar sus formularios mediante `innerHTML`.
- [x] Tema claro/oscuro/sistema, densidad y reducción de animaciones comparten `lib/account-store.ts` con la barra del panel y conservan la clave existente de localStorage.
- [x] Cambio de contraseña utiliza la API existente; errores visibles, bloqueo durante envío y cierre de sesiones después del éxito.
- [x] Retiradas 23 apariciones de selectores exclusivos del antiguo diálogo de cuenta. Los controles de automatización conservan sus estilos compartidos.

`styles/panel.css` organiza las capas `legacy`, `theme`, `base`, `components` y `utilities`. Las utilidades se generan desde los componentes TSX. No se carga Preflight global: el reset y los tokens se delimitan con `.shadcn-root`, también en overlay y contenido renderizados por portal Radix. Los estilos existentes se importan en `legacy`; portal del residente y corte conservan su carga independiente. La tipografía se carga mediante un enlace en el head para evitar imports dentro de capas.

Para añadir componentes, ejecutar el CLI de shadcn desde `apps/web` usando la configuración existente y revisar el cambio antes de sobrescribir componentes adaptados. Los nuevos contenedores deben tener `.shadcn-root`; los portales también deben recibir ese alcance. Reutilizar los tokens existentes. No añadir nuevas versiones de temas al final de `shell.css`.

Planes y el listado/formularios de departamentos también están migrados, según los registros siguientes. Cobros, confirmaciones de negocio, tablas restantes, portal, gráficos y recibos conservan su implementación actual. Estas entregas no completan toda la fase F ni toda la migración del panel.

Validación del piloto (13/09/2026): `bun run check` terminó con 0 errores, 0 advertencias y 0 hints; compilación de API/web correcta sin advertencias de CSS. `bun scripts/smoke-ui.mjs` pasó con comprobaciones de colores calculados en ambos temas, seguimiento del tema del sistema, persistencia tras recargar, foco confinado con Tab, retorno con Escape, tamaño móvil y cambio real de contraseña con rechazo de contraseña incorrecta. `bun test ./test/pro-http.test.js` también pasó para portal, QR, aprobación y ticket. Capturas de escritorio y móvil revisadas en Chromium. No se afirma validación de otros navegadores ni migración total de la interfaz.

## Segundo módulo migrado: planes (13/09/2026)

- [x] Listado, estado vacío, creación y edición en `components/PlansPanel.tsx`, con Card, Button, Input, Dialog y NativeSelect del registro shadcn. No se generan estas vistas mediante cadenas HTML.
- [x] `lib/plans-store.ts` conecta la isla con el estado, sesión, permisos, moneda y edificio del dashboard. El contenedor React es independiente de `#view`, que continúa atendiendo las pantallas anteriores.
- [x] Crear conserva la selección del edificio; editar conserva el edificio original del plan. Cambiar de edificio, navegar o perder la sesión desmonta la vista y su formulario para no reutilizar contexto anterior.
- [x] Se conservan `POST /api/plans` y `/api/plans/update`, límites numéricos, precio decimal y permisos de servidor. La interfaz rechaza nombres vacíos tras quitar espacios y bloquea envíos mientras guarda.
- [x] Un error de API mantiene el formulario y sus datos. Si el guardado tuvo éxito pero falla la actualización del listado, se informa del guardado y se ofrece Actualizar; no se invita a repetir la creación.
- [x] Retiradas 16 apariciones de selectores de `.plan` y `.plan-grid`, ya sin consumidores. Los controles usan utilidades y tokens compartidos.

Validación: comprobación de tipos sin errores/advertencias/hints; recorrido UI de creación, edición, precio con centavos, velocidades, recuperación de error y prevención de doble envío. La prueba comprueba que una cuota de 150,00 conserva su importe después de cambiar el plan a 175,50, y que una cuota futura usa 175,50. La prueba de aislamiento de edificios crea el plan desde el navegador en el edificio seleccionado. Se comprueban Escape/retorno de foco y ausencia de desbordamiento en 1440/390 px con ambos temas. No se aplicaron cambios a routers físicos.

## Tercer módulo: listado y formularios de departamentos (13/09/2026)

- [x] Listado compartido entre Resumen y Departamentos migrado a Card y Button; alta y edición usan Dialog, Input y NativeSelect, sin generadores HTML propios.
- [x] Estado tipado en `lib/customers-store.ts`, conectado con permisos, edificio, moneda, filtros y paginación. Navegar o cambiar de edificio cierra la edición.
- [x] Alta en el edificio activo, visible en el formulario; para registrar en otro edificio se cambia primero el selector del panel. La edición muestra el edificio fijo: la API no traslada departamentos.
- [x] Preservados plan opcional, teléfono, IP inicial y entrega única del enlace, incluso si falla la recarga posterior al alta. El cambio de titular sigue siendo una acción explícita del portal.
- [x] Búsqueda mediante Buscar/Enter y filtro vigente/archivado, persistidos en URL. Los errores mantienen los datos y el envío pendiente no se duplica.
- [x] Retiradas cuatro reglas CSS de `.search`, sin consumidores. Se reutilizan componentes y utilidades existentes, sin dependencias nuevas.
- [x] Verificación: `bun run check`, `bun run test:ui`, aislamiento entre edificios y portal HTTP/navegador aprobados. Smoke ampliado con búsqueda persistente, error con reintento, doble envío, plan opcional, conservación de cuotas y versión del enlace, Escape y retorno de foco. Capturas 1440/390 px y ambos temas sin desbordamiento; revisión visual móvil.
- [x] Diálogos especializados de departamentos migrados en la entrega siguiente. Estado de cuenta es una navegación hacia cobros filtrados, que se conserva.

### Diálogos y acciones de departamentos (13/09/2026)

- [x] `CustomerActions.tsx` y `customer-actions-store.ts` reemplazan los formularios HTML anteriores de portal, enlace único, regeneración, cambio de titular, IP, archivo/restauración y corte/reactivación. Usan Dialog, Input y Button, sin dependencias nuevas ni estilos manuales nuevos.
- [x] Consumo usa Dialog y controles shadcn; conserva la gráfica, tabla accesible, eventos y advertencias de medición de `usage.js`, compartidos con el portal. El desmontaje detiene el temporizador y retira listeners; no se eliminan sus estilos porque siguen en uso.
- [x] Errores visibles y campos conservados; envío único y cierre bloqueado durante la operación. Cerrar devuelve el foco al botón original. Navegación, cambio de edificio y pérdida de sesión descartan el diálogo.
- [x] El enlace único se entrega antes de recargar el listado; una recarga fallida no impide copiarlo ni invita a repetir la operación. Cerrar elimina el enlace del estado del diálogo y del DOM. La regeneración y el cambio de titular invalidan el enlace anterior mediante las rutas existentes.
- [x] Quitar una IP omite el campo en la petición, según el contrato de la API; no envía una cadena vacía que el validador rechazaría.
- [x] Compilación y tipos aprobados; `bun run test:ui` pasa con los nuevos diálogos y pruebas de error/reintento de consumo, teclado en la gráfica, IP inválida/asignación/eliminación, doble envío bloqueado, entrega del enlace tras recarga fallida, invalidación del anterior y cambio de titular. Aislamiento entre edificios y portal HTTP/navegador también aprobados. Capturas de portal/consumo en 1440/390 px con ambos temas, sin desbordamiento horizontal; revisión visual móvil.

Las pruebas usan datos temporales; no acreditan cambios de red físicos ni envíos reales.

## Cuarto módulo: mensualidades y pagos (13/09/2026)

- [x] Listado de mensualidades e historial de pagos migrados a `components/BillingPanel.tsx` con Card, Button, Input, Dialog y NativeSelect; estado en `lib/billing-store.ts` con el mismo patrón de isla (`showBilling/hideBilling`, `key=userId:buildingId:page:customerId`).
- [x] Diálogos React para generar mensualidades, registrar pago/abono (con `request_key` idem-potente), revertir con motivo, ver recibo e imprimir (80/58 mm) y revisar vencimientos. El QR bancario se genera en el diálogo (`qrcode` con `{amount}` sustituido e importe en vivo); se conservan `data-bank-amount` y `data-generated-qr` como contrato verificable.
- [x] Acciones secundarias conservadas vía `data-action` heredado: recordatorio/recibo por WhatsApp, transferencias reportadas con aprobación, datos bancarios/QR. Tablas densas dentro de Card; paginación de 25 y filtro de estado de cuenta (Ver todos / Ver pagos|mensualidades) conectados a `query` + `refresh`.
- [x] Retirado el HTML anterior de `billing`/`payments` de `dashboard.js`; `index.astro` monta `<BillingPanel client:load />`. El `render()` oculta `#view` en `plans/billing/payments` y desmonta al navegar o cambiar de edificio.
- [x] Pruebas actualizadas: `scripts/smoke-ui.mjs` (Generar/Guardar pago/Revertir/Cerrar), `test/building-isolation.test.js` (diálogo Generar) y `test/pro-http.test.js` (abono por fila 101, QR dinámico, recibo e impresión). Tipos web sin errores, compilación correcta, smoke UI y suites `pro/usage/auth/integration/router-adapters/building-isolation/pro-http/reliability` en verde por grupos (la pasada conjunta de 5 archivos en Windows puede fallar por contención; se verifica por grupos como documenta el plan).

Las pruebas usan datos temporales; no acreditan cambios de red físicos ni envíos reales.

## Quinto módulo: operaciones (13/09/2026)

- [x] Edificios, configuración, usuarios, respaldos y auditoría migrados a `components/OperationsPanel.tsx` con Card, Button, Input, Dialog, NativeSelect y Switch; estado en `lib/operations-store.ts` (`showOperations/hideOperations`, `key=userId:page`). Eliminado `scripts/operations.js`.
- [x] Diálogos React para edificio (alta, edición, activar/desactivar, eliminación, equipo central, dar acceso), central por edificio, usuario (alta con CI/nombre/apellido/dirección/teléfono/correo/contraseña, permisos, edificios por `bid_*`, eliminación) y revisión de vencimientos ya cubierta en cobros. Formularios conservan `name` e identificadores verificados (`operations-form`, `central_router_id`, `settings-error`).
- [x] Configuración con `operations-form`, números con límites, Switch para facturación automática y recordatorios, y aviso exacto `Configuración guardada.`. Respaldos con creación/verificación y avisos exactos; auditoría de solo lectura. Se preservaron etiquetas, roles y textos que usan `smoke-ui`, `building-isolation` y `pro-http`.
- [x] Verificación: tipos web sin errores, compilación correcta, smoke UI y suites `pro/usage/auth/integration/router-adapters/building-isolation/pro-http/reliability` en verde por grupos.

Las pruebas usan datos temporales; no acreditan cambios de red físicos ni envíos reales.

## Sexto módulo: routers (13/09/2026)

- [x] Listado, tarjetas, detalle (WAN/LAN/Wi-Fi/dispositivos/interfaces/bloqueos/colas/leases/notas), vinculados, capacidades y acciones migrados a `components/RoutersPanel.tsx` con Card, Button, Input, Dialog y NativeSelect; estado en `lib/routers-store.ts` (`showRouters/hideRouters`). Eliminado `scripts/routers.js` y la delegación `router-*` de `dashboard.js`.
- [x] Diálogos React para alta/edición (con prueba de conexión, avanzada plegable y `Conectar router`/`Guardar`), control por IP (suspender/reactivar/velocidad/firewall/parental con campos condicionales), aprovisionamiento por pestañas (servicios, usuario, script CLI con copiado), tráfico en vivo (sondeo 3 s con limpieza), descubrimiento, vinculación con departamento y confirmaciones de activar/desactivar/quitar.
- [x] Contratos preservados para `smoke-ui` y `building-isolation`: etiquetas (`IP de administración`, `Adaptador`, `Protocolo`, `Nombre`, `Usuario`, `Contraseña`), botones (`Agregar router`, `Guardar`, `Editar`, `Quitar conexión`, `Quitar`, `Vincular departamento`), insignias (`Sin probar`, `Consulta correcta`) y estados vacíos. `building-isolation` usa el diálogo de vinculación por rol.
- [x] Verificación: tipos web sin errores, compilación correcta, smoke UI y suites `pro/usage/auth/integration/router-adapters/building-isolation/pro-http/reliability` en verde por grupos.

Las pruebas usan datos temporales; no acreditan cambios de red físicos ni envíos reales. Migración del panel completa en cuenta, planes, departamentos, cobros, operaciones y routers. Portal, gráficos y recibos impresos conservan su implementación compartida actual.
