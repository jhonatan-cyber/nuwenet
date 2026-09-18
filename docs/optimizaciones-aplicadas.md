# Optimizaciones aplicadas — 15/09/2026

## Cambios

- El portal obtiene la clave de recibos una vez por petición. Las firmas mantienen el mismo formato y valor, incluidos los pagos revertidos.
- `GET /api/state?section=...` consulta únicamente los grupos necesarios para esa sección. Se mantienen el contexto del edificio y la validación de permisos. Sin `section`, sigue devolviendo el estado completo por compatibilidad.
- Al guardar, la interfaz reutiliza el estado devuelto cuando coincide con el edificio, la página y los filtros actuales. En búsquedas o páginas que no coinciden, vuelve a consultar la sección para evitar resultados incorrectos.
- Las lecturas obsoletas del panel se cancelan. La consulta periódica de Control de acceso y del tráfico del portal evita solicitudes simultáneas, se pausa al ocultar la pestaña y se reactiva al volver.
- Los paneles React y las acciones de departamentos se cargan bajo demanda, con estados de carga y recuperación ante errores.
- Consumo, red, facturación, respaldos, limpieza y monitoreo tienen ciclos independientes. Cada ciclo evita superponerse consigo mismo. El cierre espera los trabajos en curso.
- Consulta de consumo y monitoreo permiten hasta tres equipos simultáneos por ciclo. Las operaciones de cada equipo conservan su orden.
- Los bloqueos de tareas y sus diagnósticos usan bloqueos propios por recurso y esquema. Los pagos, cambios de clientes y acumulación de consumo mantienen el bloqueo de negocio que protege su consistencia.
- La migración 24 incorpora `invoices_due_id` para ordenar por vencimiento e identificador. Se comprobó su efecto con `EXPLAIN ANALYZE` antes de incorporarlo.

## Mediciones locales

Datos sintéticos: 1.000 departamentos y 12.000 mensualidades. Cada escenario tiene una ejecución de calentamiento y diez muestras, sin carga concurrente generada por el benchmark. Otros procesos del equipo pueden afectar los tiempos. Se miden servicios directamente, sin HTTP ni renderizado.

| Lectura | Consultas antes | Consultas actuales |
|---|---:|---:|
| Portal con 100 recibos | 105 | 6 |
| Resumen del panel | 19 | 10 |
| Departamentos | 19 | 7 |
| Mensualidades | 19 | 6 |
| Pagos | 19 | 6 |
| Planes | 19 | 5 |
| Actividad | 19 | 7 |
| Configuración | 19 | 5 |

En la última muestra, el estado completo ocupó 21.499 bytes y Mensualidades 5.350 bytes. Con estadísticas actualizadas en ambos casos, la mediana de Mensualidades pasó de 26,43 ms sin el índice nuevo a 7,82 ms con él. Son resultados de prueba, no una garantía de capacidad en producción.

Reproducción: `bun run build` y `bun scripts/benchmark-optimization.mjs`. El script crea y elimina un esquema temporal; compara el índice únicamente dentro de ese esquema. Resultados y planes SQL: `data/optimization-after.json`.

## Verificación e instalación

Suite final: 50 pruebas aprobadas, 0 fallos. Comprobación de tipos sin errores y compilación completada.

- Pruebas de firmas, saldos, reversión, paginación, permisos, contención de escrituras, concurrencia limitada y exclusión de tareas entre dos conexiones independientes.
- Prueba en Chromium de carga diferida, reutilización de la respuesta al guardar y pausa de consultas con la pestaña oculta.
- Suite completa de interfaz: altas, pagos, recibos, configuración, usuarios, respaldos, auditoría y móvil.
- Base local actualizada a la migración 24 después de crear y verificar un respaldo cifrado.
- Servidor local: `http://127.0.0.1:3000`.

El bloqueo global de las operaciones contables se conserva deliberadamente. Particionarlo por departamento requiere una medición de contención con la carga real y una revisión adicional de todas las operaciones que cruzan departamentos. La optimización actual evita que los diagnósticos y los bloqueos de tareas compitan por ese bloqueo, sin retirar la protección de pagos.
