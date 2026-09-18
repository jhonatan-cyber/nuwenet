import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTestSchema } from './postgres-fixture.js';
import { connectPostgres } from '../apps/api/dist/database/postgres-config.js';
import { uuidv7 } from '../apps/api/dist/common/uuid.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';

// Forma de las tablas antes de la migración 27: sin columna id y con la clave natural como primaria.
const tablasDeClaveNatural = [
  ['settings', 'key'], ['task_locks', 'name'], ['login_attempts', 'key'], ['sessions', 'token_hash'],
  ['user_buildings', 'user_id,building_id'], ['customer_devices', 'router_id,mac'],
  ['customer_network_targets', 'router_id,ip'], ['customer_network_dirty', 'customer_id'],
  ['usage_cursors', 'router_id,customer_id,queue_name'], ['usage_daily', 'customer_id,day'],
  ['usage_router_state', 'router_id'], ['building_networks', 'building_id'],
];

test('pruebas aisladas en esquemas de nuwenet, sin crear bases ni resolver tablas de public', async () => {
  const observer = connectPostgres({ ...process.env, PGSCHEMA: 'public' });
  const before = await observer`SELECT datname FROM pg_database ORDER BY datname`;
  let first, second, a, b, empty;
  try {
    first = await createTestSchema();
    a = new DatabaseService();
    await a.onModuleInit();
    await a.write(tx => tx`INSERT INTO plans(id,name,down,up,price) VALUES (${uuidv7()},'Solo primero',10,5,100)`);
    second = await createTestSchema();
    empty = second.connect();
    const [scope] = await empty`SELECT current_database() db, current_schema() schema, to_regclass('plans') plans`;
    assert.equal(scope.db, 'nuwenet');
    assert.equal(scope.schema, second.schema);
    assert.equal(scope.plans, null);
    b = new DatabaseService();
    await b.onModuleInit();
    assert.equal((await b.read(tx => tx`SELECT * FROM plans`)).length, 0);
    assert.equal((await a.read(tx => tx`SELECT name FROM plans`))[0].name, 'Solo primero');
    assert.deepEqual(await observer`SELECT datname FROM pg_database ORDER BY datname`, before);
  } finally {
    await empty?.close();
    await b?.onModuleDestroy();
    await second?.close();
    await a?.onModuleDestroy();
    await first?.close();
    if (first && second) {
      const remaining = await observer`SELECT nspname FROM pg_namespace WHERE nspname IN (${first.schema},${second.schema})`;
      assert.equal(remaining.length, 0);
    }
    await observer.close();
  }
});

test('dos instancias arrancan a la vez sobre el mismo esquema sin duplicar versiones', async () => {
  const fixture = await createTestSchema();
  const first = new DatabaseService();
  const second = new DatabaseService();
  try {
    await Promise.all([first.onModuleInit(), second.onModuleInit()]);
    const versions = await first.read(tx => tx`SELECT version FROM schema_migrations ORDER BY version`);
    assert.deepEqual(versions.map(row => row.version), Array.from({ length: 28 }, (_, index) => index + 1));
    const [ledger] = await first.read(tx => tx.unsafe(`SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey) WHERE i.indisprimary AND c.oid='schema_migrations'::regclass`));
    assert.equal(ledger.attname, 'id');
  } finally {
    await first.onModuleDestroy();
    await second.onModuleDestroy();
    await fixture.close();
  }
});

