import { Module } from '@nestjs/common';
import { ManagementService } from './management.service';
import { RoutersModule } from '../routers/routers.module';
// Dominio: un controlador por recurso, un servicio por agregado.
import { StateController } from '../modules/state/state.controller';
import { StateService } from '../modules/state/state.service';
import { PlansController } from '../modules/plans/plans.controller';
import { PlansService } from '../modules/plans/plans.service';
import { CustomersController } from '../modules/customers/customers.controller';
import { CustomersService } from '../modules/customers/customers.service';
import { BillingController } from '../modules/billing/billing.controller';
import { BillingService } from '../modules/billing/billing.service';
import { AccessController } from '../modules/access/access.controller';
import { AccessService } from '../modules/access/access.service';
import { BuildingsController } from '../modules/buildings/buildings.controller';
import { BuildingsService } from '../modules/buildings/buildings.service';
import { PortalController } from '../modules/portal/portal.controller';
import { PortalService } from '../modules/portal/portal.service';
import { SettingsService } from '../modules/settings/settings.service';
import { NetworkService } from '../modules/network/network.service';
import { ScopeService } from '../modules/shared/scope.service';
// Infraestructura de dominios transversales.
import { NetworkDesignController } from '../modules/network-design/network-design.controller';
import { NetworkDesignService } from '../modules/network-design/network-design.service';
import { OverdueScheduler } from '../modules/jobs/scheduler.service';
import { BackupService } from '../modules/backups/backup.service';
import { BackupController } from '../modules/backups/backup.controller';
import { RetiredRowsService } from '../modules/retired-rows/retired-rows.service';
import { RetiredRowsController } from '../modules/retired-rows/retired-rows.controller';
import { UsageService } from '../modules/usage/usage.service';
import { UsageController, PortalUsageController } from '../modules/usage/usage.controllers';

@Module({
  imports: [RoutersModule],
  controllers: [NetworkDesignController, StateController, PlansController, CustomersController, BillingController, AccessController, BuildingsController, BackupController, RetiredRowsController, PortalController, UsageController, PortalUsageController],
  providers: [
    ScopeService,
    SettingsService,
    NetworkService,
    BuildingsService,
    PlansService,
    CustomersService,
    BillingService,
    AccessService,
    PortalService,
    StateService,
    NetworkDesignService,
    ManagementService,
    OverdueScheduler,
    BackupService,
    RetiredRowsService,
    UsageService,
  ],
  exports: [ManagementService, StateService, PlansService, CustomersService, BillingService, AccessService, BuildingsService, PortalService, SettingsService, NetworkService],
})
export class ManagementModule {}
