import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

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
