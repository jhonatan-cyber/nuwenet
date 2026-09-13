import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseService} from '../apps/api/dist/database/database.service.js';
import {ManagementService,localDay} from '../apps/api/dist/management/management.service.js';
import {AuthService} from '../apps/api/dist/auth/auth.service.js';
import {CredentialVault} from '../apps/api/dist/routers/credential-vault.js';
import {BackupService,verifyBackup} from '../apps/api/dist/management/backup.service.js';
import {requestContext} from '../apps/api/dist/common/request-context.js';
import {runAsSystem} from '../apps/api/dist/common/request-context.js';
import {OverdueScheduler} from '../apps/api/dist/management/scheduler.service.js';
import {NotifierService} from '../apps/api/dist/management/notifier.service.js';

async function fixture(run){
  const directory=mkdtempSync(path.join(tmpdir(),'nuwenet-reliability-'));
  const names=['DB_DRIVER','DATA_DIR','BACKUP_DIR','ROUTER_ENCRYPTION_KEY','CURRENCY','OVERDUE_CRON_MINUTES'];
  const previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  process.env.DB_DRIVER='sqlite';process.env.DATA_DIR=directory;process.env.BACKUP_DIR=path.join(directory,'backups');delete process.env.ROUTER_ENCRYPTION_KEY;process.env.CURRENCY='Bs';process.env.OVERDUE_CRON_MINUTES='0';
  const db=new DatabaseService();await db.onModuleInit();const auth=new AuthService(db);
  const calls=[];let fail=false;
  const routers={action:async(id,action)=>{calls.push({id,...action});if(fail)throw new Error('Device unavailable');},releaseClient:async(id,ip)=>{calls.push({id,ip,action:'cleanup'});if(fail)throw new Error('Device unavailable');}};
  const service=new ManagementService(db,routers,{notify:async()=>{}});
  // B7: las operaciones directas de estos tests corren como sistema explícito,
  // salvo los bloques que fijan su propio actor (p. ej. caja con admin).
  try{await runAsSystem(()=>run({db,auth,service,routers,calls,directory,setFail:value=>{fail=value;}}));}
  finally{await db.onModuleDestroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}const resolved=realpathSync(directory);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('nuwenet-reliability-'));rmSync(resolved,{recursive:true,force:true});}
}

