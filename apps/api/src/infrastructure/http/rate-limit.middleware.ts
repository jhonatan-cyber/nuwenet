import type { Request, Response, NextFunction } from 'express';

// Límite de peticiones en memoria (una instancia): clave IP+path, ventana deslizante.
const rateBuckets = new Map<string, number[]>();

export function checkRate(req: Request, max: number, windowMs: number): boolean {
  const ip = req.ip || String(req.headers['x-forwarded-for'] || '?');
  const key = `${ip} ${req.path}`;
  const cutoff = Date.now() - windowMs;
  const hits = (rateBuckets.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= max) return false;
  hits.push(Date.now());
  if (rateBuckets.size > 5000) rateBuckets.clear();
  rateBuckets.set(key, hits);
  return true;
}

export function clearRateBuckets(): void {
  rateBuckets.clear();
}

// B6: límites suaves en endpoints públicos del portal. El tráfico en vivo
// es la consulta más costosa: se limita por IP. En varias instancias el
// límite es por instancia; el límite central queda pendiente.
export function portalRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' && req.path === '/portal/traffic' && !checkRate(req, 20, 60_000)) {
    res.status(429).json({ error: 'Demasiadas consultas de tráfico. Espera un minuto.' });
    return;
  }
  if (req.method === 'GET' && (req.path === '/portal' || req.path === '/portal/usage') && !checkRate(req, 60, 60_000)) {
    res.status(429).json({ error: 'Demasiadas consultas. Espera un minuto.' });
    return;
  }
  next();
}
