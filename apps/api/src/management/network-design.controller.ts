import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { NetworkDesignService } from './network-design.service';
import { ApplyNetworkDesignDto, SaveNetworkDesignDto } from './network-design.dto';

@Roles('admin', 'superadmin')
@Controller('building-networks')
export class NetworkDesignController {
  constructor(private readonly service: NetworkDesignService) {}
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.service.get(id); }
  @Roles('superadmin') @Post(':id') @HttpCode(200)
  save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveNetworkDesignDto) { return this.service.save(id, dto); }
  @Roles('superadmin') @Get(':id/review')
  review(@Param('id', ParseUUIDPipe) id: string) { return this.service.review(id); }
  @Roles('superadmin') @Post(':id/apply') @HttpCode(200)
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyNetworkDesignDto) { return this.service.apply(id, dto); }
}
