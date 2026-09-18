import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import type { RoutersService } from '../routers/routers.service';
import type { RouterSnapshot } from '../routers/router.types';
import { uuidv7 } from '../common/uuid';
import { validateRouterHost } from '../routers/router-network';

// The worker calls this only after checking the customer's building and central.
export async function controlDepartment(db: DatabaseService, routers: RoutersService, customerId:string, job:{routerId:string|null;ip:string|null;status:string;down:number;up:number;previous?:{routerId:string;ip:string}}) {
  const links=await db.read(tx=>tx<{mac:string;router_id:string}[]>`SELECT mac,router_id FROM customer_devices WHERE customer_id=${customerId}`);
  let clients:NonNullable<RouterSnapshot['clients']>=[];
  if(job.routerId && links.length){
    if(links.some(l=>l.router_id!==job.routerId))throw new BadRequestException('Hay dispositivos vinculados a un router que no es el central.');
    const result=await routers.check(job.routerId);
    if(!result.success)throw new BadRequestException('No se pudo actualizar la IP de los dispositivos vinculados.');
    clients=result.router.snapshot?.clients || [];
  }
  const desired=new Set<string>();
  if(job.routerId && job.ip)desired.add(job.ip);
  for(const link of links){
    const candidates=clients.filter(c=>c.mac?.toUpperCase()===link.mac && (!c.status||['bound','active','reported','connected'].includes(c.status.toLowerCase())));
    for(const client of candidates)if(client.ip && !client.ip.includes(':'))desired.add(client.ip);
  }
  const prior=await db.read(tx=>tx<{router_id:string;ip:string}[]>`SELECT router_id,ip FROM customer_network_targets WHERE customer_id=${customerId}`);
  if(job.previous && !prior.some(p=>p.router_id===job.previous!.routerId&&p.ip===job.previous!.ip))prior.push({router_id:job.previous.routerId,ip:job.previous.ip});
  await db.write(async tx=>{
    const [customer]=await tx`SELECT building_id FROM customers WHERE id=${customerId}`;
    for(const target of prior){const [r]=await tx`SELECT building_id FROM routers WHERE id=${target.router_id}`;if(!r||r.building_id!==customer.building_id)throw new BadRequestException('No se pueden limpiar reglas de otro edificio.');}
    for(const ip of desired){
      validateRouterHost(ip);
      const [primary]=await tx`SELECT id FROM customers WHERE building_id=${customer.building_id} AND ip=${ip} AND id<>${customerId}`;
      const [owner]=await tx`SELECT customer_id FROM customer_network_targets WHERE router_id=${job.routerId} AND ip=${ip} AND customer_id<>${customerId}`;
      const reported=clients.filter(c=>c.ip===ip&&c.mac).map(c=>c.mac!.toUpperCase());
      const otherLinks=await tx<{mac:string}[]>`SELECT mac FROM customer_devices WHERE router_id=${job.routerId} AND customer_id<>${customerId}`;
      if(primary||owner||reported.some(mac=>otherLinks.some(l=>l.mac===mac)||(ip!==job.ip&&!links.some(l=>l.mac===mac))))throw new BadRequestException('Conflicto de IP: la dirección está asociada a otro dispositivo o departamento.');
    }
  });
  for(const target of prior)if(target.router_id!==job.routerId || !desired.has(target.ip)){
    await routers.releaseClient(target.router_id,target.ip);
  }
  for(const routerId of new Set(prior.map(p=>p.router_id)))if(routerId!==job.routerId)await routers.departmentSpeed(routerId,customerId,[],job.down,job.up);
  if(job.routerId){
    // Remember intended writes before touching hardware, including partial failures.
    await db.write(async tx=>{for(const ip of desired)await tx`INSERT INTO customer_network_targets(id,router_id,ip,customer_id) VALUES (${uuidv7()},${job.routerId},${ip},${customerId}) ON CONFLICT(router_id,ip) DO NOTHING`;});
    for(const ip of desired)await routers.action(job.routerId,{action:job.status==='active'?'reactivate':'suspend',ip},true);
    await routers.departmentSpeed(job.routerId,customerId,[...desired],job.down,job.up);
  }
  await db.write(async tx=>{for(const target of prior)if(target.router_id!==job.routerId||!desired.has(target.ip))await tx`DELETE FROM customer_network_targets WHERE router_id=${target.router_id} AND ip=${target.ip} AND customer_id=${customerId}`;});
  if(job.routerId && links.length && !desired.size)throw new BadRequestException('Sin direcciones IPv4 activas para los dispositivos vinculados. Actualiza la conexión.');
  return Boolean(job.routerId&&desired.size);
}