test('la migración 27 convierte un esquema anterior con datos: añade id UUID v7 y conserva filas y claves naturales', async () => {
  const fixture = await createTestSchema();
  let db = new DatabaseService();
  let legacy;
  try {
    await db.onModuleInit();
    const [edificio] = await db.read(tx => tx`SELECT id FROM buildings ORDER BY id LIMIT 1`);
    const plan = uuidv7(), cliente = uuidv7(), router = uuidv7(), usuario = uuidv7();
    const ahora = new Date().toISOString();
    legacy = fixture.connect();
    await legacy`INSERT INTO plans(id,name,down,up,price,building_id) VALUES (${plan},'Anterior',10,5,100,${edificio.id})`;
    await legacy`INSERT INTO customers(id,apartment,name,phone,plan_id,ip,building_id,access_token,access_token_hash,access_issued_at,access_expires_at,access_version) VALUES (${cliente},'901','Anterior','',${plan},NULL,${edificio.id},NULL,NULL,${ahora},NULL,1)`;
    await legacy`INSERT INTO routers(id,name,adapter,host,port,protocol,diagnostic_host,credentials,building_id,status) VALUES (${router},'Anterior','mikrotik-rest','192.168.77.1',443,'https',NULL,'sealed',${edificio.id},'untested')`;
    await legacy`INSERT INTO users(id,username,password_hash,role,created_at) VALUES (${usuario},'anterior@test','x','admin',${ahora})`;
    await legacy`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},'anterior:a','1'),(${uuidv7()},'anterior:b','2')`;
    await legacy`INSERT INTO task_locks(id,name,token,expires_at) VALUES (${uuidv7()},'anterior','token',${ahora})`;
    await legacy`INSERT INTO login_attempts(id,key,attempts,resets_at) VALUES (${uuidv7()},'127.0.0.9',3,${ahora})`;
    await legacy`INSERT INTO sessions(id,token_hash,user_id,created_at,expires_at) VALUES (${uuidv7()},'hash-anterior',${usuario},${ahora},${ahora})`;
    await legacy`INSERT INTO user_buildings(id,user_id,building_id) VALUES (${uuidv7()},${usuario},${edificio.id})`;
    await legacy`INSERT INTO customer_devices(id,router_id,mac,customer_id,created_at) VALUES (${uuidv7()},${router},'AA:BB:CC:DD:EE:99',${cliente},${ahora})`;
    await legacy`INSERT INTO customer_network_targets(id,router_id,ip,customer_id) VALUES (${uuidv7()},${router},'192.168.77.10',${cliente})`;
    await legacy`INSERT INTO customer_network_dirty(id,customer_id) VALUES (${uuidv7()},${cliente})`;
    await legacy`INSERT INTO usage_cursors(id,router_id,customer_id,queue_name,queue_id,download_bytes,upload_bytes,observed_at,missing) VALUES (${uuidv7()},${router},${cliente},'nuwenet-department-anterior','*1',10,20,${ahora},0)`;
    await legacy`INSERT INTO usage_daily(id,customer_id,day,download_bytes,upload_bytes,samples,resets,gaps,estimated_bytes) VALUES (${uuidv7()},${cliente},'2026-09-10',100,50,1,0,0,0)`;
    // Volumen moderado: comprueba que el backfill por ctid cubre varias páginas.
    await legacy.unsafe("INSERT INTO usage_daily(id,customer_id,day,download_bytes,upload_bytes,samples,resets,gaps,estimated_bytes) SELECT gen_random_uuid(), '" + cliente + "', 'volumen-'||lpad(d::text,4,'0'), 10, 5, 1, 0, 0, 0 FROM generate_series(1,500) d");
    await legacy`INSERT INTO usage_router_state(id,router_id,last_attempt,last_success,status) VALUES (${uuidv7()},${router},${ahora},${ahora},'ok')`;
    await legacy`INSERT INTO building_networks(id,building_id,revision,design,updated_at) VALUES (${uuidv7()},${edificio.id},3,'{"nodes":[],"links":[],"services":[]}',${ahora})`;
    // Vuelve a la forma previa a la 27: sin id, clave natural primaria y la tabla de migraciones con version como clave.
    await legacy.unsafe('ALTER TABLE building_networks DROP CONSTRAINT building_networks_building_id_key');
    for (const [tabla, clave] of tablasDeClaveNatural) {
      await legacy.unsafe(`ALTER TABLE ${tabla} DROP COLUMN id`);
      await legacy.unsafe(`ALTER TABLE ${tabla} ADD PRIMARY KEY (${clave})`);
    }
    await legacy.unsafe('ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_version_key');
    await legacy.unsafe('ALTER TABLE schema_migrations DROP COLUMN id');
    await legacy.unsafe('ALTER TABLE schema_migrations ADD PRIMARY KEY (version)');
    await legacy.unsafe('DELETE FROM schema_migrations WHERE version=27');
    await legacy.close();
    legacy = null;
    await db.onModuleDestroy();
    db = null;
    const reiniciado = new DatabaseService();
    db = reiniciado;
    await reiniciado.onModuleInit();
    for (const [tabla] of tablasDeClaveNatural) {
      const [clave] = await reiniciado.read(tx => tx.unsafe(`SELECT a.attname, t.typname FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey) JOIN pg_type t ON t.oid=a.atttypid WHERE i.indisprimary AND c.oid='${tabla}'::regclass`));
      assert.equal(clave.attname, 'id', `${tabla} queda con id como clave primaria`);
      assert.equal(clave.typname, 'uuid', `${tabla}.id es uuid`);
      const [filas] = await reiniciado.read(tx => tx.unsafe(`SELECT COUNT(*) total, COUNT(id) con_id, COALESCE(SUM((substring(id::text,15,1)='7')::int),0) v7 FROM ${tabla}`));
      assert.equal(Number(filas.con_id), Number(filas.total), `${tabla} conserva sus filas con id`);
      assert.equal(Number(filas.v7), Number(filas.total), `${tabla} recibe ids UUID v7`);
    }
    const [ajuste] = await reiniciado.read(tx => tx`SELECT value FROM settings WHERE key='anterior:a'`);
    assert.equal(ajuste.value, '1');
    await assert.rejects(reiniciado.write(tx => tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},'anterior:a','duplicado')`), /unique|duplic|única/i);
    const [dueno] = await reiniciado.read(tx => tx`SELECT id FROM plans WHERE name='Anterior'`);
    assert.equal(dueno.id, plan);
    const versiones = await reiniciado.read(tx => tx`SELECT version FROM schema_migrations ORDER BY version`);
    assert.deepEqual(versiones.map(row => row.version), Array.from({ length: 28 }, (_, index) => index + 1));
  } finally {
    await legacy?.close();
    await db?.onModuleDestroy();
    await fixture.close();
  }
});

test('la migración 28 retira las tablas heredadas conservando sus filas en retired_rows', async () => {
  const fixture = await createTestSchema();
  let db = new DatabaseService();
  let legacy;
  const heredadas = ['payment_reports', 'reminder_deliveries', 'notifications', 'whatsapp_receipts'];
  try {
    await db.onModuleInit();
    const [edificio] = await db.read(tx => tx`SELECT id FROM buildings ORDER BY id LIMIT 1`);
    const plan = uuidv7(), cliente = uuidv7(), cuota = uuidv7();
    const ahora = new Date().toISOString();
    legacy = fixture.connect();
    await legacy`INSERT INTO plans(id,name,down,up,price,building_id) VALUES (${plan},'Heredado 28',10,5,100,${edificio.id})`;
    await legacy`INSERT INTO customers(id,apartment,name,phone,plan_id,building_id) VALUES (${cliente},'28-01','Vecino 28','',${plan},${edificio.id})`;
    await legacy`INSERT INTO invoices(id,customer_id,period,due,amount) VALUES (${cuota},${cliente},'2026-08','2026-08-10',100)`;
    // Tablas heredadas tal como quedan tras las migraciones 26 y 27.
    await legacy.unsafe('CREATE TABLE payment_reports(id UUID PRIMARY KEY, customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE, amount INTEGER NOT NULL, reference TEXT NOT NULL DEFAULT \'\', notes TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL DEFAULT \'pending\', created_at TEXT NOT NULL)');
    await legacy`INSERT INTO payment_reports(id,customer_id,amount,reference,created_at) VALUES (${uuidv7()},${cliente},100,'ref-28',${ahora})`;
    await legacy.unsafe('CREATE TABLE reminder_deliveries(id UUID PRIMARY KEY, invoice_id UUID NOT NULL REFERENCES invoices(id), day TEXT NOT NULL, UNIQUE(invoice_id,day))');
    await legacy`INSERT INTO reminder_deliveries(id,invoice_id,day) VALUES (${uuidv7()},${cuota},'2026-08-11')`;
    await legacy.unsafe('CREATE TABLE notifications(id UUID PRIMARY KEY, created_at TEXT NOT NULL, channel TEXT NOT NULL DEFAULT \'log\', target TEXT NOT NULL DEFAULT \'\', message TEXT NOT NULL)');
    await legacy`INSERT INTO notifications(id,created_at,message) VALUES (${uuidv7()},${ahora},'aviso 28')`;
    // whatsapp_receipts nunca tuvo id: retirarla no debe darlo por supuesto.
    await legacy.unsafe('CREATE TABLE whatsapp_receipts(provider_id TEXT PRIMARY KEY, state TEXT NOT NULL, event_at TEXT NOT NULL, received_at TEXT NOT NULL)');
    await legacy`INSERT INTO whatsapp_receipts(provider_id,state,event_at,received_at) VALUES ('wamid-28','delivered',${ahora},${ahora})`;
    // Vuelve al estado previo a la 28 y rearranca.
    await legacy.unsafe('DROP TABLE retired_rows');
    await legacy.unsafe('DELETE FROM schema_migrations WHERE version=28');
    await legacy.close();
    legacy = null;
    await db.onModuleDestroy();
    db = new DatabaseService();
    await db.onModuleInit();

    const restantes = await db.read(tx => tx.unsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('${heredadas.join("','")}')`));
    assert.deepEqual(restantes, [], 'las tablas heredadas se retiran');
    const archivo = await db.read(tx => tx`SELECT table_name, row_data FROM retired_rows ORDER BY table_name`);
    assert.deepEqual(archivo.map(fila => fila.table_name), [...heredadas].sort());
    const dato = (tabla) => archivo.find(fila => fila.table_name === tabla).row_data;
    assert.equal(dato('payment_reports').reference, 'ref-28');
    assert.equal(dato('reminder_deliveries').day, '2026-08-11');
    assert.equal(dato('notifications').message, 'aviso 28');
    assert.equal(dato('whatsapp_receipts').provider_id, 'wamid-28');
    // La tabla de archivo también cumple la regla de identificadores del sistema.
    const [archivoIds] = await db.read(tx => tx`SELECT COUNT(*)::int total, COUNT(id)::int con_id, COALESCE(SUM((substring(id::text,15,1)='7')::int),0)::int v7 FROM retired_rows`);
    assert.deepEqual(archivoIds, { total: 4, con_id: 4, v7: 4 });
    // Un segundo arranque no vuelve a archivar ni intenta borrar lo ya borrado.
    await db.onModuleDestroy();
    db = new DatabaseService();
    await db.onModuleInit();
    assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM retired_rows`))[0].total, 4);
    assert.deepEqual((await db.read(tx => tx`SELECT version FROM schema_migrations ORDER BY version`)).map(fila => fila.version), Array.from({ length: 28 }, (_, index) => index + 1));
  } finally {
    await legacy?.close();
    await db?.onModuleDestroy();
    await fixture.close();
  }
});

test('dos instancias retiran las tablas heredadas a la vez sin duplicar el archivo', async () => {
  const fixture = await createTestSchema();
  let db = new DatabaseService();
  let first, second;
  try {
    await db.onModuleInit();
    const ahora = new Date().toISOString();
    const legacy = fixture.connect();
    await legacy.unsafe('CREATE TABLE notifications(id UUID PRIMARY KEY, created_at TEXT NOT NULL, message TEXT NOT NULL)');
    await legacy`INSERT INTO notifications(id,created_at,message) VALUES (${uuidv7()},${ahora},'uno'),(${uuidv7()},${ahora},'dos')`;
    await legacy.unsafe('CREATE TABLE whatsapp_receipts(provider_id TEXT PRIMARY KEY, state TEXT NOT NULL, event_at TEXT NOT NULL, received_at TEXT NOT NULL)');
    await legacy`INSERT INTO whatsapp_receipts(provider_id,state,event_at,received_at) VALUES ('wamid-a','sent',${ahora},${ahora}),('wamid-b','read',${ahora},${ahora})`;
    // Vuelve al estado previo a la 28 y arranca dos instancias a la vez.
    await legacy.unsafe('DROP TABLE retired_rows');
    await legacy.unsafe('DELETE FROM schema_migrations WHERE version=28');
    await legacy.close();
    await db.onModuleDestroy();
    db = null;
    first = new DatabaseService();
    second = new DatabaseService();
    await Promise.all([first.onModuleInit(), second.onModuleInit()]);
    assert.equal((await first.read(tx => tx`SELECT COUNT(*)::int total FROM retired_rows`))[0].total, 4, 'cada fila heredada se archiva una sola vez');
    const restantes = await second.read(tx => tx.unsafe(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('notifications','whatsapp_receipts')`));
    assert.deepEqual(restantes, []);
    const [ledger] = await first.read(tx => tx`SELECT COUNT(*)::int total, COUNT(DISTINCT version)::int distintas FROM schema_migrations`);
    assert.deepEqual(ledger, { total: 28, distintas: 28 });
  } finally {
    await first?.onModuleDestroy();
    await second?.onModuleDestroy();
    await db?.onModuleDestroy();
    await fixture.close();
  }
});
