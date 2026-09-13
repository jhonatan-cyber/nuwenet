import { BadGatewayException, Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { readCapabilities, type RouterActionTarget, type RouterAdapter, type RouterCredentials, type RouterSnapshot, type RouterTarget } from '../router.types';
import { routerOrigin, validateRouterHost } from '../router-network';
import { parseArrisClients, parseArrisStatus } from './arris-parser';
import { applyArrisPlan, arrisPlan, arrisScheduleLabel, readArrisFilters, withArrisLock } from './arris-controls';

@Injectable()
export class ArrisAdapter implements RouterAdapter {
  readonly description = {
    id: 'arris-touchstone' as const,
    name: 'ARRIS Touchstone · panel web',
    requirements: 'Panel Touchstone con usuario y contraseña. Consulta modelo, firmware, WAN, LAN, Wi-Fi y clientes. Validado en equipo real TG2492LG-NA con firmware 9.1.103HB: filtros IPv4 TCP/UDP por IP, puertos y horarios (no cubren IPv6 ni ICMP). No ofrece velocidad por dispositivo. Diagnóstico DOCSIS adicional opcional.',
    capabilities: { ...readCapabilities, suspend: true, reactivate: true, firewall: true, parental_control: true },
  };

  async inspect(target: RouterTarget, credentials: RouterCredentials): Promise<RouterSnapshot> {
    return withArrisLock(target, () => this.inspectDetails(target, credentials));
  }

  suspend(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget) { return applyArrisPlan(target, credentials, arrisPlan('suspend', client)); }
  reactivate(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget) { return applyArrisPlan(target, credentials, arrisPlan('reactivate', client)); }
  firewall(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget) { return applyArrisPlan(target, credentials, arrisPlan('firewall', client)); }
  parental(target: RouterTarget, credentials: RouterCredentials, client: RouterActionTarget) { return applyArrisPlan(target, credentials, arrisPlan('parental_control', client)); }

  private async inspectDetails(target: RouterTarget, credentials: RouterCredentials): Promise<RouterSnapshot> {
    const origin = routerOrigin(target);
    if (target.diagnostic_host) validateRouterHost(target.diagnostic_host);
    const diagnostic = target.diagnostic_host ? `http://${target.diagnostic_host}` : null;
    const allowed = new Set([new URL(origin).origin, ...(diagnostic ? [diagnostic] : [])]);
    const browser = await chromium.launch({
      headless: true, timeout: 20000,
      ...(process.env.ROUTER_BROWSER_CHANNEL ? { channel: process.env.ROUTER_BROWSER_CHANNEL } : {}),
    });
    const watchdog = setTimeout(() => { void browser.close(); }, 180000);
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.route('**/*', route => allowed.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(45000);
      page.setDefaultNavigationTimeout(30000);
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.locator('#UserName').waitFor();
      await page.locator('#UserName').fill(credentials.username);
      await page.locator('#Password').fill(credentials.password);
      // Only submit authentication. Never click Apply, reboot or configuration controls.
      await page.locator('input[type="button"]').first().click();
      try { await page.waitForFunction(() => Boolean(document.querySelector('a[href="?util_status"]')) && !document.querySelector('#UserName')); }
      catch { throw new BadGatewayException('ARRIS no permitió iniciar sesión. Verifica las credenciales y la compatibilidad del panel.'); }
      await page.goto(`${origin}/router.html?util_status`, { waitUntil: 'domcontentloaded' });
      await page.locator('#FirmwareVersion').waitFor({ state: 'attached' });
      const status = await page.evaluate(() => {
        const ids = ['FirmwareVersion','HardwareVersion','SerialNumver','WANIPAddress','WANMACAddress','WANSubnetMask','ConnectionType','Gateway','PrimaryDNS','SecondaryDNS','TertiaryDNS','LANIPAddress','LANSubnetMask','DHCPServer','NoofLanClients'];
        for (const suffix of ['', '50']) for (const field of ['WirelessSSID','WirelessChannel','WirelessMode','MACAddress','NoofWifiClients']) ids.push(field + suffix);
        return { fields: Object.fromEntries(ids.map(id => [id, (document.getElementById(id) as HTMLInputElement | null)?.value || ''])),
          model: (window as unknown as { attrs?: { ModelName?: string } }).attrs?.ModelName || null };
      });
      const snapshot = parseArrisStatus(status.fields, status.model);
      try {
        await page.goto(`${origin}/router.html?lan_dhcp`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('tr')).some(row => {
          const cells = Array.from(row.cells).map(cell => cell.textContent?.trim().toLowerCase());
          return cells.some(v => v === 'mac address' || v === 'dirección mac') && cells.some(v => v === 'type' || v === 'tipo');
        }), undefined, { timeout: 25000 });
        const tables = await page.locator('table').evaluateAll(elements => elements.map(element => Array.from((element as HTMLTableElement).rows).slice(0, 1001).map(row => Array.from(row.cells).map(cell => (cell.textContent || '').trim().slice(0, 256)))));
        const clients = parseArrisClients(tables);
        if (clients === null) throw new Error('Unrecognized client table');
        snapshot.clients = clients;
        snapshot.notes.push('Clientes agrupados por MAC, conservando sus direcciones IPv4 e IPv6. La presencia en la tabla no es una comprobación de conectividad en tiempo real.');
      } catch {
        snapshot.notes.push('No se pudo leer la lista de clientes. El resto de la información consultada se conserva.');
      }
      if (snapshot.model === 'TG2492LG-NA' && snapshot.firmware === '9.1.103HB') {
        try {
          const rules = (await readArrisFilters(page)).filter(rule => rule.version === 1 && rule.tag.startsWith('nuwenet:'));
          snapshot.blocked = [...new Set(rules.filter(rule => rule.tag.startsWith('nuwenet:suspend:')).map(rule => rule.ip))];
          snapshot.firewallBlocks = rules.filter(rule => rule.tag.startsWith('nuwenet:firewall:')).map(rule => ({ ip: rule.ip, target: `${['udp','tcp','both'][rule.protocol]}:${rule.start}-${rule.end}` }));
          snapshot.parental = rules.filter(rule => rule.tag.startsWith('nuwenet:parental_control:')).map(rule => ({ ip: rule.ip, schedule: arrisScheduleLabel(rule.tod) }));
        } catch { snapshot.notes.push('No se pudieron consultar las reglas IPv4 administradas por NuweNet.'); }
        snapshot.notes.push('Control ARRIS: filtros IPv4 TCP/UDP por IP, puertos y horarios. No cubren IPv6 ni otros protocolos. Este firmware no ofrece límite de velocidad por dispositivo en su panel.');
      }
      if (diagnostic) {
        try {
          await page.goto(`${diagnostic}/cgi-bin/vers_cgi`, { waitUntil: 'domcontentloaded' });
          const version = await page.locator('body').innerText();
          snapshot.model = version.match(/MODEL:\s*([^\s]+)/)?.[1] || snapshot.model;
          if (!snapshot.model) throw new Error('Unrecognized diagnostic page');
          await page.goto(`${diagnostic}/cgi-bin/status_cgi`, { waitUntil: 'domcontentloaded' });
          const status = await page.locator('body').innerText();
          snapshot.uptime = status.match(/System Uptime:\s*([^\n]+)/)?.[1]?.trim() || null;
          snapshot.wan_status = status.match(/CM Status:\s*([^\n]+)/)?.[1]?.trim() || null;
          snapshot.interfaces = await page.locator('tr').evaluateAll(rows => rows.flatMap(row => {
            const cells = Array.from(row.querySelectorAll('td')).map(cell => cell.textContent?.trim() || '');
            return /^LAN Port \d+$/.test(cells[0] || '') ? [{ name: cells[0], state: cells[2] || 'unknown', speed: cells[3] || '' }] : [];
          }));
        } catch {
          snapshot.notes.push('La sesión administrativa funciona, pero no se pudo completar el diagnóstico DOCSIS. Verifica la IP de diagnóstico.');
        }
      } else snapshot.notes.push('El diagnóstico DOCSIS y el estado de los puertos físicos no están disponibles desde esta consulta del panel.');
      return snapshot;
    } finally {
      clearTimeout(watchdog);
      await browser.close();
    }
  }
}
