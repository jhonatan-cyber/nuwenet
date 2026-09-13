import { Module } from '@nestjs/common';
import { ManagementService } from './management.service';
import { NotifierService } from './notifier.service';
import { OverdueScheduler } from './scheduler.service';
import { RoutersModule } from '../routers/routers.module';
import { StateController, PlansController, CustomersController, BillingController, AccessController, BuildingsController, PortalController } from './management.controllers';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import {NotificationsController,WhatsAppWebhookController} from './notifications.controller';
import {UsageService} from './usage.service';
import {UsageController,PortalUsageController} from './usage.controllers';

@Module({
  imports: [RoutersModule],
  controllers: [StateController, PlansController, CustomersController, BillingController, AccessController, BuildingsController, BackupController, NotificationsController, WhatsAppWebhookController, PortalController, UsageController, PortalUsageController],
  providers: [ManagementService, NotifierService, OverdueScheduler, BackupService, UsageService],
  exports: [ManagementService],
})
export class ManagementModule {}
