import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requestContext, isSystem } from '../common/request-context';
import { AdapterRegistry } from './adapter-registry';
import { CredentialVault } from './credential-vault';
import { ConnectRouterDto, GenerateRouterScriptDto, LinkDeviceDto, ProvisionRouterUserDto, RouterActionDto, RouterToggleDto, SaveRouterDto, SetupLanDhcpDto, SetupWanDto, TestRouterDto, UpdateRouterServiceDto } from './router.dto';
import { validateRouterHost } from './router-network';
import { discoverNeighbors } from './mndp';
import { sweepLan, type LanCandidate } from './lan-sweep';
import { uuidv7 } from '../common/uuid';
import type { RouterRecord, RouterSnapshot } from './router.types';
import { isValidatedArris, routerCompatibility } from './router.types';

@Injectable()
export class RoutersService {
  private readonly checking = new Set<string>();
  private readonly acting = new Set<string>();
  private readonly connecting = new Set<string>();
  constructor(private readonly db: DatabaseService, private readonly registry: AdapterRegistry, private readonly vault: CredentialVault) {}

  adapters() { return this.registry.list(); }
  private expose(router: RouterRecord) {
    const { credentials, snapshot, ...safe } = router;
    const parsed = snapshot ? JSON.parse(snapshot) as RouterSnapshot : null;
    const capabilities = { ...this.registry.get(router.adapter).description.capabilities };
    if (router.adapter === 'arris-touchstone' && !isValidatedArris(parsed)) {
      capabilities.suspend = capabilities.reactivate = capabilities.firewall = capabilities.parental_control = false;
    }
    return { ...safe, credentials_saved: Boolean(credentials), snapshot: parsed,
      checking: this.checking.has(router.id) || this.acting.has(router.id), capabilities,
      compatibility: routerCompatibility(router.adapter, parsed, (router as unknown as { disabled: number }).disabled) };
  }
  private async resolveBuilding(dtoBuilding?: string | null): Promise<string | null> {
    const actor = requestContext.getStore();
    // B7: sin actor no hay privilegios; el sistema usa SYSTEM_ACTOR explícito.
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    // El edificio es opcional: un router puede crearse sin asignar y vincularse después.
    // Sin try/catch: un fallo de BD debe propagarse, no resolverse como edificio válido.
    if (dtoBuilding === undefined || dtoBuilding === null || (dtoBuilding as unknown as string) === '') return null;
    const allowed: { id: string }[] = (isSystem(actor) || actor?.role === 'superadmin')
      ? await this.db.read(tx => tx`SELECT id FROM buildings ORDER BY id`)
      : actor ? await this.db.read(tx => tx`SELECT building_id id FROM user_buildings WHERE user_id=${actor.id} ORDER BY building_id`) : [];
    const ids = allowed.map(b => b.id);
    if (actor?.role !== 'superadmin' && !isSystem(actor) && !ids.includes(dtoBuilding)) throw new ForbiddenException('Sin acceso a este edificio.');
    const [b] = await this.db.read(tx => tx`SELECT id FROM buildings WHERE id=${dtoBuilding}`);
    if (!b) throw new BadRequestException('Edificio no encontrado.');
    return dtoBuilding;
  }
  async list() {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    const rows = await this.db.read(async tx => {
      if (isSystem(actor) || actor.role === 'superadmin') return tx<RouterRecord[]>`SELECT * FROM routers ORDER BY id`;
      return tx<RouterRecord[]>`SELECT r.* FROM routers r LEFT JOIN buildings b ON b.id=r.building_id WHERE (r.building_id IS NULL OR (b.disabled=0 AND EXISTS (SELECT 1 FROM user_buildings ub WHERE ub.user_id=${actor.id} AND ub.building_id=r.building_id))) ORDER BY r.id`;
    });
    return { routers: await Promise.all(rows.map(row => this.withDevices(row))), adapters: this.adapters() };
  }
  private async withDevices(router: RouterRecord) {
    const devices = await this.db.read(tx=>tx`SELECT d.mac,d.customer_id,c.apartment,c.name,c.archived FROM customer_devices d JOIN customers c ON c.id=d.customer_id WHERE d.router_id=${router.id} AND c.building_id=${router.building_id} ORDER BY c.apartment,d.mac`);
    return {...this.expose(router),devices};
  }
  async linkDevice(id: string, dto: LinkDeviceDto) {
    const current=await this.record(id);
    if (current.building_id == null) throw new BadRequestException('Asigna un edificio al router antes de vincular dispositivos.');
    const mac=dto.mac.toUpperCase();
    const snapshot=current.snapshot?JSON.parse(current.snapshot) as RouterSnapshot:null;
    const discovered=dto.customer_id && !snapshot?.clients?.some(c=>c.mac?.toUpperCase()===mac) && current.adapter==='mikrotik-rest' ? (await this.getUnlinkedDevices(id)).some(c=>c.mac===mac) : false;
    await this.db.write(async tx=>{
      const [router]=await tx`SELECT r.* FROM routers r JOIN buildings b ON b.id=r.building_id WHERE r.id=${id} AND r.disabled=0 AND b.disabled=0`;
      if (!router) throw new BadRequestException('El router o su edificio no están disponibles.');
      if((await tx`SELECT q.id FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${router.building_id} AND q.status='running' LIMIT 1`).length)throw new ConflictException('Espera a que termine la sincronización de red antes de cambiar las vinculaciones.');
      const actor=requestContext.getStore();
      if(!actor) throw new ForbiddenException('Sin contexto de seguridad.');
      if(!isSystem(actor) && actor.role!=='superadmin' && !(await tx`SELECT user_id FROM user_buildings WHERE user_id=${actor.id} AND building_id=${router.building_id}`).length) throw new ForbiddenException('Sin acceso a este edificio.');
      const [previousLink]=await tx`SELECT customer_id FROM customer_devices WHERE router_id=${id} AND mac=${mac}`;
      if (dto.customer_id) {
        const [customer]=await tx`SELECT id FROM customers WHERE id=${dto.customer_id} AND building_id=${router.building_id} AND archived=0`;
        if (!customer) throw new BadRequestException('Selecciona un departamento vigente del mismo edificio.');
        const snapshot=router.snapshot?JSON.parse(router.snapshot) as RouterSnapshot:null;
        if (!snapshot?.clients?.some(c=>c.mac?.toUpperCase()===mac) && !discovered) throw new BadRequestException('El dispositivo no aparece en la última consulta del router.');
        await tx`INSERT INTO customer_devices(id,router_id,mac,customer_id,created_at) VALUES (${uuidv7()},${id},${mac},${dto.customer_id},${new Date().toISOString()}) ON CONFLICT(router_id,mac) DO UPDATE SET customer_id=excluded.customer_id`;
      } else await tx`DELETE FROM customer_devices WHERE router_id=${id} AND mac=${mac}`;
      for(const customerId of new Set([previousLink?.customer_id,dto.customer_id].filter(Boolean)))await tx`INSERT INTO customer_network_dirty(id,customer_id) VALUES (${uuidv7()},${customerId}) ON CONFLICT(customer_id) DO NOTHING`;
      await tx`INSERT INTO events(id,message,actor,building_id) VALUES (${uuidv7()},${`Dispositivo ${mac}: ${dto.customer_id?'vinculado al departamento #'+dto.customer_id:'desvinculado'}.`},${actor?.username||'Sistema'},${router.building_id})`;
    });
    return this.detail(id);
  }
  private async record(id: string) {
    const [record] = await this.db.read(tx => tx<RouterRecord[]>`SELECT * FROM routers WHERE id=${id}`);
    if (!record) throw new NotFoundException('Router no encontrado.');
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    // Sin edificio asignado el router es visible para cualquier rol autenticado (pool por asignar).
    if (record.building_id == null) return record;
    if (!isSystem(actor) && actor.role !== 'superadmin') {
      const [access] = await this.db.read(tx => tx`SELECT b.id FROM buildings b JOIN user_buildings ub ON ub.building_id=b.id WHERE b.id=${record.building_id} AND ub.user_id=${actor.id} AND b.disabled=0`);
      if (!access) throw new ForbiddenException('Sin acceso a este edificio.');
    }
    return record;
  }
  async detail(id: string) {
    const record = await this.record(id);
    const checks = await this.db.read(tx => tx`SELECT id, checked_at, success, message FROM router_checks WHERE router_id=${id} ORDER BY id DESC LIMIT 20`);
    const customers = record.building_id == null
      ? []
      : await this.db.read(tx=>tx`SELECT id,apartment,name FROM customers WHERE building_id=${record.building_id} AND archived=0 ORDER BY apartment,id`);
    return { router: await this.withDevices(record), checks, customers };
  }

