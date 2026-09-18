import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { createServer } from 'node:http';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { requestContext } from './common/request-context';
import { AuditInterceptor } from './common/audit.interceptor';
import { RolesGuard } from './common/roles.guard';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from './database/database.service';
import { validateRouterHost } from './routers/router-network';

// Los identificadores son UUID v7: las rutas con id se reconocen por su forma
// (un patrón numérico ya no coincide con ningún router real).
const uuidPath = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const routerDevicesRoute = new RegExp(`^/routers/${uuidPath}/devices$`);
const routerServicesRoute = new RegExp(`^/routers/${uuidPath}/services$`);

// Límite de peticiones en memoria (una instancia): clave IP+path, ventana deslizante.
const rateBuckets = new Map<string, number[]>();
function checkRate(req: Request, max: number, windowMs: number): boolean {
  const ip = req.ip || String(req.headers['x-forwarded-for'] || '?');
  const key = `${ip} ${req.path}`;
  const cutoff = Date.now() - windowMs;
  const hits = (rateBuckets.get(key) || []).filter(t => t > cutoff);
  if (hits.length >= max) return false;
  hits.push(Date.now());
  if (rateBuckets.size > 5000) rateBuckets.clear();
  rateBuckets.set(key, hits);
  return true;
}

async function bootstrap() {
  const portalIp=process.env.NUWENET_PORTAL_IP, publicUrl=process.env.NUWENET_PUBLIC_URL;
  if(Boolean(portalIp)!==Boolean(publicUrl))throw new Error('Configura juntos NUWENET_PORTAL_IP y NUWENET_PUBLIC_URL.');
  if(portalIp && publicUrl){
    validateRouterHost(portalIp);
    const url=new URL(publicUrl),captivePort=Number(process.env.NUWENET_CAPTIVE_PORT || 3080);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('URL pública del portal inválida.');
    if(!Number.isInteger(captivePort)||captivePort<1||captivePort>65535||captivePort===Number(process.env.PORT || 3000))throw new Error('El puerto de corte debe ser válido y distinto del puerto de la API.');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const auth = app.get(AuthService);
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(v => v.trim()));
  app.use((_req:Request,res:Response,next:NextFunction)=>{res.setHeader('Referrer-Policy','no-referrer');next();});
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // B6: límites suaves en endpoints públicos del portal. El tráfico en vivo
    // es la consulta más costosa (una lectura completa al router): se limita
    // por IP y además se sirve desde una caché breve por router (ver
    // ManagementService.portalTraffic). En varias instancias este límite es
    // por instancia; el límite central queda pendiente (ver plan fase B6).
    if (req.method === 'GET' && req.path === '/portal/traffic' && !checkRate(req, 20, 60_000)) {
      return res.status(429).json({ error: 'Demasiadas consultas de tráfico. Espera un minuto.' });
    }
    if (req.method === 'GET' && (req.path === '/portal' || req.path === '/portal/usage') && !checkRate(req, 60, 60_000)) {
      return res.status(429).json({ error: 'Demasiadas consultas. Espera un minuto.' });
    }
    if (req.method === 'POST') {
      const origins = [`${req.protocol}://${req.headers.host}`, ...(process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:4321,http://localhost:4321').split(',').map(v => v.trim())];
      if (req.headers.origin && !origins.includes(req.headers.origin)) return res.status(403).json({ error: 'Origen no permitido.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Se requiere JSON.' });
    }
    next();
  });
  // Only bootstrap and session endpoints are public, including on an empty database.
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (['/auth/status','/auth/setup','/auth/login','/auth/logout','/auth/me','/health'].includes(req.path) || ['/portal','/portal/traffic','/portal/usage','/portal/notice'].includes(req.path)) return next();
      const cookies = auth.parseCookies(req.headers.cookie);
      const user = await auth.validate(cookies['nuwenet_session']);
      if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
      const route = req.path;
      const isSuper = user.role === 'superadmin';
      const isFull = user.role === 'admin' || isSuper;
      // Red y administración global: solo el super-admin (dueño del sistema).
      // Incluye altas de usuarios, edificios, routers y equipo central.
      const superOnly =
        /^\/(audit|backups|retired-rows)(\/|$)/.test(route) ||
        /^\/auth\/users(\/|$)/.test(route) ||
        (/^\/buildings(\/|$)/.test(route) && req.method !== 'GET') ||
        (/^\/routers(\/|$)/.test(route) && ((req.method !== 'GET' && !routerDevicesRoute.test(route)) || routerServicesRoute.test(route))) ||
        /^\/settings$/.test(route) ||
        /^\/network\/retry$/.test(route);
      if (superOnly && !isSuper) {
        return res.status(403).json({ error: 'Solo el super-admin puede configurar la red y los accesos.' });
      }
      if (!isFull) {
        return res.status(403).json({ error: 'Tu rol no permite esta operación.' });
      }
      (req as Request & { user?: unknown }).user = user;
      requestContext.run(user, () => next());
    } catch {
      return res.status(503).json({ error: 'Autenticación no disponible. Reintenta.' });
    }
  });
  app.useBodyParser('json', { limit: '16kb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  // B7: autorización canónica por guards + metadatos de roles. El middleware
  // de rutas de arriba se conserva como defensa en profundidad.
  app.useGlobalGuards(new RolesGuard(app.get(Reflector)));
  app.useGlobalInterceptors(new AuditInterceptor(app.get(DatabaseService)));
  app.useStaticAssets(path.resolve(__dirname, '../../web/dist'));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);
  if(process.env.NUWENET_PORTAL_IP && process.env.NUWENET_PUBLIC_URL) {
    const destination=new URL('/corte',process.env.NUWENET_PUBLIC_URL);
    const captive=createServer((_req,res)=>{res.writeHead(302,{Location:destination.href,'Cache-Control':'no-store'});res.end();});
    captive.listen(Number(process.env.NUWENET_CAPTIVE_PORT || 3080),process.env.NUWENET_PORTAL_IP);
    for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>captive.close());
  }
  console.log(`NuweNet disponible en http://${host}:${port}`);
}
void bootstrap();
