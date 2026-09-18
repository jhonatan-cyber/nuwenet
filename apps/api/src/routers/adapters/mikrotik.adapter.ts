import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readCapabilities, type GenerateScriptOptions, type MikroTikServiceItem, type RouterActionTarget, type RouterAdapter, type RouterCredentials, type RouterSnapshot, type RouterTarget, type TrafficStat, type UnlinkedDevice } from '../router.types';
import { routerJson, routerOrigin, routerRest, validateRouterHost } from '../router-network';

@Injectable()
export class MikroTikAdapter implements RouterAdapter {
  readonly description = {
    id: 'mikrotik-rest' as const,
    name: 'MikroTik · RouterOS REST',
    requirements: 'RouterOS con REST habilitado (www-ssl) y cuenta con permisos read, write, api, firewall, queue y dhcp. Consultas /rest/system/resource y /rest/interface; escritura en /rest/ip/firewall/filter y /rest/queue/simple. Único admitido como equipo central por edificio. Probado con respuestas simuladas; pendiente validación en equipo físico.',
    capabilities: { ...readCapabilities, suspend: true, reactivate: true, speed_limit: true, firewall: true, parental_control: true, switch_ports: true },
  };

  private headers(credentials: RouterCredentials) {
    return { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` };
  }

  private clientIp(ip: string): string {
    try {
      validateRouterHost(ip);
    } catch {
      throw new BadRequestException('Indica la IP privada del cliente (RFC1918) para la acción.');
    }
    return ip;
  }

  private suspendComment(ip: string): string {
    return `nuwenet-suspend-${ip}`;
  }

  private queueName(ip: string): string {
    return `nuwenet-${ip}`;
  }

  async inspect(target: RouterTarget, credentials: RouterCredentials): Promise<RouterSnapshot> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials);
    const resource = await routerJson(`${origin}/rest/system/resource`, { headers });
    // /system/resource es singleton: RouterOS real lo devuelve como objeto, no como arreglo.
    const r = Array.isArray(resource) ? resource[0] : resource as Record<string, unknown>;
    if (!r || typeof r !== 'object' || !r.version) throw new BadGatewayException('La respuesta no corresponde a RouterOS REST.');
    const snapshot: RouterSnapshot = {
      manufacturer: 'MikroTik', model: String(r['board-name'] || r.platform || 'RouterOS'),
      firmware: String(r.version), uptime: String(r.uptime || ''), interfaces: [],
      notes: ['Consulta REST autenticada. Acciones disponibles: suspend, reactivate y speed_limit por IP privada.'],
    };
    try {
      const interfaces = await routerJson(`${origin}/rest/interface`, { headers });
      if (!Array.isArray(interfaces)) throw new Error('Invalid interfaces');
      snapshot.interfaces = interfaces.slice(0, 200).map(i => ({ name: String(i.name || ''), state: i.running === true || i.running === 'true' ? 'up' : 'down', disabled: i.disabled === true || i.disabled === 'true' }));
    } catch { snapshot.notes.push('No se pudieron consultar las interfaces; verifica los permisos REST.'); }
    try {
      const rules = await this.filterRules(origin, headers as Record<string, string>);
      snapshot.blocked = rules
        .filter(rule => typeof rule?.comment === 'string' && (rule.comment as string).startsWith('nuwenet-suspend-') && rule?.disabled !== true && rule?.disabled !== 'true')
        .map(rule => String((rule as Record<string, unknown>)['src-address'] || (rule.comment as string).replace('nuwenet-suspend-', '')))
        .slice(0, 200);
      snapshot.parental = rules
        .filter(rule => typeof rule?.comment === 'string' && (rule.comment as string).startsWith('nuwenet-parental-') && rule?.disabled !== true && rule?.disabled !== 'true')
        .map(rule => ({
          ip: String((rule as Record<string, unknown>)['src-address'] || (rule.comment as string).replace('nuwenet-parental-', '')),
          schedule: String((rule as Record<string, unknown>).time || ''),
        }))
        .slice(0, 200);
    } catch { snapshot.notes.push('No se pudieron consultar los bloqueos; verifica el permiso firewall.'); }
    try {
      const entries = await this.addressEntries(origin, headers as Record<string, string>);
      snapshot.firewallBlocks = entries
        .filter(entry => typeof entry?.comment === 'string' && (entry.comment as string).startsWith('nuwenet-fw-'))
        .map(entry => ({
          ip: (entry.comment as string).replace('nuwenet-fw-', ''),
          target: String(entry.address || ''),
        }))
        .slice(0, 200);
    } catch { snapshot.notes.push('No se pudieron consultar los destinos bloqueados; verifica el permiso firewall.'); }
    try {
      const queues = await routerRest(`${origin}/rest/queue/simple`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(queues)) throw new Error('Invalid queues');
      snapshot.speedLimits = queues
        .filter(queue => typeof queue?.name === 'string' && (queue.name as string).startsWith('nuwenet-'))
        .map(queue => ({
          ip: String(queue.target || (queue.name as string).replace('nuwenet-', '')).replace('/32', ''),
          maxLimit: String(queue['max-limit'] || ''),
        }))
        .slice(0, 200);
    } catch { snapshot.notes.push('No se pudieron consultar las colas; verifica el permiso queue.'); }
    try {
      const leases = await routerRest(`${origin}/rest/ip/dhcp-server/lease`, { headers }) as unknown;
      if (Array.isArray(leases)) {
        snapshot.leases = leases.length;
        snapshot.clients = leases.slice(0,500).map((lease: Record<string,unknown>)=>({name:lease['host-name']?String(lease['host-name']):null,ip:lease['active-address']?String(lease['active-address']):lease.address?String(lease.address):null,mac:lease['active-mac-address']?String(lease['active-mac-address']).toUpperCase():lease['mac-address']?String(lease['mac-address']).toUpperCase():null,connection:null,status:lease.status?String(lease.status):null}));
      }
    } catch { snapshot.notes.push('No se pudieron consultar los leases DHCP; verifica el permiso dhcp.'); }
    return snapshot;
  }

  private async filterRules(origin: string, headers: Record<string, string>) {
    const rules = await routerRest(`${origin}/rest/ip/firewall/filter`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(rules)) throw new BadGatewayException('Respuesta inesperada de /rest/ip/firewall/filter.');
    return rules;
  }

  private async captiveRules(origin:string,headers:Record<string,string>,ip:string,enabled:boolean) {
    const server=process.env.NUWENET_PORTAL_IP;
    // With no portal configured, preserve existing installations and their REST contract.
    if(!server)return;
    this.clientIp(server);
    const port=Number(process.env.NUWENET_CAPTIVE_PORT || 3080), webPort=Number(new URL(process.env.NUWENET_PUBLIC_URL || `http://${server}:3000`).port || (process.env.NUWENET_PUBLIC_URL?.startsWith('https:')?443:80));
    if(!Number.isInteger(port)||port<1||port>65535)throw new BadRequestException('Puerto del portal inválido.');
    const prefix=`nuwenet-portal-${ip}`;
    for(const table of ['filter','nat']) {
      const url=`${origin}/rest/ip/firewall/${table}`;
      const rows=await routerRest(url,{headers}) as Record<string,unknown>[];
      if(!Array.isArray(rows))throw new BadGatewayException('No se pudieron consultar las reglas del portal.');
      const owned=rows.filter(r=>String(r.comment||'').startsWith(prefix+':'));
      for(const r of owned)if(r['.id'])await routerRest(`${url}/${encodeURIComponent(String(r['.id']))}`,{method:'DELETE',headers});
      if(!enabled)continue;
      const first=rows.find(r=>!owned.includes(r) && r.chain===(table==='nat'?'dstnat':'forward'));
      const place=first?.['.id']?{'place-before':first['.id']}:{};
      const definitions=table==='nat'?[{chain:'dstnat',action:'dst-nat','src-address':ip,'dst-address':'!'+server,protocol:'tcp','dst-port':'80','to-addresses':server,'to-ports':String(port),comment:prefix+':http'}]:[
        {chain:'forward',action:'accept','src-address':ip,'dst-address':server,protocol:'tcp','dst-port':[port,webPort].join(','),comment:prefix+':allow'},
        {chain:'forward',action:'accept','src-address':server,'dst-address':ip,protocol:'tcp','src-port':[port,webPort].join(','),'connection-state':'established,related',comment:prefix+':return'}
      ];
      for(const rule of definitions)await routerRest(url,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...rule,...place,disabled:false})});
    }
  }

  async suspend(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string> {
    const ip = this.clientIp(client.ip);
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const comment = this.suspendComment(ip);
    await this.captiveRules(origin,headers,ip,true);
    const rules = await this.filterRules(origin, headers);
    const existing = rules.find(rule => rule?.comment === comment);
    if (existing && existing?.disabled !== true && existing?.disabled !== 'true') return String((existing as Record<string, unknown>)['.id'] || 'ya-bloqueado');
    const created = await routerRest(`${origin}/rest/ip/firewall/filter`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'forward', action: 'drop', 'src-address': ip, comment, disabled: false, ...(rules.find(r=>r.chain==='forward' && !String(r.comment||'').startsWith('nuwenet-portal-'))?.['.id']?{'place-before':rules.find(r=>r.chain==='forward' && !String(r.comment||'').startsWith('nuwenet-portal-'))!['.id']}:{}) }),
    }) as Record<string, unknown>;
    return String(created?.['.id'] || 'bloqueado');
  }

  async reactivate(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string> {
    const ip = this.clientIp(client.ip);
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    await this.captiveRules(origin,headers,ip,false);
    const comment = this.suspendComment(ip);
    const rules = await this.filterRules(origin, headers);
    const matches = rules.filter(rule => rule?.comment === comment);
    if (!matches.length) return 'ya-activo';
    for (const rule of matches) {
      const id = String((rule as Record<string, unknown>)['.id'] || '');
      if (!id) continue;
      await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
    }
    return `reactivado (${matches.length})`;
  }

  async setSpeedLimit(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string> {
    const ip = this.clientIp(client.ip);
    if (!Number.isInteger(client.down) || !Number.isInteger(client.up) || (client.down as number) < 1 || (client.up as number) < 1) {
      throw new BadRequestException('Indica down y up en Mbps (enteros >= 1) para speed_limit.');
    }
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const name = this.queueName(ip);
    const targetCidr = `${ip}/32`;
    // MikroTik max-limit es "subida/bajada".
    const maxLimit = `${client.up}M/${client.down}M`;
    const queues = await routerRest(`${origin}/rest/queue/simple`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(queues)) throw new BadGatewayException('Respuesta inesperada de /rest/queue/simple.');
    const existing = queues.find(queue => queue?.name === name);
    if (!existing && queues.some(queue => queue?.target === targetCidr)) throw new BadRequestException('Existe una cola ajena a NuweNet para esta IP. Revísala antes de aplicar el plan.');
    if (existing?.['.id']) {
      const id = String(existing['.id']);
      await routerRest(`${origin}/rest/queue/simple/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: targetCidr, 'max-limit': maxLimit, disabled: false, comment: `NuweNet ${client.down}/${client.up} Mbps` }),
      });
      return id;
    }
    const created = await routerRest(`${origin}/rest/queue/simple`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, target: targetCidr, 'max-limit': maxLimit, disabled: false, comment: `NuweNet ${client.down}/${client.up} Mbps` }),
    }) as Record<string, unknown>;
    return String(created?.['.id'] || name);
  }

  async departmentSpeed(target:RouterTarget,credentials:RouterCredentials,customerId:string,ips:string[],down:number,up:number):Promise<void>{
    if(typeof customerId!=='string'||!customerId.trim()||!Number.isInteger(down)||!Number.isInteger(up)||down<1||up<1)throw new BadRequestException('Plan de velocidad inválido.');
    const addresses=[...new Set(ips.map(ip=>this.clientIp(ip)))].sort();
    const origin=routerOrigin(target),headers=this.headers(credentials),name=`nuwenet-department-${customerId}`;
    const queues=await routerRest(`${origin}/rest/queue/simple`,{headers}) as Record<string,unknown>[];
    if(!Array.isArray(queues))throw new BadGatewayException('No se pudieron consultar las colas.');
    const existing=queues.find(q=>q.name===name);
    if(!addresses.length){
      if(existing?.['.id'])await routerRest(`${origin}/rest/queue/simple/${encodeURIComponent(String(existing['.id']))}`,{method:'DELETE',headers});
      const remaining=await routerRest(`${origin}/rest/queue/simple`,{headers}) as Record<string,unknown>[];
      if(!Array.isArray(remaining)||remaining.some(q=>q.name===name))throw new BadGatewayException('El router no confirmó la eliminación de la cola del departamento.');
      return;
    }
    const targetCidr=addresses.map(ip=>`${ip}/32`).join(','),maxLimit=`${up}M/${down}M`;
    const filters=await this.filterRules(origin,headers);
    if(filters.some(r=>r.action==='fasttrack-connection'&&r.disabled!==true&&r.disabled!=='true'))throw new BadRequestException('FastTrack está activo: revisa sus exclusiones antes de aplicar el control por departamento.');
    for(const q of queues)if(q.name!==name && String(q.target||'').split(',').some(t=>addresses.some(ip=>t===ip||t===`${ip}/32`)) && !addresses.some(ip=>q.name===this.queueName(ip)))throw new BadRequestException('Existe otra cola para uno de los dispositivos. Revisa los límites antes de aplicar el plan.');
    const body={name,target:targetCidr,'max-limit':maxLimit,disabled:false,comment:`NuweNet departamento ${customerId}`};
    await routerRest(`${origin}/rest/queue/simple${existing?.['.id']?'/'+encodeURIComponent(String(existing['.id'])):''}`,{method:existing?'PATCH':'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    // Remove only legacy per-IP queues after creating the shared limit.
    for(const q of queues)if(addresses.some(ip=>q.name===this.queueName(ip))&&q['.id'])await routerRest(`${origin}/rest/queue/simple/${encodeURIComponent(String(q['.id']))}`,{method:'DELETE',headers});
    const after=await routerRest(`${origin}/rest/queue/simple`,{headers}) as Record<string,unknown>[];
    const saved=after.find(q=>q.name===name);
    const rate=(v:string)=>{const m=/^(\d+)([kmg])?$/i.exec(v);return m?Number(m[1])*({k:1000,m:1000000,g:1000000000}[m[2]?.toLowerCase() as 'k'|'m'|'g']||1):NaN;};
    if(!saved||String(saved.target).split(',').sort().join(',')!==targetCidr||String(saved['max-limit']).split('/').map(rate).join('/')!==[up*1000000,down*1000000].join('/')||saved.disabled===true||saved.disabled==='true')throw new BadGatewayException('El router no confirmó la cola del departamento.');
  }
  private firewallComment(ip: string): string {
    return `nuwenet-fw-${ip}`;
  }

  private parentalComment(ip: string): string {
    return `nuwenet-parental-${ip}`;
  }

  private async addressEntries(origin: string, headers: Record<string, string>) {
    const entries = await routerRest(`${origin}/rest/ip/firewall/address-list`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(entries)) throw new BadGatewayException('Respuesta inesperada de /rest/ip/firewall/address-list.');
    return entries;
  }

  async firewall(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string> {
    const ip = this.clientIp(client.ip);
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const comment = this.firewallComment(ip);
    await this.isolateFirewallLists(origin, headers);
    if (client.remove) {
      const entries = await this.addressEntries(origin, headers);
      const matches = entries.filter(entry => entry?.comment === comment && (!client.target || entry?.address === client.target));
      for (const entry of matches) {
        const id = String(entry['.id'] || '');
        if (id) await routerRest(`${origin}/rest/ip/firewall/address-list/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      }
      const rules = await this.filterRules(origin, headers);
      const remaining = (await this.addressEntries(origin, headers)).filter(entry => entry.comment === comment);
      const ruleMatches = remaining.length ? [] : rules.filter(rule => rule?.comment === comment);
      for (const rule of ruleMatches) {
        const id = String(rule['.id'] || '');
        if (id) await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      }
      return matches.length || ruleMatches.length ? `permitido (${matches.length + ruleMatches.length})` : 'ya-permitido';
    }
    const destination = (client.target || '').trim();
    if (!destination || destination.length > 255 || /\s/.test(destination)) {
      throw new BadRequestException('Indica el destino a bloquear (IP o dominio, sin espacios) para firewall.');
    }
    const entries = await this.addressEntries(origin, headers);
    const existsEntry = entries.some(entry => entry?.comment === comment && entry?.address === destination);
    if (!existsEntry) {
      await routerRest(`${origin}/rest/ip/firewall/address-list`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ list: comment, address: destination, comment, disabled: false }),
      });
    }
    const rules = await this.filterRules(origin, headers);
    const existsRule = rules.some(rule => rule?.comment === comment && rule?.disabled !== true && rule?.disabled !== 'true');
    if (!existsRule) {
      const created = await routerRest(`${origin}/rest/ip/firewall/filter`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: 'forward', action: 'drop', 'src-address': ip, 'dst-address-list': comment, comment, disabled: false }),
      }) as Record<string, unknown>;
      return String(created?.['.id'] || 'bloqueado');
    }
    return 'bloqueado';
  }

  async parental(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget): Promise<string> {
    const ip = this.clientIp(client.ip);
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const comment = this.parentalComment(ip);
    const rules = await this.filterRules(origin, headers);
    const matches = rules.filter(rule => rule?.comment === comment);
    const schedule = (client.schedule || '').trim();
    if (schedule === 'off') {
      for (const rule of matches) {
        const id = String(rule['.id'] || '');
        if (id) await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
      }
      return matches.length ? `horario eliminado (${matches.length})` : 'sin-horario';
    }
    if (!schedule || schedule.length > 64 || !/^[\dh\-,a-z]+$/i.test(schedule)) {
      throw new BadRequestException('Indica el horario MikroTik (p. ej. 22h-7h,mon,tue) u off para quitarlo.');
    }
    if (matches[0]?.['.id']) {
      const id = String(matches[0]['.id']);
      await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: schedule, disabled: false }),
      });
      return id;
    }
    const created = await routerRest(`${origin}/rest/ip/firewall/filter`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'forward', action: 'drop', 'src-address': ip, time: schedule, comment, disabled: false }),
    }) as Record<string, unknown>;
    return String(created?.['.id'] || 'programado');
  }

  private async isolateFirewallLists(origin: string, headers: Record<string,string>) {
    const entries = await this.addressEntries(origin, headers);
    const rules = await this.filterRules(origin, headers);
    for (const entry of entries) {
      const comment = String(entry.comment || '');
      if (!/^nuwenet-fw-\d+\.\d+\.\d+\.\d+$/.test(comment) || entry.list !== 'nuwenet-fw' || !entry['.id']) continue;
      await routerRest(`${origin}/rest/ip/firewall/address-list/${encodeURIComponent(String(entry['.id']))}`, { method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({list:comment}) });
    }
    for (const rule of rules) {
      const comment = String(rule.comment || '');
      if (!/^nuwenet-fw-\d+\.\d+\.\d+\.\d+$/.test(comment) || rule['dst-address-list'] !== 'nuwenet-fw' || !rule['.id']) continue;
      await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(String(rule['.id']))}`, { method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({'dst-address-list':comment}) });
    }
  }

  async releaseClient(target: RouterTarget, credentials: RouterCredentials, address: string) {
    const ip=this.clientIp(address), origin=routerOrigin(target), headers=this.headers(credentials);
    await this.captiveRules(origin,headers,ip,false);
    const owned=new Set([this.suspendComment(ip),this.firewallComment(ip),this.parentalComment(ip)]);
    const rules=await this.filterRules(origin,headers);
    for (const rule of rules) if (owned.has(String(rule.comment)) && rule['.id']) {
      await routerRest(`${origin}/rest/ip/firewall/filter/${encodeURIComponent(String(rule['.id']))}`,{method:'DELETE',headers});
    }
    const entries=await this.addressEntries(origin,headers);
    for (const entry of entries) if (entry.comment===this.firewallComment(ip) && entry['.id']) {
      await routerRest(`${origin}/rest/ip/firewall/address-list/${encodeURIComponent(String(entry['.id']))}`,{method:'DELETE',headers});
    }
    const queues=await routerRest(`${origin}/rest/queue/simple`,{headers}) as Record<string,unknown>[];
    if (!Array.isArray(queues)) throw new BadGatewayException('Respuesta de colas inválida.');
    for (const queue of queues) if (queue.name===this.queueName(ip) && queue['.id']) {
      await routerRest(`${origin}/rest/queue/simple/${encodeURIComponent(String(queue['.id']))}`,{method:'DELETE',headers});
    }
  }

  async getServices(target: RouterTarget, credentials: RouterCredentials): Promise<MikroTikServiceItem[]> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials);
    const services = await routerRest(`${origin}/rest/ip/service`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(services)) throw new BadGatewayException('No se pudieron consultar los servicios de RouterOS.');
    return services.map(s => ({
      id: String(s['.id'] || s.name || ''),
      name: String(s.name || ''),
      port: Number(s.port || 0),
      disabled: s.disabled === true || s.disabled === 'true',
      address: String(s.address || ''),
      certificate: s.certificate ? String(s.certificate) : undefined,
    }));
  }

  async updateService(target: RouterTarget, credentials: RouterCredentials, serviceName: string, config: { port?: number; disabled?: boolean; address?: string }): Promise<void> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const services = await this.getServices(target, credentials);
    const match = services.find(s => s.name === serviceName);
    if (!match) throw new BadRequestException(`Servicio ${serviceName} no encontrado en MikroTik.`);
    const payload: Record<string, unknown> = {};
    if (typeof config.port === 'number') payload.port = config.port;
    if (typeof config.disabled === 'boolean') payload.disabled = config.disabled;
    if (typeof config.address === 'string') payload.address = config.address;
    await routerRest(`${origin}/rest/ip/service/${encodeURIComponent(match.id)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async provisionNuwenetUser(target: RouterTarget, credentials: RouterCredentials, options: { username?: string; password?: string }): Promise<{ username: string; password: string; script: string }> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const username = options.username?.trim() || 'nuwenet-service';
    const password = options.password || randomBytes(16).toString('hex');
    const policy = 'read,write,rest-api';

    const groups = await routerRest(`${origin}/rest/user/group`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(groups)) throw new BadGatewayException('No se pudieron consultar los grupos de RouterOS.');
    const existingGroup = groups.find(g => g.name === 'nuwenet');
    if (existingGroup?.['.id']) {
      await routerRest(`${origin}/rest/user/group/${encodeURIComponent(String(existingGroup['.id']))}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy, comment: 'NuweNet System' }),
      });
    } else {
      await routerRest(`${origin}/rest/user/group`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'nuwenet', policy, comment: 'NuweNet System' }),
      });
    }

    const users = await routerRest(`${origin}/rest/user`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(users)) throw new BadGatewayException('No se pudieron consultar los usuarios de RouterOS.');
    const existingUser = users.find(u => u.name === username);
    if (existingUser?.['.id']) {
      await routerRest(`${origin}/rest/user/${encodeURIComponent(String(existingUser['.id']))}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: 'nuwenet', password, disabled: false, comment: 'NuweNet Backend Service' }),
      });
    } else {
      await routerRest(`${origin}/rest/user`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: username, group: 'nuwenet', password, comment: 'NuweNet Backend Service' }),
      });
    }

    const script = this.generateCliScript({ username, password });
    return { username, password, script };
  }

  async setupHttps(target: RouterTarget, credentials: RouterCredentials, options?: { name?: string }): Promise<{ certificate: string; enabled: boolean }> {
    const origin = routerOrigin(target);
    const jsonHeaders = { ...this.headers(credentials), 'Content-Type': 'application/json' } as Record<string, string>;
    const name = options?.name?.trim() || 'nuwenet-local';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new BadRequestException('Nombre de certificado inválido.');
    const certificates = await routerRest(`${origin}/rest/certificate`, { headers: this.headers(credentials) }) as Record<string, unknown>[];
    if (!Array.isArray(certificates)) throw new BadGatewayException('No se pudieron consultar los certificados de RouterOS.');
    const usable = certificates.some(c => c.name === name && (c['private-key'] === true || c['private-key'] === 'true') && c.ca !== true && c.ca !== 'true');
    if (!usable) {
      const created = await routerRest(`${origin}/rest/certificate`, {
        method: 'PUT', headers: jsonHeaders,
        body: JSON.stringify({ name, 'common-name': name, 'key-size': 2048, 'days-valid': 3650, 'key-usage': ['tls-server'] }),
      }) as Record<string, unknown>;
      const id = created && typeof created['.id'] === 'string' ? String(created['.id']) : '';
      if (!id) throw new BadGatewayException('RouterOS no devolvió el certificado creado.');
      await routerRest(`${origin}/rest/certificate/sign`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ numbers: id }),
      });
    }
    const services = await this.getServices(target, credentials);
    const wwwSsl = services.find(s => s.name === 'www-ssl');
    if (!wwwSsl) throw new BadRequestException('El equipo no expone el servicio www-ssl.');
    await routerRest(`${origin}/rest/ip/service/${encodeURIComponent(wwwSsl.id)}`, {
      method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ certificate: name, disabled: false }),
    });
    const updated = await this.getServices(target, credentials);
    const ready = updated.some(s => s.name === 'www-ssl' && !s.disabled && s.certificate === name);
    if (!ready) throw new BadGatewayException('RouterOS no confirmó el certificado en www-ssl. Revisa el estado del servicio.');
    return { certificate: name, enabled: true };
  }

  async setIdentity(target: RouterTarget, credentials: RouterCredentials, name: string): Promise<{ identity: string }> {
    const clean = name.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(clean)) throw new BadRequestException('Identidad inválida (letras, números, . _ -).');
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    await routerRest(`${origin}/rest/system/identity`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean }),
    });
    const updated = await routerRest(`${origin}/rest/system/identity`, { headers });
    const current = Array.isArray(updated) ? updated[0]?.name : (updated as Record<string, unknown>)?.name;
    if (current !== clean) throw new BadGatewayException('RouterOS no confirmó la identidad. Revisa su estado.');
    return { identity: clean };
  }

  async setDns(target: RouterTarget, credentials: RouterCredentials, servers: string[]): Promise<{ servers: string[] }> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const clean = servers.map(s => s.trim()).filter(Boolean);
    if (!clean.length || clean.length > 3) throw new BadRequestException('Indica de 1 a 3 DNS.');
    for (const server of clean) {
      const parts = server.split('.').map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new BadRequestException(`DNS inválido: ${server}.`);
    }
    await routerRest(`${origin}/rest/ip/dns/set`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ servers: clean.join(',') }),
    });
    const updated = await routerRest(`${origin}/rest/ip/dns`, { headers }) as Record<string, unknown>;
    const current = String((Array.isArray(updated) ? updated[0]?.servers : updated?.servers) || '');
    if (clean.some(server => !current.includes(server))) throw new BadGatewayException('RouterOS no confirmó los DNS. Revisa su estado.');
    return { servers: clean };
  }

  async addIpAddress(target: RouterTarget, credentials: RouterCredentials, address: { address: string; interface: string }): Promise<{ address: string; interface: string }> {
    const iface = address.interface.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(iface)) throw new BadRequestException('Interfaz inválida.');
    const [ip, prefix] = address.address.trim().split('/');
    validateRouterHost(ip);
    if (prefix !== '24') throw new BadRequestException('Solo se admite prefijo /24 en la puesta en marcha.');
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const existing = await routerRest(`${origin}/rest/ip/address`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(existing)) throw new BadGatewayException('No se pudieron consultar las direcciones del equipo.');
    if (!existing.some(a => a.address === `${ip}/24` && a.interface === iface)) {
      await routerRest(`${origin}/rest/ip/address`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: `${ip}/24`, interface: iface }),
      });
    }
    const updated = await routerRest(`${origin}/rest/ip/address`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(updated) || !updated.some(a => a.address === `${ip}/24` && a.interface === iface)) {
      throw new BadGatewayException(`La dirección ${ip}/24 no quedó en ${iface}. Si cambiaste la IP de gestión, verifica en la nueva dirección.`);
    }
    return { address: `${ip}/24`, interface: iface };
  }

  async setEthernetPort(target: RouterTarget, credentials: RouterCredentials, port: { name: string; disabled: boolean }): Promise<{ name: string; disabled: boolean }> {
    const name = port.name.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) throw new BadRequestException('Nombre de puerto inválido.');
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const ports = await routerRest(`${origin}/rest/interface/ethernet`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(ports)) throw new BadGatewayException('No se pudieron consultar los puertos ethernet.');
    const match = ports.find(p => p.name === name);
    if (!match?.['.id']) throw new BadRequestException(`Puerto ${name} no encontrado en el equipo.`);
    await routerRest(`${origin}/rest/interface/ethernet/${encodeURIComponent(String(match['.id']))}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled: port.disabled }),
    });
    const updated = await routerRest(`${origin}/rest/interface/ethernet`, { headers }) as Record<string, unknown>[];
    const current = Array.isArray(updated) ? updated.find(p => p.name === name) : null;
    const disabled = current?.disabled === true || current?.disabled === 'true';
    if (disabled !== port.disabled) throw new BadGatewayException(`El puerto ${name} no confirmó el cambio. Revisa su estado.`);
    return { name, disabled };
  }

  async getTrafficStats(target: RouterTarget, credentials: RouterCredentials, ipOrQueueName?: string): Promise<TrafficStat[]> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials);
    const queues = await routerRest(`${origin}/rest/queue/simple`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(queues)) throw new BadGatewayException('No se pudieron consultar las colas de QoS.');
    const parseRate = (v: string | null | undefined): number => {
      if (!v) return 0;
      const m = /^(\d+(?:\.\d+)?)([kmg])?(?:bps)?$/i.exec(String(v));
      if (!m) return 0;
      const unit = ({ k: 1000, m: 1_000_000, g: 1_000_000_000 } as Record<string, number>)[m[2]?.toLowerCase() || ''] ?? 1;
      return Number(m[1]) * unit;
    };
    return queues
      .filter(q => typeof q?.name === 'string' && (q.name as string).startsWith('nuwenet-'))
      .filter(q=>!ipOrQueueName || q.name===ipOrQueueName || String(q.target||'').split(',').some(t=>t.replace('/32','')===ipOrQueueName))
      .map(q => {
        const [ulRate = '0', dlRate = '0'] = String(q.rate || '0/0').split('/');
        const [ulBytes = '', dlBytes = ''] = String(q.bytes ?? '').split('/');
        const counter=(v:string)=>/^\d+$/.test(v) && Number.isSafeInteger(Number(v))?Number(v):NaN;
        return {
          id: q['.id']?String(q['.id']):undefined,
          name: String(q.name),
          target: q.target ? String(q.target).replace('/32', '') : undefined,
          ip: q.target ? String(q.target).split(',')[0].replace('/32', '') : undefined,
          downloadRate: parseRate(dlRate),
          uploadRate: parseRate(ulRate),
          downloadBytes: counter(dlBytes),
          uploadBytes: counter(ulBytes),
        } as TrafficStat;
      });
  }

  async getUnlinkedDevices(target: RouterTarget, credentials: RouterCredentials, linkedMacs: Set<string>): Promise<UnlinkedDevice[]> {
    const origin = routerOrigin(target);
    const headers = this.headers(credentials);
    const leases = await routerRest(`${origin}/rest/ip/dhcp-server/lease`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(leases)) throw new BadGatewayException('No se pudieron consultar los leases DHCP.');
    const normalize=(mac:string)=>mac.replace(/[-:]/g,'').toUpperCase();
    const linked=new Set([...linkedMacs].map(normalize));
    const seen=new Set<string>();
    return leases
      .map(lease => ({
        mac: lease['active-mac-address'] ? String(lease['active-mac-address']).toUpperCase() : lease['mac-address'] ? String(lease['mac-address']).toUpperCase() : '',
        ip: lease['active-address'] ? String(lease['active-address']) : lease.address ? String(lease.address) : null,
        name: lease['host-name'] ? String(lease['host-name']) : null,
        status: lease.status ? String(lease.status) : null,
      }))
      .filter(d => {const mac=normalize(d.mac);if(!/^[A-F0-9]{12}$/.test(mac)||linked.has(mac)||seen.has(mac))return false;seen.add(mac);return true;});
  }

  async setupWan(target: RouterTarget, credentials: RouterCredentials, options: { wanInterface?: string; wanDhcp?: boolean; nat?: boolean }): Promise<{ wanInterface: string; dhcpClient: boolean; nat: boolean }> {
    const wanInterface = options.wanInterface?.trim() || 'ether1';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(wanInterface)) throw new BadRequestException('Interfaz WAN inválida.');
    if (!options.wanDhcp && !options.nat) throw new BadRequestException('Activa DHCP en WAN o NAT saliente.');
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const json = { ...headers, 'Content-Type': 'application/json' };
    if (options.wanDhcp) {
      const clients = await routerRest(`${origin}/rest/ip/dhcp-client`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(clients)) throw new BadGatewayException('No se pudieron consultar los clientes DHCP.');
      const match = clients.find(c => c.interface === wanInterface);
      if (match?.['.id']) {
        await routerRest(`${origin}/rest/ip/dhcp-client/${encodeURIComponent(String(match['.id']))}`, {
          method: 'PATCH', headers: json, body: JSON.stringify({ disabled: false, comment: 'NuweNet WAN' }),
        });
      } else {
        await routerRest(`${origin}/rest/ip/dhcp-client`, {
          method: 'PUT', headers: json, body: JSON.stringify({ interface: wanInterface, disabled: false, comment: 'NuweNet WAN' }),
        });
      }
      const updated = await routerRest(`${origin}/rest/ip/dhcp-client`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(updated) || !updated.some(c => c.interface === wanInterface && c.disabled !== true && c.disabled !== 'true')) {
        throw new BadGatewayException(`DHCP-client no quedó activo en ${wanInterface}. Revisa su estado.`);
      }
    }
    if (options.nat) {
      const rules = await routerRest(`${origin}/rest/ip/firewall/nat`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(rules)) throw new BadGatewayException('No se pudieron consultar las reglas NAT.');
      const match = rules.find(r => r.comment === 'NuweNet NAT');
      if (match?.['.id']) {
        await routerRest(`${origin}/rest/ip/firewall/nat/${encodeURIComponent(String(match['.id']))}`, {
          method: 'PATCH', headers: json,
          body: JSON.stringify({ chain: 'srcnat', 'out-interface': wanInterface, action: 'masquerade', disabled: false, comment: 'NuweNet NAT' }),
        });
      } else {
        await routerRest(`${origin}/rest/ip/firewall/nat`, {
          method: 'PUT', headers: json,
          body: JSON.stringify({ chain: 'srcnat', 'out-interface': wanInterface, action: 'masquerade', comment: 'NuweNet NAT', disabled: false }),
        });
      }
      const updated = await routerRest(`${origin}/rest/ip/firewall/nat`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(updated) || !updated.some(r => r.comment === 'NuweNet NAT' && r.disabled !== true && r.disabled !== 'true')) {
        throw new BadGatewayException('NAT no quedó activo. Revisa su estado.');
      }
    }
    return { wanInterface, dhcpClient: !!options.wanDhcp, nat: !!options.nat };
  }

  async setupLanDhcp(target: RouterTarget, credentials: RouterCredentials, options: { lan?: string; lanInterface?: string; pool?: string; dns?: string; leases?: { mac: string; address: string; comment?: string }[] }): Promise<{ lan: string; lanInterface: string; pool: string; dns: string; leases: number }> {
    const v4 = (value: string) => {
      const parts = value.split('.').map(Number);
      if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new BadRequestException(`IPv4 inválida: ${value}.`);
      return parts;
    };
    if (!options.lan || !/^(\d{1,3}\.){3}\d{1,3}\/24$/.test(options.lan)) throw new BadRequestException('Indica la dirección LAN en formato 192.168.10.1/24.');
    const lanInterface = options.lanInterface?.trim() || 'ether2';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(lanInterface)) throw new BadRequestException('Interfaz LAN inválida.');
    const [lanAddr] = options.lan.split('/');
    const lanOctets = v4(lanAddr);
    if (lanOctets[3] === 0 || lanOctets[3] === 255) throw new BadRequestException('La dirección LAN no puede ser .0 ni .255.');
    const prefix = lanOctets.slice(0, 3).join('.');
    const network = `${prefix}.0/24`;
    if (!options.pool) throw new BadRequestException('Indica el pool DHCP (p. ej. 192.168.10.100-192.168.10.200).');
    const [poolStart, poolEnd] = options.pool.split('-');
    if (!poolStart || !poolEnd) throw new BadRequestException('Pool inválido (p. ej. 192.168.10.100-192.168.10.200).');
    const start = v4(poolStart), end = v4(poolEnd);
    for (const [label, octets] of [['inicio', start], ['fin', end]] as const) {
      if (octets.slice(0, 3).join('.') !== prefix) throw new BadRequestException(`El ${label} del pool debe estar en ${network}.`);
      if (octets[3] < 1 || octets[3] > 254) throw new BadRequestException(`El ${label} del pool debe estar entre .1 y .254.`);
    }
    if (start[3] >= end[3]) throw new BadRequestException('El inicio del pool debe ser menor que el fin.');
    const dns = (options.dns || '8.8.8.8,1.1.1.1').split(',').map(s => s.trim()).filter(Boolean);
    if (!dns.length || dns.length > 3) throw new BadRequestException('Indica de 1 a 3 DNS separados por coma.');
    for (const server of dns) v4(server);
    const leases = options.leases || [];
    if (leases.length > 250) throw new BadRequestException('Máximo 250 leases por operación.');
    const seenMacs = new Set<string>(), seenIps = new Set<string>();
    for (const lease of leases) {
      if (!/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(lease.mac)) throw new BadRequestException(`MAC inválida: ${lease.mac}.`);
      const ipOctets = v4(lease.address);
      if (ipOctets.slice(0, 3).join('.') !== prefix) throw new BadRequestException(`El lease ${lease.address} debe estar en ${network}.`);
      if (ipOctets[3] < 1 || ipOctets[3] > 254) throw new BadRequestException(`El lease ${lease.address} debe estar entre .1 y .254.`);
      if (start[3] <= ipOctets[3] && ipOctets[3] <= end[3]) throw new BadRequestException(`El lease ${lease.address} choca con el pool dinámico; usa una IP fuera de ${options.pool}.`);
      const mac = lease.mac.toUpperCase();
      if (seenMacs.has(mac) || seenIps.has(lease.address)) throw new BadRequestException(`Lease duplicado: ${lease.mac} / ${lease.address}.`);
      seenMacs.add(mac); seenIps.add(lease.address);
      if (lease.comment && (lease.comment.length > 80 || /[\r\n"]/.test(lease.comment))) throw new BadRequestException('Comentario de lease inválido (máximo 80 caracteres, sin comillas ni saltos).');
    }
    const origin = routerOrigin(target);
    const headers = this.headers(credentials) as Record<string, string>;
    const json = { ...headers, 'Content-Type': 'application/json' };
    // 1. Dirección LAN (reutiliza la lógica verificada de puesta en marcha).
    await this.addIpAddress(target, credentials, { address: options.lan, interface: lanInterface });
    // 2. Pool.
    const pools = await routerRest(`${origin}/rest/ip/pool`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(pools)) throw new BadGatewayException('No se pudo consultar el pool DHCP.');
    const poolMatch = pools.find(p => p.name === 'nuwenet-lan');
    if (poolMatch?.['.id']) {
      await routerRest(`${origin}/rest/ip/pool/${encodeURIComponent(String(poolMatch['.id']))}`, {
        method: 'PATCH', headers: json, body: JSON.stringify({ ranges: options.pool }),
      });
    } else {
      await routerRest(`${origin}/rest/ip/pool`, {
        method: 'PUT', headers: json, body: JSON.stringify({ name: 'nuwenet-lan', ranges: options.pool }),
      });
    }
    const poolsOk = await routerRest(`${origin}/rest/ip/pool`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(poolsOk) || !poolsOk.some(p => p.name === 'nuwenet-lan' && String(p.ranges || '').includes(options.pool!.split('-')[0]))) {
      throw new BadGatewayException('El pool no quedó configurado. Revisa su estado.');
    }
    // 3. Red DHCP (gateway + DNS).
    const networks = await routerRest(`${origin}/rest/ip/dhcp-server/network`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(networks)) throw new BadGatewayException('No se pudo consultar la red DHCP.');
    const netMatch = networks.find(n => n.address === network);
    if (netMatch?.['.id']) {
      await routerRest(`${origin}/rest/ip/dhcp-server/network/${encodeURIComponent(String(netMatch['.id']))}`, {
        method: 'PATCH', headers: json, body: JSON.stringify({ gateway: lanAddr, 'dns-server': dns.join(','), comment: 'NuweNet LAN' }),
      });
    } else {
      await routerRest(`${origin}/rest/ip/dhcp-server/network`, {
        method: 'PUT', headers: json, body: JSON.stringify({ address: network, gateway: lanAddr, 'dns-server': dns.join(','), comment: 'NuweNet LAN' }),
      });
    }
    // 4. Servidor DHCP.
    const servers = await routerRest(`${origin}/rest/ip/dhcp-server`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(servers)) throw new BadGatewayException('No se pudo consultar el servidor DHCP.');
    const serverMatch = servers.find(s => s.name === 'nuwenet-lan');
    if (serverMatch?.['.id']) {
      await routerRest(`${origin}/rest/ip/dhcp-server/${encodeURIComponent(String(serverMatch['.id']))}`, {
        method: 'PATCH', headers: json, body: JSON.stringify({ interface: lanInterface, 'address-pool': 'nuwenet-lan', disabled: false, comment: 'NuweNet LAN' }),
      });
    } else {
      await routerRest(`${origin}/rest/ip/dhcp-server`, {
        method: 'PUT', headers: json, body: JSON.stringify({ name: 'nuwenet-lan', interface: lanInterface, 'address-pool': 'nuwenet-lan', disabled: false, comment: 'NuweNet LAN' }),
      });
    }
    const serversOk = await routerRest(`${origin}/rest/ip/dhcp-server`, { headers }) as Record<string, unknown>[];
    if (!Array.isArray(serversOk) || !serversOk.some(s => s.name === 'nuwenet-lan' && s.disabled !== true && s.disabled !== 'true')) {
      throw new BadGatewayException('El servidor DHCP no quedó habilitado. Revisa su estado.');
    }
    // 5. Leases estáticos (solo altas/actualizaciones por MAC; no se eliminan leases existentes).
    if (leases.length) {
      const current = await routerRest(`${origin}/rest/ip/dhcp-server/lease`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(current)) throw new BadGatewayException('No se pudieron consultar los leases DHCP.');
      const byMac = new Map(current.map(l => [String(l['mac-address'] || '').toUpperCase(), l]));
      for (const lease of leases) {
        const mac = lease.mac.toUpperCase();
        const match = byMac.get(mac);
        const body: Record<string, unknown> = { address: lease.address, 'mac-address': mac };
        if (lease.comment) body.comment = lease.comment;
        if (match?.['.id']) {
          await routerRest(`${origin}/rest/ip/dhcp-server/lease/${encodeURIComponent(String(match['.id']))}`, {
            method: 'PATCH', headers: json, body: JSON.stringify(body),
          });
        } else {
          await routerRest(`${origin}/rest/ip/dhcp-server/lease`, {
            method: 'PUT', headers: json, body: JSON.stringify(body),
          });
        }
      }
      const after = await routerRest(`${origin}/rest/ip/dhcp-server/lease`, { headers }) as Record<string, unknown>[];
      if (!Array.isArray(after)) throw new BadGatewayException('No se pudo verificar los leases DHCP.');
      const afterByMac = new Map(after.map(l => [String(l['mac-address'] || '').toUpperCase(), String(l.address || '')]));
      for (const lease of leases) {
        if (afterByMac.get(lease.mac.toUpperCase()) !== lease.address) {
          throw new BadGatewayException(`El lease ${lease.address} no quedó registrado. Revisa su estado.`);
        }
      }
    }
    return { lan: options.lan, lanInterface, pool: options.pool, dns: dns.join(','), leases: leases.length };
  }

  generateCliScript(options: GenerateScriptOptions): string {
    const username = options.username || 'nuwenet-service';
    const password = options.password || 'CAMBIA_ESTA_CONTRASENA';
    const sslPort = options.sslPort || 443;
    if (/[\r\n]/.test(username + password + (options.restrictIp || ''))) throw new Error('Valor inválido para el script.');
    // Escape RouterOS dentro de comillas dobles: \ " $.
    const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$');
    if (options.restrictIp && !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(options.restrictIp)) throw new Error('IP de restricción inválida.');
    const lines = [
      '# === NuweNet RouterOS Setup Script ===',
      '# 1. Crear grupo con privilegios reducidos para NuweNet',
      '/user group add name=nuwenet policy=read,write,rest-api comment="NuweNet System"',
      '# 2. Crear usuario de servicio NuweNet',
      `/user add name=${username} group=nuwenet password="${quote(password)}" comment="NuweNet Backend Service"`,
      '# 3. Asegurar servicio REST (SSL)',
      `/ip service set www-ssl port=${sslPort} disabled=no`,
    ];
    if (options.disableInsecure) {
      lines.push('# 4. Desactivar servicios inseguros (opcional)');
      lines.push('/ip service set www disabled=yes');
      lines.push('/ip service set telnet disabled=yes');
      lines.push('/ip service set ftp disabled=yes');
    }
    if (options.restrictIp) {
      lines.push(`# 5. Restringir acceso REST a la IP del servidor NuweNet`);
      lines.push(`/ip service set www-ssl address="${options.restrictIp}"`);
    }
    if (options.wanDhcp || options.nat) {
      const wanInterface = options.wanInterface?.trim() || 'ether1';
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(wanInterface)) throw new Error('Interfaz WAN inválida.');
      lines.push('# 7. Uplink hacia el proveedor (DHCP + NAT para la LAN)');
      if (options.wanDhcp) lines.push(`/ip dhcp-client add interface=${wanInterface} disabled=no comment="NuweNet WAN"`);
      if (options.nat) lines.push(`/ip firewall nat add chain=srcnat out-interface=${wanInterface} action=masquerade comment="NuweNet NAT"`);
    }
    if (options.lan || options.pool || (options.leases?.length)) {
      const v4 = (value: string) => {
        const parts = value.split('.').map(Number);
        if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`IPv4 inválida: ${value}.`);
        return parts;
      };
      if (!options.lan || !/^(\d{1,3}\.){3}\d{1,3}\/24$/.test(options.lan)) throw new Error('Indica la dirección LAN en formato 192.168.10.1/24.');
      const lanInterface = options.lanInterface || 'ether2';
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(lanInterface)) throw new Error('Interfaz LAN inválida.');
      const [lanAddr] = options.lan.split('/');
      const lanOctets = v4(lanAddr);
      if (lanOctets[3] === 0 || lanOctets[3] === 255) throw new Error('La dirección LAN no puede ser .0 ni .255.');
      const prefix = lanOctets.slice(0, 3).join('.');
      const network = `${prefix}.0/24`;
      if (!options.pool) throw new Error('Indica el pool DHCP (p. ej. 192.168.10.100-192.168.10.200).');
      const [poolStart, poolEnd] = options.pool.split('-');
      const start = v4(poolStart), end = v4(poolEnd);
      for (const [label, octets] of [['inicio', start], ['fin', end]] as const) {
        if (octets.slice(0, 3).join('.') !== prefix) throw new Error(`El ${label} del pool debe estar en ${network}.`);
        if (octets[3] < 1 || octets[3] > 254) throw new Error(`El ${label} del pool debe estar entre .1 y .254.`);
      }
      if (start[3] >= end[3]) throw new Error('El inicio del pool debe ser menor que el fin.');
      const dns = (options.dns || '8.8.8.8,1.1.1.1').split(',').map(s => s.trim()).filter(Boolean);
      if (!dns.length || dns.length > 3) throw new Error('Indica de 1 a 3 DNS separados por coma.');
      for (const server of dns) v4(server);
      const leases = options.leases || [];
      if (leases.length > 250) throw new Error('Máximo 250 leases por script.');
      const seenMacs = new Set<string>(), seenIps = new Set<string>();
      for (const lease of leases) {
        if (!/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(lease.mac)) throw new Error(`MAC inválida: ${lease.mac}.`);
        const ipOctets = v4(lease.address);
        if (ipOctets.slice(0, 3).join('.') !== prefix) throw new Error(`El lease ${lease.address} debe estar en ${network}.`);
        if (ipOctets[3] < 1 || ipOctets[3] > 254) throw new Error(`El lease ${lease.address} debe estar entre .1 y .254.`);
        if (start[3] <= ipOctets[3] && ipOctets[3] <= end[3]) throw new Error(`El lease ${lease.address} choca con el pool dinámico; usa una IP fuera de ${options.pool}.`);
        const mac = lease.mac.toUpperCase();
        if (seenMacs.has(mac) || seenIps.has(lease.address)) throw new Error(`Lease duplicado: ${lease.mac} / ${lease.address}.`);
        seenMacs.add(mac); seenIps.add(lease.address);
        if (lease.comment && (lease.comment.length > 80 || /[\r\n"]/.test(lease.comment))) throw new Error('Comentario de lease inválido (máximo 80 caracteres, sin comillas ni saltos).');
      }
      lines.push('# 6. Red LAN y DHCP con leases estáticos (switch y departamentos)');
      lines.push(`/ip address add address=${options.lan} interface=${lanInterface} comment="NuweNet LAN"`);
      lines.push(`/ip pool add name=nuwenet-lan ranges=${options.pool}`);
      lines.push(`/ip dhcp-server network add address=${network} gateway=${lanAddr} dns-server=${dns.join(',')} comment="NuweNet LAN"`);
      lines.push(`/ip dhcp-server add name=nuwenet-lan interface=${lanInterface} address-pool=nuwenet-lan disabled=no comment="NuweNet LAN"`);
      for (const lease of leases) {
        lines.push(`/ip dhcp-server lease add address=${lease.address} mac-address=${lease.mac.toUpperCase()}${lease.comment ? ` comment="${quote(lease.comment)}"` : ''}`);
      }
    }
    return lines.join('\n');
  }
}

