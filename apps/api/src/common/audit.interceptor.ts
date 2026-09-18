import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { tap } from 'rxjs';
import { DatabaseService } from '../database/database.service';
import { requestContext } from './request-context';
import { uuidv7 } from './uuid';

// B9: sin descarte silencioso. Si la escritura de auditoría falla (p. ej. base
// no disponible), el fallo queda visible en stderr y en un contador en memoria
// expuesto por /api/health. La respuesta al cliente nunca se bloquea por esto.
export let auditFailures = 0;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    const actor = requestContext.getStore();
    const started = Date.now();
    // B5/B9: nunca cuerpos completos, contraseñas, cookies ni tokens. Solo el
    // id (uuid) cuando la operación lo trae.
    const rawId = req.body?.id;
    const idText = typeof rawId === 'string' && rawId ? rawId.slice(0, 40) : '';
    const resource = `${req.path}${idText ? ` id=${idText}` : ''}`.slice(0, 200);
    const correlation = String(req.headers['x-correlation-id'] || randomUUID());
    const rawBuilding = req.query?.building_id ?? req.body?.building_id;
    const building = typeof rawBuilding === 'string' && rawBuilding ? rawBuilding : null;
    // B9: IP y user-agent se conservan (no son secretos); el formato histórico
    // de action se mantiene para la interfaz de auditoría.
    const net = `ip=${req.ip || req.headers['x-forwarded-for'] || '?'} ua=${String(req.headers['user-agent'] || '').slice(0, 120)}`;
    const log = (outcome: string) => {
      if (req.method !== 'POST' || !actor) return;
      // actor, edificio, operación, recurso, resultado, fecha, correlación.
      // action conserva el formato histórico (con id, ip y ua) que lee la interfaz.
      const idPart = idText ? ` id=${idText}` : '';
      const record = {
        actor_id: actor.id,
        username: actor.username,
        action: `${req.method} ${req.path}${idPart} ${net} ${outcome} ${Date.now() - started}ms`.slice(0, 500),
        created_at: new Date().toISOString(),
        building_id: building,
        operation: `${req.method} ${req.path}`.slice(0, 200),
        resource,
        result: outcome.slice(0, 120),
        correlation_id: correlation.slice(0, 80),
      };
      this.database.write(tx => tx`INSERT INTO audit_log(id,actor_id,username,action,created_at,building_id,operation,resource,result,correlation_id) VALUES (${uuidv7()},${record.actor_id},${record.username},${record.action},${record.created_at},${record.building_id},${record.operation},${record.resource},${record.result},${record.correlation_id})`).catch((error) => {
        auditFailures += 1;
        console.error(JSON.stringify({ audit: 'write_failed', operation: record.operation, resource: record.resource, correlation: record.correlation_id, error: String(error?.message || error) }));
      });
    };
    return next.handle().pipe(tap({ next: () => log('ok'), error: (err) => log(`fail:${err?.constructor?.name || 'Error'}`) }));
  }
}
