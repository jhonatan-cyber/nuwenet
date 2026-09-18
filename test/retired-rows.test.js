import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestSchema } from './postgres-fixture.js';
import { uuidv7 } from '../apps/api/dist/common/uuid.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { RetiredRowsService } from '../apps/api/dist/management/retired-rows.service.js';

const raiz = path.resolve(import.meta.dirname, '..');
const cuando = '2026-09-18T10:00:00.000Z';
const hostil = 'aviso "con comillas",\nsalto de línea';

// Deja el archivo con dos tablas: tres avisos (uno con comillas, coma y salto de
// línea) y un reporte de pago. Es el estado que la migración 28 produce.
async function archivar(sql) {
  await sql`INSERT INTO retired_rows(id,table_name,row_data,retired_at) VALUES (${uuidv7()},'notifications',${{
    id: 'n-1', created_at: cuando, channel: 'log', target: '', message: hostil,
  }},${cuando})`;
  await sql`INSERT INTO retired_rows(id,table_name,row_data,retired_at) VALUES (${uuidv7()},'notifications',${{
    id: 'n-2', created_at: cuando, channel: 'log', target: '70000000', message: 'sin caracteres raros',
  }},${cuando})`;
  await sql`INSERT INTO retired_rows(id,table_name,row_data,retired_at) VALUES (${uuidv7()},'notifications',${{
    id: 'n-3', created_at: cuando, channel: 'log', target: '', message: '',
  }},${cuando})`;
  await sql`INSERT INTO retired_rows(id,table_name,row_data,retired_at) VALUES (${uuidv7()},'payment_reports',${{
    id: 'p-1', customer_id: 'c-1', amount: 15000, reference: 'ref-1', notes: '', status: 'pending', created_at: cuando,
  }},${cuando})`;
}

