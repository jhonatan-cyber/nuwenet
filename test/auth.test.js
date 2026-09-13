import { createTestSchema } from './postgres-fixture.js';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('auth, abonos parciales, moneda y modo mixto', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-auth-'));
  const pg = await createTestSchema();
  const port = 35000 + Math.floor(Math.random() * 5000);
  let child;
  let jar = '';
  async function start() {
    child = spawn(process.execPath, ['apps/api/dist/main.js'], { env: { ...process.env, SETUP_TOKEN: '', DB_DRIVER: 'postgres', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, CURRENCY: 'Bs' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = ''; child.stderr.on('data', c => errors += c);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Servidor no inició: ${errors}`)), 60000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Salida ${code}: ${errors}`)); });
      child.stdout.on('data', c => { if (c.toString().includes('disponible')) { clearTimeout(timer); resolve(); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  async function request(route, body, expected = 200, useJar = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (useJar && jar) headers.Cookie = jar;
    const r = await fetch(`http://127.0.0.1:${port}/api/${route}`, body === undefined ? { headers: useJar && jar ? { Cookie: jar } : {} } : { method: 'POST', headers, body: JSON.stringify(body) });
    const setCookie = r.headers.get('set-cookie');
    if (setCookie) jar = setCookie.split(';')[0];
    const data = await r.json();
    assert.equal(r.status, expected, JSON.stringify(data));
    return data;
  }
  try {
    await start();
    // Modo setup: sin usuarios, la API responde sin sesión.
    await request('state', undefined, 401);
    let s;
    assert.equal((await request('auth/me')).authenticated, false);
    await request('auth/setup', { username: 'admin', password: 'corta' }, 400);
    await request('auth/setup', { username: 'admin', password: 'admin1234' });
    await request('auth/setup', { username: 'otro', password: 'otro12345' }, 400);
    // Con usuarios existentes, el anónimo queda bloqueado.
    await request('state', undefined, 401, false);
    await request('auth/login', { username: 'admin', password: 'mala' }, 401);
    const me = await request('auth/login', { username: 'admin', password: 'admin1234' });
    assert.equal(me.username, 'admin');
    s = await request('state');
    assert.equal(s.currency, 'Bs');
    assert.equal(s.automation.overdueMinutes, 0);
    assert.equal(s.mode, 'simulated');
    assert.ok(Array.isArray(s.notifications));
    assert.equal((await request('auth/me')).authenticated, true);
    // Registrar un MikroTik (sin contactarlo) activa el modo mixto.
    await request('routers', { name: 'Central', adapter: 'mikrotik-rest', host: '192.168.99.1', port: 443, protocol: 'https', username: 'u', password: 'p' });
    s = await request('state');
    assert.equal(s.mode, 'simulated', 'Registrar un router no lo convierte en central');
    s = await request('buildings/central', { building_id:s.buildings[0].id, central_router_id: s.routers[0].id });
    assert.equal(s.mode, 'mixed');
    assert.equal(s.enforcement.enforcing, true);
    // Flujo con abono parcial.
    await request('plans', { name: 'Hogar', down: 50, up: 20, price: 100 });
    await request('customers', { apartment: '101', name: 'Ana', plan_id: 1 });
    await request('billing', { period: '2020-01', due: '2020-01-10' });
    s = await request('state');
    assert.equal(s.customers.find(c => c.apartment === '101').debt, 10000);
    s = await request('pay', { id: 1, amount: 30 });
    const invoice = s.invoices.find(i => i.id === 1);
    assert.equal(invoice.paid_at, null);
    assert.equal(invoice.paid_total, 3000);
    assert.equal(s.customers.find(c => c.apartment === '101').debt, 7000);
    assert.ok(s.events.some(e => e.message.startsWith('Abono registrado:')));
    await request('pay', { id: 1, amount: 999 }, 400);
    s = await request('pay', { id: 1, amount: 70 });
    assert.ok(s.invoices.find(i => i.id === 1).paid_at);
    assert.equal(s.events.filter(e => e.message.startsWith('Pago registrado:')).length, 1);
    await request('auth/users',{username:'norte@correo.com',password:'fixture-password',role:'admin',ci:'1234567',first_name:'Norte',last_name:'Admin',address:'Calle 1',phone:'70000001'});
    const createdUsers=await request('auth/users');
    const norte=createdUsers.find(u=>u.username==='norte@correo.com');
    assert.equal(norte.first_name,'Norte');
    await request('buildings/assign',{user_id:norte.id,building_id:s.active_building_id||s.buildings[0].id});
    assert.ok((await request('audit')).some(entry=>entry.action.includes('/api/pay')&&entry.username==='admin'));
    await request('auth/login',{username:'norte@correo.com',password:'fixture-password'});
    await request('auth/users',undefined,403);
    await request('settings',s.settings,403);
    await request('buildings',{name:'Hack'},403);
    await request('routers',{name:'Hack',adapter:'mikrotik-rest',host:'192.168.99.9',port:443,protocol:'https',username:'u',password:'p'},403);
    await request('access',{id:1,status:'suspended'});
    await request('routers');
    await request('state');
    await request('auth/login',{username:'admin',password:'admin1234'});
    // Logout invalida la sesión.
    await request('auth/logout', {});
    assert.equal((await request('auth/me', undefined, 200, false)).authenticated, false);
    await request('state', undefined, 401, false);
  } finally { await stop(); await pg.close(); rmSync(directory, { recursive: true, force: true }); }
}, 60000);
