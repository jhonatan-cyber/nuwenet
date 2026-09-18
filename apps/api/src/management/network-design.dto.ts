import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsIP, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class NetworkNodeDto {
  @IsString() @Matches(/^[a-zA-Z0-9_-]{1,60}$/) id!: string;
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsIn(['provider', 'central', 'switch', 'access']) role!: 'provider' | 'central' | 'switch' | 'access';
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsIP('4') host?: string;
  @IsOptional() @IsUUID('7') router_id?: string;
  @IsOptional() @IsUUID('7') customer_id?: string;
}
export class NetworkLinkDto {
  @IsString() @MaxLength(60) from!: string;
  @IsString() @MaxLength(60) to!: string;
  @IsString() @Matches(/\S/) @MaxLength(60) from_port!: string;
  @IsString() @Matches(/\S/) @MaxLength(60) to_port!: string;
}
export class NetworkServiceDto {
  @IsUUID('7') customer_id!: string;
  @IsOptional() @IsInt() @Min(1) @Max(4094) vlan?: number;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(32) ssid?: string;
  // Clave solicitada junto al SSID. El asistente no la envía al servidor (vive
  // solo en memoria de la pantalla); se acepta para compatibilidad y bloquea la
  // aplicación hasta que un adaptador implemente Wi-Fi verificado.
  @IsOptional() @IsString() @Min(8) @MaxLength(128) wifi_password?: string;
}
export class NetworkDesignDto {
  @IsArray() @ArrayMaxSize(250) @ValidateNested({ each: true }) @Type(() => NetworkNodeDto) nodes!: NetworkNodeDto[];
  @IsArray() @ArrayMaxSize(250) @ValidateNested({ each: true }) @Type(() => NetworkLinkDto) links!: NetworkLinkDto[];
  @IsArray() @ArrayMaxSize(250) @ValidateNested({ each: true }) @Type(() => NetworkServiceDto) services!: NetworkServiceDto[];
}
export class SaveNetworkDesignDto extends NetworkDesignDto {
  @IsInt() @Min(0) revision!: number;
}
export class ApplyNetworkDesignDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
}
