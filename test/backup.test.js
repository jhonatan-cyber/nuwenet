import { createTestDatabase } from './postgres-fixture.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { ManagementService } from '../apps/api/dist/management/management.service.js';
import { CredentialVault } from '../apps/api/dist/routers/credential-vault.js';
import { BackupService, verifyBackup } from '../apps/api/dist/management/backup.service.js';
import { runAsSystem } from '../apps/api/dist/common/request-context.js';

async function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-backup-'));
  const pg = await createTestDatabase();
  const names = ['DB_DRIVER', 'DATA_DIR', 'BACKUP_DIR', 'ROUTER_ENCRYPTION_KEY', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_EXTERNAL_DIR', 'BACKUP_RETENTION_DAYS', 'BACKUP_KEEP_MIN', 'CURRENCY', 'OVERDUE_CRON_MINUTES'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  process.env.DB_DRIVER = 'postgres'; process.env.DATA_DIR = directory; process.env.BACKUP_DIR = path.join(directory, 'backups'); process.env.ROUTER_ENCRYPTION_KEY = pg.env.ROUTER_ENCRYPTION_KEY; delete process.env.BACKUP_ENCRYPTION_KEY; delete process.env.BACKUP_EXTERNAL_DIR; process.env.CURRENCY = 'Bs'; process.env.OVERDUE_CRON_MINUTES = '0';
  const db = new DatabaseService(); await db.onModuleInit();
  const service = new ManagementService(db, {}, { notify: async () => {} });
  try { await runAsSystem(() => run({ db, service, directory })); }
  finally { await db.onModuleDestroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } const resolved = realpathSync(directory); assert.equal(path.dirname(resolved), realpathSync(tmpdir())); assert.ok(path.basename(resolved).startsWith('nuwenet-backup-')); await pg.close(); rmSync(resolved, { recursive: true, force: true }); }
}

async function seed(db, service) {
  const vault = new CredentialVault(), sealed = vault.seal({ username: 'fixture', password: 'private-fixture' });
  await db.write(tx => tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials) VALUES ('Fixture','mikrotik-rest','192.168.1.1',443,'https',${sealed})`);
  await service.createPlan({ name: 'Respaldo', down: 50, up: 10, price: 100 });
}

test('D1/D4: paquete cifrado ilegible sin clave, redondo verificado y restauración', () => fixture(async ({ db, service, directory }) => {
  process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await seed(db, service);
  const backups = new BackupService(db), backup = await backups.create();
  assert.equal(backup.encrypted, true);
  const source = path.join(directory, 'backups', backup.name);
  assert.ok(!existsSync(path.join(source, 'nuwenet.dump')), 'Sin base en texto plano');
  assert.ok(!existsSync(path.join(source, 'router.key')), 'Sin clave en texto plano');
  assert.ok(existsSync(path.join(source, 'nuwenet.dump.enc')));
  assert.ok(existsSync(path.join(source, 'router.key.enc')));
  assert.equal((await backups.verify(backup.name)).verified, true);
  assert.equal(backups.list()[0].encrypted, true);
  const destination = path.join(directory, 'restored');
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', source, destination], { encoding: 'utf8', windowsHide: true, env: process.env });
  assert.equal(restore.status, 0, restore.stderr);
  assert.equal((await verifyBackup(destination)).driver, 'postgres');
  assert.ok(existsSync(path.join(destination, 'router.key')));
  const restored = await createTestDatabase();
  const connection = restored.connect();
  try {
    const restoreArgs = ['--exit-on-error', '--dbname', restored.env.DATABASE_URL || restored.env.PGDATABASE, path.join(destination, 'nuwenet.dump')];
    const result = spawnSync(process.env.PG_RESTORE_PATH || 'pg_restore', restoreArgs, { env: process.env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await connection`SELECT name FROM plans`)[0].name, 'Respaldo');
    const [router] = await connection`SELECT credentials FROM routers`;
    process.env.ROUTER_ENCRYPTION_KEY = readFileSync(path.join(destination, 'router.key'), 'utf8');
    assert.equal(new CredentialVault().open(router.credentials).password, 'private-fixture');
  } finally { await connection.close(); await restored.close(); }
}));

test('D4: clave incorrecta, ausente y paquete corrupto se rechazan con mensaje claro', () => fixture(async ({ db, service, directory }) => {
  const right = randomBytes(32).toString('base64');
  process.env.BACKUP_ENCRYPTION_KEY = right;
  await seed(db, service);
  const backups = new BackupService(db), backup = await backups.create();
  const source = path.join(directory, 'backups', backup.name);
  process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  await assert.rejects(() => verifyBackup(source), /recuperación|clave/i);
  await assert.rejects(() => backups.verify(backup.name), /verificación/);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  await assert.rejects(() => verifyBackup(source), /cifrado|BACKUP_ENCRYPTION_KEY/);
  process.env.BACKUP_ENCRYPTION_KEY = right;
  const enc = path.join(source, 'nuwenet.dump.enc');
  const data = readFileSync(enc); data[data.length - 20] ^= 0xff; writeFileSync(enc, data);
  await assert.rejects(() => verifyBackup(source), /integridad/);
}));

test('D4: formato heredado sin cifrar sigue verificándose y restaurándose', () => fixture(async ({ db, service, directory }) => {
  await seed(db, service);
  const backups = new BackupService(db), backup = await backups.create();
  assert.equal(backup.encrypted, false);
  const source = path.join(directory, 'backups', backup.name);
  assert.ok(existsSync(path.join(source, 'nuwenet.dump')));
  assert.equal((await backups.verify(backup.name)).verified, true);
  const destination = path.join(directory, 'restored');
  const restore = spawnSync(process.execPath, ['scripts/restore-backup.mjs', source, destination], { encoding: 'utf8', windowsHide: true });
  assert.equal(restore.status, 0, restore.stderr);
}));

test('D3: copia externa de paquete cifrado se verifica en destino', () => fixture(async ({ db, service, directory }) => {
  process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const external = path.join(directory, 'external'); mkdirSync(external);
  process.env.BACKUP_EXTERNAL_DIR = external;
  await seed(db, service);
  const backups = new BackupService(db), backup = await backups.create();
  assert.equal(backup.external_copied, true);
  await verifyBackup(path.join(external, backup.name));
}));
