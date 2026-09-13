import { openCustomerAction, showCustomerToken } from '../lib/customer-actions-store';
import { showCustomers, hideCustomers, editCustomer } from '../lib/customers-store';
import { showPlans, hidePlans } from '../lib/plans-store';
import { showBilling, hideBilling } from '../lib/billing-store';
import { showOperations, hideOperations } from '../lib/operations-store';
import { showRouters, hideRouters } from '../lib/routers-store';
import {receiptHtml,printReceipt,bankHtml,updateBankQr} from './receipt.js';
import { updateAccount, setTheme, syncThemeControls } from './account.js';

let currentReceipt;
let state,user,page='overview',requestVersion=0;
let query={customer_page:1,invoice_page:1,payment_page:1,search:'',archived:'0'};
const savedQuery=new URLSearchParams(location.search);
for(const k of ['customer_page','invoice_page','payment_page','building_id','customer_id']){const n=Number(savedQuery.get(k));if(Number.isInteger(n)&&n>0&&n<=1000000)query[k]=n;}
if(savedQuery.has('search'))query.search=savedQuery.get('search').slice(0,160);
if(savedQuery.get('archived')==='1')query.archived='1';
function persistQuery(){const u=new URL(location.href);u.search=new URLSearchParams(Object.entries(query).filter(([,v])=>v!==''&&v!=null)).toString();history.replaceState(null,'',u);}
const $=selector=>document.querySelector(selector);
export const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>`${state?.currency?state.currency+' ':''}${new Intl.NumberFormat('es',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(cents)/100)}`;
const date=value=>value?new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',dateStyle:'short',timeStyle:'short'}).format(new Date(value.includes('T')?value:value.replace(' ','T')+'Z')):'—';
const labels={overview:'Resumen',buildings:'Edificios y accesos',customers:'Departamentos',plans:'Planes de internet',billing:'Mensualidades y pagos',payments:'Historial de pagos',network:'Control de acceso',routers:'Routers',activity:'Actividad',settings:'Edificio y automatización',users:'Usuarios y permisos',backups:'Respaldos',audit:'Auditoría'};
const pageFromUrl=()=>Object.hasOwn(labels,location.hash.slice(1))?location.hash.slice(1):'overview';
page=pageFromUrl();
window.addEventListener('hashchange',()=>{
  hidePlans();hideCustomers();hideBilling();hideOperations();hideRouters();page=pageFromUrl();
  const bid=query.building_id;
  query={customer_page:1,invoice_page:1,payment_page:1,search:'',archived:'0'};
  if(bid)query.building_id=bid;
  if(user)void refresh().catch(error=>toast(error.message));
});
const superadmin=()=>user?.role==='superadmin';
const admin=()=>['admin','superadmin'].includes(user?.role),cash=()=>['admin','superadmin'].includes(user?.role),tech=()=>['admin','superadmin'].includes(user?.role);
const superPages=['users','buildings','routers','overview','customers','plans','billing','payments','network','activity','settings','backups','audit'];
const adminPages=['overview','customers','plans','billing','payments','network','routers','activity'];
const allowedPage=p=>superadmin()?superPages.includes(p):adminPages.includes(p);
const landingPage=()=>superadmin()?'users':'overview';
const button=(action,label,id='',secondary=false)=>`<button type="button" data-action="${action}" ${id?`data-id="${id}"`:''} class="${secondary?'secondary':''}">${label}</button>`;
const svg=(inner)=>`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS={phone:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11a9 9 0 0 1-13 8l-5 2 2-5A9 9 0 1 1 21 11Z"/><path d="M8 7c0 5 4 9 8 9l1-3-3-1-1 1-2-2 1-1-1-3Z"/></svg>',
  edit:svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash:svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  power:svg('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),
  activity:svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
  sliders:svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
  server:svg('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
  userPlus:svg('<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>'),
  home:svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  fileText:svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  archive:svg('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>'),
  card:svg('<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'),
  retry:svg('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  key:svg('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
  xCircle:svg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'),
  check:svg('<polyline points="20 6 9 17 4 12"/>'),
};
const iconButton=(action,icon,label,id='',cls='',extra='')=>`<button type="button" data-action="${action}" ${id?`data-id="${id}"`:''} ${extra} class="icon-btn ${cls}" title="${escape(label)}" aria-label="${escape(label)}">${ICONS[icon]||''}</button>`;
const heading=(title,description,buttons='')=>`<div class="title-row"><div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="actions">${buttons}</div></div>`;
const empty=text=>`<div class="empty">${text}</div>`;
const badge=(text,error=false)=>`<span class="badge ${error?'overdue':''}">${text}</span>`;
const networkLabels={simulated:'Simulado',pending:'Pendiente',running:'Aplicando',applied:'Aplicado',failed:'Fallido',legacy_failed:'Fallo histórico'};
window.addEventListener('customer-notice',event=>toast(event.detail));
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',5000);}
async function request(route,body,headers={}){
  const response=await fetch(`/api/${route}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error||'No se pudo completar la operación.');error.status=response.status;if(response.status===401&&user){user=null;state=null;void renderAuth();}throw error;}
  return data;
}
async function refresh(){const version=++requestVersion;const params={...query};for(const k of Object.keys(params))if(params[k]===''||params[k]==null)delete params[k];let result;try{result=await request(`state?${new URLSearchParams(params)}`);}catch(error){if(error.status!==403||!params.building_id)throw error;query={customer_page:1,invoice_page:1,payment_page:1,search:'',archived:'0'};result=await request('state');}if(version!==requestVersion)return;state=result;if(state.active_building_id)query.building_id=state.active_building_id;persistQuery();render();}
async function mutate(route,body){await request(route,body);await refresh();}
function pager(kind){const p=state.pagination[kind],pages=Math.max(1,Math.ceil(p.total/state.pagination.size));return `<div class="actions pagination">${button(`prev-${kind}`,'← Anteriores','',true)}<span>Página ${p.page} de ${pages} · ${p.total} registros</span>${button(`next-${kind}`,'Siguientes →','',true)}</div>`;}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No hay registros.</td></tr>`}</tbody></table></div>`;}
function render(){
  if(!state||!user)return;
  document.body.classList.remove('setup-screen');
  if(!Object.hasOwn(labels,page)||!allowedPage(page))page=landingPage();
  if(location.hash!==`#${page}`){const url=new URL(location.href);url.hash=page;history.replaceState(null,'',url);}
  $('#view').dataset.page=page;$('#view').onclick=null;
  $('#breadcrumb').textContent=labels[page];
  document.querySelectorAll('nav [data-page]').forEach(b=>{b.hidden=!allowedPage(b.dataset.page);b.classList.toggle('selected',b.dataset.page===page);});
  const nav=document.querySelector('nav');
  if(!nav.dataset.order)nav.dataset.order=[...nav.querySelectorAll('[data-page]')].map(b=>b.dataset.page).join(',');
  const order=superadmin()?superPages:nav.dataset.order.split(',');
  for(const id of [...order].reverse()){const btn=nav.querySelector(`[data-page="${id}"]`);if(btn)nav.prepend(btn);}
  const notice=$('#network-notice');notice.hidden=false;notice.textContent=state.enforcement.message || (state.enforcement.enforcing?'Equipo central seleccionado. Las órdenes se procesan en segundo plano; comprueba el resultado de cada departamento.':'Control simulado. El super-admin debe seleccionar un equipo central por edificio.');
  const multi=(state.buildings||[]).length>1;
  const buildingName=(state.buildings?.find(b=>b.id===state.active_building_id)?.name)||state.settings.building_name;
  const select=$('#building-select');
  if(select){
    if(multi){select.hidden=false;select.innerHTML=(state.buildings||[]).map(b=>`<option value="${b.id}" ${b.id===state.active_building_id?'selected':''}>${escape(b.name)}</option>`).join('');}
    else{select.hidden=true;select.innerHTML='';}
  }
  $('.building-name').textContent=multi?'':buildingName+' / ';
  $('#view').hidden=['plans','billing','payments','buildings','settings','users','backups','audit','routers'].includes(page);
  if(page==='plans'){
    hideCustomers();hideBilling();hideOperations();hideRouters();
    $('#view').innerHTML='';
    showPlans({plans:state.plans,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,canEdit:admin(),superadmin:superadmin(),userId:user.id,save:request,refresh});
    return;
  }
  hidePlans();
  if(['overview','customers'].includes(page))showCustomers({customers:state.customers,plans:state.plans,buildingId:state.active_building_id,buildingName,userId:user.id,canEdit:cash(),overview:page==='overview',search:query.search,archived:query.archived,pagination:state.pagination.customers,size:state.pagination.size,money,date,save:request,refresh,showLink:showPortalLinkOnce,filter:async(search,archived)=>{query.search=search;query.archived=archived;query.customer_page=1;await refresh();}});
  else hideCustomers();
  if(page==='billing'||page==='payments'){
    hideOperations();hideRouters();
    $('#view').innerHTML='';
    showBilling({page,invoices:state.invoices,payments:state.payments,pagination:state.pagination,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,today:state.today,customerId:query.customer_id||null,canPay:cash(),isAdmin:admin(),superadmin:superadmin(),userId:user.id,money,date,request,refresh,goto:target=>{page=target;render();},clearStatement:async()=>{delete query.customer_id;query.invoice_page=1;query.payment_page=1;await refresh();},paginate:async(kind,next)=>{query[kind==='invoices'?'invoice_page':'payment_page']=next;await refresh();}});
    return;
  }
  if(['settings','users','backups','audit','buildings'].includes(page)){
    hidePlans();hideCustomers();hideBilling();hideRouters();
    $('#view').innerHTML='';
    showOperations({page,buildings:state.buildings||[],routers:state.routers||[],settings:state.settings,date,superadmin:superadmin(),userId:user.id,request,refresh});
    return;
  }
  hideOperations();
  if(page==='routers'){
    hidePlans();hideCustomers();hideBilling();
    $('#view').innerHTML='';
    showRouters({canManage:superadmin(),userId:user.id,request,refresh});
    return;
  }
  hideRouters();
  let html='';
  if(page==='overview'){
    const s=state.summary;
    const cards=[['Departamentos',s.customers,'Unidades vigentes'],['Servicios activos',s.active,'Estado solicitado; verifica la red'],...(cash()?[['Cobrado este mes',money(s.collected),'Pagos recibidos, excluye reversiones'],['Saldo vencido',money(s.overdue),'Descuenta los abonos recibidos']]:[])];
    html=heading('Tu edificio, conectado.','Administra el servicio de internet desde un solo lugar.','')+`<div class="cards">${cards.map(([title,value,note])=>`<div class="card"><div class="card-label">${title}</div><div class="value">${value}</div><small>${note}</small></div>`).join('')}</div>`;
  }
  if(page==='network')html=heading('Control de acceso','Órdenes persistentes con reintento automático. Una orden fallida permanece visible.',button('refresh','Actualizar','',true))+`<div class="panel">${table(['Departamento','Orden','Resultado','Intentos','Próximo intento','Acción'],state.commands.map(c=>`<tr><td>${escape(c.apartment)}</td><td>${c.action==='activate'?'Activar':'Suspender'}</td><td>${badge(networkLabels[c.status]||c.status,c.status==='failed')}<small>${escape(c.last_error||'')}</small></td><td>${c.attempts}</td><td>${['failed','pending'].includes(c.status)?date(c.next_attempt):'—'}</td><td>${c.status==='failed'&&superadmin()?iconButton('retry','retry','Reintentar',c.id):''}</td></tr>`))}</div>`;
  if(page==='activity')html=heading('Actividad','Últimos 40 movimientos y 20 avisos internos.')+tasksPanel()+`<div class="panel"><h2>Movimientos</h2><ul class="activity">${state.events.map(e=>`<li>${escape(e.message)}<small>${date(e.created_at)} · ${escape(e.actor||'Sistema')}</small></li>`).join('')}</ul></div><div class="panel"><h2>Avisos</h2>${state.notifyChannel==='whatsapp'&&!state.notificationsReady?'<p role="status">WhatsApp está pendiente de configurar el número emisor, las credenciales y la plantilla.</p>':''}<p>Estado de los avisos: interno, pendiente, aceptado por WhatsApp o con incidencias. Aceptado no confirma la entrega al teléfono.</p><ul class="activity">${state.notifications.map(n=>`<li>${escape(n.message)}<small>${escape(n.target)} · ${date(n.created_at)} · ${escape(n.delivery_status||'internal')}${n.last_error?' · '+escape(n.last_error):''}</small></li>`).join('')}</ul></div>`;
  $('#view').innerHTML=html;

}
function tasksPanel(){
  const names={usage:'Consumo',linked:'Vinculación',network:'Red',notifications:'Avisos',overdue:'Vencimientos',billing:'Facturación',reminders:'Recordatorios',backups:'Respaldos',sessions:'Sesiones'};
  const label=name=>names[name]||(String(name).startsWith('router:')?'Router '+String(name).slice(7):name);
  const tasks=(state.automation?.tasks||[]).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const queue=state.automation?.queue||{pending:0,failed:0,oldest:null};
  const oldest=queue.oldest?`, más antigua: ${date(queue.oldest)}`:'';
  return `<div class="panel"><h2>Tareas automáticas</h2><p>Cola de red: ${queue.pending} pendientes, ${queue.failed} fallidas${oldest}.</p>${table(['Tarea','Último éxito','Duración','Último error'],tasks.map(t=>`<tr><td>${escape(label(t.name))}</td><td>${t.last_success?date(t.last_success):'—'}</td><td>${t.duration_ms!=null?t.duration_ms+' ms':'—'}</td><td>${t.last_error?escape(t.last_error):'—'}</td></tr>`))}</div>`;
}
function statementFilter(){return query.customer_id?`<p class="info">Estado de cuenta del departamento seleccionado. ${button('clear-statement','Ver todos','',true)} ${button(page==='billing'?'show-payments':'show-billing',page==='billing'?'Ver pagos':'Ver mensualidades','',true)}</p>`:'';}
const field=(name,label,type='text',extra='',value='')=>`<label>${label}<input name="${name}" type="${type}" required ${extra} value="${escape(value)}"></label>`;
function modal(title,fields,route,extra={},onSave){
  const formBuilding=['plans','customers','billing'].includes(route) && state.active_building_id ? {building_id:state.active_building_id} : {};
  $('#form button[type=submit]').textContent='Guardar';
  $('#modal-title').textContent=title;$('#fields').innerHTML=fields;$('#form-error').textContent='';$('#form').reset();$('#form button[type=submit]').hidden=false;$('#form button[type=submit]').disabled=false;$('#modal').showModal();
  $('#form').onsubmit=async e=>{e.preventDefault();const submit=$('#form button[type=submit]');submit.disabled=true;try{const body={...formBuilding,...Object.fromEntries(new FormData($('#form'))),...extra};for(const key of ['ip','phone','amount','plan_id'])if(body[key]==='')delete body[key];if(body.building_id===''||body.building_id==null)delete body.building_id;if(onSave)await onSave(body);else await mutate(route,body);$('#modal').close();toast('Operación guardada.');}catch(error){$('#form-error').textContent=error.message;}finally{submit.disabled=false;}};
}
$('#close').onclick=$('#cancel').onclick=()=>$('#modal').close();
$('#building-select')?.addEventListener('change',e=>{hidePlans();hideCustomers();hideBilling();hideOperations();hideRouters();query.building_id=Number(e.target.value);query.customer_page=1;query.invoice_page=1;query.payment_page=1;void refresh().catch(err=>toast(err.message));});
// B5: el enlace completo solo se muestra una vez, al emitirlo. El estado solo
// trae metadatos; copiar ahora es la única entrega.
function showPortalLinkOnce(link){showCustomerToken(link.token);}

