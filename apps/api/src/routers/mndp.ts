import { createSocket } from 'node:dgram';

// MikroTik Neighbor Discovery Protocol: los equipos anuncian UDP broadcast al
// puerto 5678 cada ~60 s. Formato verificado contra decodificadores abiertos:
// secuencia u32 LE y TLVs (tipo u16 BE, longitud u16 BE). Solo lectura, sin
// credenciales: sirve para listar candidatos y precargar el formulario.
export interface MndpNeighbor {
  mac: string | null;
  identity: string | null;
  version: string | null;
  platform: string | null;
  board: string | null;
  interface: string | null;
  uptime: number | null;
  ips: string[];
  source: string | null;
}

const T_MAC = 1, T_IDENTITY = 5, T_VERSION = 7, T_PLATFORM = 8, T_UPTIME = 10,
  T_SOFTWARE_ID = 11, T_BOARD = 12, T_IPV6 = 15, T_IFACE = 16, T_IPV4 = 17;
const TEXT = new Set([T_IDENTITY, T_VERSION, T_PLATFORM, T_SOFTWARE_ID, T_BOARD, T_IFACE]);

export function parseMndp(buffer: Buffer): MndpNeighbor | null {
  if (buffer.length < 4) return null;
  const neighbor: MndpNeighbor = { mac: null, identity: null, version: null, platform: null, board: null, interface: null, uptime: null, ips: [], source: null };
  let offset = 4; // secuencia u32 LE
  while (offset + 4 <= buffer.length) {
    const type = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 2);
    offset += 4;
    if (length < 0 || offset + length > buffer.length) return null;
    const value = buffer.subarray(offset, offset + length);
    offset += length;
    if (type === T_MAC && length === 6) {
      neighbor.mac = [...value].map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
    } else if (TEXT.has(type)) {
      const text = value.toString('utf8').replace(/\0/g, '');
      if (type === T_IDENTITY) neighbor.identity = text || null;
      else if (type === T_VERSION) neighbor.version = text || null;
      else if (type === T_PLATFORM) neighbor.platform = text || null;
      else if (type === T_BOARD) neighbor.board = text || null;
      else if (type === T_IFACE) neighbor.interface = text || null;
    } else if (type === T_UPTIME && length >= 4) {
      neighbor.uptime = value.readUInt32LE(0);
    } else if (type === T_IPV4 && length === 4) {
      neighbor.ips.push([...value].join('.'));
    } else if (type === T_IPV6 && length === 16) {
      const groups: string[] = [];
      for (let i = 0; i < 16; i += 2) groups.push(value.readUInt16BE(i).toString(16));
      neighbor.ips.push(groups.join(':'));
    }
  }
  if (!neighbor.mac && !neighbor.identity && !neighbor.ips.length) return null;
  return neighbor;
}

/** Escucha anuncios MNDP durante `timeoutMs` y devuelve vecinos únicos por MAC. */
export function discoverNeighbors(timeoutMs = 30000): Promise<MndpNeighbor[]> {
  const timeout = Math.min(Math.max(timeoutMs, 1000), 60000);
  return new Promise((resolve, reject) => {
    const found = new Map<string, MndpNeighbor>();
    let socket: ReturnType<typeof createSocket>;
    try {
      socket = createSocket({ type: 'udp4', reuseAddr: true });
    } catch (error) { reject(error); return; }
    const done = () => {
      try { socket.close(); } catch { /* ya cerrado */ }
      resolve([...found.values()]);
    };
    const timer = setTimeout(done, timeout);
    timer.unref?.();
    socket.on('message', (message: Buffer, remote: { address?: string }) => {
      try {
        const neighbor = parseMndp(Buffer.from(message));
        if (!neighbor) return;
        neighbor.source = remote?.address || null;
        const key = neighbor.mac || `${neighbor.identity}:${neighbor.ips[0] || remote?.address}`;
        const previous = found.get(key);
        if (!previous) found.set(key, neighbor);
        else if (neighbor.ips.length) {
          previous.ips = [...new Set([...previous.ips, ...neighbor.ips])];
          previous.identity = previous.identity || neighbor.identity;
          previous.version = previous.version || neighbor.version;
          previous.platform = previous.platform || neighbor.platform;
          previous.board = previous.board || neighbor.board;
          previous.interface = previous.interface || neighbor.interface;
        }
      } catch { /* un anuncio malformado no aborta la escucha */ }
    });
    socket.on('error', error => { clearTimeout(timer); try { socket.close(); } catch { /* noop */ } reject(error); });
    try {
      socket.bind(5678, () => { try { socket.setBroadcast(true); } catch { /* opcional */ } });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}
