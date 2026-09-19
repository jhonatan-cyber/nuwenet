import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { SettingsService } from '../settings/settings.service';
import { NetworkService } from '../network/network.service';
import { localDay, shiftDay } from '../shared/management-types';
import { isSystem, requestContext } from '../../common/request-context';
import { AccessDto } from './access.dto';

/** Acceso manual, revisión de vencidos y auditoría. */
@Injectable()
export class AccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly settings: SettingsService,
    private readonly network: NetworkService,
  ) {}

  async changeAccess(dto: AccessDto): Promise<void> {
    await this.database.write(async (tx) => {
      const customer = await this.scope.customer(tx, dto.id);
      if (customer.archived && dto.status === 'active') throw new BadRequestException('Activa el departamento antes de reactivar el internet.');
      await tx`UPDATE customers SET manual_hold=${dto.status === 'suspended' ? 1 : 0} WHERE id=${dto.id}`;
      await this.network.applyAccess(tx, customer, dto.status, 'Cambio manual.', true);
    });
  }

  async reviewOverdue(auto = false): Promise<void> {
    await this.database.write(async (tx) => {
      const actor = requestContext.getStore();
      const allowed = await this.scope.actorBuildings(tx);
      const scopes: (string | null)[] = actor && (actor?.role === 'superadmin' || isSystem(actor)) ? [null] : allowed;
      if (!scopes.length) throw new ForbiddenException('No tienes edificios asignados.');
      const config = await this.settings.settings(tx);
      let total = 0;
      for (const bid of scopes) {
        const customers = await tx`SELECT DISTINCT c.id FROM customers c JOIN invoices i ON i.customer_id=c.id WHERE c.archived=0 AND c.status='active' AND i.paid_at IS NULL AND i.due<${shiftDay(localDay(), -config.grace_days)} AND (${bid}::uuid IS NULL OR c.building_id=${bid}::uuid)`;
        for (const row of customers) await this.network.applyAccess(tx, await this.scope.customer(tx, row.id), 'suspended', 'Mensualidad vencida.');
        total += customers.length;
        if (bid && (!auto || customers.length)) await this.scope.log(tx, 'Revisión de vencimientos completada.', bid);
      }
      if (scopes.includes(null) && (!auto || total)) await this.scope.log(tx, 'Revisión de vencimientos completada.');
    });
  }

  async audit() {
    this.scope.requireSuperadmin();
    return this.database.read((tx) => tx`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`);
  }
}
