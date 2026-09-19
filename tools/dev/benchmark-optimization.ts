import {mkdirSync,writeFileSync} from 'node:fs';
import {createTestSchema} from '../test/postgres-fixture.js';
import {DatabaseService} from '../../apps/api/dist/database/database.service.js';
import {ManagementService} from '../../apps/api/dist/management/management.service.js';
import {runAsSystem} from '../../apps/api/dist/common/request-context.js';

// Synthetic data lives exclusively in the fixture's temporary PostgreSQL schema.
const pg=await createTestSchema(),db=new DatabaseService();
let queries=0;
const wrap=tx=>new Proxy(tx,{apply(target,self,args){queries++;return Reflect.apply(target,self,args);}});
const measured={driver:db.driver,read:fn=>db.read(tx=>fn(wrap(tx))),write:fn=>db.write(tx=>fn(wrap(tx)))};
const service=new ManagementService(measured,{}),results=[];
async function measure(name,fn){
  const times=[];let count,size;
  for(let i=0;i<11;i++){
    queries=0;const start=performance.now(),result=await fn(),elapsed=performance.now()-start;
    if(i)times.push(elapsed);count=queries;size=Buffer.byteLength(JSON.stringify(result));
  }
  times.sort((a,b)=>a-b);
  results.push({name,queries:count,p50_ms:+times[4].toFixed(2),max_ms:+times.at(-1).toFixed(2),json_bytes:size});
}
try{
  await db.onModuleInit();
  await runAsSystem(()=>service.createPlan({name:'Benchmark',down:50,up:10,price:100}));
  const link=(await runAsSystem(()=>service.createCustomer({apartment:'pilot',name:'Benchmark',plan_id:1}))).portal_link;
  await db.write(async tx=>{
    await tx`INSERT INTO customers(apartment,name,plan_id,building_id) SELECT 'bench-'||n,'Ficticio '||n,1,1 FROM generate_series(1,999) n`;
    await tx`INSERT INTO invoices(customer_id,period,due,amount,paid_at) SELECT c.id,to_char(d,'YYYY-MM'),to_char(d+interval '9 days','YYYY-MM-DD'),10000,to_char(d,'YYYY-MM-DD') FROM customers c CROSS JOIN generate_series('2025-01-01'::date,'2025-12-01'::date,interval '1 month') d`;
    await tx`INSERT INTO payments(invoice_id,amount,created_at,method) SELECT id,10000,due||'T12:00:00.000Z','cash' FROM invoices`;
  });
  await measure('snapshot_1000_departments_12000_invoices',()=>runAsSystem(()=>service.snapshot()));
  for(const section of ['overview','customers','billing','payments','plans','network','activity','settings']){
    await measure('section_'+section,()=>runAsSystem(()=>service.snapshot({section})));
  }
  await measure('portal_12_receipts',()=>service.portalData(link.token));
  await db.write(tx=>tx`INSERT INTO payments(invoice_id,amount,created_at,method) SELECT (SELECT MIN(id) FROM invoices WHERE customer_id=1),1,'2026-01-01T12:00:00.000Z','cash' FROM generate_series(1,88)`);
  await measure('portal_100_receipts',()=>service.portalData(link.token));
  const explain=()=>db.read(tx=>tx.unsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT i.*,c.apartment,c.name,COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id AND reversed_at IS NULL),0) paid_total FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.due DESC,i.id DESC LIMIT 25'));
  await db.write(tx=>tx.unsafe('ANALYZE invoices,customers,payments'));
  // Remove the new index only in this fixture's private schema for comparison.
  await db.write(tx=>tx.unsafe('DROP INDEX IF EXISTS invoices_due_id'));
  await measure('section_billing_analyzed_without_candidate',()=>runAsSystem(()=>service.snapshot({section:'billing'})));
  const planBefore=await explain();
  await db.write(tx=>tx.unsafe('CREATE INDEX benchmark_invoice_order ON invoices(due DESC,id DESC)'));
  const planAfter=await explain();
  await measure('section_billing_with_candidate_index',()=>runAsSystem(()=>service.snapshot({section:'billing'})));
  const report={at:new Date().toISOString(),scope:'temporary synthetic schema; direct service timings; 1 warmup and 10 samples; sequential requests',results,invoice_order_index:{before:planBefore,after:planAfter}};
  mkdirSync('data',{recursive:true});writeFileSync('data/optimization-after.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(results,null,2));
  console.log('EXPLAIN plans saved in data/optimization-after.json');
}finally{await db.onModuleDestroy();await pg.close();}
