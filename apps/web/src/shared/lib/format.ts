/**
 * shared/lib/format.ts — formatters canónicos compartidos entre scripts vanilla,
 * stores de React y componentes.
 *
 * Fuente de verdad para money, date, gb y fmtTraffic.
 * Los stores reciben currency como parámetro para no depender de estado global.
 */

const TZ = 'America/La_Paz';
const LOCALE = 'es-BO';

/**
 * Formatea centavos enteros como importe con 2 decimales.
 * @param cents  Valor en centavos (100 = 1.00)
 * @param currency  Símbolo o código de moneda, p. ej. "BOB". Vacío = sin prefijo.
 */
export function fmtMoney(cents: number | string, currency = ''): string {
  const formatted = new Intl.NumberFormat('es', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
  return currency ? `${currency} ${formatted}` : formatted;
}

/**
 * Formatea una fecha ISO o timestamp como fecha corta + hora corta en Bolivia.
 * Retorna '—' si el valor es null/undefined/vacío.
 */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: TZ,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * Formatea bytes como gigabytes decimales con 3 decimales.
 */
export function fmtGb(bytes: number | string): string {
  return (Number(bytes) / 1e9).toLocaleString(LOCALE, {
    maximumFractionDigits: 3,
    minimumFractionDigits: 3,
  });
}

/**
 * Formatea tasas de tráfico en tiempo real (Mbps y GB acumulados).
 * @param downloadRate  Bytes/s de bajada
 * @param uploadRate    Bytes/s de subida
 * @param downloadBytes Bytes acumulados de bajada
 * @param uploadBytes   Bytes acumulados de subida
 */
export function fmtTraffic(
  downloadRate: number,
  uploadRate: number,
  downloadBytes: number,
  uploadBytes: number,
): string {
  return `Bajada ${(downloadRate / 1e6).toFixed(2)} / Subida ${(uploadRate / 1e6).toFixed(2)} Mbps · ${fmtGb(downloadBytes + uploadBytes)} GB`;
}

/**
 * Formatea el mes actual en formato YYYY-MM (hora de Bolivia).
 */
export function currentMonth(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
}
