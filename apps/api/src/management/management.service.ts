import { controlDepartment } from './department-control';
import { networkError } from './network-error';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../database/database.service';
import { enforcingAdapters } from '../routers/router.types';
import { validateRouterHost } from '../routers/router-network';
import { RoutersService } from '../routers/routers.service';
import { requestContext, isSystem, runAsSystem } from '../common/request-context';
import { notificationChannel, NotifierService } from './notifier.service';
import { AccessDto, ArchiveCustomerDto, AssignBuildingDto, BillingDto, BuildingCentralDto, CreateBuildingDto, CreateCustomerDto, CreatePlanDto, PayDto, RemoveBuildingDto, ReversePaymentDto, SetCustomerIpDto, SettingsDto, StateQuery, ToggleBuildingDto, UpdateBuildingDto, UpdateCustomerDto, UpdatePlanDto } from './dto';
import { readSnapshot } from './snapshot';

interface Customer { id: number; apartment: string; name: string; phone: string; status: 'active' | 'suspended'; ip: string | null; plan_id: number | null; building_id: number | null; archived: number; manual_hold: number; down: number | null; up: number | null }
interface NetworkJob { routerId: number | null; ip: string | null; status: 'active' | 'suspended'; down: number; up: number; previous?: { routerId: number; ip: string }; grouped?: boolean }
const now = () => new Date().toISOString();
export function localDay(date = new Date()) { return date.toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }); }
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const ipValue = (value?: string | null) => { if (!value?.trim()) return null; validateRouterHost(value.trim()); return value.trim(); };
// B6: caché breve de tráfico por router (20s, memoria por instancia).
const portalTrafficCache = new Map<number, { at: number; stats: { name: string }[] }>();

@Injectable()
export class ManagementService {
  private processing = false;
  constructor(private readonly database: DatabaseService, private readonly routers: RoutersService, private readonly notifier: NotifierService) {}

