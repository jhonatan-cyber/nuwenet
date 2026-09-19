import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { StateService } from '../state/state.service';
import { Roles } from '../../common/roles.decorator';
import { ArchiveCustomerDto, ChangeHolderDto, CreateCustomerDto, DeleteCustomerDto, RotatePortalLinkDto, SetCustomerIpDto, UpdateCustomerDto } from './customers.dto';

@Roles('admin', 'superadmin')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly state: StateService,
  ) {}

  @Post() @HttpCode(200)
  async create(@Body() dto: CreateCustomerDto) {
    const portal_link = await this.customers.create(dto);
    return { ...(await this.state.snapshot()), portal_link: { ...portal_link } };
  }

  @Post('ip') @HttpCode(200)
  async setIp(@Body() dto: SetCustomerIpDto) {
    await this.customers.setIp(dto);
    return this.state.snapshot();
  }

  @Post('update') @HttpCode(200)
  async update(@Body() dto: UpdateCustomerDto) {
    await this.customers.update(dto);
    return this.state.snapshot();
  }

  @Post('archive') @HttpCode(200)
  async archive(@Body() dto: ArchiveCustomerDto) {
    await this.customers.archive(dto);
    return this.state.snapshot();
  }

  @Post('delete') @HttpCode(200)
  async remove(@Body() dto: DeleteCustomerDto) {
    await this.customers.remove(dto);
    return this.state.snapshot();
  }

  @Post('portal-link') @HttpCode(200)
  async rotateLink(@Body() dto: RotatePortalLinkDto) {
    const portal_link = await this.customers.rotatePortalLink(dto.id);
    return { ...(await this.state.snapshot()), portal_link };
  }

  @Post('change-holder') @HttpCode(200)
  async changeHolder(@Body() dto: ChangeHolderDto) {
    const portal_link = await this.customers.changeHolder(dto.id, dto.name, dto.phone);
    return { ...(await this.state.snapshot()), portal_link };
  }
}
