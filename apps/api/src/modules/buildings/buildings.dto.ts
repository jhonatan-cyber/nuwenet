import { IsBoolean, IsString, IsUUID, Matches, MaxLength, IsOptional } from 'class-validator';

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
  @IsUUID('7') central_router_id!: string;
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
