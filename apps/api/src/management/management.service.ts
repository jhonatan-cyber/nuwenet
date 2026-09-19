import { Injectable, Optional } from '@nestjs/common';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../database/database.service';
import { RoutersService } from '../routers/routers.service';
import { ScopeService } from '../modules/shared/scope.service';
import { SettingsService } from '../modules/settings/settings.service';
import { NetworkService } from '../modules/network/network.service';
import { BuildingsService } from '../modules/buildings/buildings.service';
import { PlansService } from '../modules/plans/plans.service';
import { CustomersService } from '../modules/customers/customers.service';
import { BillingService } from '../modules/billing/billing.service';
import { AccessService } from '../modules/access/access.service';
import { PortalService } from '../modules/portal/portal.service';
import { StateService } from '../modules/state/state.service';
import { localDay } from '../modules/shared/management-types';
import type { AccessDto } from '../modules/access/access.dto';
import type { AssignBuildingDto, BuildingCentralDto, CreateBuildingDto, RemoveBuildingDto, ToggleBuildingDto, UpdateBuildingDto } from '../modules/buildings/buildings.dto';
import type { BillingDto, PayDto, ReversePaymentDto } from '../modules/billing/billing.dto';
import type { ArchiveCustomerDto, CreateCustomerDto, SetCustomerIpDto, UpdateCustomerDto } from '../modules/customers/customers.dto';
import type { CreatePlanDto, UpdatePlanDto } from '../modules/plans/plans.dto';
import type { SettingsDto } from '../modules/settings/settings.dto';
import type { StateQuery } from '../modules/state/state.dto';

export { localDay };

/**
 * Fachada de gestión. Mantiene la API pública histórica
 * (`new ManagementService(db, routers)` sigue funcionando en tests)
 * pero delega cada responsabilidad a su servicio de dominio.
 * Los controladores nuevos deben inyectar el servicio de dominio
 * correspondiente en lugar de esta fachada.
 */
@Injectable()
export class ManagementService {
  private readonly scope: ScopeService;
  private readonly settingsService: SettingsService;
  private readonly networkService: NetworkService;
  private readonly buildings: BuildingsService;
  private readonly plans: PlansService;
  private readonly customers: CustomersService;
  private readonly billing: BillingService;
  private readonly access: AccessService;
  private readonly portal: PortalService;
  private readonly state: StateService;

  constructor(
    private readonly database: DatabaseService,
    private readonly routers: RoutersService,
    @Optional() scope?: ScopeService,
    @Optional() settingsService?: SettingsService,
    @Optional() networkService?: NetworkService,
    @Optional() buildings?: BuildingsService,
    @Optional() plans?: PlansService,
    @Optional() customers?: CustomersService,
    @Optional() billing?: BillingService,
    @Optional() access?: AccessService,
    @Optional() portal?: PortalService,
    @Optional() state?: StateService,
  ) {
    this.scope = scope ?? new ScopeService();
    this.settingsService = settingsService ?? new SettingsService(database, this.scope);
    this.networkService = networkService ?? new NetworkService(database, routers as RoutersService, this.scope);
    this.buildings = buildings ?? new BuildingsService(database, this.scope);
    this.plans = plans ?? new PlansService(database, this.scope, this.networkService);
    this.customers = customers ?? new CustomersService(database, this.scope, this.networkService, this.settingsService);
    this.billing = billing ?? new BillingService(database, this.scope, this.settingsService, this.networkService);
    this.access = access ?? new AccessService(database, this.scope, this.settingsService, this.networkService);
    this.portal = portal ?? new PortalService(database, this.scope, routers as RoutersService);
    this.state = state ?? new StateService(database, this.scope, this.settingsService);
  }

  // --- Settings ---
  settings(tx?: TransactionSQL): Promise<SettingsDto> {
    return this.settingsService.settings(tx);
  }
  async saveSettings(dto: SettingsDto) {
    await this.settingsService.save(dto);
    return this.snapshot();
  }

  // --- State ---
  snapshot(query: StateQuery = {}) {
    return this.state.snapshot(query);
  }
  audit() {
    return this.access.audit();
  }