  /**
   * Descubre equipos en la red del servidor. Combina anuncios MNDP (identidad
   * verificada por protocolo) con barrido de puertos 8291/80/443 (candidatos
   * sin confirmar). Solo lectura, sin credenciales.
   */
  async discoverNeighbors(seconds = 30) {
    const actor = requestContext.getStore();
    if (!actor) throw new ForbiddenException('Sin contexto de seguridad.');
    const window = Math.min(Math.max(seconds, 2), 60) * 1000;
    const [neighbors, candidates] = await Promise.all([
      discoverNeighbors(window),
      sweepLan().catch(() => [] as LanCandidate[]),
    ]);
    const announced = new Set(neighbors.flatMap(n => n.ips));
    return { neighbors, candidates: candidates.filter(c => !announced.has(c.ip)) };
  }
  /**
   * Puesta en marcha inicial de un MikroTik desde el sistema: contacto con
   * credenciales actuales (vacías = fábrica), identidad, IP de gestión (/24,
   * se suma sin quitar la anterior), DNS, usuario de servicio y HTTPS
   * opcional. Verifica en la nueva IP y retira la de fábrica solo si la
   * verificación funciona. Si algo falla a mitad, informa lo ya aplicado.
   */
  async onboard(dto: { host: string; port?: number; protocol?: 'http' | 'https'; username?: string; password?: string; identity: string; newAddress: string; interface?: string; dns?: string; serviceUsername?: string; servicePassword?: string; setup_https?: boolean }) {
    validateRouterHost(dto.host);
    const adapter = this.registry.get('mikrotik-rest');
    if (!adapter.setIdentity || !adapter.addIpAddress || !adapter.setDns || !adapter.provisionNuwenetUser) {
      throw new UnprocessableEntityException('El adaptador no admite puesta en marcha inicial.');
    }
    const target = { host: dto.host, port: dto.port || 80, protocol: dto.protocol || 'http', diagnostic_host: null as string | null };
    const creds = { username: dto.username?.trim() || 'admin', password: dto.password || '' };
    const applied: string[] = [];
    const fail = (message: string): never => {
      throw new BadRequestException(applied.length ? `${message} Ya aplicado: ${applied.join(', ')}.` : message);
    };
    try {
      await adapter.inspect(target, creds);
    } catch {
      throw new BadRequestException('No se pudo contactar al equipo con esas credenciales. Revisa IP, protocolo y acceso.');
    }
    const lanInterface = dto.interface?.trim() || 'ether2';
    const [newIp] = dto.newAddress.split('/');
    const identity = await adapter.setIdentity(target, creds, dto.identity).catch(() => fail('No se pudo fijar la identidad'));
    applied.push(`identidad ${identity.identity}`);
    await adapter.addIpAddress(target, creds, { address: dto.newAddress, interface: lanInterface }).catch(() => fail('No se pudo asignar la IP de gestión'));
    applied.push(`IP ${dto.newAddress} en ${lanInterface}`);
    let dns: string[] = [];
    if (dto.dns?.trim()) {
      dns = (await adapter.setDns(target, creds, dto.dns.split(',')).catch(() => fail('No se pudieron fijar los DNS'))).servers;
      applied.push(`DNS ${dns.join(',')}`);
    }
    const prov = await adapter.provisionNuwenetUser(target, creds, { username: dto.serviceUsername, password: dto.servicePassword }).catch(() => fail('No se pudo crear el usuario de servicio'));
    applied.push(`usuario ${prov.username}`);
    const serviceCreds = { username: prov.username, password: prov.password };
    let https: { certificate: string; enabled: boolean } | null = null;
    if (dto.setup_https && adapter.setupHttps) {
      https = await adapter.setupHttps(target, serviceCreds).catch(() => fail('No se pudo configurar HTTPS'));
      applied.push(`HTTPS ${https.certificate}`);
    }
    try {
      await adapter.inspect({ ...target, host: newIp }, serviceCreds);
    } catch {
      fail(`No se pudo verificar en ${newIp} con el usuario de servicio`);
    }
    return { identity: identity.identity, managementIp: `${newIp}/24`, interface: lanInterface, dns, serviceUsername: prov.username, servicePassword: prov.password, script: prov.script, https, verified: true, applied };
  }
  async testConnection(dto: TestRouterDto) {
    validateRouterHost(dto.host);
    if (dto.diagnostic_host) validateRouterHost(dto.diagnostic_host);
    if (this.connecting.has(dto.host) || this.connecting.size >= 2) throw new ConflictException('Hay una conexión en curso. Espera a que termine e intenta de nuevo.');
    this.connecting.add(dto.host);
    try {
      const credentials = { username: dto.username, password: dto.password };
      if (dto.adapter) {
        if (!dto.port || !dto.protocol) throw new BadRequestException('Indica protocolo y puerto para probar la configuración avanzada.');
        const target = { host: dto.host, port: dto.port, protocol: dto.protocol, diagnostic_host: dto.diagnostic_host || null };
        const snapshot = await this.registry.get(dto.adapter).inspect(target, credentials);
        return { success: true, adapter: dto.adapter, target, snapshot };
      }
      if (dto.port || dto.protocol || dto.diagnostic_host) throw new BadRequestException('Selecciona el adaptador para usar la configuración avanzada.');
      return { success: true, ...await this.registry.detect(dto.host, credentials) };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('No se pudo consultar el router. Revisa la conexión y los datos ingresados.');
    } finally { this.connecting.delete(dto.host); }
  }

