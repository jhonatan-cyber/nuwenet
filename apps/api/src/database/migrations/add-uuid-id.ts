import type { TransactionSQL } from 'bun';
import { uuidv7 } from '../../common/uuid';

// Dueño único de "cómo una tabla existente recibe su id UUID v7": numera las filas,
// deja el id como clave primaria y conserva la clave anterior como UNIQUE.
// Idempotente (si el id ya existe solo revisa la clave única) y tolerante con
// tablas ausentes, porque lo comparten el ledger y las migraciones 26 y 27.
export async function addUuidId(tx: TransactionSQL, schema: string, table: string, natural: string[], uniqueName: string) {
  const columns = await tx.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='${table}'`) as unknown as { column_name: string }[];
  // La tabla puede no existir en este esquema (pertenece a una versión anterior).
  if (!columns.length) return;
  if (!columns.some(column => column.column_name === 'id')) {
    await tx.unsafe(`ALTER TABLE ${table} ADD COLUMN id UUID`);
    const rows = await tx.unsafe(`SELECT ctid FROM ${table}`) as unknown as { ctid: string }[];
    for (const row of rows) await tx.unsafe(`UPDATE ${table} SET id='${uuidv7()}' WHERE ctid='${row.ctid}'`);
    await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN id SET NOT NULL`);
    const keys = await tx.unsafe(`SELECT conname FROM pg_constraint WHERE conrelid='${table}'::regclass AND contype='p'`) as unknown as { conname: string }[];
    for (const key of keys) await tx.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT ${key.conname}`);
    await tx.unsafe(`ALTER TABLE ${table} ADD PRIMARY KEY (id)`);
  } else {
    // El id puede existir sin ser la clave primaria: building_networks nació con
    // id y la migración 26 le devolvió la clave natural. Se converge a PK(id).
    const [clave] = await tx.unsafe(`SELECT array_agg(a.attname ORDER BY a.attname)::text[] AS cols FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='${table}'::regclass AND i.indisprimary`) as unknown as { cols: string[] | null }[];
    if (clave.cols?.length !== 1 || clave.cols[0] !== 'id') {
      const vigentes = await tx.unsafe(`SELECT conname FROM pg_constraint WHERE conrelid='${table}'::regclass AND contype='p'`) as unknown as { conname: string }[];
      for (const c of vigentes) await tx.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT ${c.conname}`);
      await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN id SET NOT NULL`);
      await tx.unsafe(`ALTER TABLE ${table} ADD PRIMARY KEY (id)`);
    }
  }
  // No duplica la clave única si la tabla ya la tiene (p. ej. UNIQUE en la
  // definición original): compara el conjunto de columnas, no el nombre.
  const sorted = [...natural].sort();
  const [duplicate] = await tx.unsafe(`SELECT 1 FROM pg_constraint c WHERE c.conrelid='${table}'::regclass AND c.contype='u' AND (SELECT array_agg(a.attname ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey))='{${sorted.join(',')}}'::name[]`) as unknown as unknown[];
  if (!duplicate) await tx.unsafe(`ALTER TABLE ${table} ADD CONSTRAINT ${uniqueName} UNIQUE (${natural.join(',')})`);
}
