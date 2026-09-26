import type { DatabaseService } from '../database.service';
import type { TransactionSQL } from 'bun';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from '../../common/uuid';
import type { Migration } from './ledger';

// Migraciones 1–25: las tablas que el sistema crea y los ajustes que su historia
// acumuló. El orden del array ES el orden de aplicación; no reordenar. Las
// versiones no van estrictamente en orden (la 12 se aplicó antes que la 11 y la 19
// después de la 20): se conserva el orden histórico.

// Único dueño de "ignora la columna que ya existe": PostgreSQL no tiene
// ADD COLUMN IF NOT EXISTS y un reintento tras un fallo parcial debe continuar.
async function safeAlter(tx: TransactionSQL, statement: string) {
  try { await tx.unsafe(statement); }
  catch (error) {
    const message = (error as Error)?.message || '';
    if (!/duplicate column|ya existe|already exists/i.test(message)) throw error;
  }
}

export const schemaMigrations: Migration[] = [
  {
    version: 1,
    name: 'Planes, departamentos, cuotas, eventos y órdenes',
    up: async (_db, tx) => {
      const id = 'UUID PRIMARY KEY';
      const timestamp = "(to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))";
      const statements = [
        `CREATE TABLE IF NOT EXISTS plans(id ${id}, name TEXT NOT NULL, down INTEGER NOT NULL, up INTEGER NOT NULL, price INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS customers(id ${id}, apartment TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', plan_id UUID REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'active')`,
        `CREATE TABLE IF NOT EXISTS invoices(id ${id}, customer_id UUID NOT NULL REFERENCES customers(id), period TEXT NOT NULL, due TEXT NOT NULL, amount INTEGER NOT NULL, paid_at TEXT, UNIQUE(customer_id,period))`,
        `CREATE TABLE IF NOT EXISTS events(id ${id}, created_at TEXT NOT NULL DEFAULT ${timestamp}, message TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS commands(id ${id}, customer_id UUID NOT NULL REFERENCES customers(id), action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT ${timestamp}, mode TEXT NOT NULL DEFAULT 'mikrotik-failed')`,
        'CREATE INDEX IF NOT EXISTS invoices_customer_due ON invoices(customer_id, due)',
      ];
      for (const statement of statements) await tx.unsafe(statement);
    },
  },
  {
    version: 2,
    name: 'Routers y sus diagnósticos',
    up: async (_db, tx) => {
      await tx.unsafe(`CREATE TABLE routers (
        id UUID PRIMARY KEY, name TEXT NOT NULL, adapter TEXT NOT NULL, host TEXT NOT NULL,
        port INTEGER NOT NULL, protocol TEXT NOT NULL, diagnostic_host TEXT,
        credentials TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'untested',
        last_checked TEXT, last_error TEXT, snapshot TEXT,
        UNIQUE(host, port, protocol)
      )`);
      await tx.unsafe(`CREATE TABLE router_checks (
        id UUID PRIMARY KEY, router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL, success INTEGER NOT NULL, message TEXT NOT NULL
      )`);
    },
  },
  {
    version: 3,
    name: 'IP del departamento',
    up: async (_db, tx) => {
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN ip TEXT');
      await tx.unsafe('CREATE INDEX IF NOT EXISTS customers_ip ON customers(ip)');
    },
  },
  {
    version: 4,
    name: 'Usuarios, sesiones y pagos',
    up: async (_db, tx) => {
      const id = 'UUID PRIMARY KEY';
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS users (
        id ${id}, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL
      )`);
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      )`);
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS payments (
        id ${id}, invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL, created_at TEXT NOT NULL
      )`);
      await tx.unsafe('CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id)');
    },
  },
  {
    version: 5,
    name: 'Bloqueos, auditoría, estados de orden y reversión de pagos',
    up: async (_db, tx) => {
      const id = 'UUID PRIMARY KEY';
      const statements = [
        'ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0',
        'CREATE TABLE login_attempts (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at TEXT NOT NULL)',
        'ALTER TABLE customers ADD COLUMN archived INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE customers ADD COLUMN manual_hold INTEGER NOT NULL DEFAULT 0',
        "ALTER TABLE customers ADD COLUMN network_state TEXT NOT NULL DEFAULT 'failed'",
        'ALTER TABLE customers ADD COLUMN network_checked_at TEXT',
        "ALTER TABLE commands ADD COLUMN status TEXT NOT NULL DEFAULT 'failed'",
        'ALTER TABLE commands ADD COLUMN payload TEXT',
        'ALTER TABLE commands ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE commands ADD COLUMN next_attempt TEXT',
        'ALTER TABLE commands ADD COLUMN last_error TEXT',
        "ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash'",
        "ALTER TABLE payments ADD COLUMN reference TEXT NOT NULL DEFAULT ''",
        'ALTER TABLE payments ADD COLUMN actor_id UUID REFERENCES users(id)',
        'ALTER TABLE payments ADD COLUMN reversed_at TEXT',
        'ALTER TABLE payments ADD COLUMN reversed_by UUID REFERENCES users(id)',
        'ALTER TABLE payments ADD COLUMN reversal_reason TEXT',
        'ALTER TABLE payments ADD COLUMN request_key TEXT',
        'CREATE UNIQUE INDEX payments_request_key ON payments(request_key)',
        'ALTER TABLE events ADD COLUMN actor TEXT',
        'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        'CREATE TABLE task_locks (name TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TEXT NOT NULL)',
        `CREATE TABLE audit_log (id ${id}, actor_id UUID REFERENCES users(id), username TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL)`,
        'CREATE INDEX commands_queue ON commands(status,next_attempt,id)',
        'CREATE INDEX router_checks_router ON router_checks(router_id,id)',
        'CREATE INDEX payments_date ON payments(created_at)',
      ];
      for (const statement of statements) await tx.unsafe(statement);
      // Existing suspensions have no reliable reason: preserve them as manual holds.
      await tx`UPDATE customers SET manual_hold=1 WHERE status='suspended'`;
      // Adopt paid invoices from the pre-payments schema without losing receipts.
      await tx`INSERT INTO payments(id,invoice_id,amount,created_at,method,reference)
        SELECT ${uuidv7()},i.id,i.amount,i.paid_at,'legacy','Saldo histórico migrado' FROM invoices i
        WHERE i.paid_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id=i.id)`;
      await tx`UPDATE commands SET status=CASE WHEN mode='mikrotik' THEN 'applied' WHEN mode='mikrotik-failed' THEN 'legacy_failed' ELSE 'failed' END`;
    },
  },
  {
    version: 6,
    name: 'Edificios y vínculo usuario-edificio',
    up: async (_db, tx) => {
      const id = 'UUID PRIMARY KEY';
      // Base multiedificio: no rompe el modo actual de un edificio. Crea buildings
      // + user_buildings y building_id nullable; siembra el primer edificio con lo
      // existente y asigna a los usuarios actuales.
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS buildings (
        id ${id}, name TEXT NOT NULL, created_at TEXT NOT NULL
      )`);
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS user_buildings (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, building_id)
      )`);
      for (const table of ['plans', 'customers', 'routers']) {
        await safeAlter(tx, `ALTER TABLE ${table} ADD COLUMN building_id UUID REFERENCES buildings(id)`);
      }
      const [count] = await tx`SELECT COUNT(*) count FROM buildings`;
      if (Number(count.count) === 0) {
        const [ops] = await tx`SELECT value FROM settings WHERE key='operations'`;
        let seedName = 'Mi edificio';
        try {
          const parsed = JSON.parse(ops?.value || '{}');
          if (typeof parsed.building_name === 'string' && parsed.building_name.trim()) seedName = parsed.building_name.trim().slice(0, 100);
        } catch { /* conserva el nombre por defecto */ }
        const [b] = await tx`INSERT INTO buildings(id,name,created_at) VALUES (${uuidv7()},${seedName},${new Date().toISOString()}) RETURNING id`;
        const buildingId = (b as unknown as { id: string }).id;
        await tx`UPDATE plans SET building_id=${buildingId} WHERE building_id IS NULL`;
        await tx`UPDATE customers SET building_id=${buildingId} WHERE building_id IS NULL`;
        await tx`UPDATE routers SET building_id=${buildingId} WHERE building_id IS NULL`;
        const users = await tx`SELECT id, role FROM users`;
        for (const u of users as unknown as { id: string }[]) {
          await tx`INSERT INTO user_buildings(user_id,building_id) VALUES (${u.id},${buildingId}) ON CONFLICT(user_id,building_id) DO NOTHING`;
        }
      }
    },
  },
  {
    version: 7,
    name: 'Equipo central por edificio',
    up: async (_db, tx) => {
      // El ajuste global sigue como valor heredado; cada edificio puede tener su
      // propio MikroTik central.
      await safeAlter(tx, 'ALTER TABLE buildings ADD COLUMN central_router_id UUID REFERENCES routers(id)');
      try {
        const [ops] = await tx`SELECT value FROM settings WHERE key='operations'`;
        const globalCentral = JSON.parse(ops?.value || '{}').central_router_id;
        if (Number.isInteger(globalCentral)) {
          await tx`UPDATE buildings SET central_router_id=${globalCentral} WHERE central_router_id IS NULL`;
        }
      } catch { /* sin central global: queda pendiente asignar el central de cada edificio */ }
    },
  },
  {
    version: 8,
    name: 'Departamento único por edificio',
    up: async (_db, tx) => {
      // Antes `apartment` era UNIQUE en toda la tabla y dos edificios no podían
      // repetir el "101": suelta esa restricción y crea UNIQUE(building_id, apartment).
      await tx.unsafe(`UPDATE customers SET apartment = apartment || ' #' || id::text WHERE id IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY apartment, building_id ORDER BY id) rn FROM customers) t WHERE rn > 1)`);
      await tx.unsafe(`DO $$ DECLARE cname TEXT; BEGIN
        SELECT c.conname INTO cname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE t.oid = 'customers'::regclass AND c.contype = 'u' AND array_length(c.conkey, 1) = 1 AND a.attname = 'apartment' LIMIT 1;
        IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE customers DROP CONSTRAINT %I', cname); END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'customers'::regclass AND conname = 'customers_building_apartment_key') THEN
          ALTER TABLE customers ADD CONSTRAINT customers_building_apartment_key UNIQUE (building_id, apartment);
        END IF;
      END $$`);
    },
  },
  {
    version: 9,
    name: 'Superadmin sin edificio',
    // El super-admin ve todo por rol: limpia asignaciones heredadas.
    up: async (_db, tx) => tx`DELETE FROM user_buildings WHERE user_id IN (SELECT id FROM users WHERE role='superadmin')`,
  },
  {
    version: 10,
    name: 'Dirección del edificio',
    up: async (_db, tx) => safeAlter(tx, `ALTER TABLE buildings ADD COLUMN address TEXT NOT NULL DEFAULT ''`),
  },
  {
    version: 11,
    name: 'Datos del administrador',
    up: async (_db, tx) => {
      for (const definition of [`ci TEXT NOT NULL DEFAULT ''`, `first_name TEXT NOT NULL DEFAULT ''`, `last_name TEXT NOT NULL DEFAULT ''`, `address TEXT NOT NULL DEFAULT ''`, `phone TEXT NOT NULL DEFAULT ''`]) {
        await safeAlter(tx, `ALTER TABLE users ADD COLUMN ${definition}`);
      }
    },
  },
  {
    version: 12,
    name: 'Activar y desactivar edificios y routers',
    up: async (_db, tx) => {
      for (const table of ['buildings', 'routers']) {
        await safeAlter(tx, `ALTER TABLE ${table} ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
      }
    },
  },
  {
    version: 13,
    name: 'Ámbito de los eventos',
    up: async (_db, tx) => {
      // Las filas históricas no tienen ámbito fiable: quedan globales, visibles
      // solo para el dueño del sistema.
      await safeAlter(tx, 'ALTER TABLE events ADD COLUMN building_id UUID');
      await tx.unsafe('CREATE INDEX IF NOT EXISTS events_building_id ON events(building_id,id)');
    },
  },
  {
    version: 14,
    name: 'Dispositivos por router',
    up: async (_db, tx) => {
      const [row] = await tx`SELECT value FROM settings WHERE key='operations'`;
      if (row) {
        const config = JSON.parse(row.value);
        delete config.central_router_id;
        await tx`UPDATE settings SET value=${JSON.stringify(config)} WHERE key='operations'`;
      }
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS customer_devices (
        router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        mac TEXT NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY(router_id,mac))`);
      await tx.unsafe('CREATE INDEX IF NOT EXISTS customer_devices_customer ON customer_devices(customer_id)');
    },
  },
  {
    version: 15,
    name: 'Objetivos de red del departamento',
    up: async (_db, tx) => {
      await tx.unsafe('CREATE TABLE IF NOT EXISTS customer_network_targets(router_id UUID NOT NULL REFERENCES routers(id),ip TEXT NOT NULL,customer_id UUID NOT NULL REFERENCES customers(id),PRIMARY KEY(router_id,ip))');
      await tx.unsafe('CREATE TABLE IF NOT EXISTS customer_network_dirty(customer_id UUID PRIMARY KEY REFERENCES customers(id))');
      await tx`INSERT INTO customer_network_dirty(customer_id) SELECT DISTINCT customer_id FROM customer_devices`;
    },
  },
  {
    version: 16,
    name: 'Función de WhatsApp retirada (marcador)',
    // La función se retiró, pero la versión se marca igual para que una base nueva
    // y una actualizada recorran el mismo historial.
    up: async () => undefined,
  },
  {
    version: 17,
    name: 'Enlace de consulta del residente',
    up: async (_db, tx) => {
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN access_token TEXT');
      await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS customers_access_token ON customers(access_token)');
      const existing = await tx<{ id: number }[]>`SELECT id FROM customers WHERE access_token IS NULL`;
      for (const c of existing) {
        const token = randomBytes(32).toString('base64url');
        await tx`UPDATE customers SET access_token=${token} WHERE id=${c.id}`;
      }
    },
  },
  {
    version: 18,
    name: 'Plan opcional en departamentos',
    up: async (_db, tx) => tx.unsafe('ALTER TABLE customers ALTER COLUMN plan_id DROP NOT NULL'),
  },
  {
    version: 19,
    name: 'Tablas de consumo por router y por día',
    up: async (_db, tx) => {
      const id = 'UUID PRIMARY KEY';
      await tx.unsafe(`CREATE TABLE usage_cursors (
        router_id UUID NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        queue_name TEXT NOT NULL, queue_id TEXT,
        download_bytes BIGINT NOT NULL, upload_bytes BIGINT NOT NULL,
        observed_at TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(router_id,customer_id,queue_name))`);
      await tx.unsafe(`CREATE TABLE usage_daily (
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        day TEXT NOT NULL, download_bytes BIGINT NOT NULL DEFAULT 0,
        upload_bytes BIGINT NOT NULL DEFAULT 0, samples INTEGER NOT NULL DEFAULT 0,
        resets INTEGER NOT NULL DEFAULT 0, gaps INTEGER NOT NULL DEFAULT 0,
        estimated_bytes BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(customer_id,day))`);
      await tx.unsafe(`CREATE TABLE usage_events (
        id ${id},customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        detected_at TEXT NOT NULL,kind TEXT NOT NULL)`);
      await tx.unsafe('CREATE INDEX usage_events_customer_time ON usage_events(customer_id,detected_at)');
      await tx.unsafe(`CREATE TABLE usage_router_state (
        router_id UUID PRIMARY KEY REFERENCES routers(id) ON DELETE CASCADE,
        last_attempt TEXT NOT NULL,last_success TEXT,status TEXT NOT NULL)`);
    },
  },
  {
    version: 20,
    name: 'Edificio obligatorio en departamentos',
    up: async (_db, tx) => {
      // Con NULL, el UNIQUE(building_id, apartment) no frena duplicados.
      const [first] = await tx<{ id: string }[]>`SELECT id FROM buildings ORDER BY id LIMIT 1`;
      if (!first) return;
      await tx`UPDATE customers SET building_id=${first.id} WHERE building_id IS NULL`;
      await tx`UPDATE plans SET building_id=${first.id} WHERE building_id IS NULL`;
      await tx`UPDATE routers SET building_id=${first.id} WHERE building_id IS NULL`;
      await tx.unsafe('ALTER TABLE customers ALTER COLUMN building_id SET NOT NULL');
    },
  },
  {
    version: 21,
    name: 'Ciclo de vida del enlace',
    up: async (_db, tx) => {
      // Los enlaces existentes se conservan sin caducidad; solo se registra su
      // emisión para auditoría.
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN access_issued_at TEXT');
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN access_expires_at TEXT');
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1');
      const stamp = new Date().toISOString();
      await tx`UPDATE customers SET access_issued_at=COALESCE(access_issued_at,${stamp}) WHERE access_issued_at IS NULL`;
    },
  },
  {
    version: 22,
    name: 'Hash del enlace en reposo',
    up: async (_db, tx) => {
      // El enlace completo solo existe al emitirlo; en reposo solo su hash. Migra
      // los enlaces existentes calculando su hash para preservar validez.
      await safeAlter(tx, 'ALTER TABLE customers ADD COLUMN access_token_hash TEXT');
      const legacy = await tx<{ id: number; access_token: string | null }[]>`SELECT id, access_token FROM customers WHERE access_token_hash IS NULL AND access_token IS NOT NULL`;
      for (const row of legacy) {
        const hash = createHash('sha256').update(row.access_token as string).digest('hex');
        await tx`UPDATE customers SET access_token_hash=${hash} WHERE id=${row.id}`;
      }
      await tx.unsafe('CREATE UNIQUE INDEX IF NOT EXISTS customers_access_token_hash ON customers(access_token_hash)');
    },
  },
  {
    version: 23,
    name: 'Auditoría estructurada y eventos de seguridad',
    up: async (_db, tx) => {
      // Auditoría sin secretos + registro de seguridad independiente del rollback
      // del negocio. Retención: 180 días.
      const id = 'UUID PRIMARY KEY';
      await safeAlter(tx, 'ALTER TABLE audit_log ADD COLUMN building_id UUID');
      await safeAlter(tx, "ALTER TABLE audit_log ADD COLUMN operation TEXT NOT NULL DEFAULT ''");
      await safeAlter(tx, "ALTER TABLE audit_log ADD COLUMN resource TEXT NOT NULL DEFAULT ''");
      await safeAlter(tx, "ALTER TABLE audit_log ADD COLUMN result TEXT NOT NULL DEFAULT ''");
      await safeAlter(tx, "ALTER TABLE audit_log ADD COLUMN correlation_id TEXT NOT NULL DEFAULT ''");
      await tx.unsafe(`CREATE TABLE IF NOT EXISTS security_events (
        id ${id}, created_at TEXT NOT NULL, actor TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT '', event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`);
      await tx.unsafe('CREATE INDEX IF NOT EXISTS security_events_created ON security_events(created_at)');
      await tx.unsafe('CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at)');
    },
  },
  {
    version: 24,
    name: 'Índice de cuotas por vencimiento',
    up: async (_db, tx) => tx.unsafe('CREATE INDEX IF NOT EXISTS invoices_due_id ON invoices(due DESC,id DESC)'),
  },
  {
    version: 25,
    name: 'Diseño de red por edificio',
    up: async (db, tx) => {
      // En una base anterior los identificadores siguen siendo enteros hasta la
      // migración 26: building_id debe copiar el tipo que tiene buildings.id ahora.
      const [{ data_type: tipoEdificio }] = await tx<{ data_type: string }[]>`SELECT data_type FROM information_schema.columns WHERE table_schema=${db.schema} AND table_name='buildings' AND column_name='id'`;
      await tx.unsafe(`CREATE TABLE building_networks (
        id UUID PRIMARY KEY, building_id ${tipoEdificio === 'integer' ? 'INTEGER' : 'UUID'} NOT NULL UNIQUE REFERENCES buildings(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 1, design TEXT NOT NULL,
        published_design TEXT, published_at TEXT, updated_at TEXT NOT NULL
      )`);
    },
  },
  {
    version: 29,
    name: 'Activar, desactivar y eliminar planes',
    up: async (_db, tx) => {
      await safeAlter(tx, `ALTER TABLE plans ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0`);
    },
  },
  {
    version: 30,
    name: 'Equipo central obligatorio',
    up: async (_db, tx) => {
      await tx.unsafe(`ALTER TABLE customers ALTER COLUMN network_state SET DEFAULT 'failed'`);
      await tx.unsafe(`ALTER TABLE commands ALTER COLUMN status SET DEFAULT 'failed'`);
      await tx.unsafe(`ALTER TABLE commands ALTER COLUMN mode SET DEFAULT 'mikrotik-failed'`);
      await tx`UPDATE customers SET network_state='failed' WHERE network_state='simulated'`;
      await tx`UPDATE commands SET status='failed',mode='mikrotik-failed',last_error=COALESCE(last_error,'El edificio no tiene equipo central asignado. Asigna un MikroTik central y reintenta la orden.') WHERE status='simulated' OR mode='simulated'`;
    },
  },
  {
    version: 31,
    name: 'Departamentos sin IP con estado propio',
    up: async (_db, tx) => {
      await tx.unsafe(`ALTER TABLE customers ALTER COLUMN network_state SET DEFAULT 'no_ip'`);
      // Una base anterior daba por fallido lo que en realidad es «no hay IP que aplicar».
      // Los departamentos con equipos vinculados sí se pueden operar sin IP propia, así
      // que conservan su estado real y quedan fuera de la corrección.
      await tx`UPDATE customers AS c SET network_state='no_ip' WHERE c.ip IS NULL AND c.network_state IN ('failed','simulated')
        AND NOT EXISTS (SELECT 1 FROM customer_devices d WHERE d.customer_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM customer_network_targets t WHERE t.customer_id=c.id)`;
    },
  },
];

// Reparación de cada arranque: los enlaces heredados con plain válido recuperan su
// hash y las filas sin hash utilizable reciben enlaces nuevos. No lleva versión
// porque debe correr siempre; access_token_hash existe desde la 22.
export async function repairAccessHashes(db: DatabaseService) {
  await db.write(async tx => {
    const legacy = await tx<{ id: number; access_token: string }[]>`SELECT id, access_token FROM customers WHERE access_token_hash IS NULL AND access_token IS NOT NULL AND length(access_token)>=43`;
    for (const row of legacy) {
      await tx`UPDATE customers SET access_token_hash=${createHash('sha256').update(row.access_token).digest('hex')} WHERE id=${row.id}`;
    }
    const rows = await tx<{ id: number }[]>`SELECT id FROM customers WHERE access_token_hash IS NULL AND (access_token IS NULL OR length(access_token)<43)`;
    for (const row of rows) {
      const fresh = randomBytes(32).toString('base64url');
      await tx`UPDATE customers SET access_token=${null},access_token_hash=${createHash('sha256').update(fresh).digest('hex')} WHERE id=${row.id}`;
    }
  });
}

// La clave de firma de recibos se emite una sola vez, y solo después de que todas
// las tablas tengan su id UUID v7 (settings ya admite id).
export async function seedReceiptKey(db: DatabaseService) {
  await db.write(async tx => {
    await tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},'receipt-signature-key',${randomBytes(32).toString('hex')}) ON CONFLICT(key) DO NOTHING`;
  });
}
