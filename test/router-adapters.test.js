import { createTestSchema } from './postgres-fixture.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { MikroTikAdapter } from '../apps/api/dist/routers/adapters/mikrotik.adapter.js';
import { OpenWrtAdapter } from '../apps/api/dist/routers/adapters/openwrt.adapter.js';
import { CredentialVault } from '../apps/api/dist/routers/credential-vault.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { runAsSystem } from '../apps/api/dist/common/request-context.js';
import { RoutersService } from '../apps/api/dist/routers/routers.service.js';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const target = {host:'192.168.10.1',port:443,protocol:'https',diagnostic_host:null};
const credentials = {username:'fixture-user',password:'fixture-password'};

test('MikroTik: autenticación REST, normalización y rechazo de credenciales', async () => {
  const original = globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,init) => {
    calls.push({url,init});
    const path = String(url);
    if (path.endsWith('/resource')) return Response.json([{version:'7.20', 'board-name':'Fixture', uptime:'1d'}]);
    if (path.endsWith('/rest/ip/firewall/filter')) return Response.json([{'.id':'*1', comment:'nuwenet-suspend-192.168.10.9', 'src-address':'192.168.10.9', disabled:false}]);
    if (path.endsWith('/rest/queue/simple')) return Response.json([{'.id':'*A', name:'nuwenet-192.168.10.9', target:'192.168.10.9/32', 'max-limit':'20M/50M'}]);
    if (path.endsWith('/rest/ip/dhcp-server/lease')) return Response.json([{address:'192.168.10.9'}]);
    return Response.json([{name:'ether1',running:'true'}]);
  };
  try {
    const result=await new MikroTikAdapter().inspect(target,credentials);
    assert.equal(result.model,'Fixture');
    assert.equal(result.interfaces[0].state,'up');
    assert.deepEqual(result.blocked,['192.168.10.9']);
    assert.deepEqual(result.speedLimits,[{ip:'192.168.10.9',maxLimit:'20M/50M'}]);
    assert.equal(result.leases,1);
    assert.ok(calls.every(c=>c.init.redirect==='error' && (!c.init.method || c.init.method==='GET')));
    assert.equal(calls[0].init.headers.Authorization,'Basic '+Buffer.from('fixture-user:fixture-password').toString('base64'));
    globalThis.fetch=async()=>new Response('',{status:401});
    await assert.rejects(()=>new MikroTikAdapter().inspect(target,credentials), /credenciales/);
  } finally { globalThis.fetch=original; }
});

test('OpenWrt: sesión, consultas ubus permitidas y cierre de sesión', async () => {
  const original = globalThis.fetch;
  const methods=[];
  globalThis.fetch=async (_url,init)=>{
    const {params}=JSON.parse(init.body);
    const method=params[1]+'.'+params[2]; methods.push(method);
    const fixtures={
      'session.login':{ubus_rpc_session:'a'.repeat(32)},
      'system.board':{model:'Fixture OpenWrt',release:{description:'OpenWrt fixture'}},
      'system.info':{uptime:123},
      'network.interface.dump':{interface:[{interface:'lan',up:true}]},
      'session.destroy':{},
    };
    assert.ok(method in fixtures, 'No debe enviar métodos de configuración');
    return Response.json({jsonrpc:'2.0',id:1,result:[0,fixtures[method]]});
  };
  try {
    const result=await new OpenWrtAdapter().inspect(target,credentials);
    assert.equal(result.model,'Fixture OpenWrt');
    assert.equal(result.interfaces[0].state,'up');
    assert.equal(methods.at(-1),'session.destroy');
  } finally {globalThis.fetch=original;}
});

