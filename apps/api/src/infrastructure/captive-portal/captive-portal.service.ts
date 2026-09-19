import { createServer, type Server } from 'node:http';
import { validateRouterHost } from '../../routers/router-network';

export interface CaptivePortalConfig {
  ip: string;
  publicUrl: string;
  captivePort: number;
}

export function resolveCaptivePortalConfig(): CaptivePortalConfig | null {
  const portalIp = process.env.NUWENET_PORTAL_IP;
  const publicUrl = process.env.NUWENET_PUBLIC_URL;
  if (Boolean(portalIp) !== Boolean(publicUrl)) {
    throw new Error('Configura juntos NUWENET_PORTAL_IP y NUWENET_PUBLIC_URL.');
  }
  if (!portalIp || !publicUrl) return null;
  validateRouterHost(portalIp);
  const url = new URL(publicUrl);
  const captivePort = Number(process.env.NUWENET_CAPTIVE_PORT || 3080);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('URL pública del portal inválida.');
  }
  if (!Number.isInteger(captivePort) || captivePort < 1 || captivePort > 65535 || captivePort === Number(process.env.PORT || 3000)) {
    throw new Error('El puerto de corte debe ser válido y distinto del puerto de la API.');
  }
  return { ip: portalIp, publicUrl, captivePort };
}

export function startCaptivePortal(config: CaptivePortalConfig): Server {
  const destination = new URL('/corte', config.publicUrl);
  const captive = createServer((_req, res) => {
    res.writeHead(302, { Location: destination.href, 'Cache-Control': 'no-store' });
    res.end();
  });
  captive.listen(config.captivePort, config.ip);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => captive.close());
  return captive;
}
