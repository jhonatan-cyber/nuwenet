import { Module } from '@nestjs/common';
import { ManagementModule } from './management/management.module';
import { DatabaseModule } from './database/database.module';
import { RoutersModule } from './routers/routers.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './common/health.controller';

@Module({ imports: [DatabaseModule, AuthModule, ManagementModule, RoutersModule], controllers: [HealthController] })
export class AppModule {}
