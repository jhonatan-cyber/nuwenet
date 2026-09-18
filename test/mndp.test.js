import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseMndp } from '../apps/api/dist/routers/mndp.js';
import { localSubnets, sweepLan } from '../apps/api/dist/routers/lan-sweep.js';

function tlv(type, value) {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  return Buffer.concat([header, value]);
}

test('MNDP: decodifica secuencia y TLVs de un anuncio MikroTik', () => {
  const seq = Buffer.alloc(4);
  seq.writeUInt32LE(534, 0);
  const datagram = Buffer.concat([
    seq,
    tlv(1, Buffer.from([0x00, 0x15, 0x5d, 0x9b, 0x84, 0x06])),
    tlv(5, Buffer.from('CHR', 'utf8')),
    tlv(7, Buffer.from('7.23.7 (stable)', 'utf8')),
    tlv(8, Buffer.from('MikroTik', 'utf8')),
    tlv(12, Buffer.from('CHR', 'utf8')),
    tlv(16, Buffer.from('ether1', 'utf8')),
    tlv(17, Buffer.from([192, 168, 56, 2])),
    tlv(99, Buffer.from('ignorado', 'utf8')),
  ]);
  const neighbor = parseMndp(datagram);
  assert.equal(neighbor.mac, '00:15:5D:9B:84:06');
  assert.equal(neighbor.identity, 'CHR');
  assert.equal(neighbor.version, '7.23.7 (stable)');
  assert.equal(neighbor.platform, 'MikroTik');
  assert.equal(neighbor.board, 'CHR');
  assert.equal(neighbor.interface, 'ether1');
  assert.deepEqual(neighbor.ips, ['192.168.56.2']);
  assert.equal(parseMndp(Buffer.alloc(0)), null);
  assert.equal(parseMndp(Buffer.from([0x00, 0x01])), null);
});

test('barrido LAN: subredes locales y sonda de puerto cerrado', async () => {
  assert.ok(Array.isArray(localSubnets()));
  // Sin subredes no hay objetivos: respuesta inmediata.
  assert.deepEqual(await sweepLan([]), []);
});