test('MikroTik: suspender, reactivar y limitar velocidad por IP', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let filters = [];
  let queues = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const path = String(url).split('?')[0];
    if (path.endsWith('/rest/ip/firewall/filter') && (!init.method || init.method === 'GET')) {
      return Response.json(filters);
    }
    if (path.endsWith('/rest/ip/firewall/filter') && init.method === 'PUT') {
      const body = JSON.parse(init.body);
      const created = { '.id': '*1', ...body };
      filters.push(created);
      return Response.json(created);
    }
    if (path.includes('/rest/ip/firewall/filter/') && init.method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1));
      filters = filters.filter(rule => rule['.id'] !== id);
      return new Response('', { status: 204 });
    }
    if (path.endsWith('/rest/queue/simple') && (!init.method || init.method === 'GET')) {
      return Response.json(queues);
    }
    if (path.endsWith('/rest/queue/simple') && init.method === 'PUT') {
      const body = JSON.parse(init.body);
      const created = { '.id': '*A', ...body };
      queues.push(created);
      return Response.json(created);
    }
    if (path.includes('/rest/queue/simple/') && init.method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1));
      const body = JSON.parse(init.body);
      queues = queues.map(queue => queue['.id'] === id ? { ...queue, ...body } : queue);
      return Response.json({});
    }
    throw new Error(`Llamada inesperada: ${init.method} ${url}`);
  };
  try {
    const adapter = new MikroTikAdapter();
    assert.equal(adapter.description.capabilities.suspend, true);
    assert.equal(adapter.description.capabilities.speed_limit, true);
    const first = await adapter.suspend(target, credentials, { ip: '192.168.10.50' });
    assert.equal(first, '*1');
    assert.equal(filters.length, 1);
    assert.equal(filters[0]['src-address'], '192.168.10.50');
    const idempotent = await adapter.suspend(target, credentials, { ip: '192.168.10.50' });
    assert.equal(filters.length, 1);
    assert.equal(idempotent, '*1');
    await assert.rejects(() => adapter.suspend(target, credentials, { ip: '8.8.8.8' }), /privada/);
    const queueId = await adapter.setSpeedLimit(target, credentials, { ip: '192.168.10.50', down: 50, up: 20 });
    assert.equal(queues.length, 1);
    assert.equal(queues[0]['max-limit'], '20M/50M');
    assert.equal(queues[0].target, '192.168.10.50/32');
    await adapter.setSpeedLimit(target, credentials, { ip: '192.168.10.50', down: 100, up: 30 });
    assert.equal(queues.length, 1);
    assert.equal(queues[0]['max-limit'], '30M/100M');
    assert.equal(queueId, '*A');
    const reactivated = await adapter.reactivate(target, credentials, { ip: '192.168.10.50' });
    assert.match(reactivated, /reactivado/);
    assert.equal(filters.length, 0);
    assert.equal(await adapter.reactivate(target, credentials, { ip: '192.168.10.50' }), 'ya-activo');
    assert.ok(calls.every(call => call.url.startsWith('https://192.168.10.1')));
  } finally { globalThis.fetch = original; }
});

