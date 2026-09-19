import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createTestSchema} from '../fixtures/postgres-fixture';
import {DatabaseService} from '../../apps/api/dist/database/database.service.js';
import {ManagementService} from '../../apps/api/dist/management/management.service.js';
import {AuthService} from '../../apps/api/dist/auth/auth.service.js';
import {OverdueScheduler} from '../../apps/api/dist/management/scheduler.service.js';
import {runAsSystem,requestContext} from '../../apps/api/dist/common/request-context.js';
import {forEachConcurrent} from '../../apps/api/dist/common/concurrency.js';
import {uuidv7} from '../../apps/api/dist/common/uuid.js';

async function fixture(work){
  const pg=await createTestSchema(),db=new DatabaseService();
  try{await db.onModuleInit();await runAsSystem(()=>work(db,new ManagementService(db,{})));}
  finally{await db.onModuleDestroy();await pg.close();}
}

test('optimización: concurrencia limitada y errores esperan los trabajos en curso',async()=>{
  let active=0,maximum=0;const seen=[];
  await forEachConcurrent([1,2,3,4,5],3,async id=>{
    active++;maximum=Math.max(maximum,active);seen.push(id);
    await Promise.resolve();active--;
  });
  assert.equal(maximum,3);assert.deepEqual(seen.sort(),[1,2,3,4,5]);
  const release=Promise.withResolvers(),entered=Promise.withResolvers();let finished=false;
  const work=forEachConcurrent([1,2],2,async id=>{if(id===1)throw new Error('fixture');entered.resolve();await release.promise;}).finally(()=>{finished=true;});
  const checked=assert.rejects(()=>work,/fixture/);
  await entered.promise;await Promise.resolve();assert.equal(finished,false);
  release.resolve();await checked;assert.equal(finished,true);
});

test('optimización: una lectura de clave para 100 firmas, incluida reversión',()=>fixture(async(db,service)=>{
  await service.createPlan({name:'Plan',down:50,up:10,price:100});
  const [plan]=await db.read(tx=>tx`SELECT id FROM plans LIMIT 1`);
  const {portal_link}=await service.createCustomer({apartment:'101',plan_id:plan.id});
  await service.generateBilling({period:'2026-01',due:'2026-01-10'});
  const [invoice]=await db.read(tx=>tx`SELECT id FROM invoices LIMIT 1`);
  await db.write(async tx=>{for(let n=1;n<=100;n++)await tx`INSERT INTO payments(id,invoice_id,amount,created_at,method,reversed_at) VALUES (${uuidv7()},${invoice.id},1,'2026-01-01T12:00:00.000Z','cash',${n===1?'2026-01-02T12:00:00.000Z':null})`;});
  const [key]=await db.read(tx=>tx`SELECT value FROM settings WHERE key='receipt-signature-key'`);
  let reads=0;const original=db.read.bind(db);
  db.read=fn=>original(tx=>fn(new Proxy(tx,{apply(target,self,args){if(args[0].join('').includes('receipt-signature-key'))reads++;return Reflect.apply(target,self,args);}})));
  const portal=await service.portalData(portal_link.token);
  assert.equal(reads,1);assert.equal(portal.payments.length,100);
  for(const p of portal.payments)assert.equal(p.signature,createHmac('sha256',key.value).update(JSON.stringify([p.id,p.amount,p.period,p.created_at,p.actor||null])).digest('hex'));
  assert.equal(portal.invoices[0].paid_total,99);
}));