test('departamento: varios dispositivos, límite compartido, cambio DHCP y desvinculación',()=>fixture(async({db,service,routers,calls})=>{
  const [building]=await db.read(tx=>tx`SELECT id FROM buildings ORDER BY id`);
  await db.write(tx=>tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (1,'Central','mikrotik-rest','192.168.1.1',443,'https','fixture',${building.id})`);
  await service.setBuildingCentral({building_id:building.id,central_router_id:1});
  await service.createPlan({name:'Plan',down:50,up:10,price:100});
  await service.createCustomer({name:'Titular',apartment:'101',plan_id:1,ip:'192.168.1.10'});
  await service.processQueue();calls.length=0;
  let clients=[{mac:'AA:BB:CC:DD:EE:01',ip:'192.168.1.11',status:'bound'},{mac:'AA:BB:CC:DD:EE:02',ip:'192.168.1.12',status:'bound'}];
  routers.check=async()=>({success:true,router:{snapshot:{clients}}});
  routers.departmentSpeed=async(id,customerId,ips,down,up)=>calls.push({action:'shared',id,customerId,ips,down,up});
  for(const c of clients)await db.write(tx=>tx`INSERT INTO customer_devices(router_id,mac,customer_id,created_at) VALUES (1,${c.mac},1,${new Date().toISOString()})`);
  await service.changeAccess({id:1,status:'suspended'});await service.processQueue();
  assert.deepEqual(calls.filter(c=>c.action==='suspend').map(c=>c.ip).sort(),['192.168.1.10','192.168.1.11','192.168.1.12']);
  assert.equal(calls.filter(c=>c.action==='shared').length,1);assert.equal(calls.find(c=>c.action==='shared').down,50);calls.length=0;
  clients[1].ip='192.168.1.22';await service.changeAccess({id:1,status:'active'});await service.processQueue();
  assert.ok(calls.some(c=>c.action==='cleanup'&&c.ip==='192.168.1.12'));
  assert.ok(calls.some(c=>c.action==='reactivate'&&c.ip==='192.168.1.22'));calls.length=0;
  await db.write(async tx=>{await tx`DELETE FROM customer_devices WHERE customer_id=1`;await tx`INSERT INTO customer_network_dirty(customer_id) VALUES (1)`;});
  await service.syncLinkedDevices();await service.processQueue();
  assert.deepEqual(calls.filter(c=>c.action==='cleanup').map(c=>c.ip).sort(),['192.168.1.11','192.168.1.22']);
  assert.deepEqual(calls.find(c=>c.action==='shared').ips,['192.168.1.10']);
}));

test('WhatsApp: cola, teléfono inválido, aceptación sin duplicar y reintentos',()=>fixture(async({db})=>{
  const names=['NOTIFY_CHANNEL','WHATSAPP_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE','WHATSAPP_LANGUAGE','WHATSAPP_SEND_ENABLED'];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]])),fetchBefore=globalThis.fetch;
  try{
    Object.assign(process.env,{NOTIFY_CHANNEL:'whatsapp',WHATSAPP_TOKEN:'fixture-token',WHATSAPP_PHONE_NUMBER_ID:'1234',WHATSAPP_API_VERSION:'v25.0',WHATSAPP_TEMPLATE:'fixture_notice',WHATSAPP_LANGUAGE:'es',WHATSAPP_SEND_ENABLED:'true'});
    let calls=0,reject=true;globalThis.fetch=async(url,init)=>{calls++;assert.ok(String(url).startsWith('https://graph.facebook.com/'));assert.equal(JSON.parse(init.body).type,'template');return reject?Response.json({error:{code:4}},{status:429}):Response.json({messages:[{id:'fixture-id'}]});};
    const notifier=new NotifierService(db);await notifier.notify('101','No válido');await notifier.notify('+59170000000','Recordatorio');await notifier.processQueue();
    let rows=await db.read(tx=>tx`SELECT * FROM notifications ORDER BY id`);assert.equal(rows[0].delivery_status,'blocked');assert.equal(rows[1].delivery_status,'retry');assert.equal(calls,1);
    reject=false;await db.write(tx=>tx`UPDATE notifications SET next_attempt='2000-01-01' WHERE delivery_status='retry'`);await notifier.processQueue();await notifier.processQueue();
    rows=await db.read(tx=>tx`SELECT * FROM notifications ORDER BY id`);assert.equal(rows[1].delivery_status,'accepted');assert.equal(rows[1].delivered_at,null);assert.equal(calls,2);
    assert.equal(rows[1].provider_id,'fixture-id');
    const conf=notifier.configuration();assert.equal(conf.enabled,true);assert.equal(conf.channel,'whatsapp');assert.equal(conf.phone_number_id,'1234');
    await notifier.cancel(rows[0].id);
    const [cRow]=await db.read(tx=>tx`SELECT delivery_status FROM notifications WHERE id=${rows[0].id}`);
    assert.equal(cRow.delivery_status,'cancelled');
    await notifier.retry(rows[0].id,{target:'+59171111111'});
    const [rRow]=await db.read(tx=>tx`SELECT delivery_status,target FROM notifications WHERE id=${rows[0].id}`);
    assert.equal(rRow.delivery_status,'pending');assert.equal(rRow.target,'+59171111111');
  }finally{globalThis.fetch=fetchBefore;for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}));

test('setup atómico, último administrador y cookies seguras',()=>fixture(async({auth})=>{
  const results=await Promise.allSettled([auth.setup({username:'alpha',password:'fixture-password'}),auth.setup({username:'bravo',password:'fixture-password'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await auth.userCount(),1);
  const [user]=await auth.users();await assert.rejects(()=>auth.updateUser(user.id,{role:'admin',disabled:false}),/administrador/);
  assert.match(auth.sessionCookie('token',true),/; Secure/);
  assert.deepEqual(auth.parseCookies('broken=%E0%A4%A; ok=yes'),{ok:'yes'});
}));

test('caja: abonos reales, límite mensual local, idempotencia y reversión',()=>fixture(async({db,auth,service})=>{
  const actor=await auth.setup({username:'admin',password:'fixture-password'});
  await requestContext.run(actor,async()=>{
    await service.createPlan({name:'Hogar',down:50,up:10,price:100});await service.createCustomer({apartment:'101',name:'Ana',plan_id:1});
    await service.generateBilling({period:'2020-01',due:'2020-01-10'});
    const key=randomUUID();await Promise.all([service.pay({id:1,amount:30,request_key:key}),service.pay({id:1,amount:30,request_key:key})]);
    let s=await service.snapshot();assert.equal(s.payments.length,1);assert.equal(s.summary.overdue,7000);assert.equal(s.summary.collected,3000);assert.equal(s.payments[0].actor_id,actor.id);
    const monthStart=new Date(`${localDay().slice(0,7)}-01T00:00:00-04:00`);
    const before=new Date(monthStart.getTime()-1).toISOString();
    await db.write(tx=>tx`UPDATE payments SET created_at=${before} WHERE id=1`);
    await service.pay({id:1,amount:70,method:'transfer',reference:'REF-1'});
    s=await service.snapshot();assert.equal(s.summary.collected,7000);assert.equal(s.summary.overdue,0);
    await service.reversePayment({id:2,reason:'Referencia duplicada'});
    s=await service.snapshot();assert.equal(s.summary.collected,0);assert.equal(s.summary.overdue,7000);assert.equal(s.customers[0].status,'suspended');
    assert.equal(s.payments.length,2);assert.ok(s.payments[0].reversed_at);assert.equal((await service.receipt(2)).payment.reversal_reason,'Referencia duplicada');
    await service.reversePayment({id:2,reason:'Reintento'});assert.equal((await service.snapshot()).summary.overdue,7000);
  });
}));

test('suspensión manual, archivo, edición, gracia y paginación con filtros literales',()=>fixture(async({service})=>{
  await service.createPlan({name:'Base',down:20,up:5,price:100});await service.createCustomer({apartment:'A%_1',name:'Ana',plan_id:1});
  await service.changeAccess({id:1,status:'suspended'});await service.generateBilling({period:'2020-01',due:'2020-01-10'});await service.pay({id:1});
  let s=await service.snapshot();assert.equal(s.customers[0].status,'suspended');assert.equal(s.customers[0].manual_hold,1);
  await service.updatePlan({id:1,name:'Nuevo',down:40,up:10,price:200});assert.equal((await service.snapshot()).invoices[0].amount,10000);
  await service.archiveCustomer({id:1,archived:true});await service.generateBilling({period:'2020-02',due:'2020-02-10'});
  s=await service.snapshot({archived:'1'});assert.equal(s.invoices.length,1);assert.equal(s.customers[0].archived,1);
  await service.archiveCustomer({id:1,archived:false});await service.changeAccess({id:1,status:'active'});
  for(let i=0;i<27;i++)await service.createCustomer({apartment:`B${String(i).padStart(2,'0')}`,name:'Fixture',plan_id:1});
  s=await service.snapshot();assert.equal(s.customers.length,25);assert.equal(s.pagination.customers.total,28);
  assert.equal((await service.snapshot({customer_page:2})).customers.length,3);
  assert.equal((await service.snapshot({search:'%_'})).customers.length,1);
  await service.saveSettings({...s.settings,grace_days:3});
  const yesterday=new Date(Date.parse(`${localDay()}T12:00:00Z`)-86400000).toISOString().slice(0,10);
  await service.generateBilling({period:'2021-01',due:yesterday});await service.reviewOverdue();
  assert.equal((await service.snapshot()).customers[0].status,'active');
}));

test('cola persistente: fallo, reinicio, orden de ejecución y limpieza de IP',()=>fixture(async({db,service,routers,calls,setFail})=>{
  await db.write(tx=>tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials) VALUES ('Central','mikrotik-rest','192.168.1.1',443,'https','fixture')`);
  const [building]=await db.read(tx=>tx`SELECT id FROM buildings ORDER BY id`);
  await db.write(tx=>tx`UPDATE routers SET building_id=${building.id} WHERE id=1`);
  await service.setBuildingCentral({building_id:building.id,central_router_id:1});
  await service.createPlan({name:'Hogar',down:50,up:10,price:100});await service.createCustomer({apartment:'101',name:'Ana',plan_id:1,ip:'192.168.1.10'});
  setFail(true);await service.processQueue();let s=await service.snapshot();assert.equal(s.customers[0].network_state,'failed');assert.equal(s.commands[0].attempts,1);
  await service.changeAccess({id:1,status:'suspended'});await service.setCustomerIp({id:1,ip:'192.168.1.11'});
  await assert.rejects(()=>service.createCustomer({apartment:'102',name:'Other',plan_id:1,ip:'192.168.1.10'}),/pendientes/);
  const restarted=new ManagementService(db,routers,{notify:async()=>{}});
  setFail(false);await restarted.retryCommand(1);calls.length=0;
  await Promise.all([restarted.processQueue(),service.processQueue()]);
  s=await service.snapshot();assert.equal(s.customers[0].network_state,'applied');assert.equal(s.customers[0].status,'suspended');assert.ok(s.commands.every(c=>c.status==='applied'));
  assert.deepEqual(calls.map(c=>[c.action,c.ip]),[['reactivate','192.168.1.10'],['speed_limit','192.168.1.10'],['suspend','192.168.1.10'],['cleanup','192.168.1.10'],['suspend','192.168.1.11']]);
  await service.createCustomer({apartment:'102',name:'Other',plan_id:1,ip:'192.168.1.10'});
}));

