import { networkInterfaces } from 'node:os';
import { connect } from 'node:net';

// Barrido activo complementario a MNDP: en redes donde el broadcast no llega
// (Wi-Fi puenteadas, AP aislados), un MikroTik igualmente expone 8291 (WinBox)
// y/o 80/443. No prueba credenciales: solo reporta candidatos por puerto
// abierto para precargar el formulario. Solo subredes privadas del servidor.
export interface LanCandidate { ip: string; ports: number[] }

const PROBE_PORTS = [8291, 80, 443];
const PROBE_TIMEOUT_MS = 250;
const CONCURRENCY = 128;

/** Subredes /24 privadas no internas del servidor (máximo 3 para acotar el barrido). */
export function localSubnets(): string[] {
  const subnets = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of list || []) {
      if (nic.family !== 'IPv4' || nic.internal) continue;
      const octets = nic.address.split('.').map(Number);
      if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      const [a, b] = octets;
      const isPrivate = a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
      if (!isPrivate) continue;
      subnets.add(`${a}.${b}.${octets[2]}`);
      if (subnets.size >= 3) return [...subnets];
    }
  }
  return [...subnets];
}

function probeTcp(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (open: boolean) => { if (!done) { done = true; resolve(open); } };
    const timer = setTimeout(() => { socket.destroy(); finish(false); }, timeoutMs);
    timer.unref?.();
    const socket = connect(port, ip);
    socket.on('connect', () => { clearTimeout(timer); socket.destroy(); finish(true); });
    socket.on('error', () => { clearTimeout(timer); finish(false); });
    socket.on('timeout', () => { socket.destroy(); finish(false); });
  });
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      results.push(await fn(item));
    }
  }));
  return results;
}

/** Barre las subredes locales buscando puertos típicos de administración. */
export async function sweepLan(subnets: string[] = localSubnets()): Promise<LanCandidate[]> {
  const targets: string[] = [];
  for (const subnet of subnets) for (let host = 1; host <= 254; host++) targets.push(`${subnet}.${host}`);
  const hits = await pool(targets, CONCURRENCY, async ip => {
    const open: number[] = [];
    for (const port of PROBE_PORTS) {
      // eslint-disable-next-line no-await-in-loop
      if (await probeTcp(ip, port, PROBE_TIMEOUT_MS)) open.push(port);
    }
    return open.length ? { ip, ports: open } : null;
  });
  return hits.filter((hit): hit is LanCandidate => hit !== null);
}