test('optimización: secciones conservan saldos, paginación y alcance',()=>fixture(async(db,service)=>{
  await service.createPlan({name:'Plan',down:50,up:10,price:100});
  const [plan]=await db.read(tx=>tx`SELECT id FROM plans LIMIT 1`);
  await service.createCustomer({apartment:'101',plan_id:plan.id});
  await service.generateBilling({period:'2026-01',due:'2026-01-10'});
  const [invoice]=await db.read(tx=>tx`SELECT id FROM invoices LIMIT 1`);
  await service.pay({id:invoice.id,amount:25,method:'cash'});
  const [firstBuilding]=await db.read(tx=>tx`SELECT id FROM buildings ORDER BY id LIMIT 1`);
  const full=await service.snapshot({building_id:firstBuilding.id});
  const billing=await service.snapshot({building_id:firstBuilding.id,section:'billing'});
  assert.deepEqual(billing.invoices,full.invoices);assert.deepEqual(billing.pagination.invoices,full.pagination.invoices);
  assert.deepEqual(billing.customers,[]);assert.deepEqual(billing.payments,[]);assert.deepEqual(billing.events,[]);
  assert.deepEqual((await service.snapshot({building_id:firstBuilding.id,section:'payments'})).payments,full.payments);
  assert.deepEqual((await service.snapshot({building_id:firstBuilding.id,section:'overview'})).summary,full.summary);
  const second=await service.createBuilding({name:'Otro',address:'Otro'});
  const bid=second.id;
  await db.write(async tx=>{
    await tx`INSERT INTO users(id,username,password_hash,role,created_at) VALUES (${uuidv7()},'scoped','unused','admin','2026-01-01')`;
    await tx`INSERT INTO user_buildings(id,user_id,building_id) VALUES (${uuidv7()},(SELECT id FROM users WHERE username='scoped'),(SELECT id FROM buildings ORDER BY id LIMIT 1))`;
  });
  const [actor]=await db.read(tx=>tx`SELECT id,username,role FROM users WHERE username='scoped'`);
  await assert.rejects(()=>requestContext.run(actor,()=>service.snapshot({building_id:bid,section:'billing'})),/acceso/);
  assert.deepEqual((await requestContext.run(actor,()=>service.snapshot({section:'billing'}))).invoices,full.invoices);
}));

test('optimización: el bloqueo de negocio no bloquea diagnósticos y sigue serializando pagos',()=>fixture(async(db)=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let businessFinished=false;
  const first=db.write(async()=>{entered.resolve();await release.promise;});
  await entered.promise;
  const second=db.write(async()=>{businessFinished=true;});
  try{
    await db.writeOperational('diagnostic:fixture',tx=>tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},'task:fixture','{}')`);
    assert.equal(businessFinished,false);
  }finally{release.resolve();await Promise.all([first,second]);}
  assert.equal(businessFinished,true);
}));

test('optimización: dos instancias no adquieren la misma tarea y un token ajeno no libera el bloqueo',()=>fixture(async(db,service)=>{
  const otherDb=new DatabaseService(),other=new ManagementService(otherDb,{});
  try{
    const tokens=await Promise.all([service.acquireTask('fixture-shared'),other.acquireTask('fixture-shared')]);
    assert.equal(tokens.filter(Boolean).length,1);
    await other.releaseTask('fixture-shared','wrong-token');
    assert.equal(await service.acquireTask('fixture-shared'),null);
    await service.releaseTask('fixture-shared',tokens.find(Boolean));
    const token=await other.acquireTask('fixture-shared');assert.ok(token);
    await other.releaseTask('fixture-shared',token);
  }finally{await otherDb.onModuleDestroy();}
}));

test('optimización: red lenta no retrasa respaldos ni duplica su ciclo; cierre espera trabajo',()=>fixture(async(db,service)=>{
  await new AuthService(db).setup({username:'owner',password:'fixture-password'});
  await service.saveSettings({...await service.settings(),backup_hours:1});
  const networkEntered=Promise.withResolvers(),release=Promise.withResolvers(),backupDone=Promise.withResolvers();
  let networkCalls=0,backups=0;
  service.processQueue=async()=>{networkCalls++;networkEntered.resolve();await release.promise;};
  const scheduler=new OverdueScheduler(service,db,{}, {create:async()=>{backups++;backupDone.resolve();}});
  const tick=scheduler.tick();
  try{
    await networkEntered.promise;await backupDone.promise;
    await scheduler.tick();assert.equal(networkCalls,1);assert.equal(backups,1);
    let closed=false;const closing=scheduler.onModuleDestroy().then(()=>{closed=true;});
    await Promise.resolve();assert.equal(closed,false);
    release.resolve();await closing;await tick;
    await scheduler.tick();assert.equal(networkCalls,1);
  }finally{release.resolve();await tick;await scheduler.onModuleDestroy();}
}));
