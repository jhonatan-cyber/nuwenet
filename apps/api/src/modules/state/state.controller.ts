import { Controller, Get, Query } from '@nestjs/common';
import { StateService } from './state.service';
import { Roles } from '../../common/roles.decorator';
import { StateQuery } from './state.dto';

@Roles('admin', 'superadmin')
@Controller('state')
export class StateController {
  constructor(private readonly service: StateService) {}
  @Get() getState(@Query() query: StateQuery) { return this.service.snapshot(query); }
}
