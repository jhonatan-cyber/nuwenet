import { randomBytes } from 'node:crypto';

// UUID v7 (RFC 9562): 48 bits de tiempo Unix en ms + 74 bits aleatorios.
// Ordenable por creación e ideal como PK: inserciones vecinas en el índice.
export function uuidv7(at: number = Date.now()): string {
  const bytes = randomBytes(16);
  const time = BigInt(Math.max(0, Math.floor(at)));
  bytes[0] = Number((time >> 40n) & 0xffn);
  bytes[1] = Number((time >> 32n) & 0xffn);
  bytes[2] = Number((time >> 24n) & 0xffn);
  bytes[3] = Number((time >> 16n) & 0xffn);
  bytes[4] = Number((time >> 8n) & 0xffn);
  bytes[5] = Number(time & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
