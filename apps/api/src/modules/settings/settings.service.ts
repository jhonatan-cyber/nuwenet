import { BadRequestException, Injectable } from '@nestjs/common';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { uuidv7 } from '../../common/uuid';
import { SettingsDto } from './settings.dto';
import { envCurrency, envOverdueCronMinutes } from '../../config/env';

/**
 * Configuración operativa global. Solo lee/escribe la fila `operations`
 * de settings. No orquesta snapshot ni otros dominios.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly database: DatabaseService, private readonly scope: ScopeService) {}

  async settings(tx?: TransactionSQL): Promise<SettingsDto> {
    const cron = envOverdueCronMinutes();
    const defaults: SettingsDto = {
      building_name: 'Mi edificio',
      currency: envCurrency(),
      grace_days: 0,
      auto_billing: false,
      billing_day: 1,
      due_day: 10,
      overdue_minutes: cron,
      monitor_minutes: 0,
      backup_hours: 0,
      portal_link_days: 0,
    };
    const read = async (sql: TransactionSQL) => {
      const [row] = await sql`SELECT value FROM settings WHERE key='operations'`;
      const stored = JSON.parse(row?.value || '{}');
      delete stored.central_router_id;
      delete stored.reminder_days;
      delete stored.reminders_enabled;
      return { ...defaults, ...stored } as SettingsDto;
    };
    return tx ? read(tx) : this.database.read(read);
  }

  portalExpiry(config: SettingsDto): string | null {
    const days = Number(config.portal_link_days || 0);
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() + days * 86400000).toISOString();
  }

  async save(dto: SettingsDto): Promise<void> {
    this.scope.requireSuperadmin();
    if ('central_router_id' in dto) throw new BadRequestException('El equipo central se configura únicamente por edificio.');
    this.scope.requireSuperadmin();
    if (dto.auto_billing && dto.due_day < dto.billing_day) {
      throw new BadRequestException('El vencimiento debe ser igual o posterior al día de generación.');
    }
    await this.database.write(async (tx) => {
      await tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},'operations',${JSON.stringify(dto)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      await this.scope.log(tx, 'Configuración del edificio actualizada.');
    });
  }
}
