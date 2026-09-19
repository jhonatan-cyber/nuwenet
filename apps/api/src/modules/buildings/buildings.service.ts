import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ScopeService } from '../shared/scope.service';
import { requestContext } from '../../common/request-context';
import { now } from '../shared/management-types';
import { uuidv7 } from '../../common/uuid';
import { AssignBuildingDto, CreateBuildingDto, RemoveBuildingDto, ToggleBuildingDto, UpdateBuildingDto } from './buildings.dto';

/** Edificios y asignación de administradores. Solo super-admin escribe. */
@Injectable()
export class BuildingsService {
  constructor(private readonly database: DatabaseService, private readonly scope: ScopeService) {}

  list() {
    return this.database.read(async (tx) => {
      const actor = requestContext.getStore();
      if (!actor || actor?.role === 'superadmin') return tx`SELECT * FROM buildings ORDER BY id`;
      return tx`SELECT b.* FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE ub.user_id=${actor!.id} AND b.disabled=0 ORDER BY b.id`;
    });
  }

  async create(dto: CreateBuildingDto): Promise<{ id: string }> {
    this.scope.requireSuperadmin();
    return {
      id: await this.database.write(async (tx) => {
        const [row] = await tx`INSERT INTO buildings(id,name,address,created_at) VALUES (${uuidv7()},${dto.name.trim()},${dto.address.trim()},${now()}) RETURNING id`;
        const bid = (row as unknown as { id: string }).id;
        if (dto.admin_id) {
          const [admin] = await tx`SELECT id, role FROM users WHERE id=${dto.admin_id}`;
          if (!admin) throw new BadRequestException('Administrador no encontrado.');
          if ((admin as unknown as { role: string }).role !== 'admin') throw new BadRequestException('Solo un administrador de edificio puede vincularse al crear.');
          await tx`INSERT INTO user_buildings(id,user_id,building_id) VALUES (${uuidv7()},${dto.admin_id},${bid}) ON CONFLICT(user_id,building_id) DO NOTHING`;
        }
        await this.scope.log(tx, `Edificio creado: ${dto.name.trim()}.`, bid);
        return bid;
      }),
    };
  }

  async assign(dto: AssignBuildingDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
      const [user] = await tx`SELECT id, role FROM users WHERE id=${dto.user_id}`;
      if (!user) throw new BadRequestException('Usuario no encontrado.');
      if ((user as unknown as { role: string }).role === 'superadmin') throw new BadRequestException('El super-admin no se vincula a edificios: ve todo el sistema por rol.');
      const [building] = await tx`SELECT id, disabled FROM buildings WHERE id=${dto.building_id}`;
      if (!building) throw new BadRequestException('Edificio no encontrado.');
      if ((building as unknown as { disabled: number }).disabled) throw new BadRequestException('El edificio está deshabilitado. Habilítalo antes de asignar accesos.');
      await tx`INSERT INTO user_buildings(id,user_id,building_id) VALUES (${uuidv7()},${dto.user_id},${dto.building_id}) ON CONFLICT(user_id,building_id) DO NOTHING`;
      await this.scope.log(tx, `Acceso asignado: usuario ${dto.user_id} al edificio ${dto.building_id}.`, dto.building_id);
    });
  }

  async unassign(dto: AssignBuildingDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
      await tx`DELETE FROM user_buildings WHERE user_id=${dto.user_id} AND building_id=${dto.building_id}`;
      await this.scope.log(tx, `Acceso retirado: usuario ${dto.user_id} del edificio ${dto.building_id}.`, dto.building_id);
    });
  }

  async update(dto: UpdateBuildingDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
      const rows = await tx`UPDATE buildings SET name=${dto.name.trim()},address=${dto.address.trim()} WHERE id=${dto.building_id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Edificio no encontrado.');
      await this.scope.log(tx, `Edificio actualizado: ${dto.name.trim()}.`, dto.building_id);
    });
  }

  async toggle(dto: ToggleBuildingDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
      const rows = await tx`UPDATE buildings SET disabled=${dto.disabled ? 1 : 0} WHERE id=${dto.building_id} RETURNING id`;
      if (!rows.length) throw new BadRequestException('Edificio no encontrado.');
      await this.scope.log(tx, `Edificio ${dto.building_id} ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`, dto.building_id);
    });
  }

  async remove(dto: RemoveBuildingDto): Promise<void> {
    this.scope.requireSuperadmin();
    await this.database.write(async (tx) => {
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
      await this.scope.log(tx, `Edificio eliminado del sistema: ${(building as unknown as { name: string }).name}.`);
    });
  }
}
