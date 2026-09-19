import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../../database/database.service';
import { RoutersService } from '../../routers/routers.service';
import { ScopeService } from '../shared/scope.service';
import { now } from '../shared/management-types';
import { envSuspensionMessage, envAdminContact, envCurrency } from '../../config/env';
import { runAsSystem } from '../../common/request-context';

// B6: caché breve de tráfico por router (20s, memoria por instancia).
const portalTrafficCache = new Map<string, { at: number; stats: { name: string }[] }>();

/** Portal del residente: datos, tráfico y aviso público. Rutas sin sesión. */
@Injectable()
export class PortalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly routers: RoutersService,
  ) {}

  hashPortalToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // B4: validación única para datos, consumo, tráfico y reportes. No revela si
  // el fallo fue por token, archivo, edificio o caducidad.
  async validatePortal(tx: TransactionSQL, token: string): Promise<{ id: string; building_id: string }> {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token || '')) throw new BadRequestException('Token inválido o departamento no encontrado.');
    const hash = this.hashPortalToken(token);
    const [customer] = await tx`SELECT c.id,c.building_id,c.access_expires_at FROM customers c JOIN buildings b ON b.id=c.building_id WHERE (c.access_token_hash=${hash} OR (c.access_token_hash IS NULL AND c.access_token=${token})) AND c.archived=0 AND b.disabled=0`;
    if (!customer) throw new BadRequestException('Token inválido o departamento no encontrado.');
    const expires = (customer as unknown as { access_expires_at: string | null }).access_expires_at;
    if (expires && expires <= now()) throw new BadRequestException('Token inválido o departamento no encontrado.');
    return customer as unknown as { id: string; building_id: string };
  }

  async publicNotice(_buildingId?: string) {
    return { message: envSuspensionMessage(), contact: envAdminContact() };
  }

  async traffic(token: string) {
    await this.data(token);
    const scope = await this.database.read(async (tx) => {
      const c = await this.validatePortal(tx, token);
      const [row] = await tx`SELECT id,ip FROM customers WHERE id=${c.id}`;
      const ips = await tx`SELECT ip FROM customer_network_targets WHERE customer_id=${c.id}`;
      return {
        id: c.id,
        ips: [(row as unknown as { ip: string | null }).ip, ...ips.map((x: { ip: string }) => x.ip)].filter(Boolean),
        routerId: await this.scope.centralFor(tx, c.building_id),
      };
    });
    if (!scope.routerId) return { available: false, stats: [] };
    // B6: caché breve por router para no disparar una lectura completa por
    // visitante. TTL 20s en memoria por instancia.
    const nowMs = Date.now();
    const cached = portalTrafficCache.get(scope.routerId);
    let stats;
    if (cached && nowMs - cached.at < 20_000) {
      stats = cached.stats;
    } else {
      // B7: la lectura del router corre como sistema; el alcance ya quedó
      // fijado por el token del residente (su edificio/router).
      try {
        stats = await runAsSystem(() => this.routers.getTraffic(scope.routerId!));
      } catch {
        return { available: false, stats: [] };
      }
      portalTrafficCache.set(scope.routerId, { at: nowMs, stats });
    }
    try {
      return { available: true, stats: stats.filter((q) => q.name === `nuwenet-department-${scope.id}` || scope.ips.some((ip) => q.name === `nuwenet-${ip}`)) };
    } catch {
      return { available: false, stats: [] };
    }
  }

  async data(token: string) {
    const { createHmac } = await import('node:crypto');
    return this.database.read(async (tx) => {
      const scope = await this.validatePortal(tx, token);
      const [customer] = await tx`SELECT c.*,p.name plan_name,p.down,p.up,p.price,b.name building_name FROM customers c LEFT JOIN plans p ON p.id=c.plan_id JOIN buildings b ON b.id=c.building_id WHERE c.id=${scope.id}`;
      const invoices = await tx`SELECT id,period,due,amount,paid_at,COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=invoices.id AND reversed_at IS NULL),0) paid_total FROM invoices WHERE customer_id=${customer.id} ORDER BY period DESC LIMIT 24`;
      const payments = await tx`SELECT p.id,p.amount,p.method,p.reference,p.created_at,p.reversed_at,p.reversal_reason,i.period,c.name,c.apartment,b.name building_name,u.username actor FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN buildings b ON b.id=c.building_id LEFT JOIN users u ON u.id=p.actor_id WHERE i.customer_id=${customer.id} ORDER BY p.id DESC LIMIT 100`;
      const cron = Number(process.env.OVERDUE_CRON_MINUTES || 0);
      void cron;
      const [settingsRow] = await tx`SELECT value FROM settings WHERE key='operations'`;
      const currency = (settingsRow ? JSON.parse(settingsRow.value) : {}).currency || envCurrency();
      if (payments.length) {
        const [key] = await tx`SELECT value FROM settings WHERE key='receipt-signature-key'`;
        for (const payment of payments) {
          payment.signature = createHmac('sha256', key.value).update(JSON.stringify([payment.id, payment.amount, payment.period, payment.created_at, payment.actor || null])).digest('hex');
        }
      }
      for (const invoice of invoices) invoice.paid_total = Number(invoice.paid_total);
      return {
        payments,
        currency,
        customer: { apartment: customer.apartment, name: customer.name, status: customer.status, plan_name: customer.plan_name, down: customer.down, up: customer.up, building_name: customer.building_name },
        invoices,
      };
    });
  }
}