  // --- Buildings ---
  listBuildings() {
    return this.buildings.list();
  }
  async createBuilding(dto: CreateBuildingDto) {
    return this.buildings.create(dto);
  }
  async assignBuilding(dto: AssignBuildingDto) {
    await this.buildings.assign(dto);
    return { ok: true };
  }
  async unassignBuilding(dto: AssignBuildingDto) {
    await this.buildings.unassign(dto);
    return { ok: true };
  }
  async updateBuilding(dto: UpdateBuildingDto) {
    await this.buildings.update(dto);
    return this.snapshot();
  }
  async toggleBuilding(dto: ToggleBuildingDto) {
    await this.buildings.toggle(dto);
    return this.snapshot();
  }
  async removeBuilding(dto: RemoveBuildingDto) {
    await this.buildings.remove(dto);
    return this.snapshot();
  }
  setBuildingCentral(dto: BuildingCentralDto) {
    return this.networkService.setBuildingCentral(dto).then(() => this.snapshot());
  }
  setBuildingCentralInTransaction(tx: TransactionSQL, dto: BuildingCentralDto) {
    return this.networkService.setBuildingCentralInTransaction(tx, dto);
  }

  // --- Plans ---
  async createPlan(dto: CreatePlanDto) {
    await this.plans.create(dto);
    return this.snapshot();
  }
  async updatePlan(dto: UpdatePlanDto) {
    await this.plans.update(dto);
    return this.snapshot();
  }

  // --- Customers ---
  async createCustomer(dto: CreateCustomerDto) {
    const portal_link = await this.customers.create(dto);
    return { ...(await this.snapshot()), portal_link: { ...portal_link } };
  }
  async updateCustomer(dto: UpdateCustomerDto) {
    await this.customers.update(dto);
    return this.snapshot();
  }
  async setCustomerIp(dto: SetCustomerIpDto) {
    await this.customers.setIp(dto);
    return this.snapshot();
  }
  async archiveCustomer(dto: ArchiveCustomerDto) {
    await this.customers.archive(dto);
    return this.snapshot();
  }
  async rotatePortalLink(id: string) {
    const portal_link = await this.customers.rotatePortalLink(id);
    return { ...(await this.snapshot()), portal_link };
  }
  async changeHolder(id: string, name: string, phone?: string) {
    const portal_link = await this.customers.changeHolder(id, name, phone);
    return { ...(await this.snapshot()), portal_link };
  }

  // --- Billing ---
  async generateBilling(dto: BillingDto) {
    await this.billing.generate(dto);
    return this.snapshot();
  }
  async pay(dto: PayDto) {
    await this.billing.pay(dto);
    return this.snapshot();
  }
  async reversePayment(dto: ReversePaymentDto) {
    await this.billing.reverse(dto);
    return this.snapshot();
  }
  receipt(id: string) {
    return this.billing.receipt(id);
  }

  // --- Access ---
  async changeAccess(dto: AccessDto) {
    await this.access.changeAccess(dto);
    return this.snapshot();
  }
  async reviewOverdue(auto = false) {
    await this.access.reviewOverdue(auto);
    return this.snapshot();
  }
  async retryCommand(id: string) {
    await this.networkService.retryCommand(id);
    return this.snapshot();
  }

  // --- Network queue / tasks ---
  acquireTask(name: string, milliseconds = 600000): Promise<string | null> {
    return this.networkService.acquireTask(name, milliseconds);
  }
  releaseTask(name: string, token: string): Promise<void> {
    return this.networkService.releaseTask(name, token);
  }
  syncLinkedDevices(): Promise<void> {
    return this.networkService.syncLinkedDevices();
  }
  processQueue(): Promise<void> {
    return this.networkService.processQueue();
  }

  // --- Portal ---
  publicNotice(buildingId?: string) {
    return this.portal.publicNotice(buildingId);
  }
  portalTraffic(token: string) {
    return this.portal.traffic(token);
  }
  portalData(token: string) {
    return this.portal.data(token);
  }
}
