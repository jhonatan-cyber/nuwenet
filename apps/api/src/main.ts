import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from './common/validation';
import { NestExpressApplication } from '@nestjs/platform-express';
import path from 'node:path';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AuditInterceptor } from './common/audit.interceptor';
import { RolesGuard } from './common/roles.guard';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from './database/database.service';
import { apiHost, apiPort, envTrustProxy } from './config/env';
import { apiHeaders, portalRateLimit, securityHeaders } from './infrastructure/http';
import { createAuthMiddleware } from './infrastructure/http/auth.middleware';
import { resolveCaptivePortalConfig, startCaptivePortal } from './infrastructure/captive-portal/captive-portal.service';

async function bootstrap() {
  const captiveConfig = resolveCaptivePortalConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const auth = app.get(AuthService);
  const trustProxy = envTrustProxy();
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  app.use('/api', apiHeaders);
  app.use('/api', portalRateLimit);
  // Only bootstrap and session endpoints are public, including on an empty database.
  app.use('/api', createAuthMiddleware(auth));
  app.useBodyParser('json', { limit: '16kb' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  app.useGlobalFilters(new ApiExceptionFilter());
  // B7: autorización canónica por guards + metadatos de roles. El middleware
  // de rutas se conserva como defensa en profundidad.
  app.useGlobalGuards(new RolesGuard(app.get(Reflector)));
  app.useGlobalInterceptors(new AuditInterceptor(app.get(DatabaseService)));
  app.useStaticAssets(path.resolve(__dirname, '../../web/dist'));
  app.enableShutdownHooks();
  const port = apiPort();
  const host = apiHost();
  await app.listen(port, host);
  if (captiveConfig) {
    startCaptivePortal(captiveConfig);
  }
  console.log(`NuweNet disponible en http://${host}:${port}`);
}
void bootstrap();
