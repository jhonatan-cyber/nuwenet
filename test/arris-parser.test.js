import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {parseArrisClients,parseArrisStatus} from '../apps/api/dist/routers/adapters/arris-parser.js';

test('ARRIS status keeps zero counts and missing fields distinct, excludes secrets',()=>{
  const result=parseArrisStatus({FirmwareVersion:'9.1.103HB',HardwareVersion:'10',SerialNumver:'fixture',NoofWifiClients:'0',NoofWifiClients50:'2',WirelessSSID:'Fixture WiFi',WirelessSSID50:'Fixture 5G',NoofLanClients:'1',LANIPAddress:'192.168.0.1',PrimaryDNS:'192.168.0.1',SecondaryDNS:'0.0.0.0',TertiaryDNS:'No such object',WifiPassword:'private-fixture'},'TG2492LG-NA');
  assert.equal(result.model,'TG2492LG-NA');assert.equal(result.wireless[0].clients,0);assert.equal(result.wireless[1].clients,2);assert.equal(result.lan.clients,1);assert.equal(result.wan.mac,null);assert.deepEqual(result.wan.dns,['192.168.0.1']);assert.ok(!JSON.stringify(result).includes('private-fixture'));
  assert.deepEqual(parseArrisStatus({},null).wireless,[]);assert.equal(parseArrisStatus({},null).lan.clients,null);
});

test('ARRIS clients merge IPv4/IPv6 by MAC and exclude reserved leases',()=>{
  const header=['IP Address','Name','Mac Address','Type','Expiration'];
  const result=parseArrisClients([
    [['Name','IP Address','Mac Address','Status'],['Reserved','192.168.0.99','AA:BB:CC:DD:EE:99','Enabled']],
    [header,['FE80::1234','Laptop','AA:BB:CC:DD:EE:01','Wireless24',''],['192.168.0.2','Laptop','AA:BB:CC:DD:EE:01','Wireless24',''],['192.168.0.3','unknown','AA:BB:CC:DD:EE:02','Wireless50',''],['192.168.0.4','Desktop','AA:BB:CC:DD:EE:03','Ethernet',''],['No such object','Invalid','','','']],
  ]);
  assert.equal(result.length,3);assert.equal(result[0].ip,'192.168.0.2');assert.deepEqual(result[0].addresses,['FE80::1234','192.168.0.2']);assert.equal(result[0].connection,'Wi-Fi 2,4 GHz');assert.equal(result[1].connection,'Wi-Fi 5 GHz');assert.equal(result[1].name,null);assert.equal(result[2].connection,'Ethernet');
  assert.equal(parseArrisClients([]),null);assert.deepEqual(parseArrisClients([[header]]),[]);
});
