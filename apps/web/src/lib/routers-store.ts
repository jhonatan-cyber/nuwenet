export interface RouterClient {
  name: string | null; ip: string | null; addresses?: string[]; mac: string | null;
  connection: string | null; status: string | null;
}
export interface RouterDeviceLink {
  mac: string; customer_id: number; apartment: string; name: string; archived: number;
}
export interface RouterSnapshot {
  manufacturer: string; model?: string | null; firmware?: string | null;
  hardware?: string | null; serial?: string | null;
  wan?: { ip?: string | null; mac?: string | null; gateway?: string | null; subnet?: string | null; connection?: string | null; dns?: string[] } | null;
  lan?: { ip?: string | null; subnet?: string | null; dhcp?: string | null; clients?: number | null } | null;
  wireless?: { band: string; ssid?: string | null; channel?: string | null; mode?: string | null; mac?: string | null; clients?: number | null }[] | null;
  clients?: RouterClient[] | null;
  wan_status?: string | null; uptime?: string | null;
  interfaces?: { name: string; state: string; speed?: string }[] | null;
  blocked?: string[]; speedLimits?: { ip: string; maxLimit: string }[];
  firewallBlocks?: { ip: string; target: string }[];
  parental?: { ip: string; schedule: string }[];
  leases?: number; notes?: string[];
}
export interface RouterEntry {
  id: number; name: string; adapter: string; host: string; port: number; protocol: string;
  diagnostic_host?: string | null; status: string; disabled?: number | boolean;
  last_checked?: string | null; last_error?: string | null;
  snapshot?: RouterSnapshot | null; capabilities?: Record<string, boolean>;
  checking?: boolean; building_id?: number | null; devices?: RouterDeviceLink[];
}
export interface RouterAdapterInfo { id: string; name: string; requirements: string }
export interface RoutersContext {
  canManage: boolean; userId: number;
  request: (route: string, body?: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<void>;
}
const listeners = new Set<() => void>();
const initial = { visible: false, context: null as RoutersContext | null };
let state = initial;
export const subscribeRouters = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getRouters = () => state;
export const getServerRouters = () => initial;
export function showRouters(context: RoutersContext) {
  state = { visible: true, context }; listeners.forEach(fn => fn());
}
export function hideRouters() {
  state = initial; listeners.forEach(fn => fn());
}
