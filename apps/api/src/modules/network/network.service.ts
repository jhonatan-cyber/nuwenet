import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../../database/database.service';
import { RoutersService } from '../../routers/routers.service';
import { enforcingAdapters } from '../../routers/router.types';
import { controlDepartment } from './department-control';
import { networkError } from './network-error';
import { ScopeService } from '../shared/scope.service';
import { now, type Customer, type NetworkJob } from '../shared/management-types';
import { uuidv7 } from '../../common/uuid';
import type { BuildingCentralDto } from '../buildings/buildings.dto';

/**
 * Cola de red y bloqueos operativos. Única responsabilidad: encolar,
 * procesar y reintentar órdenes contra el equipo central.
 *
 * Estado del departamento (`customers.network_state`): `no_ip` cuando no hay IP privada
 * ni equipos vinculados —nada que aplicar, no un fallo—, `pending`/`applied` según la
 * cola y `failed` cuando un intento real no llegó al equipo (red, edificio inactivo o
 * falta de equipo central).
 */
@Injectable()
export class NetworkService {
  private processing = false;
  constructor(
    private readonly database: DatabaseService,
    private readonly routers: RoutersService,
    private readonly scope: ScopeService,
  ) {}

  async queue(tx: TransactionSQL, customer: Customer, previous?: NetworkJob['previous']): Promise<void> {
    const routerId = await this.scope.centralFor(tx, customer.building_id);
    const grouped = Boolean(
      (
        await tx`SELECT customer_id FROM customer_devices WHERE customer_id=${customer.id} UNION SELECT customer_id FROM customer_network_targets WHERE customer_id=${customer.id}`
      ).length,
    );
    const payload: NetworkJob = { grouped, routerId, ip: customer.ip, status: customer.status, down: customer.down ?? 0, up: customer.up ?? 0, previous };
    // Sin IP privada (ni equipos vinculados) esta red no se puede tocar: el departamento
    // tiene su propio estado en vez de quedarse como un fallo de red que nunca ocurrió.
    const sinIp = !payload.ip && !grouped;
    // Una orden nueva deja sin efecto las que nunca llegaron a aplicarse (sin equipo
    // central asignado o sin IP): la más antigua del departamento bloqueaba a las
    // posteriores, así que su reintento eterno impedía que la orden vigente llegara
    // al equipo. Así se registran una sola vez, como reemplazadas.
    await tx`UPDATE commands SET status='superseded' WHERE customer_id=${customer.id} AND status='failed'
      AND COALESCE((payload::jsonb->>'grouped')::boolean,false)=false
      AND ((payload::jsonb->>'routerId') IS NULL OR (payload::jsonb->>'ip') IS NULL)`;
    const canEnforce = Boolean((payload.routerId && (payload.ip || grouped)) || previous || grouped);
    if (!canEnforce) {
      const missing = !payload.routerId
        ? 'El edificio no tiene equipo central asignado. Asigna un MikroTik central antes de operar la red.'
        : 'El departamento no tiene IP privada. Asigna una IP antes de operar la red.';
      await tx`INSERT INTO commands(id,customer_id,action,status,payload,next_attempt,last_error) VALUES (${uuidv7()},${customer.id},${customer.status === 'active' ? 'activate' : 'suspend'},'failed',${JSON.stringify(payload)},${now()},${missing})`;
      await tx`UPDATE customers SET network_state=${sinIp ? 'no_ip' : 'failed'},network_checked_at=${now()} WHERE id=${customer.id}`;
      return;
    }
    const status = 'pending';
    await tx`INSERT INTO commands(id,customer_id,action,status,payload,next_attempt) VALUES (${uuidv7()},${customer.id},${customer.status === 'active' ? 'activate' : 'suspend'},${status},${JSON.stringify(payload)},${now()})`;
    await tx`UPDATE customers SET network_state=${sinIp ? 'no_ip' : status},network_checked_at=NULL WHERE id=${customer.id}`;
  }

  async applyAccess(tx: TransactionSQL, customer: Customer, status: Customer['status'], reason: string, force = false): Promise<void> {
    if (customer.status === status && !force) return;
    await tx`UPDATE customers SET status=${status} WHERE id=${customer.id}`;
    await this.queue(tx, { ...customer, status });
    await this.scope.log(tx, `${customer.apartment}: servicio solicitado ${status === 'active' ? 'activo' : 'suspendido'}. ${reason}`, customer.building_id);
  }

