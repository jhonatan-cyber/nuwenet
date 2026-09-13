import { createTestDatabase } from './postgres-fixture.js';
import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseService} from '../apps/api/dist/database/database.service.js';
import {ManagementService} from '../apps/api/dist/management/management.service.js';
import {NotifierService} from '../apps/api/dist/management/notifier.service.js';
import {MikroTikAdapter} from '../apps/api/dist/routers/adapters/mikrotik.adapter.js';
import {requestContext} from '../apps/api/dist/common/request-context.js';
import {runAsSystem} from '../apps/api/dist/common/request-context.js';

test('Pro: tokens, aislamiento, transferencias atómicas, recibos firmados y WhatsApp sin bloqueo',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'nuwenet-pro-'));
  const pg = await createTestDatabase();
  const keys=['DB_DRIVER','DATA_DIR','NOTIFY_CHANNEL'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{DB_DRIVER:'postgres',DATA_DIR:dir,NOTIFY_CHANNEL:'log'});
  let db;
  try {
    db=new DatabaseService();await db.onModuleInit();
    const service=new ManagementService(db,{},new NotifierService(db));
    // B5/B7: la configuración inicial corre como sistema explícito; el enlace
    // completo solo se entrega una vez al emitirlo (ya no está en el estado).
    const created1=await runAsSystem(()=>service.createPlan({name:'Plan Pro',down:50,up:10,price:100}));
    void created1;
    const link1=(await runAsSystem(()=>service.createCustomer({apartment:'101',name:'Ana',phone:'+59170000000',plan_id:1}))).portal_link;
    const link2=(await runAsSystem(()=>service.createCustomer({apartment:'102',name:'Luis',plan_id:1}))).portal_link;
    assert.match(link1.token,/^[\w-]{43}$/);assert.notEqual(link1.token,link2.token);
    const customers=await db.read(tx=>tx`SELECT * FROM customers ORDER BY id`);
    // En reposo solo el hash; el estado no expone el enlace.
    assert.ok(customers[0].access_token_hash);assert.equal(customers[0].access_token,null);
    assert.equal((await runAsSystem(()=>service.snapshot())).customers[0].access_token,undefined);
    await runAsSystem(()=>service.generateBilling({period:'2026-01',due:'2026-01-10'}));
    const token=link1.token;
    await assert.rejects(()=>service.portalData('bad'),/Token/);
    const report=await service.portalReportPayment({token,amount:60,reference:' ref-1 ',notes:'<img src=x onerror=alert(1)>'});
    await assert.rejects(()=>service.portalReportPayment({token,amount:60,reference:'ref-1'}),/reporte/);
    const other=await service.portalData(link2.token);
    assert.equal(other.paymentReports.length,0);assert.equal(other.invoices.length,1);
    const results=await Promise.allSettled([runAsSystem(()=>service.reviewPaymentReport({id:report.id,status:'approved'})),runAsSystem(()=>service.reviewPaymentReport({id:report.id,status:'approved'}))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const portal=await service.portalData(token);
    assert.equal(portal.payments.length,1);assert.equal(portal.invoices[0].paid_total,6000);
    assert.match(portal.payments[0].signature,/^[a-f0-9]{64}$/);
    assert.equal(portal.payments[0].signature,(await runAsSystem(()=>service.receipt(portal.payments[0].id))).payment.signature);
    assert.equal((await runAsSystem(()=>service.sendInvoiceWhatsapp({id:portal.invoices[0].id}))).status,'internal');
    await runAsSystem(()=>service.sendPaymentWhatsapp({id:portal.payments[0].id}));
    assert.equal((await db.read(tx=>tx`SELECT * FROM notifications`)).length,2);
    const excessive=await service.portalReportPayment({token,amount:100,reference:'too-much'});
    await assert.rejects(()=>runAsSystem(()=>service.reviewPaymentReport({id:excessive.id,status:'approved'})),/supera/);
    assert.equal((await service.portalData(token)).payments.length,1);
    const noAccess={id:999,role:'admin',username:'outsider'};
    assert.deepEqual(await requestContext.run(noAccess,()=>service.listPaymentReports()),[]);
    await assert.rejects(()=>requestContext.run(noAccess,()=>service.listPaymentReports(customers[0].building_id)),/acceso/);
    await assert.rejects(()=>requestContext.run(noAccess,()=>service.sendInvoiceWhatsapp({id:portal.invoices[0].id})),/acceso/);
    await assert.rejects(()=>requestContext.run(noAccess,()=>service.reviewPaymentReport({id:excessive.id,status:'rejected'})),/acceso/);
    await db.onModuleDestroy();db=new DatabaseService();await db.onModuleInit();
    // B5: el hash persiste el reinicio y el enlace sigue válido sin exponerlo.
    const persisted=await db.read(tx=>tx`SELECT access_token_hash,access_token FROM customers WHERE id=1`);
    assert.ok(persisted[0].access_token_hash);assert.equal(persisted[0].access_token,null);
    assert.equal((await new ManagementService(db,{},{}).portalData(token)).payments.length,1);
    await db.write(tx=>tx`UPDATE customers SET archived=1 WHERE id=1`);
    await assert.rejects(()=>new ManagementService(db,{},{}).portalData(token),/Token/);
  } finally {
    if(db)await db.onModuleDestroy();
    for(const [k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    const resolved=realpathSync(dir);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('nuwenet-pro-'));await pg.close(); rmSync(resolved,{recursive:true,force:true});
  }
});

test('Pro: tasas subida/bajada, decimales y descubrimiento DHCP normalizado',async()=>{
  const original=globalThis.fetch,adapter=new MikroTikAdapter(),target={host:'192.168.88.1',port:443,protocol:'https'},credentials={username:'test',password:'test'};
  try {
    globalThis.fetch=async url=>Response.json(String(url).includes('queue')?[
      {name:'nuwenet-department-1',target:'192.168.88.2/32',rate:'1.5M/12M',bytes:'100/900'},
      {name:'foreign',rate:'10/20'}
    ]:[{'mac-address':'AA-BB-CC-DD-EE-01',address:'192.168.88.2'},{'active-mac-address':'aa:bb:cc:dd:ee:02','active-address':'192.168.88.3'},{'mac-address':'AA:BB:CC:DD:EE:02'},{'mac-address':'invalid'}]);
    const [traffic]=await adapter.getTrafficStats(target,credentials,'192.168.88.2');
    assert.equal(traffic.uploadRate,1500000);assert.equal(traffic.downloadRate,12000000);assert.equal(traffic.uploadBytes,100);assert.equal(traffic.downloadBytes,900);
    assert.equal((await adapter.getTrafficStats(target,credentials,'absent')).length,0);
    const devices=await adapter.getUnlinkedDevices(target,credentials,new Set(['aa:bb:cc:dd:ee:01']));
    assert.equal(devices.length,1);assert.equal(devices[0].ip,'192.168.88.3');
  }finally{globalThis.fetch=original;}
});

test('Pro: portal de corte antes del bloqueo, NAT HTTP y limpieza al reactivar',async()=>{
  const original=globalThis.fetch,keys=['NUWENET_PORTAL_IP','NUWENET_CAPTIVE_PORT','NUWENET_PUBLIC_URL'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{NUWENET_PORTAL_IP:'192.168.88.10',NUWENET_CAPTIVE_PORT:'3080',NUWENET_PUBLIC_URL:'http://192.168.88.10:3000'});
  const tables={filter:[{'.id':'external',chain:'forward',action:'accept'}],nat:[]};let next=0;
  globalThis.fetch=async(url,init)=>{
    const parts=new URL(url).pathname.split('/'),table=parts[4],id=decodeURIComponent(parts[5]||'');
    assert.ok(table in tables);
    if(!init.method||init.method==='GET')return Response.json(tables[table]);
    if(init.method==='DELETE'){tables[table]=tables[table].filter(r=>r['.id']!==id);return new Response(null,{status:204});}
    const body=JSON.parse(init.body),row={...body,'.id':String(++next)},index=tables[table].findIndex(r=>r['.id']===body['place-before']);
    if(index>=0)tables[table].splice(index,0,row);else tables[table].push(row);return Response.json(row);
  };
  try {
    const adapter=new MikroTikAdapter(),target={host:'192.168.88.1',port:443,protocol:'https'},credentials={username:'test',password:'test'},client={ip:'192.168.88.20'};
    await adapter.suspend(target,credentials,client);await adapter.suspend(target,credentials,client);
    assert.equal(tables.nat.length,1);assert.equal(tables.nat[0]['to-ports'],'3080');assert.equal(tables.nat[0]['dst-port'],'80');
    const block=tables.filter.findIndex(r=>r.action==='drop'),allow=tables.filter.findIndex(r=>r.comment?.endsWith(':allow'));
    assert.ok(allow>=0&&allow<block);assert.equal(tables.filter.filter(r=>r.action==='drop').length,1);
    await adapter.reactivate(target,credentials,client);assert.equal(tables.nat.length,0);assert.deepEqual(tables.filter,[{'.id':'external',chain:'forward',action:'accept'}]);
  }finally{globalThis.fetch=original;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
