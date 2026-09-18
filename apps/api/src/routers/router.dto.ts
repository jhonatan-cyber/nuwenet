import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsIP, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { AdapterId } from './router.types';

export class LinkDeviceDto {
  @IsString() @Matches(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) mac!: string;
  @IsOptional() @IsUUID('7') customer_id?: string | null;
}

export class ConnectRouterDto {
  @IsIP('4') host!: string;
  @IsString() @MinLength(1) @MaxLength(100) username!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class TestRouterDto extends ConnectRouterDto {
  @IsOptional() @IsIn(['arris-touchstone', 'mikrotik-rest', 'openwrt-ubus', 'tr369-usp']) adapter?: AdapterId;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['http', 'https']) protocol?: 'http' | 'https';
  @IsOptional() @IsIP('4') diagnostic_host?: string;
}

export class SaveRouterDto {
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsIn(['arris-touchstone', 'mikrotik-rest', 'openwrt-ubus', 'tr369-usp']) adapter!: AdapterId;
  @IsIP('4') host!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number;
  @IsIn(['http', 'https']) protocol!: 'http' | 'https';
  @IsOptional() @IsIP('4') diagnostic_host?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) username?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(256) password?: string;
  @IsOptional() @IsUUID('7') building_id?: string;
}
export class RouterActionDto {
  @IsIn(['suspend', 'reactivate', 'speed_limit', 'firewall', 'parental_control'])
  action!: 'suspend' | 'reactivate' | 'speed_limit' | 'firewall' | 'parental_control';
  @IsOptional() @IsIP('4') ip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) down?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) up?: number;
  @IsOptional() @IsString() @MaxLength(255) target?: string;
  @IsOptional() @IsString() @MaxLength(64) schedule?: string;
  @IsOptional() @IsBoolean() remove?: boolean;
}
export class RouterToggleDto {
  @IsBoolean() disabled!: boolean;
}
export class OnboardRouterDto {
  @IsIP('4') host!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['http', 'https']) protocol?: 'http' | 'https';
  @IsOptional() @IsString() @MaxLength(100) username?: string;
  @IsOptional() @IsString() @MaxLength(256) password?: string;
  @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) identity!: string;
  @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}\/24$/) @MaxLength(18) newAddress!: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) interface?: string;
  @IsOptional() @IsString() @MaxLength(64) dns?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MinLength(3) @MaxLength(64) serviceUsername?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) servicePassword?: string;
  @IsOptional() @IsBoolean() setup_https?: boolean;
}
export class SwitchPortDto {
  @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) name!: string;
  @IsBoolean() disabled!: boolean;
}
export class DiscoverNeighborsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(60) seconds?: number;
}

export class UpdateRouterServiceDto {
  @IsString() @Matches(/^[a-z0-9-]+$/) service!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() disabled?: boolean;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
}

export class ProvisionRouterUserDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MinLength(3) @MaxLength(64) username?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  @IsOptional() @IsBoolean() updateStoredCredentials?: boolean;
  @IsOptional() @IsBoolean() setup_https?: boolean;
}

export class RouterDhcpLeaseDto {
  @IsString() @Matches(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) mac!: string;
  @IsIP('4') address!: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(80) comment?: string;
}
export class SetupWanDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) wanInterface?: string;
  @IsOptional() @IsBoolean() wanDhcp?: boolean;
  @IsOptional() @IsBoolean() nat?: boolean;
}
export class SetupLanDhcpDto {
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}\/24$/) @MaxLength(18) lan?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) lanInterface?: string;
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/) @MaxLength(31) pool?: string;
  @IsOptional() @IsString() @MaxLength(64) dns?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(250) @ValidateNested({ each: true }) @Type(() => RouterDhcpLeaseDto) leases?: RouterDhcpLeaseDto[];
}
export class GenerateRouterScriptDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MinLength(3) @MaxLength(64) username?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) sslPort?: number;
  @IsOptional() @IsBoolean() disableInsecure?: boolean;
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/) @MaxLength(255) restrictIp?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) wanInterface?: string;
  @IsOptional() @IsBoolean() wanDhcp?: boolean;
  @IsOptional() @IsBoolean() nat?: boolean;
  // Bloque LAN/DHCP (/24): dirección LAN del MikroTik, interfaz, pool, DNS y leases estáticos.
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}\/24$/) @MaxLength(18) lan?: string;
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MaxLength(64) lanInterface?: string;
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}-(\d{1,3}\.){3}\d{1,3}$/) @MaxLength(31) pool?: string;
  @IsOptional() @IsString() @MaxLength(64) dns?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(250) @ValidateNested({ each: true }) @Type(() => RouterDhcpLeaseDto) leases?: RouterDhcpLeaseDto[];
}

