import path from 'node:path';
import { readFileSync } from 'node:fs';

export const UUID_V7_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const routerDevicesRoute = new RegExp(`^/routers/${UUID_V7_PATTERN}/devices$`);
export const routerServicesRoute = new RegExp(`^/routers/${UUID_V7_PATTERN}/services$`);

export const PUBLIC_ROUTES = [
  '/auth/status', '/auth/setup', '/auth/login', '/auth/logout', '/auth/me', '/health',
  '/portal', '/portal/traffic', '/portal/usage', '/portal/notice',
];

export function apiPort(): number {
  return Number(process.env.PORT || 3000);
}

export function apiHost(): string {
  return process.env.HOST || '127.0.0.1';
}

export function allowedOrigins(fallbackHost?: string): string[] {
  const extra = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4321,http://localhost:4321')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return fallbackHost ? [fallbackHost, ...extra] : extra;
}

export function validatePortalEnv(): { ip: string; publicUrl: string; captivePort: number } | null {
  const portalIp = process.env.NUWENET_PORTAL_IP;
  const publicUrl = process.env.NUWENET_PUBLIC_URL;
  if (Boolean(portalIp) !== Boolean(publicUrl)) {
    throw new Error('Configura juntos NUWENET_PORTAL_IP y NUWENET_PUBLIC_URL.');
  }
  if (!portalIp || !publicUrl) return null;
  const captivePort = Number(process.env.NUWENET_CAPTIVE_PORT || 3080);
  if (!Number.isInteger(captivePort) || captivePort < 1 || captivePort > 65535 || captivePort === apiPort()) {
    throw new Error('El puerto de corte debe ser válido y distinto del puerto de la API.');
  }
  return { ip: portalIp, publicUrl, captivePort };
}

/**
 * Raíz del repositorio (donde vive el package.json `nuwenet`).
 * Independiente de la profundidad del archivo compilado en `dist/`.
 */
export function repoRoot(from: string = __dirname): string {
  let dir = from;
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: string };
      if (pkg?.name === 'nuwenet') return dir;
    } catch {
      /* subir un nivel */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(from, '../../../..');
}