document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.page){if(!user)return;hidePlans();hideCustomers();hideBilling();hideOperations();hideRouters();page=target.dataset.page;const bid=query.building_id;query={customer_page:1,invoice_page:1,payment_page:1,search:'',archived:'0'};if(bid)query.building_id=bid;try{await refresh();}catch(e){toast(e.message);}return;}
  const action=target.dataset.action;if(!action)return;

  if(action==='logout'){try{await request('auth/logout',{});location.reload();}catch(e){toast(e.message);}return;}
  if(!state)return;
  const id=Number(target.dataset.id),customer=state.customers.find(c=>c.id===id);
  try{
    if(['usage-history','portal-link','rotate-portal-link','change-holder','set-ip','archive','access'].includes(action)){if(customer)openCustomerAction({kind:action,customer,request,refresh,notify:toast});return;}
    if(action==='invoice-whatsapp'||action==='payment-whatsapp') {
      target.disabled=true;try{const result=await request(`${action==='invoice-whatsapp'?'invoices':'payments'}/${id}/send-whatsapp`,{});toast(result.status==='internal'?'Aviso registrado internamente. WhatsApp no está activado.':'Aviso en cola de WhatsApp. Consulta su entrega en Actividad.');}finally{target.disabled=false;}
    }
    if(action==='payment-reports') {
      const reports=await request('payment-reports'+(state.active_building_id?'?building_id='+state.active_building_id:''));
      modal('Transferencias reportadas',table(['Departamento','Importe / referencia','Estado','Revisión'],reports.map(r=>`<tr><td>${escape(r.apartment)}</td><td>${money(r.amount)}<small>${escape(r.reference)}</small><small>${escape(r.notes)}</small></td><td>${escape(r.status)}</td><td>${r.status==='pending'?button('approve-report','Aprobar',r.id)+button('reject-report','Rechazar',r.id,true):''}</td></tr>`)),'');$('#form button[type=submit]').hidden=true;
    }
    if(action==='approve-report'||action==='reject-report') {
      modal('Revisar transferencia',`<p>${action==='approve-report'?'Confirma que verificaste el ingreso bancario. Se abonará a las cuotas más antiguas.':'El reporte se rechazará sin registrar pagos.'}</p><label>Observación<input name="notes" maxlength="300"></label>`,'',{},async body=>{await request('payment-reports/review',{id,status:action==='approve-report'?'approved':'rejected',notes:body.notes});await refresh();});
    }
    if(action==='bank-settings') {
      const bid=state.active_building_id || (state.buildings.length===1?state.buildings[0].id:null);
      if(!bid)throw new Error('Selecciona un edificio en el selector superior.');
      const bank=await request(`buildings/${bid}/bank`);
      modal('Datos bancarios y aviso de corte',Object.entries({bank:'Banco',holder:'Titular',account:'Cuenta / alias',qr_image:'Imagen QR (ruta local o URL HTTPS)',qr_text:'Contenido QR del banco (plantilla opcional con {amount})',suspension_message:'Mensaje de suspensión',contact:'Contacto de administración'}).map(([key,label])=>`<label>${label}<input name="${key}" value="${escape(bank[key]||'')}" maxlength="${key==='qr_text'?2000:key==='qr_image'?1000:key==='suspension_message'?500:key==='bank'?100:160}"></label>`).join(''),'',{},async body=>{await request(`buildings/${bid}/bank`,body);});
    }
    if(action==='new-customer')editCustomer(null);
    if(action==='edit-customer')editCustomer(customer);
    if(action==='overdue'){modal('Revisar vencimientos','<p>¿Revisar vencimientos y solicitar suspensión de servicios en mora, respetando los días de gracia?</p>','',{},async ()=>{await mutate('overdue',{});});document.querySelector('#form button[type=submit]').textContent='Revisar';}
    if(action==='new-billing')modal('Generar mensualidades','<p>Se generan cuotas para departamentos vigentes con plan asignado, sin duplicar periodos.</p>'+field('period','Periodo','month','',state.today.slice(0,7))+field('due','Fecha de vencimiento','date','',state.today),'billing');
    if(action==='pay'){
      const i=state.invoices.find(i=>i.id===id),balance=i.amount-Number(i.paid_total);
      const bank=await request(`invoices/${id}/bank`);
      modal('Registrar pago',`<p>Departamento ${escape(i.apartment)} · ${escape(i.period)}. Saldo: <strong>${money(balance)}</strong>. Vacío = pago total.</p><label>Importe (opcional)<input name="amount" type="number" min="0.01" max="${balance/100}" step="0.01"></label><label>Método<select name="method"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="qr">QR</option><option value="other">Otro</option></select></label><label>Referencia<input name="reference" maxlength="160"></label>${bankHtml(bank,balance,state.currency)}`,'pay',{id,request_key:crypto.randomUUID()});
      void updateBankQr($('#fields'),bank,balance);
      $('#form').elements.amount.addEventListener('input',ev=>{const amount=ev.target.value?Math.round(Number(ev.target.value)*100):balance;$('[data-bank-amount]').textContent=money(amount);void updateBankQr($('#fields'),bank,amount);});
    }
    if(action==='reverse')modal(`Revertir pago #${id}`,'<p>El pago original se conserva. Se reabre el saldo y, si está vencido, se solicita suspensión.</p>'+field('reason','Motivo','text','maxlength="300"'),'payments/reverse',{id});
    if(action==='receipt'){
      const result=await request(`payments/${id}/receipt`),p=result.payment;
      currentReceipt={...p,building_name:p.building_name||result.settings.building_name};
      modal(`Recibo #${id}`,receiptHtml(currentReceipt,state.currency)+'<label>Papel<select id="ticket-width"><option value="80">80 mm</option><option value="58">58 mm</option></select></label><button type="button" data-action="print">Imprimir / guardar PDF</button>','');$('#form button[type=submit]').hidden=true;
    }
    if(action==='print' && currentReceipt)printReceipt(currentReceipt,state.currency,Number($('#ticket-width').value));
    if(action==='retry')await mutate('network/retry',{id});
    if(action==='refresh')await refresh();
    if(action==='statement'){query.customer_id=id;query.invoice_page=1;query.payment_page=1;page='billing';await refresh();}
    if(action==='clear-statement'){delete query.customer_id;query.invoice_page=1;query.payment_page=1;await refresh();}
    if(action==='show-payments'){page='payments';render();}
    if(action==='show-billing'){page='billing';render();}
    if(/^(prev|next)-/.test(action)){
      const [direction,kind]=action.split('-'),p=state.pagination[kind];if(!p)return;
      const key={customers:'customer_page',invoices:'invoice_page',payments:'payment_page'}[kind];
      query[key]=Math.max(1,Math.min(Math.max(1,Math.ceil(p.total/state.pagination.size)),p.page+(direction==='next'?1:-1)));await refresh();
    }
  }catch(error){toast(error.message);}
});
async function initialize(){try{const account=await request('auth/me');user=account.user;if(!user){await renderAuth();return;}updateAccount(user);await refresh();}catch(e){$('#view').innerHTML=empty(escape(e.message));}}
async function renderAuth(){
  hidePlans();hideCustomers();hideBilling();hideOperations();hideRouters(); $('#view').hidden=false;
  user=null;state=null;updateAccount(null,false);$('#network-notice').hidden=true;document.querySelectorAll('nav [data-page]').forEach(b=>b.hidden=true);
  const bs=$('#building-select');if(bs){bs.hidden=true;bs.innerHTML='';}
  $('.building-name').textContent='';
  let status;try{status=await request('auth/status');}catch(e){$('#view').innerHTML=empty(escape(e.message));return;}
  const setup=status.users===0;$('#breadcrumb').textContent=setup?'Crear super-admin':'Iniciar sesión';
  document.body.classList.add('setup-screen');
  $('#view').innerHTML=`<div class="panel auth-panel" aria-labelledby="auth-title">
    <div class="auth-brand"><span class="auth-mark" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg></span><span>Nuwe<strong>Net</strong></span></div>
    <div class="auth-intro"><span class="auth-eyebrow">${setup?'DUEÑO DEL SISTEMA':'TU EDIFICIO, CONECTADO'}</span><h1 id="auth-title">${setup?'Crea tu super-admin':'Bienvenido de nuevo'}</h1>${setup?'<p>Esta cuenta controla todo el sistema y no pertenece a ningún edificio. Luego dará de alta a los administradores.</p>':'<p>Ingresa a tu cuenta para continuar administrando tu edificio.</p>'}</div>
    <form id="auth-form">
      <label for="auth-user">Usuario</label><input id="auth-user" name="username" placeholder="${setup?'Elige tu usuario':'Tu usuario o correo'}" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="160">
      <label for="auth-pass">Contraseña</label><div class="auth-password"><input id="auth-pass" name="password" type="password" placeholder="${setup?'Crea una contraseña':'Tu contraseña'}" autocomplete="${setup?'new-password':'current-password'}" ${setup?'aria-describedby="auth-password-hint"':''} required minlength="${setup?8:1}" maxlength="256"><button id="auth-show-password" type="button" aria-controls="auth-pass" aria-pressed="false" aria-label="Mostrar contraseña">Mostrar</button></div>
      ${setup?'<p id="auth-password-hint" class="auth-hint">Usa al menos 8 caracteres.</p><details class="auth-installation"><summary>Tengo un código de instalación</summary><label for="setup-token">Código de instalación</label><input id="setup-token" type="password" autocomplete="off" placeholder="Ingresa tu código"><p class="auth-hint">Solo es necesario si se configuró para este edificio.</p></details>':''}
      <p id="auth-error" role="alert"></p><button id="auth-go" class="auth-submit" type="submit">${setup?'Crear y entrar':'Entrar'}<span aria-hidden="true">→</span></button>
      </form><fieldset class="theme-choices auth-theme"><legend>Tema</legend><label><input type="radio" name="theme-choice" value="light"> Claro</label><label><input type="radio" name="theme-choice" value="dark"> Oscuro</label><label><input type="radio" name="theme-choice" value="system"> Sistema</label></fieldset><p class="auth-footer">${setup?'Tu cuenta tendrá acceso a la administración del edificio.':'NuweNet · Gestión de internet para tu edificio'}</p>
  </div>`;
  document.querySelectorAll('#view input[name="theme-choice"]').forEach(radio=>radio.addEventListener('change',()=>setTheme(radio.value)));
  syncThemeControls();
  $('#auth-show-password').onclick=()=>{const input=$('#auth-pass'),show=input.type==='password';input.type=show?'text':'password';const toggle=$('#auth-show-password');toggle.textContent=show?'Ocultar':'Mostrar';toggle.setAttribute('aria-pressed',String(show));toggle.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');};
  $('#auth-form').onsubmit=async e=>{e.preventDefault();const submit=$('#auth-go'),label=submit.innerHTML;submit.disabled=true;submit.textContent=setup?'Creando tu cuenta…':'Ingresando…';$('#auth-form').setAttribute('aria-busy','true');$('#auth-error').textContent='';try{const credentials={username:$('#auth-user').value,password:$('#auth-pass').value};if(setup)await request('auth/setup',credentials,{'X-Setup-Token':$('#setup-token').value});await request('auth/login',credentials);await initialize();}catch(error){$('#auth-error').textContent=error.message;submit.disabled=false;submit.innerHTML=label;$('#auth-form').setAttribute('aria-busy','false');}};
}
setInterval(()=>{if(user&&page==='network'&&!document.querySelector('dialog[open]'))void refresh().catch(()=>{});},10000);
void initialize();
