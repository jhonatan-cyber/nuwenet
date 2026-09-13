import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTestSchema } from './postgres-fixture.js';
import { connectPostgres } from '../apps/api/dist/database/postgres-config.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';

test('pruebas aisladas en esquemas de nuwenet, sin crear bases ni resolver tablas de public', async () => {
  const observer = connectPostgres({ ...process.env, PGSCHEMA: 'public' });
  const before = await observer`SELECT datname FROM pg_database ORDER BY datname`;
  let first, second, a, b, empty;
  try {
    first = await createTestSchema();
    a = new DatabaseService();
    await a.onModuleInit();
    await a.write(tx => tx`INSERT INTO plans(name,down,up,price) VALUES ('Solo primero',10,5,100)`);
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
