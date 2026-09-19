import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { isSystem, requestContext } from '../../common/request-context';
import { AdapterRegistry } from '../adapter-registry';
import { CredentialVault } from '../credential-vault';
import type { RouterRecord, RouterSnapshot } from '../router.types';
import { isValidatedArris, routerCompatibility } from '../router.types';

/**
 * Estado compartido de operaciones de routers (consultas/acciones en curso)
 * y ayudas de acceso. Evita que dos escrituras concurrentes toquen el mismo
 * equipo y centraliza la exposición segura de registros.
 */
@Injectable()
export class RoutersOperationService {
  readonly checking = new Set<string>();
  readonly acting = new Set<string>();
  readonly connecting = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
  ) {}

  adapters() {
    return this.registry.list();
  }

  expose(router: RouterRecord) {
    const { credentials, snapshot, ...safe } = router;
    const parsed = snapshot ? (JSON.parse(snapshot) as RouterSnapshot) : null;
    const capabilities = { ...this.registry.get(router.adapter).description.capabilities };
    if (router.adapter === 'arris-touchstone' && !isValidatedArris(parsed)) {
      capabilities.suspend = capabilities.reactivate = capabilities.firewall = capabilities.parental_control = false;
    }
    return {
      ...safe,
      credentials_saved: Boolean(credentials),
      snapshot: parsed,
      checking: this.checking.has(router.id) || this.acting.has(router.id),
      capabilities,
      compatibility: routerCompatibility(router.adapter, parsed, (router as unknown as { disabled: number }).disabled),
    };
  }

  async resolveBuilding(dtoBuilding?: string | null): Promise<string | null> {
    const actor = requestContext.getStore();
    // B7: sin actor no hay privilegios; el sistema usa SYSTEM_ACTOR explícito.
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    if (dtoBuilding === undefined || dtoBuilding === null || (dtoBuilding as unknown as string) === '') return null;
    const allowed: { id: string }[] =
      isSystem(actor) || actor?.role === 'superadmin'
        ? await this.db.read((tx) => tx`SELECT id FROM buildings ORDER BY id`)
        : actor
          ? await this.db.read((tx) => tx`SELECT building_id id FROM user_buildings WHERE user_id=${actor.id} ORDER BY building_id`)
          : [];
    const ids = allowed.map((b) => b.id);
    if (actor?.role !== 'superadmin' && !isSystem(actor) && !ids.includes(dtoBuilding)) throw new ForbiddenException('Sin acceso a este edificio.');
    const [b] = await this.db.read((tx) => tx`SELECT id FROM buildings WHERE id=${dtoBuilding}`);
    if (!b) throw new BadRequestException('Edificio no encontrado.');
    return dtoBuilding;
  }

  async record(id: string): Promise<RouterRecord> {
    const [record] = await this.db.read((tx) => tx<RouterRecord[]>`SELECT * FROM routers WHERE id=${id}`);
    if (!record) throw new NotFoundException('Router no encontrado.');
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    // Sin edificio asignado el router es visible para cualquier rol autenticado (pool por asignar).
    if (record.building_id == null) return record;
    if (!isSystem(actor) && actor.role !== 'superadmin') {
      const [access] = await this.db.read(
        (tx) => tx`SELECT b.id FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE b.id=${record.building_id} AND ub.user_id=${actor.id} AND b.disabled=0`,
      );
      if (!access) throw new ForbiddenException('Sin acceso a este edificio.');
    }
    return record;
  }

  async withDevices(router: RouterRecord) {
    const devices = await this.db.read(
      (tx) => tx`SELECT d.mac,d.customer_id,c.apartment,c.name,c.archived FROM customer_devices d JOIN customers c ON c.id=d.customer_id WHERE d.router_id=${router.id} AND c.building_id=${router.building_id} ORDER BY c.apartment,d.mac`,
    );
    return { ...this.expose(router), devices };
  }

  async list() {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    const rows = await this.db.read(async (tx) => {
      if (isSystem(actor) || actor.role === 'superadmin') return tx<RouterRecord[]>`SELECT * FROM routers ORDER BY id`;
      return tx<RouterRecord[]>`SELECT r.* FROM routers r LEFT JOIN buildings b ON b.id=r.building_id WHERE (r.building_id IS NULL OR (b.disabled=0 AND EXISTS (SELECT 1 FROM user_buildings ub WHERE ub.user_id=${actor.id} AND ub.building_id=r.building_id))) ORDER BY r.id`;
    });
    return { routers: await Promise.all(rows.map((row) => this.withDevices(row))), adapters: this.adapters() };
  }

  async detail(id: string) {
    const record = await this.record(id);
    const checks = await this.db.read((tx) => tx`SELECT id, checked_at, success, message FROM router_checks WHERE router_id=${id} ORDER BY id DESC LIMIT 20`);
    const customers =
      record.building_id == null
        ? []
        : await this.db.read((tx) => tx`SELECT id,apartment,name FROM customers WHERE building_id=${record.building_id} AND archived=0 ORDER BY apartment,id`);
    return { router: await this.withDevices(record), checks, customers };
  }

  openCredentials(credentials: string) {
    return this.vault.open(credentials);
  }
}
