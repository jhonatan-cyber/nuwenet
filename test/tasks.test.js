import { createTestSchema } from './postgres-fixture.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { ManagementService } from '../apps/api/dist/management/management.service.js';
import { AuthService } from '../apps/api/dist/auth/auth.service.js';
import { runAsSystem } from '../apps/api/dist/common/request-context.js';
import { OverdueScheduler } from '../apps/api/dist/management/scheduler.service.js';

async function fixture(run, notifier) {
  const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-tasks-'));
  const pg = await createTestSchema();
  const names = ['DB_DRIVER', 'DATA_DIR', 'BACKUP_DIR', 'ROUTER_ENCRYPTION_KEY', 'CURRENCY', 'OVERDUE_CRON_MINUTES'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  process.env.DB_DRIVER = 'postgres'; process.env.DATA_DIR = directory; process.env.BACKUP_DIR = path.join(directory, 'backups'); process.env.ROUTER_ENCRYPTION_KEY = pg.env.ROUTER_ENCRYPTION_KEY; process.env.CURRENCY = 'Bs'; process.env.OVERDUE_CRON_MINUTES = '0';
  const db = new DatabaseService(); await db.onModuleInit(); const auth = new AuthService(db);
  const calls = [];
  const routers = {
    action: async (id, action) => { calls.push({ id, ...action }); },
    releaseClient: async (id, ip) => { calls.push({ id, ip, action: 'cleanup' }); },
  };
  const service = new ManagementService(db, routers, notifier || { notify: async () => {} });
  try { await runAsSystem(() => run({ db, auth, service, routers, calls })); }
  finally { await db.onModuleDestroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } const resolved = realpathSync(directory); assert.equal(path.dirname(resolved), realpathSync(tmpdir())); assert.ok(path.basename(resolved).startsWith('nuwenet-tasks-')); await pg.close(); rmSync(resolved, { recursive: true, force: true }); }
}

test('C4: un aviso fallido no reintenta la orden de red ya aplicada', () => fixture(async ({ db, service, routers, calls }) => {
  const [building] = await db.read(tx => tx`SELECT id FROM buildings ORDER BY id`);
  await db.write(tx => tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials,building_id) VALUES ('Central','mikrotik-rest','192.168.1.1',443,'https','fixture',${building.id})`);
  await service.setBuildingCentral({ building_id: building.id, central_router_id: 1 });
  await service.createPlan({ name: 'Plan', down: 50, up: 10, price: 100 });
  await service.createCustomer({ name: 'Titular', apartment: '101', plan_id: 1, ip: '192.168.1.10' });
  await service.changeAccess({ id: 1, status: 'suspended' });
  const errors = [];
  const original = console.error; console.error = (message) => { errors.push(String(message)); };
  try { await service.processQueue(); } finally { console.error = original; }
  const [job] = await db.read(tx => tx`SELECT * FROM commands ORDER BY id DESC LIMIT 1`);
  assert.equal(job.status, 'applied');
  assert.equal(job.mode, 'mikrotik');
  assert.ok(calls.some(c => c.action === 'suspend' && c.ip === '192.168.1.10'));
  assert.ok(errors.some(m => m.includes('falló el aviso')));
  calls.length = 0;
  await service.processQueue();
  assert.equal(calls.length, 0, 'La orden aplicada no se repite por el aviso fallido');
  const [again] = await db.read(tx => tx`SELECT * FROM commands ORDER BY id DESC LIMIT 1`);
  assert.equal(again.attempts, 1);
}, { notify: async () => { throw new Error('Aviso caído'); } }));

test('C5: el scheduler registra diagnóstico por tarea y el estado expone tareas y cola', () => fixture(async ({ db, auth, service, routers }) => {
  await auth.setup({ username: 'admin', password: 'fixture-password' });
  const backup = { create: async () => { throw new Error('Disco lleno'); } };
  await service.saveSettings({ ...await service.settings(), backup_hours: 1 });
  const scheduler = new OverdueScheduler(service, db, routers, backup);
  await scheduler.tick();
  const rows = await db.read(tx => tx`SELECT key,value FROM settings WHERE key LIKE 'task:%'`);
  const tasks = Object.fromEntries(rows.map(r => [String(r.key).slice(5), JSON.parse(r.value)]));
  for (const name of ['linked', 'network', 'notifications', 'sessions']) {
    assert.ok(tasks[name]?.last_success, `La tarea ${name} registra su éxito`);
    assert.ok(Number.isInteger(tasks[name]?.duration_ms), `La tarea ${name} registra su duración`);
  }
  assert.match(tasks.backups?.last_error || '', /Disco lleno/);
  assert.ok(tasks.backups?.last_run, 'La tarea fallida registra su ejecución');
  const snap = await service.snapshot();
  assert.ok(Array.isArray(snap.automation.tasks));
  const network = snap.automation.tasks.find(t => t.name === 'network');
  assert.ok(network?.last_success, 'El estado expone el diagnóstico de red');
  assert.deepEqual(snap.automation.queue, { pending: 0, failed: 0, oldest: null });
}));
