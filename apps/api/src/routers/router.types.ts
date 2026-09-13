export type AdapterId = 'arris-touchstone' | 'mikrotik-rest' | 'openwrt-ubus';
export interface RouterCredentials { username: string; password: string }
export interface RouterTarget {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  diagnostic_host: string | null;
}
export interface RouterRecord extends RouterTarget {
  id: number; name: string; adapter: AdapterId; credentials: string;
  status: 'untested' | 'connected' | 'error';
  last_checked: string | null; last_error: string | null; snapshot: string | null;
  building_id: number | null;
}
export interface RouterSnapshot {
  manufacturer: string;
  model: string | null;
  firmware: string | null;
  hardware?: string | null;
  serial?: string | null;
  wan?: { ip: string | null; mac: string | null; gateway: string | null; subnet: string | null; connection: string | null; dns: string[] };
  lan?: { ip: string | null; subnet: string | null; dhcp: string | null; clients: number | null };
  wireless?: { band: string; ssid: string | null; channel: string | null; mode: string | null; mac: string | null; clients: number | null }[];
  clients?: { name: string | null; ip: string | null; addresses?: string[]; mac: string | null; connection: string | null; status: string | null }[];
  uptime?: string | null;
  wan_status?: string | null;
  interfaces: { name: string; state: string; speed?: string }[];
  blocked?: string[];
  speedLimits?: { ip: string; maxLimit: string }[];
  firewallBlocks?: { ip: string; target: string }[];
  parental?: { ip: string; schedule: string }[];
  leases?: number;
  notes: string[];
}
export interface AdapterDescription {
  id: AdapterId;
  name: string;
  requirements: string;
  capabilities: {
    identification: boolean;
    status: boolean;
    interfaces: boolean;
    suspend: boolean;
    reactivate: boolean;
    speed_limit: boolean;
    firewall: boolean;
    parental_control: boolean;
  };
}
export interface RouterActionTarget {
  ip: string;
  down?: number;
  up?: number;
  target?: string;
  schedule?: string;
  remove?: boolean;
}
export interface MikroTikServiceItem {
  id: string;
  name: string;
  port: number;
  disabled: boolean;
  address: string;
  certificate?: string;
}
export interface ProvisionUserResult {
  username: string;
  password: string;
  script: string;
  credentialsUpdated: boolean;
}
export interface GenerateScriptOptions {
  username?: string;
  password?: string;
  sslPort?: number;
  disableInsecure?: boolean;
  restrictIp?: string;
}
export interface TrafficStat {
  id?: string;
  name: string;
  target?: string;
  ip?: string;
  downloadRate: number;
  uploadRate: number;
  downloadBytes: number;
  uploadBytes: number;
}
export interface UnlinkedDevice {
  mac: string;
  ip: string | null;
  name: string | null;
  status: string | null;
}
export interface RouterAdapter {
  description: AdapterDescription;
  inspect(target: RouterTarget, credentials: RouterCredentials): Promise<RouterSnapshot>;
  suspend?(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string>;
  reactivate?(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string>;
  setSpeedLimit?(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string>;
  firewall?(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string>;
  parental?(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string>;
  releaseClient?(target: RouterTarget, credentials: RouterCredentials, ip: string): Promise<void>;
  departmentSpeed?(target: RouterTarget, credentials: RouterCredentials, customerId:number, ips:string[], down:number, up:number):Promise<void>;
  getServices?(target: RouterTarget, credentials: RouterCredentials): Promise<MikroTikServiceItem[]>;
  updateService?(target: RouterTarget, credentials: RouterCredentials, serviceName: string, config: { port?: number; disabled?: boolean; address?: string }): Promise<void>;
  provisionNuwenetUser?(target: RouterTarget, credentials: RouterCredentials, options: { username?: string; password?: string }): Promise<{ username: string; password: string; script: string }>;
  generateCliScript?(options: GenerateScriptOptions): string;
  getTrafficStats?(target: RouterTarget, credentials: RouterCredentials, ipOrQueueName?:string): Promise<TrafficStat[]>;
  getUnlinkedDevices?(target: RouterTarget, credentials: RouterCredentials, linkedMacs: Set<string>): Promise<UnlinkedDevice[]>;
}
export const readCapabilities = {
  identification: true, status: true, interfaces: true,
  suspend: false, reactivate: false, speed_limit: false, firewall: false, parental_control: false,
};

// Backends que aplican control real por IP (suspend/reactivate/speed_limit).
// Los departamentos y APs aguas abajo pueden ser de CUALQUIER marca: van en
// modo bridge y el control se aplica en este punto central, no en cada equipo.
// Para soportar otro fabricante como punto de control, implementa RouterAdapter
// con esos métodos y añade su id a esta lista.
export const enforcingAdapters: AdapterId[] = ['mikrotik-rest'];
