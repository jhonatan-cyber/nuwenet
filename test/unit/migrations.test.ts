import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { MIGRATIONS } from '../../apps/api/dist/database/migrations/index.js';
import { applyMigrations, validateMigrations } from '../../apps/api/dist/database/migrations/ledger.js';

const migracion = version => ({ version, name: `Migración ${version}`, up: () => {} });

// Base falsa con el contrato mínimo que usa el ledger: `SELECT 1` responde si la
// versión ya está marcada y el INSERT de la marca la recuerda.
function fakeDatabase() {
  const aplicadas = new Set();
  const tx = async (strings, ...values) => {
    const sql = strings.join(' ');
    if (sql.includes('SELECT 1 FROM schema_migrations')) return aplicadas.has(Number(values[0])) ? [{}] : [];
    if (sql.includes('INSERT INTO schema_migrations')) aplicadas.add(Number(values[1]));
    return [];
  };
  const db = { write: async body => body(tx) };
  return { db: db as unknown as Parameters<typeof applyMigrations>[0], aplicadas };
}

test('el registro aplica las migraciones en orden numérico', () => {
  const versiones = MIGRATIONS.map(migration => migration.version);
  assert.deepEqual(versiones, Array.from({ length: MIGRATIONS.length }, (_, index) => index + 1), 'de la 1 a la última, sin huecos ni repetidas');
  assert.equal(new Set(versiones).size, versiones.length);
});

test('validateMigrations ordena por versión aunque los módulos vengan en otro orden', () => {
  const orden = validateMigrations([
    { source: 'migrations/legacy-tables.ts', migrations: [migracion(3)] },
    { source: 'migrations/schema.ts', migrations: [migracion(1), migracion(2)] },
  ]);
  assert.deepEqual(orden.map(migration => migration.version), [1, 2, 3]);
  assert.deepEqual(validateMigrations([{ source: 'migrations/identifiers.ts', migrations: [] }]), []);
});

test('validateMigrations rechaza una migración fuera de secuencia, repetida o con huecos', () => {
  assert.throws(() => validateMigrations([{ source: 'migrations/schema.ts', migrations: [migracion(2), migracion(1)] }]), /fuera de secuencia/);
  assert.throws(() => validateMigrations([{ source: 'migrations/schema.ts', migrations: [migracion(1)] }, { source: 'migrations/identifiers.ts', migrations: [migracion(1)] }]), /dos veces/);
  assert.throws(() => validateMigrations([{ source: 'migrations/schema.ts', migrations: [migracion(1), migracion(3)] }]), /no es continuo/);
});

test('applyMigrations aplica en el orden del registro y una sola vez', async () => {
  const { db, aplicadas } = fakeDatabase();
  const ejecutadas = [];
  const conRegistro = version => ({ ...migracion(version), up: () => { ejecutadas.push(version); } });
  const listas = [1, 2, 3].map(conRegistro);
  await applyMigrations(db, listas);
  assert.deepEqual(ejecutadas, [1, 2, 3]);
  assert.deepEqual([...aplicadas], [1, 2, 3]);
  await applyMigrations(db, listas);
  assert.deepEqual(ejecutadas, [1, 2, 3], 'una versión marcada no vuelve a correr');
  await applyMigrations(db, [...listas, conRegistro(4)]);
  assert.deepEqual(ejecutadas, [1, 2, 3, 4], 'la siguiente corre después de las anteriores');
});
