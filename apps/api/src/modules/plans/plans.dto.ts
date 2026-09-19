import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) down!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) up!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000000) price!: number;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class UpdatePlanDto extends CreatePlanDto {
  @IsUUID('7') id!: string;
}
export class PlanIdDto {
  @IsUUID('7') id!: string;
}
export class TogglePlanDto extends PlanIdDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(1) disabled!: number;
}
