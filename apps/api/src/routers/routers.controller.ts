import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Roles } from '../common/roles.decorator';
import { ConnectRouterDto, DiscoverNeighborsDto, GenerateRouterScriptDto, LinkDeviceDto, OnboardRouterDto, ProvisionRouterUserDto, RouterActionDto, RouterToggleDto, SaveRouterDto, SetupLanDhcpDto, SetupWanDto, SwitchPortDto, TestRouterDto, UpdateRouterServiceDto } from './router.dto';

@Roles('admin', 'superadmin')
@Controller('routers')
export class RoutersController {
  constructor(private readonly service: RoutersService) {}
  @Get('adapters') adapters() { return this.service.adapters(); }
  @Get() list() { return this.service.list(); }
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
  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
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
  @Post(':id/devices') @HttpCode(200)
  linkDevice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDeviceDto) { return this.service.linkDevice(id,dto); }
  @Roles('superadmin') @Post() @HttpCode(200) create(@Body() dto: SaveRouterDto) { return this.service.save(dto); }
  @Roles('superadmin') @Post(':id/update') @HttpCode(200)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveRouterDto) { return this.service.save(dto, id); }
  @Roles('superadmin') @Post(':id/check') @HttpCode(200)
  check(@Param('id', ParseUUIDPipe) id: string) { return this.service.check(id); }
  @Roles('superadmin') @Post(':id/remove') @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
  @Roles('superadmin') @Post(':id/toggle') @HttpCode(200)
  toggle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RouterToggleDto) { return this.service.toggle(id, dto); }
  @Roles('superadmin') @Post(':id/actions') @HttpCode(200)
  action(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RouterActionDto) { return this.service.action(id, dto); }
  @Roles('superadmin') @Post(':id/ethernet') @HttpCode(200)
  switchPort(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SwitchPortDto) { return this.service.switchPort(id, dto); }
  @Get(':id/traffic')
  traffic(@Param('id', ParseUUIDPipe) id: string,@Query('target') target?:string) { return this.service.getTraffic(id,target); }
  @Get(':id/unlinked-devices')
  unlinkedDevices(@Param('id', ParseUUIDPipe) id: string) { return this.service.getUnlinkedDevices(id); }
}
