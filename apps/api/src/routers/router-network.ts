import { BadGatewayException, BadRequestException } from '@nestjs/common';
import type { RouterTarget } from './router.types';

export function validateRouterHost(host: string): void {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255) || parts.join('.') !== host ||
      !(parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168))) {
    throw new BadRequestException('Utiliza la IPv4 privada del router, accesible por LAN o VPN.');
  }
}
export function routerOrigin(target: RouterTarget): string {
  validateRouterHost(target.host);
  return `${target.protocol}://${target.host}:${target.port}`;
}
export async function routerJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (response.status === 401 || response.status === 403) throw new BadGatewayException('El router rechazó las credenciales o los permisos de consulta.');
  if (!response.ok) throw new BadGatewayException('La interfaz de administración no respondió correctamente. Verifica el adaptador y sus requisitos.');
  // Bound responses from devices before parsing them; do not persist raw router payloads.
  const reader = response.body?.getReader();
  if (!reader) throw new BadGatewayException('Respuesta vacía del router.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new BadGatewayException('Respuesta del router demasiado grande.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function routerRest(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (response.status === 401 || response.status === 403) throw new BadGatewayException('El router rechazó las credenciales o los permisos.');
  if (!response.ok) throw new BadGatewayException('La interfaz de administración no respondió correctamente. Verifica el adaptador y sus requisitos.');
  const text = await response.text();
  if (!text) return {};
  if (text.length > 1024 * 1024) throw new BadGatewayException('Respuesta del router demasiado grande.');
  return JSON.parse(text);
}
