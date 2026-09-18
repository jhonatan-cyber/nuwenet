import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { isSystem } from './request-context';

// B7: guard canónico de roles. Sin actor no hay privilegios (ni siquiera de
// sistema): las tareas internas deben ejecutarse con SYSTEM_ACTOR explícito.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Rutas públicas (portal, bootstrap, sesión): sin metadatos, el guard no
    // decide; el middleware de main.ts ya las excluyó de la autenticación.
    if (!required || !required.length) return true;
    const req = context.switchToHttp().getRequest() as { user?: { id: string; username: string; role: string } };
    const actor = req.user;
    if (!actor) throw new UnauthorizedException('Inicia sesión para continuar.');
    if (isSystem(actor)) return true;
    if (!required.includes(actor.role)) throw new ForbiddenException('Tu rol no permite esta operación.');
    return true;
  }
}
