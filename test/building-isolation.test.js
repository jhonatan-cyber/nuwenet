import { createTestSchema } from './postgres-fixture.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

test('edificios: acceso aislado, actividad privada y formularios en el edificio seleccionado', async () => {
  const directory=mkdtempSync(path.join(tmpdir(),'nuwenet-isolation-'));
  const pg = await createTestSchema();
  const port=44000+Math.floor(Math.random()*5000), origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['apps/api/dist/main.js'],{env:{...process.env,SETUP_TOKEN:'',DB_DRIVER:'postgres',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory,BACKUP_DIR:path.join(directory,'backups')},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let cookie='', browser;
  async function api(route,body,status=200){
    const response=await fetch(`${origin}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json(); assert.equal(response.status,status,JSON.stringify(data));return data;
  }
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No inició el servidor')),30000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Salida ${code}`));});server.stdout.on('data',chunk=>{if(chunk.toString().includes('disponible')){clearTimeout(timer);resolve();}});server.stderr.resume();});
    await api('auth/setup',{username:'owner',password:'fixture-password'});
    await api('auth/login',{username:'owner',password:'fixture-password'});const ownerCookie=cookie;
    const [first]=await api('buildings');
    const second=await api('buildings',{name:'Edificio B',address:'Calle B'});
    const a=first.id,b=second.id;
    for(const bid of [a,b])await api('routers',{name:`Router ${bid}`,adapter:'mikrotik-rest',host:`192.168.${bid}.1`,port:443,protocol:'https',username:'fixture',password:'fixture',building_id:bid});
    const {routers}=await api('routers');const routerA=routers.find(r=>r.building_id===a),routerB=routers.find(r=>r.building_id===b);
    await api('auth/users',{username:'admin@example.com',password:'fixture-password',role:'admin',ci:'1234567',first_name:'Test',last_name:'Admin',address:'Calle',phone:'70000000'});
    const user=(await api('auth/users')).find(u=>u.username==='admin@example.com');
    await api('buildings/assign',{user_id:user.id,building_id:a});
    const db=pg.connect();
    try {
      for(const bid of [null,a,b]){
        await db.unsafe('INSERT INTO events(message,building_id) VALUES ($1,$2)',[`event-${bid}`,bid]);
        await db.unsafe("INSERT INTO notifications(channel,target,message,created_at,building_id) VALUES ('log',$1,$2,$3,$4)",[`phone-${bid}`,`notice-${bid}`,new Date().toISOString(),bid]);
      }
    } finally {await db.close();}
    await api('auth/login',{username:'admin@example.com',password:'fixture-password'});const adminCookie=cookie;
    assert.equal((await api('routers')).routers.length,1);
    await api(`routers/${routerA.id}`);await api(`routers/${routerB.id}`,undefined,403);
    await api(`state?building_id=${b}`,undefined,403);await api('audit',undefined,403);
    const scoped=await api('state');
    assert.ok(scoped.events.some(e=>e.message===`event-${a}`));
    assert.ok(scoped.events.every(e=>e.building_id===a));
    assert.deepEqual(scoped.notifications.map(n=>n.target),[`phone-${a}`]);
    cookie=ownerCookie;assert.ok((await api('state')).events.some(e=>e.message==='event-null'));await api('audit');
    await api('buildings/assign',{user_id:user.id,building_id:b});
    cookie=adminCookie;
    await api('plans',{name:'Ambiguous',down:10,up:5,price:10},400);
    await api('billing',{period:'2020-01',due:'2020-01-10'},400);
    // Real browser submits all three forms after selecting the second building.
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext();
    await context.addCookies([{name:'nuwenet_session',value:cookie.split('=')[1],url:origin}]);
    const page=await context.newPage();
    await page.goto(`${origin}/#plans`);
    await Promise.all([page.waitForResponse(r=>r.url().includes('/api/state?')&&new URL(r.url()).searchParams.get('building_id')===String(b)),page.locator('#building-select').selectOption(String(b))]);
    await page.waitForFunction(b=>document.querySelector('#building-select')?.value===String(b)&&document.querySelector('#plans-panel [data-action="new-plan"]'),b);
    await page.reload();await page.waitForFunction(b=>document.querySelector('#building-select')?.value===String(b),b);
    await page.locator('[data-action="new-plan"]').click();
    await page.locator('#plan-form [name="name"]').fill('Plan B');
    await page.locator('#plan-form [name="down"]').fill('50');await page.locator('#plan-form [name="up"]').fill('20');await page.locator('#plan-form [name="price"]').fill('100');
    await page.locator('#plan-form button[type="submit"]').click();await page.locator('#plan-form').waitFor({state:'hidden'});
    await page.locator('nav [data-page="customers"]').click();await page.getByRole('button',{name:'Agregar departamento',exact:true}).click();
    await page.locator('#customer-form [name="apartment"]').fill('B-101');await page.locator('#customer-form [name="name"]').fill('Titular B');
    await page.locator('#customer-form button[type="submit"]').click();
    // B5: el enlace completo se muestra una sola vez tras crear; se copia y se cierra.
    await page.getByRole('heading',{name:/nica vez/}).waitFor();
    assert.match(await page.locator('[data-portal-link]').inputValue(),/\/portal\?token=[\w-]{43}/);
    await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).first().click();await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.locator('nav [data-page="billing"]').click();await page.getByRole('button',{name:'Generar mensualidades'}).click();
    await page.getByLabel('Periodo').fill('2020-01');await page.getByLabel('Fecha de vencimiento').fill('2020-01-10');
    await page.getByRole('button',{name:'Generar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const stateB=await api(`state?building_id=${b}`),stateA=await api(`state?building_id=${a}`);
    assert.equal(stateB.plans[0].name,'Plan B');assert.equal(stateB.customers[0].apartment,'B-101');assert.equal(stateB.invoices.length,1);
    assert.equal(stateA.plans.length,0);assert.equal(stateA.customers.length,0);assert.equal(stateA.invoices.length,0);
    assert.ok(stateB.events.some(e=>e.message.includes('mensualidades generadas')));
    cookie=ownerCookie;
    await api('settings',{...stateB.settings,central_router_id:routerB.id},400);
    await api('buildings/central',{building_id:b,central_router_id:routerA.id},400);
    await api('buildings/central',{building_id:b,central_router_id:routerB.id});
    assert.equal((await api(`state?building_id=${b}`)).enforcement.state,'unverified');
    assert.equal((await api(`state?building_id=${a}`)).enforcement.state,'simulated');
    const deviceDb=pg.connect();
    const mac='AA:BB:CC:DD:EE:01';
    try {await deviceDb.unsafe("UPDATE routers SET status='connected',snapshot=$1 WHERE id=$2",[JSON.stringify({manufacturer:'Fixture',model:'Fixture',firmware:'1',interfaces:[],notes:[],clients:[{name:'Laptop B',mac,ip:'192.168.2.20',connection:'Wi-Fi',status:'reported'}]}),routerB.id]);} finally {await deviceDb.close();}
    assert.equal((await api(`state?building_id=${b}`)).enforcement.state,'real');
    assert.equal((await api('state')).settings.central_router_id,undefined);
    cookie=adminCookie;
    await api('plans',{name:'Plan A',down:10,up:5,price:10,building_id:a});
    const planA=(await api(`state?building_id=${a}`)).plans[0];
    await api('customers',{name:'Titular A',apartment:'A-101',plan_id:planA.id,building_id:a});
    const customerA=(await api(`state?building_id=${a}`)).customers[0];
    await api(`routers/${routerB.id}/devices`,{mac,customer_id:customerA.id},400);
    await api('backups',undefined,403);
    await page.locator('nav [data-page="routers"]').click();
    await page.getByRole('button',{name:'Vincular departamento'}).first().click();
    await page.getByRole('dialog').getByLabel('Departamento').selectOption(String(stateB.customers[0].id));
    await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal((await api(`routers/${routerB.id}`)).router.devices[0].customer_id,stateB.customers[0].id);
    assert.equal(await page.locator('nav [data-page="backups"]').isVisible(),false);
    const changedDb=pg.connect();
    try{await changedDb.unsafe("UPDATE routers SET snapshot=$1,status='error' WHERE id=$2",[JSON.stringify({manufacturer:'Fixture',model:'Fixture',firmware:'1',interfaces:[],notes:[],clients:[{mac,ip:'192.168.2.21'}]}),routerB.id]);}finally{await changedDb.close();}
    assert.equal((await api(`routers/${routerB.id}`)).router.devices[0].customer_id,stateB.customers[0].id);
    assert.equal((await api(`state?building_id=${b}`)).enforcement.state,'error');
    await api(`routers/${routerB.id}/devices`,{mac,customer_id:null});
    assert.equal((await api(`routers/${routerB.id}`)).router.devices.length,0);
    // Owner can reach all previously hidden operational pages.
    await context.addCookies([{name:'nuwenet_session',value:ownerCookie.split('=')[1],url:origin}]);
    const ownerPage=await context.newPage();
    const errors=[];ownerPage.on('pageerror',e=>errors.push(e.message));
    for(const section of ['settings','backups','audit']){
      await ownerPage.goto(`${origin}/#${section}`);await ownerPage.locator(`nav [data-page="${section}"].selected`).waitFor();
      if(section==='settings'){await ownerPage.locator('#operations-form').waitFor();assert.equal(await ownerPage.locator('#operations-form [name="central_router_id"]').count(),0);}
    }
    assert.deepEqual(errors,[]);
    cookie=ownerCookie;await api('buildings/central',{building_id:b,central_router_id:null});
    await api('buildings/toggle',{building_id:b,disabled:true});cookie=adminCookie;
    await api(`routers/${routerB.id}`,undefined,403);assert.equal((await api('routers')).routers.length,1);
  } finally {
    await browser?.close();if(server.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
    const resolved=realpathSync(directory);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('nuwenet-isolation-'));await pg.close(); rmSync(resolved,{recursive:true,force:true});
  }
},60000);
