import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { NetworkService } from '../network/network.service';
import { SettingsService } from '../settings/settings.service';
import { now, ipValue, type Customer } from '../shared/management-types';
import { uuidv7 } from '../../common/uuid';
import { ArchiveCustomerDto, CreateCustomerDto, DeleteCustomerDto, SetCustomerIpDto, UpdateCustomerDto } from './customers.dto';

/** Departamentos, IP privada y enlaces del portal. */
@Injectable()
export class CustomersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly network: NetworkService,
    private readonly settings: SettingsService,
  ) {}

  hashPortalToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(dto: CreateCustomerDto): Promise<{ customer_id: string; token: string; issued_at: string }> {
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const createdId = await this.database.write(async (tx) => {
      const bid = await this.scope.resolveBuilding(tx, dto.building_id);
      const planId = dto.plan_id === undefined || dto.plan_id === null || dto.plan_id === '' ? null : String(dto.plan_id);
      if (planId !== null) {
        const [plan] = await tx`SELECT id, building_id FROM plans WHERE id=${planId}`;
        if (!plan) throw new BadRequestException('Selecciona un plan existente.');
        if (plan.building_id && plan.building_id !== bid) throw new BadRequestException('El plan pertenece a otro edificio.');
      }
      const ip = ipValue(dto.ip);
      await this.scope.checkIpFree(tx, ip, bid);
      const [existing] = await tx`SELECT id FROM customers WHERE apartment=${dto.apartment.trim()} AND building_id=${bid}`;
      if (existing) throw new BadRequestException('Ya existe ese departamento en el edificio.');
      // B5: el enlace completo se devuelve una sola vez; en la base solo el hash.
      const [row] = await tx`INSERT INTO customers(id,apartment,name,phone,plan_id,ip,building_id,access_token,access_token_hash,access_issued_at,access_expires_at,access_version) VALUES (${uuidv7()},${dto.apartment.trim()},${(dto.name || '').trim()},${(dto.phone || '').trim()},${planId},${ip},${bid},${null},${this.hashPortalToken(portalToken)},${issued},${this.settings.portalExpiry(await this.settings.settings(tx))},1) RETURNING id`;
      if (ip) await this.network.queue(tx, await this.scope.customer(tx, row.id));
      await this.scope.log(tx, `Departamento ${dto.apartment.trim()} registrado.`, bid);
      return (row as unknown as { id: string }).id;
    });
    return { customer_id: createdId, token: portalToken, issued_at: issued };
  }

  private async changeIp(tx: TransactionSQL, customer: Customer, ip: string | null): Promise<void> {
    await this.scope.checkIpFree(tx, ip, customer.building_id!, customer.id);
    const centralId = await this.scope.centralFor(tx, customer.building_id);
    await tx`UPDATE customers SET ip=${ip} WHERE id=${customer.id}`;
    const previous = customer.ip && customer.ip !== ip && centralId ? { routerId: centralId, ip: customer.ip } : undefined;
    await this.network.queue(tx, { ...customer, ip }, previous);
  }

  async update(dto: UpdateCustomerDto): Promise<void> {
    await this.database.write(async (tx) => {
      const before = await this.scope.customer(tx, dto.id);
      const planId = dto.plan_id === undefined || dto.plan_id === null || dto.plan_id === '' ? null : String(dto.plan_id);
      if (planId !== null) {
        const [plan] = await tx`SELECT id, building_id FROM plans WHERE id=${planId}`;
        if (!plan) throw new BadRequestException('Selecciona un plan existente.');
        if (plan.building_id && before.building_id && plan.building_id !== before.building_id) throw new BadRequestException('El plan pertenece a otro edificio.');
      }
      const [dup] = await tx`SELECT id FROM customers WHERE apartment=${dto.apartment.trim()} AND building_id=${before.building_id} AND id<>${dto.id}`;
      if (dup) throw new BadRequestException('Ya existe ese departamento en el edificio.');
      await tx`UPDATE customers SET apartment=${dto.apartment.trim()},name=${(dto.name || '').trim()},phone=${(dto.phone || '').trim()},plan_id=${planId} WHERE id=${dto.id}`;
      const customer = await this.scope.customer(tx, dto.id);
      const ip = dto.ip === undefined ? before.ip : ipValue(dto.ip);
      if (ip !== before.ip) await this.changeIp(tx, customer, ip);
      else if (before.plan_id !== planId) await this.network.queue(tx, customer);
      await this.scope.log(tx, `Departamento ${dto.apartment.trim()} actualizado.`, customer.building_id);
    });
  }

  async setIp(dto: SetCustomerIpDto): Promise<void> {
    await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, dto.id);
      await this.changeIp(tx, customer, ipValue(dto.ip));
      await this.scope.log(tx, `${customer.apartment}: IP actualizada; limpieza y sincronización de reglas solicitadas.`, customer.building_id);
    });
  }

  async archive(dto: ArchiveCustomerDto): Promise<void> {
    await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, dto.id);
      await tx`UPDATE customers SET archived=${dto.archived ? 1 : 0},manual_hold=1 WHERE id=${dto.id}`;
      await this.network.applyAccess(tx, customer, 'suspended', dto.archived ? 'Departamento desactivado: sin nuevas cuotas.' : 'Departamento activado. Reactiva el internet cuando corresponda.', true);
      await this.scope.log(tx, `${customer.apartment}: ${dto.archived ? 'desactivado' : 'activado'}; historial conservado.`, customer.building_id);
    });
  }

  // Eliminación física: borra el departamento y todo lo que cuelga de él
  // (cuotas/pagos, órdenes de red, dispositivos, objetivos, consumos).
  // Las tablas de consumo y reportes ya tienen ON DELETE CASCADE, pero se
  // borran explícito para instalaciones donde las FK no se aplican.
  async remove(dto: DeleteCustomerDto): Promise<void> {
    await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, dto.id);
      const id = dto.id;
      // Limpieza de red pendiente: sin fila ya no se puede encolar, así que se
      // cancelan las órdenes y vínculos para no dejar huérfanos en la cola.
      await tx`DELETE FROM customer_network_dirty WHERE customer_id=${id}`;
      await tx`DELETE FROM customer_devices WHERE customer_id=${id}`;
      await tx`DELETE FROM customer_network_targets WHERE customer_id=${id}`;
      await tx`DELETE FROM commands WHERE customer_id=${id}`;
      await tx`DELETE FROM usage_cursors WHERE customer_id=${id}`;
      await tx`DELETE FROM usage_daily WHERE customer_id=${id}`;
      await tx`DELETE FROM usage_events WHERE customer_id=${id}`;
      // Cuotas y sus pagos (payments cae en cascada desde invoices, pero se
      // borra explícito por si el motor no aplica la FK). Las tablas heredadas
      // pueden no existir: se consulta to_regclass antes porque un fallo
      // dentro de la transacción la abortaría en PostgreSQL.
      const [hasReminders] = await tx`SELECT to_regclass('reminder_deliveries') AS name`;
      const [hasReports] = await tx`SELECT to_regclass('payment_reports') AS name`;
      const invoiceRows = await tx<{ id: string }[]>`SELECT id FROM invoices WHERE customer_id=${id}`;
      for (const row of invoiceRows) {
        await tx`DELETE FROM payments WHERE invoice_id=${row.id}`;
        if (hasReminders.name) await tx`DELETE FROM reminder_deliveries WHERE invoice_id=${row.id}`;
      }
      await tx`DELETE FROM invoices WHERE customer_id=${id}`;
      if (hasReports.name) await tx`DELETE FROM payment_reports WHERE customer_id=${id}`;
      const deleted = await tx`DELETE FROM customers WHERE id=${id} RETURNING id`;
      if (!deleted.length) throw new BadRequestException('Departamento no encontrado.');
      await this.scope.log(tx, `Departamento ${customer.apartment} eliminado definitivamente con su historial.`, customer.building_id);
    });
  }

  // B2: rotación atómica del enlace del portal.
  async rotatePortalLink(id: string): Promise<{ customer_id: string; token: string; issued_at: string; version: number }> {
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const version = await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, id);
      const config = await this.settings.settings(tx);
      const rows = await tx`UPDATE customers SET access_token=${null},access_token_hash=${this.hashPortalToken(portalToken)},access_issued_at=${issued},access_expires_at=${this.settings.portalExpiry(config)},access_version=COALESCE(access_version,0)+1 WHERE id=${id} RETURNING access_version`;
      if (!rows.length) throw new BadRequestException('Departamento no encontrado.');
      const v = (rows[0] as unknown as { access_version: number }).access_version;
      await this.scope.log(tx, `Enlace del portal regenerado: departamento ${customer.apartment} (v${v}). El enlace anterior quedó invalidado.`, customer.building_id);
      return v;
    });
    return { customer_id: id, token: portalToken, issued_at: issued, version };
  }

  // B3: cambio explícito de titular con invalidación del acceso anterior.
  async changeHolder(id: string, name: string, phone?: string): Promise<{ customer_id: string; token: string; issued_at: string; version: number }> {
    const cleanName = (name || '').trim();
    if (!cleanName) throw new BadRequestException('Indica el nombre del nuevo titular.');
    if (cleanName.length > 160) throw new BadRequestException('Nombre demasiado largo.');
    const cleanPhone = (phone || '').trim().slice(0, 80);
    const portalToken = randomBytes(32).toString('base64url');
    const issued = now();
    const version = await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, id);
      const config = await this.settings.settings(tx);
      const rows = await tx`UPDATE customers SET name=${cleanName},phone=${cleanPhone},access_token=${null},access_token_hash=${this.hashPortalToken(portalToken)},access_issued_at=${issued},access_expires_at=${this.settings.portalExpiry(config)},access_version=COALESCE(access_version,0)+1 WHERE id=${id} RETURNING access_version`;
      if (!rows.length) throw new BadRequestException('Departamento no encontrado.');
      const v = (rows[0] as unknown as { access_version: number }).access_version;
      await this.scope.log(tx, `Cambio de titular en departamento ${customer.apartment}: acceso anterior invalidado. Entrega el nuevo enlace por un canal distinto.`, customer.building_id);
      return v;
    });
    return { customer_id: id, token: portalToken, issued_at: issued, version };
  }
}