test('red por edificio: misma IP, sin herencia global y rechazo de órdenes cruzadas',()=>fixture(async({db,service,calls})=>{
  const [a]=await db.read(tx=>tx`SELECT id FROM buildings ORDER BY id`);
  const b=await service.createBuilding({name:'Segundo',address:'Calle B'});
  for(const id of [a.id,b.id])await db.write(tx=>tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id) VALUES (${id},${'Router '+id},'mikrotik-rest',${`192.168.${id}.1`},443,'https','fixture',${id})`);
  await service.setBuildingCentral({building_id:a.id,central_router_id:a.id});
  await service.createPlan({name:'A',down:50,up:10,price:100,building_id:a.id});
  await service.createPlan({name:'B',down:50,up:10,price:100,building_id:b.id});
  await service.createCustomer({apartment:'101',name:'A',plan_id:1,ip:'192.168.1.10',building_id:a.id});
  await service.createCustomer({apartment:'101',name:'B',plan_id:2,ip:'192.168.1.10',building_id:b.id});
  const [customerB]=await db.read(tx=>tx`SELECT id,network_state FROM customers WHERE building_id=${b.id}`);
  assert.equal(customerB.network_state,'simulated');
  await service.processQueue();assert.ok(calls.length);assert.ok(calls.every(c=>c.id===a.id));calls.length=0;
  await service.setBuildingCentral({building_id:b.id,central_router_id:b.id});
  await service.processQueue();assert.ok(calls.length);assert.ok(calls.every(c=>c.id===b.id));calls.length=0;
  await assert.rejects(()=>service.setBuildingCentral({building_id:b.id,central_router_id:a.id}),/otro edificio/);
  await service.changeAccess({id:customerB.id,status:'suspended'});
  await db.write(async tx=>{const [job]=await tx`SELECT id,payload FROM commands WHERE customer_id=${customerB.id} AND status='pending'`;const payload={...JSON.parse(job.payload),routerId:a.id};await tx`UPDATE commands SET payload=${JSON.stringify(payload)} WHERE id=${job.id}`;});
  await service.processQueue();assert.deepEqual(calls,[]);
  assert.equal((await db.read(tx=>tx`SELECT network_state FROM customers WHERE id=${customerB.id}`))[0].network_state,'failed');
  await assert.rejects(async()=>service.saveSettings({...await service.settings(),central_router_id:a.id}),/únicamente por edificio/);
}));

test('respaldo en línea con clave y restauración a directorio nuevo',()=>fixture(async({db,service,directory})=>{
  const vault=new CredentialVault(),sealed=vault.seal({username:'fixture',password:'private-fixture'});
  await db.write(tx=>tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials) VALUES ('Fixture','mikrotik-rest','192.168.1.1',443,'https',${sealed})`);
  await service.createPlan({name:'Respaldo',down:50,up:10,price:100});
  const backups=new BackupService(db),backup=await backups.create(),source=path.join(directory,'backups',backup.name),destination=path.join(directory,'restored');
  assert.equal(backups.list().length,1);assert.equal((await backups.verify(backup.name)).verified,true);
  const restore=spawnSync(process.execPath,['scripts/restore-backup.mjs',source,destination],{encoding:'utf8',windowsHide:true});
  assert.equal(restore.status,0,restore.stderr);assert.equal((await verifyBackup(destination)).driver,'sqlite');
  const second=spawnSync(process.execPath,['scripts/restore-backup.mjs',source,destination],{encoding:'utf8',windowsHide:true});assert.notEqual(second.status,0);
  writeFileSync(path.join(source,'router.key'),'corrupt');await assert.rejects(()=>backups.verify(backup.name),/verificación/);
}));

