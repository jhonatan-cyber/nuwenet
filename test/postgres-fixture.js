import { SQL } from 'bun';
import { randomUUID, randomBytes } from 'node:crypto';

// Each fixture owns a newly created database; never reset the configured application database.
export async function createTestDatabase() {
  const name = `nuwenet_test_${randomUUID().replaceAll('-', '')}`;
  const options = {
    adapter: 'postgres', hostname: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432), username: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD, ssl: process.env.PGSSLMODE || 'disable', connectionTimeout: 10,
  };
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url) url.pathname = '/postgres';
  const admin = url ? new SQL(url.toString()) : new SQL({ ...options, database: 'postgres' });
  try { await admin.unsafe(`CREATE DATABASE "${name}"`); }
  catch (error) { await admin.close(); throw error; }
  if (url) url.pathname = `/${name}`;
  const env = { DB_DRIVER: 'postgres', PGDATABASE: name, DATABASE_URL: url?.toString() || '', ROUTER_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PG_DUMP_PATH', 'PG_RESTORE_PATH']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  return {
    env,
    connect: () => url ? new SQL(url.toString()) : new SQL({ ...options, database: name }),
    async close() {
      try {
        if (!/^nuwenet_test_[a-f0-9]{32}$/.test(name)) throw new Error('Base temporal inesperada.');
        await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      } finally {
        await admin.close();
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    },
  };
}
