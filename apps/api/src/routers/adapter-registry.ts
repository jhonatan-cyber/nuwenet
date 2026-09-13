import { BadRequestException, Injectable } from '@nestjs/common';
import { ArrisAdapter } from './adapters/arris.adapter';
import { MikroTikAdapter } from './adapters/mikrotik.adapter';
import { OpenWrtAdapter } from './adapters/openwrt.adapter';
import type { RouterAdapter, RouterCredentials, RouterTarget } from './router.types';
import { routerOrigin, validateRouterHost } from './router-network';

@Injectable()
export class AdapterRegistry {
  private readonly adapters: RouterAdapter[];
  constructor(arris: ArrisAdapter, mikrotik: MikroTikAdapter, openwrt: OpenWrtAdapter) {
    this.adapters = [arris, mikrotik, openwrt];
  }
  list() { return this.adapters.map(adapter => adapter.description); }
  async detect(host: string, credentials: RouterCredentials) {
    validateRouterHost(host);
    for (const protocol of ['https', 'http'] as const) {
      const target: RouterTarget = { host, protocol, port: protocol === 'https' ? 443 : 80, diagnostic_host: null };
      // Probe only the supplied IP. Never follow redirects to another device.
      let arris = false;
      try {
        const response = await fetch(routerOrigin(target), { redirect: 'error', signal: AbortSignal.timeout(4000) });
        const reader = response.body?.getReader();
        let html = '';
        if (reader) {
          try {
            const decoder = new TextDecoder();
            while (html.length < 65536) {
              const { done, value } = await reader.read();
              if (done) break;
              html += decoder.decode(value, { stream: true });
            }
          } finally { await reader.cancel().catch(() => {}); }
        }
        arris = /arris|touchstone/i.test(html) && /UserName/.test(html);
      } catch { /* An API can work even when its root page does not. */ }
      const candidates = arris ? ['arris-touchstone'] : ['mikrotik-rest', 'openwrt-ubus'];
      for (const id of candidates) {
        const adapter = this.get(id);
        try {
          const snapshot = await adapter.inspect(target, credentials);
          return { target, adapter: adapter.description.id, snapshot };
        } catch { /* Try the next supported interface without exposing credentials. */ }
      }
    }
    throw new BadRequestException('No se pudo conectar automáticamente. Comprueba la IP, el usuario y la contraseña. Si el equipo usa otro puerto o requiere habilitar su acceso de administración, utiliza Configuración avanzada.');
  }
  get(id: string): RouterAdapter {
    const adapter = this.adapters.find(adapter => adapter.description.id === id);
    if (!adapter) throw new BadRequestException('Adaptador no implementado para este router.');
    return adapter;
  }
}
