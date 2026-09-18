import type { DatabaseService } from '../database.service';
import { uuidv7 } from '../../common/uuid';
import type { Migration } from './ledger';

// Dueño único de "qué tablas heredadas existen y cómo se llaman". Las usan la
// migración 26 (conversión de ids), la 27 (clave natural sin id) y la 28 (retiro),
// así que una quinta tabla se declara solo aquí.
export const LEGACY_TABLES = {
  // Nacieron con `id INTEGER`: la 26 las convierte como a cualquier otra tabla.
  integerId: ['payment_reports', 'reminder_deliveries', 'notifications'],
  // Nunca tuvo `id`: la 27 se lo añade sobre su clave natural.
  naturalKey: [['whatsapp_receipts', ['provider_id'], 'whatsapp_receipts_provider_id_key']] as [string, string[], string][],
};
const LEGACY_TABLE_NAMES = [...LEGACY_TABLES.integerId, ...LEGACY_TABLES.naturalKey.map(([table]) => table)];

// Migración 28: retira las tablas que el código ya no usa. Antes de borrar cada
// una copia sus filas a `retired_rows` (id UUID v7, table_name, row_data JSONB,
// retired_at) dentro del mismo esquema, así que el `pg_dump --schema` de los
// respaldos conserva el contenido. Ese archivo se lee y se exporta desde
// `management/retired-rows.service.ts` (endpoint y `bun run db:archive`).
export const legacyMigrations: Migration[] = [
  {
    version: 28,
    name: 'Retiro de tablas heredadas',
    up: async (_db: DatabaseService, tx) => {
      await tx.unsafe('CREATE TABLE IF NOT EXISTS retired_rows(id UUID PRIMARY KEY, table_name TEXT NOT NULL, row_data JSONB NOT NULL, retired_at TEXT NOT NULL)');
      const retiredAt = new Date().toISOString();
      for (const table of LEGACY_TABLE_NAMES) {
        // La tabla puede no existir (instalación nueva) o haber sido retirada ya
        // por otra instancia que arrancó a la vez: en ambos casos no hay nada que hacer.
        const [present] = await tx`SELECT to_regclass(${table}) AS name`;
        if (!present.name) continue;
        const rows = await tx.unsafe(`SELECT to_jsonb(t) AS row FROM ${table} t`) as unknown as { row: Record<string, unknown> }[];
        for (const { row } of rows) {
          await tx`INSERT INTO retired_rows(id,table_name,row_data,retired_at) VALUES (${uuidv7()},${table},${row},${retiredAt})`;
        }
        await tx.unsafe(`DROP TABLE ${table}`);
      }
    },
  },
];
