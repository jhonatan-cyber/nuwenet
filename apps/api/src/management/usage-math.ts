export const USAGE_ZONE = 'America/La_Paz';
export const USAGE_INTERVAL_MS = 60_000;
export const USAGE_GAP_MS = 5 * USAGE_INTERVAL_MS;
const DAY_MS = 86_400_000;
export const usageDay = (at: number) => new Date(at - 4 * 3_600_000).toISOString().slice(0, 10);

export function validCounter(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Allocate only a measured delta, preserving its exact integer sum across local days.
export function splitUsage(from: number, to: number, download: number, upload: number) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !validCounter(download) || !validCounter(upload)) throw new Error('Intervalo de consumo inválido.');
  const rows: { day: string; download: number; upload: number; duration: number }[] = [];
  let start = from, assignedDown = 0, assignedUp = 0;
  while (start < to) {
    const day = usageDay(start);
    const end = Math.min(to, Date.parse(`${day}T00:00:00-04:00`) + DAY_MS);
    const cumulativeDown = end === to ? download : Math.floor(download * ((end - from) / (to - from)));
    const cumulativeUp = end === to ? upload : Math.floor(upload * ((end - from) / (to - from)));
    rows.push({day, download: cumulativeDown - assignedDown, upload: cumulativeUp - assignedUp, duration: end - start});
    assignedDown = cumulativeDown; assignedUp = cumulativeUp; start = end;
  }
  return rows;
}
