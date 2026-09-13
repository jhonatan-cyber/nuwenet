import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {arrisPlan,reconcileArris,withArrisLock} from '../apps/api/dist/routers/adapters/arris-controls.js';
import {ArrisAdapter} from '../apps/api/dist/routers/adapters/arris.adapter.js';

const ip='192.168.0.20';
function fixture(initial=[]){
  let rows=structuredClone(initial),next=100;const writes=[];
  return {writes,rows:()=>rows,driver:{
    list:async()=>structuredClone(rows),
    add:async row=>{writes.push(['add',row.tag]);rows.push({...row,key:String(next++)});},
    remove:async row=>{writes.push(['remove',row.tag]);rows=rows.filter(r=>r.key!==row.key);},
    apply:async()=>{writes.push(['apply']);},
  }};
}
test('ARRIS rules are idempotent and reactivation preserves parental, other clients and external rules',async()=>{
  const suspend=arrisPlan('suspend',{ip});
  const external={...suspend.filters[0],tag:'External administrator rule',key:'1'};
  const parent={...arrisPlan('parental_control',{ip,schedule:'8h-12h,mon'}).filters[0],key:'2'};
  const other={...arrisPlan('suspend',{ip:'192.168.0.21'}).filters[0],key:'3'};
  const f=fixture([external,parent,other]);await reconcileArris(f.driver,suspend);assert.equal(f.rows().length,4);
  const count=f.writes.length;await reconcileArris(f.driver,suspend);assert.equal(f.writes.length,count);
  await reconcileArris(f.driver,arrisPlan('reactivate',{ip}));assert.deepEqual(f.rows(),[external,parent,other]);
});
test('ARRIS filters remove exactly the requested ports and validate scope before writing',async()=>{
  const f=fixture();await reconcileArris(f.driver,arrisPlan('firewall',{ip,target:'tcp:80'}));await reconcileArris(f.driver,arrisPlan('firewall',{ip,target:'udp:53'}));
  await reconcileArris(f.driver,arrisPlan('firewall',{ip,target:'tcp:80',remove:true}));assert.equal(f.rows().length,1);assert.equal(f.rows()[0].start,53);assert.equal(f.rows()[0].protocol,0);
  for(const target of ['example.com','192.168.0.1','tcp:0','both:90-80','udp:65536'])assert.throws(()=>arrisPlan('firewall',{ip,target}));
  assert.throws(()=>arrisPlan('suspend',{ip:'8.8.8.8'}));
});
test('ARRIS overnight schedules rotate days, including Saturday to Sunday',()=>{
  const plan=arrisPlan('parental_control',{ip,schedule:'22h-7h,sat'});
  assert.equal(plan.filters.length,2);assert.equal(plan.filters[0].tod&127,64);assert.equal(plan.filters[1].tod&127,1);
  assert.equal((plan.filters[0].tod>>>7)&(1<<22),1<<22);assert.equal((plan.filters[1].tod>>>7)&127,127);
  assert.equal(arrisPlan('parental_control',{ip,schedule:'off'}).filters.length,0);
  for(const schedule of ['24h-7h,mon','8h-8h,mon','8h-25h,mon','8h-12h','8:30-12:00,mon'])assert.throws(()=>arrisPlan('parental_control',{ip,schedule}));
});
test('ARRIS rejects mismatched readback and retains old restrictions if replacement is rejected',async()=>{
  const old={...arrisPlan('parental_control',{ip,schedule:'8h-12h,mon'}).filters[0],key:'1'};
  const f=fixture([old]);f.driver.add=async()=>{throw new Error('Device rejected write');};
  await assert.rejects(reconcileArris(f.driver,arrisPlan('parental_control',{ip,schedule:'9h-13h,mon'})),/parciales/);assert.deepEqual(f.rows(),[old]);
  const ignored={list:async()=>[],add:async()=>{},remove:async()=>{},apply:async()=>{}};
  await assert.rejects(reconcileArris(ignored,arrisPlan('suspend',{ip})),/no confirmó/);
});
test('ARRIS serializes device access and never advertises unsupported speed control',async()=>{
  const target={host:'192.168.0.1',port:80,protocol:'http',diagnostic_host:null};let release;
  const first=withArrisLock(target,()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(withArrisLock(target,async()=>{}),/ocupado/);release();await first;await withArrisLock(target,async()=>{});
  const adapter=new ArrisAdapter();assert.equal(adapter.description.capabilities.speed_limit,false);assert.equal(adapter.description.capabilities.firewall,true);
});
