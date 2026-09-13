import {BadRequestException, ForbiddenException, Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import type {TransactionSQL} from 'bun';
import {DatabaseService} from '../database/database.service';
import {RoutersService} from '../routers/routers.service';
import type {TrafficStat} from '../routers/router.types';
import {requestContext} from '../common/request-context';
import {splitUsage, usageDay, validCounter, USAGE_GAP_MS, USAGE_ZONE} from './usage-math';

interface Customer {id:number; building_id:number; ip:string|null; central_router_id:number|null}
interface Cursor {customer_id:number; queue_name:string; queue_id:string|null; download_bytes:number|string; upload_bytes:number|string; observed_at:string; missing:number}
interface Day {day:string; download_bytes:number|string; upload_bytes:number|string; samples:number|string; resets:number|string; gaps:number|string; estimated_bytes:number|string}

@Injectable()
export class UsageService {
  private collecting = false;
  constructor(private readonly db:DatabaseService, private readonly routers:RoutersService) {}

  async collect() {
    if(this.collecting)return;
    this.collecting=true;
    try {
      const routers=await this.db.read(tx=>tx<{id:number}[]>`SELECT DISTINCT r.id FROM routers r JOIN buildings b ON b.central_router_id=r.id AND b.id=r.building_id WHERE r.disabled=0 AND b.disabled=0 AND r.adapter='mikrotik-rest'`);
      for(const router of routers) {
        const at=new Date().toISOString();
        try {await this.record(router.id,await this.routers.getTraffic(router.id),at);}
        catch {
          await this.db.write(tx=>tx`INSERT INTO usage_router_state(router_id,last_attempt,status) VALUES (${router.id},${at},${'unavailable'}) ON CONFLICT(router_id) DO UPDATE SET last_attempt=excluded.last_attempt,status=excluded.status WHERE usage_router_state.last_attempt<excluded.last_attempt`);
        }
      }
    } finally {this.collecting=false;}
  }

  async record(routerId:number, stats:TrafficStat[], at:string) {
    const timestamp=Date.parse(at);
    if(!Number.isFinite(timestamp))throw new BadRequestException('Fecha de muestra inválida.');
    at=new Date(timestamp).toISOString();
    await this.db.write(async tx=>{
      const [router]=await tx`SELECT r.id,r.building_id FROM routers r JOIN buildings b ON b.central_router_id=r.id AND b.id=r.building_id WHERE r.id=${routerId} AND r.disabled=0 AND b.disabled=0 AND r.adapter='mikrotik-rest'`;
      if(!router)return;
      const [health]=await tx`SELECT last_attempt FROM usage_router_state WHERE router_id=${routerId}`;
      if(health && health.last_attempt>=at)return; // late/duplicate responses from another worker
      const customers=await tx<Customer[]>`SELECT c.id,c.building_id,c.ip,b.central_router_id FROM customers c JOIN buildings b ON b.id=c.building_id WHERE c.building_id=${router.building_id} AND c.archived=0`;
      const targets=await tx<{customer_id:number;ip:string}[]>`SELECT customer_id,ip FROM customer_network_targets WHERE router_id=${routerId}`;
      const previous=await tx<Cursor[]>`SELECT * FROM usage_cursors WHERE router_id=${routerId}`;
      // A disappeared queue must establish a new baseline if it returns later.
      await tx`UPDATE usage_cursors SET missing=1 WHERE router_id=${routerId}`;
      let invalid=false;
      for(const customer of customers) {
        await tx`UPDATE usage_cursors SET missing=1 WHERE customer_id=${customer.id} AND router_id<>${routerId}`;
        const shared=stats.filter(q=>q.name===`nuwenet-department-${customer.id}`);
        const ips=new Set([customer.ip,...targets.filter(t=>t.customer_id===customer.id).map(t=>t.ip)].filter(Boolean));
        // Prefer the department queue, so legacy child queues cannot double-count traffic.
        const selected=shared.length?shared:stats.filter(q=>[...ips].some(ip=>q.name===`nuwenet-${ip}`) && String(q.target||'').split(',').every(ip=>ips.has(ip.replace('/32',''))));
        for(const sample of selected) {
          if(selected.filter(q=>q.name===sample.name).length!==1){invalid=true;continue;}
          if(!validCounter(sample.downloadBytes)||!validCounter(sample.uploadBytes)){invalid=true;continue;}
          const old=previous.find(p=>Number(p.customer_id)===customer.id&&p.queue_name===sample.name);
          const changed=Boolean(old && (old.queue_id||null)!==(sample.id||null));
          const elapsed=old?timestamp-Date.parse(old.observed_at):0;
          const stale=elapsed>31*86_400_000;
          const baseline=!old||Boolean(old.missing)||changed||stale;
          const day=usageDay(timestamp);
          await this.addDay(tx,customer.id,day,0,0,1,0,0,0);
          if(baseline) {
            const kind=!old?'baseline':changed?'queue_changed':stale?'long_gap':'resumed';
            await this.event(tx,customer.id,at,kind);
            if(old)await this.addDay(tx,customer.id,day,0,0,0,0,1,0);
          } else if(elapsed>0) {
            const downReset=sample.downloadBytes<Number(old.download_bytes),upReset=sample.uploadBytes<Number(old.upload_bytes);
            const reset=downReset||upReset, gap=elapsed>USAGE_GAP_MS;
            const down=downReset?sample.downloadBytes:sample.downloadBytes-Number(old.download_bytes);
            const up=upReset?sample.uploadBytes:sample.uploadBytes-Number(old.upload_bytes);
            const parts=splitUsage(Date.parse(old.observed_at),timestamp,down,up);
            for(const part of parts)await this.addDay(tx,customer.id,part.day,part.download,part.upload,0,0,0,reset||gap||parts.length>1?part.download+part.upload:0);
            if(reset)await this.event(tx,customer.id,at,'counter_reset');
            if(gap)await this.event(tx,customer.id,at,'sampling_gap');
            await this.addDay(tx,customer.id,day,0,0,0,reset?1:0,gap?1:0,0);
          }
          await tx`INSERT INTO usage_cursors(router_id,customer_id,queue_name,queue_id,download_bytes,upload_bytes,observed_at,missing) VALUES (${routerId},${customer.id},${sample.name},${sample.id||null},${sample.downloadBytes},${sample.uploadBytes},${at},0) ON CONFLICT(router_id,customer_id,queue_name) DO UPDATE SET queue_id=excluded.queue_id,download_bytes=excluded.download_bytes,upload_bytes=excluded.upload_bytes,observed_at=excluded.observed_at,missing=0`;
        }
      }
      await tx`INSERT INTO usage_router_state(router_id,last_attempt,last_success,status) VALUES (${routerId},${at},${at},${invalid?'partial':'ok'}) ON CONFLICT(router_id) DO UPDATE SET last_attempt=excluded.last_attempt,last_success=excluded.last_success,status=excluded.status`;
    });
  }

  private async event(tx:TransactionSQL,customerId:number,at:string,kind:string) {
    await tx`INSERT INTO usage_events(customer_id,detected_at,kind) VALUES (${customerId},${at},${kind})`;
  }
  private async addDay(tx:TransactionSQL,id:number,day:string,down:number,up:number,samples:number,resets:number,gaps:number,estimated:number) {
    await tx`INSERT INTO usage_daily(customer_id,day,download_bytes,upload_bytes,samples,resets,gaps,estimated_bytes) VALUES (${id},${day},${down},${up},${samples},${resets},${gaps},${estimated}) ON CONFLICT(customer_id,day) DO UPDATE SET download_bytes=usage_daily.download_bytes+excluded.download_bytes,upload_bytes=usage_daily.upload_bytes+excluded.upload_bytes,samples=usage_daily.samples+excluded.samples,resets=usage_daily.resets+excluded.resets,gaps=usage_daily.gaps+excluded.gaps,estimated_bytes=usage_daily.estimated_bytes+excluded.estimated_bytes`;
  }

  async history(id:number|null,month?:string,token?:string) {
    month=month||usageDay(Date.now()).slice(0,7);
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new BadRequestException('Mes inválido: usa AAAA-MM.');
    if(token!==undefined && !/^[a-zA-Z0-9_-]{43}$/.test(token))throw new BadRequestException('Token inválido o departamento no encontrado.');
    return this.db.read(async tx=>{
      let customer:Customer;
      if(token!==undefined){
        const hash=createHash('sha256').update(token).digest('hex');
        const rows=await tx<(Customer & { access_expires_at: string | null })[]>`SELECT c.id,c.building_id,c.ip,b.central_router_id,c.access_expires_at FROM customers c JOIN buildings b ON b.id=c.building_id WHERE (c.access_token_hash=${hash} OR (c.access_token_hash IS NULL AND c.access_token=${token})) AND c.archived=0 AND b.disabled=0`;
        if(!rows[0] || (rows[0].access_expires_at && rows[0].access_expires_at <= new Date().toISOString()))throw new BadRequestException('Token inválido o departamento no encontrado.');customer=rows[0];
      } else {
        const actor=requestContext.getStore();
        // B7: sin actor no hay privilegios; el sistema usa SYSTEM_ACTOR.
        if(!actor || !['admin','superadmin','system'].includes(actor.role))throw new ForbiddenException('Inicia sesión como administrador.');
        const rows=await tx<Customer[]>`SELECT c.id,c.building_id,c.ip,b.central_router_id FROM customers c JOIN buildings b ON b.id=c.building_id WHERE c.id=${id}`;
        if(!rows[0])throw new BadRequestException('Departamento no encontrado.');customer=rows[0];
        if(actor.role!=='superadmin' && actor.role!=='system'){
          const allowed=await tx`SELECT b.id FROM user_buildings ub JOIN buildings b ON b.id=ub.building_id WHERE ub.user_id=${actor.id} AND b.id=${customer.building_id} AND b.disabled=0`;
          if(!allowed.length)throw new ForbiddenException('Sin acceso a este edificio.');
        }
      }
      const start=month+'-01', count=new Date(Date.UTC(Number(month!.slice(0,4)),Number(month!.slice(5,7)),0)).getUTCDate(),end=month+'-'+count;
      const stored=await tx<Day[]>`SELECT * FROM usage_daily WHERE customer_id=${customer.id} AND day>=${start} AND day<=${end} ORDER BY day`;
      const days=Array.from({length:count},(_,i)=>{
        const date=month+'-'+String(i+1).padStart(2,'0'),row=stored.find(r=>r.day===date);
        return {date,download_bytes:Number(row?.download_bytes||0),upload_bytes:Number(row?.upload_bytes||0),samples:Number(row?.samples||0),resets:Number(row?.resets||0),gaps:Number(row?.gaps||0),estimated_bytes:Number(row?.estimated_bytes||0),observed:!!row};
      });
      const totals=days.reduce((sum,day)=>({download_bytes:sum.download_bytes+day.download_bytes,upload_bytes:sum.upload_bytes+day.upload_bytes,resets:sum.resets+day.resets,gaps:sum.gaps+day.gaps,estimated_bytes:sum.estimated_bytes+day.estimated_bytes}),{download_bytes:0,upload_bytes:0,resets:0,gaps:0,estimated_bytes:0});
      const [coverage]=await tx`SELECT MIN(detected_at) first_sample FROM usage_events WHERE customer_id=${customer.id} AND kind='baseline'`;
      const [last]=await tx`SELECT MAX(observed_at) last_sample FROM usage_cursors WHERE customer_id=${customer.id}`;
      const [health]=customer.central_router_id?await tx`SELECT last_attempt,last_success,status FROM usage_router_state WHERE router_id=${customer.central_router_id}`:[];
      const until=new Date(Date.parse(end+'T00:00:00-04:00')+86_400_000).toISOString();
      const events=await tx`SELECT detected_at,kind FROM usage_events WHERE customer_id=${customer.id} AND detected_at>=${new Date(start+'T00:00:00-04:00').toISOString()} AND detected_at<${until} ORDER BY detected_at DESC LIMIT 100`;
      return {month,time_zone:USAGE_ZONE,unit:'bytes',days,totals,coverage:{first_sample:coverage?.first_sample||null,last_sample:last?.last_sample||null,router:health||{status:customer.central_router_id?'waiting':'not_configured'}},events};
    });
  }
}