test('MikroTik: firewall por destino y horario parental', async () => {
  const original = globalThis.fetch;
  let entries = [];
  let filters = [];
  let nextEntry=0;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('?')[0];
    const method = init.method || 'GET';
    if (path.endsWith('/rest/ip/firewall/address-list') && method === 'GET') return Response.json(entries);
    if (path.endsWith('/rest/ip/firewall/address-list') && method === 'PUT') {
      const body = JSON.parse(init.body);
      const created = { '.id': `*B${++nextEntry}`, ...body };
      entries.push(created);
      return Response.json(created);
    }
    if (path.includes('/rest/ip/firewall/address-list/') && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1));
      entries = entries.filter(entry => entry['.id'] !== id);
      return new Response('', { status: 204 });
    }
    if (path.includes('/rest/ip/firewall/address-list/') && method === 'PATCH') {
      const id=decodeURIComponent(path.split('/').at(-1));entries=entries.map(entry=>entry['.id']===id?{...entry,...JSON.parse(init.body)}:entry);return Response.json({});
    }
    if(path.endsWith('/rest/queue/simple') && method==='GET')return Response.json([]);
    if (path.endsWith('/rest/ip/firewall/filter') && method === 'GET') return Response.json(filters);
    if (path.endsWith('/rest/ip/firewall/filter') && method === 'PUT') {
      const body = JSON.parse(init.body);
      const created = { '.id': `*${filters.length + 1}`, ...body };
      filters.push(created);
      return Response.json(created);
    }
    if (path.includes('/rest/ip/firewall/filter/') && method === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1));
      filters = filters.map(rule => rule['.id'] === id ? { ...rule, ...JSON.parse(init.body) } : rule);
      return Response.json({});
    }
    if (path.includes('/rest/ip/firewall/filter/') && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1));
      filters = filters.filter(rule => rule['.id'] !== id);
      return new Response('', { status: 204 });
    }
    throw new Error(`Llamada inesperada: ${method} ${url}`);
  };
  try {
    const adapter = new MikroTikAdapter();
    assert.equal(adapter.description.capabilities.firewall, true);
    assert.equal(adapter.description.capabilities.parental_control, true);
    await assert.rejects(() => adapter.firewall(target, credentials, { ip: '192.168.10.50' }), /destino/);
    await assert.rejects(() => adapter.firewall(target, credentials, { ip: '8.8.8.8', target: '1.1.1.1' }), /privada/);
    assert.equal(await adapter.firewall(target, credentials, { ip: '192.168.10.50', target: 'tiktok.com' }), '*1');
    assert.equal(entries.length, 1);
    assert.equal(filters.length, 1);
    assert.equal(await adapter.firewall(target, credentials, { ip: '192.168.10.50', target: 'tiktok.com' }), 'bloqueado');
    assert.equal(entries.length, 1);
    assert.equal(filters.length, 1);
    await assert.rejects(() => adapter.parental(target, credentials, { ip: '192.168.10.50' }), /horario/);
    const ruleId = await adapter.parental(target, credentials, { ip: '192.168.10.50', schedule: '22h-7h,mon,tue' });
    assert.equal(filters.length, 2);
    assert.equal(await adapter.parental(target, credentials, { ip: '192.168.10.50', schedule: '23h-6h' }), ruleId);
    assert.equal(filters.length, 2);
    assert.match(await adapter.parental(target, credentials, { ip: '192.168.10.50', schedule: 'off' }), /horario eliminado/);
    assert.equal(filters.length, 1);
    assert.match(await adapter.firewall(target, credentials, { ip: '192.168.10.50', remove: true }), /permitido/);
    assert.equal(entries.length, 0);
    assert.equal(filters.length, 0);
    await adapter.firewall(target,credentials,{ip:'192.168.10.50',target:'one.example'});
    await adapter.firewall(target,credentials,{ip:'192.168.10.50',target:'two.example'});
    await adapter.firewall(target,credentials,{ip:'192.168.10.51',target:'three.example'});
    assert.equal(entries.length,3);assert.equal(filters.length,2);
    for(const rule of filters)assert.equal(rule['dst-address-list'],`nuwenet-fw-${rule['src-address']}`);
    assert.notEqual(entries[0].list,entries[2].list);
    // Adopt the previous shared-list format without broadening another customer's rules.
    entries=entries.map(entry=>({...entry,list:'nuwenet-fw'}));filters=filters.map(rule=>({...rule,'dst-address-list':'nuwenet-fw'}));
    await adapter.firewall(target,credentials,{ip:'192.168.10.50',target:'one.example'});
    assert.ok(entries.every(entry=>entry.list===entry.comment));assert.ok(filters.every(rule=>rule['dst-address-list']===rule.comment));
    await adapter.firewall(target,credentials,{ip:'192.168.10.50',target:'one.example',remove:true});
    assert.equal(filters.length,2);assert.equal(entries.length,2);
    await adapter.firewall(target,credentials,{ip:'192.168.10.50',remove:true});
    assert.equal(filters.length,1);assert.equal(entries[0].address,'three.example');
    await adapter.releaseClient(target,credentials,'192.168.10.51');assert.equal(filters.length,0);assert.equal(entries.length,0);
  } finally { globalThis.fetch = original; }
});

