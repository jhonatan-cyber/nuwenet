import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { routerContract } from './router-contract';

test('gestión, cobros, control simulado y persistencia', async () => {
  const directory = mkdtempSync(path.join(tmpdir(),'nuwenet-test-'));
  const port = 33000 + Math.floor(Math.random()*10000);
  let child;
  let cookie='';
  async function start() {
    child = spawn(process.execPath,['apps/api/dist/main.js'],{env:{...process.env,SETUP_TOKEN:'',DB_DRIVER:'sqlite',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
    let errors=''; child.stderr.on('data',c=>errors+=c);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Servidor no inició: ${errors}`)),60000);
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Salida ${code}: ${errors}`));});
      child.stdout.on('data',c=>{if(c.toString().includes('disponible')){clearTimeout(timer);resolve();}});
    });
  }
  async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
  async function request(route,body,expected=200){
    const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,body===undefined?{headers:{Cookie:cookie}}:{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    const data=await r.json(); assert.equal(r.status,expected,JSON.stringify(data));return data;
  }
  try {
    await start();
    await request('auth/setup',{username:'admin',password:'fixture-password'});
    await request('auth/login',{username:'admin',password:'fixture-password'});
    assert.equal((await request('state')).customers.length,0);
    await request('plans',{name:'Hogar',down:50,up:20,price:99.90});
    await request('plans',{name:'Error',down:-1,up:10,price:10},400);
    let s=await request('customers',{apartment:'101',name:'Ana',plan_id:1});
    assert.equal(s.customers[0].price,9990);
    await request('customers',{apartment:'101',name:'Duplicado',plan_id:1},400);
    await request('billing',{period:'2020-01',due:'2020-02-31'},400);
    await Promise.all(Array.from({length: 5}, () => request('billing',{period:'2020-01',due:'2020-01-10'})));
    s=await request('state');
    assert.equal(s.invoices.length,1);
    await request('billing',{period:'2020-02',due:'2020-02-10'});
    s=await request('overdue',{});
    assert.equal(s.customers[0].status,'suspended');
    assert.equal(s.commands.length,1);
    s=await request('pay',{id:1});
    assert.equal(s.customers[0].status,'suspended','Una cuota vencida restante impide la reactivación');
    await Promise.all(Array.from({length: 5}, () => request('pay',{id:2})));
    s=await request('state');
    assert.equal(s.events.filter(e => e.message.startsWith('Pago registrado:')).length,2);
    assert.equal(s.customers[0].status,'active');
    assert.equal(s.commands.length,2);
    const eventCount=s.events.length;
    s=await request('pay',{id:2});
    assert.equal(s.events.length,eventCount,'El pago repetido es idempotente');
    await request('access',{id:999,status:'suspended'},400);
    await request('access',{id:1,status:'invalid'},400);
    const denied=await fetch(`http://127.0.0.1:${port}/api/overdue`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});
    assert.equal(denied.status,403);
    const homepage = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(homepage.status, 200);
    const html = await homepage.text();
    assert.match(html, /Astro/);
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/_astro\/[^"]+)"/g)].map(match => match[1]);
    assert.ok(assets.length >= 2, 'Astro entrega JavaScript y CSS compilados');
    for (const asset of assets) assert.equal((await fetch(`http://127.0.0.1:${port}${asset}`)).status, 200);
    await stop();await start();
    s=await request('state');
    assert.equal(s.invoices.filter(i=>i.paid_at).length,2);
    assert.equal(s.customers.length,1);
    await routerContract(request);
  } finally {await stop();rmSync(directory,{recursive:true,force:true});}
}, 60000);
