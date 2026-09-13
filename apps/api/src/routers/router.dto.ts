import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsIP, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { AdapterId } from './router.types';

export class LinkDeviceDto {
  @IsString() @Matches(/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/) mac!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customer_id?: number | null;
}

export class ConnectRouterDto {
  @IsIP('4') host!: string;
  @IsString() @MinLength(1) @MaxLength(100) username!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
}
export class TestRouterDto extends ConnectRouterDto {
  @IsOptional() @IsIn(['arris-touchstone', 'mikrotik-rest', 'openwrt-ubus']) adapter?: AdapterId;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['http', 'https']) protocol?: 'http' | 'https';
  @IsOptional() @IsIP('4') diagnostic_host?: string;
}

export class SaveRouterDto {
  @IsString() @Matches(/\S/) @MaxLength(100) name!: string;
  @IsIn(['arris-touchstone', 'mikrotik-rest', 'openwrt-ubus']) adapter!: AdapterId;
  @IsIP('4') host!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number;
  @IsIn(['http', 'https']) protocol!: 'http' | 'https';
  @IsOptional() @IsIP('4') diagnostic_host?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) username?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(256) password?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) building_id?: number;
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
}

export class GenerateRouterScriptDto {
  @IsOptional() @IsString() @Matches(/^[a-zA-Z0-9._-]+$/) @MinLength(3) @MaxLength(64) username?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) sslPort?: number;
  @IsOptional() @IsBoolean() disableInsecure?: boolean;
  @IsOptional() @IsString() @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/) @MaxLength(255) restrictIp?: string;
}