test('respaldos: retención protegida y copia externa verificada',()=>fixture(async({db,directory})=>{
  const keys=['BACKUP_RETENTION_DAYS','BACKUP_KEEP_MIN','BACKUP_EXTERNAL_DIR'],previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    Object.assign(process.env,{BACKUP_RETENTION_DAYS:'30',BACKUP_KEEP_MIN:'1'});delete process.env.BACKUP_EXTERNAL_DIR;
    const service=new BackupService(db),first=await service.create(),firstDir=path.join(directory,'backups',first.name);
    const manifest=JSON.parse(readFileSync(path.join(firstDir,'manifest.json'),'utf8'));manifest.created_at=new Date(Date.now()-40*86400000).toISOString();writeFileSync(path.join(firstDir,'manifest.json'),JSON.stringify(manifest));
    const external=path.join(directory,'external');mkdirSync(external);process.env.BACKUP_EXTERNAL_DIR=external;
    const second=await service.create();assert.equal(second.external_copied,true);assert.ok(second.removed.includes(first.name));assert.equal(existsSync(firstDir),false);
    await verifyBackup(path.join(external,second.name));assert.ok(existsSync(path.join(directory,'backups',second.name)));
    process.env.BACKUP_EXTERNAL_DIR=path.join(directory,'missing-volume');await assert.rejects(()=>service.create(),/externa/);
    assert.ok(existsSync(path.join(directory,'backups',second.name)),'Una copia externa fallida conserva los respaldos locales');
  }finally{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}));

