import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, CreateUserDto, LoginDto, SetupDto, UpdateUserDto } from './auth.dto';
import { Roles } from '../common/roles.decorator';
import { requestContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { logSecurity } from '../common/security';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly database: DatabaseService) {}

  @Get('status')
  async status(@Req() req: Request) {
    const cookies = this.auth.parseCookies(req.headers.cookie);
    const user = await this.auth.validate(cookies['nuwenet_session']);
    const users = await this.auth.userCount();
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || '');
    return {
      users, authenticated: Boolean(user), user,
      setup_code_required: users === 0 && (!local || Boolean(process.env.SETUP_TOKEN)),
      setup_available: local || Boolean(process.env.SETUP_TOKEN),
    };
  }

  @Post('setup') @HttpCode(200)
  async setup(@Body() dto: SetupDto, @Req() req: Request) {
    const ip = req.ip || 'unknown';
    try {
      await this.auth.throttle(ip);
    } catch (error) {
      // B8: el exceso de intentos queda en el registro de seguridad aunque la
      // operación se rechace.
      await logSecurity(this.database, { actor: dto.username?.trim() || '?', ip, event: 'auth.throttled', detail: 'setup' });
      throw error;
    }
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || '');
    if ((!local || process.env.SETUP_TOKEN) && (!process.env.SETUP_TOKEN || req.headers['x-setup-token'] !== process.env.SETUP_TOKEN)) {
      await logSecurity(this.database, { actor: dto.username?.trim() || '?', ip, event: 'auth.setup_denied', detail: 'token' });
      throw new ForbiddenException(!process.env.SETUP_TOKEN
        ? 'La creación de cuentas aún no está habilitada para este acceso. Contacta a quien instaló el sistema.'
        : req.headers['x-setup-token']
          ? 'El código de instalación es incorrecto. Revísalo y vuelve a intentarlo.'
          : 'Introduce el código de instalación para crear esta cuenta.');
    }
    const created = await this.auth.setup(dto);
    await logSecurity(this.database, { actor: created.username, ip, event: 'auth.setup', detail: 'superadmin creado' });
    return created;
  }

  @Post('login') @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip || 'unknown';
    const who = dto.username?.trim() || '?';
    try {
      await this.auth.throttle(ip);
    } catch (error) {
      await logSecurity(this.database, { actor: who, ip, event: 'auth.throttled', detail: 'login' });
      throw error;
    }
    try {
      const { user, token } = await this.auth.login(dto);
      res.setHeader('Set-Cookie', this.auth.sessionCookie(token, req.secure));
      // B8: éxito y fallo en registro independiente (no se pierde por rollback).
      await logSecurity(this.database, { actor: user.username, ip, event: 'auth.login', detail: user.role });
      return user;
    } catch (error) {
      await logSecurity(this.database, { actor: who, ip, event: 'auth.login_failed', detail: 'credenciales' });
      throw error;
    }
  }

  @Post('logout') @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = this.auth.parseCookies(req.headers.cookie);
    // B8: un fallo secundario de registro nunca bloquea el logout: la
    // eliminación de la sesión es lo primario y el log es independiente.
    try {
      await this.auth.logout(cookies['nuwenet_session']);
    } finally {
      res.setHeader('Set-Cookie', this.auth.clearCookie());
    }
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const cookies = this.auth.parseCookies(req.headers.cookie);
    const user = await this.auth.validate(cookies['nuwenet_session']);
    if (!user) return { authenticated: false, user: null };
    return { authenticated: true, user };
  }
  @Roles('superadmin') @Get('users') users() { return this.auth.users(); }
  @Roles('superadmin') @Post('users') @HttpCode(200) createUser(@Body() dto: CreateUserDto) { return this.auth.createUser(dto); }
  @Roles('superadmin') @Post('users/:id/update') @HttpCode(200)
  updateUser(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string, @Body() dto: UpdateUserDto) { return this.auth.updateUser(id, dto); }
  @Roles('superadmin') @Post('users/:id/remove') @HttpCode(200)
  removeUser(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string, @Req() req: Request) { return this.auth.deleteUser(id, (req as Request & { user?: { id: string } }).user?.id); }
  @Roles('admin', 'superadmin') @Post('password') @HttpCode(200)
  password(@Body() dto: ChangePasswordDto) { return this.auth.changePassword(requestContext.getStore()!.id, dto); }
}
