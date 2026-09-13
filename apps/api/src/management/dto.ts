import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsIP, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) down!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) up!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) price!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
}

export class CreateCustomerDto {
  @IsString() @Matches(/\S/) @MaxLength(160) apartment!: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @Transform(({ value }) => value === '' || value === null || value === undefined ? undefined : Number(value)) @IsInt() @Min(1) plan_id?: number;
  @IsOptional() @IsIP('4') ip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
}

export class IdDto {
  @Type(() => Number) @IsInt() @Min(1) id!: number;
}

export class PayDto extends IdDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) amount?: number;
  @IsOptional() @IsIn(['cash','transfer','qr','other']) method?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9-]{16,80}$/) request_key?: string;
}

export class SetCustomerIpDto extends IdDto {
  @IsOptional() @IsIP('4') ip?: string;
}

export class AccessDto extends IdDto {
  @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}

export class BillingDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) due!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
}
export class UpdatePlanDto extends CreatePlanDto { @Type(() => Number) @IsInt() @Min(1) id!: number; }
export class UpdateCustomerDto extends CreateCustomerDto { @Type(() => Number) @IsInt() @Min(1) id!: number; }
export class ArchiveCustomerDto extends IdDto { @IsBoolean() archived!: boolean; }
export class ReversePaymentDto extends IdDto { @IsString() @Matches(/\S/) @MaxLength(300) reason!: string; }
export class StateQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) customer_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) invoice_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) payment_page?: number;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(['0','1']) archived?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customer_id?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
}
export class CreateBuildingDto {
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) address!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) admin_id?: number;
}
export class AssignBuildingDto {
  @Type(() => Number) @IsInt() @Min(1) user_id!: number;
  @Type(() => Number) @IsInt() @Min(1) building_id!: number;
}
export class BuildingCentralDto {
  @Type(() => Number) @IsInt() @Min(1) building_id!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) central_router_id!: number | null;
}
export class UpdateBuildingDto {
  @Type(() => Number) @IsInt() @Min(1) building_id!: number;
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) address!: string;
}
export class ToggleBuildingDto {
  @Type(() => Number) @IsInt() @Min(1) building_id!: number;
  @IsBoolean() disabled!: boolean;
}
export class RemoveBuildingDto {
  @Type(() => Number) @IsInt() @Min(1) building_id!: number;
}
export class SettingsDto {
  @IsString() @Matches(/\S/) @MaxLength(100) building_name!: string;
  @IsString() @MaxLength(10) currency!: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(60) grace_days!: number;
  @IsBoolean() auto_billing!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(28) billing_day!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(28) due_day!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1440) overdue_minutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1440) monitor_minutes!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(30) reminder_days!: number;
  @IsBoolean() reminders_enabled!: boolean;
  @Type(() => Number) @IsInt() @Min(0) @Max(720) backup_hours!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1825) portal_link_days!: number;
}

// WhatsApp directo desde facturas y pagos
export class SendWhatsappDto extends IdDto {
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) message?: string;
}

// Portal del residente: reporte de pago por transferencia
export class PortalPaymentReportDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{43}$/) token!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) amount!: number;
  @IsString() @Matches(/\S/) @MaxLength(160) reference!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

// Aprobación / rechazo de reportes de pago (solo admin)
export class ReviewPaymentReportDto extends IdDto {
  @IsIn(['approved', 'rejected']) status!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

// B2: regeneración del enlace del portal (rotación atómica).
export class RotatePortalLinkDto extends IdDto {}

// B3: cambio explícito de titular. Invalida el acceso anterior; la entrega del
// nuevo enlace es una operación distinta (ver enlace del portal).
export class ChangeHolderDto extends IdDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
}

export class BankSettingsDto {
  @IsString() @MaxLength(100) bank!: string;
  @IsString() @MaxLength(160) holder!: string;
  @IsString() @MaxLength(160) account!: string;
  @IsString() @MaxLength(1000) @Matches(/^(|\/[^\/][^\s]*|https:\/\/[^\s]+)$/) qr_image!: string;
  @IsString() @MaxLength(2000) qr_text!: string;
  @IsString() @MaxLength(500) suspension_message!: string;
  @IsString() @MaxLength(160) contact!: string;
}
