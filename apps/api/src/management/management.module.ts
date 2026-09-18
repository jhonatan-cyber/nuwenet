import { NetworkDesignController } from './network-design.controller';
import { NetworkDesignService } from './network-design.service';
import { Module } from '@nestjs/common';
import { ManagementService } from './management.service';
import { OverdueScheduler } from './scheduler.service';
import { RoutersModule } from '../routers/routers.module';
import { StateController, PlansController, CustomersController, BillingController, AccessController, BuildingsController, PortalController } from './management.controllers';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { RetiredRowsService } from './retired-rows.service';
import { RetiredRowsController } from './retired-rows.controller';
import {UsageService} from './usage.service';
import {UsageController,PortalUsageController} from './usage.controllers';

@Module({
  imports: [RoutersModule],
  controllers: [NetworkDesignController, StateController, PlansController, CustomersController, BillingController, AccessController, BuildingsController, BackupController, RetiredRowsController, PortalController, UsageController, PortalUsageController],
  providers: [NetworkDesignService, ManagementService, OverdueScheduler, BackupService, RetiredRowsService, UsageService],
  exports: [ManagementService],
})
export class ManagementModule {}
