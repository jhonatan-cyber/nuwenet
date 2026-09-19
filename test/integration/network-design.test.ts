import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTestSchema } from '../fixtures/postgres-fixture';
import { DatabaseService } from '../../apps/api/dist/database/database.service.js';
import { ManagementService } from '../../apps/api/dist/management/management.service.js';
import { NetworkDesignService } from '../../apps/api/dist/management/network-design.service.js';
import { requestContext } from '../../apps/api/dist/common/request-context.js';
import { RoutersService } from '../../apps/api/dist/routers/routers.service.js';
import { uuidv7 } from '../../apps/api/dist/common/uuid.js';

test('network design: isolation, topology, unsupported configuration, stale review and atomic central selection', async () => {
  const pg = await createTestSchema();
  const db = new DatabaseService();
  const admin = { id: uuidv7(), role: 'superadmin', username: 'network-test' };
  const asAdmin = fn => requestContext.run(admin, fn);
  try {
    await db.onModuleInit();
    const [building] = await db.write(tx => tx`INSERT INTO buildings(id,name,created_at) VALUES (${uuidv7()},'Network test',${new Date().toISOString()}) RETURNING id`);
    const [other] = await db.write(tx => tx`INSERT INTO buildings(id,name,created_at) VALUES (${uuidv7()},'Other',${new Date().toISOString()}) RETURNING id`);
    const [router] = await db.write(tx => tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id,status) VALUES (${uuidv7()},'Central','mikrotik-rest','192.168.1.1',443,'https','never-exposed',${building.id},'connected') RETURNING id`);
    const [customer] = await db.write(tx => tx`INSERT INTO customers(id,apartment,name,building_id) VALUES (${uuidv7()},'201','Test',${building.id}) RETURNING id`);
    const service = new NetworkDesignService(db, new ManagementService(db, {}));
    const design = { nodes: [
      { id: 'provider', name: 'Provider', role: 'provider' },
      { id: 'central', name: 'Central', role: 'central', router_id: router.id },
      { id: 'switch', name: 'Switch', role: 'switch' },
      { id: 'ap', name: 'Apartment', role: 'access', customer_id: customer.id },
    ], links: [
      { from: 'provider', to: 'central', from_port: 'LAN1', to_port: 'ether1' },
      { from: 'central', to: 'switch', from_port: 'ether2', to_port: '1' },
      { from: 'switch', to: 'ap', from_port: '2', to_port: 'WAN' },
    ], services: [] };
    await assert.rejects(() => service.get(building.id), /superadministrador/);
    await assert.rejects(() => requestContext.run({ id: uuidv7(), role: 'admin', username: 'outside' }, () => service.get(building.id)), /acceso/);
    await asAdmin(async () => {
      const connections = new RoutersService(db, { get: () => ({ description: { capabilities: {} } }), list: () => [] }, { seal: () => 'sealed-fixture' });
      await connections.save({ name: 'Segundo equipo', host: '192.168.1.2', adapter: 'openwrt-ubus', port: 443, protocol: 'https', username: 'fixture', password: 'fixture', building_id: building.id });
      assert.equal((await service.get(building.id)).equipment.length, 2, 'Varios equipos administrados por edificio');
      assert.equal((await service.get(building.id)).revision, 0);
      assert.ok(!JSON.stringify(await service.get(building.id)).includes('never-exposed'));
      await assert.rejects(() => service.save(other.id, { ...design, revision: 0 }), /mismo edificio/);
      const duplicate = structuredClone(design); duplicate.links[2].from_port = '1';
      await assert.rejects(() => service.save(building.id, { ...duplicate, revision: 0 }), /puerto/);
      const cycle = structuredClone(design); cycle.links.push({ from: 'ap', to: 'provider', from_port: 'LAN', to_port: 'WAN' });
      await assert.rejects(() => service.save(building.id, { ...cycle, revision: 0 }), /ciclo/);
      let stored = await service.save(building.id, { ...design, revision: 0 });
      assert.equal(stored.revision, 1);
      await assert.rejects(() => service.save(building.id, { ...design, revision: 0 }), /cambió/);
      let review = await service.review(building.id);
      assert.equal(review.can_apply, true);
      await db.write(tx => tx`UPDATE routers SET disabled=1 WHERE id=${router.id}`);
      await assert.rejects(() => service.apply(building.id, review), /cambió/);
      assert.equal((await service.review(building.id)).can_apply, false);
      await db.write(tx => tx`UPDATE routers SET disabled=0 WHERE id=${router.id}`);
      stored = await service.save(building.id, { ...design, services: [{ customer_id: customer.id, vlan: 201, ssid: 'Dept 201' }], revision: stored.revision });
      review = await service.review(building.id);
      assert.equal(review.can_apply, false);
      assert.ok(review.blocked.some(x => x.includes('VLAN')));
      assert.ok(review.blocked.some(x => x.includes('Wi-Fi')));
      await assert.rejects(() => service.apply(building.id, review), /VLAN/);
      assert.equal((await service.get(building.id)).building.central_router_id, null);
      stored = await service.save(building.id, { ...design, revision: stored.revision });
      review = await service.review(building.id);
      const original = service.management.setBuildingCentralInTransaction.bind(service.management);
      service.management.setBuildingCentralInTransaction = async (tx, dto) => { await original(tx, dto); throw Error('rollback-fixture'); };
      await assert.rejects(() => service.apply(building.id, review), /rollback-fixture/);
      assert.equal((await service.get(building.id)).building.central_router_id, null);
      service.management.setBuildingCentralInTransaction = original;
      await service.apply(building.id, review);
      const result = await service.get(building.id);
      assert.equal(result.building.central_router_id, router.id);
      assert.deepEqual(result.published_design, design);
      assert.ok(result.published_at);
      await assert.rejects(() => service.apply(building.id, review), /cambió/);
      // Adopción: un router sin edificio queda asignado al volverse central.
      const [pool] = await db.write(tx => tx`INSERT INTO routers(id,name,adapter,host,port,protocol,credentials,building_id,status) VALUES (${uuidv7()},'Pool','mikrotik-rest','192.168.9.9',443,'https','never-exposed',NULL,'connected') RETURNING id`);
      await assert.rejects(() => connections.linkDevice(pool.id, { mac: 'AA:BB:CC:DD:EE:FF' }), /edificio/);
      await db.write(tx => service.management.setBuildingCentralInTransaction(tx, { building_id: other.id, central_router_id: pool.id }));
      const [adopted] = await db.read(tx => tx`SELECT building_id FROM routers WHERE id=${pool.id}`);
      assert.equal(adopted.building_id, other.id);
      const [adoptedBuilding] = await db.read(tx => tx`SELECT central_router_id FROM buildings WHERE id=${other.id}`);
      assert.equal(adoptedBuilding.central_router_id, pool.id);
      await assert.rejects(() => db.write(tx => service.management.setBuildingCentralInTransaction(tx, { building_id: other.id, central_router_id: router.id })), /otro edificio/);
    });
  } finally { await db.onModuleDestroy(); await pg.close(); }
});
