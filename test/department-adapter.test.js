import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {MikroTikAdapter} from '../apps/api/dist/routers/adapters/mikrotik.adapter.js';
import {networkError} from '../apps/api/dist/management/network-error.js';
import {BadGatewayException} from '@nestjs/common';

test('MikroTik: un límite compartido, migración de cola individual y verificación',async()=>{
  const department='01924f1e-1111-7000-8000-abcdefabcdef';
  const before=globalThis.fetch;let queues=[{'.id':'*old',name:'nuwenet-192.168.1.10',target:'192.168.1.10/32'}],rejectReadback=false;
  globalThis.fetch=async(url,init={})=>{
    if(!init.method||init.method==='GET')return Response.json(queues.map(q=>rejectReadback?{...q,'max-limit':'1M/1M'}:q));
    if(init.method==='PUT'){queues.push({'.id':'*group',...JSON.parse(init.body)});return Response.json({'.id':'*group'});}
    const id=decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if(init.method==='PATCH')queues=queues.map(q=>q['.id']===id?{...q,...JSON.parse(init.body)}:q);
    if(init.method==='DELETE')queues=queues.filter(q=>q['.id']!==id);
    return Response.json({});
  };
  try{
    const adapter=new MikroTikAdapter(),target={host:'192.168.1.1',port:443,protocol:'https'},credentials={username:'fixture',password:'fixture'};
    await adapter.departmentSpeed(target,credentials,department,['192.168.1.11','192.168.1.10'],50,10);
    assert.equal(queues.length,1);assert.equal(queues[0].target,'192.168.1.10/32,192.168.1.11/32');assert.equal(queues[0]['max-limit'],'10M/50M');
    await adapter.departmentSpeed(target,credentials,department,['192.168.1.11'],100,20);assert.equal(queues.length,1);assert.equal(queues[0]['max-limit'],'20M/100M');
    rejectReadback=true;await assert.rejects(()=>adapter.departmentSpeed(target,credentials,department,['192.168.1.11'],100,20),/no confirmó/);
    rejectReadback=false;await adapter.departmentSpeed(target,credentials,department,[],100,20);assert.equal(queues.length,0);
    assert.match(networkError(new BadGatewayException('El router rechazó las credenciales o los permisos.')),/Autenticación/);
    assert.ok(!networkError(new Error('secret-token')).includes('secret-token'));
  }finally{globalThis.fetch=before;}
});
