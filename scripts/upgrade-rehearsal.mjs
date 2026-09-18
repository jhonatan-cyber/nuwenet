// Ensayo de actualización: crea un esquema de prueba con la base que producía el
// código anterior (ids enteros, con datos) y arranca encima el código actual, que
// debe convertir todo a UUID v7 sin perder filas ni relaciones.
//
// La base heredada se genera ejecutando la revisión indicada, no una copia a mano,
// así que refleja fielmente lo que hay en una VPS que aún no se actualizó.
//
// Uso: bun scripts/upgrade-rehearsal.mjs [revisión]   (por defecto: la última
// revisión anterior al registro de migraciones, que es la era de un solo archivo)
// Requiere la conexión PostgreSQL del .env y pg_dump/pg_restore sólo para el respaldo.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

// La era heredada es la anterior al registro de migraciones: allí `database.service.ts`
// contenía el esquema y se bastaba a sí mismo. Deducirla del historial evita que el
// ensayo apunte a HEAD, que deja de servir en cuanto este trabajo está commiteado.
const revisionHeredada = () => {
  const adiciones = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--', 'apps/api/src/database/migrations/index.ts'])
    .toString().trim().split('\n').filter(Boolean);
  return adiciones.length ? `${adiciones[adiciones.length - 1]}^` : 'HEAD';
};
const revision = process.argv[2] || revisionHeredada();
const schema = `nuwenet_upgrade_${randomUUID().replaceAll('-', '')}`;
const dist = path.resolve('apps/api/dist');
const problemas = [];
const comprobar = (condicion, detalle) => { if (!condicion) problemas.push(detalle); };

if (process.env.PGDATABASE && process.env.PGDATABASE !== 'nuwenet') throw new Error('El ensayo requiere la base nuwenet.');

process.env.DB_DRIVER = 'postgres';
process.env.PGDATABASE = 'nuwenet';
process.env.PGSCHEMA = schema;
process.env.ROUTER_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');

const { connectPostgres } = await import(pathToFileURL(path.join(dist, 'database/postgres-config.js')).href);
const admin = connectPostgres({ ...process.env, PGSCHEMA: 'public' });
// Conexión de lectura sobre el esquema de prueba: evita depender del search_path.
const lente = connectPostgres({ ...process.env });
// El archivo heredado se guarda dentro del proyecto: desde el directorio temporal
// no resuelve los módulos del proyecto (@nestjs/common, bun).
const directorio = path.join(path.resolve('node_modules/.cache'), `nuwenet-ensayo-${randomUUID()}`);
const { mkdirSync } = await import('node:fs');
mkdirSync(directorio, { recursive: true });
let heredado, actual;
const paso = (texto) => console.log(`· ${texto}`);

const consultar = (_etiqueta, sql) => lente.unsafe(sql).then(filas => filas.map(fila => Object.values(fila).join('|')));

