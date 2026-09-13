import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { BackupService } from './backup.service';
@Roles('superadmin')
@Controller('backups')
export class BackupController {
  constructor(private readonly backups:BackupService) {}
  @Get() list() { return this.backups.list(); }
  @Get('policy') policy() { return this.backups.policy(); }
  @Post() @HttpCode(200) create() { return this.backups.create(); }
  @Post(':name/verify') @HttpCode(200) verify(@Param('name') name:string) { return this.backups.verify(name); }
}
