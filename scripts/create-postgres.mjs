import { SQL } from 'bun';

const name = process.env.PGDATABASE || 'nuwenet';
if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('PGDATABASE debe ser un identificador simple en minúsculas.');
const sql = new SQL({
  adapter: 'postgres', hostname: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432), database: 'postgres',
  username: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE || 'disable', connectionTimeout: 10,
});
try {
  const existing = await sql`SELECT datname FROM pg_database WHERE datname=${name}`;
  if (existing.length) console.log('La base configurada ya existe; no se modifica.');
  else {
    await sql.unsafe(`CREATE DATABASE "${name}"`);
    console.log('Base PostgreSQL creada. Las tablas se preparan al iniciar NestJS.');
  }
} catch (error) {
  console.error('No se pudo preparar PostgreSQL. Verifica host, puerto, credenciales y permisos. Código:', error.code || 'desconocido');
  process.exitCode = 1;
} finally { await sql.close(); }
