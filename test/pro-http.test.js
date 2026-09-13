import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

test('Pro HTTP y navegador: portal público aislado, WhatsApp, QR, aprobación y ticket',async()=>{
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const directory=mkdtempSync(path.join(tmpdir(),'nuwenet-pro-http-')),origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,['apps/api/dist/main.js'],{env:{...process.env,DB_DRIVER:'sqlite',DATA_DIR:directory,BACKUP_DIR:path.join(directory,'backups'),HOST:'127.0.0.1',PORT:String(port),SETUP_TOKEN:'',NOTIFY_CHANNEL:'log',WHATSAPP_SEND_ENABLED:'false',NUWENET_PORTAL_IP:'',NUWENET_PUBLIC_URL:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let cookie='',browser;
  const api=async(route,body,status=200,authenticated=true)=>{
    const response=await fetch(`${origin}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(authenticated?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
  };
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Servidor no inició')),20000);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Salida ${code}`));});server.stdout.on('data',chunk=>{if(chunk.toString().includes('disponible')){clearTimeout(timer);resolve();}});server.stderr.resume();});
    await api('auth/setup',{username:'pro-owner',password:'fixture-password'});await api('auth/login',{username:'pro-owner',password:'fixture-password'});
    await api('plans',{name:'Plan Pro',down:50,up:10,price:100});
    // B5: el estado ya no expone el enlace; se obtiene una sola vez al emitir.
    let state=await api('customers',{apartment:'101',name:'Residente Pro',plan_id:1,phone:'+59170000000'});
    const created101=state.portal_link;assert.match(created101.token,/^[\w-]{43}$/);
    const token=created101.token,bid=state.customers[0].building_id;
    state=await api('customers',{apartment:'102',name:'Otro residente',plan_id:1});
    const otherToken=state.portal_link.token;
    assert.equal(state.customers.find(c=>c.apartment==='102').access_token,undefined);
    state=await api('billing',{period:'2026-09',due:'2026-09-20'});const invoice=state.invoices.find(i=>i.apartment==='101');
    await api(`buildings/${bid}/bank`,{bank:'Banco de prueba',holder:'Edificio Pro',account:'TEST-001',qr_image:'',qr_text:'https://example.test/pay?amount={amount}',suspension_message:'Contacta a administración para regularizar tu cuenta.',contact:'70000000'});
    await api('portal-admin',undefined,401,false);await api('portal?token=invalid',undefined,400,false);
    await api(`portal?token=${token}`,undefined,200,false);
    await api('portal/report',{token,amount:-1,reference:'invalid'},400,false);
    const report=await api('portal/report',{token,amount:25,reference:'<img src=x onerror=alert(1)>',notes:'Transferencia de prueba'},200,false);
    assert.equal((await api(`portal?token=${otherToken}`,undefined,200,false)).paymentReports.length,0);
    assert.equal((await api(`invoices/${invoice.id}/send-whatsapp`,{})).status,'internal');
    await api(`invoices/${invoice.id}/send-whatsapp`,{},401,false);
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${origin}/portal?token=${token}`);await page.locator('#portal-content').waitFor({state:'visible'});
    assert.match(await page.locator('#reports-list').innerText(),/<img src=x/);assert.equal(await page.locator('#reports-list img').count(),0);
    assert.match(await page.locator('#bank-details').innerText(),/TEST-001/);
    await context.addCookies([{name:'nuwenet_session',value:cookie.split('=')[1],url:origin}]);
    await page.goto(`${origin}/#billing`);await page.locator('[data-action="payment-reports"]').click();
    await page.locator(`[data-action="approve-report"][data-id="${report.id}"]`).click();
    await page.locator('#form [type=submit]').click();await page.locator('#modal').waitFor({state:'hidden'});
    const portal=await api(`portal?token=${token}`,undefined,200,false);assert.equal(portal.payments.length,1);assert.equal(portal.invoices[0].paid_total,2500);
    await api(`payments/${portal.payments[0].id}/send-whatsapp`,{});
    await page.locator('tr:has-text("101")').getByRole('button',{name:'Abonar / pago total'}).click();
    assert.match(await page.locator('[data-bank-amount]').innerText(),/75[.,]00/);
    await page.locator('[data-generated-qr]').waitFor({state:'visible'});
    const initialQr=await page.locator('[data-generated-qr]').getAttribute('src');assert.ok(initialQr.startsWith('data:image/png;'));
    await page.getByLabel('Importe (opcional)').fill('10');assert.match(await page.locator('[data-bank-amount]').innerText(),/10[.,]00/);
    await page.waitForFunction(initial=>document.querySelector('[data-generated-qr]')?.getAttribute('src')!==initial,initialQr);
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.goto(`${origin}/#payments`);await page.getByRole('button',{name:'Ver recibo'}).first().click();
    assert.match(await page.locator('.receipt').innerText(),/HMAC-SHA256/);await page.locator('#ticket-width').selectOption('58');
    await page.getByRole('button',{name:'Imprimir / guardar PDF'}).click();
    const ticket=page.frameLocator('iframe[title="Impresión del recibo"]');assert.match(await ticket.locator('body').innerText(),/NNW-/);
    assert.equal(await ticket.locator('style').textContent().then(s=>s.includes('size:58mm auto')),true);
    await page.goto(`${origin}/corte?building_id=${bid}`);await page.waitForFunction(()=>document.querySelector('#admin-contact')?.textContent==='70000000');
    assert.deepEqual(errors,[]);
  } finally {
    if(browser)await browser.close();if(server.exitCode===null){const done=once(server,'exit');server.kill();await done;}
    const resolved=realpathSync(directory);assert.equal(path.dirname(resolved),realpathSync(tmpdir()));assert.ok(path.basename(resolved).startsWith('nuwenet-pro-http-'));rmSync(resolved,{recursive:true,force:true});
  }
},60000);
