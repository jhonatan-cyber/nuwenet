import { BadRequestException, type ValidationPipeOptions } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';

// La interfaz es en español y el operador lee este mensaje en el diálogo que
// acaba de enviar. class-validator responde en inglés y sin nombrar el campo
// ("username must be an email"), así que aquí se traduce cada regla una sola vez
// y se nombra el campo afectado. En datos anidados se conserva la ruta completa
// (nodes.0.role) para saber qué elemento de la lista falló.
// Los argumentos de cada regla (longitud, máximo, lista de valores, expresión)
// se leen de la regla declarada en el DTO, no del texto en inglés; si aparece una
// regla sin traducir, el mensaje la nombra en lugar de fingir una traducción.

// Nombres legibles de los campos tal como los ve el operador. Los que no están
// aquí se muestran por su clave, que sigue siendo un nombre exacto del campo.
const FIELD_LABELS: Record<string, string> = {
  username: 'Usuario', password: 'Contraseña', current_password: 'Contraseña actual',
  ci: 'CI', first_name: 'Nombre', last_name: 'Apellido', address: 'Dirección', phone: 'Teléfono', role: 'Rol',
  apartment: 'Departamento', customer_id: 'Departamento', plan_id: 'Plan', ip: 'IP', archived: 'Archivado',
  name: 'Nombre', down: 'Bajada', up: 'Subida', price: 'Precio',
  amount: 'Importe', method: 'Método de pago', reference: 'Referencia', request_key: 'Clave de la operación',
  period: 'Periodo', due: 'Vencimiento', reason: 'Motivo',
  building_id: 'Edificio', building_name: 'Nombre del edificio', admin_id: 'Administrador', user_id: 'Usuario',
  central_router_id: 'Equipo central', disabled: 'Deshabilitado',
  currency: 'Moneda', grace_days: 'Días de gracia', auto_billing: 'Facturación automática',
  billing_day: 'Día de facturación', due_day: 'Día de vencimiento', overdue_minutes: 'Minutos de mora',
  monitor_minutes: 'Minutos de monitoreo', backup_hours: 'Horas entre respaldos',
  portal_link_days: 'Días del enlace del portal',
  nodes: 'Nodos', links: 'Enlaces', services: 'Servicios', from: 'Origen', to: 'Destino',
  from_port: 'Puerto de origen', to_port: 'Puerto de destino', model: 'Modelo', host: 'Host',
  router_id: 'Equipo', vlan: 'VLAN', ssid: 'SSID', wifi_password: 'Contraseña Wi-Fi',
  fingerprint: 'Huella', revision: 'Revisión',
  id: 'Identificador', status: 'Estado', section: 'Sección', search: 'Búsqueda',
  limit: 'Límite', offset: 'Desplazamiento', format: 'Formato',
  customer_page: 'Página de departamentos', invoice_page: 'Página de mensualidades', payment_page: 'Página de pagos',
};

// Las expresiones regulares que usan los DTO son parte del contrato, así que se
// traducen por su patrón exacto; una expresión nueva cae al mensaje genérico.
const PATTERNS: Record<string, string> = {
  '\\S': 'no puede estar vacío',
  '^\\S+$': 'no debe contener espacios',
  '^\\d{4}-(0[1-9]|1[0-2])$': 'debe tener el formato AAAA-MM',
  '^\\d{4}-\\d{2}-\\d{2}$': 'debe tener el formato AAAA-MM-DD',
  '^[a-zA-Z0-9-]{16,80}$': 'solo admite letras, números y guiones',
  '^[a-f0-9]{64}$': 'debe ser una huella hexadecimal en minúsculas',
  '^[a-zA-Z0-9_-]{1,60}$': 'solo admite letras, números, guiones y guiones bajos',
};

const RULES: Record<string, (argument: unknown) => string> = {
  isString: () => 'debe ser texto',
  isEmail: () => 'debe ser un correo electrónico',
  isBoolean: () => 'debe ser verdadero o falso',
  isInt: () => 'debe ser un número entero',
  isNumber: (argument) => {
    const decimals = (argument as { maxDecimalPlaces?: number } | undefined)?.maxDecimalPlaces;
    return decimals ? `debe ser un número con hasta ${decimals} decimales` : 'debe ser un número';
  },
  isIp: (argument) => `debe ser una dirección IPv${argument === '6' ? '6' : '4'} válida`,
  isUuid: () => 'debe ser un identificador válido',
  isArray: () => 'debe ser una lista',
  isIn: (argument) => {
    const values = Array.isArray(argument) ? argument.map(String) : [];
    return values.length && values.length <= 4 ? `debe ser uno de: ${values.join(', ')}` : 'debe ser uno de los valores permitidos';
  },
  minLength: (argument) => `debe tener al menos ${argument} ${argument === 1 ? 'carácter' : 'caracteres'}`,
  maxLength: (argument) => `no debe superar los ${argument} ${argument === 1 ? 'carácter' : 'caracteres'}`,
  min: (argument) => `no puede ser menor que ${argument}`,
  max: (argument) => `no puede ser mayor que ${argument}`,
  arrayMaxSize: (argument) => `no debe tener más de ${argument} elementos`,
  matches: (argument) => PATTERNS[(argument as RegExp)?.source] ?? 'tiene un formato no válido',
  nestedValidation: () => 'debe ser un objeto con los campos esperados',
  whitelistValidation: () => 'no es un campo permitido',
};

// Los mensajes llegan como texto ya interpolado en inglés; solo se usa cuando la
// regla no está traducida, para que el hueco sea visible y ubicable.
function rule(type: string, target: unknown, property: string): string {
  const translate = RULES[type];
  return translate ? translate(argumentOf(target, property, type)) : `no cumple la regla «${type}»`;
}

// El argumento declarado en el DTO (longitud, máximo, lista, expresión): evita
// deducirlo del mensaje en inglés. Los decoradores se registran como validación
// personalizada (el nombre lleva la regla y el tipo es genérico); @ValidateNested
// es al revés, sin nombre. La clave del fallo es una de las dos.
function argumentOf(target: unknown, property: string, type: string): unknown {
  if (!target || typeof target !== 'object') return undefined;
  const metadata = getMetadataStorage().getTargetValidationMetadatas(target.constructor as Function, '', true, false);
  return metadata.find((item) => item.propertyName === property && (item.name ?? item.type) === type)?.constraints?.[0];
}

function where(property: string, path: string): string {
  const label = FIELD_LABELS[property];
  if (!label) return path;
  return path === property ? label : `${label} (${path})`;
}

export function validationMessages(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    for (const type of Object.keys(error.constraints ?? {})) {
      messages.push(`${where(error.property, path)}: ${rule(type, error.target, error.property)}.`);
    }
    if (error.children?.length) messages.push(...validationMessages(error.children, path));
  }
  return messages;
}

// El pipe global: una sola traducción para todos los DTO de la API.
export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: (errors) => new BadRequestException(validationMessages(errors)),
};