test('el archivo heredado se consulta y se exporta sin escribir nada', async () => {
  const fixture = await createTestSchema();
  let db, sql;
  try {
    db = new DatabaseService();
    await db.onModuleInit();
    sql = fixture.connect();
    await archivar(sql);
    const archivo = new RetiredRowsService(db);

    const tablas = await archivo.tables();
    assert.deepEqual(tablas.map(t => [t.table_name, t.rows]), [['notifications', 3], ['payment_reports', 1]]);
    assert.equal(tablas[0].retired_from, cuando);

    const primera = await archivo.page('notifications', 2, 0);
    assert.equal(primera.total, 3);
    assert.equal(primera.limit, 2);
    assert.equal(primera.rows.length, 2);
    const segunda = await archivo.page('notifications', 2, 2);
    assert.equal(segunda.rows.length, 1);
    assert.equal(segunda.rows[0].row.id, 'n-3');
    const ids = new Set([...primera.rows, ...segunda.rows].map(fila => fila.id));
    assert.equal(ids.size, 3, 'las páginas no repiten filas');
    const porDefecto = await archivo.page('notifications');
    assert.equal(porDefecto.limit, 50, 'la consulta sin límite usa el de la API');

    await assert.rejects(archivo.page('inventada'), /No hay filas archivadas de "inventada"\. Tablas archivadas: notifications, payment_reports\./);
    await assert.rejects(archivo.page('Notification; DROP TABLE'), /Nombre de tabla inválido/);
    await assert.rejects(archivo.page('notifications', 5000), /limit debe estar entre 1 y 500/);

    const csv = await archivo.export('notifications', 'csv');
    assert.equal(csv.rows, 3, 'el CSV con un salto de línea dentro de una celda sigue contando 3 filas');
    assert.equal(csv.content.split('\r\n')[0], 'retirado_en,channel,created_at,id,message,target');
    assert.ok(csv.content.includes('"aviso ""con comillas"",\nsalto de línea"'), 'el CSV escapa comillas y comas según RFC 4180');
    assert.ok(csv.content.includes(`${cuando},log,${cuando},n-2,sin caracteres raros,70000000`), 'una fila sin caracteres especiales no se entrecomilla');
    assert.ok(csv.content.includes(`${cuando},log,${cuando},n-3,,`), 'los valores vacíos quedan vacíos');

    const ndjson = await archivo.export('notifications', 'json');
    assert.equal(ndjson.rows, 3);
    const lineas = ndjson.content.trimEnd().split('\n').map(linea => JSON.parse(linea));
    assert.equal(lineas.length, 3);
    assert.equal(lineas[0].table_name, 'notifications');
    assert.equal(lineas[0].retired_at, cuando);
    assert.equal(lineas[1].row.message, 'sin caracteres raros');
    assert.equal((await archivo.export('payment_reports', 'json')).rows, 1);

    // Solo lectura: nada cambió en el archivo ni en el ledger.
    assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM retired_rows`))[0].total, 4);
    assert.equal((await db.read(tx => tx`SELECT COUNT(*)::int total FROM schema_migrations`))[0].total, 28);
  } finally {
    await sql?.close();
    await db?.onModuleDestroy();
    await fixture.close();
  }
});

test('sin archivo (esquema anterior a la 28) el servicio avisa en vez de fallar', async () => {
  const fixture = await createTestSchema();
  let db, sql;
  try {
    db = new DatabaseService();
    await db.onModuleInit();
    sql = fixture.connect();
    await sql.unsafe('DROP TABLE retired_rows');
    const archivo = new RetiredRowsService(db);
    assert.deepEqual(await archivo.tables(), []);
    await assert.rejects(archivo.page('notifications'), /no tiene contenido archivado/);
    await assert.rejects(archivo.export('notifications'), /no tiene contenido archivado/);
  } finally {
    await sql?.close();
    await db?.onModuleDestroy();
    await fixture.close();
  }
});

test('db:archive lista, consulta y exporta a archivo por el CLI', async () => {
  const fixture = await createTestSchema();
  let db, sql;
  const directorio = mkdtempSync(path.join(tmpdir(), 'nuwenet-archivo-'));
  const cli = (...args) => spawnSync(process.execPath, ['scripts/database.mjs', 'archive', ...args], { cwd: raiz, env: process.env, encoding: 'utf8' });
  try {
    db = new DatabaseService();
    await db.onModuleInit();
    sql = fixture.connect();
    await archivar(sql);

    const inventario = cli();
    assert.equal(inventario.status, 0, inventario.stderr);
    assert.match(inventario.stdout, /notifications: 3 filas/);
    assert.match(inventario.stdout, /payment_reports: 1 filas/);

    const consulta = cli('notifications', '--limit', '1');
    assert.equal(consulta.status, 0, consulta.stderr);
    const pagina = JSON.parse(consulta.stdout);
    assert.equal(pagina.total, 3);
    assert.equal(pagina.rows.length, 1);

    const destino = path.join(directorio, 'avisos.csv');
    const exportado = cli('notifications', '--export', '--out', destino);
    assert.equal(exportado.status, 0, exportado.stderr);
    assert.match(exportado.stdout, /Exportadas 3 filas de "notifications"/);
    const contenido = readFileSync(destino, 'utf8');
    assert.equal(contenido.split('\r\n')[0], 'retirado_en,channel,created_at,id,message,target');

    const aPantalla = cli('payment_reports', '--export', '--format', 'json');
    assert.equal(aPantalla.status, 0, aPantalla.stderr);
    assert.equal(JSON.parse(aPantalla.stdout.trimEnd()).row.amount, 15000);

    const desconocida = cli('inventada');
    assert.equal(desconocida.status, 1);
    assert.match(desconocida.stderr, /No hay filas archivadas de "inventada"/);

    const sinExportar = cli('notifications', '--out', path.join(directorio, 'x.csv'));
    assert.equal(sinExportar.status, 1);
    assert.match(sinExportar.stderr, /--out requiere --export/);
  } finally {
    await sql?.close();
    await db?.onModuleDestroy();
    await fixture.close();
    rmSync(directorio, { recursive: true, force: true });
  }
});

test('el endpoint del archivo exige super-admin, pagina y descarga el CSV', async () => {
  const sonda = createServer();
  sonda.listen(0, '127.0.0.1');
  await once(sonda, 'listening');
  const port = sonda.address().port;
  await new Promise(resolve => sonda.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const fixture = await createTestSchema();
  const directorio = mkdtempSync(path.join(tmpdir(), 'nuwenet-archivo-http-'));
  let sql, cookie = '';
  const servidor = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...process.env, DB_DRIVER: 'postgres', DATA_DIR: directorio, BACKUP_DIR: path.join(directorio, 'backups'), HOST: '127.0.0.1', PORT: String(port), SETUP_TOKEN: '', NUWENET_PORTAL_IP: '', NUWENET_PUBLIC_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const api = async (ruta, body, status = 200) => {
    const response = await fetch(`${origin}/api/${ruta}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const cuerpo = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    assert.equal(response.status, status, JSON.stringify(cuerpo));
    return { cuerpo, response };
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('El servidor no inició')), 20000);
      servidor.once('error', reject);
      servidor.once('exit', code => { clearTimeout(timer); reject(new Error(`Salida ${code}`)); });
      servidor.stdout.on('data', chunk => { if (chunk.toString().includes('disponible')) { clearTimeout(timer); resolve(); } });
      servidor.stderr.resume();
    });
    sql = fixture.connect();
    await archivar(sql);

    await api('retired-rows', undefined, 401);
    await api('auth/setup', { username: 'dueno-archivo', password: 'fixture-password' });
    await api('auth/login', { username: 'dueno-archivo', password: 'fixture-password' });
    const inventario = await api('retired-rows');
    assert.deepEqual(inventario.cuerpo.map(t => [t.table_name, t.rows]), [['notifications', 3], ['payment_reports', 1]]);

    const pagina = await api('retired-rows/notifications?limit=1');
    assert.equal(pagina.cuerpo.total, 3);
    assert.equal(pagina.cuerpo.rows.length, 1);

    const descarga = await api('retired-rows/notifications/export?format=csv');
    assert.match(descarga.response.headers.get('content-type'), /^text\/csv/);
    assert.match(descarga.response.headers.get('content-disposition'), /^attachment; filename="archivo-notifications-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(descarga.response.headers.get('x-archived-rows'), '3');
    assert.equal(descarga.cuerpo.split('\r\n')[0], 'retirado_en,channel,created_at,id,message,target');
    assert.ok(descarga.cuerpo.includes('"aviso ""con comillas"",\nsalto de línea"'));

    await api('retired-rows/inventada', undefined, 400);
    await api('retired-rows/notifications?limit=5000', undefined, 400);
  } finally {
    await sql?.close();
    servidor.kill();
    await fixture.close();
    rmSync(directorio, { recursive: true, force: true });
  }
});
