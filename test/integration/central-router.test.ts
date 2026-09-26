import { createTestSchema } from '../fixtures/postgres-fixture';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseService } from '../../apps/api/dist/database/database.service.js';
import { ManagementService } from '../../apps/api/dist/management/management.service.js';
import { runAsSystem } from '../../apps/api/dist/common/request-context.js';
import { uuidv7 } from '../../apps/api/dist/common/uuid.js';

async function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-central-'));
  const pg = await createTestSchema();
  const names = ['DB_DRIVER', 'DATA_DIR', 'BACKUP_DIR', 'ROUTER_ENCRYPTION_KEY', 'CURRENCY', 'OVERDUE_CRON_MINUTES'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  process.env.DB_DRIVER = 'postgres'; process.env.DATA_DIR = directory; process.env.BACKUP_DIR = path.join(directory, 'backups'); process.env.ROUTER_ENCRYPTION_KEY = pg.env.ROUTER_ENCRYPTION_KEY; process.env.CURRENCY = 'Bs'; process.env.OVERDUE_CRON_MINUTES = '0';
  const db = new DatabaseService(); await db.onModuleInit();
  const calls = [];
  const routers = {
    action: async (id, action) => { calls.push({ id, ...action }); },
    releaseClient: async (id, ip) => { calls.push({ id, ip, action: 'cleanup' }); },
  };
  const service = new ManagementService(db, routers);
  try { await runAsSystem(() => run({ db, service, calls })); }
  finally { await db.onModuleDestroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } const resolved = realpathSync(directory); assert.equal(path.dirname(resolved), realpathSync(tmpdir())); assert.ok(path.basename(resolved).startsWith('nuwenet-central-')); await pg.close(); rmSync(resolved, { recursive: true, force: true }); }
}

test('equipo central: el primero desbloquea las órdenes del edificio y un cambio sigue exigiendo la cola resuelta', () => fixture(async ({ db, service, calls }) => {
  const [building] = await db.read(tx => tx`SELECT id FROM buildings ORDER BY id`);
  const central = uuidv7(), segundo = uuidv7();
  await db.write(tx => tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (${central},'Central','mikrotik-rest','192.168.1.1',443,'https','fixture',${building.id})`);
  await service.createPlan({ name: 'Hogar', down: 50, up: 10, price: 100 });
  const [plan] = await db.read(tx => tx`SELECT id FROM plans LIMIT 1`);

  // Dos departamentos con IP mientras el edificio aún no tiene equipo central: sus
  // órdenes quedan en fallo con el motivo, tal como documenta el panel.
  await service.createCustomer({ apartment: '101', name: 'Ana', plan_id: plan.id, ip: '192.168.1.10' });
  await service.createCustomer({ apartment: '102', name: 'Beto', plan_id: plan.id, ip: '192.168.1.11' });
  const sinCentral = await db.read(tx => tx`SELECT status, last_error FROM commands ORDER BY id`);
  assert.equal(sinCentral.length, 2);
  assert.ok(sinCentral.every(orden => orden.status === 'failed'));
  assert.ok(sinCentral.every(orden => /equipo central/i.test(orden.last_error)), 'la orden explica que falta el equipo central');
  assert.equal((await service.snapshot()).enforcement.state, 'error');
  assert.ok((await service.snapshot()).customers.every(cliente => cliente.network_state === 'failed'));

  // El primer equipo central se asigna aunque existan esas órdenes: sin él no había
  // forma de resolverlas, así que antes esta llamada se rechazaba y el edificio
  // quedaba encerrado sin salida.
  await service.setBuildingCentral({ building_id: building.id, central_router_id: central });

  const trasAsignar = await db.read(tx => tx`SELECT status, last_error FROM commands ORDER BY id`);
  const reemplazadas = trasAsignar.filter(orden => orden.status === 'superseded');
  assert.equal(reemplazadas.length, 2, 'las órdenes que nunca pudieron aplicarse quedan reemplazadas');
  assert.ok(reemplazadas.every(orden => /equipo central/i.test(orden.last_error)), 'la orden reemplazada conserva el motivo');
  assert.equal(trasAsignar.filter(orden => orden.status === 'pending').length, 2, 'la asignación pone en cola la sincronización de cada departamento');
  assert.equal((await service.snapshot()).enforcement.state, 'unverified');

  await service.processQueue();
  assert.ok(calls.length > 0, 'las órdenes reemplazadas ya no bloquean a la vigente');
  assert.ok(calls.every(llamada => llamada.id === central), 'las órdenes se aplican en el equipo central recién asignado');
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['reactivate', '192.168.1.10'], ['speed_limit', '192.168.1.10'], ['reactivate', '192.168.1.11'], ['speed_limit', '192.168.1.11']]);
  assert.ok((await service.snapshot()).customers.every(cliente => cliente.network_state === 'applied'));
  assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM commands WHERE status IN ('pending','failed','running')`))[0].total, 0, 'ninguna orden queda bloqueando la cola');

  // Un cambio de equipo central sí exige la cola resuelta: la relajación es solo para
  // el primer alta.
  await db.write(tx => tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (${segundo},'Segundo','mikrotik-rest','192.168.1.2',443,'https','fixture',${building.id})`);
  const [ana] = await db.read(tx => tx`SELECT id FROM customers WHERE apartment='101'`);
  await service.changeAccess({ id: ana.id, status: 'suspended' });
  await assert.rejects(() => service.setBuildingCentral({ building_id: building.id, central_router_id: segundo }), /Resuelve las órdenes pendientes/);
  assert.equal((await db.read(tx => tx`SELECT central_router_id FROM buildings WHERE id=${building.id}`))[0].central_router_id, central, 'el equipo central no cambia mientras hay órdenes en curso');

  calls.length = 0;
  await service.processQueue();
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['suspend', '192.168.1.10']]);

  await service.setBuildingCentral({ building_id: building.id, central_router_id: segundo });
  assert.equal((await db.read(tx => tx`SELECT central_router_id FROM buildings WHERE id=${building.id}`))[0].central_router_id, segundo);
  const mudadas = await db.read(tx => tx`SELECT status, payload FROM commands WHERE status='pending' ORDER BY id`);
  assert.equal(mudadas.length, 2);
  assert.ok(mudadas.every(orden => JSON.parse(orden.payload).routerId === segundo && JSON.parse(orden.payload).previous?.routerId === central), 'cada departamento limpia su IP en el equipo anterior y entra en el nuevo');

  calls.length = 0;
  await service.processQueue();
  assert.ok(calls.some(llamada => llamada.action === 'cleanup' && llamada.id === central && llamada.ip === '192.168.1.10'), 'la IP se libera en el equipo anterior');
  assert.ok(calls.some(llamada => llamada.action === 'suspend' && llamada.id === segundo && llamada.ip === '192.168.1.10'), 'el departamento suspendido se respeta en el equipo nuevo');
  assert.ok(calls.some(llamada => llamada.action === 'reactivate' && llamada.id === segundo && llamada.ip === '192.168.1.11'));
  assert.ok(calls.every(llamada => [central, segundo].includes(llamada.id)));
  assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM commands WHERE status IN ('pending','failed','running')`))[0].total, 0);
  assert.ok((await service.snapshot()).customers.every(cliente => cliente.network_state === 'applied'));
}));
