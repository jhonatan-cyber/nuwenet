import type { DatabaseService } from '../database.service';
import { applyMigrations, ensureLedger, validateMigrations } from './ledger';
import type { Migration } from './ledger';
import { repairAccessHashes, schemaMigrations, seedReceiptKey } from './schema';
import { identifierMigrations } from './identifiers';
import { legacyMigrations } from './legacy-tables';

// Estructura de la capa de datos (dueño de cada pieza):
//
//   database.service.ts   conexión, transacciones y bloqueos. Nada de esquema.
//   migrations/index.ts   este registro. MIGRATIONS es el orden real de aplicación.
//   migrations/ledger.ts  `schema_migrations`, el contrato `once`, la validación del
//                         registro y la lectura sin efectos que usa el CLI.
//   migrations/add-uuid-id.ts  cómo una tabla existente recibe su id UUID v7.
//   migrations/schema.ts  migraciones 1–25 y 29–31, más los dos pasos de cada arranque.
//   migrations/identifiers.ts  migraciones 26–27: todo id pasa a UUID v7.
//   migrations/legacy-tables.ts  migración 28 y la lista única de tablas heredadas.
//
// Añadir una migración: un módulo por asunto (no por número), una entrada más con
// `version`, `name` y `up` al final del array del módulo que la posee, y `db:status`
// la muestra sola.
//
// El orden de aplicación es el numérico, no el del array: `validateMigrations` une los
// módulos, ordena por versión y exige que no haya versiones repetidas, huecos ni
// entradas fuera de secuencia en un archivo. Un registro inconsistente falla al cargar
// este módulo —arranque de la API y CLI— en vez de aplicarse a medias en una base.
//
// Este registro lo usan igual el arranque de la API y `tools/db/database.ts`
// (`bun run db:status` para consultarlo sin efectos, `bun run db:migrate` para
// aplicarlo): no duplicar listas de versiones en otros sitios.

export const MIGRATIONS: Migration[] = validateMigrations([
  { source: 'migrations/schema.ts', migrations: schemaMigrations },
  { source: 'migrations/identifiers.ts', migrations: identifierMigrations },
  { source: 'migrations/legacy-tables.ts', migrations: legacyMigrations },
]);

// Pasos sin versión: se repiten en cada arranque, por eso no los cubre `once`.
export const BOOTSTRAP_STEPS: { name: string; up: (db: DatabaseService) => Promise<void> }[] = [
  { name: 'Reparación de enlaces sin hash', up: repairAccessHashes },
  { name: 'Semilla de la clave de firma de recibos', up: seedReceiptKey },
];

// Aplica lo pendiente. Lo usan el arranque de la API y `bun run db:migrate`, así
// que ambos caminos son exactamente el mismo código.
export async function runMigrations(db: DatabaseService) {
  await ensureLedger(db);
  await applyMigrations(db, MIGRATIONS);
  for (const step of BOOTSTRAP_STEPS) await step.up(db);
}
