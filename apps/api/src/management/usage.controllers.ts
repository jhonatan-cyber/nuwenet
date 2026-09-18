import {Controller,Get,Param,ParseUUIDPipe,Query} from '@nestjs/common';
import {Roles} from '../common/roles.decorator';
import {UsageService} from './usage.service';

@Roles('admin','superadmin')
@Controller('customers')
export class UsageController {
  constructor(private readonly usage:UsageService){}
  @Get(':id/usage') history(@Param('id',ParseUUIDPipe) id:string,@Query('month') month?:string){return this.usage.history(id,month);}
}

@Controller('portal')
export class PortalUsageController {
  constructor(private readonly usage:UsageService){}
  @Get('usage') history(@Query('token') token?:string,@Query('month') month?:string){return this.usage.history(null,month,token||'');}
}
