import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { RoutersService } from './routers.service';
import { CredentialVault } from './credential-vault';
import { AdapterRegistry } from './adapter-registry';
import { ArrisAdapter } from './adapters/arris.adapter';
import { MikroTikAdapter } from './adapters/mikrotik.adapter';
import { OpenWrtAdapter } from './adapters/openwrt.adapter';

@Module({
  controllers: [RoutersController],
  providers: [RoutersService, CredentialVault, AdapterRegistry, ArrisAdapter, MikroTikAdapter, OpenWrtAdapter],
  exports: [RoutersService],
})
export class RoutersModule {}
