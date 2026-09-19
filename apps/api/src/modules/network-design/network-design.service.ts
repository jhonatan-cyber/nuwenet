import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TransactionSQL } from 'bun';
import { DatabaseService } from '../../database/database.service';
import { requestContext } from '../../common/request-context';
import { NetworkService } from '../network/network.service';
import { ApplyNetworkDesignDto, NetworkDesignDto, SaveNetworkDesignDto } from './network-design.dto';
import { routerCompatibility } from '../../routers/router.types';
import { uuidv7 } from '../../common/uuid';

@Injectable()
export class NetworkDesignService {
  constructor(private readonly db: DatabaseService, private readonly network: NetworkService) {}
  private async access(tx: TransactionSQL, id: string, write = false) {
    const actor = requestContext.getStore();
    if (!actor || (write && actor.role !== 'superadmin')) throw new ForbiddenException('Solo el superadministrador configura la red.');
    const [building] = await tx`SELECT id,name,central_router_id,disabled FROM buildings WHERE id=${id}`;
    if (!building || building.disabled) throw new BadRequestException('Edificio no disponible.');
    if (actor.role !== 'superadmin' && !(await tx`SELECT user_id FROM user_buildings WHERE building_id=${id} AND user_id=${actor.id}`).length) throw new ForbiddenException('Sin acceso a este edificio.');
    return building;
  }
  private async data(tx: TransactionSQL, id: string) {
    const building = await this.access(tx, id);
    const [row] = await tx`SELECT * FROM building_networks WHERE building_id=${id}`;
    const routers = await tx<{ id: string; name: string; adapter: string; host: string; port: number; protocol: string; disabled: number; status: string; last_checked: string | null; snapshot: string | null }[]>`SELECT id,name,adapter,host,port,protocol,disabled,status,last_checked,snapshot FROM routers WHERE building_id=${id} ORDER BY id`;
    const customers = await tx<{ id: string; apartment: string; name: string; plan_id: string | null; ip: string | null; plan_name: string | null; down: number | null; up: number | null }[]>`SELECT c.id,c.apartment,c.name,c.plan_id,c.ip,p.name plan_name,p.down,p.up FROM customers c LEFT JOIN plans p ON p.id=c.plan_id WHERE c.building_id=${id} AND c.archived=0 ORDER BY c.apartment,c.id`;
    const design: NetworkDesignDto = row ? JSON.parse(row.design) : { nodes: [], links: [], services: [] };
    const equipment = routers.map(router => {
      const snapshot = router.snapshot ? JSON.parse(router.snapshot) : null;
      // Nivel único compartido con la ficha del equipo (router.types).
      const compatibility = routerCompatibility(router.adapter, snapshot, router.disabled);
      return { ...router, snapshot: undefined, manufacturer: snapshot?.manufacturer, model: snapshot?.model, firmware: snapshot?.firmware,
        compatibility,
        features: { inspection: !router.disabled, central: router.adapter === 'mikrotik-rest' && !router.disabled, vlan: false, switch_ports: router.adapter === 'mikrotik-rest' && !router.disabled, wifi: false },
      };
    });
    return { building, revision: row?.revision || 0, design, published_at: row?.published_at || null,
      published_design: row?.published_design ? JSON.parse(row.published_design) as NetworkDesignDto : null, equipment, customers };
  }
  get(id: string) { return this.db.read(tx => this.data(tx, id)); }
  private validate(design: NetworkDesignDto, data: Awaited<ReturnType<NetworkDesignService['data']>>) {
    const ids = new Set<string>(), routers = new Set<string>(), ports = new Set<string>(), targets = new Set<string>();
    for (const node of design.nodes) {
      if (ids.has(node.id)) throw new BadRequestException('Identificador de equipo repetido.');
      ids.add(node.id);
      if (node.router_id) {
        if (routers.has(node.router_id)) throw new BadRequestException('Una conexión administrada no puede representar dos equipos.');
        if (!data.equipment.some(router => router.id === node.router_id)) throw new BadRequestException('La conexión administrada debe pertenecer al mismo edificio.');
        routers.add(node.router_id);
      }
      if (node.customer_id && (node.role !== 'access' || !data.customers.some(c => c.id === node.customer_id))) throw new BadRequestException('El equipo de acceso debe pertenecer a un departamento vigente del edificio.');
    }
    for (const link of design.links) {
      if (!ids.has(link.from) || !ids.has(link.to) || link.from === link.to) throw new BadRequestException('Conexión entre equipos inválida.');
      if (targets.has(link.to)) throw new BadRequestException('Cada equipo admite una entrada en este flujo.');
      targets.add(link.to);
      for (const [node, port] of [[link.from, link.from_port], [link.to, link.to_port]]) {
        const key = `${node}:${port.trim().toLowerCase()}`;
        if (ports.has(key)) throw new BadRequestException('Un puerto ya está utilizado en otra conexión.');
        ports.add(key);
      }
    }
    for (const node of design.nodes) {
      const seen = new Set<string>(); let cursor: string | undefined = node.id;
      while (cursor) {
        if (seen.has(cursor)) throw new BadRequestException('Las conexiones forman un ciclo. Revisa el cableado.');
        seen.add(cursor); cursor = design.links.find(link => link.to === cursor)?.from;
      }
    }
    const customers = new Set<string>(), vlans = new Set<number>();
    for (const service of design.services) {
      if (!data.customers.some(c => c.id === service.customer_id) || customers.has(service.customer_id)) throw new BadRequestException('Departamento inválido o repetido.');
      customers.add(service.customer_id);
      if (service.vlan && vlans.has(service.vlan)) throw new BadRequestException('Utiliza una VLAN diferente por departamento.');
      if (service.vlan) vlans.add(service.vlan);
    }
  }
  async save(id: string, dto: SaveNetworkDesignDto) {
    await this.db.write(async tx => {
      await this.access(tx, id, true);
      const data = await this.data(tx, id);
      if (data.revision !== dto.revision) throw new ConflictException('El diseño cambió. Recarga antes de guardar.');
      const design = { nodes: dto.nodes, links: dto.links, services: dto.services };
      this.validate(design, data);
      const timestamp = new Date().toISOString();
      await tx`INSERT INTO building_networks(id,building_id,revision,design,updated_at) VALUES (${uuidv7()},${id},1,${JSON.stringify(design)},${timestamp}) ON CONFLICT(building_id) DO UPDATE SET revision=building_networks.revision+1,design=excluded.design,updated_at=excluded.updated_at`;
      await tx`INSERT INTO events(id,message,actor,building_id) VALUES (${uuidv7()},'Diseño de red guardado como borrador.',${requestContext.getStore()!.username},${id})`;
    });
    return this.get(id);
  }
  private async preview(tx: TransactionSQL, id: string) {
    await this.access(tx, id, true);
    const data = await this.data(tx, id), { design } = data;
    const blocked: string[] = [], warnings: string[] = [];
    try { this.validate(design, data); } catch (error) { blocked.push((error as Error).message); }
    const central = design.nodes.filter(node => node.role === 'central');
    if (central.length !== 1) blocked.push('Selecciona exactamente un equipo de control central.');
    if (design.nodes.filter(node => node.role === 'provider').length !== 1) blocked.push('Registra un equipo de entrada del proveedor.');
    if (!design.nodes.some(node => node.role === 'switch')) blocked.push('Registra el switch de distribución.');
    const centralRouter = data.equipment.find(router => router.id === central[0]?.router_id);
    if (!centralRouter?.features.central) blocked.push('El control central requiere una conexión MikroTik habilitada de este edificio.');
    else if (centralRouter.status !== 'connected') blocked.push('Prueba correctamente la conexión del MikroTik antes de aplicar.');
    for (const node of design.nodes) {
      const incoming = design.links.find(link => link.to === node.id);
      if (node.role !== 'provider' && !incoming) blocked.push(`${node.name}: falta conectar su entrada.`);
      if (node.role === 'provider' && incoming) blocked.push('El proveedor debe ser el inicio de la red.');
      if (incoming) {
        const parent = design.nodes.find(n => n.id === incoming.from);
        const allowed = { central: ['provider'], switch: ['central', 'switch'], access: ['switch'], provider: [] };
        if (!parent || !(allowed[node.role] as string[]).includes(parent.role)) blocked.push(`${node.name}: conexión incompatible con su función.`);
      }
      if (node.role === 'access' && !node.customer_id) blocked.push(`${node.name}: asigna el departamento.`);
      if (!node.router_id) warnings.push(`${node.name}: inventario sin integración; no se modificarán sus ajustes.`);
    }
    for (const service of design.services) {
      const customer = data.customers.find(c => c.id === service.customer_id);
      if (!design.nodes.some(n => n.role === 'access' && n.customer_id === service.customer_id)) blocked.push(`Departamento ${customer?.apartment || service.customer_id}: falta el equipo de acceso.`);
      if (service.vlan) blocked.push(`Departamento ${customer?.apartment}: la configuración automática de VLAN aún no está implementada para esta cadena.`);
      if (service.ssid || service.wifi_password) blocked.push(`Departamento ${customer?.apartment}: el adaptador no permite configurar Wi-Fi.`);
    }
    const jobs = await tx`SELECT q.id FROM commands q JOIN customers c ON c.id=q.customer_id WHERE c.building_id=${id} AND q.status IN ('pending','failed','running') ORDER BY q.id`;
    if (centralRouter && centralRouter.id !== data.building.central_router_id && jobs.length) blocked.push('Resuelve las órdenes de red pendientes antes de cambiar el equipo central.');
    const fingerprint = createHash('sha256').update(JSON.stringify({ revision: data.revision, design, equipment: data.equipment, customers: data.customers, central: data.building.central_router_id, jobs })).digest('hex');
    const steps = [
      'Publicar la topología del edificio. Los puertos indicados documentan el cableado; no cambian su configuración (se gestionan desde la ficha de cada equipo MikroTik).',
      centralRouter?.id === data.building.central_router_id ? 'Conservar el MikroTik central actual.' : 'Seleccionar el MikroTik central y poner en cola la sincronización de departamentos con IP. Puede cambiar su acceso y velocidad.',
      'Conservar los planes, direcciones y configuración física actuales. No se modificarán VLAN ni Wi-Fi.',
    ];
    return { revision: data.revision, fingerprint, can_apply: data.revision > 0 && !blocked.length, blocked, warnings, steps, central_router_id: centralRouter?.id || null };
  }
  review(id: string) { return this.db.read(tx => this.preview(tx, id)); }
  async apply(id: string, dto: ApplyNetworkDesignDto) {
    return this.db.write(async tx => {
      const review = await this.preview(tx, id);
      if (review.revision !== dto.revision || review.fingerprint !== dto.fingerprint) throw new ConflictException('La red cambió desde la revisión. Vuelve a revisar antes de aplicar.');
      if (!review.can_apply) throw new BadRequestException(review.blocked.join(' ') || 'Guarda el diseño antes de aplicar.');
      if (!review.central_router_id) throw new BadRequestException('Selecciona el MikroTik central antes de aplicar.');
      const data = await this.data(tx, id);
      if (data.building.central_router_id !== review.central_router_id) await this.network.setBuildingCentralInTransaction(tx, { building_id: id, central_router_id: review.central_router_id });
      const timestamp = new Date().toISOString();
      await tx`UPDATE building_networks SET published_design=design,published_at=${timestamp},revision=revision+1,updated_at=${timestamp} WHERE building_id=${id}`;
      await tx`INSERT INTO events(id,message,actor,building_id) VALUES (${uuidv7()},'Topología publicada y equipo central seleccionado. Revisar órdenes en Control de acceso; no se configuraron VLAN ni Wi-Fi.',${requestContext.getStore()!.username},${id})`;
      return { message: 'Topología publicada. Equipo central seleccionado; consulta la sincronización en Control de acceso. No se modificaron VLAN ni Wi-Fi.', revision: data.revision + 1, published_at: timestamp };
    });
  }
}
