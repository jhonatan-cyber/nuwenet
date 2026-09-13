import { BadRequestException, Injectable } from '@nestjs/common';
import { createDecipheriv } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { DatabaseService } from '../database/database.service';
import { backupPolicy, maintainBackups } from './backup-policy';
import { backupKey, decryptFile, encryptFile, keyFingerprint, sha256File } from './backup-crypto';

const root = path.resolve(__dirname, '../../../..');
export const backupRoot = () => path.resolve(root, process.env.BACKUP_DIR || 'backups');
const legacyFiles = ['nuwenet.sqlite', 'nuwenet.dump', 'router.key'];

function readManifest(directory: string) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!['sqlite', 'postgres'].includes(manifest.driver) || !manifest.files || typeof manifest.files !== 'object') throw new Error('Manifiesto inválido.');
  if (!manifest.files[manifest.driver === 'sqlite' ? 'nuwenet.sqlite' : 'nuwenet.dump']) throw new Error('Falta la base de datos en el manifiesto.');
  return manifest;
}

function checkSqlite(directory: string, keyMaterial: string | null) {
  const db = new Database(path.join(directory, 'nuwenet.sqlite'), { readonly: true });
  try {
    const check = db.query('PRAGMA integrity_check').get() as Record<string, string>;
    if (Object.values(check)[0] !== 'ok' || db.query('PRAGMA foreign_key_check').all().length) throw new Error('La base respaldada no supera la verificación.');
    const encrypted = db.query('SELECT COUNT(*) count FROM routers').get() as { count: number };
    if (encrypted.count && !keyMaterial) throw new Error('Falta la clave de los routers.');
    if (encrypted.count) {
      const key = Buffer.from(keyMaterial!.trim(), 'base64');
      if (key.length !== 32) throw new Error('Clave de respaldo inválida.');
      for (const row of db.query('SELECT credentials FROM routers').all() as { credentials: string }[]) {
        const [version, iv, tag, payload] = row.credentials.split('.');
        if (version !== 'v1') throw new Error('Formato de credenciales desconocido.');
        const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); cipher.setAuthTag(Buffer.from(tag, 'base64'));
        JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload, 'base64')), cipher.final()]).toString('utf8'));
      }
    }
  } finally { db.close(); }
}

async function checkDigests(directory: string, files: Record<string, string>) {
  for (const [name, expected] of Object.entries(files)) {
    if (!legacyFiles.includes(name) || await sha256File(path.join(directory, name)) !== expected) throw new Error('El respaldo no supera la verificación de integridad.');
  }
}

