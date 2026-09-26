// E2E del panel: diálogos compartidos (DialogShell/PendingDialog/ConfirmDialog/FormField),
// listados compartidos (DataTable), recorrido de todas las secciones y catálogo interno
// de componentes, comprobando el efecto real por API.
// Ejecutar con: bun run test:dialogs
import { createTestSchema } from '../../test/fixtures/postgres-fixture';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-verify-'));
const pg = await createTestSchema();
const port = 44000 + Math.floor(Math.random() * 5000);
const setupToken = 'ui-installation-fixture';
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key)));
const server = spawn(process.execPath, ['--no-env-file', 'tools/e2e/ui-test-server.ts'], {
  env: { ...environment, ...pg.env, SETUP_TOKEN: setupToken, DB_DRIVER: 'postgres', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, BACKUP_DIR: path.join(directory, 'backups'), OVERDUE_CRON_MINUTES: '0' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverErrors = '';
server.stderr.on('data', data => { serverErrors = (serverErrors + data).slice(-4000); });
const failures: string[] = [];
let browser;
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`El servidor no inició: ${serverErrors}`)), 60000);
    server.once('error', reject);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Salida del servidor: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('disponible')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const api = async (route: string) => (await page.request.get(`http://127.0.0.1:${port}/api/${route}`)).json();
  const post = async (route: string, body: unknown) => {
    const response = await page.request.post(`http://127.0.0.1:${port}/api/${route}`, { data: body });
    const text = await response.text();
    if (!response.ok()) throw new Error(`${route} → ${response.status()} ${text}`);
    return text ? JSON.parse(text) : {};
  };
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Usuario', { exact: true }).fill('admin');
  await page.getByLabel('Contraseña', { exact: true }).fill('fixture-password');
  await page.getByLabel('Código de instalación', { exact: true }).fill(setupToken);
  await page.getByRole('button', { name: 'Crear y entrar' }).click();
  await page.getByRole('heading', { name: 'Tu edificio, conectado.' }).waitFor();

  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); console.log('OK   ', name); }
    catch (error) { failures.push(`${name} → ${(error as Error).message.split('\n')[0]}`); console.log('FALLO', name, '→', (error as Error).message.split('\n')[0]); }
  };
  const dialog = () => page.getByRole('dialog');

  await step('planes: crear (PendingDialog + FormField + SubmitRow)', async () => {
    await page.locator('nav [data-page="plans"]').click();
    await page.getByRole('button', { name: 'Crear plan', exact: true }).click();
    await page.getByLabel('Nombre del plan').fill('Plan verificado');
    await page.getByLabel('Bajada (Mbps)').fill('100');
    await page.getByLabel('Subida (Mbps)').fill('30');
    await page.getByLabel('Precio mensual').fill('150');
    await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Plan verificado', { exact: true }).first().waitFor();
    const state = await api('state');
    if (state.plans?.[0]?.name !== 'Plan verificado' || state.plans[0].price !== 15000) throw new Error(`estado inesperado: ${JSON.stringify(state.plans)}`);
  });

  await step('departamentos: crear (CustomerEditor + enlace del portal)', async () => {
    await page.locator('nav [data-page="customers"]').click();
    await page.getByRole('button', { name: 'Agregar departamento' }).click();
    await page.getByLabel('Departamento', { exact: true }).fill('201');
    await page.getByLabel('Nombre del titular (opcional)').fill('Vecino de prueba');
    await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('heading', { name: /nica vez/ }).waitFor();
    await page.locator('[data-portal-link]').waitFor();
    await dialog().getByRole('button', { name: 'Cerrar', exact: true }).first().click();
    const state = await api('state');
    if (state.customers?.[0]?.apartment !== '201') throw new Error(`estado inesperado: ${JSON.stringify(state.customers)}`);
  });

  await step('facturación: generar (BillingDialog)', async () => {
    await page.locator('nav [data-page="billing"]').click();
    await page.getByRole('button', { name: 'Generar mensualidades' }).click();
    await page.getByLabel('Periodo').fill('2020-01');
    await page.getByLabel('Fecha de vencimiento').fill('2020-01-10');
    await dialog().getByRole('button', { name: 'Generar', exact: true }).click();
    await page.getByText('Vencida', { exact: true }).waitFor();
    const state = await api('state');
    if (state.invoices?.[0]?.amount !== 15000) throw new Error(`estado inesperado: ${JSON.stringify(state.invoices)}`);
  });

  await step('facturación: revisar vencimientos (OverdueDialog)', async () => {
    await page.getByRole('button', { name: 'Revisar vencimientos' }).click();
    await dialog().getByRole('button', { name: 'Revisar', exact: true }).click();
    await dialog().waitFor({ state: 'hidden' });
  });

  await step('facturación: pago total (PayDialog)', async () => {
    await page.getByRole('button', { name: /^Abonar \/ pago total/ }).click();
    await dialog().getByRole('button', { name: 'Guardar pago', exact: true }).click();
    await page.getByText('Pagada', { exact: true }).waitFor();
    const state = await api('state');
    if (!state.invoices?.[0]?.paid_at) throw new Error('la cuota no quedó pagada');
  });

  await step('pagos: recibo (ReceiptDialog)', async () => {
    await page.locator('nav [data-page="payments"]').click();
    await page.getByRole('button', { name: /^Ver recibo #/ }).first().click();
    await page.locator('.receipt').waitFor();
    await dialog().getByRole('button', { name: 'Cerrar', exact: true }).first().click();
  });

  await step('pagos: revertir (ReverseDialog)', async () => {
    await page.getByRole('button', { name: /^Revertir pago #/ }).first().click();
    await page.getByLabel('Motivo', { exact: true }).fill('Motivo de verificación');
    await dialog().getByRole('button', { name: 'Revertir', exact: true }).click();
    await page.getByText(/Revertido: Motivo de verificación/).waitFor();
  });

  await step('departamentos: consumo mensual (CustomerActions solo lectura)', async () => {
    await page.locator('nav [data-page="customers"]').click();
    await page.getByRole('button', { name: 'Consumo mensual', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Consumo mensual', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'hidden' });
  });

  await step('departamentos: estado de cuenta navega a facturación (data-action)', async () => {
    await page.locator('nav [data-page="customers"]').click();
    await page.getByRole('button', { name: 'Estado de cuenta', exact: true }).first().click();
    await page.getByText('Estado de cuenta del departamento seleccionado.', { exact: true }).waitFor();
  });

  await step('usuarios: crear administrador (UsersPanel)', async () => {
    await page.locator('nav [data-page="users"]').click();
    await page.getByRole('button', { name: 'Crear administrador' }).click();
    const dlg = dialog();
    await dlg.getByLabel('CI', { exact: true }).fill('1234567');
    await dlg.getByLabel('Nombre', { exact: true }).fill('Ana');
    await dlg.getByLabel('Apellido', { exact: true }).fill('Verificada');
    await dlg.getByLabel('Dirección', { exact: true }).fill('Edificio de prueba');
    await dlg.getByLabel('Usuario (correo)', { exact: true }).fill('verificado@example.test');
    await dlg.getByLabel('Contraseña inicial', { exact: true }).fill('fixture-password');
    await dlg.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('verificado@example.test', { exact: true }).waitFor();
    const list = await api('auth/users');
    if (!list.some((u: { username: string }) => u.username === 'verificado@example.test')) throw new Error(`usuario ausente: ${JSON.stringify(list)}`);
  });

  await step('usuarios: deshabilitar (ConfirmDialog)', async () => {
    await page.getByRole('button', { name: 'Deshabilitar verificado@example.test', exact: true }).click();
    await dialog().getByRole('button', { name: 'Deshabilitar', exact: true }).click();
    await page.getByText('Administrador deshabilitado.', { exact: true }).waitFor();
  });

  await step('routers: agregar (RouterForm)', async () => {
    await page.locator('nav [data-page="routers"]').click();
    await page.getByRole('button', { name: 'Agregar router' }).click();
    await page.getByText('Configuración avanzada', { exact: true }).click();
    const dlg = dialog();
    await dlg.getByLabel('Nombre', { exact: true }).fill('Router verificado');
    await dlg.getByLabel('Adaptador', { exact: true }).selectOption('mikrotik-rest');
    await dlg.getByLabel('IP de administración').fill('192.168.50.1');
    await dlg.getByLabel('Usuario', { exact: true }).fill('verificado-user');
    await dlg.getByLabel('Contraseña', { exact: true }).fill('verificado-secret');
    await dlg.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Router verificado', { exact: true }).first().waitFor();
  });

  await step('configuración: guardar (SettingsPanel)', async () => {
    await page.locator('nav [data-page="settings"]').click();
    await page.getByLabel('Nombre del edificio', { exact: true }).fill('Edificio verificado');
    await page.getByLabel('Moneda', { exact: true }).fill('Bs');
    await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
    await page.getByText('Configuración guardada.', { exact: true }).waitFor();
  });

  await step('cuenta: preferencias (AccountPanel)', async () => {
    await page.getByRole('button', { name: 'Menú de usuario', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Configuraciones', exact: true }).click();
    const preferences = page.getByRole('dialog', { name: 'Configuraciones', exact: true });
    await preferences.waitFor();
    await preferences.getByRole('switch', { name: 'Vista compacta', exact: true }).click();
    await page.keyboard.press('Escape');
    await preferences.waitFor({ state: 'hidden' });
    const focused = await page.locator('#account-trigger').evaluate(el => el === document.activeElement);
    if (!focused) throw new Error('el foco no volvió al menú');
  });

  await step('paneles: recorrido, vista de tabla y filas vacías', async () => {
    const panels: [string, string][] = [
      ['overview', 'Tu edificio, conectado.'], ['activity', 'Actividad'], ['customers', 'Departamentos'],
      ['plans', 'Planes de internet'], ['billing', 'Mensualidades y pagos'], ['payments', 'Historial de pagos'],
      ['network', 'Control de acceso'], ['routers', 'Equipos de red'], ['buildings', 'Edificios'], ['users', 'Usuarios'],
      ['settings', 'Edificio y automatización'], ['backups', 'Respaldos'], ['audit', 'Auditoría'],
    ];
    for (const [pageId, heading] of panels) {
      await page.locator(`nav [data-page="${pageId}"]`).click();
      await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
    }
    await page.locator('nav [data-page="customers"]').click();
    await page.getByRole('button', { name: 'Vista de tabla', exact: true }).click();
    await page.getByRole('columnheader', { name: 'Titular / Contacto', exact: true }).waitFor();
    await page.getByRole('cell', { name: '201', exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Vista de tarjetas', exact: true }).click();
    await page.getByRole('heading', { name: '201', exact: true }).first().waitFor();
    if (pageErrors.length) throw new Error(`errores de página: ${pageErrors.join(' | ')}`);
  });

  await step('departamentos: eliminar (ConfirmDialog destructivo)', async () => {
    await page.locator('nav [data-page="customers"]').click();
    await page.getByRole('button', { name: 'Eliminar 201', exact: true }).click();
    await dialog().getByRole('button', { name: 'Sí, eliminar definitivamente', exact: true }).click();
    await page.getByText('No hay registros.', { exact: true }).waitFor();
    const state = await api('state');
    if (state.customers?.length) throw new Error('el departamento no se eliminó');
  });

  await step('control de acceso: órdenes reemplazadas y fallidas se distinguen', async () => {
    const estado = await api('state');
    const building = estado.enforcement.buildings[0].building_id;
    const plan = estado.plans.find((row: { name: string }) => row.name === 'Plan verificado').id;
    // Con IP y sin equipo central la orden queda en fallo con el motivo; asignar el
    // primer central la reemplaza, porque una orden nueva ya sí puede aplicarse.
    await post('customers', { apartment: '301', name: 'Con IP', plan_id: plan, ip: '192.168.1.10', building_id: building });
    await post('routers', { name: 'Central de prueba', adapter: 'mikrotik-rest', host: '192.168.1.1', port: 443, protocol: 'https', username: 'fixture', password: 'fixture', building_id: building });
    const central = (await api('state')).routers.find((router: { name: string }) => router.name === 'Central de prueba').id;
    await post('buildings/central', { building_id: building, central_router_id: central });
    // Sin IP la orden no puede aplicarse y queda fallida, con reintento a mano.
    const sinIp = await post('customers', { apartment: '302', name: 'Sin IP', plan_id: plan, building_id: building });
    await post('access', { id: sinIp.portal_link.customer_id, status: 'suspended' });

    await page.locator('nav [data-page="network"]').click();
    await page.getByRole('heading', { name: 'Control de acceso', exact: true }).waitFor();
    // Dos órdenes del mismo departamento son lo normal: la reemplazada y la vigente.
    const reemplazada = page.getByRole('row').filter({ hasText: 'Reemplazada' }).filter({ has: page.getByRole('cell', { name: '301', exact: true }) });
    await reemplazada.waitFor();
    if (await reemplazada.count() !== 1) throw new Error(`se esperaba una sola orden reemplazada de 301 (${await reemplazada.count()})`);
    const texto = await reemplazada.innerText();
    if (!/Fuera de la cola/.test(texto)) throw new Error(`la orden reemplazada no explica por qué salió de la cola: ${texto}`);
    if (!/Motivo original: El edificio no tiene equipo central/.test(texto)) throw new Error(`la orden reemplazada no conserva el motivo original: ${texto}`);
    if (!/—/.test(texto)) throw new Error(`una orden reemplazada no tiene próximo intento: ${texto}`);
    if (await reemplazada.getByRole('button', { name: /^Reintentar/ }).count()) throw new Error('una orden reemplazada no se reintenta');
    const fallida = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '302', exact: true }) });
    await fallida.getByText('Fallido', { exact: true }).waitFor();
    if (!(await fallida.getByRole('button', { name: 'Reintentar orden de 302', exact: true }).count())) throw new Error('la orden fallida debe poder reintentarse');
    // La distinción es visual: trazo discontinuo y color apagado contra el rojo del fallo.
    const color = async (row: typeof reemplazada, text: string) => row.getByText(text, { exact: true }).first().evaluate(el => {
      const style = getComputedStyle(el);
      return `${style.borderStyle} ${style.color}`;
    });
    const apagada = await color(reemplazada, 'Reemplazada');
    const roja = await color(fallida, 'Fallido');
    if (!apagada.startsWith('dashed ')) throw new Error(`la orden reemplazada no se distingue por su trazo: ${apagada}`);
    if (apagada.split(' ').slice(1).join(' ') === roja.split(' ').slice(1).join(' ')) throw new Error(`reemplazada y fallida se ven iguales (${apagada})`);
    if (pageErrors.length) throw new Error(`errores de página: ${pageErrors.join(' | ')}`);
  });

  // Último paso: navega fuera del panel, así que va después de todo lo demás.
  await step('catálogo interno: componentes compartidos y sus variantes', async () => {
    await page.goto(`http://127.0.0.1:${port}/catalogo`);
    for (const heading of ['PanelShell', 'FormField', 'DataTable', 'Pagination', 'Diálogos']) {
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    }
    const rows = await page.locator('main table tbody tr').allTextContents();
    if (rows.length !== 8) throw new Error(`filas del catálogo inesperadas (${rows.length}): ${JSON.stringify(rows)}`);
    if (!rows.some(text => text.includes('No se encontraron departamentos'))) throw new Error('falta el estado vacío de la tabla');
    await page.getByRole('button', { name: 'Diálogo informativo', exact: true }).click();
    await page.getByRole('dialog', { name: 'Recibo #1042' }).waitFor();
    await page.keyboard.press('Escape');
    await dialog().waitFor({ state: 'hidden' });
    const trigger = page.getByRole('button', { name: 'Diálogo informativo', exact: true });
    if (!await trigger.evaluate(element => element === document.activeElement)) throw new Error('el foco no volvió al disparador');
    if (pageErrors.length) throw new Error(`errores de página: ${pageErrors.join(' | ')}`);
  });

  console.log(failures.length ? `\nFALLOS (${failures.length}):\n${failures.join('\n')}` : '\nTodo OK: diálogos refactorizados verificados.');
  if (failures.length) throw new Error('Verificación con fallos');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  const target = realpathSync(directory);
  const temp = realpathSync(tmpdir());
  await pg.close();
  if (path.dirname(target) === temp && path.basename(target).startsWith('nuwenet-verify-')) rmSync(target, { recursive: true, force: true });
}
