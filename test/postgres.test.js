import { test } from 'bun:test';
import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { routerContract } from './router-contract';

test.skipIf(process.env.DB_DRIVER !== 'postgres')('PostgreSQL: transacciones, concurrencia, validaciones y persistencia', async () => {
  const database = `nuwenet_test_${randomUUID().replaceAll('-', '')}`;
  const options = {
    adapter: 'postgres', hostname: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432), username: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD, ssl: process.env.PGSSLMODE || 'disable', connectionTimeout: 10,
  };
  const adminUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (adminUrl) adminUrl.pathname = '/postgres';
  const admin = adminUrl ? new SQL(adminUrl.toString()) : new SQL({ ...options, database: 'postgres' });
  let created = false;
  const children = [];
  let cookie='';
  const port = 34000 + Math.floor(Math.random() * 5000);
  const testUrl = adminUrl ? new URL(adminUrl) : null;
  if (testUrl) testUrl.pathname = `/${database}`;
  async function start(listenPort) {
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
      env: { ...process.env, SETUP_TOKEN: '', DB_DRIVER: 'postgres', PGDATABASE: database, DATABASE_URL: testUrl?.toString() || '', HOST: '127.0.0.1', PORT: String(listenPort), NOTIFY_CHANNEL:'log', WHATSAPP_SEND_ENABLED:'false', NUWENET_PORTAL_IP:'', NUWENET_PUBLIC_URL:'', OVERDUE_CRON_MINUTES:'0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('NestJS no inició con PostgreSQL.')), 30000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`NestJS terminó: ${code}`)); });
      child.stdout.on('data', data => { if (data.toString().includes('disponible')) { clearTimeout(timer); resolve(); } });
    });
    return child;
  }
  async function stop(child) {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  }
  async function request(route, body, status = 200, listenPort = port) {
    const response = await fetch(`http://127.0.0.1:${listenPort}/api/${route}`, body === undefined ? {headers:{Cookie:cookie}} : {
      method: 'POST', headers: { 'Content-Type': 'application/json',Cookie:cookie }, body: JSON.stringify(body),
    });
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  try {
    // Never run a destructive test against the application's configured database.
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const first = await start(port);
    const second = await start(port + 1);
    await request('auth/setup',{username:'admin',password:'fixture-password'});
    await request('auth/login',{username:'admin',password:'fixture-password'});
    assert.equal((await request('state')).database, 'postgres');
    let state = await request('plans', { name: 'Hogar', down: 100, up: 50, price: 99.9 });
    const plan = state.plans[0].id;
    state = await request('customers', { apartment: '101', name: 'Ana', plan_id: plan });
    const customer = state.customers[0].id;
    await request('customers', { apartment: '101', name: 'Duplicado', plan_id: plan }, 400);
    await request('customers', { apartment: '102', name: 'Inválido', plan_id: 999999 }, 400);
    await request('billing', { period: '2020-01', due: '2020-02-31' }, 400);
    await Promise.all(Array.from({ length: 8 }, (_, i) => request('billing', { period: '2020-01', due: '2020-01-10' }, 200, port + i % 2)));
    state = await request('billing', { period: '2020-02', due: '2020-02-10' });
    assert.equal(state.invoices.length, 2);
    assert.equal(state.invoices[0].amount, 9990);
    const january = state.invoices.find(invoice => invoice.period === '2020-01').id;
    const february = state.invoices.find(invoice => invoice.period === '2020-02').id;
    state = await request('overdue', {});
    assert.equal(state.customers[0].status, 'suspended');
    await Promise.all(Array.from({ length: 8 }, (_, i) => request('pay', { id: january }, 200, port + i % 2)));
    state = await request('state');
    assert.equal(state.customers[0].status, 'suspended');
    assert.equal(state.events.filter(event => event.message.startsWith('Pago registrado:')).length, 1);
    await Promise.all(Array.from({ length: 8 }, (_, i) => request('pay', { id: february }, 200, port + i % 2)));
    state = await request('state');
    assert.equal(state.events.filter(event => event.message.startsWith('Pago registrado:')).length, 2);
    assert.equal(state.customers[0].status, 'active');
    assert.equal(state.commands.length, 2);
    await request('access', { id: customer, status: 'invalid' }, 400);
    await stop(first); await stop(second);
    await start(port);
    state = await request('state');
    assert.equal(state.invoices.filter(invoice => invoice.paid_at).length, 2);
    assert.equal(state.customers.length, 1);
    await routerContract(request);
  } finally {
    for (const child of children) await stop(child);
    if (created) {
      if (!/^nuwenet_test_[a-f0-9]{32}$/.test(database)) throw new Error('Nombre de base temporal inesperado.');
      await admin.unsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
    await admin.close();
  }
}, 60000);
