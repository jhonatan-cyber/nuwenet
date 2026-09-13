import type { RouterSnapshot } from '../router.types';

// Only explicitly selected status fields are accepted, never configuration/password fields.
export function parseArrisStatus(fields: Record<string, string>, model: string | null): RouterSnapshot {
  const value = (key: string) => clean(fields[key]);
  const count = (key: string) => /^\d+$/.test(fields[key]?.trim() || '') ? Number(fields[key].trim()) : null;
  return {
    manufacturer: 'ARRIS', model: model?.trim().slice(0, 100) || null,
    firmware: value('FirmwareVersion'), hardware: value('HardwareVersion'), serial: value('SerialNumver'),
    interfaces: [], notes: ['Consulta del panel administrativo. Los datos corresponden a la última consulta.'],
    wan: { ip: value('WANIPAddress'), mac: value('WANMACAddress'), gateway: value('Gateway'), subnet: value('WANSubnetMask'), connection: value('ConnectionType'),
      dns: ['PrimaryDNS','SecondaryDNS','TertiaryDNS'].map(value).filter((v): v is string => Boolean(v) && v !== '0.0.0.0') },
    lan: { ip: value('LANIPAddress'), subnet: value('LANSubnetMask'), dhcp: value('DHCPServer'), clients: count('NoofLanClients') },
    wireless: ['', '50'].filter(suffix => ['WirelessSSID','WirelessChannel','NoofWifiClients'].some(key => value(key + suffix) !== null)).map(suffix => ({
      band: suffix ? '5 GHz' : '2,4 GHz', ssid: value('WirelessSSID' + suffix), channel: value('WirelessChannel' + suffix),
      mode: value('WirelessMode' + suffix), mac: value('MACAddress' + suffix), clients: count('NoofWifiClients' + suffix),
    })),
  };
}

const clean = (value: string | undefined) => {
  const text = value?.trim().slice(0, 256);
  return text && !/^(?:no such object|no such instance|undefined|null)$/i.test(text) ? text : null;
};
const header = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function parseArrisClients(tables: string[][][]): NonNullable<RouterSnapshot['clients']> | null {
  const clients = new Map<string, NonNullable<RouterSnapshot['clients']>[number]>();
  let recognized = false;
  for (const table of tables) {
    const start = table.findIndex(row => row.some(v => /^(ip address|direccion ip)$/.test(header(v))) && row.some(v => /^(type|tipo)$/.test(header(v))));
    if (start < 0) continue;
    const titles = table[start].map(header);
    const ipIndex = titles.findIndex(v => /^(ip address|direccion ip)$/.test(v));
    const macIndex = titles.findIndex(v => /^(mac address|direccion mac)$/.test(v));
    const nameIndex = titles.findIndex(v => /^(name|host name|nombre)$/.test(v));
    const typeIndex = titles.findIndex(v => /^(type|tipo)$/.test(v));
    if (macIndex < 0 || nameIndex < 0) continue;
    recognized = true;
    for (const row of table.slice(start + 1, start + 1001)) {
      const ip = clean(row[ipIndex]);
      const mac = clean(row[macIndex])?.toUpperCase() || null;
      if (!ip || !/^[\da-f:.]+$/i.test(ip) || !mac || !/^(?:[\dA-F]{2}:){5}[\dA-F]{2}$/.test(mac)) continue;
      const existing = clients.get(mac);
      if (existing) {
        if (!existing.addresses!.includes(ip)) existing.addresses!.push(ip);
        if (existing.ip?.includes(':') && ip.includes('.')) existing.ip = ip;
        continue;
      }
      const type = clean(row[typeIndex]);
      const connection = ({ Wireless24: 'Wi-Fi 2,4 GHz', Wireless50: 'Wi-Fi 5 GHz', Ethernet: 'Ethernet' } as Record<string, string>)[type || ''] || type;
      const name = clean(row[nameIndex]);
      clients.set(mac, { name: name && !/^unknown$/i.test(name) ? name : null, ip, addresses: [ip], mac, connection, status: 'Reportado por el router' });
    }
  }
  return recognized ? [...clients.values()].slice(0, 200) : null;
}
