import type { DatabaseService } from '../database.service';
import { applyMigrations, ensureLedger } from './ledger';
import type { Migration } from './ledger';
import { repairAccessHashes, schemaMigrations, seedReceiptKey } from './schema';
import { identifierMigrations } from './identifiers';
import { legacyMigrations } from './legacy-tables';

// Estructura de la capa de datos (dueño de cada pieza):
//
//   database.service.ts   conexión, transacciones y bloqueos. Nada de esquema.
//   migrations/index.ts   este registro. MIGRATIONS es el orden real de aplicación.
//   migrations/ledger.ts  `schema_migrations`, el contrato `once` y la lectura sin
//                         efectos que usa el CLI (`appliedVersions`).
//   migrations/add-uuid-id.ts  cómo una tabla existente recibe su id UUID v7.
//   migrations/schema.ts  migraciones 1–25 y los dos pasos de cada arranque.
//   migrations/identifiers.ts  migraciones 26–27: todo id pasa a UUID v7.
//   migrations/legacy-tables.ts  migración 28 y la lista única de tablas heredadas.
//
// Añadir una migración: un módulo por asunto (no por número), una entrada más en
// el array correspondiente con `version`, `name` y `up`. El array se aplica en su
// orden, así que se inserta donde corresponda, y `db:status` la muestra sola.
//
// Este registro lo usan igual el arranque de la API y `scripts/database.mjs`
// (`bun run db:status` para consultarlo sin efectos, `bun run db:migrate` para
// aplicarlo): no duplicar listas de versiones en otros sitios.

export const MIGRATIONS: Migration[] = [...schemaMigrations, ...identifierMigrations, ...legacyMigrations];

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
