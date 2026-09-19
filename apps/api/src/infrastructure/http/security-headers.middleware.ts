import type { Request, Response, NextFunction } from 'express';
import { allowedOrigins } from '../../config/app.config';

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

export function apiHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (req.method === 'POST') {
    const origins = allowedOrigins(req.headers.host ? `${req.protocol}://${req.headers.host}` : undefined);
    if (req.headers.origin && !origins.includes(req.headers.origin)) {
      res.status(403).json({ error: 'Origen no permitido.' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'Se requiere JSON.' });
      return;
    }
  }
  next();
}
