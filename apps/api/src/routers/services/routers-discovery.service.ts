import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { requestContext } from '../../common/request-context';
import { AdapterRegistry } from '../adapter-registry';
import { CredentialVault } from '../credential-vault';
import { ConnectRouterDto, SaveRouterDto, TestRouterDto } from '../router.dto';
import { validateRouterHost } from '../router-network';
import { discoverNeighbors } from '../mndp';
import { sweepLan, type LanCandidate } from '../lan-sweep';
import type { RouterRecord, RouterSnapshot } from '../router.types';
import { uuidv7 } from '../../common/uuid';
import { RoutersOperationService } from './routers-operation.service';
import { RoutersCrudService } from './routers-crud.service';

/**
 * Descubrimiento y verificación de routers: vecinos MNDP, barrido LAN,
 * prueba de conexión, alta y consulta de estado.
 */
@Injectable()
export class RoutersDiscoveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
    private readonly ops: RoutersOperationService,
    private readonly crud: RoutersCrudService,
  ) {}

  async discoverNeighbors(seconds = 30) {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    const window = Math.min(Math.max(seconds, 2), 60) * 1000;
    const [neighbors, candidates] = await Promise.all([discoverNeighbors(window), sweepLan().catch(() => [] as LanCandidate[])]);
    const announced = new Set(neighbors.flatMap((n) => n.ips));
    return { neighbors, candidates: candidates.filter((c) => !announced.has(c.ip)) };
  }

  async testConnection(dto: TestRouterDto) {
    validateRouterHost(dto.host);
    if (dto.diagnostic_host) validateRouterHost(dto.diagnostic_host);
    if (this.ops.connecting.has(dto.host) || this.ops.connecting.size >= 2) throw new ConflictException('Hay una conexión en curso. Espera a que termine e intenta de nuevo.');
    this.ops.connecting.add(dto.host);
    try {
      const credentials = { username: dto.username, password: dto.password };
      if (dto.adapter) {
        if (!dto.port || !dto.protocol) throw new BadRequestException('Indica protocolo y puerto para probar la configuración avanzada.');
        const target = { host: dto.host, port: dto.port, protocol: dto.protocol, diagnostic_host: dto.diagnostic_host || null };
        const snapshot = await this.registry.get(dto.adapter).inspect(target, credentials);
        return { success: true, adapter: dto.adapter, target, snapshot };
      }
      if (dto.port || dto.protocol || dto.diagnostic_host) throw new BadRequestException('Selecciona el adaptador para usar la configuración avanzada.');
      return { success: true, ...(await this.registry.detect(dto.host, credentials)) };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('No se pudo consultar el router. Revisa la conexión y los datos ingresados.');
    } finally {
      this.ops.connecting.delete(dto.host);
    }
  }

  async connect(dto: ConnectRouterDto) {
    validateRouterHost(dto.host);
    if (this.ops.connecting.has(dto.host) || this.ops.connecting.size >= 2) throw new ConflictException('Hay una conexión en curso. Espera a que termine e intenta de nuevo.');
    this.ops.connecting.add(dto.host);
    try {
      const existing = await this.db.read((tx) => tx`SELECT id FROM routers WHERE host=${dto.host}`);
      if (existing.length) throw new ConflictException('Esta IP ya está registrada. Usa Probar conexión o Editar conexión.');
      const detected = await this.registry.detect(dto.host, { username: dto.username, password: dto.password });
      const bid = await this.ops.resolveBuilding(dto.building_id);
      const saveDto: SaveRouterDto = {
        ...detected.target,
        diagnostic_host: undefined,
        adapter: detected.adapter,
        building_id: bid ?? undefined,
        name: `${detected.snapshot.manufacturer} ${detected.snapshot.model || dto.host}`.slice(0, 100),
        username: dto.username,
        password: dto.password,
      };
      return await this.crud.save(saveDto, undefined, detected.snapshot);
    } finally {
      this.ops.connecting.delete(dto.host);
    }
  }

  async check(id: string) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    if (this.ops.checking.size >= 2) throw new ConflictException('Hay dos consultas en curso. Intenta de nuevo al terminar.');
    this.ops.checking.add(id);
    try {
      const router = await this.ops.record(id);
      if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de consultarlo.');
      let snapshot: RouterSnapshot | null = null;
      let error: string | null = null;
      try {
        snapshot = await this.registry.get(router.adapter).inspect(router, this.vault.open(router.credentials));
      } catch (e) {
        error = e instanceof HttpException ? e.message : 'No se pudo consultar el router. Verifica la IP, el puerto, la conectividad y los requisitos del adaptador.';
      }
      const checkedAt = new Date().toISOString();
      const success = snapshot !== null;
      await this.db.write(async (tx) => {
        const [current] = await tx<RouterRecord[]>`SELECT * FROM routers WHERE id=${id}`;
        if (!current) throw new NotFoundException('La conexión fue eliminada durante la consulta.');
        if (['host', 'port', 'protocol', 'adapter', 'diagnostic_host', 'credentials'].some((key) => current[key as keyof RouterRecord] !== router[key as keyof RouterRecord])) {
          throw new ConflictException('La conexión cambió durante la consulta. Vuelve a probarla.');
        }
        const oldClients = current.snapshot ? JSON.parse(current.snapshot).clients : [];
        if (snapshot && JSON.stringify(oldClients) !== JSON.stringify(snapshot.clients)) {
          const pending = await tx<{ customer_id: string }[]>`SELECT DISTINCT customer_id FROM customer_devices WHERE router_id=${id}`;
          for (const row of pending) await tx`INSERT INTO customer_network_dirty(id,customer_id) VALUES (${uuidv7()},${row.customer_id}) ON CONFLICT(customer_id) DO NOTHING`;
        }
        await tx`UPDATE routers SET status=${success ? 'connected' : 'error'}, last_checked=${checkedAt}, last_error=${error}, snapshot=${snapshot ? JSON.stringify(snapshot) : current.snapshot} WHERE id=${id}`;
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${success ? 1 : 0},${error || 'Sesión autenticada y consulta completada.'})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${success ? 'consulta completada' : 'falló la consulta'}.`},${router.building_id})`;
      });
      const detail = await this.ops.detail(id);
      return { success, ...detail, router: { ...detail.router, checking: false } };
    } finally {
      this.ops.checking.delete(id);
    }
  }
}
