import type { DatabaseService } from '../database.service';
import type { TransactionSQL } from 'bun';
import { uuidv7 } from '../../common/uuid';
import { addUuidId } from './add-uuid-id';
import type { Migration } from './ledger';
import { LEGACY_TABLES } from './legacy-tables';

// Migraciones 26–27: todos los identificadores del sistema pasan a UUID v7. El
// detalle de cada tabla (PK, FK, clave natural) vive aquí, junto a la migración
// que reconstruye esa restricción; los nombres de las tablas heredadas, en
// `legacy-tables.ts`.

interface Fk { table: string; column: string; parent: string; notNull: boolean; onDelete?: string; constraint?: false }

// Tablas cuya PK era entera. El catálogo real de cada esquema decide cuáles
// existen (una instalación nueva ya nace UUID).
const INTEGER_PK_TABLES = ['users', 'buildings', 'plans', 'customers', 'invoices', 'routers', 'events', 'commands', 'payments', 'audit_log', 'router_checks', 'usage_events', 'security_events'];

export const identifierMigrations: Migration[] = [
  {
    version: 26,
    name: 'Identificadores: enteros a UUID v7',
    up: async (db: DatabaseService, tx: TransactionSQL) => {
      // Migración 26: PKs enteras a UUID v7 en todas las tablas, remapeando cada FK
      // y los routerId del payload de órdenes pendientes. Solo actúa si el esquema
      // aún es entero (una instalación nueva ya nace UUID: aquí solo se marca).
      const [actual] = await tx<{ data_type: string }[]>`SELECT data_type FROM information_schema.columns WHERE table_schema=${db.schema} AND table_name='plans' AND column_name='id'`;
      if (actual?.data_type === 'uuid') return;
      // Las tablas heredadas con id entero entran aquí: su FK colgante impide
      // reemplazar la clave ajena mientras sigan apuntando a una PK entera.
      const pkTables = [...INTEGER_PK_TABLES, ...LEGACY_TABLES.integerId];
      const fks: Fk[] = [
        { table: 'customers', column: 'plan_id', parent: 'plans', notNull: false },
        { table: 'customers', column: 'building_id', parent: 'buildings', notNull: true },
        { table: 'invoices', column: 'customer_id', parent: 'customers', notNull: true },
        { table: 'commands', column: 'customer_id', parent: 'customers', notNull: true },
        { table: 'routers', column: 'building_id', parent: 'buildings', notNull: false },
        { table: 'router_checks', column: 'router_id', parent: 'routers', notNull: true, onDelete: 'CASCADE' },
        { table: 'sessions', column: 'user_id', parent: 'users', notNull: true, onDelete: 'CASCADE' },
        { table: 'payments', column: 'invoice_id', parent: 'invoices', notNull: true, onDelete: 'CASCADE' },
        { table: 'payments', column: 'actor_id', parent: 'users', notNull: false },
        { table: 'payments', column: 'reversed_by', parent: 'users', notNull: false },
        { table: 'audit_log', column: 'actor_id', parent: 'users', notNull: false },
        { table: 'audit_log', column: 'building_id', parent: 'buildings', notNull: false, constraint: false },
        { table: 'events', column: 'building_id', parent: 'buildings', notNull: false, constraint: false },
        { table: 'user_buildings', column: 'user_id', parent: 'users', notNull: true, onDelete: 'CASCADE' },
        { table: 'user_buildings', column: 'building_id', parent: 'buildings', notNull: true, onDelete: 'CASCADE' },
        { table: 'buildings', column: 'central_router_id', parent: 'routers', notNull: false },
        { table: 'customer_devices', column: 'router_id', parent: 'routers', notNull: true, onDelete: 'CASCADE' },
        { table: 'customer_devices', column: 'customer_id', parent: 'customers', notNull: true },
        { table: 'customer_network_targets', column: 'router_id', parent: 'routers', notNull: true },
        { table: 'customer_network_targets', column: 'customer_id', parent: 'customers', notNull: true },
        { table: 'customer_network_dirty', column: 'customer_id', parent: 'customers', notNull: true },
        { table: 'usage_cursors', column: 'router_id', parent: 'routers', notNull: true, onDelete: 'CASCADE' },
        { table: 'usage_cursors', column: 'customer_id', parent: 'customers', notNull: true, onDelete: 'CASCADE' },
        { table: 'usage_daily', column: 'customer_id', parent: 'customers', notNull: true, onDelete: 'CASCADE' },
        { table: 'usage_events', column: 'customer_id', parent: 'customers', notNull: true, onDelete: 'CASCADE' },
        { table: 'usage_router_state', column: 'router_id', parent: 'routers', notNull: true, onDelete: 'CASCADE' },
        { table: 'building_networks', column: 'building_id', parent: 'buildings', notNull: true, onDelete: 'CASCADE' },
        { table: 'plans', column: 'building_id', parent: 'buildings', notNull: false },
        { table: 'reminder_deliveries', column: 'invoice_id', parent: 'invoices', notNull: true },
        { table: 'payment_reports', column: 'customer_id', parent: 'customers', notNull: true, onDelete: 'CASCADE' },
        // notifications.building_id nunca tuvo FK declarada, pero también es entero.
        { table: 'notifications', column: 'building_id', parent: 'buildings', notNull: false, constraint: false },
      ];
      const compositePks: Record<string, string[]> = {
        user_buildings: ['user_id', 'building_id'],
        customer_devices: ['router_id', 'mac'],
        customer_network_targets: ['router_id', 'ip'],
        customer_network_dirty: ['customer_id'],
        usage_cursors: ['router_id', 'customer_id', 'queue_name'],
        usage_daily: ['customer_id', 'day'],
        usage_router_state: ['router_id'],
        building_networks: ['building_id'],
      };
      const uniques: { table: string; name: string; cols: string[] }[] = [
        { table: 'invoices', name: 'invoices_customer_id_period_key', cols: ['customer_id', 'period'] },
        { table: 'customers', name: 'customers_building_apartment_key', cols: ['building_id', 'apartment'] },
        { table: 'users', name: 'users_username_key', cols: ['username'] },
      ];
      const indexes: { name: string; table: string; cols: string; unique?: boolean }[] = [
        { name: 'invoices_customer_due', table: 'invoices', cols: '(customer_id, due)' },
        { name: 'events_building_id', table: 'events', cols: '(building_id,id)' },
        { name: 'commands_queue', table: 'commands', cols: '(status,next_attempt,id)' },
        { name: 'router_checks_router', table: 'router_checks', cols: '(router_id,id)' },
        { name: 'payments_invoice', table: 'payments', cols: '(invoice_id)' },
        { name: 'usage_events_customer_time', table: 'usage_events', cols: '(customer_id,detected_at)' },
        { name: 'customer_devices_customer', table: 'customer_devices', cols: '(customer_id)' },
        { name: 'invoices_due_id', table: 'invoices', cols: '(due DESC,id DESC)' },
        { name: 'customers_access_token', table: 'customers', cols: '(access_token)', unique: true },
        { name: 'customers_access_token_hash', table: 'customers', cols: '(access_token_hash)', unique: true },
        { name: 'payments_request_key', table: 'payments', cols: '(request_key)', unique: true },
      ];
      // Una base heredada puede venir de una versión anterior que no tenía todas
      // estas tablas ni columnas: solo se convierte lo que existe en este esquema.
      const catalogadas = (await tx.unsafe(`SELECT c.relname AS tabla, a.attname AS columna FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='${db.schema}' AND c.relkind='r' AND a.attnum>0`) as unknown as { tabla: string; columna: string }[]);
      const existentes = new Set(catalogadas.map(row => row.tabla));
      const columnas = new Set(catalogadas.map(row => `${row.tabla}.${row.columna}`));
      const pkExistentes = pkTables.filter(table => existentes.has(table));
      const relaciones = fks.filter(fk => existentes.has(fk.parent) && columnas.has(`${fk.table}.${fk.column}`));
      const maps = new Map<string, Map<number, string>>();
      // 1. PKs: genera v7 en orden de id (conserva orden cronológico aproximado).
      for (const table of pkExistentes) {
        const rows = await tx.unsafe(`SELECT id FROM ${table} ORDER BY id`) as unknown as { id: number }[];
        const map = new Map<number, string>();
        for (const row of rows) map.set(row.id, uuidv7());
        maps.set(table, map);
        await tx.unsafe(`ALTER TABLE ${table} ADD COLUMN id_uuid UUID`);
        for (const [oldId, newId] of map) {
          await tx.unsafe(`UPDATE ${table} SET id_uuid = '${newId}' WHERE id = ${oldId}`);
        }
      }
      // 2. FKs: remapea contra los uuid ya generados.
      await tx.unsafe('CREATE TEMP TABLE _uuid_map(entity TEXT, old_id INTEGER, new_id UUID) ON COMMIT DROP');
      for (const [entity, map] of maps) {
        for (const [oldId, newId] of map) {
          await tx`INSERT INTO _uuid_map(entity,old_id,new_id) VALUES (${entity},${oldId},${newId})`;
        }
      }
      for (const fk of relaciones) {
        await tx.unsafe(`ALTER TABLE ${fk.table} ADD COLUMN ${fk.column}_uuid UUID`);
        await tx.unsafe(`UPDATE ${fk.table} SET ${fk.column}_uuid = _uuid_map.new_id FROM _uuid_map WHERE _uuid_map.entity = '${fk.parent}' AND _uuid_map.old_id = ${fk.table}.${fk.column} AND ${fk.table}.${fk.column} IS NOT NULL`);
      }
      // 3. Suelta restricciones que usan las columnas a reemplazar: primero
      // todas las FK (una PK referenciada no puede soltarse antes que sus FK).
      const tables = [...new Set([...pkExistentes, ...relaciones.map(f => f.table)])];
      const dropKinds = async (types: string) => {
        for (const table of tables) {
          const cons = await tx.unsafe(`SELECT conname FROM pg_constraint WHERE conrelid = '${table}'::regclass AND contype IN (${types})`) as unknown as { conname: string }[];
          for (const c of cons) await tx.unsafe(`ALTER TABLE ${table} DROP CONSTRAINT ${c.conname}`);
        }
      };
      await dropKinds(`'f'`);
      await dropKinds(`'p','u'`);
      for (const index of indexes) await tx.unsafe(`DROP INDEX IF EXISTS ${index.name}`);
      // 4. Reemplaza columnas y reconstruye restricciones.
      const swapped = new Map<string, string[]>();
      const swap = async (table: string, column: string, notNull: boolean) => {
        await tx.unsafe(`ALTER TABLE ${table} DROP COLUMN ${column}`);
        await tx.unsafe(`ALTER TABLE ${table} RENAME COLUMN ${column}_uuid TO ${column}`);
        if (notNull) await tx.unsafe(`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL`);
        if (!swapped.has(table)) swapped.set(table, []);
        swapped.get(table)!.push(column);
      };
      for (const table of pkExistentes) await swap(table, 'id', true);
      for (const fk of relaciones) {
        if (swapped.get(fk.table)?.includes(fk.column)) continue;
        await swap(fk.table, fk.column, fk.notNull);
      }
      for (const table of pkExistentes) await tx.unsafe(`ALTER TABLE ${table} ADD PRIMARY KEY (id)`);
      for (const [table, cols] of Object.entries(compositePks)) await tx.unsafe(`ALTER TABLE ${table} ADD PRIMARY KEY (${cols.join(',')})`);
      for (const fk of relaciones) {
        if (fk.constraint === false) continue;
        await tx.unsafe(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.table}_${fk.column}_fkey FOREIGN KEY (${fk.column}) REFERENCES ${fk.parent}(id)${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ''}`);
      }
      for (const unique of uniques) await tx.unsafe(`ALTER TABLE ${unique.table} ADD CONSTRAINT ${unique.name} UNIQUE (${unique.cols.join(',')})`);
      await tx.unsafe('ALTER TABLE sessions ADD PRIMARY KEY (token_hash)');
      for (const index of indexes) await tx.unsafe(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${index.name} ON ${index.table} ${index.cols}`);
      // 5. Remapea routerId dentro del payload de órdenes no terminales.
      const routerMap = maps.get('routers')!;
      const jobs = await tx<{ id: string; payload: string | null }[]>`SELECT id, payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`;
      for (const job of jobs) {
        try {
          const payload = JSON.parse(job.payload as string) as { routerId?: number; previous?: { routerId?: number } };
          let changed = false;
          for (const holder of [payload, payload.previous]) {
            if (holder && typeof holder.routerId === 'number' && routerMap.has(holder.routerId)) {
              (holder as { routerId: unknown }).routerId = routerMap.get(holder.routerId as number);
              changed = true;
            }
          }
          if (changed) await tx`UPDATE commands SET payload=${JSON.stringify(payload)} WHERE id=${job.id}`;
        } catch { /* payload ilegible: se conserva tal cual */ }
      }
    },
  },
  {
    version: 27,
    name: 'Identificadores: claves naturales a UUID v7',
    up: async (db: DatabaseService, tx: TransactionSQL) => {
      // Migración 27: id UUID v7 en las tablas que aún usaban clave natural o
      // compuesta (tabla, clave original, nombre de la clave única resultante).
      const targets: [string, string[], string][] = [
        ['settings', ['key'], 'settings_key_key'],
        ['task_locks', ['name'], 'task_locks_name_key'],
        ['login_attempts', ['key'], 'login_attempts_key_key'],
        ['sessions', ['token_hash'], 'sessions_token_hash_key'],
        ['user_buildings', ['user_id', 'building_id'], 'user_buildings_user_building_key'],
        ['customer_devices', ['router_id', 'mac'], 'customer_devices_router_mac_key'],
        ['customer_network_targets', ['router_id', 'ip'], 'customer_network_targets_router_ip_key'],
        ['customer_network_dirty', ['customer_id'], 'customer_network_dirty_customer_key'],
        ['usage_cursors', ['router_id', 'customer_id', 'queue_name'], 'usage_cursors_router_customer_queue_key'],
        ['usage_daily', ['customer_id', 'day'], 'usage_daily_customer_day_key'],
        ['usage_router_state', ['router_id'], 'usage_router_state_router_key'],
        // Misma clave única que ya declara la migración 25 en bases nuevas: una base
        // nueva y una migrada acaban con el mismo nombre.
        ['building_networks', ['building_id'], 'building_networks_building_id_key'],
        // Tablas heredadas sin id propio (whatsapp_receipts).
        ...LEGACY_TABLES.naturalKey,
      ];
      for (const [table, natural, uniqueName] of targets) await addUuidId(tx, db.schema, table, natural, uniqueName);
    },
  },
];