  async retryCommand(id: string): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
      const [job] = await tx`SELECT * FROM commands WHERE id=${id}`;
      if (!job?.payload || !['failed', 'pending'].includes(job.status)) throw new BadRequestException('La orden no admite reintento.');
      await tx`UPDATE commands SET status='pending',next_attempt=${now()} WHERE id=${id}`;
    });
  }

  async acquireTask(name: string, milliseconds = 600000): Promise<string | null> {
    const token = randomUUID();
    return this.database.writeOperational('task-lock:' + name, async (tx) => {
      const [lock] = await tx`SELECT * FROM task_locks WHERE name=${name}`;
      if (lock && lock.expires_at > now()) return null;
      await tx`INSERT INTO task_locks(id,name,token,expires_at) VALUES (${uuidv7()},${name},${token},${new Date(Date.now() + milliseconds).toISOString()}) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at`;
      return token;
    });
  }

  async releaseTask(name: string, token: string): Promise<void> {
    await this.database.writeOperational('task-lock:' + name, (tx) => tx`DELETE FROM task_locks WHERE name=${name} AND token=${token}`);
  }

  async syncLinkedDevices(): Promise<void> {
    await this.database.write(async (tx) => {
      const dirty = await tx`SELECT customer_id FROM customer_network_dirty`;
      for (const row of dirty) {
        if ((await tx`SELECT id FROM commands WHERE customer_id=${row.customer_id} AND status IN ('pending','failed','running') LIMIT 1`).length) continue;
        await this.queue(tx, await this.scope.customer(tx, row.customer_id));
        await tx`DELETE FROM customer_network_dirty WHERE customer_id=${row.customer_id}`;
      }
    });
  }

  async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    let token: string | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      token = await this.acquireTask('network', 300000);
      if (!token) return;
      heartbeat = setInterval(
        () =>
          void this.database
            .writeOperational('task-lock:network', (tx) => tx`UPDATE task_locks SET expires_at=${new Date(Date.now() + 300000).toISOString()} WHERE name='network' AND token=${token!}`)
            .catch(() => {}),
        30000,
      );
      heartbeat.unref?.();
      await this.database.write((tx) => tx`UPDATE commands SET status='pending' WHERE status='running'`);
      // C3: presupuesto por pasada para que un equipo lento no monopolice el
      // procesamiento (además del tope de 10 órdenes y el timeout REST de 12s).
      const deadline = Date.now() + 240000;
      for (let n = 0; n < 10; n++) {
        if (Date.now() > deadline) break;
        const job = await this.database.write(async (tx) => {
          const [row] = await tx`SELECT q.* FROM commands q WHERE q.status IN ('pending','failed') AND q.next_attempt<=${now()} AND NOT EXISTS (SELECT 1 FROM commands older WHERE older.customer_id=q.customer_id AND older.id<q.id AND older.status IN ('pending','failed','running')) ORDER BY q.id LIMIT 1`;
          if (!row) return null;
          await tx`UPDATE task_locks SET expires_at=${new Date(Date.now() + 300000).toISOString()} WHERE name='network' AND token=${token!}`;
          await tx`UPDATE commands SET status='running',attempts=attempts+1 WHERE id=${row.id}`;
          return row;
        });
        if (!job) break;
        const payload = JSON.parse(job.payload) as NetworkJob;
        try {
          await this.database.read(async (tx) => {
            const customer = await this.scope.customer(tx, job.customer_id);
            const [building] = await tx`SELECT disabled FROM buildings WHERE id=${customer.building_id}`;
            if (!building || building.disabled) throw new BadRequestException('El edificio está deshabilitado.');
            for (const id of [payload.routerId, payload.previous?.routerId].filter(Boolean)) {
              const [router] = await tx`SELECT building_id FROM routers WHERE id=${id!}`;
              if (!router || router.building_id !== customer.building_id) throw new BadRequestException('La orden apunta a otro edificio.');
            }
            if (payload.routerId && payload.routerId !== (await this.scope.centralFor(tx, customer.building_id))) {
              throw new BadRequestException('La orden no corresponde al equipo central actual.');
            }
          });
          let groupedApplied = false;
          if (payload.grouped) groupedApplied = await controlDepartment(this.database, this.routers, job.customer_id, payload);
          if (!payload.grouped && payload.previous) await this.routers.releaseClient(payload.previous.routerId, payload.previous.ip);
          if (!payload.grouped && payload.routerId && payload.ip) {
            await this.routers.action(payload.routerId, { action: payload.status === 'active' ? 'reactivate' : 'suspend', ip: payload.ip }, true);
            if (payload.status === 'active') await this.routers.action(payload.routerId, { action: 'speed_limit', ip: payload.ip, down: payload.down, up: payload.up }, true);
          }
          const applied = payload.grouped ? groupedApplied : Boolean(payload.routerId && payload.ip);
          if (!applied) {
            const diagnostic = !payload.routerId
              ? 'El edificio no tiene equipo central asignado. Asigna un MikroTik central y reintenta la orden.'
              : 'El departamento no tiene IP privada. Asigna una IP y reintenta la orden.';
            const retryAt = new Date(Date.now() + Math.min(900000, 30000 * 2 ** Math.min(Number(job.attempts), 5))).toISOString();
            await this.database.write(async (tx) => {
              await tx`UPDATE commands SET status='failed',mode='mikrotik-failed',next_attempt=${retryAt},last_error=${diagnostic} WHERE id=${job.id}`;
              await tx`UPDATE customers SET network_state=${!payload.ip && !payload.grouped ? 'no_ip' : 'failed'},network_checked_at=${now()} WHERE id=${job.customer_id} AND NOT EXISTS (SELECT 1 FROM commands WHERE customer_id=${job.customer_id} AND id>${job.id})`;
              const owner = await this.scope.customer(tx, job.customer_id);
              if (Number(job.attempts) === 0) await this.scope.log(tx, `Orden #${job.id}: sin aplicar; ${diagnostic}`, owner.building_id);
            });
            continue;
          }
          const status = 'applied';
          await this.database.write(async (tx) => {
            await tx`UPDATE commands SET status=${status},mode='mikrotik',last_error=NULL WHERE id=${job.id}`;
            await tx`UPDATE customers SET network_state=${status},network_checked_at=${now()} WHERE id=${job.customer_id} AND NOT EXISTS (SELECT 1 FROM commands WHERE customer_id=${job.customer_id} AND id>${job.id})`;
            const owner = await this.scope.customer(tx, job.customer_id);
            await this.scope.log(tx, `Orden #${job.id}: aplicada en el equipo central.`, owner.building_id);
          });
        } catch (error) {
          const diagnostic = networkError(error);
          const retryAt = new Date(Date.now() + Math.min(900000, 30000 * 2 ** Math.min(Number(job.attempts), 5))).toISOString();
          await this.database.write(async (tx) => {
            await tx`UPDATE commands SET status='failed',mode='mikrotik-failed',next_attempt=${retryAt},last_error=${diagnostic} WHERE id=${job.id}`;
            await tx`UPDATE customers SET network_state='failed' WHERE id=${job.customer_id}`;
            const owner = await this.scope.customer(tx, job.customer_id);
            if (Number(job.attempts) === 0) await this.scope.log(tx, `Orden #${job.id}: fallo de red; se reintentará automáticamente.`, owner.building_id);
          });
        }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      try {
        if (token) await this.releaseTask('network', token);
      } finally {
        this.processing = false;
      }
    }
  }

  async setBuildingCentral(dto: BuildingCentralDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write((tx) => this.setBuildingCentralInTransaction(tx, dto));
  }

  async setBuildingCentralInTransaction(tx: TransactionSQL, dto: BuildingCentralDto): Promise<void> {
    this.scope.requireSuperadmin();
    const [b] = await tx`SELECT id FROM buildings WHERE id=${dto.building_id}`;
    if (!b) throw new BadRequestException('Edificio no encontrado.');
    if (!dto.central_router_id) throw new BadRequestException('Asigna un router MikroTik central. El equipo central es obligatorio.');
    const [router] = await tx`SELECT id, adapter, building_id, disabled FROM routers WHERE id=${dto.central_router_id}`;
    if (!router || !(enforcingAdapters as string[]).includes(router.adapter)) throw new BadRequestException('Selecciona un router con control de escritura.');
    if ((router as unknown as { disabled: number }).disabled) throw new BadRequestException('El router está deshabilitado. Habilítalo antes de usarlo como central.');
    if (router.building_id !== dto.building_id) {
      if (router.building_id !== null) throw new BadRequestException('El router pertenece a otro edificio.');
      await tx`UPDATE routers SET building_id=${dto.building_id} WHERE id=${dto.central_router_id}`;
    }
    const [prev] = await tx`SELECT central_router_id FROM buildings WHERE id=${dto.building_id}`;
    if ((prev?.central_router_id || null) === (dto.central_router_id || null)) return;
    // El bloqueo protege un cambio de equipo: sin central previo, las órdenes en
    // conflicto son las que fallaron por esa misma ausencia y esta asignación es lo
    // que las desbloquea. Exigir resolverlas antes dejaría al edificio sin forma de
    // recibir su primer equipo central.
    if (prev?.central_router_id && (await tx`SELECT q.id FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${dto.building_id} AND q.status IN ('pending','failed','running') LIMIT 1`).length) {
      throw new BadRequestException('Resuelve las órdenes pendientes antes de cambiar el equipo central.');
    }
    await tx`UPDATE buildings SET central_router_id=${dto.central_router_id || null} WHERE id=${dto.building_id}`;
    const customers = await tx`SELECT id FROM customers WHERE building_id=${dto.building_id} AND ip IS NOT NULL`;
    for (const row of customers) {
      const customer = await this.scope.customer(tx, row.id);
      await this.queue(tx, customer, prev?.central_router_id && customer.ip ? { routerId: prev.central_router_id, ip: customer.ip } : undefined);
    }
    await this.scope.log(tx, `Equipo central del edificio ${dto.building_id} actualizado.`, dto.building_id);
  }
}
