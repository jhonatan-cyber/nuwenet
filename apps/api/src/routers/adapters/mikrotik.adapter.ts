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
    capabilities: { ...readCapabilities, suspend: true, reactivate: true, speed_limit: true, firewall: true, parental_control: true },
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
    if (!Array.isArray(resource) || !resource[0]?.version) throw new BadGatewayException('La respuesta no corresponde a RouterOS REST.');
    const r = resource[0];
    const snapshot: RouterSnapshot = {
      manufacturer: 'MikroTik', model: String(r['board-name'] || r.platform || 'RouterOS'),
      firmware: String(r.version), uptime: String(r.uptime || ''), interfaces: [],
      notes: ['Consulta REST autenticada. Acciones disponibles: suspend, reactivate y speed_limit por IP privada.'],
    };
    try {
      const interfaces = await routerJson(`${origin}/rest/interface`, { headers });
      if (!Array.isArray(interfaces)) throw new Error('Invalid interfaces');
      snapshot.interfaces = interfaces.slice(0, 200).map(i => ({ name: String(i.name || ''), state: i.running === true || i.running === 'true' ? 'up' : 'down' }));
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

  async departmentSpeed(target:RouterTarget,credentials:RouterCredentials,customerId:number,ips:string[],down:number,up:number):Promise<void>{
    if(!Number.isInteger(customerId)||customerId<1||!Number.isInteger(down)||!Number.isInteger(up)||down<1||up<1)throw new BadRequestException('Plan de velocidad inválido.');
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
    const policy = 'read,write,api,firewall,queue,dhcp,rest-api';

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
      '/user group add name=nuwenet policy=read,write,api,firewall,queue,dhcp,rest-api comment="NuweNet System"',
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
    return lines.join('\n');
  }
}

