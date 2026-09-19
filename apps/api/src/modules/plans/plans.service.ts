import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { NetworkService } from '../network/network.service';
import { uuidv7 } from '../../common/uuid';
import { CreatePlanDto, TogglePlanDto, UpdatePlanDto } from './plans.dto';

/** Planes por edificio. Al cambiar un plan se reencolan los departamentos. */
@Injectable()
export class PlansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly network: NetworkService,
  ) {}

  async create(dto: CreatePlanDto): Promise<void> {
    await this.database.write(async (tx) => {
      const bid = await this.scope.resolveBuilding(tx, dto.building_id);
      await tx`INSERT INTO plans(id,name,down,up,price,building_id) VALUES (${uuidv7()},${dto.name.trim()},${dto.down},${dto.up},${Math.round(dto.price * 100)},${bid})`;
      await this.scope.log(tx, `Plan creado: ${dto.name.trim()}.`, bid);
    });
  }

  async update(dto: UpdatePlanDto): Promise<void> {
    await this.database.write(async (tx) => {
      const [plan] = await tx`SELECT building_id FROM plans WHERE id=${dto.id}`;
      if (!plan) throw new BadRequestException('Plan no encontrado.');
      await this.scope.requireBuilding(tx, plan.building_id);
      const rows = await tx`UPDATE plans SET name=${dto.name.trim()},down=${dto.down},up=${dto.up},price=${Math.round(dto.price * 100)} WHERE id=${dto.id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Plan no encontrado.');
      const customers = await tx`SELECT id FROM customers WHERE plan_id=${dto.id} AND archived=0`;
      for (const customer of customers) await this.network.queue(tx, await this.scope.customer(tx, customer.id));
      await this.scope.log(tx, `Plan actualizado: ${dto.name}. Las cuotas existentes conservan su importe.`, plan.building_id);
    });
  }

  async toggle(dto: TogglePlanDto): Promise<void> {
    await this.database.write(async (tx) => {
      const [plan] = await tx`SELECT id,name,building_id,disabled FROM plans WHERE id=${dto.id}`;
      if (!plan) throw new BadRequestException('Plan no encontrado.');
      await this.scope.requireBuilding(tx, plan.building_id);
      const disabled = dto.disabled ? 1 : 0;
      await tx`UPDATE plans SET disabled=${disabled} WHERE id=${dto.id}`;
      await this.scope.log(tx, disabled ? `Plan desactivado: ${plan.name}.` : `Plan activado: ${plan.name}.`, plan.building_id);
    });
  }

  async remove(dto: { id: string }): Promise<void> {
    await this.database.write(async (tx) => {
      const [plan] = await tx`SELECT id,name,building_id FROM plans WHERE id=${dto.id}`;
      if (!plan) throw new BadRequestException('Plan no encontrado.');
      await this.scope.requireBuilding(tx, plan.building_id);
      const [usage] = await tx`SELECT COUNT(*) count FROM customers WHERE plan_id=${dto.id} AND archived=0`;
      if (Number(usage.count) > 0) throw new BadRequestException('No se puede eliminar: hay departamentos vigentes con este plan.');
      const [invUsage] = await tx`SELECT COUNT(*) count FROM invoices WHERE plan_id=${dto.id}`;
      if (Number(invUsage.count) > 0) throw new BadRequestException('No se puede eliminar: hay cuotas emitidas con este plan. Desactívalo en su lugar.');
      await tx`DELETE FROM plans WHERE id=${dto.id}`;
      await this.scope.log(tx, `Plan eliminado: ${plan.name}.`, plan.building_id);
    });
  }
}