  async connect(dto: ConnectRouterDto) {
    validateRouterHost(dto.host);
    if (this.connecting.has(dto.host) || this.connecting.size >= 2) throw new ConflictException('Hay una conexión en curso. Espera a que termine e intenta de nuevo.');
    this.connecting.add(dto.host);
    try {
      const existing = await this.db.read(tx => tx`SELECT id FROM routers WHERE host=${dto.host}`);
      if (existing.length) throw new ConflictException('Esta IP ya está registrada. Usa Probar conexión o Editar conexión.');
      const detected = await this.registry.detect(dto.host, { username: dto.username, password: dto.password });
      const bid = await this.resolveBuilding(dto.building_id);
      return await this.save({ ...detected.target, diagnostic_host: undefined, adapter: detected.adapter, building_id: bid ?? undefined,
        name: `${detected.snapshot.manufacturer} ${detected.snapshot.model || dto.host}`.slice(0, 100),
        username: dto.username, password: dto.password }, undefined, detected.snapshot);
    } finally { this.connecting.delete(dto.host); }
  }

  async save(dto: SaveRouterDto, id?: string, snapshot?: RouterSnapshot) {
    if (id && (this.checking.has(id) || this.acting.has(id))) throw new ConflictException('Espera a que termine la operación del router.');
    validateRouterHost(dto.host);
    if (dto.diagnostic_host) validateRouterHost(dto.diagnostic_host);
    this.registry.get(dto.adapter);
    const previous = id ? await this.record(id) : null;
    const bid = await this.resolveBuilding(dto.building_id ?? previous?.building_id ?? undefined);
    if (!previous && (!dto.username || !dto.password)) throw new BadRequestException('Usuario y contraseña son obligatorios para registrar el router.');
    if (Boolean(dto.username) !== Boolean(dto.password)) throw new BadRequestException('Indica usuario y contraseña juntos, o deja ambos sin enviar para conservarlos.');
    const credentials = dto.username && dto.password ? this.vault.seal({ username: dto.username, password: dto.password }) : previous!.credentials;
    try {
      await this.db.write(async tx => {
        if (id) {
          const [bcentral]=await tx`SELECT central_router_id FROM buildings WHERE central_router_id=${id}`;
          if (previous?.building_id !== bid && (bcentral || (await tx`SELECT router_id FROM customer_devices WHERE router_id=${id} LIMIT 1`).length)) throw new ConflictException('Retira el equipo central y las vinculaciones de dispositivos antes de cambiar de edificio.');
          const jobs=await tx<{payload:string}[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`;
          const assigned=bcentral?.central_router_id===id || jobs.some(job=>{const p=JSON.parse(job.payload);return p.routerId===id || p.previous?.routerId===id;});
          if (assigned && previous && (previous.building_id!==bid || previous.host!==dto.host || previous.port!==dto.port || previous.protocol!==dto.protocol || previous.adapter!==dto.adapter)) throw new ConflictException('Cambia el equipo central y termina sus órdenes antes de modificar la dirección o el adaptador. Puedes actualizar las credenciales para recuperar la conexión.');
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
      if (e.code === '23505' || e.errno === '23505' || e.message?.includes('UNIQUE constraint failed: routers.')) throw new ConflictException('Ya existe una conexión para esa dirección y puerto.');
      throw error;
    }
    return this.list();
  }

  async check(id: string) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    if (this.checking.size >= 2) throw new ConflictException('Hay dos consultas en curso. Intenta de nuevo al terminar.');
    this.checking.add(id);
    try {
      const router = await this.record(id);
      if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de consultarlo.');
      let snapshot: RouterSnapshot | null = null;
      let error: string | null = null;
      try { snapshot = await this.registry.get(router.adapter).inspect(router, this.vault.open(router.credentials)); }
      catch (e) {
        error = e instanceof HttpException ? e.message : 'No se pudo consultar el router. Verifica la IP, el puerto, la conectividad y los requisitos del adaptador.';
      }
      const checkedAt = new Date().toISOString();
      const success = snapshot !== null;
      await this.db.write(async tx => {
        const [current] = await tx<RouterRecord[]>`SELECT * FROM routers WHERE id=${id}`;
        if (!current) throw new NotFoundException('La conexión fue eliminada durante la consulta.');
        if (['host','port','protocol','adapter','diagnostic_host','credentials'].some(key => current[key as keyof RouterRecord] !== router[key as keyof RouterRecord])) {
          throw new ConflictException('La conexión cambió durante la consulta. Vuelve a probarla.');
        }
        const oldClients=current.snapshot?JSON.parse(current.snapshot).clients:[];
        if(snapshot && JSON.stringify(oldClients)!==JSON.stringify(snapshot.clients)){
          const pending=await tx<{customer_id:string}[]>`SELECT DISTINCT customer_id FROM customer_devices WHERE router_id=${id}`;
          for(const row of pending)await tx`INSERT INTO customer_network_dirty(id,customer_id) VALUES (${uuidv7()},${row.customer_id}) ON CONFLICT(customer_id) DO NOTHING`;
        }
        await tx`UPDATE routers SET status=${success ? 'connected' : 'error'}, last_checked=${checkedAt}, last_error=${error}, snapshot=${snapshot ? JSON.stringify(snapshot) : current.snapshot} WHERE id=${id}`;
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${success ? 1 : 0},${error || 'Sesión autenticada y consulta completada.'})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${success ? 'consulta completada' : 'falló la consulta'}.`},${router.building_id})`;
      });
      const detail = await this.detail(id);
      return { success, ...detail, router: { ...detail.router, checking: false } };
    } finally { this.checking.delete(id); }
  }

  async remove(id: string) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Espera a que termine la operación del router.');
    const router = await this.record(id);
    await this.db.write(async tx => {
      const [bcentral] = await tx`SELECT id, name FROM buildings WHERE central_router_id=${id} LIMIT 1`;
      const jobs = await tx<{payload:string}[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`;
      if (bcentral || jobs.some(job => { const p=JSON.parse(job.payload); return p.routerId===id || p.previous?.routerId===id; })) throw new ConflictException('Este router es central o tiene órdenes pendientes. Cambia el equipo central y espera la limpieza antes de eliminarlo.');
      await tx`DELETE FROM routers WHERE id=${id}`;
      await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Conexión eliminada del sistema: ${router.name}.`},${router.building_id})`;
    });
    return this.list();
  }

  async toggle(id: string, dto: RouterToggleDto) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Espera a que termine la operación del router.');
    const router = await this.record(id);
    if (dto.disabled) {
      const [bcentral] = await this.db.read(tx => tx`SELECT id FROM buildings WHERE central_router_id=${id} LIMIT 1`);
      const jobs = await this.db.read(tx => tx<{payload:string}[]>`SELECT payload FROM commands WHERE status IN ('pending','failed','running') AND payload IS NOT NULL`);
      if (bcentral || jobs.some(job => { const p=JSON.parse(job.payload); return p.routerId===id || p.previous?.routerId===id; })) throw new ConflictException('Este router es central o tiene órdenes pendientes. Cambia el equipo central y espera la limpieza antes de deshabilitarlo.');
    }
    await this.db.write(async tx => {
      await tx`UPDATE routers SET disabled=${dto.disabled ? 1 : 0} WHERE id=${id}`;
      await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`},${router.building_id})`;
    });
    return this.list();
  }