try {
  paso(`esquema de prueba ${schema}`);
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);

  // 1. Base heredada: el código anterior crea su propio esquema entero.
  paso(`creando base heredada con ${revision}`);
  const fuente = execFileSync('git', ['show', `${revision}:apps/api/src/database/database.service.ts`]).toString()
    .replace("from './postgres-config'", `from '${pathToFileURL(path.join(dist, 'database/postgres-config.js')).href}'`);
  const archivo = path.join(directorio, 'legacy-database.service.ts');
  writeFileSync(archivo, fuente);
  const { DatabaseService: ServicioHeredado } = await import(pathToFileURL(archivo).href);
  heredado = new ServicioHeredado();
  await heredado.onModuleInit();
  const [{ data_type: tipoId }] = await heredado.read(tx => tx`SELECT data_type FROM information_schema.columns WHERE table_schema=${schema} AND table_name='plans' AND column_name='id'`);
  if (tipoId === 'uuid') throw new Error(`La revisión ${revision} ya usa UUID; indica una revisión anterior al cambio de identificadores.`);
  paso('cargando datos de la era entera');

  // 2. Datos de la era entera: departamento, router, cuota, pago, orden pendiente.
  const ahora = new Date().toISOString();
  await heredado.write(async tx => {
    const [edificio] = await tx`SELECT id FROM buildings ORDER BY id LIMIT 1`;
    const [plan] = await tx`INSERT INTO plans(name,down,up,price,building_id) VALUES ('Heredado',10,5,100,${edificio.id}) RETURNING id`;
    const [depto] = await tx`INSERT INTO customers(apartment,name,plan_id,building_id) VALUES ('H-101','Vecino heredado',${plan.id},${edificio.id}) RETURNING id`;
    const [router] = await tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials,building_id) VALUES ('Router heredado','mikrotik-rest','192.168.88.1',443,'https','heredado',${edificio.id}) RETURNING id`;
    const [usuario] = await tx`INSERT INTO users(username,password_hash,role,created_at) VALUES ('heredado@test','x','admin',${ahora}) RETURNING id`;
    const [cuota] = await tx`INSERT INTO invoices(customer_id,period,due,amount) VALUES (${depto.id},'2026-08','2026-08-10',10000) RETURNING id`;
    await tx`INSERT INTO payments(invoice_id,amount,created_at,method,reference,actor_id) VALUES (${cuota.id},10000,${ahora},'cash','',${usuario.id})`;
    await tx`INSERT INTO commands(customer_id,action,created_at,mode,status,payload) VALUES (${depto.id},'suspend',${ahora},'mikrotik','pending',${JSON.stringify({ routerId: router.id, customerId: depto.id, previous: { routerId: router.id } })})`;
    await tx`INSERT INTO router_checks(router_id,checked_at,success,message) VALUES (${router.id},${ahora},1,'ok')`;
    await tx`INSERT INTO audit_log(actor_id,username,action,created_at) VALUES (${usuario.id},'heredado@test','POST /api/heredado',${ahora})`;
    await tx`INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES ('hash-heredado',${usuario.id},${ahora},${ahora})`;
    await tx`INSERT INTO user_buildings(user_id,building_id) VALUES (${usuario.id},${edificio.id})`;
    await tx`INSERT INTO login_attempts(key,attempts,resets_at) VALUES ('127.0.0.5',2,${ahora})`;
    await tx`INSERT INTO settings(key,value) VALUES ('heredado','1')`;
    await tx`INSERT INTO task_locks(name,token,expires_at) VALUES ('heredado','t',${ahora})`;
    await tx`INSERT INTO reminder_deliveries(invoice_id,day) VALUES (${cuota.id},'2026-08-11')`;
    await tx`INSERT INTO notifications(created_at,message) VALUES (${ahora},'aviso heredado')`;
  });
  await heredado.onModuleDestroy();
  heredado = null;

  // 3. Actualización: el código actual arranca sobre esa base.
  paso('arrancando el código actual sobre la base heredada');
  const { DatabaseService } = await import(pathToFileURL(path.join(dist, 'database/database.service.js')).href);
  actual = new DatabaseService();
  await actual.onModuleInit();

  // 4. Invariantes: ningún id entero, todo v7 y las relaciones intactas.
  const enteros = await consultar('ids enteros', `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='${schema}' AND data_type IN ('integer','bigint','smallint') AND (column_name='id' OR column_name LIKE '%\\_id')`);
  comprobar(enteros.length === 0, `quedan columnas de id enteras: ${enteros.join(', ')}`);

  // Cada tabla debe quedar con id uuid v7 como clave primaria, sin excepciones.
  const tablas = await consultar('tablas', `SELECT table_name FROM information_schema.tables WHERE table_schema='${schema}' AND table_type='BASE TABLE' ORDER BY table_name`);
  for (const tabla of tablas) {
    try {
      const [clave] = await consultar(tabla, `SELECT string_agg(a.attname||':'||format_type(a.atttypid,NULL), ',' ORDER BY a.attname) FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='${tabla}'::regclass AND i.indisprimary`);
      comprobar(clave === 'id:uuid', `${tabla} no quedó con id uuid como clave primaria (${clave})`);
      const [malos] = await consultar(tabla, `SELECT count(*) FROM ${tabla} WHERE id IS NULL OR substring(id::text,15,1)<>'7'`);
      comprobar(malos === '0', `${tabla} conserva ${malos} ids que no son UUID v7 o nulos`);
    } catch (error) { problemas.push(`${tabla}: ${error.message}`); }
  }
  comprobar((await consultar('plan', `SELECT p.name FROM customers c JOIN plans p ON p.id=c.plan_id WHERE c.apartment='H-101'`))[0] === 'Heredado', 'la FK customers.plan_id no apunta al plan heredado');
  comprobar((await consultar('cuota', `SELECT c.apartment FROM invoices i JOIN customers c ON c.id=i.customer_id`))[0] === 'H-101', 'la FK invoices.customer_id no apunta al departamento heredado');
  comprobar((await consultar('pago', `SELECT u.username FROM payments p JOIN users u ON u.id=p.actor_id`))[0] === 'heredado@test', 'la FK payments.actor_id no apunta al usuario heredado');
  comprobar((await consultar('revision', `SELECT r.name FROM router_checks rc JOIN routers r ON r.id=rc.router_id`))[0] === 'Router heredado', 'la FK router_checks.router_id no apunta al router heredado');
  comprobar((await consultar('vinculo', `SELECT b.name FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id`))[0] === 'Mi edificio', 'la FK user_buildings.building_id no apunta al edificio heredado');
  // La 28 retira las tablas heredadas: sus filas deben quedar archivadas antes del DROP.
  const ausentes = await consultar('heredadas', `SELECT table_name FROM information_schema.tables WHERE table_schema='${schema}' AND table_name IN ('payment_reports','reminder_deliveries','notifications','whatsapp_receipts')`);
  comprobar(ausentes.length === 0, `no se retiraron las tablas heredadas: ${ausentes.join(', ')}`);
  comprobar((await consultar('recordatorio', `SELECT row_data->>'day' FROM retired_rows WHERE table_name='reminder_deliveries'`))[0] === '2026-08-11', 'el recordatorio heredado no quedó archivado antes de borrar su tabla');
  comprobar((await consultar('aviso', `SELECT row_data->>'message' FROM retired_rows WHERE table_name='notifications'`))[0] === 'aviso heredado', 'la notificación heredada no quedó archivada antes de borrar su tabla');
  const orden = await consultar('orden', `SELECT payload FROM commands WHERE action='suspend'`);
  const payload = JSON.parse(orden[0].split('|')[0]);
  const [routerId] = await consultar('router', `SELECT id FROM routers WHERE name='Router heredado'`);
  comprobar(payload.routerId === routerId && payload.previous?.routerId === routerId, 'el routerId de la orden pendiente no se remapeó al UUID del router');
  comprobar((await consultar('versiones', `SELECT count(*) FROM schema_migrations`))[0] === '28', 'el ledger no quedó en 28 versiones');

  // 5. Segundo arranque: la base ya convertida no debe volver a migrar ni romperse.
  await actual.onModuleDestroy();
  actual = new DatabaseService();
  await actual.onModuleInit();
  comprobar((await consultar('cuotas', `SELECT count(*) FROM invoices`))[0] === '1', 'el segundo arranque alteró las filas');

  console.log(problemas.length ? `Ensayo FALLIDO (${problemas.length}):\n- ${problemas.join('\n- ')}` : 'Ensayo de actualización correcto: ids enteros convertidos a UUID v7 con relaciones y payloads intactos.');
} finally {
  await heredado?.onModuleDestroy();
  await actual?.onModuleDestroy();
  await lente.close();
  await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.close();
  rmSync(directorio, { recursive: true, force: true });
}
if (problemas.length) process.exit(1);
