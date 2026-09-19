import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BillingService } from './billing.service';
import { StateService } from '../state/state.service';
import { Roles } from '../../common/roles.decorator';
import { BillingDto, PayDto, ReversePaymentDto } from './billing.dto';

@Roles('admin', 'superadmin')
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly state: StateService,
  ) {}

  @Post('billing') @HttpCode(200)
  async generate(@Body() dto: BillingDto) {
    await this.billing.generate(dto);
    return this.state.snapshot();
  }

  @Post('pay') @HttpCode(200)
  async pay(@Body() dto: PayDto) {
    await this.billing.pay(dto);
    return this.state.snapshot();
  }

  @Get('payments/:id/receipt')
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.billing.receipt(id);
  }

  @Post('payments/reverse') @HttpCode(200)
  async reverse(@Body() dto: ReversePaymentDto) {
    await this.billing.reverse(dto);
    return this.state.snapshot();
  }
}
