/**
 * Sirve el build de `apps/web/dist` para revisión visual sin la API: el catálogo
 * interno (`/catalogo`) funciona completo, y las páginas del panel cargan pero no
 * piden datos. Pensado para revisar componentes, no para operar el sistema.
 *
 *   bun run preview            (compila la web y levanta este servidor)
 *   PORT=5000 bun tools/serve-web.ts
 */
import { join } from 'node:path';

const dist = join(import.meta.dir, '..', 'apps', 'web', 'dist');
const port = Number(process.env.PORT) || 4399;

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    for (const candidate of [path, join(path, 'index.html')]) {
      const file = Bun.file(join(dist, candidate));
      if (await file.exists()) return new Response(file);
    }
    return new Response('No encontrado. Compila la web con `bun run --cwd apps/web build`.', { status: 404 });
  },
});

console.log(`build web servido en http://127.0.0.1:${server.port} (pid ${process.pid})`);
console.log(`catálogo de componentes: http://127.0.0.1:${server.port}/catalogo`);
