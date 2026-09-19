import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class StateQuery {
  @IsOptional() @IsIn(['overview', 'customers', 'plans', 'billing', 'payments', 'network', 'routers', 'activity', 'settings', 'users', 'buildings', 'backups', 'audit']) section?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) customer_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) invoice_page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) payment_page?: number;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(['0', '1']) archived?: string;
  @IsOptional() @IsUUID('7') customer_id?: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
