import { Controller, Get, Query } from '@nestjs/common';
import { PortalService } from './portal.service';

// Portal del Residente — rutas públicas (sin sesión de usuario NuweNet)
@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}
  @Get('notice') notice(@Query('building_id') bid?: string) { return this.service.publicNotice(bid); }
  @Get('traffic') traffic(@Query('token') token: string) { return this.service.traffic(token); }
  @Get() data(@Query('token') token: string) { return this.service.data(token); }
}
