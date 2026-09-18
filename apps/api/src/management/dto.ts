import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsIP, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) down!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) up!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) price!: number;
  @IsOptional() @IsUUID('7') building_id?: string;
}

export class CreateCustomerDto {
  @IsString() @Matches(/\S/) @MaxLength(160) apartment!: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @Transform(({ value }) => value === '' || value === null || value === undefined ? undefined : String(value)) @IsUUID('7') plan_id?: string;
  @IsOptional() @IsIP('4') ip?: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}

export class IdDto {
  @IsUUID('7') id!: string;
}

export class PayDto extends IdDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) amount?: number;
  @IsOptional() @IsIn(['cash','other']) method?: string;
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
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class UpdatePlanDto extends CreatePlanDto { @IsUUID('7') id!: string; }
export class UpdateCustomerDto extends CreateCustomerDto { @IsUUID('7') id!: string; }
export class ArchiveCustomerDto extends IdDto { @IsBoolean() archived!: boolean; }
export class ReversePaymentDto extends IdDto { @IsString() @Matches(/\S/) @MaxLength(300) reason!: string; }
export class StateQuery {
  @IsOptional() @IsIn(['overview','customers','plans','billing','payments','network','routers','activity','settings','users','buildings','backups','audit']) section?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) customer_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) invoice_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) payment_page?: number;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(['0','1']) archived?: string;
  @IsOptional() @IsUUID('7') customer_id?: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class CreateBuildingDto {
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) address!: string;
  @IsOptional() @IsUUID('7') admin_id?: string;
}
export class AssignBuildingDto {
  @IsUUID('7') user_id!: string;
  @IsUUID('7') building_id!: string;
}
export class BuildingCentralDto {
  @IsUUID('7') building_id!: string;
  @IsOptional() @IsUUID('7') central_router_id!: string | null;
}
export class UpdateBuildingDto {
  @IsUUID('7') building_id!: string;
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) address!: string;
}
export class ToggleBuildingDto {
  @IsUUID('7') building_id!: string;
  @IsBoolean() disabled!: boolean;
}
export class RemoveBuildingDto {
  @IsUUID('7') building_id!: string;
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
  @Type(() => Number) @IsInt() @Min(0) @Max(720) backup_hours!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1825) portal_link_days!: number;
}


// B2: regeneración del enlace del portal (rotación atómica).
export class RotatePortalLinkDto extends IdDto {}

// B3: cambio explícito de titular. Invalida el acceso anterior; la entrega del
// nuevo enlace es una operación distinta (ver enlace del portal).
export class ChangeHolderDto extends IdDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
}
