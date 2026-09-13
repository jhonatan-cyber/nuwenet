import { randomUUID, randomBytes } from 'node:crypto';
import { connectPostgres } from '../apps/api/dist/database/postgres-config.js';

// Each fixture owns only a temporary schema inside nuwenet.
export async function createTestSchema() {
  const schema = `nuwenet_test_${randomUUID().replaceAll('-', '')}`;
  const env = { DB_DRIVER: 'postgres', PGDATABASE: 'nuwenet', PGSCHEMA: schema, ROUTER_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  for (const key of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PG_DUMP_PATH', 'PG_RESTORE_PATH']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (process.env.PGDATABASE && process.env.PGDATABASE !== 'nuwenet') throw new Error('Las pruebas requieren la base nuwenet.');
  const admin = connectPostgres(env);
  try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); }
  catch (error) { await admin.close(); throw error; }
  const keys = ['DB_DRIVER', 'PGDATABASE', 'PGSCHEMA', 'ROUTER_ENCRYPTION_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = env[key];
  let closed = false;
  return {
    env, schema,
    connect: () => connectPostgres(env),
    async close() {
      if (closed) return;
      try {
        if (!/^nuwenet_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Esquema temporal inesperado.');
        await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        closed = true;
        await admin.close();
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    },
  };
}
