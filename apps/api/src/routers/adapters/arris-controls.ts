import { BadGatewayException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { chromium, type Page } from 'playwright';
import { routerOrigin, validateRouterHost } from '../router-network';
import type { RouterActionTarget, RouterCredentials, RouterTarget } from '../router.types';

export interface ArrisFilter { key?: string; tag: string; ip: string; endIp: string; start: number; end: number; protocol: number; tod: number; version: number }
export interface ArrisPlan { prefix: string; filters: ArrisFilter[] }
export function arrisScheduleLabel(tod: number): string {
  const days = ['dom','lun','mar','mié','jue','vie','sáb'].filter((_day, index) => tod & (1 << index));
  const ranges: string[] = [];
  for (let h = 0; h < 24; h++) {
    if (!(tod & (1 << (h + 7)))) continue;
    const start = h;
    while (h < 23 && (tod & (1 << (h + 8)))) h++;
    ranges.push(`${String(start).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00`);
  }
  return `${days.length === 7 ? 'Todos los días' : days.join(', ')} · ${ranges.join(', ')}`;
}
const busy = new Set<string>();
export async function withArrisLock<T>(target: RouterTarget, run: () => Promise<T>): Promise<T> {
  const origin = routerOrigin(target);
  if (busy.has(origin)) throw new ConflictException('El ARRIS está ocupado. Espera a que termine la consulta o acción actual.');
  busy.add(origin);
  try { return await run(); } finally { busy.delete(origin); }
}

export function arrisPlan(action: 'suspend' | 'reactivate' | 'firewall' | 'parental_control', client: RouterActionTarget): ArrisPlan {
  validateRouterHost(client.ip);
  const kind = action === 'reactivate' ? 'suspend' : action;
  let prefix = `nuwenet:${kind}:${client.ip}:`;
  const base = { ip: client.ip, endIp: client.ip, version: 1, start: 1, end: 65535, protocol: 2, tod: 2147483647 };
  if (action === 'reactivate' || (action === 'parental_control' && client.schedule === 'off')) return { prefix, filters: [] };
  if (action === 'firewall') {
    const match = /^(tcp|udp|both):(\d{1,5})(?:-(\d{1,5}))?$/.exec(client.target || '');
    if (!match) throw new BadRequestException('ARRIS filtra puertos IPv4. Usa tcp:80, udp:53 o both:1000-2000; no admite destinos IP o dominios por cliente.');
    base.start = Number(match[2]); base.end = Number(match[3] || match[2]);
    if (base.start < 1 || base.end > 65535 || base.start > base.end) throw new BadRequestException('El rango de puertos debe estar entre 1 y 65535.');
    base.protocol = { udp: 0, tcp: 1, both: 2 }[match[1] as 'udp' | 'tcp' | 'both'];
    prefix += `${base.protocol}:${base.start}-${base.end}:`;
    if (client.remove) return { prefix, filters: [] };
  }
  if (action !== 'parental_control') return { prefix, filters: [{ ...base, tag: prefix + '0' }] };
  const match = /^(\d{1,2})h-(\d{1,2})h,(sun|mon|tue|wed|thu|fri|sat)(?:,(?:sun|mon|tue|wed|thu|fri|sat))*$/.exec(client.schedule || '');
  if (!match) throw new BadRequestException('Usa horas enteras y días, por ejemplo 22h-7h,mon,tue,wed o off para quitar el horario.');
  const from = Number(match[1]), to = Number(match[2]);
  if (from > 23 || to > 24 || from === to) throw new BadRequestException('El horario debe tener inicio entre 0 y 23 y fin entre 0 y 24, con horas distintas.');
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const mask = (client.schedule || '').split(',').slice(1).reduce((bits, day) => bits | (1 << days.indexOf(day)), 0);
  const tod = (start: number, end: number, selected: number) => {
    let hours = 0; for (let h = start; h < end; h++) hours |= 1 << h;
    return (hours << 7) | selected;
  };
  const filters = from < to ? [{ ...base, tag: prefix + '0', tod: tod(from, to, mask) }] : [
    { ...base, tag: prefix + '0', tod: tod(from, 24, mask) },
    ...(to ? [{ ...base, tag: prefix + '1', tod: tod(0, to, ((mask << 1) & 127) | (mask >> 6)) }] : []),
  ];
  return { prefix, filters };
}

export interface ArrisDriver { list(): Promise<ArrisFilter[]>; add(rule: ArrisFilter): Promise<void>; remove(rule: ArrisFilter): Promise<void>; apply(): Promise<void> }
const equal = (a: ArrisFilter, b: ArrisFilter) => ['tag','ip','endIp','start','end','protocol','tod','version'].every(key => a[key as keyof ArrisFilter] === b[key as keyof ArrisFilter]);
export async function reconcileArris(driver: ArrisDriver, plan: ArrisPlan) {
  const before = await driver.list();
  const owned = before.filter(rule => rule.tag.startsWith(plan.prefix));
  if (owned.some(rule => rule.ip !== plan.prefix.split(':')[2] || rule.endIp !== rule.ip || rule.version !== 1)) throw new ConflictException('Las reglas administradas fueron modificadas en el router. Revísalas antes de continuar.');
  if (owned.length === plan.filters.length && owned.every(rule => plan.filters.some(wanted => equal(rule, wanted)))) return;
  // Add replacements first, so a rejected new rule does not remove the previous restriction.
  // Never remove or overwrite filters created outside NuweNet.
  try {
    for (const rule of plan.filters) if (!owned.some(old => equal(old, rule))) await driver.add(rule);
    for (const rule of owned) if (!plan.filters.some(wanted => equal(rule, wanted))) await driver.remove(rule);
    await driver.apply();
  } catch {
    throw new BadGatewayException('El ARRIS interrumpió la aplicación de reglas. Puede haber cambios parciales; consulta el equipo antes de reintentar.');
  }
  const after = (await driver.list()).filter(rule => rule.tag.startsWith(plan.prefix));
  if (after.length !== plan.filters.length || !plan.filters.every(rule => after.some(actual => equal(rule, actual)))) {
    throw new BadGatewayException('El ARRIS no confirmó las reglas solicitadas. La acción puede haber quedado parcial; vuelve a consultar antes de reintentar.');
  }
}

export async function readArrisFilters(page: Page): Promise<ArrisFilter[]> {
  return page.evaluate(() => {
    const w = window as any;
    if (!w.FWIPFilterTable || !w.clearMibTableData) throw new Error('Filtros no disponibles');
    const table = w.FWIPFilterTable;
    w.clearMibTableData(table);
    const result = table.getTable([w.arFWIPFilterDesc,w.arFWIPFilterStartAddr,w.arFWIPFilterEndAddr,w.arFWIPFilterPortStart,w.arFWIPFilterPortEnd,w.arFWIPFilterProtoType,w.arFWIPFilterTOD,w.arFWIPFilterStartType], (_index: number, row: unknown[], key: string) => ({
      key: String(key), tag: String(row[0]), ip: w.hexToIp(row[1]), endIp: w.hexToIp(row[2]), start: Number(row[3]), end: Number(row[4]), protocol: Number(row[5]), tod: Number(row[6]), version: Number(row[7]),
    }));
    if (!Array.isArray(result)) throw new Error('Respuesta de filtros inválida');
    return result;
  });
}

export async function applyArrisPlan(target: RouterTarget, credentials: RouterCredentials, plan: ArrisPlan) {
  if (plan.prefix.split(':')[2] === target.host) throw new BadRequestException('No se puede filtrar la IP del propio router.');
  return withArrisLock(target, async () => {
    const origin = routerOrigin(target);
    const browser = await chromium.launch({ headless: true, timeout: 20000, ...(process.env.ROUTER_BROWSER_CHANNEL ? { channel: process.env.ROUTER_BROWSER_CHANNEL } : {}) });
    const timer = setTimeout(() => void browser.close(), 180000);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(45000);
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#UserName').fill(credentials.username); await page.locator('#Password').fill(credentials.password);
      await page.locator('input[type="button"]').first().click();
      await page.waitForFunction(() => document.querySelector('a[href="?util_status"]') && !document.querySelector('#UserName'));
      await page.goto(`${origin}/router.html?util_status`, { waitUntil: 'domcontentloaded' });
      await page.locator('#FirmwareVersion').waitFor({ state: 'attached' });
      const supported = await page.evaluate(() => (window as any).attrs?.ModelName === 'TG2492LG-NA' && (document.querySelector('#FirmwareVersion') as HTMLInputElement)?.value === '9.1.103HB');
      if (!supported) throw new UnprocessableEntityException('La escritura ARRIS está integrada para TG2492LG-NA con firmware 9.1.103HB. Este equipo necesita verificar su compatibilidad.');
      const open = async () => { await page.goto(`${origin}/router.html?firewall_ip`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => typeof (window as any).ag?.AddClientIPFilters === 'function'); };
      await open();
      await page.evaluate(ip => (window as any).validateIpOnSubnet(ip), plan.prefix.split(':')[2]);
      const driver: ArrisDriver = {
        list: () => readArrisFilters(page),
        remove: async rule => { await page.evaluate(rule => {
          const w = window as any;
          if (String(w.arFWIPFilterDesc.get(rule.key)) !== rule.tag) throw new Error('La regla cambió durante la operación');
          w.arFWIPFilterRowStatus.set(rule.key, '6');
        }, rule); },
        add: async rule => { await readArrisFilters(page); await page.evaluate(rule => {
          const w = window as any, table = w.FWIPFilterTable;
          w.validateIpOnSubnet(rule.ip);
          const key = table.findLowestFree(w.arFWIPFilterIndex, 60);
          if (!key) throw new Error('La tabla de filtros está llena');
          table.addRow(key, [w.arFWIPFilterStartType,1,w.arFWIPFilterStartAddr,w.ipToHex(rule.ip),w.arFWIPFilterEndType,1,w.arFWIPFilterEndAddr,w.ipToHex(rule.endIp),w.arFWIPFilterPortStart,rule.start,w.arFWIPFilterPortEnd,rule.end,w.arFWIPFilterProtoType,rule.protocol,w.arFWIPFilterDesc,rule.tag,w.arFWIPFilterTOD,rule.tod]);
        }, rule); await readArrisFilters(page); },
        apply: async () => { await page.evaluate(() => (window as any).MibObjects.ApplyAllSettings.set(1)); await open(); },
      };
      await reconcileArris(driver, plan);
      return 'Reglas IPv4 TCP/UDP verificadas en ARRIS. IPv6 y otros protocolos no están cubiertos.';
    } finally { clearTimeout(timer); await browser.close(); }
  });
}
