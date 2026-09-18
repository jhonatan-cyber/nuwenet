# Análisis de optimización — 15/09/2026

## Resultado

Las primeras mejoras deben reducir consultas repetidas, actualizar solo la sección visible y evitar que las tareas lentas retrasen a las demás. No se justifica cambiar la arquitectura ni introducir otro servicio de caché sin medir primero estas mejoras.

Este documento conserva el análisis inicial. Las mejoras ya implementadas y sus mediciones se describen en [Optimizaciones aplicadas](optimizaciones-aplicadas.md).

## Mediciones

Prueba local con PostgreSQL, en un esquema temporal eliminado al terminar. Datos ficticios: 1.000 departamentos, 12.000 mensualidades y 12.000 pagos; posteriormente se añadieron 88 registros sintéticos para probar el límite de 100 recibos del portal. No representa una simulación contable completa ni carga simultánea.

Cada medición incluye una ejecución de calentamiento y diez muestras. Se midieron llamadas directas al servicio; se excluyen HTTP, autenticación, renderizado y latencia hacia routers. El conteo corresponde a consultas etiquetadas de la aplicación, sin contar BEGIN/COMMIT. Resultados brutos en `data/optimization-baseline.json`.

| Escenario | Consultas | Mediana | Máximo observado | JSON |
|---|---:|---:|---:|---:|
| Estado completo del panel | 19 | 39,38 ms | 44,85 ms | 21.484 bytes |
| Portal con 12 recibos | 17 | 8,34 ms | 11,42 ms | 5.305 bytes |
| Portal con 100 recibos | 105 | 16,60 ms | 21,35 ms | 33.201 bytes |

Son tiempos locales de esta muestra; no permiten prometer capacidad de producción ni porcentajes de mejora.

## Prioridades

### 1. Consultar una sola vez la clave de firma de recibos

`management.service.ts`, métodos `signReceipt` y `portalData`: cada recibo consulta la misma fila de `settings`. Con 100 recibos, 100 de las 105 consultas son lecturas de la clave.

Propuesta: obtener la clave una vez por petición y calcular todas las firmas con ella. El objetivo estructural es pasar de 105 a 6 consultas en ese escenario, conservando exactamente las firmas. No almacenar la clave indefinidamente en una caché global.

Validación: firmas idénticas, recibos revertidos, aislamiento del portal, persistencia y nueva medición del conteo.

### 2. Pedir solo los datos de la sección visible

`snapshot.ts` reúne resumen, departamentos, facturas, pagos, planes, equipos, eventos, órdenes y tareas. `dashboard.js:refresh` siempre solicita ese estado completo, incluso cuando solo cambia una página de facturas o el filtro de departamentos.

Propuesta: separar las lecturas por sección, manteniendo una consulta pequeña para edificio, permisos y contexto compartido. En operaciones que ya devuelven el estado, revisar además la lectura posterior: `mutate` descarta la respuesta y vuelve a ejecutar `refresh`.

Validación: preservar filtros, paginación, selección de edificio, actualización de saldos y aislamiento entre administradores. Medir consultas y bytes por navegación antes y después.

### 3. Evitar que un equipo lento retrase las tareas automáticas

`scheduler.service.ts` captura errores por tarea, pero espera secuencialmente consumo, vinculaciones, cola de red, facturación y respaldos. `processQueue` tiene un presupuesto de cuatro minutos por pasada. La recolección de consumo y el monitoreo también recorren routers secuencialmente.

Propuesta: separar los ciclos de ejecución de red, facturación y respaldo; establecer concurrencia limitada entre routers independientes. Mantener el orden de operaciones de cada departamento y los bloqueos distribuidos existentes.

Validación: simular router lento y caído, medir el retraso de facturación, comprobar ausencia de duplicados y ejecutar dos instancias. No paralelizar indiscriminadamente las operaciones del mismo equipo.

### 4. Reducir la contención del bloqueo global de escritura

`database.service.ts:write` obtiene `pg_advisory_xact_lock(78123, 1)` en cada transacción. Pagos, consumo, diagnósticos y mantenimiento compiten por el mismo bloqueo, incluso entre edificios distintos.

Propuesta: medir primero tiempo de espera con escrituras concurrentes. Luego separar escrituras independientes y evaluar bloqueos por recurso para las operaciones de negocio. Es una mejora de mayor riesgo que las anteriores: el bloqueo actual protege idempotencia y decisiones de acceso.

Validación: pagos concurrentes, reversión, generación de cuotas, cambios de acceso, deadlocks y recuperación. No retirar el bloqueo global sin reemplazar esas garantías.

### 5. Detener consultas de interfaz que ya no son necesarias

`dashboard.js` refresca Control de acceso cada diez segundos, incluso con la pestaña oculta. El número de versión descarta respuestas antiguas, pero no cancela las solicitudes anteriores. El portal también consulta tráfico cada diez segundos.

Propuesta: pausar la consulta periódica cuando la pestaña esté oculta; evitar solicitudes simultáneas; cancelar únicamente lecturas obsoletas y refrescar al volver. No cancelar pagos ni otras escrituras por este mecanismo.

Validación: varias pestañas, servidor lento, cambio de edificio y vuelta a la pestaña; verificar número de solicitudes y ausencia de datos antiguos.

### 6. Cargar paneles secundarios cuando se necesitan

`pages/index.astro` declara seis componentes con `client:load`. En la compilación inspeccionada, el archivo de cliente principal tiene 209.164 bytes, el de diálogos 73.488 bytes y RoutersPanel 46.881 bytes, sin compresión. Estos tamaños no son una medida del tiempo de carga ni del total transferido.

Propuesta: medir la carga inicial en navegador e introducir importaciones diferidas para paneles de routers, operaciones y diálogos secundarios. El cambio debe respetar los almacenes compartidos y la navegación actual.

Validación: carga inicial y primera apertura de cada panel, foco de diálogos, errores de navegador y dispositivo móvil.

## Consultas e índices: pendiente de evidencia adicional

Hay subconsultas de saldos repetidas y paginación con OFFSET. Existen índices para pagos por factura, fechas y cola de órdenes. No se recomienda agregar índices de forma indiscriminada: capturar EXPLAIN ANALYZE con distribución realista de deudas, distintos edificios y páginas profundas antes de proponerlos.

## Orden recomendado

1. Clave de recibos y lecturas duplicadas después de guardar.
2. Consultas por sección y pausa de consultas periódicas.
3. Carga diferida de paneles.
4. Independencia de tareas y prueba de contención concurrente.
5. Cambios de bloqueos e índices solo con sus mediciones y pruebas de integridad.
