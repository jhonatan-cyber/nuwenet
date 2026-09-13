import { connectPostgres } from '../apps/api/dist/database/postgres-config.js';
import {existsSync,readFileSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import path from 'node:path';

// Read-only inventory. Never instantiate application services or print secrets.
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'.env');
const env={};
if(existsSync(source))for(const line of readFileSync(source,'utf8').split(/\r?\n/)){
  const match=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if(!match)continue;
  let value=match[2];
  if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  else value=value.replace(/\s+#.*$/,'');
  env[match[1]]=value;
}
const fileEnv = { ...env };
Object.assign(env, process.env);
const present=key=>Boolean(env[key]?.trim());
const required=['NUWENET_PORTAL_IP','NUWENET_PUBLIC_URL','WHATSAPP_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_API_VERSION','WHATSAPP_TEMPLATE','WHATSAPP_LANGUAGE','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN'];
const report={
  checked_at:new Date().toISOString(),config_file:source,mode:'read-only',
  config:{database:env.DB_DRIVER||'postgres',host:env.HOST||'127.0.0.1',port:env.PORT||'3000',notify_channel:env.NOTIFY_CHANNEL||'log',whatsapp_send_enabled:env.WHATSAPP_SEND_ENABLED==='true',presence:Object.fromEntries(required.map(k=>[k,present(k)]))},
  shell_overrides:Object.fromEntries(['HOST','PORT','DB_DRIVER'].filter(k=>fileEnv[k]!==undefined&&process.env[k]!==undefined&&fileEnv[k]!==process.env[k]).map(k=>[k,{file:fileEnv[k],shell:process.env[k]}])),
  local_ipv4:Object.values(networkInterfaces()).flat().filter(i=>i?.family==='IPv4'&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>i.address),
  database:{},http:[],blockers:[],
};
let db;
try {
  if (report.config.database !== 'postgres') throw new Error('Motor no soportado');
  db = connectPostgres(env);
  await db.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async tx => {
    const has=async name=>Boolean((await tx`SELECT to_regclass(${name}) present`)[0].present);
      if(await has('schema_migrations')){
        const applied=new Set((await tx.unsafe('SELECT version FROM schema_migrations')).map(r=>r.version));
        const expected=Array.from({length:23},(_,i)=>i+1);
        report.database.migration=Math.max(0,...applied);
        report.database.missing_migrations=expected.filter(v=>!applied.has(v));
        if(report.database.missing_migrations.length)report.blockers.push(`Faltan migraciones: ${report.database.missing_migrations.join(', ')}.`);
      }
      if(await has('buildings'))report.database.buildings=(await tx.unsafe('SELECT id,name,central_router_id,disabled FROM buildings'));
      if(await has('routers'))report.database.routers=(await tx.unsafe("SELECT id,adapter,host,port,protocol,building_id,status,disabled,last_checked,CASE WHEN credentials IS NOT NULL AND credentials<>'' THEN 1 ELSE 0 END credentials_present FROM routers"));
      if(await has('settings'))report.database.banks=(await tx.unsafe("SELECT key,value FROM settings WHERE key LIKE 'bank:%'")).map(row=>{
        try{const bank=JSON.parse(row.value);return {building_id:Number(row.key.slice(5)),bank:bank.bank||null,holder_present:!!bank.holder,account_present:!!bank.account,qr_image_present:!!bank.qr_image,qr_text_present:!!bank.qr_text,amount_template:!!bank.qr_text?.includes('{amount}'),contact_present:!!bank.contact};}catch{return {invalid:true};}
      });
      if(await has('customers'))report.database.customers=(await tx.unsafe("SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN phone IS NOT NULL AND phone<>'' THEN 1 ELSE 0 END),0) with_phone FROM customers WHERE archived=0"))[0];
      if(await has('notifications'))report.database.notifications=(await tx.unsafe('SELECT channel,delivery_status,COUNT(*) total FROM notifications GROUP BY channel,delivery_status'));
      if(await has('settings'))report.database.receipt_key_present=!!(await tx.unsafe("SELECT key FROM settings WHERE key='receipt-signature-key'"))[0];

  });
} catch { report.blockers.push('No se pudo inspeccionar PostgreSQL. Revisa conexión, permisos y migraciones.'); }
finally { if(db) await db.close(); }
const origins=new Set([`http://127.0.0.1:${report.config.port}`,'http://127.0.0.1:4321']);
for(const origin of origins)for(const route of ['/api/auth/status','/portal/','/corte/']){
  try{const r=await fetch(origin+route,{redirect:'manual',signal:AbortSignal.timeout(3000)});report.http.push({origin,route,status:r.status});await r.body?.cancel();}
  catch{report.http.push({origin,route,reachable:false});}
}
if(['127.0.0.1','localhost','::1'].includes(report.config.host))report.blockers.push('HOST solo permite acceso local; falta una interfaz accesible para residentes.');
if(!Number.isInteger(Number(report.config.port))||Number(report.config.port)<1)report.blockers.push('El puerto configurado debe ser fijo y positivo.');
if(!present('NUWENET_PORTAL_IP')||!present('NUWENET_PUBLIC_URL'))report.blockers.push('Falta configurar IP y URL del portal de corte.');
if(!report.database.routers?.some(r=>r.adapter==='mikrotik-rest'&&!r.disabled))report.blockers.push('No hay MikroTik habilitado registrado.');
for(const building of report.database.buildings||[])if(!building.disabled){
  if(!building.central_router_id)report.blockers.push(`Edificio ${building.id}: falta asignar MikroTik central.`);
  const bank=report.database.banks?.find(b=>b.building_id===building.id);
  if(!bank?.account_present||!bank?.holder_present||!(bank.qr_image_present||bank.qr_text_present))report.blockers.push(`Edificio ${building.id}: faltan datos bancarios y/o QR.`);
}
if(!report.config.whatsapp_send_enabled)report.blockers.push('El envío WhatsApp está deshabilitado.');
for(const key of required.filter(k=>k.startsWith('WHATSAPP_')))if(!present(key))report.blockers.push(`Falta ${key}.`);
if(!Number(report.database.customers?.total))report.blockers.push('No hay departamentos vigentes para validar el flujo de residente.');
console.log(JSON.stringify(report,null,2));
