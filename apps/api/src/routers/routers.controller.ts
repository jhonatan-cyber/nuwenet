import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Roles } from '../common/roles.decorator';
import { ConnectRouterDto, GenerateRouterScriptDto, LinkDeviceDto, ProvisionRouterUserDto, RouterActionDto, RouterToggleDto, SaveRouterDto, TestRouterDto, UpdateRouterServiceDto } from './router.dto';

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
  @Roles('superadmin') @Post('test') @HttpCode(200)
  test(@Body() dto: TestRouterDto) { return this.service.testConnection(dto); }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) { return this.service.detail(id); }
  @Roles('superadmin') @Get(':id/services')
  services(@Param('id', ParseIntPipe) id: number) { return this.service.getServices(id); }
  @Roles('superadmin') @Post(':id/services') @HttpCode(200)
  updateService(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRouterServiceDto) { return this.service.updateService(id, dto); }
  @Roles('superadmin') @Post(':id/provision') @HttpCode(200)
  provision(@Param('id', ParseIntPipe) id: number, @Body() dto: ProvisionRouterUserDto) { return this.service.provisionUser(id, dto); }
  @Post(':id/devices') @HttpCode(200)
  linkDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: LinkDeviceDto) { return this.service.linkDevice(id,dto); }
  @Roles('superadmin') @Post() @HttpCode(200) create(@Body() dto: SaveRouterDto) { return this.service.save(dto); }
  @Roles('superadmin') @Post(':id/update') @HttpCode(200)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveRouterDto) { return this.service.save(dto, id); }
  @Roles('superadmin') @Post(':id/check') @HttpCode(200)
  check(@Param('id', ParseIntPipe) id: number) { return this.service.check(id); }
  @Roles('superadmin') @Post(':id/remove') @HttpCode(200)
  remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
  @Roles('superadmin') @Post(':id/toggle') @HttpCode(200)
  toggle(@Param('id', ParseIntPipe) id: number, @Body() dto: RouterToggleDto) { return this.service.toggle(id, dto); }
  @Roles('superadmin') @Post(':id/actions') @HttpCode(200)
  action(@Param('id', ParseIntPipe) id: number, @Body() dto: RouterActionDto) { return this.service.action(id, dto); }
  @Get(':id/traffic')
  traffic(@Param('id', ParseIntPipe) id: number,@Query('target') target?:string) { return this.service.getTraffic(id,target); }
  @Get(':id/unlinked-devices')
  unlinkedDevices(@Param('id', ParseIntPipe) id: number) { return this.service.getUnlinkedDevices(id); }
}
