import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { SettingsService } from '../settings/settings.service';
import { NetworkService } from '../network/network.service';
import { localDay, now, shiftDay } from '../shared/management-types';
import { isSystem, requestContext } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { BillingDto, PayDto, ReversePaymentDto } from './billing.dto';

/** Facturación: mensualidades, pagos/abonos, reversos y recibos. */
@Injectable()
export class BillingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly settings: SettingsService,
    private readonly network: NetworkService,
  ) {}

  private async hasOverdue(tx: Parameters<Parameters<DatabaseService['write']>[0]>[0], customerId: string): Promise<boolean> {
    const config = await this.settings.settings(tx);
    const rows = await tx`SELECT id FROM invoices WHERE customer_id=${customerId} AND paid_at IS NULL AND due < ${shiftDay(localDay(), -config.grace_days)} LIMIT 1`;
    return rows.length > 0;
  }

  async generate(dto: BillingDto): Promise<void> {
    if (!Number.isFinite(Date.parse(dto.due)) || new Date(dto.due).toISOString().slice(0, 10) !== dto.due) throw new BadRequestException('Fecha inválida.');
    await this.database.write(async (tx) => {
      const actor = requestContext.getStore();
      const allowed = await this.scope.actorBuildings(tx);
      if (!dto.building_id && actor && !isSystem(actor) && allowed.length > 1) throw new BadRequestException('Selecciona el edificio para generar mensualidades.');
      let bid: string | null = dto.building_id || null;
      if (bid) await this.scope.requireBuilding(tx, bid);
      else if (actor && !isSystem(actor) && actor?.role !== 'superadmin') {
        if (!allowed.length) throw new ForbiddenException('No tienes edificios asignados.');
        bid = allowed[0];
      }
      const customers = await tx`SELECT c.id,c.building_id,p.price FROM customers c JOIN plans p ON p.id=c.plan_id WHERE c.archived=0 AND (${bid}::uuid IS NULL OR c.building_id=${bid}::uuid)`;
      const counts = new Map<string | null, number>();
      for (const customer of customers) {
        const count = (
          await tx`INSERT INTO invoices(id,customer_id,period,due,amount,paid_at) VALUES (${uuidv7()},${customer.id},${dto.period},${dto.due},${customer.price},${Number(customer.price) === 0 ? now() : null}) ON CONFLICT(customer_id,period) DO NOTHING RETURNING id`
        ).length;
        if (count) counts.set(customer.building_id, (counts.get(customer.building_id) || 0) + count);
      }
      for (const [buildingId, count] of counts) await this.scope.log(tx, `${count} mensualidades generadas para ${dto.period}.`, buildingId);
    });
  }

  async pay(dto: PayDto): Promise<void> {
    await this.database.write(async (tx) => {
      if (dto.request_key) {
        const [existing] = await tx`SELECT * FROM payments WHERE request_key=${dto.request_key}`;
        if (existing) {
          if (existing.invoice_id !== dto.id || (dto.amount !== undefined && existing.amount !== Math.round(dto.amount * 100))) {
            throw new BadRequestException('La referencia de operación ya se utilizó para otro pago.');
          }
          return;
        }
      }
      const [invoice] = await tx`SELECT * FROM invoices WHERE id=${dto.id}`;
      if (!invoice) throw new BadRequestException('Mensualidad no encontrada.');
      if (invoice.paid_at) return;
      const [paid] = await tx`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=${dto.id} AND reversed_at IS NULL`;
      const balance = invoice.amount - Number(paid.total);
      const amount = dto.amount === undefined ? balance : Math.round(dto.amount * 100);
      if (amount < 0 || amount > balance || (dto.amount !== undefined && amount === 0)) throw new BadRequestException('El abono supera el saldo pendiente o no es válido.');
      const actor = requestContext.getStore();
      const actorId = !actor || isSystem(actor) ? null : actor.id;
      if (amount > 0) {
        await tx`INSERT INTO payments(id,invoice_id,amount,created_at,method,reference,actor_id,request_key) VALUES (${uuidv7()},${dto.id},${amount},${now()},${dto.method || 'cash'},${dto.reference || ''},${actorId},${dto.request_key || null})`;
      }
      const customer = await this.scope.customer(tx, invoice.customer_id);
      if (amount === balance) {
        await tx`UPDATE invoices SET paid_at=${now()} WHERE id=${dto.id}`;
        await this.scope.log(tx, `Pago registrado: departamento ${customer.apartment}, periodo ${invoice.period}.`, customer.building_id);
        if (!customer.manual_hold && !customer.archived && !(await this.hasOverdue(tx, customer.id))) {
          await this.network.applyAccess(tx, customer, 'active', 'Sin cuotas vencidas después del pago.');
        }
      } else {
        await this.scope.log(tx, `Abono registrado: departamento ${customer.apartment}, periodo ${invoice.period}. Resta ${(balance - amount) / 100}.`, customer.building_id);
      }
    });
  }

  async reverse(dto: ReversePaymentDto): Promise<void> {
    await this.database.write(async (tx) => {
      const [payment] = await tx`SELECT * FROM payments WHERE id=${dto.id}`;
      if (!payment) throw new BadRequestException('Pago no encontrado.');
      if (payment.reversed_at) return;
      const reverser = requestContext.getStore();
      const reversedBy = !reverser || isSystem(reverser) ? null : reverser.id;
      await tx`UPDATE payments SET reversed_at=${now()},reversed_by=${reversedBy},reversal_reason=${dto.reason.trim()} WHERE id=${dto.id}`;
      const [inv] = await tx`SELECT amount FROM invoices WHERE id=${payment.invoice_id}`;
      const [covered] = await tx`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=${payment.invoice_id} AND reversed_at IS NULL`;
      await tx`UPDATE invoices SET paid_at=${Number(covered.total) >= Number(inv.amount) ? now() : null} WHERE id=${payment.invoice_id}`;
      const [invoice] = await tx`SELECT customer_id FROM invoices WHERE id=${payment.invoice_id}`;
      const customer = await this.scope.customer(tx, invoice.customer_id);
      await this.scope.log(tx, `Pago #${dto.id} revertido: ${dto.reason.trim()}.`, customer.building_id);
      if (await this.hasOverdue(tx, customer.id)) await this.network.applyAccess(tx, customer, 'suspended', 'Saldo vencido después de revertir un pago.');
    });
  }

  private receiptSignature(key: string, p: Record<string, unknown>): string {
    return createHmac('sha256', key).update(JSON.stringify([p.id, p.amount, p.period, p.created_at, p.actor || null])).digest('hex');
  }

  async receipt(id: string) {
    return this.database.read(async (tx) => {
      const [payment] = await tx`SELECT p.*,i.period,c.apartment,c.name,c.building_id,b.name building_name,u.username actor FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN buildings b ON b.id=c.building_id LEFT JOIN users u ON u.id=p.actor_id WHERE p.id=${id}`;
      if (!payment) throw new BadRequestException('Pago no encontrado.');
      await this.scope.requireBuilding(tx, payment.building_id);
      return {
        payment: { ...payment, signature: this.receiptSignature((await tx`SELECT value FROM settings WHERE key='receipt-signature-key'`)[0].value, payment) },
        settings: await this.settings.settings(tx),
      };
    });
  }
}
