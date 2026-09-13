import { BadGatewayException, Injectable } from '@nestjs/common';
import { readCapabilities, type RouterAdapter, type RouterCredentials, type RouterSnapshot, type RouterTarget } from '../router.types';
import { routerJson, routerOrigin } from '../router-network';

@Injectable()
export class OpenWrtAdapter implements RouterAdapter {
  readonly description = {
    id: 'openwrt-ubus' as const,
    name: 'OpenWrt · ubus JSON-RPC',
    requirements: 'Endpoint /ubus con sesión login y permisos para system.board, system.info y network.interface.dump. Solo consulta: identificación, versión, tiempo activo e interfaces. Probado con respuestas simuladas; pendiente validación en equipo físico.',
    capabilities: { ...readCapabilities },
  };

  async inspect(target: RouterTarget, credentials: RouterCredentials): Promise<RouterSnapshot> {
    const endpoint = `${routerOrigin(target)}/ubus`;
    const call = async (session: string, object: string, method: string, args: Record<string, unknown> = {}) => {
      const response = await routerJson(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: [session, object, method, args] }),
      }) as { result?: [number, Record<string, unknown>] };
      if (response?.result?.[0] !== 0) throw new BadGatewayException('OpenWrt rechazó la sesión o los permisos ubus.');
      return response.result[1] || {};
    };
    const login = await call('00000000000000000000000000000000', 'session', 'login', { ...credentials, timeout: 60 });
    const session = login.ubus_rpc_session;
    if (typeof session !== 'string' || !/^[a-f0-9]{32}$/i.test(session)) throw new BadGatewayException('OpenWrt no devolvió una sesión válida.');
    try {
      const board = await call(session, 'system', 'board');
      if (!board.model && !board.board_name) throw new BadGatewayException('La respuesta no identifica un equipo OpenWrt.');
      const release = board.release as { description?: string } | undefined;
      const snapshot: RouterSnapshot = {
        manufacturer: 'OpenWrt', model: String(board.model || board.board_name),
        firmware: release?.description || String(board.kernel || ''), interfaces: [],
        notes: ['Consulta ubus autenticada. Control de acceso y velocidad todavía no implementados.'],
      };
      try { const info = await call(session, 'system', 'info'); snapshot.uptime = `${Number(info.uptime || 0)} s`; }
      catch { snapshot.notes.push('Sin permisos para consultar el tiempo de actividad.'); }
      try {
        const info = await call(session, 'network.interface', 'dump');
        if (Array.isArray(info.interface)) snapshot.interfaces = info.interface.slice(0, 200).map(i => ({ name: String(i.interface || ''), state: i.up ? 'up' : 'down' }));
      } catch { snapshot.notes.push('Sin permisos para consultar las interfaces.'); }
      return snapshot;
    } finally {
      await call(session, 'session', 'destroy', { ubus_rpc_session: session }).catch(() => {});
    }
  }
}