  async settings(tx?: TransactionSQL): Promise<SettingsDto> {
    const cron = Number(process.env.OVERDUE_CRON_MINUTES || 0);
    const defaults: SettingsDto = { building_name: 'Mi edificio', currency: process.env.CURRENCY || '', grace_days: 0, auto_billing: false, billing_day: 1, due_day: 10, overdue_minutes: Number.isInteger(cron) && cron>=0 && cron<=1440 ? cron : 0, monitor_minutes: 0, reminder_days: 3, reminders_enabled: false, backup_hours: 0, portal_link_days: 0 };
    const read = async (sql: TransactionSQL) => { const [row] = await sql`SELECT value FROM settings WHERE key='operations'`; const stored=JSON.parse(row?.value || '{}'); delete stored.central_router_id; return { ...defaults, ...stored } as SettingsDto; };
    return tx ? read(tx) : this.database.read(read);
  }
  private async log(tx: TransactionSQL, message: string, buildingId: number | null = null) { await tx`INSERT INTO events(message,actor,building_id) VALUES (${message},${requestContext.getStore()?.username || 'Sistema'},${buildingId})`; }
  private async customer(tx: TransactionSQL, id: number): Promise<Customer> {
    const [customer] = await tx<Customer[]>`SELECT c.*,p.down,p.up FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE c.id=${id}`;
    if (!customer) throw new BadRequestException('Departamento no encontrado.');
    await this.requireBuilding(tx, customer.building_id);
    return customer;
  }
  private async actorBuildings(tx: TransactionSQL): Promise<number[]> {
    const actor = requestContext.getStore();
    // B7: sin actor no hay privilegios; el sistema usa SYSTEM_ACTOR explícito.
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad. Las tareas internas deben usar el actor de sistema.');
    if (isSystem(actor) || actor.role === 'superadmin') return (await tx`SELECT id FROM buildings ORDER BY id` as unknown as { id: number }[]).map(b => b.id);
    return (await tx`SELECT ub.building_id id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND b.disabled=0 ORDER BY ub.building_id` as unknown as { id: number }[]).map(b => b.id);
  }
  private async requireBuilding(tx: TransactionSQL, buildingId: number | null): Promise<void> {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    if (isSystem(actor) || actor.role === 'superadmin') return;
    if (!buildingId) throw new ForbiddenException('Sin acceso a este edificio.');
    const rows = await tx`SELECT b.id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND ub.building_id=${buildingId} AND b.disabled=0`;
    if (!rows.length) throw new ForbiddenException('Sin acceso a este edificio.');
  }
  private async resolveBuilding(tx: TransactionSQL, requested?: number | null): Promise<number> {
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
    if (allowed.length > 1 && requestContext.getStore() && !isSystem(requestContext.getStore())) throw new BadRequestException('Selecciona el edificio para esta operación.');
    if (allowed.length) return allowed[0];
    throw new BadRequestException('No tienes edificios asignados. Pide al super-admin que te asigne uno.');
  }
  private async centralFor(tx: TransactionSQL, buildingId: number | null): Promise<number | null> {
    if (!buildingId) return null;
    const [router] = await tx`SELECT r.id FROM buildings b JOIN routers r ON r.id=b.central_router_id AND r.building_id=b.id WHERE b.id=${buildingId} AND b.disabled=0 AND r.disabled=0 AND r.adapter='mikrotik-rest'`;
    return router?.id || null;
  }
  private async checkIpFree(tx: TransactionSQL, ip: string | null, buildingId: number, exceptId?: number) {
    if (!ip) return;
    const rows = await tx<{id:number}[]>`SELECT id FROM customers WHERE ip=${ip} AND building_id=${buildingId}`;
    if (rows.some(row => row.id !== exceptId)) throw new BadRequestException('Esa IP ya está asignada a otro departamento del edificio.');
    const tracked=await tx<{customer_id:number}[]>`SELECT t.customer_id FROM customer_network_targets t JOIN routers r ON r.id=t.router_id WHERE r.building_id=${buildingId} AND t.ip=${ip}`;
    if(tracked.some(t=>t.customer_id!==exceptId))throw new BadRequestException('La IP conserva reglas de otro departamento. Espera a que finalice su limpieza.');
    const jobs = await tx<{customer_id:number;payload:string}[]>`SELECT q.customer_id,q.payload FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${buildingId} AND q.status IN ('pending','failed','running') AND payload IS NOT NULL`;
    if (jobs.some(job => job.customer_id !== exceptId && [JSON.parse(job.payload).ip,JSON.parse(job.payload).previous?.ip].includes(ip))) throw new BadRequestException('Esa IP tiene cambios de red pendientes. Espera a que finalicen.');
  }
  private async queue(tx: TransactionSQL, customer: Customer, previous?: NetworkJob['previous']) {
    const routerId = await this.centralFor(tx, customer.building_id);
    const grouped=Boolean((await tx`SELECT customer_id FROM customer_devices WHERE customer_id=${customer.id} UNION SELECT customer_id FROM customer_network_targets WHERE customer_id=${customer.id}`).length);
    const payload: NetworkJob = { grouped,routerId, ip: customer.ip, status: customer.status, down: customer.down ?? 0, up: customer.up ?? 0, previous };
    const status = (payload.routerId && (payload.ip || grouped)) || previous || grouped ? 'pending' : 'simulated';
    await tx`INSERT INTO commands(customer_id,action,status,payload,next_attempt) VALUES (${customer.id},${customer.status === 'active' ? 'activate' : 'suspend'},${status},${JSON.stringify(payload)},${now()})`;
    await tx`UPDATE customers SET network_state=${status},network_checked_at=NULL WHERE id=${customer.id}`;
  }
  private async access(tx: TransactionSQL, customer: Customer, status: Customer['status'], reason: string, force = false) {
    if (customer.status === status && !force) return;
    await tx`UPDATE customers SET status=${status} WHERE id=${customer.id}`;
    await this.queue(tx, { ...customer, status });
    await this.log(tx, `${customer.apartment}: servicio solicitado ${status === 'active' ? 'activo' : 'suspendido'}. ${reason}`, customer.building_id);
  }
  private async hasOverdue(tx: TransactionSQL, customerId: number) {
    const config = await this.settings(tx);
    const rows = await tx`SELECT id FROM invoices WHERE customer_id=${customerId} AND paid_at IS NULL AND due < ${shiftDay(localDay(), -config.grace_days)} LIMIT 1`;
    return rows.length > 0;
  }
  async snapshot(query: StateQuery = {}) {
    return this.database.read(async tx => {
      const actor = requestContext.getStore();
      const allowed = await this.actorBuildings(tx);
      let bid = query.building_id || 0;
      if (bid) await this.requireBuilding(tx, bid);
      else if (actor && !isSystem(actor) && actor?.role !== 'superadmin') {
        if (!allowed.length) throw new ForbiddenException('No tienes edificios asignados.');
        bid = allowed[0];
      }
      const snap = await readSnapshot(tx, await this.settings(tx), { ...query, building_id: bid || undefined }, this.database.driver);
      const buildings = !actor || isSystem(actor) || actor.role === 'superadmin'
        ? await tx`SELECT * FROM buildings ORDER BY id`
        : await tx`SELECT b.* FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=${actor.id} ORDER BY b.id`;
      // B5: el estado nunca expone el enlace completo; solo metadatos y un
      // indicador de existencia. El token solo se entrega una vez al emitirlo.
      const customers = (snap.customers as unknown as Record<string, unknown>[]).map(c => {
        const { access_token, access_token_hash, ...safe } = c;
        void access_token; void access_token_hash;
        return { ...safe, has_portal_link: true };
      });
      return { ...snap, customers, buildings, active_building_id: bid || null };
    });
  }
  private requireSuperadmin() {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    if (isSystem(actor)) return; // tareas internas explícitas del sistema
    if (actor.role !== 'superadmin') throw new ForbiddenException('Solo el super-admin puede gestionar edificios y accesos.');
  }
  async listBuildings() {
    return this.database.read(async tx => {
      const actor = requestContext.getStore();
      if (!actor || actor?.role === 'superadmin') return tx`SELECT * FROM buildings ORDER BY id`;
      return tx`SELECT b.* FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=${actor!.id} AND b.disabled=0 ORDER BY b.id`;
    });
  }
  async createBuilding(dto: CreateBuildingDto) {
    this.requireSuperadmin();
    const id = await this.database.write(async tx => {
      const [row] = await tx`INSERT INTO buildings(name,address,created_at) VALUES (${dto.name.trim()},${dto.address.trim()},${now()}) RETURNING id`;
      const bid = (row as unknown as { id: number }).id;
      if (dto.admin_id) {
        const [admin] = await tx`SELECT id, role FROM users WHERE id=${dto.admin_id}`;
        if (!admin) throw new BadRequestException('Administrador no encontrado.');
        if ((admin as unknown as { role: string }).role !== 'admin') throw new BadRequestException('Solo un administrador de edificio puede vincularse al crear.');
        await tx`INSERT INTO user_buildings(user_id,building_id) VALUES (${dto.admin_id},${bid}) ON CONFLICT(user_id,building_id) DO NOTHING`;
      }
      await this.log(tx, `Edificio creado: ${dto.name.trim()}.`, bid);
      return bid;
    });
    return { id };
  }
  async assignBuilding(dto: AssignBuildingDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const [user] = await tx`SELECT id, role FROM users WHERE id=${dto.user_id}`;
      if (!user) throw new BadRequestException('Usuario no encontrado.');
      if ((user as unknown as { role: string }).role === 'superadmin') throw new BadRequestException('El super-admin no se vincula a edificios: ve todo el sistema por rol.');
      const [building] = await tx`SELECT id, disabled FROM buildings WHERE id=${dto.building_id}`;
      if (!building) throw new BadRequestException('Edificio no encontrado.');
      if ((building as unknown as { disabled: number }).disabled) throw new BadRequestException('El edificio está deshabilitado. Habilítalo antes de asignar accesos.');
      await tx`INSERT INTO user_buildings(user_id,building_id) VALUES (${dto.user_id},${dto.building_id}) ON CONFLICT(user_id,building_id) DO NOTHING`;
      await this.log(tx, `Acceso asignado: usuario ${dto.user_id} al edificio ${dto.building_id}.`, dto.building_id);
    });
    return { ok: true };
  }
  async unassignBuilding(dto: AssignBuildingDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      await tx`DELETE FROM user_buildings WHERE user_id=${dto.user_id} AND building_id=${dto.building_id}`;
      await this.log(tx, `Acceso retirado: usuario ${dto.user_id} del edificio ${dto.building_id}.`, dto.building_id);
    });
    return { ok: true };
  }
  async updateBuilding(dto: UpdateBuildingDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const rows = await tx`UPDATE buildings SET name=${dto.name.trim()},address=${dto.address.trim()} WHERE id=${dto.building_id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Edificio no encontrado.');
      await this.log(tx, `Edificio actualizado: ${dto.name.trim()}.`, dto.building_id);
    });
    return this.snapshot();
  }
  async toggleBuilding(dto: ToggleBuildingDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const rows = await tx`UPDATE buildings SET disabled=${dto.disabled ? 1 : 0} WHERE id=${dto.building_id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Edificio no encontrado.');
      await this.log(tx, `Edificio ${dto.building_id} ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`, dto.building_id);
    });
    return this.snapshot();
  }
  async removeBuilding(dto: RemoveBuildingDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const [building] = await tx`SELECT id, name FROM buildings WHERE id=${dto.building_id}`;
      if (!building) throw new BadRequestException('Edificio no encontrado.');
      const [customers] = await tx`SELECT COUNT(*) n FROM customers WHERE building_id=${dto.building_id}`;
      const [routers] = await tx`SELECT COUNT(*) n FROM routers WHERE building_id=${dto.building_id}`;
      const [plans] = await tx`SELECT COUNT(*) n FROM plans WHERE building_id=${dto.building_id}`;
      const parts: string[] = [];
      if (Number(customers.n)) parts.push(`${customers.n} departamentos`);
      if (Number(routers.n)) parts.push(`${routers.n} routers`);
      if (Number(plans.n)) parts.push(`${plans.n} planes`);
      if (parts.length) throw new ConflictException(`No se puede eliminar: el edificio tiene ${parts.join(', ')}. Reasigna o elimina esos registros primero.`);
      await tx`DELETE FROM user_buildings WHERE building_id=${dto.building_id}`;
      await tx`DELETE FROM buildings WHERE id=${dto.building_id}`;
      await this.log(tx, `Edificio eliminado del sistema: ${(building as unknown as { name: string }).name}.`);
    });
    return this.snapshot();
  }

  async saveSettings(dto: SettingsDto) {
    this.requireSuperadmin();
    if ('central_router_id' in dto) throw new BadRequestException('El equipo central se configura únicamente por edificio.');
    this.requireSuperadmin();
    if (dto.auto_billing && dto.due_day < dto.billing_day) throw new BadRequestException('El vencimiento debe ser igual o posterior al día de generación.');
    await this.database.write(async tx => {
      await tx`INSERT INTO settings(key,value) VALUES ('operations',${JSON.stringify(dto)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      await this.log(tx,'Configuración del edificio actualizada.');
    });
    return this.snapshot();
  }
  async createPlan(dto: CreatePlanDto) {
    await this.database.write(async tx => {
      const bid = await this.resolveBuilding(tx, dto.building_id);
      await tx`INSERT INTO plans(name,down,up,price,building_id) VALUES (${dto.name.trim()},${dto.down},${dto.up},${Math.round(dto.price*100)},${bid})`;
      await this.log(tx,`Plan creado: ${dto.name.trim()}.`, bid);
    });
    return this.snapshot();
  }
  async updatePlan(dto: UpdatePlanDto) {
    await this.database.write(async tx => {
      const [plan] = await tx`SELECT building_id FROM plans WHERE id=${dto.id}`;
      if (!plan) throw new BadRequestException('Plan no encontrado.');
      await this.requireBuilding(tx, plan.building_id);
      const rows = await tx`UPDATE plans SET name=${dto.name.trim()},down=${dto.down},up=${dto.up},price=${Math.round(dto.price*100)} WHERE id=${dto.id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Plan no encontrado.');
      const customers = await tx`SELECT id FROM customers WHERE plan_id=${dto.id} AND archived=0`;
      for (const customer of customers) await this.queue(tx,await this.customer(tx,customer.id));
      await this.log(tx,`Plan actualizado: ${dto.name}. Las cuotas existentes conservan su importe.`, plan.building_id);
    });
    return this.snapshot();
  }
  async createCustomer(dto: CreateCustomerDto) {
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const created = await this.database.write(async tx => {
      const bid = await this.resolveBuilding(tx, dto.building_id);
      const planId = dto.plan_id === undefined || dto.plan_id === null || (dto.plan_id as unknown as string) === '' ? null : Number(dto.plan_id);
      let plan: { id: number; building_id: number | null } | undefined;
      if (planId !== null) {
        if (!Number.isInteger(planId) || planId < 1) throw new BadRequestException('Plan inválido.');
        [plan] = await tx`SELECT id, building_id FROM plans WHERE id=${planId}`;
        if (!plan) throw new BadRequestException('Selecciona un plan existente.');
        if (plan.building_id && plan.building_id !== bid) throw new BadRequestException('El plan pertenece a otro edificio.');
      }
      const ip = ipValue(dto.ip); await this.checkIpFree(tx,ip,bid);
      const [existing] = await tx`SELECT id FROM customers WHERE apartment=${dto.apartment.trim()} AND building_id=${bid}`;
      if (existing) throw new BadRequestException('Ya existe ese departamento en el edificio.');
      // B5: el enlace completo se devuelve una sola vez; en la base solo el hash.
      const [row] = await tx`INSERT INTO customers(apartment,name,phone,plan_id,ip,building_id,access_token,access_token_hash,access_issued_at,access_expires_at,access_version) VALUES (${dto.apartment.trim()},${(dto.name || '').trim()},${(dto.phone || '').trim()},${planId},${ip},${bid},${null},${this.hashPortalToken(portalToken)},${issued},${this.portalExpiry(await this.settings(tx))},1) RETURNING id`;
      if (ip) await this.queue(tx,await this.customer(tx,row.id));
      await this.log(tx,`Departamento ${dto.apartment.trim()} registrado.`, bid);
      return { createdId: (row as unknown as { id: number }).id };
    });
    return { ...(await this.snapshot()), portal_link: { customer_id: created.createdId, token: portalToken, issued_at: issued } };
  }
  private async changeIp(tx: TransactionSQL, customer: Customer, ip: string | null) {
    await this.checkIpFree(tx,ip,customer.building_id!,customer.id);
    const centralId = await this.centralFor(tx, customer.building_id);
    await tx`UPDATE customers SET ip=${ip} WHERE id=${customer.id}`;
    const previous = customer.ip && customer.ip !== ip && centralId ? { routerId: centralId,ip: customer.ip } : undefined;
    await this.queue(tx,{ ...customer,ip },previous);
  }
  async updateCustomer(dto: UpdateCustomerDto) {
    await this.database.write(async tx => {
      const before = await this.customer(tx,dto.id);
      const planId = dto.plan_id === undefined || dto.plan_id === null || (dto.plan_id as unknown as string) === '' ? null : Number(dto.plan_id);
      if (planId !== null) {
        if (!Number.isInteger(planId) || planId < 1) throw new BadRequestException('Plan inválido.');
        const [plan] = await tx`SELECT id, building_id FROM plans WHERE id=${planId}`;
        if (!plan) throw new BadRequestException('Selecciona un plan existente.');
        if (plan.building_id && before.building_id && plan.building_id !== before.building_id) throw new BadRequestException('El plan pertenece a otro edificio.');
      }
      const [dup] = await tx`SELECT id FROM customers WHERE apartment=${dto.apartment.trim()} AND building_id=${before.building_id} AND id<>${dto.id}`;
      if (dup) throw new BadRequestException('Ya existe ese departamento en el edificio.');
      await tx`UPDATE customers SET apartment=${dto.apartment.trim()},name=${(dto.name || '').trim()},phone=${(dto.phone || '').trim()},plan_id=${planId} WHERE id=${dto.id}`;
      const customer = await this.customer(tx,dto.id), ip = dto.ip === undefined ? before.ip : ipValue(dto.ip);
      if (ip !== before.ip) await this.changeIp(tx,customer,ip);
      else if (before.plan_id !== planId) await this.queue(tx,customer);
      await this.log(tx,`Departamento ${dto.apartment.trim()} actualizado.`, customer.building_id);
    });
    return this.snapshot();
  }
  async setCustomerIp(dto: SetCustomerIpDto) {
    await this.database.write(async tx => {
      const customer = await this.customer(tx,dto.id);
      await this.changeIp(tx,customer,ipValue(dto.ip));
      await this.log(tx,`${customer.apartment}: IP actualizada; limpieza y sincronización de reglas solicitadas.`, customer.building_id);
    });
    return this.snapshot();
  }
  async archiveCustomer(dto: ArchiveCustomerDto) {
    await this.database.write(async tx => {
      const customer = await this.customer(tx,dto.id);
      await tx`UPDATE customers SET archived=${dto.archived ? 1 : 0},manual_hold=1 WHERE id=${dto.id}`;
      await this.access(tx,customer,'suspended',dto.archived ? 'Departamento archivado: sin nuevas cuotas.' : 'Departamento restaurado. Reactiva cuando corresponda.',true);
      await this.log(tx,`${customer.apartment}: ${dto.archived ? 'archivado' : 'restaurado'}; historial conservado.`, customer.building_id);
    });
    return this.snapshot();
  }
  async changeAccess(dto: AccessDto) {
    await this.database.write(async tx => {
      const customer = await this.customer(tx,dto.id);
      if (customer.archived && dto.status === 'active') throw new BadRequestException('Restaura el departamento antes de reactivarlo.');
      await tx`UPDATE customers SET manual_hold=${dto.status === 'suspended' ? 1 : 0} WHERE id=${dto.id}`;
      await this.access(tx,customer,dto.status,'Cambio manual.',true);
    });
    return this.snapshot();
  }
  async generateBilling(dto: BillingDto) {
    if (!Number.isFinite(Date.parse(dto.due)) || new Date(dto.due).toISOString().slice(0,10) !== dto.due) throw new BadRequestException('Fecha inválida.');
    await this.database.write(async tx => {
      const actor = requestContext.getStore();
      const allowed = await this.actorBuildings(tx);
      if (!dto.building_id && actor && !isSystem(actor) && allowed.length > 1) throw new BadRequestException('Selecciona el edificio para generar mensualidades.');
      let bid = dto.building_id || 0;
      if (bid) await this.requireBuilding(tx, bid);
      else if (actor && !isSystem(actor) && actor?.role !== 'superadmin') {
        if (!allowed.length) throw new ForbiddenException('No tienes edificios asignados.');
        bid = allowed[0];
      }
      const customers = await tx`SELECT c.id,c.building_id,p.price FROM customers c JOIN plans p ON p.id=c.plan_id WHERE c.archived=0 AND (${bid}=0 OR c.building_id=${bid})`;
      const counts = new Map<number | null, number>();
      for (const customer of customers) {
        const count=(await tx`INSERT INTO invoices(customer_id,period,due,amount,paid_at) VALUES (${customer.id},${dto.period},${dto.due},${customer.price},${Number(customer.price)===0?now():null}) ON CONFLICT(customer_id,period) DO NOTHING RETURNING id`).length;
        if (count) counts.set(customer.building_id,(counts.get(customer.building_id) || 0)+count);
      }
      for (const [buildingId,count] of counts) await this.log(tx,`${count} mensualidades generadas para ${dto.period}.`, buildingId);
    });
    return this.snapshot();
  }
  async pay(dto: PayDto) {
    await this.database.write(async tx => {
      if (dto.request_key) {
        const [existing] = await tx`SELECT * FROM payments WHERE request_key=${dto.request_key}`;
        if (existing) {
          if (existing.invoice_id !== dto.id || (dto.amount !== undefined && existing.amount !== Math.round(dto.amount*100))) throw new BadRequestException('La referencia de operación ya se utilizó para otro pago.');
          return;
        }
      }
      const [invoice] = await tx`SELECT * FROM invoices WHERE id=${dto.id}`;
      if (!invoice) throw new BadRequestException('Mensualidad no encontrada.');
      if (invoice.paid_at) return;
      const [paid] = await tx`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=${dto.id} AND reversed_at IS NULL`;
      const balance=invoice.amount-Number(paid.total), amount=dto.amount === undefined ? balance : Math.round(dto.amount*100);
      if (amount<0 || amount>balance || (dto.amount !== undefined && amount===0)) throw new BadRequestException('El abono supera el saldo pendiente o no es válido.');
      if (amount>0) await tx`INSERT INTO payments(invoice_id,amount,created_at,method,reference,actor_id,request_key) VALUES (${dto.id},${amount},${now()},${dto.method || 'cash'},${dto.reference || ''},${requestContext.getStore()?.id || null},${dto.request_key || null})`;
      const customer=await this.customer(tx,invoice.customer_id);
      if (amount===balance) {
        await tx`UPDATE invoices SET paid_at=${now()} WHERE id=${dto.id}`;
        await this.log(tx,`Pago registrado: departamento ${customer.apartment}, periodo ${invoice.period}.`, customer.building_id);
        if (!customer.manual_hold && !customer.archived && !await this.hasOverdue(tx,customer.id)) await this.access(tx,customer,'active','Sin cuotas vencidas después del pago.');
      } else await this.log(tx,`Abono registrado: departamento ${customer.apartment}, periodo ${invoice.period}. Resta ${(balance-amount)/100}.`, customer.building_id);
    });
    return this.snapshot();
  }
  async reversePayment(dto: ReversePaymentDto) {
    await this.database.write(async tx => {
      const [payment] = await tx`SELECT * FROM payments WHERE id=${dto.id}`;
      if (!payment) throw new BadRequestException('Pago no encontrado.');
      if (payment.reversed_at) return;
      await tx`UPDATE payments SET reversed_at=${now()},reversed_by=${requestContext.getStore()?.id || null},reversal_reason=${dto.reason.trim()} WHERE id=${dto.id}`;
      const [inv]=await tx`SELECT amount FROM invoices WHERE id=${payment.invoice_id}`;
      const [covered]=await tx`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=${payment.invoice_id} AND reversed_at IS NULL`;
      await tx`UPDATE invoices SET paid_at=${Number(covered.total) >= Number(inv.amount) ? now() : null} WHERE id=${payment.invoice_id}`;
      const [invoice]=await tx`SELECT customer_id FROM invoices WHERE id=${payment.invoice_id}`;
      const customer=await this.customer(tx,invoice.customer_id);
      await this.log(tx,`Pago #${dto.id} revertido: ${dto.reason.trim()}.`, customer.building_id);
      if (await this.hasOverdue(tx,customer.id)) await this.access(tx,customer,'suspended','Saldo vencido después de revertir un pago.');
    });
    return this.snapshot();
  }
  private async signReceipt(tx:TransactionSQL,p:Record<string,unknown>) {
    const [key]=await tx`SELECT value FROM settings WHERE key='receipt-signature-key'`;
    return createHmac('sha256',key.value).update(JSON.stringify([p.id,p.amount,p.period,p.created_at,p.actor || null])).digest('hex');
  }
  async receipt(id: number) {
    return this.database.read(async tx => {
      const [payment]=await tx`SELECT p.*,i.period,c.apartment,c.name,c.building_id,b.name building_name,u.username actor FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN buildings b ON b.id=c.building_id LEFT JOIN users u ON u.id=p.actor_id WHERE p.id=${id}`;
      if (!payment) throw new BadRequestException('Pago no encontrado.');
      await this.requireBuilding(tx, payment.building_id);
      return { payment: {...payment,signature:await this.signReceipt(tx,payment)},settings: await this.settings(tx) };
    });
  }
  async reviewOverdue(auto=false) {
    await this.database.write(async tx => {
      const actor = requestContext.getStore();
      const allowed = await this.actorBuildings(tx);
      const scopes = (actor && (actor?.role === 'superadmin' || isSystem(actor))) ? [0] : allowed;
      if (!scopes.length) throw new ForbiddenException('No tienes edificios asignados.');
      const config=await this.settings(tx);
      let total = 0;
      for (const bid of scopes) {
        const customers=await tx`SELECT DISTINCT c.id FROM customers c JOIN invoices i ON i.customer_id=c.id WHERE c.archived=0 AND c.status='active' AND i.paid_at IS NULL AND i.due<${shiftDay(localDay(),-config.grace_days)} AND (${bid}=0 OR c.building_id=${bid})`;
        for (const row of customers) await this.access(tx,await this.customer(tx,row.id),'suspended','Mensualidad vencida.');
        total += customers.length;
        if (bid && (!auto || customers.length)) await this.log(tx,'Revisión de vencimientos completada.',bid);
      }
      if (scopes.includes(0) && (!auto || total)) await this.log(tx,'Revisión de vencimientos completada.');
    });
    return this.snapshot();
  }
  async setBuildingCentral(dto: BuildingCentralDto) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const [b] = await tx`SELECT id FROM buildings WHERE id=${dto.building_id}`;
      if (!b) throw new BadRequestException('Edificio no encontrado.');
      if (dto.central_router_id) {
        const [router] = await tx`SELECT id, adapter, building_id, disabled FROM routers WHERE id=${dto.central_router_id}`;
        if (!router || !(enforcingAdapters as string[]).includes(router.adapter)) throw new BadRequestException('Selecciona un router con control de escritura.');
        if ((router as unknown as { disabled: number }).disabled) throw new BadRequestException('El router está deshabilitado. Habilítalo antes de usarlo como central.');
        if (router.building_id !== dto.building_id) throw new BadRequestException('El router pertenece a otro edificio.');
      }
      if ((await tx`SELECT q.id FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${dto.building_id} AND q.status IN ('pending','failed','running') LIMIT 1`).length) throw new BadRequestException('Resuelve las órdenes pendientes antes de cambiar el equipo central.');
      const [prev] = await tx`SELECT central_router_id FROM buildings WHERE id=${dto.building_id}`;
      if ((prev?.central_router_id || null) === (dto.central_router_id || null)) return;
      await tx`UPDATE buildings SET central_router_id=${dto.central_router_id || null} WHERE id=${dto.building_id}`;
      const customers = await tx`SELECT id FROM customers WHERE building_id=${dto.building_id} AND ip IS NOT NULL`;
      for (const row of customers) {
        const customer = await this.customer(tx,row.id);
        await this.queue(tx,customer,prev?.central_router_id && customer.ip ? {routerId: prev.central_router_id,ip: customer.ip} : undefined);
      }
      await this.log(tx,`Equipo central del edificio ${dto.building_id} actualizado.`, dto.building_id);
    });
    return this.snapshot();
  }
  async retryCommand(id: number) {
    this.requireSuperadmin();
    await this.database.write(async tx => {
      const [job]=await tx`SELECT * FROM commands WHERE id=${id}`;
      if (!job?.payload || !['failed','pending'].includes(job.status)) throw new BadRequestException('La orden no admite reintento.');
      await tx`UPDATE commands SET status='pending',next_attempt=${now()} WHERE id=${id}`;
    });
    return this.snapshot();
  }
  async acquireTask(name: string, milliseconds=600000): Promise<string | null> {
    const token=randomUUID();
    return this.database.write(async tx => {
      const [lock]=await tx`SELECT * FROM task_locks WHERE name=${name}`;
      if (lock && lock.expires_at>now()) return null;
      await tx`INSERT INTO task_locks(name,token,expires_at) VALUES (${name},${token},${new Date(Date.now()+milliseconds).toISOString()}) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at`;
      return token;
    });
  }
  async releaseTask(name: string, token: string) { await this.database.write(tx => tx`DELETE FROM task_locks WHERE name=${name} AND token=${token}`); }
  async syncLinkedDevices() {
    await this.database.write(async tx=>{
      const dirty=await tx`SELECT customer_id FROM customer_network_dirty`;
      for(const row of dirty){
        if((await tx`SELECT id FROM commands WHERE customer_id=${row.customer_id} AND status IN ('pending','failed','running') LIMIT 1`).length)continue;
        await this.queue(tx,await this.customer(tx,row.customer_id));
        await tx`DELETE FROM customer_network_dirty WHERE customer_id=${row.customer_id}`;
      }
    });
  }
  async processQueue() {
    if (this.processing) return;
    this.processing=true;
    let token: string | null=null;
    let heartbeat:ReturnType<typeof setInterval> | undefined;
    try {
      token=await this.acquireTask('network',300000); if (!token) return;
      heartbeat=setInterval(()=>void this.database.write(tx=>tx`UPDATE task_locks SET expires_at=${new Date(Date.now()+300000).toISOString()} WHERE name='network' AND token=${token!}`).catch(()=>{}),30000);
      heartbeat.unref?.();
      await this.database.write(tx => tx`UPDATE commands SET status='pending' WHERE status='running'`);
      // C3: presupuesto por pasada para que un equipo lento no monopolice el
      // procesamiento (además del tope de 10 órdenes y el timeout REST de 12s).
      const deadline=Date.now()+240000;
      for (let n=0;n<10;n++) {
        if (Date.now()>deadline) break;
        const job=await this.database.write(async tx => {
          const [row]=await tx`SELECT q.* FROM commands q WHERE q.status IN ('pending','failed') AND q.next_attempt<=${now()} AND NOT EXISTS (SELECT 1 FROM commands older WHERE older.customer_id=q.customer_id AND older.id<q.id AND older.status IN ('pending','failed','running')) ORDER BY q.id LIMIT 1`;
          if (!row) return null;
          await tx`UPDATE task_locks SET expires_at=${new Date(Date.now()+300000).toISOString()} WHERE name='network' AND token=${token!}`;
          await tx`UPDATE commands SET status='running',attempts=attempts+1 WHERE id=${row.id}`;
          return row;
        });
        if (!job) break;
        const payload=JSON.parse(job.payload) as NetworkJob;
        try {
          await this.database.read(async tx => {
            const customer = await this.customer(tx,job.customer_id);
            const [building] = await tx`SELECT disabled FROM buildings WHERE id=${customer.building_id}`;
            if (!building || building.disabled) throw new BadRequestException('El edificio está deshabilitado.');
            for (const id of [payload.routerId,payload.previous?.routerId].filter(Boolean)) {
              const [router] = await tx`SELECT building_id FROM routers WHERE id=${id!}`;
              if (!router || router.building_id !== customer.building_id) throw new BadRequestException('La orden apunta a otro edificio.');
            }
            if (payload.routerId && payload.routerId !== await this.centralFor(tx,customer.building_id)) throw new BadRequestException('La orden no corresponde al equipo central actual.');
          });
          let groupedApplied=false;
          if(payload.grouped)groupedApplied=await controlDepartment(this.database,this.routers,job.customer_id,payload);
          if (!payload.grouped && payload.previous) await this.routers.releaseClient(payload.previous.routerId,payload.previous.ip);
          if (!payload.grouped && payload.routerId && payload.ip) {
            await this.routers.action(payload.routerId,{action:payload.status==='active'?'reactivate':'suspend',ip:payload.ip},true);
            if (payload.status==='active') await this.routers.action(payload.routerId,{action:'speed_limit',ip:payload.ip,down:payload.down,up:payload.up},true);
          }
          const applied=payload.grouped?groupedApplied:Boolean(payload.routerId && payload.ip), status=applied?'applied':'simulated';
          const customer=await this.database.write(async tx => {
            await tx`UPDATE commands SET status=${status},mode=${applied?'mikrotik':'simulated'},last_error=NULL WHERE id=${job.id}`;
            await tx`UPDATE customers SET network_state=${status},network_checked_at=${now()} WHERE id=${job.customer_id} AND NOT EXISTS (SELECT 1 FROM commands WHERE customer_id=${job.customer_id} AND id>${job.id})`;
            const owner = await this.customer(tx,job.customer_id);
            await this.log(tx,`Orden #${job.id}: ${applied?'aplicada en el equipo central':'limpieza terminada; servicio simulado'}.`, owner.building_id);
            return this.customer(tx,job.customer_id);
          });
          // C4: el aviso no decide el resultado de la orden. Si falla el
          // aviso, la regla ya quedó aplicada y no debe reintentarse la red.
          try {
            await this.notifier.notify(customer.phone || customer.apartment,`Departamento ${customer.apartment}: orden #${job.id} ${status==='applied'?'aplicada':'simulada'}, servicio ${payload.status==='active'?'activo':'suspendido'}.`, customer.building_id);
          } catch (noticeError) { console.error(`Orden #${job.id}: aplicada pero falló el aviso: ${noticeError instanceof Error ? noticeError.message : noticeError}`); }
        } catch (error) {
          const diagnostic=networkError(error);
          const retryAt=new Date(Date.now()+Math.min(900000,30000*2**Math.min(Number(job.attempts),5))).toISOString();
          await this.database.write(async tx => {
            await tx`UPDATE commands SET status='failed',mode='mikrotik-failed',next_attempt=${retryAt},last_error=${diagnostic} WHERE id=${job.id}`;
            await tx`UPDATE customers SET network_state='failed' WHERE id=${job.customer_id}`;
            const owner = await this.customer(tx,job.customer_id);
            if (Number(job.attempts)===0) await this.log(tx,`Orden #${job.id}: fallo de red; se reintentará automáticamente.`, owner.building_id);
          });
        }
      }
    } finally {
      if(heartbeat)clearInterval(heartbeat);
      try { if (token) await this.releaseTask('network',token); } finally { this.processing=false; }
    }
  }
  async sendReminders() {
    await this.database.write(async tx => {
      const settings=await this.settings(tx); if (!settings.reminders_enabled) return;
      const today=localDay(), deadline=shiftDay(today,settings.reminder_days);
      const invoices=await tx`SELECT i.*,c.apartment,c.phone,c.building_id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.paid_at IS NULL AND i.due<=${deadline} AND c.archived=0`;
      for (const invoice of invoices) {
        const inserted=await tx`INSERT INTO reminder_deliveries(invoice_id,day) VALUES (${invoice.id},${today}) ON CONFLICT(invoice_id,day) DO NOTHING RETURNING id`;
        if (inserted.length) await tx`INSERT INTO notifications(created_at,channel,target,message,building_id,delivery_status,next_attempt) VALUES (${now()},${notificationChannel()},${invoice.phone || invoice.apartment},${`Recordatorio: departamento ${invoice.apartment}, cuota ${invoice.period}, vencimiento ${invoice.due}. Consulta el saldo pendiente con administración.`},${invoice.building_id},${notificationChannel()==='whatsapp'?'pending':'internal'},${now()})`;
      }
    });
  }
  async audit() { this.requireSuperadmin(); return this.database.read(tx => tx`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`); }
  async processNotifications(){await this.notifier.processQueue?.();}

  // === WhatsApp directo ===
  async sendInvoiceWhatsapp(dto: { id: number; phone?: string; message?: string }) {
    const job = await this.database.read(async tx => {
      const [invoice] = await tx`SELECT i.*,c.apartment,c.name,c.phone,c.building_id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=${dto.id}`;
      if (!invoice) throw new BadRequestException('Factura no encontrada.');
      await this.requireBuilding(tx, invoice.building_id);
      const to = (dto.phone?.trim() || invoice.phone || invoice.apartment);
      const msg = dto.message?.trim() || `Estimado/a ${invoice.name}, le informamos que la cuota ${invoice.period} por monto ${invoice.amount / 100} vence el ${invoice.due}. Departamento: ${invoice.apartment}.`;
      return {to,msg,building_id:invoice.building_id};
    });
    await this.notifier.notify(job.to,job.msg,job.building_id);
    return {ok:true, status:notificationChannel()==='whatsapp'?'pending':'internal'};
  }

  async sendPaymentWhatsapp(dto: { id: number; phone?: string; message?: string }) {
    const job = await this.database.read(async tx => {
      const [payment] = await tx`SELECT p.*,i.period,c.apartment,c.name,c.phone,c.building_id FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.id=${dto.id}`;
      if (!payment) throw new BadRequestException('Pago no encontrado.');
      await this.requireBuilding(tx, payment.building_id);
      const to = (dto.phone?.trim() || payment.phone || payment.apartment);
      const msg = dto.message?.trim() || `Recibo de pago: departamento ${payment.apartment}, periodo ${payment.period}, monto ${payment.amount / 100}. Gracias por su pago.`;
      if(payment.reversed_at)throw new BadRequestException('El pago fue revertido.');
      return {to,msg,building_id:payment.building_id};
    });
    await this.notifier.notify(job.to,job.msg,job.building_id);
    return {ok:true, status:notificationChannel()==='whatsapp'?'pending':'internal'};
  }

  async publicNotice(buildingId?:number) {
    return this.database.read(async tx=>{
      if(!buildingId)return {message:process.env.NUWENET_SUSPENSION_MESSAGE || '',contact:process.env.NUWENET_ADMIN_CONTACT || ''};
      const [row]=await tx`SELECT s.value FROM settings s JOIN buildings b ON s.key=${'bank:'+buildingId} WHERE b.id=${buildingId} AND b.disabled=0`;
      const bank=JSON.parse(row?.value || '{}');return {message:bank.suspension_message||'',contact:bank.contact||''};
    });
  }
  async invoiceBank(id:number) {
    const bid=await this.database.read(async tx=>{const [i]=await tx`SELECT c.building_id FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=${id}`;if(!i)throw new BadRequestException('Mensualidad no encontrada.');await this.requireBuilding(tx,i.building_id);return i.building_id;});
    return this.bankSettings(bid);
  }
  async bankSettings(buildingId: number) {
    return this.database.read(async tx=>{await this.requireBuilding(tx,buildingId);const [row]=await tx`SELECT value FROM settings WHERE key=${'bank:'+buildingId}`;return JSON.parse(row?.value || '{}');});
  }
  async saveBankSettings(buildingId:number,dto:Record<string,unknown>) {
    await this.database.write(async tx=>{await this.requireBuilding(tx,buildingId);const [building]=await tx`SELECT id FROM buildings WHERE id=${buildingId}`;if(!building)throw new BadRequestException('Edificio no encontrado.');await tx`INSERT INTO settings(key,value) VALUES (${'bank:'+buildingId},${JSON.stringify(dto)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;await this.log(tx,'Datos bancarios actualizados.',buildingId);});return {ok:true};
  }
  // === Portal del Residente: ciclo de vida del enlace (B1–B4) ===
  private portalExpiry(config: SettingsDto): string | null {
    const days = Number(config.portal_link_days || 0);
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() + days * 86400000).toISOString();
  }
  // B5: el enlace completo solo existe al emitirlo; en reposo solo su hash
  // SHA-256 hex. validatePortal acepta filas heredadas sin hash (plain) para
  // no invalidar copias anteriores; las emisiones nuevas guardan solo el hash.
  private hashPortalToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  // B4: validación única para datos, consumo, tráfico y reportes. No revela si
  // el fallo fue por token, archivo, edificio o caducidad.
  private async validatePortal(tx: TransactionSQL, token: string): Promise<{ id: number; building_id: number }> {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token || '')) throw new BadRequestException('Token inválido o departamento no encontrado.');
    const hash = this.hashPortalToken(token);
    const [customer] = await tx`SELECT c.id,c.building_id,c.access_expires_at FROM customers c JOIN buildings b ON b.id=c.building_id WHERE (c.access_token_hash=${hash} OR (c.access_token_hash IS NULL AND c.access_token=${token})) AND c.archived=0 AND b.disabled=0`;
    if (!customer) throw new BadRequestException('Token inválido o departamento no encontrado.');
    const expires = (customer as unknown as { access_expires_at: string | null }).access_expires_at;
    if (expires && expires <= now()) throw new BadRequestException('Token inválido o departamento no encontrado.');
    return customer as unknown as { id: number; building_id: number };
  }
  // B2: rotación atómica. Solo super-admin o admin autorizado del edificio
  // (requireBuilding vía customer()). Invalida el enlace anterior de inmediato
  // y audita sin guardar el token.
  async rotatePortalLink(id: number) {
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const version = await this.database.write(async tx => {
      const customer = await this.customer(tx, id);
      const config = await this.settings(tx);
      const rows = await tx`UPDATE customers SET access_token=${null},access_token_hash=${this.hashPortalToken(portalToken)},access_issued_at=${issued},access_expires_at=${this.portalExpiry(config)},access_version=COALESCE(access_version,0)+1 WHERE id=${id} RETURNING access_version`;
      if (!rows.length) throw new BadRequestException('Departamento no encontrado.');
      const v = (rows[0] as unknown as { access_version: number }).access_version;
      await this.log(tx, `Enlace del portal regenerado: departamento ${customer.apartment} (v${v}). El enlace anterior quedó invalidado.`, customer.building_id);
      return v;
    });
    return { ...(await this.snapshot()), portal_link: { customer_id: id, token: portalToken, issued_at: issued, version } };
  }
  // B3: cambio explícito de titular. Separa la corrección simple de nombre
  // (updateCustomer) de un cambio de ocupante: invalida el acceso anterior.
  // La entrega del nuevo enlace es otra operación (ver enlace del portal).
  async changeHolder(id: number, name: string, phone?: string) {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new BadRequestException('Indica el nombre del nuevo titular.');
    if (cleanName.length > 160) throw new BadRequestException('Nombre demasiado largo.');
    const cleanPhone = (phone || '').trim().slice(0, 80);
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const version = await this.database.write(async tx => {
      const customer = await this.customer(tx, id);
      const config = await this.settings(tx);
      const rows = await tx`UPDATE customers SET name=${cleanName},phone=${cleanPhone},access_token=${null},access_token_hash=${this.hashPortalToken(portalToken)},access_issued_at=${issued},access_expires_at=${this.portalExpiry(config)},access_version=COALESCE(access_version,0)+1 WHERE id=${id} RETURNING access_version`;
      if (!rows.length) throw new BadRequestException('Departamento no encontrado.');
      const v = (rows[0] as unknown as { access_version: number }).access_version;
      await this.log(tx, `Cambio de titular en departamento ${customer.apartment}: acceso anterior invalidado. Entrega el nuevo enlace por un canal distinto.`, customer.building_id);
      return v;
    });
    return { ...(await this.snapshot()), portal_link: { customer_id: id, token: portalToken, issued_at: issued, version } };
  }
  async portalTraffic(token:string) {
    await this.portalData(token);
    const scope=await this.database.read(async tx=>{const c=await this.validatePortal(tx,token);const [row]=await tx`SELECT id,ip FROM customers WHERE id=${c.id}`;const ips=await tx`SELECT ip FROM customer_network_targets WHERE customer_id=${c.id}`;return {id:c.id,ips:[(row as unknown as { ip: string | null }).ip,...ips.map((x:{ip:string})=>x.ip)].filter(Boolean),routerId:await this.centralFor(tx,c.building_id)};});
    if(!scope.routerId)return {available:false,stats:[]};
    // B6: caché breve por router para no disparar una lectura completa por
    // visitante. TTL 20s en memoria por instancia; en varias instancias cada
    // una conserva su caché (coordinación central pendiente).
    const nowMs = Date.now();
    const cached = portalTrafficCache.get(scope.routerId);
    let stats;
    if (cached && nowMs - cached.at < 20_000) {
      stats = cached.stats;
    } else {
      // B7: la lectura del router corre como sistema; el alcance ya quedó
      // fijado por el token del residente (su edificio/router).
      try { stats=await runAsSystem(()=>this.routers.getTraffic(scope.routerId!)); }
      catch { return {available:false,stats:[]}; }
      portalTrafficCache.set(scope.routerId, { at: nowMs, stats });
    }
    try {return {available:true,stats:stats.filter(q=>q.name===`nuwenet-department-${scope.id}` || scope.ips.some(ip=>q.name===`nuwenet-${ip}`))};} catch {return {available:false,stats:[]};}
  }
  // === Portal del Residente ===
  async portalData(token: string) {
    return this.database.read(async tx => {
      const scope = await this.validatePortal(tx, token);
      const [customer] = await tx`SELECT c.*,p.name plan_name,p.down,p.up,p.price,b.name building_name FROM customers c LEFT JOIN plans p ON p.id=c.plan_id JOIN buildings b ON b.id=c.building_id WHERE c.id=${scope.id}`;
      const invoices = await tx`SELECT id,period,due,amount,paid_at,COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=invoices.id AND reversed_at IS NULL),0) paid_total FROM invoices WHERE customer_id=${customer.id} ORDER BY period DESC LIMIT 24`;
      const paymentReports = await tx`SELECT id,amount,reference,notes,status,created_at FROM payment_reports WHERE customer_id=${customer.id} ORDER BY id DESC LIMIT 10`;
      const payments = await tx`SELECT p.id,p.amount,p.method,p.reference,p.created_at,p.reversed_at,p.reversal_reason,i.period,c.name,c.apartment,b.name building_name,u.username actor FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN buildings b ON b.id=c.building_id LEFT JOIN users u ON u.id=p.actor_id WHERE i.customer_id=${customer.id} ORDER BY p.id DESC LIMIT 100`;
      const [bank] = await tx`SELECT value FROM settings WHERE key=${'bank:'+customer.building_id}`;
      const settings = await this.settings(tx);
      for(const payment of payments)payment.signature=await this.signReceipt(tx,payment);
      return { payments, bank: JSON.parse(bank?.value || '{}'), currency: settings.currency, customer: { apartment: customer.apartment, name: customer.name, status: customer.status, plan_name: customer.plan_name, down: customer.down, up: customer.up, building_name: customer.building_name }, invoices, paymentReports };
    });
  }

  async portalReportPayment(dto: { token: string; amount: number; reference: string; notes?: string }) {
    return this.database.write(async tx => {
      const customer = await this.validatePortal(tx, dto.token);
      const existing = await tx`SELECT id FROM payment_reports WHERE customer_id=${customer.id} AND reference=${dto.reference.trim()} AND status IN ('pending','approved')`;
      if (existing.length) throw new BadRequestException('Ya existe un reporte pendiente con esa referencia.');
      const [row] = await tx`INSERT INTO payment_reports(customer_id,amount,reference,notes,status,created_at) VALUES (${customer.id},${Math.round(dto.amount * 100)},${dto.reference.trim()},${dto.notes?.trim() || ''},${`pending`},${new Date().toISOString()}) RETURNING id`;
      return { ok: true, id: (row as unknown as { id: number }).id };
    });
  }

  async listPaymentReports(buildingId?: number) {
    return this.database.read(async tx => {
      const allowed = await this.actorBuildings(tx);
      if (buildingId) await this.requireBuilding(tx,buildingId);
      const rows = await tx`SELECT pr.*,c.apartment,c.name,c.building_id FROM payment_reports pr JOIN customers c ON c.id=pr.customer_id ORDER BY pr.id DESC`;
      return rows.filter((r:{building_id:number})=>allowed.includes(r.building_id) && (!buildingId || r.building_id===buildingId)).slice(0,100);
    });
  }

  async reviewPaymentReport(dto: { id: number; status: 'approved' | 'rejected'; notes?: string }) {
    await this.database.write(async tx => {
      const [report] = await tx`SELECT pr.*,c.building_id FROM payment_reports pr JOIN customers c ON c.id=pr.customer_id WHERE pr.id=${dto.id}`;
      if (!report) throw new BadRequestException('Reporte no encontrado.');
      await this.requireBuilding(tx, report.building_id);
      if (report.status !== 'pending') throw new BadRequestException('El reporte ya fue procesado.');
      if (dto.status === 'approved') {
        const invoices = await tx`SELECT i.*,i.amount-COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id AND reversed_at IS NULL),0) balance FROM invoices i WHERE customer_id=${report.customer_id} AND paid_at IS NULL ORDER BY due,id`;
        if (Number(report.amount)>invoices.reduce((sum:number,i:{balance:number})=>sum+Number(i.balance),0)) throw new BadRequestException('El reporte supera la deuda pendiente. Revisa el importe antes de aprobar.');
        let remaining=Number(report.amount);
        for (const invoice of invoices) {
          const amount=Math.min(remaining,Number(invoice.balance)); if(amount<=0)continue;
          await tx`INSERT INTO payments(invoice_id,amount,created_at,method,reference,actor_id,request_key) VALUES (${invoice.id},${amount},${now()},${'transfer'},${report.reference},${requestContext.getStore()?.id || null},${'report-'+report.id+'-invoice-'+invoice.id})`;
          if(amount===Number(invoice.balance))await tx`UPDATE invoices SET paid_at=${now()} WHERE id=${invoice.id}`;
          remaining-=amount;
        }
        const customer=await this.customer(tx,report.customer_id);
        if(!customer.manual_hold && !customer.archived && !await this.hasOverdue(tx,customer.id)) await this.access(tx,customer,'active','Transferencia confirmada.');
      }
      await tx`UPDATE payment_reports SET status=${dto.status},notes=COALESCE(${dto.notes?.trim() || null},notes) WHERE id=${dto.id}`;
      await this.log(tx, `Reporte de pago #${dto.id} ${dto.status === 'approved' ? 'aprobado' : 'rechazado'}.`, report.building_id);
    });
    return { ok: true };
  }
}
