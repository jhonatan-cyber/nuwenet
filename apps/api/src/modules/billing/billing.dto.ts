import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class IdDto {
  @IsUUID('7') id!: string;
}
export class PayDto extends IdDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000) amount?: number;
  @IsOptional() @IsIn(['cash', 'other']) method?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9-]{16,80}$/) request_key?: string;
}
export class BillingDto {
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) due!: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class ReversePaymentDto extends IdDto {
  @IsString() @Matches(/\S/) @MaxLength(300) reason!: string;
}
