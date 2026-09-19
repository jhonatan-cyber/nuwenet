import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../auth/auth.service';
import { requestContext } from '../../common/request-context';
import { PUBLIC_ROUTES, routerDevicesRoute, routerServicesRoute } from '../../config/app.config';

function isSuperOnly(route: string, method: string): boolean {
  return (
    /^\/(audit|backups|retired-rows)(\/|$)/.test(route) ||
    /^\/auth\/users(\/|$)/.test(route) ||
    (/^\/buildings(\/|$)/.test(route) && method !== 'GET') ||
    (/^\/routers(\/|$)/.test(route) &&
      ((method !== 'GET' && !routerDevicesRoute.test(route)) || routerServicesRoute.test(route))) ||
    /^\/settings$/.test(route) ||
    /^\/network\/retry$/.test(route)
  );
}

export function createAuthMiddleware(auth: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (PUBLIC_ROUTES.includes(req.path)) {
        next();
        return;
      }
      const cookies = auth.parseCookies(req.headers.cookie);
      const user = await auth.validate(cookies['nuwenet_session']);
      if (!user) {
        res.status(401).json({ error: 'Inicia sesión para continuar.' });
        return;
      }
      const route = req.path;
      const isSuper = user.role === 'superadmin';
      const isFull = user.role === 'admin' || isSuper;
      // Red y administración global: solo el super-admin (dueño del sistema).
      if (isSuperOnly(route, req.method) && !isSuper) {
        res.status(403).json({ error: 'Solo el super-admin puede configurar la red y los accesos.' });
        return;
      }
      if (!isFull) {
        res.status(403).json({ error: 'Tu rol no permite esta operación.' });
        return;
      }
      (req as Request & { user?: unknown }).user = user;
      requestContext.run(user, () => next());
    } catch {
      res.status(503).json({ error: 'Autenticación no disponible. Reintenta.' });
    }
  };
}
