import { BadRequestException, ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AdapterRegistry } from '../adapter-registry';
import { CredentialVault } from '../credential-vault';
import { GenerateRouterScriptDto, ProvisionRouterUserDto, SetupLanDhcpDto, SetupWanDto, UpdateRouterServiceDto } from '../router.dto';
import { validateRouterHost } from '../router-network';
import { uuidv7 } from '../../common/uuid';
import { RoutersOperationService } from './routers-operation.service';

/**
 * Aprovisionamiento y configuración de routers: onboarding inicial,
 * usuarios de servicio, WAN/LAN, servicios, tráfico y scripts.
 */
@Injectable()
export class RoutersProvisioningService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
    private readonly ops: RoutersOperationService,
  ) {}

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

  async provisionUser(id: string, dto: ProvisionRouterUserDto) {
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.provisionNuwenetUser) throw new UnprocessableEntityException('El adaptador no admite aprovisionamiento automático.');
    const credentials = this.vault.open(router.credentials);
    const result = await adapter.provisionNuwenetUser(router, credentials, { username: dto.username, password: dto.password });
    let credentialsUpdated = false;
    if (dto.updateStoredCredentials !== false) {
      const encrypted = this.vault.seal({ username: result.username, password: result.password });
      await this.db.write((tx) => tx`UPDATE routers SET credentials=${encrypted} WHERE id=${id}`);
      credentialsUpdated = true;
    }
    let https: { certificate: string; enabled: boolean } | null = null;
    if (dto.setup_https) {
      if (!adapter.setupHttps) throw new UnprocessableEntityException('El adaptador no admite configuración automática de HTTPS.');
      https = await adapter.setupHttps(router, { username: result.username, password: result.password });
    }
    return { ...result, credentialsUpdated, https };
  }

  async getServices(id: string) {
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getServices) throw new UnprocessableEntityException('El adaptador no admite consulta de servicios.');
    return adapter.getServices(router, this.vault.open(router.credentials));
  }

  async updateService(id: string, dto: UpdateRouterServiceDto) {
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.updateService) throw new UnprocessableEntityException('El adaptador no admite configuración de servicios.');
    await adapter.updateService(router, this.vault.open(router.credentials), dto.service, { port: dto.port, disabled: dto.disabled, address: dto.address });
    return { ok: true, service: dto.service };
  }

  async setupWan(id: string, dto: SetupWanDto) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.ops.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de configurarlo.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setupWan) throw new UnprocessableEntityException('El adaptador no admite configuración WAN visual.');
    this.ops.acting.add(id);
    try {
      const result = await adapter.setupWan(router, this.vault.open(router.credentials), dto);
      await this.db.write(async (tx) => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`WAN: DHCP ${result.dhcpClient ? 'activo' : 'omitido'} en ${result.wanInterface}, NAT ${result.nat ? 'activo' : 'omitido'}`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: WAN configurada visualmente (DHCP ${result.dhcpClient ? 'sí' : 'no'}, NAT ${result.nat ? 'sí' : 'no'}).`},${router.building_id})`;
      });
      return { success: true, ...result };
    } finally {
      this.ops.acting.delete(id);
    }
  }

  async setupLanDhcp(id: string, dto: SetupLanDhcpDto) {
    if (this.ops.checking.has(id) || this.ops.acting.has(id)) throw new ConflictException('Ya hay una operación en curso para este router.');
    const router = await this.ops.record(id);
    if ((router as unknown as { disabled: number }).disabled) throw new ConflictException('El router está deshabilitado. Habilítalo antes de configurarlo.');
    const adapter = this.registry.get(router.adapter);
    if (!adapter.setupLanDhcp) throw new UnprocessableEntityException('El adaptador no admite configuración LAN/DHCP visual.');
    this.ops.acting.add(id);
    try {
      const result = await adapter.setupLanDhcp(router, this.vault.open(router.credentials), dto);
      await this.db.write(async (tx) => {
        await tx`INSERT INTO router_checks(id,router_id,checked_at,success,message) VALUES (${uuidv7()},${id},${new Date().toISOString()},${1},${`LAN ${result.lan} en ${result.lanInterface}, pool ${result.pool}, ${result.leases} leases`.slice(0, 500)})`;
        await tx`INSERT INTO events(id,message,building_id) VALUES (${uuidv7()},${`Router ${router.name}: LAN/DHCP configurada visualmente (${result.lan}, ${result.leases} leases). No se eliminaron leases existentes.`},${router.building_id})`;
      });
      return { success: true, ...result };
    } finally {
      this.ops.acting.delete(id);
    }
  }

  async getTraffic(id: string, ipOrQueueName?: string) {
    if (ipOrQueueName && ipOrQueueName.length > 160) throw new BadRequestException('Filtro de cola demasiado largo.');
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getTrafficStats) throw new UnprocessableEntityException('El adaptador no admite monitoreo de tráfico.');
    return adapter.getTrafficStats(router, this.vault.open(router.credentials), ipOrQueueName);
  }

  async getUnlinkedDevices(id: string) {
    const router = await this.ops.record(id);
    const adapter = this.registry.get(router.adapter);
    if (!adapter.getUnlinkedDevices) throw new UnprocessableEntityException('El adaptador no admite auto-descubrimiento.');
    const linked = await this.db.read((tx) => tx<{ mac: string }[]>`SELECT mac FROM customer_devices WHERE router_id=${id}`);
    const linkedMacs = new Set(linked.map((d) => d.mac.toUpperCase()));
    return adapter.getUnlinkedDevices(router, this.vault.open(router.credentials), linkedMacs);
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
