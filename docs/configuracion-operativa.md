# Configuración y validación operativa

## Control de dispositivos

En Routers, vincula las MAC a departamentos del mismo edificio. Selecciona un MikroTik como central del edificio y configura un intervalo de consulta en Configuración. Las nuevas vinculaciones se sincronizan automáticamente; una consulta que detecta cambios de dispositivos solicita otra sincronización.

El trabajador consulta el central antes de actuar sobre dispositivos vinculados. Usa las concesiones IPv4 activas y la IP de servicio del departamento, limpia las direcciones anteriores y aplica suspensión o reactivación a las actuales. El plan usa una cola compartida por departamento; no multiplica la velocidad por cantidad de dispositivos. Si una IP pertenece a otro departamento, rechaza la operación y muestra el conflicto. Se conservan los objetivos de las escrituras para recuperar operaciones parcialmente aplicadas después de un reinicio.

El control implementado es IPv4. No garantiza bloquear tráfico IPv6. Una MAC identifica la asociación administrativa, pero no sustituye el aislamiento de red: para impedir suplantación hacen falta medidas en la infraestructura.

Referencia del límite compartido: [documentación oficial de colas de MikroTik](https://manual.mikrotik.com/docs/firewall-and-quality-of-service/queues/).

## WhatsApp

Integración con la API oficial de Meta, mediante una plantilla aprobada con un parámetro de texto en el cuerpo. Ejemplo de plantilla: «Aviso de NuweNet: {{1}}. Consulta a administración si necesitas ayuda». La aprobación y disponibilidad corresponden a la cuenta de WhatsApp Business.

Configura estas variables en el entorno del servidor o `.env`, sin compartir el token en conversaciones ni subirlo al repositorio:

```dotenv
NOTIFY_CHANNEL=whatsapp
WHATSAPP_SEND_ENABLED=false
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_API_VERSION=
WHATSAPP_TEMPLATE=
WHATSAPP_LANGUAGE=es
```

`WHATSAPP_API_VERSION` debe tener el formato `vNN.N` y corresponder a una versión disponible para la aplicación de Meta. Completa el identificador del número emisor, token, nombre exacto e idioma de la plantilla. Registra teléfonos de clientes con código de país, por ejemplo `+59170000000`.

Una vez configurada y preparada una prueba con un destinatario autorizado, cambia `WHATSAPP_SEND_ENABLED=true` y reinicia el servidor. Activarlo procesa también los avisos pendientes: revisa la cola antes de habilitar envíos en una base que ya tenga registros.

Estados en Actividad:

- `internal`: aviso local.
- `pending`: en espera; permanece así mientras el envío esté desactivado o falte configuración.
- `sending`: solicitud en curso.
- `accepted`: Meta aceptó la solicitud; no confirma entrega al teléfono.
- `retry`: se reintentará, hasta cinco intentos, con espera creciente.
- `blocked`: teléfono/configuración inválidos, rechazo definitivo o intentos agotados.
- `uncertain`: timeout o interrupción sin confirmación; no se reenvía automáticamente para evitar duplicados.

Los estados de entrega y lectura mediante webhook de Meta todavía no están implementados. No se registran tokens ni respuestas completas del proveedor en los mensajes de error.

Referencia: [colección oficial de WhatsApp Cloud API de Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api).

## Respaldos

```dotenv
BACKUP_RETENTION_DAYS=30
BACKUP_KEEP_MIN=3
BACKUP_EXTERNAL_DIR=
```

La limpieza solo elimina instantáneas verificadas más antiguas que el plazo y siempre conserva el mínimo indicado. Los directorios ajenos, enlaces y copias con estructura o integridad dudosas se conservan.

Para copiar automáticamente a otro disco o recurso de red, configura una carpeta existente en `BACKUP_EXTERNAL_DIR`, fuera del directorio de respaldos locales. El servicio necesita permisos de escritura. La copia incluye la base y la clave de los routers y se verifica antes de limpiar respaldos locales. Si el destino no está disponible, la operación informa del fallo y conserva la copia local. La interfaz muestra si el destino externo está configurado y disponible.

La retención se aplica a las copias locales. Las copias externas se conservan; su almacenamiento debe administrarse en el destino.

## Validación física pendiente

Usa un router y dispositivos de prueba, con un departamento sin usuarios que dependan del servicio durante la prueba. Registra antes el modelo, firmware, edificio, IP y MAC de los equipos elegidos.

1. Ejecuta Probar conexión y confirma las IP actuales.
2. Vincula dos dispositivos al departamento.
3. Suspende el departamento y comprueba tráfico IPv4 desde ambos; un dispositivo de otro departamento debe continuar conectado.
4. Reactiva y confirma acceso en ambos dispositivos.
5. Mide tráfico simultáneo para comprobar que el límite combinado corresponde al plan. Revisa reglas previas y FastTrack si el límite se omite.
6. Cambia una concesión DHCP, actualiza la consulta y confirma limpieza de la IP anterior y control sobre la nueva.
7. Desvincula un dispositivo y confirma que desaparecen sus reglas de servicio.
8. Provoca un fallo de conexión y comprueba diagnóstico, reintento y recuperación sin duplicar reglas.

Las pruebas automáticas usan respuestas simuladas. Esta validación física todavía requiere identificar el equipo y autorizar la desconexión temporal de los dispositivos elegidos.
