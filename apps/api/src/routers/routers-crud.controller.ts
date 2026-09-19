import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { RoutersService } from './routers.service';
import { Roles } from '../common/roles.decorator';
import { LinkDeviceDto, SaveRouterDto, RouterToggleDto } from './router.dto';

/** Conexiones registradas: alta, edición, baja, dispositivos y lecturas. */
@Roles('admin', 'superadmin')
@Controller('routers')
export class RoutersCrudController {
  constructor(private readonly service: RoutersService) {}
  @Get('adapters') adapters() { return this.service.adapters(); }
  @Get() list() { return this.service.list(); }
  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
  @Post(':id/devices') @HttpCode(200)
  linkDevice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDeviceDto) { return this.service.linkDevice(id, dto); }
  @Roles('superadmin') @Post() @HttpCode(200) create(@Body() dto: SaveRouterDto) { return this.service.save(dto); }
  @Roles('superadmin') @Post(':id/update') @HttpCode(200)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveRouterDto) { return this.service.save(dto, id); }
  @Roles('superadmin') @Post(':id/remove') @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.service.remove(id); }
  @Roles('superadmin') @Post(':id/toggle') @HttpCode(200)
  toggle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RouterToggleDto) { return this.service.toggle(id, dto); }
  @Get(':id/traffic')
  traffic(@Param('id', ParseUUIDPipe) id: string, @Query('target') target?: string) { return this.service.getTraffic(id, target); }
  @Get(':id/unlinked-devices')
  unlinkedDevices(@Param('id', ParseUUIDPipe) id: string) { return this.service.getUnlinkedDevices(id); }
}
