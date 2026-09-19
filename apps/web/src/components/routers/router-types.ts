import type { RouterEntry } from '@/features/routers-network/routers-store';

// ---------- Capacidades y etiquetas ----------

export const capNames: Record<string, string> = {
  identification: 'Identificación',
  status: 'Estado',
  interfaces: 'Interfaces',
  suspend: 'Suspensión',
  reactivate: 'Reactivación',
  speed_limit: 'Límite de velocidad',
  firewall: 'Firewall',
  parental_control: 'Control parental',
  switch_ports: 'Puertos de switch',
};

export const arrisCapNames: Record<string, string> = {
  ...capNames,
  suspend: 'Bloqueo IPv4 TCP/UDP',
  reactivate: 'Desbloqueo IPv4',
  firewall: 'Filtros de puertos IPv4',
  parental_control: 'Horarios IPv4',
};

export const opOrder = ['suspend', 'reactivate', 'speed_limit', 'firewall', 'parental_control'] as const;
export type Op = (typeof opOrder)[number];

export function opMeta(isArris: boolean): Record<Op, { label: string }> {
  return {
    suspend:          { label: isArris ? 'Bloquear IPv4 TCP/UDP'  : 'Suspender internet' },
    reactivate:       { label: isArris ? 'Desbloquear IPv4'       : 'Reactivar internet' },
    speed_limit:      { label: 'Límite de velocidad' },
    firewall:         { label: isArris ? 'Filtro de puertos IPv4' : 'Bloquear destino'   },
    parental_control: { label: isArris ? 'Horario IPv4'           : 'Horario parental'   },
  };
}

// ---------- Helpers ----------

export const isIpv4 = (ip?: string | null): ip is string =>
  typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip);

export const detailValue = (value: unknown): string =>
  value === null || value === undefined || value === '' ? 'Sin dato' : String(value);

export function randomSecret(length = 16): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let res = '';
  for (let i = 0; i < length; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

export function badgeFor(router: RouterEntry, checking: boolean): string {
  if (router.disabled) return 'Deshabilitado';
  if (checking) return 'Consultando…';
  return (
    { connected: 'Consulta correcta', untested: 'Sin probar', error: 'Error de conexión' }[router.status] ||
    router.status
  );
}

export const compatibilityLabels: Record<string, string> = {
  full: 'Administración completa',
  partial: 'Administración parcial',
  read_only: 'Solo consulta',
  unavailable: 'No disponible',
};

export function managementLevel(router: RouterEntry): { label: string; destructive: boolean } {
  if (router.compatibility === 'read_only' && !router.snapshot) return { label: 'Sin verificar', destructive: false };
  const label = (router.compatibility && compatibilityLabels[router.compatibility]) || 'Sin integración compatible';
  return {
    label,
    destructive: !router.compatibility || (router.compatibility === 'read_only' && router.adapter === 'tr369-usp'),
  };
}

// ---------- Draft (estado del dialog activo) ----------

export type Draft =
  | { type: 'form'; router: RouterEntry | null; preset?: { host?: string; name?: string; building_id?: string } }
  | { type: 'lan' }
  | { type: 'onboard' }
  | { type: 'control'; router: RouterEntry; action?: string; ip?: string }
  | { type: 'provision'; router: RouterEntry }
  | { type: 'traffic'; router: RouterEntry }
  | { type: 'discover'; router: RouterEntry }
  | { type: 'link'; router: RouterEntry; mac: string }
  | { type: 'remove'; router: RouterEntry }
  | { type: 'toggle'; router: RouterEntry };
