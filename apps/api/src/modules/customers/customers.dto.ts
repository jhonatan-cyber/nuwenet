import { Transform } from 'class-transformer';
import { IsBoolean, IsIP, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString() @Matches(/\S/) @MaxLength(160) apartment!: string;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
  @IsOptional() @Transform(({ value }) => value === '' || value === null || value === undefined ? undefined : String(value)) @IsUUID('7') plan_id?: string;
  @IsOptional() @IsIP('4') ip?: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class UpdateCustomerDto extends CreateCustomerDto {
  @IsUUID('7') id!: string;
}
export class SetCustomerIpDto {
  @IsUUID('7') id!: string;
  @IsOptional() @IsIP('4') ip?: string;
}
export class ArchiveCustomerDto {
  @IsUUID('7') id!: string;
  @IsBoolean() archived!: boolean;
}
export class RotatePortalLinkDto {
  @IsUUID('7') id!: string;
}
// Eliminación física del departamento: borra la fila y todo su historial
// (cuotas, pagos, órdenes, dispositivos, objetivos de red y consumo).
export class DeleteCustomerDto {
  @IsUUID('7') id!: string;
}
// B3: cambio explícito de titular. Invalida el acceso anterior; la entrega del
// nuevo enlace es una operación distinta (ver enlace del portal).
export class ChangeHolderDto {
  @IsUUID('7') id!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
}
