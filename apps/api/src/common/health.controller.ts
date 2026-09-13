import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { auditFailures } from './audit.interceptor';

// Salud operativa mínima (pública, sin secretos): indica si el proceso sigue
// disponible, si hubo fallos de escritura de auditoría (B9) y el rezago de
// la cola de red (C6: solo conteos, sin mensajes ni datos). No expone datos.
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get() async status() {
    let db: string = this.database.driver;
    let queue = { pending: 0, failed: 0 };
    try {
      await this.database.read(tx => tx`SELECT 1`);
      const [backlog] = await this.database.read(tx => tx`SELECT COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) pending,COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) failed FROM commands`);
      queue = { pending: Number(backlog.pending), failed: Number(backlog.failed) };
    } catch {
      db = `${this.database.driver}:unavailable`;
    }
    return { ok: db.endsWith('unavailable') ? false : true, database: db, audit_failures: auditFailures, queue };
  }
}
