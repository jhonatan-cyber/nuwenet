export type AdapterId = 'arris-touchstone' | 'mikrotik-rest' | 'openwrt-ubus' | 'tr369-usp';
export interface RouterCredentials { username: string; password: string }
export interface RouterTarget {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  diagnostic_host: string | null;
}
export interface RouterRecord extends RouterTarget {
  id: string; name: string; adapter: AdapterId; credentials: string;
  status: 'untested' | 'connected' | 'error';
  last_checked: string | null; last_error: string | null; snapshot: string | null;
  building_id: string | null;
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
  interfaces: { name: string; state: string; speed?: string; disabled?: boolean }[];
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
    switch_ports: boolean;
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
export interface DhcpLeaseOption { mac: string; address: string; comment?: string }
export interface WanSetupOptions {
  wanInterface?: string;
  wanDhcp?: boolean;
  nat?: boolean;
}
export interface LanDhcpSetupOptions {
  lan?: string;
  lanInterface?: string;
  pool?: string;
  dns?: string;
  leases?: DhcpLeaseOption[];
}
export interface GenerateScriptOptions {
  username?: string;
  password?: string;
  sslPort?: number;
  disableInsecure?: boolean;
  restrictIp?: string;
  wanInterface?: string;
  wanDhcp?: boolean;
  nat?: boolean;
  lan?: string;
  lanInterface?: string;
  pool?: string;
  dns?: string;
  leases?: DhcpLeaseOption[];
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
  departmentSpeed?(target: RouterTarget, credentials: RouterCredentials, customerId:string, ips:string[], down:number, up:number):Promise<void>;
  getServices?(target: RouterTarget, credentials: RouterCredentials): Promise<MikroTikServiceItem[]>;
  updateService?(target: RouterTarget, credentials: RouterCredentials, serviceName: string, config: { port?: number; disabled?: boolean; address?: string }): Promise<void>;
  provisionNuwenetUser?(target: RouterTarget, credentials: RouterCredentials, options: { username?: string; password?: string }): Promise<{ username: string; password: string; script: string }>;
  /** Crea (si falta) un certificado local autofirmado, lo asigna al servicio HTTPS y lo habilita. Verifica el estado, no el handshake TLS. */
  setupHttps?(target: RouterTarget, credentials: RouterCredentials, options?: { name?: string }): Promise<{ certificate: string; enabled: boolean }>;
  generateCliScript?(options: GenerateScriptOptions): string;
  getTrafficStats?(target: RouterTarget, credentials: RouterCredentials, ipOrQueueName?:string): Promise<TrafficStat[]>;
  getUnlinkedDevices?(target: RouterTarget, credentials: RouterCredentials, linkedMacs: Set<string>): Promise<UnlinkedDevice[]>;
  /** Habilita o deshabilita un puerto ethernet por nombre, con verificación de lectura. */
  setEthernetPort?(target: RouterTarget, credentials: RouterCredentials, port: { name: string; disabled: boolean }): Promise<{ name: string; disabled: boolean }>;
  /** Puesta en marcha inicial: identidad, DNS e IP de gestión, cada una con verificación. */
  setIdentity?(target: RouterTarget, credentials: RouterCredentials, name: string): Promise<{ identity: string }>;
  setDns?(target: RouterTarget, credentials: RouterCredentials, servers: string[]): Promise<{ servers: string[] }>;
  addIpAddress?(target: RouterTarget, credentials: RouterCredentials, address: { address: string; interface: string }): Promise<{ address: string; interface: string }>;
  /** Configuración visual WAN (DHCP-client + NAT) aplicada por REST con verificación. */
  setupWan?(target: RouterTarget, credentials: RouterCredentials, options: WanSetupOptions): Promise<{ wanInterface: string; dhcpClient: boolean; nat: boolean }>;
  /** Configuración visual LAN/DHCP (dirección, pool, red, servidor y leases) aplicada por REST con verificación. */
  setupLanDhcp?(target: RouterTarget, credentials: RouterCredentials, options: LanDhcpSetupOptions): Promise<{ lan: string; lanInterface: string; pool: string; dns: string; leases: number }>;
}
/** Nivel de administración de un equipo. La interfaz es común; las funciones dependen del adaptador y del modelo/firmware validado. */
export type RouterCompatibility = 'full' | 'partial' | 'read_only' | 'unavailable';
export function isValidatedArris(snapshot: RouterSnapshot | null): boolean {
  return snapshot?.model === 'TG2492LG-NA' && snapshot?.firmware === '9.1.103HB';
}
export function routerCompatibility(adapter: string, snapshot: RouterSnapshot | null, disabled?: number | boolean | null): RouterCompatibility {
  if (disabled) return 'unavailable';
  if (adapter === 'mikrotik-rest') return 'full';
  if (adapter === 'arris-touchstone' && isValidatedArris(snapshot)) return 'partial';
  return 'read_only';
}
export const readCapabilities = {
  identification: true, status: true, interfaces: true,
  suspend: false, reactivate: false, speed_limit: false, firewall: false, parental_control: false,
  switch_ports: false,
};

// Backends que aplican control real por IP (suspend/reactivate/speed_limit).
// Los departamentos y APs aguas abajo pueden ser de CUALQUIER marca: van en
// modo bridge y el control se aplica en este punto central, no en cada equipo.
// Para soportar otro fabricante como punto de control, implementa RouterAdapter
// con esos métodos y añade su id a esta lista.
export const enforcingAdapters: AdapterId[] = ['mikrotik-rest'];
