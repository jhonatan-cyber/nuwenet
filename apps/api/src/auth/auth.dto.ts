import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetupDto {
  @IsString() @Matches(/^\S+$/) @MinLength(3) @MaxLength(160) username!: string;
  @IsString() @MinLength(8) @MaxLength(256) password!: string;
}

export class LoginDto {
  @IsString() @MinLength(1) @MaxLength(160) username!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
}
export class CreateUserDto extends SetupDto {
  // superadmin: dueño único y global. admin: administrador de edificios.
  // El usuario del administrador es su correo; incluye datos personales.
  @IsEmail() @MaxLength(160) declare username: string;
  @IsIn(['superadmin', 'admin']) role!: string;
  @IsString() @Matches(/\S/) @MaxLength(40) ci!: string;
  @IsString() @Matches(/\S/) @MaxLength(80) first_name!: string;
  @IsString() @Matches(/\S/) @MaxLength(80) last_name!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) address!: string;
  @IsOptional() @IsString() @MaxLength(80) phone?: string;
}
export class UpdateUserDto {
  @IsIn(['superadmin', 'admin']) role!: string;
  @IsBoolean() disabled!: boolean;
}
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(256) current_password!: string;
  @IsString() @MinLength(8) @MaxLength(256) password!: string;
}
