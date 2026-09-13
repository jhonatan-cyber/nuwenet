import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseService} from '../apps/api/dist/database/database.service.js';
import {ManagementService} from '../apps/api/dist/management/management.service.js';
import {UsageService} from '../apps/api/dist/management/usage.service.js';
import {splitUsage} from '../apps/api/dist/management/usage-math.js';
import {OverdueScheduler} from '../apps/api/dist/management/scheduler.service.js';
import {requestContext} from '../apps/api/dist/common/request-context.js';
import {runAsSystem} from '../apps/api/dist/common/request-context.js';

const owner={id:1,role:'superadmin',username:'owner'};
const sample=(down,up,id='*A',name='nuwenet-department-1')=>({id,name,target:'192.168.1.10/32',downloadBytes:down,uploadBytes:up,downloadRate:0,uploadRate:0});
async function fixture(run){
  const directory=mkdtempSync(path.join(tmpdir(),'nuwenet-usage-'));
  const before={DB_DRIVER:process.env.DB_DRIVER,DATA_DIR:process.env.DATA_DIR};
  process.env.DB_DRIVER='sqlite';process.env.DATA_DIR=directory;
  let db=new DatabaseService();
  try{
    await db.onModuleInit();const management=new ManagementService(db,{},{});
    // B5/B7: alta inicial como sistema explícito; los enlaces se capturan al
    // emitir (el estado ya no los expone).
    const emitted=[];
    await runAsSystem(async()=>{
      await management.createPlan({name:'Internet',down:50,up:10,price:100});
      emitted.push((await management.createCustomer({apartment:'101',name:'Titular',plan_id:1,ip:'192.168.1.10'})).portal_link);
      emitted.push((await management.createCustomer({apartment:'102',name:'Segundo',plan_id:1,ip:'192.168.1.11'})).portal_link);
    });
    await db.write(async tx=>{
      await tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (1,'Central','mikrotik-rest','192.168.1.1',443,'https','fixture',1)`;
      await tx`UPDATE buildings SET central_router_id=1 WHERE id=1`;
    });
    let usage=new UsageService(db,{});
    await run({get db(){return db;},get usage(){return usage;},management,portalTokens:emitted.map(e=>e.token),history:(id=1,month='2026-09')=>requestContext.run(owner,()=>usage.history(id,month)),restart:async()=>{await db.onModuleDestroy();db=new DatabaseService();await db.onModuleInit();usage=new UsageService(db,{});}});
  }finally{
    await db.onModuleDestroy();for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    const resolved=realpathSync(directory);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('nuwenet-usage-'));rmSync(resolved,{recursive:true,force:true});
  }
}

test('consumo: primera lectura, reinicio por sentido, persistencia y duplicados',()=>fixture(async f=>{
  await f.usage.record(1,[sample(1_000_000,500_000)],'2026-09-10T12:00:00Z');
  assert.equal((await f.history()).totals.download_bytes,0);
  await f.usage.record(1,[sample(1_001_000,500_100)],'2026-09-10T12:01:00Z');
  await f.usage.record(1,[sample(200,500_200)],'2026-09-10T12:02:00Z');
  let result=await f.history();assert.equal(result.totals.download_bytes,1200);assert.equal(result.totals.upload_bytes,200);assert.equal(result.totals.resets,1);
  assert.ok(result.events.some(e=>e.kind==='counter_reset'));assert.equal(result.totals.estimated_bytes,300);
  await f.restart();
  await Promise.all([f.usage.record(1,[sample(300,500_300)],'2026-09-10T12:03:00Z'),f.usage.record(1,[sample(300,500_300)],'2026-09-10T12:03:00Z')]);
  await f.usage.record(1,[sample(0,0)],'2026-09-10T12:01:00Z');
  result=await f.history();assert.equal(result.totals.download_bytes,1300);assert.equal(result.totals.upload_bytes,300);assert.equal(result.totals.resets,1);
  assert.equal((await f.history(2)).totals.download_bytes,0);
}));

test('consumo: límites de mes en Bolivia y conservación exacta de bytes',()=>fixture(async f=>{
  const from=Date.parse('2026-09-01T03:59:30Z'),to=Date.parse('2026-09-01T04:00:30Z');
  const parts=splitUsage(from,to,101,51);assert.deepEqual(parts.map(p=>p.day),['2026-08-31','2026-09-01']);assert.equal(parts.reduce((s,p)=>s+p.download,0),101);
  await f.usage.record(1,[sample(1000,1000)],new Date(from).toISOString());
  await f.usage.record(1,[sample(1101,1051)],new Date(to).toISOString());
  assert.equal((await f.history(1,'2026-08')).totals.download_bytes,50);
  const september=await f.history();assert.equal(september.totals.download_bytes,51);assert.equal(september.totals.upload_bytes,26);assert.equal(september.totals.estimated_bytes,77);
  assert.equal(september.days.length,30);assert.equal((await f.history(1,'2028-02')).days.length,29);
  await assert.rejects(()=>f.history(1,'2026-13'),/Mes/);
}));

test('consumo: reemplazo, desaparición, huecos y cambio a cola compartida sin duplicar',()=>fixture(async f=>{
  await f.usage.record(1,[sample(100,50,'*L','nuwenet-192.168.1.10')],'2026-09-10T12:00:00Z');
  await f.usage.record(1,[sample(200,100,'*L','nuwenet-192.168.1.10')],'2026-09-10T12:01:00Z');
  await f.usage.record(1,[sample(1000,500),sample(900,400,'*L','nuwenet-192.168.1.10')],'2026-09-10T12:02:00Z');
  assert.equal((await f.history()).totals.download_bytes,100);
  await f.usage.record(1,[sample(1100,600)],'2026-09-10T12:03:00Z');
  await f.usage.record(1,[sample(9000,4000,'*NEW')],'2026-09-10T12:04:00Z');
  assert.equal((await f.history()).totals.download_bytes,200);
  await f.usage.record(1,[],'2026-09-10T12:05:00Z');
  await f.usage.record(1,[sample(15000,6000,'*NEW')],'2026-09-10T12:06:00Z');
  assert.equal((await f.history()).totals.download_bytes,200);
  await f.usage.record(1,[sample(16000,6500,'*NEW')],'2026-09-10T12:16:00Z');
  const history=await f.history();assert.equal(history.totals.download_bytes,1200);assert.equal(history.totals.estimated_bytes,1500);
  assert.ok(history.events.some(e=>e.kind==='queue_changed'));assert.ok(history.events.some(e=>e.kind==='resumed'));assert.ok(history.events.some(e=>e.kind==='sampling_gap'));
}));

test('consumo: contadores inválidos no producen reinicios falsos y servicio aislado',()=>fixture(async f=>{
  await f.usage.record(1,[sample(1000,500)],'2026-09-10T12:00:00Z');
  await f.usage.record(1,[sample(NaN,0)],'2026-09-10T12:01:00Z');
  assert.equal((await f.history()).coverage.router.status,'partial');
  await f.usage.record(1,[sample(1200,600)],'2026-09-10T12:02:00Z');
  assert.equal((await f.history()).totals.resets,0);assert.equal((await f.history()).totals.download_bytes,0);
  await assert.rejects(()=>f.usage.history(1,'2026-09'),/sesión/);
  await assert.rejects(()=>requestContext.run({id:999,role:'admin'},()=>f.usage.history(1,'2026-09')),/acceso/);
  const [token1,token2]=f.portalTokens;
  assert.equal((await f.usage.history(null,'2026-09',token2)).coverage.first_sample,null);
  assert.equal((await f.usage.history(2,'2026-09',token1)).coverage.first_sample,'2026-09-10T12:00:00.000Z');
  await f.db.write(tx=>tx`UPDATE customers SET archived=1 WHERE id=1`);
  await assert.rejects(()=>f.usage.history(null,'2026-09',token1),/Token/);
}));

test('consumo: error de router conserva acumulados y scheduler mide aunque fallen otras tareas',()=>fixture(async f=>{
  let calls=0;const usage=new UsageService(f.db,{getTraffic:async()=>{calls++;throw new Error('secret device error');}});
  await usage.collect();assert.equal(calls,1);
  const state=await f.history();assert.equal(state.coverage.router.status,'unavailable');assert.equal(JSON.stringify(state).includes('secret'),false);
  await f.db.write(tx=>tx`INSERT INTO users(username,password_hash,role,created_at) VALUES ('fixture','unused','superadmin',${new Date().toISOString()})`);
  let collected=0;
  const management={acquireTask:async()=> 'lock',releaseTask:async()=>{},syncLinkedDevices:async()=>{throw new Error('unrelated failure');},processQueue:async()=>{},processNotifications:async()=>{},settings:async()=>({overdue_minutes:0,auto_billing:false,reminders_enabled:false,backup_hours:0})};
  const scheduler=new OverdueScheduler(management,f.db,{}, {},{collect:async()=>{collected++;}});
  // C1: el fallo de una tarea no impide el resto del tick ni lo revierte.
  await scheduler.tick();assert.equal(collected,1);
  await scheduler.tick();assert.equal(collected,1);
  // C5: el fallo queda registrado como diagnóstico sin tumbar al scheduler.
  const [diagnostic]=await f.db.read(tx=>tx`SELECT value FROM settings WHERE key='task:linked'`);
  assert.match(JSON.parse(diagnostic.value).last_error||'',/unrelated/);
}));
