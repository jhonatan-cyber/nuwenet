import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { PlansService } from './plans.service';
import { StateService } from '../state/state.service';
import { Roles } from '../../common/roles.decorator';
import { CreatePlanDto, PlanIdDto, TogglePlanDto, UpdatePlanDto } from './plans.dto';

@Roles('admin', 'superadmin')
@Controller('plans')
export class PlansController {
  constructor(
    private readonly plans: PlansService,
    private readonly state: StateService,
  ) {}

  @Post() @HttpCode(200)
  async create(@Body() dto: CreatePlanDto) {
    await this.plans.create(dto);
    return this.state.snapshot();
  }

  @Post('update') @HttpCode(200)
  async update(@Body() dto: UpdatePlanDto) {
    await this.plans.update(dto);
    return this.state.snapshot();
  }

  @Post('toggle') @HttpCode(200)
  async toggle(@Body() dto: TogglePlanDto) {
    await this.plans.toggle(dto);
    return this.state.snapshot();
  }

  @Post('delete') @HttpCode(200)
  async remove(@Body() dto: PlanIdDto) {
    await this.plans.remove(dto);
    return this.state.snapshot();
  }
}
