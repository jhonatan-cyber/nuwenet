import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {forEachConcurrent} from '../common/concurrency';
import {UsageService} from './usage.service';
import { DatabaseService } from '../database/database.service';
import { RoutersService } from '../routers/routers.service';
import { BackupService } from './backup.service';
import { localDay, ManagementService } from './management.service';
import { runAsSystem } from '../common/request-context';
import { uuidv7 } from '../common/uuid';

@Injectable()
export class OverdueScheduler implements OnModuleInit,OnModuleDestroy {
  private timer:ReturnType<typeof setInterval> | null=null;
  private readonly lanes=new Map<string,Promise<void>>();
  private readonly ticks=new Set<Promise<void>>();
  private stopped=false;
  private readonly logger=new Logger(OverdueScheduler.name);
  constructor(private readonly management:ManagementService,private readonly db:DatabaseService,private readonly routers:RoutersService,private readonly backups:BackupService,@Optional() private readonly usage?:UsageService) {}
  onModuleInit() {
    this.stopped=false;
    this.timer=setInterval(()=>{void this.tick().catch(()=>this.logger.warn('No se completo la revision automatica.'));},10000);
    this.timer.unref?.();
  }
  // C5: diagnóstico por tarea en settings (`task:<nombre>` con última
  // ejecución, último éxito, duración y último error). La escritura es
  // best-effort: nunca debe fallar la tarea por no poder registrarse.
  private async recordTask(key:string,started:number,error:unknown) {
    const diagnostic={last_run:new Date(started).toISOString(),last_success:error?undefined:null,duration_ms:Date.now()-started,last_error:error instanceof Error?error.message.slice(0,300):error?String(error).slice(0,300):null};
    try {
      await this.db.writeOperational('diagnostic:'+key,async tx=>{
        const [previous]=await tx`SELECT value FROM settings WHERE key=${'task:'+key}`;
        const keep=previous?JSON.parse(previous.value):{};
        await tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},${'task:'+key},${JSON.stringify({...diagnostic,last_success:error?keep.last_success||null:diagnostic.last_run})}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      });
    } catch { /* el diagnóstico no bloquea la operación */ }
  }
  private async due(key:string,minutes:number,work:()=>Promise<unknown>) {
    if (minutes<=0) return;
    const name=`schedule:${key}`,token=await this.management.acquireTask(name,600000); if (!token) return;
    try {
      const [row]=await this.db.read(tx=>tx`SELECT value FROM settings WHERE key=${name}`);
      if (row && Date.now()-Date.parse(row.value)<minutes*60000) return;
      const started=Date.now();
      try {
        await work();
        await this.recordTask(key,started,null);
      } catch (error) { await this.recordTask(key,started,error); throw error; }
      await this.db.writeOperational('schedule:'+key,tx=>tx`INSERT INTO settings(id,key,value) VALUES (${uuidv7()},${name},${new Date().toISOString()}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    } finally { await this.management.releaseTask(name,token); }
  }
  // C1: cada trabajo directo registra diagnóstico y falla aislado, sin
  // impedir que el resto del tick continúe.
  private async timed(key:string,work:()=>Promise<unknown>) {
    const started=Date.now();
    try { await work(); await this.recordTask(key,started,null); }
    catch (error) { await this.recordTask(key,started,error); this.logger.warn(`Falló la tarea ${key}; se reintentará.`); }
  }
  private launch(name:string,work:()=>Promise<void>):Promise<void> {
    if(this.stopped||this.lanes.has(name))return Promise.resolve();
    const promise=work().catch(()=>this.logger.warn(`Fallo el ciclo ${name}; se reintentara.`)).finally(()=>{this.lanes.delete(name);});
    this.lanes.set(name,promise);return promise;
  }
  tick():Promise<void> {
    if(this.stopped)return Promise.resolve();
    const tick=runAsSystem(async()=>{
      const [users]=await this.db.read(tx=>tx`SELECT COUNT(*) count FROM users`);if(!Number(users.count)||this.stopped)return;
      const config=await this.management.settings();
      await Promise.all([
        this.launch('usage',()=>this.due('usage',1,async()=>{await this.usage?.collect();})),
        this.launch('network',async()=>{
          await this.timed('linked',()=>this.management.syncLinkedDevices());
          await this.timed('network',()=>this.management.processQueue());
        }),
        this.launch('billing',async()=>{
          // Preserve ordering of overdue review and billing within this lane.
          try{await this.due('overdue',config.overdue_minutes,()=>this.management.reviewOverdue(true));}catch{this.logger.warn('Fallo la revision de vencimientos.');}
          await this.due('billing',config.auto_billing?60:0,async()=>{
            const day=localDay();
            if(Number(day.slice(8))>=config.billing_day)await this.management.generateBilling({period:day.slice(0,7),due:`${day.slice(0,7)}-${String(config.due_day).padStart(2,'0')}`});
          });
        }),
        this.launch('backups',()=>this.due('backups',config.backup_hours*60,()=>this.backups.create())),
        this.launch('sessions',()=>this.due('sessions',60,()=>this.db.write(async tx=>{
          await tx`DELETE FROM sessions WHERE expires_at<${new Date().toISOString()}`;
          const cutoff=new Date(Date.now()-180*86400000).toISOString();
          await tx`DELETE FROM audit_log WHERE created_at<${cutoff}`;
          await tx`DELETE FROM security_events WHERE created_at<${cutoff}`;
        }))),
        this.launch('monitor',async()=>{
          if(!(config.monitor_minutes>0))return;
          const routers=await this.db.read(tx=>tx<{id:string}[]>`SELECT id FROM routers WHERE disabled=0 ORDER BY id`);
          await forEachConcurrent(routers,3,async router=>{
            try{await this.due(`router:${router.id}`,config.monitor_minutes,async()=>{await this.routers.check(router.id);});}
            catch{this.logger.warn(`Fallo el monitoreo del router #${router.id}.`);}
          });
        }),
      ]);
    });
    this.ticks.add(tick);
    void tick.finally(()=>this.ticks.delete(tick)).catch(()=>{});
    return tick;
  }
  async onModuleDestroy() {
    this.stopped=true;if(this.timer)clearInterval(this.timer);
    await Promise.allSettled([...this.ticks,...this.lanes.values()]);
  }
}
