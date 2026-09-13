import type { TransactionSQL } from 'bun';
import { SettingsDto, StateQuery } from './dto';
import { notificationChannel,whatsappConfig } from './notifier.service';
export const PAGE_SIZE=25;

export async function readSnapshot(tx: TransactionSQL, settings: SettingsDto, query: StateQuery, database: string) {
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/La_Paz'});
  const startDate=new Date(`${today.slice(0,7)}-01T00:00:00-04:00`), start=startDate.toISOString();
  startDate.setUTCMonth(startDate.getUTCMonth()+1); const end=startDate.toISOString();
  const filter=`%${(query.search || '').toLowerCase().replace(/[!%_]/g,'!$&')}%`, archived=query.archived==='1'?1:0;
  const cp=query.customer_page || 1, ip=query.invoice_page || 1, pp=query.payment_page || 1, cid=query.customer_id || 0;
  const bid=query.building_id || 0;
  const [counts]=await tx`SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) active FROM customers WHERE archived=0 AND (${bid}=0 OR building_id=${bid})`;
  const [debt]=await tx`SELECT COALESCE(SUM(i.amount-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.reversed_at IS NULL),0)),0) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.paid_at IS NULL AND i.due<${today} AND (${bid}=0 OR c.building_id=${bid})`;
  const [paid]=await tx`SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.reversed_at IS NULL AND p.created_at>=${start} AND p.created_at<${end} AND (${bid}=0 OR c.building_id=${bid})`;
  const [customerCount]=await tx`SELECT COUNT(*) total FROM customers WHERE archived=${archived} AND (${bid}=0 OR building_id=${bid}) AND (LOWER(apartment) LIKE ${filter} ESCAPE '!' OR LOWER(name) LIKE ${filter} ESCAPE '!')`;
  const [invoiceCount]=await tx`SELECT COUNT(*) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE (${cid}=0 OR customer_id=${cid}) AND (${bid}=0 OR c.building_id=${bid})`;
  const [paymentCount]=await tx`SELECT COUNT(*) total FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE (${cid}=0 OR i.customer_id=${cid}) AND (${bid}=0 OR c.building_id=${bid})`;
  const customers=await tx`SELECT c.*,p.name plan_name,p.down,p.up,p.price,
    (SELECT COALESCE(SUM(i.amount-COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id AND reversed_at IS NULL),0)),0) FROM invoices i WHERE i.customer_id=c.id AND i.paid_at IS NULL AND i.due<${today}) debt
    FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE c.archived=${archived} AND (${bid}=0 OR c.building_id=${bid}) AND (LOWER(c.apartment) LIKE ${filter} ESCAPE '!' OR LOWER(c.name) LIKE ${filter} ESCAPE '!') ORDER BY c.apartment,c.id LIMIT ${PAGE_SIZE} OFFSET ${(cp-1)*PAGE_SIZE}`;
  const invoices=await tx`SELECT i.*,c.apartment,c.name,COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id=i.id AND reversed_at IS NULL),0) paid_total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE (${cid}=0 OR i.customer_id=${cid}) AND (${bid}=0 OR c.building_id=${bid}) ORDER BY i.due DESC,i.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(ip-1)*PAGE_SIZE}`;
  const payments=await tx`SELECT p.*,c.apartment,i.period,u.username actor FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=p.actor_id WHERE (${cid}=0 OR i.customer_id=${cid}) AND (${bid}=0 OR c.building_id=${bid}) ORDER BY p.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(pp-1)*PAGE_SIZE}`;
  const routers=await tx`SELECT id,name,adapter,status,last_checked,disabled FROM routers WHERE (${bid}=0 OR building_id=${bid}) ORDER BY id`;
  const networks=await tx<{id:number;disabled:number;central_router_id:number|null;router_id:number|null;status:string|null;router_disabled:number|null;router_building:number|null;adapter:string|null}[]>`SELECT b.id,b.disabled,b.central_router_id,r.id router_id,r.status,r.disabled router_disabled,r.building_id router_building,r.adapter FROM buildings b LEFT JOIN routers r ON r.id=b.central_router_id WHERE (${bid}=0 OR b.id=${bid})`;
  const networkStates=networks.map(b=>({building_id:b.id,router_id:b.central_router_id,
    state:!b.central_router_id?'simulated':b.disabled||!b.router_id||b.router_disabled||b.router_building!==b.id||b.adapter!=='mikrotik-rest'||b.status==='error'?'error':b.status==='connected'?'real':'unverified'}));
  const state=networkStates.some(n=>n.state==='error')?'error':networkStates.some(n=>n.state==='unverified')?'unverified':networkStates.every(n=>n.state==='real')&&networkStates.length?'real':networkStates.some(n=>n.state==='real')?'mixed':'simulated';
  const enforcement={enforcing:networkStates.some(n=>n.state==='real'||n.state==='unverified'),mikrotik:networkStates.some(n=>n.state==='real'||n.state==='unverified'),state,buildings:networkStates,
    message:({real:'Control real configurado por edificio. Comprueba el resultado de cada orden.',error:'Hay un equipo central no disponible o una configuración inválida. Revisa el edificio y sus órdenes.',unverified:'Equipo central asignado, pendiente de comprobar conexión. Revisa el resultado de las órdenes.',mixed:'Algunos edificios tienen control real y otros funcionan en modo simulado.',simulated:'Control simulado: no hay equipo central asignado a este edificio.'})[state]};
  // C5–C6: diagnóstico de tareas automáticas y rezago de la cola de red.
  const taskRows=await tx<{key:string;value:string}[]>`SELECT key,value FROM settings WHERE key LIKE 'task:%'`;
  const tasks=taskRows.map(row=>({name:row.key.slice(5),...JSON.parse(row.value)}));
  const [backlog]=await tx`SELECT COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) pending,COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) failed,MIN(CASE WHEN status IN ('pending','failed') THEN next_attempt END) oldest FROM commands`;
  return {
    today,mode:networkStates.some(n=>n.router_id)?'mixed':'simulated',database,currency:settings.currency,settings,routers,notifyChannel:notificationChannel(),notificationsReady:Boolean(whatsappConfig()&&process.env.WHATSAPP_SEND_ENABLED==='true'),
    automation:{overdueMinutes:settings.overdue_minutes,tasks,queue:{pending:Number(backlog.pending),failed:Number(backlog.failed),oldest:backlog.oldest}},enforcement,
    summary:{customers:Number(counts.total),active:Number(counts.active),overdue:Number(debt.total),collected:Number(paid.total)},
    pagination:{size:PAGE_SIZE,customers:{page:cp,total:Number(customerCount.total)},invoices:{page:ip,total:Number(invoiceCount.total)},payments:{page:pp,total:Number(paymentCount.total)}},
    plans:await tx`SELECT p.*,(SELECT COUNT(*) FROM customers c WHERE c.plan_id=p.id AND c.archived=0 AND (${bid}=0 OR c.building_id=${bid})) customer_count FROM plans p WHERE (${bid}=0 OR p.building_id=${bid}) ORDER BY id`,
    customers,invoices,payments,
    events:await tx`SELECT * FROM events WHERE (${bid}=0 OR building_id=${bid}) ORDER BY id DESC LIMIT 40`,
    commands:await tx`SELECT q.id,q.action,q.created_at,q.mode,q.status,q.attempts,q.next_attempt,q.last_error,c.apartment FROM commands q JOIN customers c ON c.id=q.customer_id WHERE (${bid}=0 OR c.building_id=${bid}) ORDER BY q.id DESC LIMIT 40`,
    notifications:await tx`SELECT * FROM notifications WHERE (${bid}=0 OR building_id=${bid}) ORDER BY id DESC LIMIT 20`,
  };
}
