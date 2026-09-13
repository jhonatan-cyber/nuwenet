import { SQL } from 'bun';

export function postgresSchema(env: NodeJS.ProcessEnv = process.env): string {
  const schema = env.PGSCHEMA || 'public';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('PGSCHEMA debe ser un identificador simple en minúsculas.');
  return schema;
}

export function connectPostgres(env: NodeJS.ProcessEnv = process.env): SQL {
  const url = env.DATABASE_URL;
  if (url && !/^postgres(?:ql)?:\/\//.test(url)) throw new Error('DATABASE_URL debe ser una conexión PostgreSQL.');
  const database = url ? decodeURIComponent(new URL(url).pathname.slice(1)) : env.PGDATABASE || 'nuwenet';
  if (database !== 'nuwenet') throw new Error('La única base de datos del sistema es nuwenet.');
  const ssl = env.PGSSLMODE || 'disable';
  if (!['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(ssl)) throw new Error('PGSSLMODE inválido.');
  // No public fallback: an absent test schema must never resolve application tables.
  const connection = { search_path: postgresSchema(env) };
  return url ? new SQL(url, { connectionTimeout: 10, max: 10, connection }) : new SQL({
    adapter: 'postgres', hostname: env.PGHOST || '127.0.0.1',
    port: Number(env.PGPORT || 5432), database,
    username: env.PGUSER || 'postgres', password: env.PGPASSWORD,
    ssl: ssl as 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full',
    connectionTimeout: 10, max: 10, connection,
  });
}
