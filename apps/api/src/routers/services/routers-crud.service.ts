import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { isSystem, requestContext } from '../../common/request-context';
import { AdapterRegistry } from '../adapter-registry';
import { CredentialVault } from '../credential-vault';
import { LinkDeviceDto, SaveRouterDto, RouterToggleDto } from '../router.dto';
import { validateRouterHost } from '../router-network';
import type { RouterRecord, RouterSnapshot } from '../router.types';
import { uuidv7 } from '../../common/uuid';
import { RoutersOperationService } from './routers-operation.service';

/** CRUD de conexiones de routers + vinculación de dispositivos. */
@Injectable()
export class RoutersCrudService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
    private readonly ops: RoutersOperationService,
  ) {}

  list() {
    return this.ops.list();
  }

  detail(id: string) {
    return this.ops.detail(id);
  }

  async getUnlinkedMacs(id: string): Promise<Set<string>> {
    const linked = await this.db.read((tx) => tx<{ mac: string }[]>`SELECT mac FROM customer_devices WHERE router_id=${id}`);
    return new Set(linked.map((d) => d.mac.toUpperCase()));
  }

  async linkDevice(id: string, dto: LinkDeviceDto, getUnlinked: (routerId: string) => Promise<{ mac: string }[]>) {
    const current = await this.ops.record(id);
    if (current.building_id == null) throw new BadRequestException('Asigna un edificio al router antes de vincular dispositivos.');
    const mac = dto.mac.toUpperCase();
    const snapshot = current.snapshot ? (JSON.parse(current.snapshot) as RouterSnapshot) : null;
    const discovered =
      dto.customer_id && !snapshot?.clients?.some((c) => c.mac?.toUpperCase() === mac) && current.adapter === 'mikrotik-rest'
        ? (await getUnlinked(id)).some((c) => c.mac === mac)
        : false;
    await this.db.write(async (tx) => {
      const [router] = await tx`SELECT r.* FROM routers r JOIN buildings b ON b.id=r.building_id WHERE r.id=${id} AND r.disabled=0 AND b.disabled=0`;
      if (!router) throw new BadRequestException('El router o su edificio no están disponibles.');
      if ((await tx`SELECT q.id FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${router.building_id} AND q.status='running' LIMIT 1`).length) {
        throw new ConflictException('Espera a que termine la sincronización de red antes de cambiar las vinculaciones.');
      }
      const actor = requestContext.getStore();
      if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
      if (!isSystem(actor) && actor.role !== 'superadmin' && !(await tx`SELECT user_id FROM user_buildings WHERE user_id=${actor.id} AND building_id=${router.building_id}`).length) {
        throw new ForbiddenException('Sin acceso a este edificio.');
      }
      const [previousLink] = await tx`SELECT customer_id FROM customer_devices WHERE router_id=${id} AND mac=${mac}`;
      if (dto.customer_id) {
        const [customer] = await tx`SELECT id FROM customers WHERE id=${dto.customer_id} AND building_id=${router.building_id} AND archived=0`;
        if (!customer) throw new BadRequestException('Selecciona un departamento vigente del mismo edificio.');
        const snap = router.snapshot ? (JSON.parse(router.snapshot) as RouterSnapshot) : null;
        if (!snap?.clients?.some((c) => c.mac?.toUpperCase() === mac) && !discovered) {
          throw new BadRequestException('El dispositivo no aparece en la última consulta del router.');
        }
        await tx`INSERT INTO customer_devices(id,router_id,mac,customer_id,created_at) VALUES (${uuidv7()},${id},${mac},${dto.customer_id},${new Date().toISOString()}) ON CONFLICT(router_id,mac) DO UPDATE SET customer_id=excluded.customer_id`;
      } else {
        await tx`DELETE FROM customer_devices WHERE router_id=${id} AND mac=${mac}`;
      }
      for (const customerId of new Set([previousLink?.customer_id, dto.customer_id].filter(Boolean))) {
        await tx`INSERT INTO customer_network_dirty(id,customer_id) VALUES (${uuidv7()},${customerId}) ON CONFLICT(customer_id) DO NOTHING`;
      }
      await tx`INSERT INTO events(id,message,actor,building_id) VALUES (${uuidv7()},${`Dispositivo ${mac}: ${dto.customer_id ? 'vinculado al departamento #' + dto.customer_id : 'desvinculado'}.`},${actor?.username || 'Sistema'},${router.building_id})`;
    });
    return this.ops.detail(id);
  }

  async save(dto: SaveRouterDto, id?: string, snapshot?: RouterSnapshot) {
    if (id && (this.ops.checking.has(id) || this.ops.acting.has(id))) throw new ConflictException('Espera a que termine la operación del router.');
    validateRouterHost(dto.host);
    if (dto.diagnostic_host) validateRouterHost(dto.diagnostic_host);
    this.registry.get(dto.adapter);
    const previous = id ? await this.ops.record(id) : null;
    const bid = await this.ops.resolveBuilding(dto.building_id ?? previous?.building_id ?? undefined);
    if (!previous && (!dto.username || !dto.password)) throw new BadRequestException('Usuario y contraseña son obligatorios para registrar el router.');
    if (Boolean(dto.username) !== Boolean(dto.password)) throw new BadRequestException('Indica usuario y contraseña juntos, o deja ambos sin enviar para conservarlos.');
    const credentials = dto.username && dto.password ? this.vault.seal({ username: dto.username, password: dto.password }) : previous!.credentials;
    try {
      await this.db.write(async (tx) => {
        if (id) {
          const [bcentral] = await tx`SELECT central_router_id FROM buildings WHERE central_router_id=${id}`;
          if (previous?.building_id !== bid && (bcentral || (await tx`SELECT router_id FROM customer_devices WHERE router_id=${id} LIMIT 1`).length)) {
            throw new ConflictException('Retira el equipo central y las vinculaciones de dispositivos antes de cambiar de edificio.');
          }
          const jobs = await tx<{ payload: string }[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`;
          const assigned = bcentral?.central_router_id === id || jobs.some((job) => {
            const p = JSON.parse(job.payload);
            return p.routerId === id || p.previous?.routerId === id;
          });
          if (assigned && previous && (previous.building_id !== bid || previous.host !== dto.host || previous.port !== dto.port || previous.protocol !== dto.protocol || previous.adapter !== dto.adapter)) {
            throw new ConflictException('Cambia el equipo central y termina sus órdenes antes de modificar la dirección o el adaptador. Puedes actualizar las credenciales para recuperar la conexión.');
          }
          await tx`UPDATE routers SET name=${dto.name.trim()}, adapter=${dto.adapter}, host=${dto.host}, port=${dto.port}, protocol=${dto.protocol},
            diagnostic_host=${dto.diagnostic_host || null}, credentials=${credentials}, building_id=${bid}, status='untested', last_error=NULL, last_checked=NULL, snapshot=NULL WHERE id=${id}`;
        } else {
          await tx`INSERT INTO routers(id,name,adapter,host,port,protocol,diagnostic_host,credentials,building_id,status,last_checked,snapshot)
            VALUES (${uuidv7()},${dto.name.trim()}, ${dto.adapter}, ${dto.host}, ${dto.port}, ${dto.protocol}, ${dto.diagnostic_host || null}, ${credentials}, ${bid},
            ${snapshot ? 'connected' : 'untested'}, ${snapshot ? new Date().toISOString() : null}, ${snapshot ? JSON.stringify(snapshot) : null})`;
        }
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${'Conexión de router guardada: ' + dto.name.trim() + '.'},${bid})`;
      });
    } catch (error) {
      const e = error as { code?: string; errno?: string | number; message?: string };
      if (e.code === '23505' || e.errno === '23505' || e.message?.includes('UNIQUE constraint failed: routers.')) {
        throw new ConflictException('Ya existe una conexión para esa dirección y puerto.');
      }
      throw error;
    }
    return this.ops.list();
  }

  async remove(id: string) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Espera a que termine la operación del router.');
    const router = await this.ops.record(id);
    await this.db.write(async (tx) => {
      const [bcentral] = await tx`SELECT id, name FROM buildings WHERE central_router_id=${id} LIMIT 1`;
      const jobs = await tx<{ payload: string }[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`;
      if (bcentral || jobs.some((job) => {
        const p = JSON.parse(job.payload);
        return p.routerId === id || p.previous?.routerId === id;
      })) {
        throw new ConflictException('Este router es central o tiene órdenes pendientes. Cambia el equipo central y espera la limpieza antes de eliminarlo.');
      }
      await tx`DELETE FROM routers WHERE id=${id}`;
      await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Conexión eliminada del sistema: ${router.name}.`},${router.building_id})`;
    });
    return this.ops.list();
  }

  async toggle(id: string, dto: RouterToggleDto) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Espera a que termine la operación del router.');
    const router = await this.ops.record(id);
    if (dto.disabled) {
      const [bcentral] = await this.db.read((tx) => tx`SELECT id FROM buildings WHERE central_router_id=${id} LIMIT 1`);
      const jobs = await this.db.read((tx) => tx<{ payload: string }[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`);
      if (bcentral || jobs.some((job) => {
        const p = JSON.parse(job.payload);
        return p.routerId === id || p.previous?.routerId === id;
      })) {
        throw new ConflictException('Este router es central o tiene órdenes pendientes. Cambia el equipo central y espera la limpieza antes de deshabilitarlo.');
      }
    }
    await this.db.write(async (tx) => {
      await tx`UPDATE routers SET disabled=${dto.disabled ? 1 : 0} WHERE id=${id}`;
      await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`},${router.building_id})`;
    });
    return this.ops.list();
  }

  async record(id: string): Promise<RouterRecord> {
    return this.ops.record(id);
  }
}