test('automatización persistente: cobros, gracia, avisos, monitoreo y respaldos sin duplicados',()=>fixture(async({db,auth,service,routers})=>{
  let backupCount=0,checks=0;
  routers.check=async()=>{checks++;return {success:false,router:{name:'Fixture'}};};
  const backup={create:async()=>{backupCount++;}};
  const scheduler=new OverdueScheduler(service,db,routers,backup);
  await scheduler.tick();assert.equal(backupCount,0,'No hay operaciones automáticas durante el setup');
  await auth.setup({username:'admin',password:'fixture-password'});
  await service.createPlan({name:'Auto',down:20,up:5,price:100});await service.createCustomer({apartment:'101',name:'Ana',plan_id:1});
  await service.generateBilling({period:'2020-01',due:'2020-01-10'});
  await db.write(tx=>tx`INSERT INTO routers(name,adapter,host,port,protocol,credentials) VALUES ('Fixture','mikrotik-rest','192.168.1.1',443,'https','fixture')`);
  await service.saveSettings({...await service.settings(),auto_billing:true,billing_day:1,due_day:28,overdue_minutes:1,monitor_minutes:1,backup_hours:1,reminders_enabled:true});
  await scheduler.tick();
  const first=await service.snapshot();assert.ok(first.invoices.some(i=>i.period===localDay().slice(0,7)));assert.equal(first.customers[0].status,'suspended');assert.equal(backupCount,1);assert.equal(checks,1);
  assert.ok(first.notifications.some(n=>n.message.includes('Recordatorio')));assert.ok(first.notifications.some(n=>n.message.includes('Router Fixture')));
  await new OverdueScheduler(service,db,routers,backup).tick();const second=await service.snapshot();
  assert.equal(second.invoices.length,first.invoices.length);assert.equal(second.notifications.length,first.notifications.length);assert.equal(backupCount,1);assert.equal(checks,1);
}));
