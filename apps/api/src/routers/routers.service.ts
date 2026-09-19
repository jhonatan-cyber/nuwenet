import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AdapterRegistry } from './adapter-registry';
import { CredentialVault } from './credential-vault';
import { ConnectRouterDto, GenerateRouterScriptDto, LinkDeviceDto, ProvisionRouterUserDto, RouterActionDto, RouterToggleDto, SaveRouterDto, SetupLanDhcpDto, SetupWanDto, TestRouterDto, UpdateRouterServiceDto, SwitchPortDto } from './router.dto';
import { RoutersOperationService } from './services/routers-operation.service';
import { RoutersCrudService } from './services/routers-crud.service';
import { RoutersDiscoveryService } from './services/routers-discovery.service';
import { RoutersActionsService } from './services/routers-actions.service';
import { RoutersProvisioningService } from './services/routers-provisioning.service';

/**
 * Fachada de routers. Mantiene la API pública histórica
 * (`new RoutersService(db, registry, vault)` sigue funcionando en tests)
 * pero delega cada responsabilidad a su servicio especializado.
 */
@Injectable()
export class RoutersService {
  private readonly ops: RoutersOperationService;
  private readonly crud: RoutersCrudService;
  private readonly discovery: RoutersDiscoveryService;
  private readonly actions: RoutersActionsService;
  private readonly provisioning: RoutersProvisioningService;

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: AdapterRegistry,
    private readonly vault: CredentialVault,
    @Optional() ops?: RoutersOperationService,
    @Optional() crud?: RoutersCrudService,
    @Optional() discovery?: RoutersDiscoveryService,
    @Optional() actions?: RoutersActionsService,
    @Optional() provisioning?: RoutersProvisioningService,
  ) {
    this.ops = ops ?? new RoutersOperationService(db, registry, vault);
    this.crud = crud ?? new RoutersCrudService(db, registry, vault, this.ops);
    this.discovery = discovery ?? new RoutersDiscoveryService(db, registry, vault, this.ops, this.crud);
    this.actions = actions ?? new RoutersActionsService(db, registry, vault, this.ops);
    this.provisioning = provisioning ?? new RoutersProvisioningService(db, registry, vault, this.ops);
  }

  adapters() {
    return this.ops.adapters();
  }
  list() {
    return this.crud.list();
  }
  detail(id: string) {
    return this.crud.detail(id);
  }
  discoverNeighbors(seconds = 30) {
    return this.discovery.discoverNeighbors(seconds);
  }
  onboard(dto: Parameters<RoutersProvisioningService['onboard']>[0]) {
    return this.provisioning.onboard(dto);
  }
  testConnection(dto: TestRouterDto) {
    return this.discovery.testConnection(dto);
  }
  connect(dto: ConnectRouterDto) {
    return this.discovery.connect(dto);
  }
  save(dto: SaveRouterDto, id?: string, snapshot?: Parameters<RoutersCrudService['save']>[2]) {
    return this.crud.save(dto, id, snapshot);
  }
  check(id: string) {
    return this.discovery.check(id);
  }
  remove(id: string) {
    return this.crud.remove(id);
  }
  toggle(id: string, dto: RouterToggleDto) {
    return this.crud.toggle(id, dto);
  }
  action(id: string, dto: RouterActionDto, fromQueue = false) {
    return this.actions.action(id, dto, fromQueue);
  }
  releaseClient(id: string, ip: string) {
    return this.actions.releaseClient(id, ip);
  }
  departmentSpeed(id: string, customerId: string, ips: string[], down: number, up: number) {
    return this.actions.departmentSpeed(id, customerId, ips, down, up);
  }
  switchPort(id: string, dto: SwitchPortDto) {
    return this.actions.switchPort(id, dto);
  }
  getServices(id: string) {
    return this.provisioning.getServices(id);
  }
  updateService(id: string, dto: UpdateRouterServiceDto) {
    return this.provisioning.updateService(id, dto);
  }
  provisionUser(id: string, dto: ProvisionRouterUserDto) {
    return this.provisioning.provisionUser(id, dto);
  }
  getTraffic(id: string, ipOrQueueName?: string) {
    return this.provisioning.getTraffic(id, ipOrQueueName);
  }
  getUnlinkedDevices(id: string) {
    return this.provisioning.getUnlinkedDevices(id);
  }
  linkDevice(id: string, dto: LinkDeviceDto) {
    return this.crud.linkDevice(id, dto, (routerId) => this.provisioning.getUnlinkedDevices(routerId));
  }
  setupWan(id: string, dto: SetupWanDto) {
    return this.provisioning.setupWan(id, dto);
  }
  setupLanDhcp(id: string, dto: SetupLanDhcpDto) {
    return this.provisioning.setupLanDhcp(id, dto);
  }
  generateScript(dto: GenerateRouterScriptDto) {
    return this.provisioning.generateScript(dto);
  }
}
