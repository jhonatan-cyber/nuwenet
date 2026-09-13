import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ManagementService } from './management.service';
import { Roles } from '../common/roles.decorator';
import { BankSettingsDto, AccessDto, ArchiveCustomerDto, AssignBuildingDto, BillingDto, BuildingCentralDto, ChangeHolderDto, CreateBuildingDto, CreateCustomerDto, CreatePlanDto, IdDto, PayDto, PortalPaymentReportDto, RemoveBuildingDto, ReviewPaymentReportDto, ReversePaymentDto, RotatePortalLinkDto, SendWhatsappDto, SetCustomerIpDto, SettingsDto, StateQuery, ToggleBuildingDto, UpdateBuildingDto, UpdateCustomerDto, UpdatePlanDto } from './dto';

@Roles('admin', 'superadmin')
@Controller('state')
export class StateController {
  constructor(private readonly service: ManagementService) {}
  @Get() getState(@Query() query: StateQuery) { return this.service.snapshot(query); }
}

@Roles('admin', 'superadmin')
@Controller('plans')
export class PlansController {
  constructor(private readonly service: ManagementService) {}
  @Post() @HttpCode(200)
  create(@Body() dto: CreatePlanDto) { return this.service.createPlan(dto); }
  @Post('update') @HttpCode(200) update(@Body() dto: UpdatePlanDto) { return this.service.updatePlan(dto); }
}

@Roles('admin', 'superadmin')
@Controller('customers')
export class CustomersController {
  constructor(private readonly service: ManagementService) {}
  @Post() @HttpCode(200)
  create(@Body() dto: CreateCustomerDto) { return this.service.createCustomer(dto); }
  @Post('ip') @HttpCode(200)
  setIp(@Body() dto: SetCustomerIpDto) { return this.service.setCustomerIp(dto); }
  @Post('update') @HttpCode(200) update(@Body() dto: UpdateCustomerDto) { return this.service.updateCustomer(dto); }
  @Post('archive') @HttpCode(200) archive(@Body() dto: ArchiveCustomerDto) { return this.service.archiveCustomer(dto); }
  @Post('portal-link') @HttpCode(200) rotateLink(@Body() dto: RotatePortalLinkDto) { return this.service.rotatePortalLink(dto.id); }
  @Post('change-holder') @HttpCode(200) changeHolder(@Body() dto: ChangeHolderDto) { return this.service.changeHolder(dto.id, dto.name, dto.phone); }
}

@Roles('admin', 'superadmin')
@Controller()
export class BillingController {
  constructor(private readonly service: ManagementService) {}
  @Get('invoices/:id/bank') invoiceBank(@Param('id',ParseIntPipe) id:number) {return this.service.invoiceBank(id);}
  @Post('billing') @HttpCode(200)
  generate(@Body() dto: BillingDto) { return this.service.generateBilling(dto); }
  @Post('pay') @HttpCode(200)
  pay(@Body() dto: PayDto) { return this.service.pay(dto); }
  @Get('payments/:id/receipt') receipt(@Param('id', ParseIntPipe) id: number) { return this.service.receipt(id); }
  @Post('payments/reverse') @HttpCode(200) reverse(@Body() dto: ReversePaymentDto) { return this.service.reversePayment(dto); }
  // WhatsApp directo — envía aviso/recibo a residente con un clic
  @Post('invoices/:id/send-whatsapp') @HttpCode(200) invoiceWhatsappById(@Param('id',ParseIntPipe) id:number) { return this.service.sendInvoiceWhatsapp({id}); }
  @Post('payments/:id/send-whatsapp') @HttpCode(200) paymentWhatsappById(@Param('id',ParseIntPipe) id:number) { return this.service.sendPaymentWhatsapp({id}); }
  @Post('invoices/send-whatsapp') @HttpCode(200)
  invoiceWhatsapp(@Body() dto: SendWhatsappDto) { return this.service.sendInvoiceWhatsapp(dto); }
  @Post('payments/send-whatsapp') @HttpCode(200)
  paymentWhatsapp(@Body() dto: SendWhatsappDto) { return this.service.sendPaymentWhatsapp(dto); }
  // Reportes de transferencia enviados por los residentes desde el portal
  @Get('payment-reports') paymentReports(@Query('building_id') bid?: string) { return this.service.listPaymentReports(bid ? Number(bid) : undefined); }
  @Post('payment-reports/review') @HttpCode(200)
  reviewReport(@Body() dto: ReviewPaymentReportDto) { return this.service.reviewPaymentReport(dto); }
}

@Roles('admin', 'superadmin')
@Controller()
export class AccessController {
  constructor(private readonly service: ManagementService) {}
  @Post('access') @HttpCode(200)
  change(@Body() dto: AccessDto) { return this.service.changeAccess(dto); }
  @Post('overdue') @HttpCode(200)
  review() { return this.service.reviewOverdue(); }
  @Roles('superadmin') @Post('network/retry') @HttpCode(200) retry(@Body() dto: IdDto) { return this.service.retryCommand(dto.id); }
  @Roles('superadmin') @Post('settings') @HttpCode(200) settings(@Body() dto: SettingsDto) { return this.service.saveSettings(dto); }
  @Roles('superadmin') @Get('audit') audit() { return this.service.audit(); }
}

@Roles('admin', 'superadmin')
@Controller('buildings')
export class BuildingsController {
  constructor(private readonly service: ManagementService) {}
  @Get(':id/bank') bank(@Param('id',ParseIntPipe) id:number) { return this.service.bankSettings(id); }
  @Post(':id/bank') @HttpCode(200) saveBank(@Param('id',ParseIntPipe) id:number,@Body() dto:BankSettingsDto) { return this.service.saveBankSettings(id,{...dto}); }
  @Get() list() { return this.service.listBuildings(); }
  @Roles('superadmin') @Post() @HttpCode(200) create(@Body() dto: CreateBuildingDto) { return this.service.createBuilding(dto); }
  @Roles('superadmin') @Post('assign') @HttpCode(200) assign(@Body() dto: AssignBuildingDto) { return this.service.assignBuilding(dto); }
  @Roles('superadmin') @Post('unassign') @HttpCode(200) unassign(@Body() dto: AssignBuildingDto) { return this.service.unassignBuilding(dto); }
  @Roles('superadmin') @Post('central') @HttpCode(200) central(@Body() dto: BuildingCentralDto) { return this.service.setBuildingCentral(dto); }
  @Roles('superadmin') @Post('update') @HttpCode(200) update(@Body() dto: UpdateBuildingDto) { return this.service.updateBuilding(dto); }
  @Roles('superadmin') @Post('toggle') @HttpCode(200) toggle(@Body() dto: ToggleBuildingDto) { return this.service.toggleBuilding(dto); }
  @Roles('superadmin') @Post('remove') @HttpCode(200) remove(@Body() dto: RemoveBuildingDto) { return this.service.removeBuilding(dto); }
}

// Portal del Residente — rutas públicas (sin sesión de usuario NuweNet)
@Controller('portal')
export class PortalController {
  constructor(private readonly service: ManagementService) {}
  @Get('notice') notice(@Query('building_id') bid?:string) {return this.service.publicNotice(bid&&/^\d+$/.test(bid)?Number(bid):undefined);}
  @Get('traffic') traffic(@Query('token') token:string) {return this.service.portalTraffic(token);}
  @Get() data(@Query('token') token: string) { return this.service.portalData(token); }
  @Post('report') @HttpCode(200) report(@Body() dto: PortalPaymentReportDto) {
    return this.service.portalReportPayment({ token: dto.token, amount: dto.amount, reference: dto.reference, notes: dto.notes });
  }
}