  async action(id: string, dto: RouterActionDto, fromQueue = false) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    this.acting.add(id);
    try { return await this.executeAction(id, dto, fromQueue); }
    finally { this.acting.delete(id); }
  }

  private async executeAction(id: string, dto: RouterActionDto, fromQueue: boolean) {
    if (!fromQueue && dto.ip && ['suspend','reactivate','speed_limit'].includes(dto.action)) {
      const assigned=await this.db.read(tx=>tx`SELECT id FROM customers WHERE ip=${dto.ip!}`);
      if(assigned.length)throw new ConflictException('Esta IP pertenece a un departamento. Cambia su acceso o plan desde Departamentos para conservar la sincronización y el historial.');
    }
    const router = await this.record(id);
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
        await this.db.write(async tx => {
          await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${0},${`${dto.action} ${dto.ip}: ${message}`.slice(0, 500)})`;
          await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: falló ${dto.action} para ${dto.ip}.`},${router.building_id})`;
        });
        throw error;
      }
      const checkedAt = new Date().toISOString();
      await this.db.write(async tx => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${checkedAt},${1},${`${dto.action} ${dto.ip}: ${result}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: ${dto.action} aplicado a ${dto.ip}.`},${router.building_id})`;
      });
      const detail = await this.detail(id);
      return { success: true, result, ...detail, router: { ...detail.router, checking: false } };
    }
    throw new UnprocessableEntityException('La ejecución de esta acción todavía no está implementada.');
  }
  async releaseClient(id: string, ip: string) {
    const router=await this.record(id), adapter=this.registry.get(router.adapter);
    if (!adapter.releaseClient) throw new UnprocessableEntityException('El adaptador no admite limpieza de reglas.');
    await adapter.releaseClient(router,this.vault.open(router.credentials),ip);
  }
  async departmentSpeed(id:string,customerId:string,ips:string[],down:number,up:number){
    if(this.acting.has(id)||this.checking.has(id))throw new ConflictException('El router tiene una operación en curso.');
    this.acting.add(id);
    try{
      const router=await this.record(id),adapter=this.registry.get(router.adapter);
      if(!adapter.departmentSpeed)throw new UnprocessableEntityException('El adaptador no admite velocidad compartida por departamento.');
      await adapter.departmentSpeed(router,this.vault.open(router.credentials),customerId,ips,down,up);
    }finally{this.acting.delete(id);}
  }

  async switchPort(id: string, dto: { name: string; disabled: boolean }) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de modificar puertos.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setEthernetPort) throw new UnprocessableEntityException('El adaptador no admite administración de puertos.');
    this.acting.add(id);
    try {
      const result = await adapter.setEthernetPort(router, this.vault.open(router.credentials), dto);
      await this.db.write(async tx => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`puerto ${dto.name}: ${dto.disabled ? 'deshabilitado' : 'habilitado'}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: puerto ${dto.name} ${dto.disabled ? 'deshabilitado' : 'habilitado'}.`},${router.building_id})`;
      });
      const detail = await this.detail(id);
      return { success: true, port: result, ...detail, router: { ...detail.router, checking: false } };
    } finally { this.acting.delete(id); }
  }
  async getServices(id: string) {
    const router = await this.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getServices) throw new UnprocessableEntityException('El adaptador no admite consulta de servicios.');
    const credentials = this.vault.open(router.credentials);
    return adapter.getServices(router, credentials);
  }

  async updateService(id: string, dto: UpdateRouterServiceDto) {
    const router = await this.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.updateService) throw new UnprocessableEntityException('El adaptador no admite configuración de servicios.');
    const credentials = this.vault.open(router.credentials);
    await adapter.updateService(router, credentials, dto.service, {
      port: dto.port,
      disabled: dto.disabled,
      address: dto.address,
    });
    return { ok: true, service: dto.service };
  }

  async provisionUser(id: string, dto: ProvisionRouterUserDto) {
    const router = await this.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.provisionNuwenetUser) throw new UnprocessableEntityException('El adaptador no admite aprovisionamiento automático.');
    const credentials = this.vault.open(router.credentials);
    const result = await adapter.provisionNuwenetUser(router, credentials, {
      username: dto.username,
      password: dto.password,
    });
    let credentialsUpdated = false;
    if (dto.updateStoredCredentials !== false) {
      const encrypted = this.vault.seal({ username: result.username, password: result.password });
      await this.db.write(tx => tx`UPDATE routers SET credentials=${encrypted} WHERE id=${id}`);
      credentialsUpdated = true;
    }
    // HTTPS con certificado local: el router ya tiene las credenciales nuevas, así que se usan esas.
    let https: { certificate: string; enabled: boolean } | null = null;
    if (dto.setup_https) {
      if (!adapter.setupHttps) throw new UnprocessableEntityException('El adaptador no admite configuración automática de HTTPS.');
      https = await adapter.setupHttps(router, { username: result.username, password: result.password });
    }
    return { ...result, credentialsUpdated, https };
  }

  async getTraffic(id: string, ipOrQueueName?:string) {
    if(ipOrQueueName && ipOrQueueName.length>160)throw new BadRequestException('Filtro de cola demasiado largo.');
    const router = await this.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getTrafficStats) throw new UnprocessableEntityException('El adaptador no admite monitoreo de tráfico.');
    const credentials = this.vault.open(router.credentials);
    return adapter.getTrafficStats(router, credentials,ipOrQueueName);
  }

  async getUnlinkedDevices(id: string) {
    const router = await this.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getUnlinkedDevices) throw new UnprocessableEntityException('El adaptador no admite auto-descubrimiento.');
    const credentials = this.vault.open(router.credentials);
    const linked = await this.db.read(tx => tx<{ mac: string }[]>`SELECT mac FROM customer_devices WHERE router_id=${id}`);
    const linkedMacs = new Set(linked.map(d => d.mac.toUpperCase()));
    return adapter.getUnlinkedDevices(router, credentials, linkedMacs);
  }

  async setupWan(id: string, dto: SetupWanDto) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de configurarlo.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setupWan) throw new UnprocessableEntityException('El adaptador no admite configuración WAN visual.');
    this.acting.add(id);
    try {
      const result = await adapter.setupWan(router, this.vault.open(router.credentials), dto);
      await this.db.write(async tx => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`WAN: DHCP ${result.dhcpClient ? 'activo' : 'omitido'} en ${result.wanInterface}, NAT ${result.nat ? 'activo' : 'omitido'}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: WAN configurada visualmente (DHCP ${result.dhcpClient ? 'sí' : 'no'}, NAT ${result.nat ? 'sí' : 'no'}).`},${router.building_id})`;
      });
      return { success: true, ...result };
    } finally { this.acting.delete(id); }
  }

  async setupLanDhcp(id: string, dto: SetupLanDhcpDto) {
    if (this.checking.has(id) || this.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de configurarlo.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setupLanDhcp) throw new UnprocessableEntityException('El adaptador no admite configuración LAN/DHCP visual.');
    this.acting.add(id);
    try {
      const result = await adapter.setupLanDhcp(router, this.vault.open(router.credentials), dto);
      await this.db.write(async tx => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`LAN ${result.lan} en ${result.lanInterface}, pool ${result.pool}, ${result.leases} leases`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: LAN/DHCP configurada visualmente (${result.lan}, ${result.leases} leases). No se eliminaron leases existentes.`},${router.building_id})`;
      });
      return { success: true, ...result };
    } finally { this.acting.delete(id); }
  }

  generateScript(dto: GenerateRouterScriptDto) {
    const adapter = this.registry.get('mikrotik-rest');
    if (!adapter.generateCliScript) throw new UnprocessableEntityException('Generador de scripts no disponible.');
    if (dto.restrictIp) validateRouterHost(dto.restrictIp.split('/')[0]);
    const script = adapter.generateCliScript({
      username: dto.username,
      password: dto.password,
      sslPort: dto.sslPort,
      disableInsecure: dto.disableInsecure,
      restrictIp: dto.restrictIp,
      wanInterface: dto.wanInterface,
      wanDhcp: dto.wanDhcp,
      nat: dto.nat,
      lan: dto.lan,
      lanInterface: dto.lanInterface,
      pool: dto.pool,
      dns: dto.dns,
      leases: dto.leases,
    });
    return { script };
  }
}

