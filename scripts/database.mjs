// CLI de base de datos: no arranca la API.
//
//   bun run db:status          lista cada versión del registro y si está aplicada (sin efectos)
//   bun run db:migrate         aplica lo pendiente con el mismo código que usa el arranque
//   bun run db:archive         inventario de las tablas heredadas archivadas
//   bun run db:archive <tabla> consulta paginada (--limit, --offset) del archivo
//   bun run db:archive <tabla> --export [--format csv|json] [--out archivo]
//
// Usa la conexión del .env (PGDATABASE/PGHOST/PGPASSWORD/PGSCHEMA) y el build de la
// API en apps/api/dist, como los demás scripts de `scripts/`.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve('apps/api/dist');
if (!existsSync(path.join(dist, 'database', 'migrations', 'index.js'))) {
  console.error('Falta el build de la API: ejecuta "bun run build" y vuelve a intentarlo.');
  process.exit(1);
}
const { DatabaseService } = await import(pathToFileURL(path.join(dist, 'database', 'database.service.js')).href);
const { MIGRATIONS, BOOTSTRAP_STEPS, runMigrations } = await import(pathToFileURL(path.join(dist, 'database', 'migrations', 'index.js')).href);
const { appliedVersions } = await import(pathToFileURL(path.join(dist, 'database', 'migrations', 'ledger.js')).href);

const comando = process.argv[2];
const db = new DatabaseService();
const destino = `${db.driver} ${process.env.PGDATABASE || 'nuwenet'}.${db.schema}`;
const linea = (marca, migracion) => `  ${marca} ${String(migracion.version).padStart(2, '0')}  ${migracion.name}`;
const pasosDeArranque = () => {
  for (const paso of BOOTSTRAP_STEPS) console.log(`   *  ${paso.name} (en cada arranque, sin versión)`);
};

async function status() {
  const aplicadas = await appliedVersions(db);
  console.log(`Migraciones en ${destino}`);
  if (!aplicadas) {
    console.log('  El ledger no existe todavía: no hay ninguna versión aplicada.');
    for (const migracion of MIGRATIONS) console.log(linea('·', migracion));
  } else {
    for (const migracion of MIGRATIONS) console.log(linea(aplicadas.has(migracion.version) ? '✓' : '·', migracion));
    const conocidas = new Set(MIGRATIONS.map(migracion => migracion.version));
    const ajenas = [...aplicadas].filter(version => !conocidas.has(version)).sort((a, b) => a - b);
    if (ajenas.length) console.log(`  Versiones en el ledger que este código no reconoce: ${ajenas.join(', ')}.`);
    const pendientes = MIGRATIONS.filter(migracion => !aplicadas.has(migracion.version));
    console.log(pendientes.length
      ? `  Pendientes: ${pendientes.map(migracion => migracion.version).join(', ')}. Ejecuta "bun run db:migrate".`
      : `  Al día: las ${MIGRATIONS.length} migraciones del registro están aplicadas.`);
  }
  pasosDeArranque();
}

async function migrate() {
  const antes = await appliedVersions(db);
  console.log(`Aplicando migraciones en ${destino}`);
  await runMigrations(db);
  const despues = await appliedVersions(db);
  const nuevas = MIGRATIONS.filter(migracion => !antes?.has(migracion.version) && despues?.has(migracion.version));
  if (!antes) console.log('  El ledger no existía: se creó con el historial completo.');
  console.log(nuevas.length
    ? `  Aplicadas: ${nuevas.map(migracion => migracion.version).join(', ')}.`
    : '  Nada pendiente.');
  pasosDeArranque();
}

// Consulta y exportación del archivo de la migración 28 (retired_rows). Reutiliza
// el mismo servicio que el endpoint de la API: mismo formato y mismos mensajes.
function leerOpciones(args) {
  const opciones = { exportar: false, format: 'csv', out: undefined, limit: undefined, offset: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--export') opciones.exportar = true;
    else if (arg === '--out') opciones.out = args[++i];
    else if (arg === '--format') opciones.format = args[++i];
    else if (arg === '--limit') opciones.limit = Number(args[++i]);
    else if (arg === '--offset') opciones.offset = Number(args[++i]);
    else throw new Error(`Opción no reconocida: ${arg}`);
  }
  if (!['csv', 'json'].includes(opciones.format)) throw new Error('--format admite csv o json.');
  if (opciones.out && !opciones.exportar) throw new Error('--out requiere --export.');
  return opciones;
}

async function archive(args) {
  const { RetiredRowsService } = await import(pathToFileURL(path.join(dist, 'management', 'retired-rows.service.js')).href);
  const archived = new RetiredRowsService(db);
  const [tabla, ...resto] = args;
  const opciones = leerOpciones(resto);
  if (!tabla) {
    const tablas = await archived.tables();
    console.log(`Archivo de tablas heredadas en ${destino}`);
    if (!tablas.length) console.log('  Vacío: la migración 28 todavía no retiró ninguna tabla.');
    for (const entrada of tablas) console.log(`  ${entrada.table_name}: ${entrada.rows} filas, retiradas entre ${entrada.retired_from} y ${entrada.retired_to}`);
    if (tablas.length) console.log('  Consulta: bun run db:archive <tabla>   Exporta: bun run db:archive <tabla> --export [--out archivo.csv]');
    return;
  }
  if (opciones.exportar) {
    const { rows, content } = await archived.export(tabla, opciones.format);
    if (opciones.out) {
      writeFileSync(opciones.out, content);
      console.log(`Exportadas ${rows} filas de "${tabla}" a ${opciones.out} (${opciones.format}).`);
    } else {
      process.stdout.write(content);
    }
    return;
  }
  console.log(JSON.stringify(await archived.page(tabla, opciones.limit, opciones.offset), null, 2));
}

try {
  if (comando === 'status') await status();
  else if (comando === 'migrate') await migrate();
  else if (comando === 'archive') await archive(process.argv.slice(3));
  else {
    console.error('Uso: bun scripts/database.mjs status|migrate|archive   (o bun run db:status / db:migrate / db:archive)');
    process.exitCode = 1;
  }
} catch (error) {
  console.error((error instanceof Error ? error.message : String(error)) || 'La operación falló.');
  process.exitCode = 1;
} finally {
  await db.onModuleDestroy();
}
