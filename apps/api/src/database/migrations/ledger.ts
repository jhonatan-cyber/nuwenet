import type { DatabaseService } from '../database.service';
import type { TransactionSQL } from 'bun';
import { uuidv7 } from '../../common/uuid';
import { addUuidId } from './add-uuid-id';

// Dueño único de `schema_migrations` y del contrato de migración: toda versión
// comprueba su estado y la marca dentro del mismo bloqueo, así que dos instancias
// no pueden ejecutar un cuerpo dos veces. La marca es ON CONFLICT porque el
// arranque normal vuelve a comprobar la versión en cada inicio.
export const markVersion = (tx: TransactionSQL, version: number) =>
  tx`INSERT INTO schema_migrations(id,version) VALUES (${uuidv7()},${version}) ON CONFLICT(version) DO NOTHING`;

export const appliedTx = async (tx: TransactionSQL, version: number) =>
  (await tx`SELECT 1 FROM schema_migrations WHERE version=${version}`).length > 0;

// Una migración declarada como dato: se puede listar sin ejecutarla (CLI, informes).
export interface Migration {
  version: number;
  name: string;
  /** Cuerpo: corre una sola vez, dentro del bloqueo y de su propia transacción. */
  up: (db: DatabaseService, tx: TransactionSQL) => unknown;
}

// Una migración: su versión, su cuerpo y la marca, todo en la misma transacción.
// `up` puede abandonar antes de tiempo (p. ej. la 26 cuando el esquema ya es
// UUID): la versión se marca igual.
export async function once(db: DatabaseService, version: number, body: (tx: TransactionSQL) => unknown) {
  await db.write(async tx => {
    if (await appliedTx(tx, version)) return;
    await body(tx);
    await markVersion(tx, version);
  });
}

export async function applyMigrations(db: DatabaseService, migrations: Migration[]) {
  for (const migration of migrations) await once(db, migration.version, tx => migration.up(db, tx));
}

// Lectura sin efectos secundarios para informar del estado: devuelve null cuando
// el ledger todavía no existe (no lo crea).
export async function appliedVersions(db: DatabaseService): Promise<Set<number> | null> {
  return db.read(async tx => {
    const [ledger] = await tx`SELECT to_regclass('schema_migrations') AS name`;
    if (!ledger.name) return null;
    const rows = await tx<{ version: number }[]>`SELECT version FROM schema_migrations`;
    return new Set(rows.map(row => row.version));
  });
}

// El ledger existe antes que todo lo demás, y también sigue la regla de
// identificadores del sistema: en bases anteriores `version` era la clave
// primaria y aquí se converge a `id UUID` + `version` única.
export async function ensureLedger(db: DatabaseService) {
  await db.write(async tx => {
    // Only fixed, application-owned SQL fragments are interpolated here.
    await tx.unsafe('CREATE TABLE IF NOT EXISTS schema_migrations(id UUID PRIMARY KEY, version INTEGER NOT NULL UNIQUE)');
    await addUuidId(tx, db.schema, 'schema_migrations', ['version'], 'schema_migrations_version_key');
  });
}
