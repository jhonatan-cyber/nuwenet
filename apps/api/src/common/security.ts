import type { DatabaseService } from '../database/database.service';

// B8: registro de seguridad independiente del rollback del negocio. Se escribe
// en su propia transacción (security_events) para que un rollback de la
// operación auditada no borre el evento. Nunca bloquea: ante un fallo de
// escritura lo deja visible en stderr.
export async function logSecurity(
  database: DatabaseService,
  event: { actor?: string; ip?: string; event: string; detail?: string },
): Promise<void> {
  const record = {
    created_at: new Date().toISOString(),
    actor: (event.actor || '?').slice(0, 160),
    ip: (event.ip || '?').slice(0, 80),
    name: event.event.slice(0, 120),
    detail: (event.detail || '').slice(0, 500),
  };
  try {
    await database.write(tx => tx`INSERT INTO security_events(created_at,actor,ip,event,detail) VALUES (${record.created_at},${record.actor},${record.ip},${record.name},${record.detail})`);
  } catch (error) {
    console.error(JSON.stringify({ security: 'write_failed', event: record.name, error: String((error as Error)?.message || error) }));
  }
}
