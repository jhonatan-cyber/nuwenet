import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// D1: el paquete de respaldo se cifra con una clave de recuperación separada
// de la clave de routers. D3: todo el manejo de archivos es por streaming
// para no cargar respaldos completos en memoria.
export function backupKey(): Buffer {
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('Configura BACKUP_ENCRYPTION_KEY (32 bytes en base64) para cifrar el respaldo.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY inválida: debe ser 32 bytes en base64.');
  return key;
}

// Huella pública de la clave para distinguir "clave equivocada" de
// "paquete corrupto" sin oráculo de descifrado.
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function sha256File(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// Formato binario: [iv 12B][ciphertext][tag 16B], AES-256-GCM.
export async function encryptFile(key: Buffer, source: string, destination: string): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(destination, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => { out.write(iv, (err?: Error | null) => err ? reject(err) : resolve()); });
  await pipeline(createReadStream(source), cipher, out);
  await fs.appendFile(destination, cipher.getAuthTag());
}

export async function decryptFile(key: Buffer, source: string, destination: string): Promise<void> {
  const { size } = await fs.stat(source);
  if (size < 28) throw new Error('El paquete cifrado está incompleto o corrupto.');
  const iv = Buffer.alloc(12), tag = Buffer.alloc(16);
  const fd = await fs.open(source, 'r');
  try {
    await fd.read(iv, 0, 12, 0);
    await fd.read(tag, 0, 16, size - 16);
  } finally { await fd.close(); }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  try { decipher.setAuthTag(tag); } catch { throw new Error('La clave de recuperación no corresponde a este respaldo.'); }
  try {
    await pipeline(createReadStream(source, { start: 12, end: size - 17 }), decipher, createWriteStream(destination, { mode: 0o600 }));
  } catch {
    await fs.unlink(destination).catch(() => {});
    throw new Error('El respaldo no supera la verificación de integridad.');
  }
}