// D4: verifica paquetes cifrados y heredados sin cifrar. Los cifrados se
// descifran a un directorio temporal que se elimina al terminar.
export async function verifyBackup(directory: string) {
  const manifest = readManifest(directory);
  if (manifest.encrypted) {
    if (!manifest.package || typeof manifest.package !== 'object') throw new Error('Manifiesto inválido.');
    let key: Buffer;
    try { key = backupKey(); } catch { throw new Error('Este respaldo está cifrado. Configura BACKUP_ENCRYPTION_KEY con la clave de recuperación.'); }
    for (const [name, expected] of Object.entries(manifest.package)) {
      if (!/^[\w.-]+\.enc$/.test(name) || await sha256File(path.join(directory, name)) !== expected) throw new Error('El respaldo no supera la verificación de integridad.');
    }
    if (manifest.key_fingerprint && manifest.key_fingerprint !== keyFingerprint(key)) throw new Error('La clave de recuperación no corresponde a este respaldo.');
    const plain = mkdtempSync(path.join(tmpdir(), 'nuwenet-verify-'));
    try {
      for (const name of Object.keys(manifest.files)) {
        await decryptFile(key, path.join(directory, `${name}.enc`), path.join(plain, name));
      }
      await checkDigests(plain, manifest.files);
      if (manifest.driver === 'sqlite') {
        const keyMaterial = existsSync(path.join(plain, 'router.key')) ? readFileSync(path.join(plain, 'router.key'), 'utf8') : null;
        checkSqlite(plain, keyMaterial);
      }
    } finally { rmSync(plain, { recursive: true, force: true }); }
    return manifest;
  }
  await checkDigests(directory, manifest.files);
  if (manifest.driver === 'sqlite') {
    const keyMaterial = manifest.files['router.key'] ? readFileSync(path.join(directory, 'router.key'), 'utf8') : null;
    checkSqlite(directory, keyMaterial);
  }
  return manifest;
}
function runProgram(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PGHOST: process.env.PGHOST || '127.0.0.1', PGPORT: process.env.PGPORT || '5432', PGUSER: process.env.PGUSER || 'postgres', PGDATABASE: process.env.PGDATABASE || 'nuwenet', PGSSLMODE: process.env.PGSSLMODE || 'disable' } });
    const timer = setTimeout(() => { child.kill(); reject(new Error('El respaldo excedió el tiempo permitido.')); }, 120000);
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Instala las herramientas PostgreSQL y configura PG_DUMP_PATH / PG_RESTORE_PATH.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('La herramienta de respaldo PostgreSQL falló. Revisa conexión y permisos.')); });
  });
}
@Injectable()
export class BackupService {
  private running = false;
  constructor(private readonly db: DatabaseService) { }
  policy() { const p = backupPolicy(); return { retention_days: p.days, minimum_copies: p.keep, external_configured: Boolean(p.external), external_available: Boolean(p.external && existsSync(p.external)) }; }
  list() {
    if (!existsSync(backupRoot())) return [];
    return readdirSync(backupRoot()).filter(name => /^snapshot-[\dT-]+-[a-f0-9-]+$/.test(name)).flatMap(name => {
      try { const m = JSON.parse(readFileSync(path.join(backupRoot(), name, 'manifest.json'), 'utf8')); return [{ name, created_at: m.created_at, driver: m.driver, encrypted: m.encrypted === true }]; } catch { return []; }
    }).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
  }
  async create() {
    if (this.running) throw new BadRequestException('Ya hay un respaldo en curso.');
    this.running = true;
    try {
      const name = `snapshot-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${randomUUID()}`;
      const directory = path.join(backupRoot(), name); mkdirSync(directory, { recursive: true });
      const file = this.db.driver === 'sqlite' ? 'nuwenet.sqlite' : 'nuwenet.dump';
      if (this.db.driver === 'sqlite') await this.db.backupSqlite(path.join(directory, file));
      else {
        const args = ['--format=custom', '--file', path.join(directory, file)];
        if (process.env.DATABASE_URL) args.push('--dbname', process.env.DATABASE_URL);
        await runProgram(process.env.PG_DUMP_PATH || 'pg_dump', args);
        await runProgram(process.env.PG_RESTORE_PATH || 'pg_restore', ['--list', path.join(directory, file)]);
      }
      const keyfile = path.resolve(root, process.env.DATA_DIR || 'data', 'router.key');
      if (process.env.ROUTER_ENCRYPTION_KEY) writeFileSync(path.join(directory, 'router.key'), process.env.ROUTER_ENCRYPTION_KEY, { mode: 0o600 });
      else if (this.db.driver === 'sqlite' && existsSync(keyfile)) copyFileSync(keyfile, path.join(directory, 'router.key'));
      const files: Record<string, string> = { [file]: await sha256File(path.join(directory, file)) };
      if (existsSync(path.join(directory, 'router.key'))) files['router.key'] = await sha256File(path.join(directory, 'router.key'));
      // D1: con clave de recuperación se empaqueta cifrado y se elimina el
      // texto plano; sin ella se conserva el formato heredado sin cifrar.
      const encrypted = Boolean((process.env.BACKUP_ENCRYPTION_KEY || '').trim());
      const manifest: Record<string, unknown> = { driver: this.db.driver, created_at: new Date().toISOString(), encrypted, files };
      if (encrypted) {
        const key = backupKey();
        manifest.key_fingerprint = keyFingerprint(key);
        const sealed: Record<string, string> = {};
        for (const name of Object.keys(files)) {
          await encryptFile(key, path.join(directory, name), path.join(directory, `${name}.enc`));
          sealed[`${name}.enc`] = await sha256File(path.join(directory, `${name}.enc`));
          unlinkSync(path.join(directory, name));
        }
        manifest.package = sealed;
      }
      writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
      try { await verifyBackup(directory); } catch (error) { renameSync(path.join(directory, 'manifest.json'), path.join(directory, 'manifest.invalid.json')); throw error; }
      await this.db.write(tx => tx`INSERT INTO events(message,actor) VALUES (${'Respaldo verificado: ' + name},'Sistema')`);
      let maintenance;
      try { maintenance = await maintainBackups(backupRoot(), name, verifyBackup); } catch (error) { throw new BadRequestException((error as Error).message); }
      return { name, verified: true, encrypted, ...maintenance };
    } finally { this.running = false; }
  }
  async verify(name: string) {
    if (!/^snapshot-[\dT-]+-[a-f0-9-]+$/.test(name)) throw new BadRequestException('Nombre de respaldo inválido.');
    try { const manifest = await verifyBackup(path.join(backupRoot(), name)); return { name, verified: true, created_at: manifest.created_at }; }
    catch { throw new BadRequestException('El respaldo está incompleto o no supera la verificación.'); }
  }
}
