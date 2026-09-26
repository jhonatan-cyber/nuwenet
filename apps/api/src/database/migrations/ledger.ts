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

// Un grupo del registro: el archivo que declara las migraciones y sus entradas.
export interface MigrationGroup {
  source: string;
  migrations: Migration[];
}

// Une los módulos del registro, ordena por versión y lo comprueba antes de usarlo.
// El orden de aplicación es el numérico, nunca el del array: los módulos se agrupan
// por asunto (no por número) y una migración nueva se anexa al final del que la posee.
//
// Falla con el motivo cuando una versión se repite, cuando un archivo la declara
// fuera de secuencia o cuando la numeración deja huecos. Los tres casos significan lo
// mismo en una base ya migrada: hay una migración que nunca va a correr.
export function validateMigrations(groups: MigrationGroup[]): Migration[] {
  const declaradas = new Map<number, string>();
  const todas: Migration[] = [];
  for (const { source, migrations } of groups) {
    let anterior = 0;
    for (const migration of migrations) {
      if (migration.version <= anterior) throw new Error(`${source}: la migración ${migration.version} (${migration.name}) está fuera de secuencia; cada archivo se lee de menor a mayor y no admite versiones repetidas.`);
      anterior = migration.version;
      const dueno = declaradas.get(migration.version);
      if (dueno) throw new Error(`La migración ${migration.version} está declarada dos veces (${dueno} y ${source}).`);
      declaradas.set(migration.version, source);
      todas.push(migration);
    }
  }
  const ordenadas = [...todas].sort((a, b) => a.version - b.version);
  for (const [indice, migration] of ordenadas.entries()) {
    if (migration.version !== indice + 1) throw new Error(`El registro no es continuo: se esperaba la versión ${indice + 1} y viene la ${migration.version} (${migration.name}). Declara la que falta antes de añadir una nueva.`);
  }
  return ordenadas;
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
