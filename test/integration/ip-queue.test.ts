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
  const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-ip-'));
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
  finally { await db.onModuleDestroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } const resolved = realpathSync(directory); assert.equal(path.dirname(resolved), realpathSync(tmpdir())); assert.ok(path.basename(resolved).startsWith('nuwenet-ip-')); await pg.close(); rmSync(resolved, { recursive: true, force: true }); }
}

// Órdenes que todavía pueden llegar al equipo: ninguna debería quedar así al final.
const pendientes = async (db) => (await db.read(tx => tx`SELECT COUNT(*)::int total FROM commands WHERE status IN ('pending','failed','running')`))[0].total;

async function escenario({ db, service }) {
  const [building] = await db.read(tx => tx`SELECT id FROM buildings ORDER BY id`);
  const central = uuidv7();
  await db.write(tx => tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (${central},'Central','mikrotik-rest','192.168.1.1',443,'https','fixture',${building.id})`);
  await service.setBuildingCentral({ building_id: building.id, central_router_id: central });
  await service.createPlan({ name: 'Hogar', down: 50, up: 10, price: 100 });
  const [plan] = await db.read(tx => tx`SELECT id FROM plans LIMIT 1`);
  return { building, central, plan };
}

test('departamento sin IP: la orden que falló por eso queda reemplazada y la nueva se aplica', () => fixture(async ({ db, service, calls }) => {
  const { central, plan } = await escenario({ db, service });

  // Sin IP el alta no encola nada y no nace como fallo de red: tiene su propio estado.
  await service.createCustomer({ apartment: '101', name: 'Ana', plan_id: plan.id });
  assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM commands`))[0].total, 0, 'el alta sin IP no encola órdenes');
  const [ana] = await db.read(tx => tx`SELECT id FROM customers WHERE apartment='101'`);
  assert.equal((await db.read(tx => tx`SELECT network_state FROM customers WHERE id=${ana.id}`))[0].network_state, 'no_ip', 'el alta sin IP no se lee como fallo de red');

  // Suspender sí encola, y la orden no puede aplicarse: falla por falta de IP con el motivo.
  await service.changeAccess({ id: ana.id, status: 'suspended' });
  const sinIp = await db.read(tx => tx`SELECT status, last_error, payload FROM commands ORDER BY id`);
  assert.equal(sinIp.length, 1);
  assert.equal(sinIp[0].status, 'failed');
  assert.match(sinIp[0].last_error, /no tiene IP privada/i, 'la orden explica que falta la IP');
  assert.equal(JSON.parse(sinIp[0].payload).ip, null);
  assert.equal((await db.read(tx => tx`SELECT network_state FROM customers WHERE id=${ana.id}`))[0].network_state, 'no_ip', 'la orden falla por la IP, pero el departamento conserva su estado propio');

  // Asignar la IP deja sin efecto esa orden y encola una que sí puede aplicarse.
  await service.setCustomerIp({ id: ana.id, ip: '192.168.1.10' });
  const trasAsignar = await db.read(tx => tx`SELECT status, last_error, payload FROM commands ORDER BY id`);
  assert.equal(trasAsignar.length, 2);
  assert.equal(trasAsignar[0].status, 'superseded', 'la orden que falló por falta de IP queda fuera de la cola');
  assert.match(trasAsignar[0].last_error, /no tiene IP privada/i, 'la orden reemplazada conserva el motivo');
  assert.equal(trasAsignar[1].status, 'pending');
  const vigente = JSON.parse(trasAsignar[1].payload);
  assert.equal(vigente.ip, '192.168.1.10');
  assert.equal(vigente.routerId, central);
  assert.equal(vigente.previous, undefined, 'sin IP previa no hay nada que liberar en el equipo');

  // La reemplazada no bloquea a la vigente: es la más antigua del departamento y antes
  // retenía la cola con su reintento.
  calls.length = 0;
  await service.processQueue();
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['suspend', '192.168.1.10']], 'la orden vigente llega al equipo, sin liberar una IP que nunca existió');
  assert.ok(calls.every(llamada => llamada.id === central));
  assert.equal(await pendientes(db), 0, 'ninguna orden queda bloqueando la cola');
  assert.equal((await service.snapshot()).customers.find(cliente => cliente.apartment === '101').network_state, 'applied');

  // Quitar la IP libera la regla en el equipo y vuelve a fallar por falta de IP; volver a
  // asignarla reemplaza esa orden y la cola queda otra vez vacía.
  await service.setCustomerIp({ id: ana.id });
  assert.equal((await db.read(tx => tx`SELECT network_state FROM customers WHERE id=${ana.id}`))[0].network_state, 'no_ip', 'al quedarse sin IP vuelve a su propio estado, aunque quede una limpieza pendiente');
  calls.length = 0;
  await service.processQueue();
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['cleanup', '192.168.1.10']], 'la IP se libera en el equipo central');
  const sinIpOtraVez = await db.read(tx => tx`SELECT status, last_error FROM commands ORDER BY id`);
  assert.equal(sinIpOtraVez[2].status, 'failed');
  assert.match(sinIpOtraVez[2].last_error, /no tiene IP privada/i);
  assert.equal((await db.read(tx => tx`SELECT ip FROM customers WHERE id=${ana.id}`))[0].ip, null);

  await service.setCustomerIp({ id: ana.id, ip: '192.168.1.11' });
  calls.length = 0;
  await service.processQueue();
  const finales = await db.read(tx => tx`SELECT status FROM commands ORDER BY id`);
  assert.deepEqual(finales.map(orden => orden.status), ['superseded', 'applied', 'superseded', 'applied'], 'cada reasignación reemplaza la orden imposible y aplica la suya');
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['suspend', '192.168.1.11']]);
  assert.equal(await pendientes(db), 0);
}));

test('la orden que falló por falta de IP no retiene al resto de la cola', () => fixture(async ({ db, service, calls }) => {
  const { central, plan } = await escenario({ db, service });
  await service.createCustomer({ apartment: '201', name: 'Ana', plan_id: plan.id });
  const [ana] = await db.read(tx => tx`SELECT id FROM customers WHERE apartment='201'`);
  // La primera orden del sistema es la que no se puede aplicar (nadie tiene IP todavía).
  await service.changeAccess({ id: ana.id, status: 'suspended' });

  await service.createCustomer({ apartment: '202', name: 'Beto', plan_id: plan.id, ip: '192.168.1.20' });
  calls.length = 0;
  await service.processQueue();
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['reactivate', '192.168.1.20'], ['speed_limit', '192.168.1.20']], 'el departamento con IP se aplica aunque la orden más antigua del edificio esté fallida');
  assert.ok(calls.every(llamada => llamada.id === central));
  const esperando = await db.read(tx => tx`SELECT status FROM commands ORDER BY id`);
  assert.deepEqual(esperando.map(orden => orden.status), ['failed', 'applied'], 'la orden sin IP sigue su propio reintento, sin retener a las demás');

  await service.setCustomerIp({ id: ana.id, ip: '192.168.1.21' });
  calls.length = 0;
  await service.processQueue();
  assert.deepEqual(calls.map(llamada => [llamada.action, llamada.ip]), [['suspend', '192.168.1.21']], 'al asignarle la IP, su orden reemplaza a la fallida y se aplica');
  assert.equal(await pendientes(db), 0);
  assert.ok((await service.snapshot()).customers.every(cliente => cliente.network_state === 'applied'));
}));