test('Credenciales cifradas, concurrencia de consulta y descarte de resultados obsoletos', async () => {
  return runAsSystem(async () => {
  const previous={DATA_DIR:process.env.DATA_DIR,DB_DRIVER:process.env.DB_DRIVER,ROUTER_ENCRYPTION_KEY:process.env.ROUTER_ENCRYPTION_KEY};
  const directory=mkdtempSync(path.join(tmpdir(),'nuwenet-router-test-'));
  const pg = await createTestSchema();
  process.env.DATA_DIR=directory; process.env.DB_DRIVER='postgres'; process.env.ROUTER_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const db=new DatabaseService();
  let release;
  let started;
  const began=new Promise(resolve=>started=resolve);
  const wait=new Promise(resolve=>release=resolve);
  const adapter={description:{id:'mikrotik-rest',capabilities:{status:true,suspend:false}},inspect:async()=>{started();await wait;return {manufacturer:'Fixture',model:'Unit',firmware:'1',interfaces:[],notes:[]};}};
  const registry={get:()=>adapter,list:()=>[adapter.description]};
  const vault=new CredentialVault();
  const service=new RoutersService(db,registry,vault);
  try {
    await db.onModuleInit();
    const value=vault.seal(credentials);
    assert.ok(!value.includes(credentials.password));
    assert.deepEqual(vault.open(value),credentials);
    const segments=value.split('.'); segments[3]=Buffer.from('corrupt').toString('base64');
    assert.throws(()=>vault.open(segments.join('.')));
    const saved=await service.save({...target,name:'Fixture',adapter:'mikrotik-rest',...credentials});
    const id=saved.routers[0].id;
    const [persisted]=await db.read(tx=>tx`SELECT credentials FROM routers WHERE id=${id}`);
    assert.deepEqual(vault.open(persisted.credentials),credentials);
    assert.notEqual(persisted.credentials,credentials.password);
    const check=service.check(id);
    await began;
    await assert.rejects(()=>service.check(id),e=>e.getStatus()===409);
    // Another API instance changes the target while the first one is consulting it.
    const second=new RoutersService(db,registry,vault);
    await second.save({...target,host:'192.168.10.2',name:'Changed',adapter:'mikrotik-rest'},id);
    release();
    await assert.rejects(()=>check,e=>e.getStatus()===409);
    assert.equal((await service.detail(id)).router.status,'untested');
    const result=await service.check(id);
    assert.equal(result.success,true);
    assert.equal(result.router.checking,false);
    assert.equal((await service.detail(id)).checks.length,1);
  } finally {
    release(); await db.onModuleDestroy();
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    const resolved=realpathSync(directory);
    assert.equal(path.dirname(resolved),realpathSync(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('nuwenet-router-test-'));
    await pg.close(); rmSync(resolved,{recursive:true,force:true});
  }
  });
});

test('MikroTik: consulta y ajuste de servicios, aprovisionamiento de usuario y script CLI', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const path = String(url);
    if (path.endsWith('/rest/ip/service')) {
      return Response.json([
        { '.id': '*1', name: 'api', port: 8728, disabled: 'false', address: '' },
        { '.id': '*2', name: 'winbox', port: 8291, disabled: 'false', address: '' },
        { '.id': '*3', name: 'www', port: 80, disabled: 'false', address: '' },
        { '.id': '*4', name: 'www-ssl', port: 443, disabled: 'false', address: '' },
      ]);
    }
    if (path.includes('/rest/ip/service/*4')) {
      return Response.json({ '.id': '*4', name: 'www-ssl', port: 8443, disabled: 'false', address: '192.168.10.0/24' });
    }
    if (path.endsWith('/rest/user/group')) {
      return Response.json([
        { '.id': '*1', name: 'full', policy: 'read,write,policy' }
      ]);
    }
    if (path.endsWith('/rest/user')) {
      return Response.json([
        { '.id': '*1', name: 'admin', group: 'full' }
      ]);
    }
    return Response.json({ ok: true });
  };
  try {
    const adapter = new MikroTikAdapter();
    // 1. Get services
    const services = await adapter.getServices(target, credentials);
    assert.equal(services.length, 4);
    assert.equal(services.find(s => s.name === 'www-ssl')?.port, 443);
    assert.equal(services.find(s => s.name === 'www-ssl')?.disabled, false);

    // 2. Update service
    await adapter.updateService(target, credentials, 'www-ssl', { port: 8443, disabled: false, address: '192.168.10.0/24' });
    const patchCall = calls.find(c => c.url.includes('/rest/ip/service/*4') && c.init?.method === 'PATCH');
    assert.ok(patchCall);
    assert.deepEqual(JSON.parse(patchCall.init.body), { port: 8443, disabled: false, address: '192.168.10.0/24' });

    // 3. Provision user
    const prov = await adapter.provisionNuwenetUser(target, credentials, { username: 'nuwenet-svc', password: 'secretpassword123' });
    assert.equal(prov.username, 'nuwenet-svc');
    assert.equal(prov.password, 'secretpassword123');
    assert.ok(prov.script.includes('/user group add name=nuwenet'));
    assert.ok(prov.script.includes('nuwenet-svc'));

    // 4. Generate CLI script
    const script = adapter.generateCliScript({ username: 'test-user', password: 'test-pass', sslPort: 8443, disableInsecure: true });
    assert.ok(script.includes('/ip service set www-ssl port=8443 disabled=no'));
    assert.ok(script.includes('/ip service set www disabled=yes'));
    assert.ok(script.includes('test-user'));
  } finally {
    globalThis.fetch = original;
  }
});

