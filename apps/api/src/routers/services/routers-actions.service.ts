import { BadRequestException, ConflictException, HttpException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AdapterRegistry } from '../adapter-registry';
import { CredentialVault } from '../credential-vault';
import { RouterActionDto, SwitchPortDto } from '../router.dto';
import { uuidv7 } from '../../common/uuid';
import { RoutersOperationService } from './routers-operation.service';

/** Acciones sobre routers: suspender/reactivar, velocidad, firewall, puertos. */
@Injectable()
export class RoutersActionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
    private readonly ops: RoutersOperationService,
  ) {}

  async action(id: string, dto: RouterActionDto, fromQueue = false) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    this.ops.acting.add(id);
    try {
      return await this.executeAction(id, dto, fromQueue);
    } finally {
      this.ops.acting.delete(id);
    }
  }

  private async executeAction(id: string, dto: RouterActionDto, fromQueue: boolean) {
    if (!fromQueue && dto.ip && ['suspend', 'reactivate', 'speed_limit'].includes(dto.action)) {
      const assigned = await this.db.read((tx) => tx`SELECT id FROM customers WHERE ip=${dto.ip!}`);
      if (assigned.length) throw new ConflictException('Esta IP pertenece a un departamento. Cambia su acceso o plan desde Departamentos para conservar la sincronización y el historial.');
    }
    const router = await this.ops.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de aplicar acciones.');
    const adapter = this.registry.get(router.adapter);
    const supported = adapter.description.capabilities[dto.action];
    if (!supported) throw new UnprocessableEntityException(`El adaptador ${router.adapter} no implementa ${dto.action}. No se enviaron cambios al router.`);
    if (dto.action === 'suspend' || dto.action === 'reactivate' || dto.action === 'speed_limit' || dto.action === 'firewall' || dto.action === 'parental_control') {
      if (!dto.ip) throw new BadRequestException('Indica la IP privada del cliente para esta acción.');
      if (dto.action === 'speed_limit' && (!dto.down || !dto.up)) throw new BadRequestException('Indica down y up en Mbps para speed_limit.');
      if (dto.action === 'firewall' && !dto.remove && !dto.target) throw new BadRequestException('Indica el destino a bloquear para firewall.');
      if (dto.action === 'parental_control' && !dto.schedule) throw new BadRequestException('Indica el horario para parental_control (u off).');
      const credentials = this.vault.open(router.credentials);
      const client = { ip: dto.ip, down: dto.down, up: dto.up, target: dto.target, schedule: dto.schedule, remove: dto.remove };
      let result: string;
      try {
        if (dto.action === 'suspend') {
          if (!adapter.suspend) throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
          result = await adapter.suspend(router, credentials, client);
        } else if (dto.action === 'reactivate') {
          if (!adapter.reactivate) throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
          result = await adapter.reactivate(router, credentials, client);
        } else if (dto.action === 'speed_limit') {
          if (!adapter.setSpeedLimit) throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
          result = await adapter.setSpeedLimit(router, credentials, client);
        } else if (dto.action === 'firewall') {
          if (!adapter.firewall) throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
          result = await adapter.firewall(router, credentials, client);
        } else {
          if (!adapter.parental) throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
          result = await adapter.parental(router, credentials, client);
        }
      } catch (error) {
        const checkedAt = new Date().toISOString();
        const message = error instanceof HttpException ? error.message : 'No se pudo aplicar la acción en el router.';
        await this.db.write(async (tx) => {
          await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${0},${`${dto.action} ${dto.ip}: ${message}`.slice(0, 500)})`;
          await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: falló ${dto.action} para ${dto.ip}.`},${router.building_id})`;
        });
        throw error;
      }
      const checkedAt = new Date().toISOString();
      await this.db.write(async (tx) => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${1},${`${dto.action} ${dto.ip}: ${result}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${dto.action} aplicado a ${dto.ip}.`},${router.building_id})`;
      });
      const detail = await this.ops.detail(id);
      return { success: true, result, ...detail, router: { ...detail.router, checking: false } };
    }
    throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
  }

  async releaseClient(id: string, ip: string) {
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.releaseClient) throw new UnprocessableEntityException('El adaptador no admite limpieza de reglas.');
    await adapter.releaseClient(router, this.vault.open(router.credentials), ip);
  }

  async departmentSpeed(id: string, customerId: string, ips: string[], down: number, up: number) {
    if (this.ops.acting.has(id) || this.ops.checking.has(id)) throw new ConflictException('El router tiene una operación en curso.');
    this.ops.acting.add(id);
    try {
      const router = await this.ops.record(id);
      const adapter = this.registry.get(router.adapter);
      if (!adapter.departmentSpeed) throw new UnprocessableEntityException('El adaptador no admite velocidad compartida por departamento.');
      await adapter.departmentSpeed(router, this.vault.open(router.credentials), customerId, ips, down, up);
    } finally {
      this.ops.acting.delete(id);
    }
  }

  async switchPort(id: string, dto: SwitchPortDto) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.ops.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de modificar puertos.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setEthernetPort) throw new UnprocessableEntityException('El adaptador no admite administración de puertos.');
    this.ops.acting.add(id);
    try {
      const result = await adapter.setEthernetPort(router, this.vault.open(router.credentials), dto);
      await this.db.write(async (tx) => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`puerto ${dto.name}: ${dto.disabled ? 'deshabilitado' : 'habilitado'}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: puerto ${dto.name} ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`},${router.building_id})`;
      });
      const detail = await this.ops.detail(id);
      return { success: true, port: result, ...detail, router: { ...detail.router, checking: false } };
    } finally {
      this.ops.acting.delete(id);
    }
  }
}
