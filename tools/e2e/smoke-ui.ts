import { createTestSchema } from '../../test/fixtures/postgres-fixture';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = mkdtempSync(path.join(tmpdir(), 'nuwenet-ui-'));
const pg = await createTestSchema();
const port = 43000 + Math.floor(Math.random() * 10000);
const setupToken = 'ui-installation-fixture';
// Preserve OS/runtime paths, never application credentials or local .env settings.
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PLAYWRIGHT_BROWSERS_PATH)$/i.test(key)));
const server = spawn(process.execPath, ['--no-env-file', 'tools/e2e/ui-test-server.ts'], {
  env: { ...environment, ...pg.env, SETUP_TOKEN: setupToken, DB_DRIVER: 'postgres', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, BACKUP_DIR:path.join(directory,'backups'), OVERDUE_CRON_MINUTES:'0' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let serverErrors = '';
server.stderr.on('data', data => { serverErrors = (serverErrors + data).slice(-4000); });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`El servidor no inició: ${serverErrors}`)), 60000);
    server.once('error', reject);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Salida del servidor: ${code}`)); });
    server.stdout.on('data', data => { if (data.toString().includes('disponible')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.setDefaultTimeout(15000);
  // Cierra el diálogo abierto con Escape. El puntero se aparta antes para que
  // ningún tooltip bajo el cursor consuma la pulsación: los tooltips del panel
  // abren sin retardo (delayDuration 0).
  const closeWithEscape = async (hidden = page.getByRole('dialog')) => {
    await page.mouse.move(4, 4);
    await page.keyboard.press('Escape');
    await hidden.waitFor({ state: 'hidden' });
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}`);
  for (const token of ['', 'wrong-installation-token']) {
    const response = await page.request.post(`http://127.0.0.1:${port}/api/auth/setup`, {
      headers: { 'X-Setup-Token': token }, data: { username:'admin', password:'fixture-password' },
    });
    assert.equal(response.status(), 403, 'El setup protegido rechaza el código ausente o incorrecto');
  }
  // El selector de tema de la pantalla de acceso comparte preferencias con el panel.
  await page.locator('#auth-theme-button').click();
  await page.locator('#auth-theme-menu [role="menuitemradio"]').first().waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'menuitemradio','El selector de tema abre con el foco dentro');
  await page.locator('#auth-theme-menu [data-theme-value="dark"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','El tema elegido en la pantalla de acceso se aplica');
  assert.equal(await page.locator('#auth-theme-menu').isHidden(),true,'Elegir un tema cierra el selector');
  assert.equal(await page.locator('#auth-theme-button').getAttribute('aria-expanded'),'false');
  await page.locator('#auth-theme-button').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#auth-theme-menu').isHidden(),true,'Escape cierra el selector de tema');
  assert.equal(await page.locator('#auth-theme-button').evaluate(el=>el===document.activeElement),true,'Escape devuelve el foco al botón');
  await page.locator('#auth-theme-button').click();
  await page.getByLabel('Usuario', {exact:true}).click();
  assert.equal(await page.locator('#auth-theme-menu').isHidden(),true,'Un clic fuera cierra el selector de tema');
  await page.locator('#auth-theme-button').click();
  await page.locator('#auth-theme-menu [data-theme-value="light"]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.getByLabel('Usuario', {exact:true}).fill('admin');
  await page.getByLabel('Contraseña', {exact:true}).fill('fixture-password');
  await page.getByLabel('Código de instalación', {exact:true}).waitFor({state:'visible'});
  await page.getByLabel('Código de instalación', {exact:true}).fill(setupToken);
  await page.getByRole('button',{name:'Crear y entrar'}).click();
  await page.getByRole('heading', { name: 'Tu edificio, conectado.' }).waitFor();
  await page.locator('nav [data-page="plans"]').click();
  await page.getByRole('button',{name:'Crear plan',exact:true}).click();
  await page.getByLabel('Nombre del plan').fill('Hogar 100');
  await page.getByLabel('Bajada (Mbps)').fill('100');
  await page.getByLabel('Subida (Mbps)').fill('30');
  await page.getByLabel('Precio mensual').fill('150');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('cell', { name: 'Hogar 100', exact: true }).waitFor();
  await page.locator('nav [data-page="customers"]').click();
  await page.getByRole('button',{name:'Agregar departamento',exact:true}).click();
  await page.getByLabel('Departamento', { exact: true }).fill('201');
  await page.getByLabel('Nombre del titular').fill('Prueba de migración');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  // B5: el enlace del portal se muestra una sola vez tras crear; se verifica y se cierra.
  await page.getByRole('heading', { name: /nica vez/ }).waitFor();
  const onceLink = await page.locator('[data-portal-link]').inputValue();
  if (!/\/portal\?token=[\w-]{43}/.test(onceLink)) throw new Error('Enlace único no mostrado al crear.');
  await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).first().click();
  await page.getByText('Prueba de migración', { exact: true }).waitFor();
  await page.locator('nav [data-page="billing"]').click();
  await page.getByRole('button', { name: 'Generar mensualidades' }).click();
  await page.getByLabel('Periodo').fill('2020-01');
  await page.getByLabel('Fecha de vencimiento').fill('2020-01-10');
  await page.getByRole('button', { name: 'Generar', exact: true }).click();
  await page.getByText('Vencida', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Revisar vencimientos' }).click();
  await page.getByRole('dialog').getByRole('button', { name:'Revisar', exact:true }).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button', { name: 'Abonar / pago total' }).click();
  await page.getByRole('button', { name: 'Guardar pago', exact: true }).click();
  await page.getByText('Pagada', { exact: true }).waitFor();
  await page.locator('nav [data-page="customers"]').click();
  await page.getByText('● Al día', { exact: true }).waitFor();
  await page.getByRole('button',{name:'Editar 201',exact:true}).click();
  await page.getByLabel('Nombre del titular').fill('Titular actualizado');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('Titular actualizado',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Desactivar',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Desactivar',exact:true}).click();
  await page.locator('#customer-action-form').waitFor({state:'hidden'});
  await page.getByLabel('Mostrar',{exact:true}).selectOption('1');
  await page.getByRole('button',{name:'Activar',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Activar',exact:true}).click();
  await page.locator('#customer-action-form').waitFor({state:'hidden'});
  await page.getByLabel('Mostrar',{exact:true}).selectOption('0');
  await page.getByRole('button',{name:'Reactivar internet',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Reactivar',exact:true}).click();
  await page.locator('#customer-action-form').waitFor({state:'hidden'});
  await page.getByText('Servicio activo',{exact:true}).waitFor();
  await page.locator('nav [data-page="payments"]').click();
  await page.getByRole('button',{name:/^Ver recibo #/}).click();
  await page.locator('.receipt').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).first().click();
  await page.getByRole('button',{name:/^Revertir pago #/}).click();
  await page.getByLabel('Motivo',{exact:true}).fill('Prueba de reversión auditada');
  await page.getByRole('button',{name:'Revertir',exact:true}).last().click();
  await page.getByText('Revertido: Prueba de reversión auditada',{exact:true}).waitFor();
  await page.locator('nav [data-page="settings"]').click();
  await page.getByLabel('Nombre del edificio',{exact:true}).fill('Edificio de prueba');
  await page.getByLabel('Moneda',{exact:true}).fill('Bs');
  await page.getByRole('button',{name:'Guardar configuración',exact:true}).click();
  await page.getByText('Configuración guardada.',{exact:true}).waitFor();
  await page.locator('nav [data-page="users"]').click();
  await page.getByRole('button',{name:'Crear administrador'}).click();
  await page.getByLabel('CI',{exact:true}).fill('1234567');
  await page.getByLabel('Nombre',{exact:true}).fill('Ana');
  await page.getByLabel('Apellido',{exact:true}).fill('Prueba');
  await page.getByLabel('Dirección',{exact:true}).fill('Edificio de prueba');
  await page.getByLabel('Usuario (correo)',{exact:true}).fill('admin@example.test');
  await page.getByLabel('Contraseña inicial',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('admin@example.test',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Editar admin@example.test',exact:true}).click();
  assert.equal(await page.getByLabel('CI',{exact:true}).inputValue(),'1234567');
  await page.getByLabel('Teléfono',{exact:true}).fill('70000001');
  await page.getByLabel('Apellido',{exact:true}).fill('Editada');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('70000001',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Editar admin@example.test',exact:true}).click();
  await page.getByLabel('Usuario (correo)',{exact:true}).fill('admin');
  assert.equal(await page.getByLabel('Usuario (correo)',{exact:true}).evaluate(el=>el.checkValidity()),false);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Deshabilitar admin@example.test',exact:true}).click();
  await page.getByRole('button',{name:'Deshabilitar',exact:true}).last().click();
  await page.getByText('Administrador deshabilitado.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Crear administrador'}).click();
  await page.getByLabel('CI',{exact:true}).fill('7654321');
  await page.getByLabel('Nombre',{exact:true}).fill('Beto');
  await page.getByLabel('Apellido',{exact:true}).fill('Segundo');
  await page.getByLabel('Dirección',{exact:true}).fill('Edificio de prueba');
  await page.getByLabel('Usuario (correo)',{exact:true}).fill('admin2@example.test');
  await page.getByLabel('Contraseña inicial',{exact:true}).fill('fixture-password');
  await page.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('admin2@example.test',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Activar admin@example.test',exact:true}).click();
  await page.getByRole('button',{name:'Activar',exact:true}).last().click();
  await page.getByText('Administrador activado.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Deshabilitar admin2@example.test',exact:true}).click();
  await page.getByRole('button',{name:'Deshabilitar',exact:true}).last().click();
  await page.getByText('Administrador deshabilitado.',{exact:true}).waitFor();
  await page.locator('nav [data-page="backups"]').click();
  await page.getByRole('button',{name:'Crear respaldo ahora',exact:true}).click();
  await page.getByRole('button',{name:/^Verificar integridad · /}).click();
  await page.getByText('Integridad del respaldo verificada.',{exact:true}).waitFor();
  await page.locator('nav [data-page="audit"]').click();
  await page.getByRole('cell').filter({hasText:/POST \/api\/payments\/reverse id=[0-9a-f-]{36} .* ok /}).waitFor();
  await page.locator('nav [data-page="routers"]').click();
  await page.getByRole('button', { name: 'Agregar router' }).click();
  await page.getByText('Configuración avanzada',{exact:true}).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Router de prueba UI');
  await page.getByLabel('Adaptador', { exact: true }).selectOption('mikrotik-rest');
  assert.equal(await page.getByLabel('Adaptador', { exact: true }).locator('option').count(), 4, 'Adaptadores: mikrotik, arris, openwrt y tr369 base');
  assert.equal(await page.getByLabel('Adaptador', { exact: true }).locator('option[value="tr369-usp"]').count(), 1, 'TR-369 base disponible para registro manual');
  await page.getByLabel('IP de administración').fill('192.168.99.1');
  await page.getByLabel('Protocolo').selectOption('https');
  await page.getByLabel('Usuario', { exact: true }).fill('fixture-user');
  await page.getByLabel('Contraseña', { exact: true }).fill('fixture-secret');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('heading', { name: 'Router de prueba UI' }).waitFor();
  await page.getByText('Sin probar', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'Las acciones avanzadas no aparecen en el listado');
  await page.getByLabel('Buscar router', { exact: true }).fill('192.168.99');
  await page.getByRole('button', { name: 'Ver router Router de prueba UI', exact: true }).click();
  await page.getByRole('heading', { name: 'Detalle del equipo', exact: true }).waitFor();
  await page.getByText('Administración completa', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Volver a routers', exact: true }).click();
  assert.equal(await page.getByLabel('Buscar router', { exact: true }).inputValue(), '192.168.99');
  assert.equal(await page.getByRole('button', { name: 'Ver router Router de prueba UI', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.getByLabel('Buscar router', { exact: true }).fill('sin coincidencias');
  await page.getByRole('button', { name: 'Limpiar búsqueda', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#main-sidebar').getBoundingClientRect().right <= 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'El listado de routers cabe en móvil');
  await page.screenshot({ path: path.join(tmpdir(), 'nuwenet-router-list-mobile.png') });
  await page.getByRole('button', { name: 'Ver router Router de prueba UI', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'La ficha del router cabe en móvil');
  await page.screenshot({ path: path.join(tmpdir(), 'nuwenet-router-detail-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Editar · Router de prueba UI', exact: true }).click();
  assert.equal(await page.getByLabel('Contraseña', { exact: true }).inputValue(), '');
  await page.getByLabel('Nombre', { exact: true }).fill('Router UI editado');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('heading', { name: 'Router UI editado' }).waitFor();
  await page.getByRole('button', { name: 'Volver a routers', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar red del edificio', exact: true }).click();
  await page.getByLabel('Edificio', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Crear estructura inicial', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await page.getByText('Borrador guardado. Aún no se ha modificado la red.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '5. Revisar y aplicar', exact: true }).click();
  await page.getByRole('heading', { name: 'Pendiente antes de aplicar', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Aplicar cambios revisados', exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'El asistente de red cabe en móvil');
  await page.screenshot({ path: path.join(tmpdir(), 'nuwenet-network-wizard-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Volver a equipos', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Configurar red del edificio', exact: true }).click();
  await page.getByLabel('Edificio', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  assert.ok(await page.getByLabel('Nombre', { exact: true }).count() >= 3, 'Inventario persistido al volver a abrir el asistente');
  await page.getByRole('button', { name: 'Volver a equipos', exact: true }).click();
  await page.getByRole('button', { name: 'Ver router Router UI editado', exact: true }).click();
  await page.getByRole('button', { name: 'Quitar conexión' }).click();
  await page.getByRole('dialog').getByRole('button',{name:'Quitar',exact:true}).click();
  await page.getByText('Conecta tu primer router', { exact: true }).waitFor();
  await page.locator('nav [data-page="customers"]').click();
  await page.getByText('Titular actualizado', { exact: true }).waitFor();
  await page.reload();
  await page.locator('nav [data-page="customers"]').click();
  await page.getByText('Titular actualizado', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'El panel móvil no desborda horizontalmente');
  // The React island shares preferences with the legacy navbar and setup page.
  async function openAccount(action) {
    await page.getByRole('button', {name:'Menú de usuario',exact:true}).click();
    await page.getByRole('menuitem', {name:action,exact:true}).click();
    await page.getByRole('dialog', {name:action,exact:true}).waitFor();
  }
  await openAccount('Configuraciones');
  const preferences = page.getByRole('dialog', {name:'Configuraciones',exact:true});
  for (const [label,theme] of [['Oscuro','dark'],['Claro','light']]) {
    await preferences.getByRole('button', {name:label,exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(await preferences.getByRole('button', {name:label,exact:true}).getAttribute('aria-pressed'),'true');
    await page.waitForFunction(expected => {
      const dialog=document.querySelector('#account-dialog');
      return dialog && getComputedStyle(dialog).backgroundColor===expected;
    },theme==='dark'?'rgb(23, 23, 23)':'rgb(255, 255, 255)');
    if(theme==='dark')await page.screenshot({path:path.join(tmpdir(),'nuwenet-shadcn-dark.png')});
  }
  await preferences.getByRole('switch', {name:'Vista compacta',exact:true}).click();
  await preferences.getByRole('switch', {name:'Reducir animaciones',exact:true}).click();
  await preferences.getByRole('status').filter({hasText:'Preferencias guardadas'}).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-density'),'compact');
  assert.equal(await page.locator('html').getAttribute('data-reduce-motion'),'true');
  for(let i=0;i<8;i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[role="dialog"]'))),true,'El foco permanece dentro del diálogo');
  }
  assert.equal(await preferences.evaluate(el=>el.getBoundingClientRect().right<=innerWidth&&el.getBoundingClientRect().left>=0),true,'El diálogo cabe en móvil');
  await closeWithEscape(preferences);
  await page.waitForFunction(()=>document.activeElement?.id==='account-trigger');
  await page.reload();
  await page.getByText('Titular actualizado', {exact:true}).waitFor();
  await openAccount('Configuraciones');
  assert.equal(await preferences.getByRole('switch',{name:'Vista compacta',exact:true}).getAttribute('aria-checked'),'true');
  await preferences.getByRole('button',{name:'Sistema',exact:true}).click();
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.screenshot({path:path.join(tmpdir(),'nuwenet-shadcn-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(tmpdir(),'nuwenet-shadcn-desktop.png')});
  await preferences.getByRole('button',{name:'Cerrar',exact:true}).click();
  await openAccount('Perfil');
  const profile=page.getByRole('dialog',{name:'Perfil',exact:true});
  await profile.getByLabel('Contraseña actual',{exact:true}).fill('incorrect-password');
  await profile.getByLabel('Nueva contraseña',{exact:true}).fill('new-fixture-password');
  await profile.getByRole('button',{name:'Cambiar y cerrar sesiones',exact:true}).click();
  await profile.getByRole('alert').filter({hasText:'Contraseña actual incorrecta'}).waitFor();
  await profile.getByLabel('Contraseña actual',{exact:true}).fill('fixture-password');
  await profile.getByRole('button',{name:'Cambiar y cerrar sesiones',exact:true}).click();
  await page.getByRole('heading',{name:'Bienvenido de nuevo',exact:true}).waitFor();
  await page.getByLabel('Usuario',{exact:true}).fill('admin');
  await page.getByLabel('Contraseña',{exact:true}).fill('new-fixture-password');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByText('Titular actualizado',{exact:true}).waitFor();
  // Plans: real update, validation, recoverable API error and immutable invoices.
  await page.locator('nav [data-page="plans"]').click();
  await page.getByRole('cell',{name:'Hogar 100',exact:true}).waitFor();
  await page.getByRole('button',{name:'Más acciones para Hogar 100',exact:true}).click();
  await page.getByRole('menuitem',{name:'Editar',exact:true}).click();
  const planForm=page.locator('#plan-form');
  const planDialog=page.getByRole('dialog');
  assert.equal(await planForm.getByLabel('Precio mensual',{exact:true}).inputValue(),'150');
  await planForm.getByLabel('Nombre del plan',{exact:true}).fill('   ');
  await planDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await planDialog.getByRole('alert').filter({hasText:'Escribe el nombre del plan.'}).waitFor();
  await planForm.getByLabel('Nombre del plan',{exact:true}).fill('Hogar renovado');
  await planForm.getByLabel('Bajada (Mbps)',{exact:true}).fill('0');
  assert.equal(await planForm.getByLabel('Bajada (Mbps)',{exact:true}).evaluate(el=>el.checkValidity()),false);
  await planForm.getByLabel('Bajada (Mbps)',{exact:true}).fill('120');
  await planForm.getByLabel('Subida (Mbps)',{exact:true}).fill('40');
  await planForm.getByLabel('Precio mensual',{exact:true}).fill('175.50');
  await page.route('**/api/plans/update',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fallo temporal de prueba.'})}));
  await planDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await planDialog.getByRole('alert').filter({hasText:'Fallo temporal de prueba.'}).waitFor();
  assert.equal(await planForm.getByLabel('Nombre del plan',{exact:true}).inputValue(),'Hogar renovado');
  await page.unroute('**/api/plans/update');
  let attempts=0,releaseSave;
  const gate=new Promise(resolve=>{releaseSave=resolve;});
  await page.route('**/api/plans/update',async route=>{attempts++;await gate;await route.continue();});
  await planDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#plan-form')?.getAttribute('aria-busy')==='true');
  assert.equal(await planDialog.getByRole('button',{name:'Guardando…',exact:true}).isDisabled(),true);
  await planForm.evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  releaseSave();
  await page.getByRole('cell',{name:'Hogar renovado',exact:true}).waitFor();
  assert.equal(attempts,1,'Un envío pendiente no se duplica');
  await page.unroute('**/api/plans/update');
  const stateResponse=await page.request.get(`http://127.0.0.1:${port}/api/state`);
  assert.equal(stateResponse.status(),200);const plansState=await stateResponse.json();
  assert.equal(plansState.plans[0].price,17550);assert.equal(plansState.plans[0].down,120);assert.equal(plansState.plans[0].up,40);
  assert.equal(plansState.customers[0].down,120);assert.equal(plansState.invoices[0].amount,15000,'La cuota existente conserva su importe');
  const future=await page.request.post(`http://127.0.0.1:${port}/api/billing`,{data:{period:'2099-01',due:'2099-01-10',building_id:plansState.active_building_id}});
  assert.equal(future.status(),200);assert.equal((await future.json()).invoices.find(i=>i.period==='2099-01').amount,17550,'Las cuotas futuras usan el nuevo precio');
  await page.getByRole('button',{name:'Más acciones para Hogar renovado',exact:true}).click();
  await page.getByRole('menuitem',{name:'Editar',exact:true}).click();
  await closeWithEscape(planForm);
  // Radix devuelve el foco al desmontar el diálogo, así que se espera al resultado
  // en lugar de comprobarlo en el mismo instante del cierre.
  await page.waitForFunction(name=>document.activeElement?.getAttribute('aria-label')?.includes(name),'Hogar renovado');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,colorScheme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Planes no desborda horizontalmente');
      await page.screenshot({path:path.join(tmpdir(),`nuwenet-plans-${width}-${colorScheme}.png`)});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('nav [data-page="customers"]').click();
  await page.getByRole('button',{name:'Editar 201',exact:true}).click();
  const customerForm=page.locator('#customer-form');
  const customerDialog=page.getByRole('dialog');
  await page.getByLabel('Departamento',{exact:true}).fill('   ');
  await customerDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await customerDialog.getByRole('alert').filter({hasText:'Escribe el departamento.'}).waitFor();
  await page.getByLabel('Departamento',{exact:true}).fill('201');
  await page.getByLabel('Teléfono (opcional)').fill('70000000');
  await page.route('**/api/customers/update',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fallo temporal de departamento.'})}));
  await customerDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await customerDialog.getByRole('alert').filter({hasText:'Fallo temporal de departamento.'}).waitFor();
  assert.equal(await page.getByLabel('Teléfono (opcional)').inputValue(),'70000000');
  await page.unroute('**/api/customers/update');
  let customerAttempts=0,releaseCustomer;
  const customerGate=new Promise(resolve=>{releaseCustomer=resolve;});
  await page.route('**/api/customers/update',async route=>{customerAttempts++;await customerGate;await route.continue();});
  await customerDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#customer-form')?.getAttribute('aria-busy')==='true');
  await customerForm.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  releaseCustomer();await customerForm.waitFor({state:'hidden'});
  await page.getByText('70000000',{exact:true}).waitFor();
  assert.equal(customerAttempts,1);await page.unroute('**/api/customers/update');
  const beforeCustomer=await (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
  await page.getByRole('button',{name:'Editar 201',exact:true}).click();
  await page.getByLabel('Plan de internet (opcional)').selectOption('');
  await customerDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await customerForm.waitFor({state:'hidden'});
  await page.getByText('Sin plan',{exact:true}).waitFor();
  await page.getByText('Sin velocidad',{exact:true}).waitFor();
  const withoutPlan=await (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(withoutPlan.customers[0].plan_id,null);
  assert.equal(withoutPlan.customers[0].access_version,beforeCustomer.customers[0].access_version,'Editar datos no rota el portal');
  assert.deepEqual(withoutPlan.invoices,beforeCustomer.invoices,'Quitar el plan conserva las cuotas existentes');
  await page.getByRole('button',{name:'Editar 201',exact:true}).click();
  assert.equal(await page.getByLabel('Plan de internet (opcional)').inputValue(),'');
  await page.getByLabel('Plan de internet (opcional)').selectOption(String(plansState.plans[0].id));
  await customerDialog.getByRole('button',{name:'Guardar',exact:true}).click();
  await customerForm.waitFor({state:'hidden'});
  await page.getByText('Hogar renovado',{exact:true}).waitFor();
  await page.getByText(/120M\s*\/\s*40M/).waitFor();
  await page.getByRole('button',{name:'Editar 201',exact:true}).click();
  await closeWithEscape(customerForm);
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Editar 201');
  await page.getByLabel('Buscar departamento',{exact:true}).fill('sin coincidencias');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await page.getByText('No hay registros.',{exact:true}).waitFor();
  await page.reload();await page.getByText('No hay registros.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Buscar departamento',{exact:true}).inputValue(),'sin coincidencias');
  await page.getByLabel('Buscar departamento',{exact:true}).fill('201');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await page.getByText('70000000',{exact:true}).waitFor();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,colorScheme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Departamentos no desborda horizontalmente');
      await page.screenshot({path:path.join(tmpdir(),`nuwenet-customers-${width}-${colorScheme}.png`)});
      await page.getByRole('button',{name:'Editar 201',exact:true}).click();
      assert.equal(await customerDialog.getByRole('button',{name:'Guardar',exact:true}).isVisible(),true);
      await closeWithEscape(customerForm);
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.route('**/api/customers/*/usage?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Historial temporalmente no disponible.'})}),{times:1});
  await page.getByRole('button',{name:'Consumo mensual',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Historial temporalmente no disponible.'}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Actualizar consumo',exact:true}).click();
  await page.getByText('Sin mediciones para este mes.',{exact:false}).waitFor();
  await page.locator('[data-usage-day]').first().focus();await page.keyboard.press('Enter');
  await page.locator('[data-usage-detail]').filter({hasText:'sin lecturas.'}).waitFor();
  await closeWithEscape();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Consumo mensual');
  await page.getByRole('button',{name:'Cambiar IP',exact:true}).click();
  await page.getByLabel('IP privada',{exact:true}).fill('no-es-ip');
  await page.getByRole('dialog').getByRole('button',{name:'Guardar',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('#customer-action-form [role="alert"]')?.textContent);
  await page.getByLabel('IP privada',{exact:true}).fill('192.168.88.50');
  await page.getByRole('dialog').getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('192.168.88.50',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Cambiar IP',exact:true}).click();
  await page.getByLabel('IP privada',{exact:true}).fill('');
  await page.getByRole('dialog').getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByText('Sin IP',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Portal del residente',exact:true}).click();
  await page.getByRole('button',{name:'Generar y entregar enlace',exact:true}).click();
  let rotations=0,releaseRotation;
  const rotationGate=new Promise(resolve=>{releaseRotation=resolve;});
  await page.route('**/api/customers/portal-link',async route=>{rotations++;await rotationGate;await route.continue();});
  // The one-time link must survive a failed refresh after a successful mutation.
  await page.route('**/api/state?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Recarga no disponible.'})}),{times:1});
  await page.getByRole('button',{name:'Regenerar e invalidar anterior',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#customer-action-form')?.getAttribute('aria-busy')==='true');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(),true,'No se cierra una operación pendiente');
  assert.equal(await page.locator('#customer-action-form').count(),1,'El formulario pendiente sigue montado');
  await page.locator('#customer-action-form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  releaseRotation();await page.getByRole('heading',{name:/nica vez/}).waitFor();
  assert.equal(rotations,1);await page.unroute('**/api/customers/portal-link');
  const rotatedLink=await page.locator('[data-portal-link]').inputValue();
  assert.notEqual(rotatedLink,onceLink);
  const portalStatus=async link=>(await page.request.get(`http://127.0.0.1:${port}/api/portal?token=${new URL(link).searchParams.get('token')}`)).status();
  assert.equal(await portalStatus(onceLink),400);assert.equal(await portalStatus(rotatedLink),200);
  await closeWithEscape();
  assert.equal(await page.locator('[data-portal-link]').count(),0,'El enlace se retira del DOM al cerrar');
  await page.getByRole('button',{name:'Portal del residente',exact:true}).click();
  await page.getByRole('button',{name:'Cambio de titular',exact:true}).click();
  await page.getByLabel('Nuevo titular',{exact:true}).fill('   ');
  await page.getByRole('button',{name:'Cambiar titular e invalidar acceso',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Escribe el nuevo titular.'}).waitFor();
  await page.getByLabel('Nuevo titular',{exact:true}).fill('Nuevo ocupante');
  await page.getByRole('button',{name:'Cambiar titular e invalidar acceso',exact:true}).click();
  await page.getByRole('heading',{name:/nica vez/}).waitFor();
  const holderLink=await page.locator('[data-portal-link]').inputValue();
  assert.equal(await portalStatus(rotatedLink),400);assert.equal(await portalStatus(holderLink),200);
  await closeWithEscape();
  await page.getByText('Nuevo ocupante',{exact:true}).waitFor();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const colorScheme of ['light','dark']) {
      await page.emulateMedia({colorScheme});
      for(const action of ['Portal del residente','Consumo mensual']) {
        await page.getByRole('button',{name:action,exact:true}).click();
        if(action==='Consumo mensual')await page.locator('[data-usage-day]').first().waitFor();
        assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'El diálogo no desborda horizontalmente');
        await page.screenshot({path:path.join(tmpdir(),`nuwenet-customer-action-${action==='Consumo mensual'?'usage':'portal'}-${width}-${colorScheme}.png`)});
        await closeWithEscape();
      }
    }
  }
  const resident = await browser.newPage();
  resident.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await resident.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark']) {
      await resident.emulateMedia({ colorScheme });
      for (const route of [`/portal?token=${new URL(holderLink).searchParams.get('token')}`, '/corte']) {
        await resident.goto(`http://127.0.0.1:${port}${route}`);
        if (route.startsWith('/portal')) await resident.locator('#portal-content').waitFor({ state: 'visible' });
        assert.equal(await resident.locator('html').getAttribute('data-theme'), colorScheme);
        assert.equal(await resident.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Las páginas públicas caben en la pantalla');
        await resident.screenshot({ path: path.join(tmpdir(), `nuwenet-public-${route.startsWith('/portal') ? 'portal' : 'corte'}-${width}-${colorScheme}.png`) });
      }
    }
  }
  await resident.close();
  assert.deepEqual(errors, [], 'Sin errores de JavaScript en el navegador');
  assert.ok(!serverErrors.includes('UI_TEST_OUTBOUND_HTTP_BLOCKED'), 'El recorrido no debe intentar contactar integraciones HTTP');
  console.log('Interfaz verificada: setup y selector de tema, altas, edición, desactivación/activación, cobros, recibos, reversión, configuración, usuarios, respaldos, auditoría, cuenta shadcn, planes y departamentos en tabla (menú de acciones, validaciones, reintento, envío único, búsqueda persistente, precio histórico/futuro y velocidades), equipos de red (4 adaptadores, nivel de administración) y asistente de red del edificio.');
} catch(error) {
  const page=browser?.contexts()[0]?.pages()[0];
  if(page){
    await page.screenshot({path:path.join(tmpdir(),'nuwenet-ui-smoke-failure.png'),fullPage:true});
    console.error(`Fallo en ${page.url()}`);
    for (const [index, text] of (await page.locator('[role="dialog"]').allTextContents()).entries()) {
      console.error(`Diálogo abierto ${index + 1}: ${text.replace(/\s+/g,' ').slice(0,300)}`);
    }
    console.error((await page.locator('#view').innerText()).slice(0,1800));
  }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const closed = once(server, 'exit'); server.kill(); await closed; }
  const target = realpathSync(directory);
  const temp = realpathSync(tmpdir());
  if (path.dirname(target) !== temp || !path.basename(target).startsWith('nuwenet-ui-')) throw new Error('Directorio temporal inesperado.');
  await pg.close();
  rmSync(target, { recursive: true, force: true });
}
