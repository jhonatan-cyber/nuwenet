import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { AdapterRegistry } from '../apps/api/dist/routers/adapter-registry.js';
import { RoutersService } from '../apps/api/dist/routers/routers.service.js';

test('automatic connection detects supported interfaces and never saves failed detection', async () => {
  const originalFetch = globalThis.fetch;
  const credentials = { username: 'fixture', password: 'private-fixture' };
  let page = '', selected = 'mikrotik-rest', calls = [];
  const snapshot = { manufacturer: 'Fixture', model: 'Router', firmware: '1', interfaces: [], notes: [] };
  const adapter = id => ({ description: { id }, async inspect(target, auth) {
    calls.push({ id, ...target });
    assert.deepEqual(auth, credentials);
    if (id !== selected || target.protocol !== 'http') throw new Error('Not supported');
    return snapshot;
  } });
  const registry = new AdapterRegistry(adapter('arris-touchstone'), adapter('mikrotik-rest'), adapter('openwrt-ubus'));
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, '192.168.99.1');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers, undefined);
    return new Response(page);
  };
  try {
    for (const id of ['mikrotik-rest', 'openwrt-ubus', 'arris-touchstone']) {
      selected = id; calls = []; page = id === 'arris-touchstone' ? '<title>ARRIS Touchstone</title><input id="UserName">' : '';
      const result = await registry.detect('192.168.99.1', credentials);
      assert.equal(result.adapter, id);
      assert.equal(result.target.port, 80);
      assert.equal(result.snapshot, snapshot);
      if (id === 'arris-touchstone') assert.ok(calls.every(call => call.id === id));
    }
    calls = [];
    await assert.rejects(registry.detect('8.8.8.8', credentials));
    assert.equal(calls.length, 0);
    selected = 'unsupported';
    await assert.rejects(registry.detect('192.168.99.1', credentials), error => !error.message.includes(credentials.password));
    const db = { read: async () => [] };
    const service = new RoutersService(db, registry, {});
    let saved = 0;
    service.save = async (dto, id, actual) => { saved++; assert.equal(dto.host, '192.168.99.1'); assert.equal(actual, snapshot); return { routers: [] }; };
    await assert.rejects(service.connect({ host: '192.168.99.1', ...credentials }));
    assert.equal(saved, 0);
    selected = 'arris-touchstone';
    const preview = await service.testConnection({ host: '192.168.99.1', ...credentials });
    assert.equal(preview.success, true);
    assert.equal(preview.snapshot, snapshot);
    assert.equal(saved, 0, 'Testing must not save the router');
    assert.equal('credentials' in preview, false);
    assert.equal('password' in preview, false);
    await service.testConnection({ host: '192.168.99.1', ...credentials, adapter: 'arris-touchstone', protocol: 'http', port: 80 });
    assert.equal(saved, 0);
    await assert.rejects(service.testConnection({ host: '192.168.99.1', ...credentials, adapter: 'arris-touchstone' }));
    await service.connect({ host: '192.168.99.1', ...credentials });
    assert.equal(saved, 1);
    db.read = async () => [{ id: 1 }];
    calls = [];
    await assert.rejects(service.connect({ host: '192.168.99.1', ...credentials }));
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});
