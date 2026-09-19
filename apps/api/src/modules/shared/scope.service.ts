import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { TransactionSQL } from 'bun';
import { isSystem, requestContext } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import type { Customer } from './management-types';
import { now } from './management-types';

/**
 * Alcance de seguridad y ayudas compartidas de gestión.
 * Única responsabilidad: resolver edificios del actor, validar acceso,
 * cargar clientes y escribir eventos. No contiene reglas de negocio.
 */
@Injectable()
export class ScopeService {
  async log(tx: TransactionSQL, message: string, buildingId: string | null = null): Promise<void> {
    await tx`INSERT INTO events(id,message,actor,building_id) VALUES (${uuidv7()},${message},${requestContext.getStore()?.username || 'Sistema'},${buildingId})`;
  }

  async customer(tx: TransactionSQL, id: string): Promise<Customer> {
    const [customer] = await tx<Customer[]>`SELECT c.*,p.down,p.up FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE c.id=${id}`;
    if (!customer) throw new BadRequestException('Departamento no encontrado.');
    await this.requireBuilding(tx, customer.building_id);
    return customer;
  }

  async actorBuildings(tx: TransactionSQL): Promise<string[]> {
    const actor = requestContext.getStore();
    // B7: sin actor no hay privilegios; el sistema usa SYSTEM_ACTOR explícito.
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad. Las tareas internas deben usar el actor de sistema.');
    if (isSystem(actor) || actor.role === 'superadmin') {
      return (await tx`SELECT id FROM buildings ORDER BY id` as unknown as { id: string }[]).map((b) => b.id);
    }
    return (
      await tx`SELECT ub.building_id id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND b.disabled=0 ORDER BY ub.building_id` as unknown as { id: string }[]
    ).map((b) => b.id);
  }

  async requireBuilding(tx: TransactionSQL, buildingId: string | null): Promise<void> {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    if (isSystem(actor) || actor.role === 'superadmin') return;
    if (!buildingId) throw new ForbiddenException('Sin acceso a este edificio.');
    const rows = await tx`SELECT b.id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND ub.building_id=${buildingId} AND b.disabled=0`;
    if (!rows.length) throw new ForbiddenException('Sin acceso a este edificio.');
  }

  async resolveBuilding(tx: TransactionSQL, requested?: string | null): Promise<string> {
    const allowed = await this.actorBuildings(tx);
    if (requested) {
      const actor = requestContext.getStore();
      if (actor && !isSystem(actor) && actor.role !== 'superadmin') {
        const [ok] = await tx`SELECT b.id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND ub.building_id=${requested} AND b.disabled=0`;
        if (!ok) throw new ForbiddenException('Sin acceso a este edificio.');
      } else {
        const [b] = await tx`SELECT id FROM buildings WHERE id=${requested}`;
        if (!b) throw new BadRequestException('Edificio no encontrado.');
      }
      return requested;
    }
    if (allowed.length > 1 && requestContext.getStore() && !isSystem(requestContext.getStore())) {
      throw new BadRequestException('Selecciona el edificio para esta operación.');
    }
    if (allowed.length) return allowed[0];
    throw new BadRequestException('No tienes edificios asignados. Pide al super-admin que te asigne uno.');
  }

  async centralFor(tx: TransactionSQL, buildingId: string | null): Promise<string | null> {
    if (!buildingId) return null;
    const [router] = await tx`SELECT r.id FROM buildings b JOIN routers r ON r.id=b.central_router_id AND r.building_id=b.id WHERE b.id=${buildingId} AND b.disabled=0 AND r.disabled=0 AND r.adapter='mikrotik-rest'`;
    return router?.id || null;
  }

  requireSuperadmin(): void {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    if (isSystem(actor)) return; // tareas internas explícitas del sistema
    if (actor.role !== 'superadmin') throw new ForbiddenException('Solo el super-admin puede gestionar edificios y accesos.');
  }

  async checkIpFree(tx: TransactionSQL, ip: string | null, buildingId: string, exceptId?: string): Promise<void> {
    if (!ip) return;
    const rows = await tx<{ id: string }[]>`SELECT id FROM customers WHERE ip=${ip} AND building_id=${buildingId}`;
    if (rows.some((row) => row.id !== exceptId)) throw new BadRequestException('Esa IP ya está asignada a otro departamento del edificio.');
    const tracked = await tx<{ customer_id: string }[]>`SELECT t.customer_id FROM customer_network_targets t JOIN routers r ON r.id=t.router_id WHERE r.building_id=${buildingId} AND t.ip=${ip}`;
    if (tracked.some((t) => t.customer_id !== exceptId)) {
      throw new BadRequestException('La IP conserva reglas de otro departamento. Espera a que finalice su limpieza.');
    }
    const jobs = await tx<{ customer_id: string; payload: string }[]>`SELECT q.customer_id,q.payload FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${buildingId} AND q.status IN ('pending','failed','running') AND payload IS NOT NULL`;
    if (jobs.some((job) => job.customer_id !== exceptId && [JSON.parse(job.payload).ip, JSON.parse(job.payload).previous?.ip].includes(ip))) {
      throw new BadRequestException('Esa IP tiene cambios de red pendientes. Espera a que finalicen.');
    }
  }

  async touchNow(): Promise<string> {
    return now();
  }
}
