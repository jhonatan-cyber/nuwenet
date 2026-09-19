import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { NetworkService } from '../network/network.service';
import { StateService } from '../state/state.service';
import { Roles } from '../../common/roles.decorator';
import { AssignBuildingDto, BuildingCentralDto, CreateBuildingDto, RemoveBuildingDto, ToggleBuildingDto, UpdateBuildingDto } from './buildings.dto';

@Roles('admin', 'superadmin')
@Controller('buildings')
export class BuildingsController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly network: NetworkService,
    private readonly state: StateService,
  ) {}

  @Get()
  list() { return this.buildings.list(); }

  @Roles('superadmin') @Post() @HttpCode(200)
  create(@Body() dto: CreateBuildingDto) { return this.buildings.create(dto); }

  @Roles('superadmin') @Post('assign') @HttpCode(200)
  async assign(@Body() dto: AssignBuildingDto) {
    await this.buildings.assign(dto);
    return { ok: true };
  }

  @Roles('superadmin') @Post('unassign') @HttpCode(200)
  async unassign(@Body() dto: AssignBuildingDto) {
    await this.buildings.unassign(dto);
    return { ok: true };
  }

  @Roles('superadmin') @Post('central') @HttpCode(200)
  async central(@Body() dto: BuildingCentralDto) {
    await this.network.setBuildingCentral(dto);
    return this.state.snapshot();
  }

  @Roles('superadmin') @Post('update') @HttpCode(200)
  async update(@Body() dto: UpdateBuildingDto) {
    await this.buildings.update(dto);
    return this.state.snapshot();
  }

  @Roles('superadmin') @Post('toggle') @HttpCode(200)
  async toggle(@Body() dto: ToggleBuildingDto) {
    await this.buildings.toggle(dto);
    return this.state.snapshot();
  }

  @Roles('superadmin') @Post('remove') @HttpCode(200)
  async remove(@Body() dto: RemoveBuildingDto) {
    await this.buildings.remove(dto);
    return this.state.snapshot();
  }
}
