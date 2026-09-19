import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AccessService } from './access.service';
import { SettingsService } from '../settings/settings.service';
import { NetworkService } from '../network/network.service';
import { StateService } from '../state/state.service';
import { Roles } from '../../common/roles.decorator';
import { AccessDto } from './access.dto';
import { IdDto } from '../billing/billing.dto';
import { SettingsDto } from '../settings/settings.dto';

@Roles('admin', 'superadmin')
@Controller()
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly settings: SettingsService,
    private readonly network: NetworkService,
    private readonly state: StateService,
  ) {}

  @Post('access') @HttpCode(200)
  async change(@Body() dto: AccessDto) {
    await this.access.changeAccess(dto);
    return this.state.snapshot();
  }

  @Post('overdue') @HttpCode(200)
  async review() {
    await this.access.reviewOverdue();
    return this.state.snapshot();
  }

  @Roles('superadmin') @Post('network/retry') @HttpCode(200)
  async retry(@Body() dto: IdDto) {
    await this.network.retryCommand(dto.id);
    return this.state.snapshot();
  }

  @Roles('superadmin') @Post('settings') @HttpCode(200)
  async saveSettings(@Body() dto: SettingsDto) {
    await this.settings.save(dto);
    return this.state.snapshot();
  }

  @Roles('superadmin') @Get('audit')
  audit() {
    return this.access.audit();
  }
}
