/**
 * config/env.ts — fuente única de verdad para variables de entorno.
 *
 * Cada función valida su variable en el momento de leerla y lanza un
 * mensaje claro si la configuración es inválida.  No usa Zod para
 * mantener cero dependencias externas, pero el patrón es reemplazable.
 *
 * Las variables de bootstrap (PORT, HOST, ALLOWED_ORIGINS, portal) ya
 * viven en app.config.ts y se re-exportan aquí para tener un único punto
 * de importación.
 */
export {
  apiPort,
  apiHost,
  allowedOrigins,
  validatePortalEnv,
  repoRoot,
} from './app.config';

// ---------- Runtime — leídas durante peticiones ----------

/** Moneda configurada para facturación (p. ej. "BOB", "USD"). Vacío = sin símbolo. */
export function envCurrency(): string {
  return (process.env.CURRENCY || '').trim();
}

/** Minutos entre cada revisión automática de vencidos. 0 = deshabilitado. */
export function envOverdueCronMinutes(): number {
  const raw = Number(process.env.OVERDUE_CRON_MINUTES || 0);
  if (!Number.isInteger(raw) || raw < 0 || raw > 1440) {
    throw new Error('OVERDUE_CRON_MINUTES debe ser un entero entre 0 y 1440.');
  }
  return raw;
}

/** Mensaje público de suspensión visible en el portal del residente. Vacío = sin mensaje. */
export function envSuspensionMessage(): string {
  return (process.env.NUWENET_SUSPENSION_MESSAGE || '').trim();
}

/** Contacto del administrador visible en el portal del residente. Vacío = no se muestra. */
export function envAdminContact(): string {
  return (process.env.NUWENET_ADMIN_CONTACT || '').trim();
}

// ---------- Bootstrap — leídas una sola vez al arrancar ----------

/**
 * Proxies de confianza para Express (TRUST_PROXY).
 * Formato: lista separada por comas, p. ej. "loopback,172.16.0.0/12".
 * Vacío = Express sin trust-proxy (directo a internet).
 */
export function envTrustProxy(): string[] | null {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw) return null;
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}
