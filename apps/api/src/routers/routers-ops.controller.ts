import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Roles } from '../common/roles.decorator';
import { ConnectRouterDto, DiscoverNeighborsDto, GenerateRouterScriptDto, OnboardRouterDto, ProvisionRouterUserDto, RouterActionDto, SetupLanDhcpDto, SetupWanDto, SwitchPortDto, TestRouterDto, UpdateRouterServiceDto } from './router.dto';

/** Operaciones sobre equipos: descubrimiento, aprovisionamiento y acciones. */
@Roles('admin', 'superadmin')
@Controller('routers')
export class RoutersOpsController {
  constructor(private readonly service: RoutersService) {}
  @Roles('superadmin') @Post('script') @HttpCode(200)
  script(@Body() dto: GenerateRouterScriptDto) { return this.service.generateScript(dto); }
  @Roles('superadmin') @Post('connect') @HttpCode(200)
  connect(@Body() dto: ConnectRouterDto) { return this.service.connect(dto); }
  @Roles('superadmin') @Post('discover') @HttpCode(200)
  discover(@Body() dto: DiscoverNeighborsDto) { return this.service.discoverNeighbors(dto.seconds ?? 5); }
  @Roles('superadmin') @Post('onboard') @HttpCode(200)
  onboard(@Body() dto: OnboardRouterDto) { return this.service.onboard(dto); }
  @Roles('superadmin') @Post('test') @HttpCode(200)
  test(@Body() dto: TestRouterDto) { return this.service.testConnection(dto); }
  @Roles('superadmin') @Get(':id/services')
  services(@Param('id', ParseUUIDPipe) id: string) { return this.service.getServices(id); }
  @Roles('superadmin') @Post(':id/services') @HttpCode(200)
  updateService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRouterServiceDto) { return this.service.updateService(id, dto); }
  @Roles('superadmin') @Post(':id/provision') @HttpCode(200)
  provision(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProvisionRouterUserDto) { return this.service.provisionUser(id, dto); }
  @Roles('superadmin') @Post(':id/wan') @HttpCode(200)
  setupWan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetupWanDto) { return this.service.setupWan(id, dto); }
  @Roles('superadmin') @Post(':id/lan-dhcp') @HttpCode(200)
  setupLanDhcp(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetupLanDhcpDto) { return this.service.setupLanDhcp(id, dto); }
  @Roles('superadmin') @Post(':id/check') @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) { return this.service.check(id); }
  @Roles('superadmin') @Post(':id/actions') @HttpCode(200)
  action(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RouterActionDto) { return this.service.action(id, dto); }
  @Roles('superadmin') @Post(':id/ethernet') @HttpCode(200)
  switchPort(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SwitchPortDto) { return this.service.switchPort(id, dto); }
}
