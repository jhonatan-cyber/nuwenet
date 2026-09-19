import { Module } from '@nestjs/common';
import { RoutersCrudController } from './routers-crud.controller';
import { RoutersOpsController } from './routers-ops.controller';
import { RoutersService } from './routers.service';
import { RoutersOperationService } from './services/routers-operation.service';
import { RoutersCrudService } from './services/routers-crud.service';
import { RoutersDiscoveryService } from './services/routers-discovery.service';
import { RoutersActionsService } from './services/routers-actions.service';
import { RoutersProvisioningService } from './services/routers-provisioning.service';
import { CredentialVault } from './credential-vault';
import { AdapterRegistry } from './adapter-registry';
import { ArrisAdapter } from './adapters/arris.adapter';
import { MikroTikAdapter } from './adapters/mikrotik.adapter';
import { OpenWrtAdapter } from './adapters/openwrt.adapter';
import { Tr369Adapter } from './adapters/tr369.adapter';

@Module({
  controllers: [RoutersCrudController, RoutersOpsController],
  providers: [
    RoutersService,
    RoutersOperationService,
    RoutersCrudService,
    RoutersDiscoveryService,
    RoutersActionsService,
    RoutersProvisioningService,
    CredentialVault,
    AdapterRegistry,
    ArrisAdapter,
    MikroTikAdapter,
    OpenWrtAdapter,
    Tr369Adapter,
  ],
  exports: [RoutersService, RoutersOperationService, RoutersCrudService, RoutersDiscoveryService, RoutersActionsService, RoutersProvisioningService],
})
export class RoutersModule {}
