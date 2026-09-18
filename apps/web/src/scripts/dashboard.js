import { openCustomerAction, showCustomerToken } from '../lib/customer-actions-store';
import { showCustomers, hideCustomers, editCustomer } from '../lib/customers-store';
import { showPlans, hidePlans } from '../lib/plans-store';
import { showBilling, hideBilling } from '../lib/billing-store';
import { showOperations, hideOperations } from '../lib/operations-store';
import { showRouters, hideRouters } from '../lib/routers-store';
import { showOverview, hideOverview } from '../lib/overview-store';
import { emptyMarkup, escape } from '../lib/html.js';
import { pages, canView, isSection, landingSection, resolveSection, sectionOrder } from '../lib/pages';
import { defaultQuery, queryFromSearch, queryParams, resetQuery, selectBuilding } from '../lib/panel-query';
import { renderAuthScreen } from './auth-screen.js';
import { updateAccount } from './account.js';

let refreshController, reusableSnapshot;
const viewKey=()=>JSON.stringify([user?.id,page,query]);
let state,user,requestVersion=0,buildingName='';
let page=isSection(location.hash.slice(1))?location.hash.slice(1):landingSection(false);
let query=queryFromSearch(location.search);
function persistQuery(){const url=new URL(location.href);url.search=queryParams(query).toString();history.replaceState(null,'',url);}
const $=selector=>document.querySelector(selector);
const money=cents=>`${state?.currency?state.currency+' ':''}${new Intl.NumberFormat('es',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(cents)/100)}`;
const date=value=>value?new Intl.DateTimeFormat('es-BO',{timeZone:'America/La_Paz',dateStyle:'short',timeStyle:'short'}).format(new Date(value.includes('T')?value:value.replace(' ','T')+'Z')):'—';
const superadmin=()=>user?.role==='superadmin';
const admin=()=>['admin','superadmin'].includes(user?.role),cash=()=>['admin','superadmin'].includes(user?.role);
const hidePanel={plans:hidePlans,customers:hideCustomers,billing:hideBilling,operations:hideOperations,routers:hideRouters,overview:hideOverview};
function hidePanels(){for(const hide of Object.values(hidePanel))hide();}
window.addEventListener('customer-notice',event=>toast(event.detail));
function toast(message,tone='info'){const el=$('#toast');el.textContent=message;el.dataset.tone=tone;el.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>{el.style.display='none';el.dataset.tone='info';},tone==='error'?8000:5000);}
async function request(route,body,headers={},signal){
  const key=viewKey(),version=requestVersion;
  if(body!==undefined)reusableSnapshot=undefined;
  const response=await fetch(`/api/${route}`,body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error||'No se pudo completar la operación.');error.status=response.status;if(response.status===401&&user){user=null;state=null;void renderAuth();}throw error;}
  if(body!==undefined && data?.pagination && key===viewKey() && version===requestVersion &&
    !query.search && query.archived!=='1' && !query.customer_id &&
    ['customer_page','invoice_page','payment_page'].every(k=>!query[k]||query[k]===1) &&
    String(data.active_building_id||'')===String(query.building_id||''))reusableSnapshot={key,data};
  return data;
}
async function refresh({background=false}={}){
  if(background && refreshController)return;
  const key=viewKey(),cached=reusableSnapshot;reusableSnapshot=undefined;
  refreshController?.abort();
  const controller=new AbortController();refreshController=controller;
  const version=++requestVersion;
  const section=()=>resolveSection(page,superadmin());
  try{
    let result;
    if(cached?.key===key)result=cached.data;
    else try{result=await request(`state?${queryParams(query,{section:section()})}`,undefined,{},controller.signal);}
    catch(error){
      if(error.status!==403||!query.building_id)throw error;
      query=defaultQuery();
      result=await request(`state?section=${section()}`,undefined,{},controller.signal);
    }
    if(version!==requestVersion||!user)return;
    state=result;if(state.active_building_id)query.building_id=state.active_building_id;
    persistQuery();render();
  }catch(error){if(error.name!=='AbortError')throw error;}
  finally{if(refreshController===controller)refreshController=undefined;}
}
// Each panel receives the slice of state it renders; the section registry decides
// which of them are mounted for the active page.
const mountPanel={
  customers:definition=>showCustomers({customers:state.customers,plans:state.plans,buildingId:state.active_building_id,buildingName,buildings:state.buildings||[],userId:user.id,canEdit:cash(),overview:Boolean(definition.cards),search:query.search,archived:query.archived,pagination:state.pagination.customers,size:state.pagination.size,money,date,save:request,refresh,showLink:showPortalLinkOnce,filter:async(search,archived)=>{query.search=search;query.archived=archived;query.customer_page=1;await refresh();}}),
  overview:()=>showOverview({page,summary:state.summary,commands:state.commands||[],events:state.events||[],automation:state.automation||{tasks:[],queue:{pending:0,failed:0,oldest:null}},isAdmin:admin(),superadmin:superadmin(),userId:user.id,money,date,request,refresh}),
  plans:()=>showPlans({plans:state.plans,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,canEdit:admin(),superadmin:superadmin(),userId:user.id,save:request,refresh}),
  billing:()=>showBilling({page,invoices:state.invoices,payments:state.payments,pagination:state.pagination,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,today:state.today,customerId:query.customer_id||null,canPay:cash(),isAdmin:admin(),superadmin:superadmin(),userId:user.id,money,date,request,refresh,goto:target=>{page=target;void refresh().catch(error=>toast(error.message,'error'));},clearStatement:async()=>{delete query.customer_id;query.invoice_page=1;query.payment_page=1;await refresh();},paginate:async(kind,next)=>{query[kind==='invoices'?'invoice_page':'payment_page']=next;await refresh();}}),
  operations:()=>showOperations({page,buildings:state.buildings||[],routers:state.routers||[],settings:state.settings,date,superadmin:superadmin(),userId:user.id,request,refresh}),
  routers:()=>showRouters({canManage:superadmin(),userId:user.id,request,refresh}),
};
function render(){
  if(!state||!user)return;
  document.body.classList.remove('setup-screen');
  page=resolveSection(page,superadmin());
  if(location.hash!==`#${page}`){const url=new URL(location.href);url.hash=page;history.replaceState(null,'',url);}
  const definition=pages[page];
  $('#view').dataset.page=page;$('#view').onclick=null;
  $('#breadcrumb').textContent=definition.label;
  document.querySelectorAll('nav [data-page]').forEach(b=>{b.hidden=!canView(b.dataset.page,superadmin());b.dataset.selected=String(b.dataset.page===page);});
  const nav=document.querySelector('nav');
  if(!nav.dataset.order)nav.dataset.order=[...nav.querySelectorAll('[data-page]')].map(b=>b.dataset.page).join(',');
  const order=superadmin()?sectionOrder:nav.dataset.order.split(',');
  for(const id of [...order].reverse()){const btn=nav.querySelector(`[data-page="${id}"]`);if(btn)nav.prepend(btn);}
  const multi=(state.buildings||[]).length>1;
  buildingName=(state.buildings?.find(b=>b.id===state.active_building_id)?.name)||state.settings.building_name;
  const select=$('#building-select');
  if(select){
    if(multi){select.hidden=false;select.innerHTML=(state.buildings||[]).map(b=>`<option value="${b.id}" ${b.id===state.active_building_id?'selected':''}>${escape(b.name)}</option>`).join('');}
    else{select.hidden=true;select.innerHTML='';}
  }
  $('.building-name').textContent=multi?'':buildingName+' / ';
  // Panels are React islands; #view queda solo para la autenticación.
  $('#view').hidden=true;$('#view').innerHTML='';
  for(const [id,hide] of Object.entries(hidePanel))if(!definition.panels.includes(id))hide();
  for(const id of definition.panels)mountPanel[id](definition);
}
// B5: el enlace completo solo se muestra una vez, al emitirlo. El estado solo
// trae metadatos; copiar ahora es la única entrega.
function showPortalLinkOnce(link){showCustomerToken(link.token);}

const pageFromHash=()=>isSection(location.hash.slice(1))?location.hash.slice(1):landingSection(false);
// Cambio de edificio activo: conserva filtros y departamento elegido, reinicia la paginación.
$('#building-select')?.addEventListener('change',event=>{
  hidePanels();
  query=selectBuilding(query,event.target.value);
  void refresh().catch(error=>toast(error.message,'error'));
});
document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.dataset.page){if(!user)return;hidePanels();page=target.dataset.page;query=resetQuery(query);try{await refresh();}catch(e){toast(e.message,'error');}return;}
  const action=target.dataset.action;if(!action)return;

  if(action==='logout'){try{await request('auth/logout',{});location.reload();}catch(e){toast(e.message,'error');}return;}
  if(!state)return;
  const id=target.dataset.id||'',customer=state.customers.find(c=>c.id===id);
  try{
    if(['usage-history','portal-link','rotate-portal-link','change-holder','set-ip','archive','access'].includes(action)){if(customer)openCustomerAction({kind:action,customer,request,refresh,notify:toast});return;}

    if(action==='new-customer')editCustomer(null);
    if(action==='edit-customer')editCustomer(customer||null);
    if(action==='statement'){query.customer_id=id;query.invoice_page=1;query.payment_page=1;page='billing';await refresh();}
    if(/^(prev|next)-/.test(action)){
      const [direction,kind]=action.split('-'),p=state.pagination[kind];if(!p)return;
      const key={customers:'customer_page',invoices:'invoice_page',payments:'payment_page'}[kind];
      query[key]=Math.max(1,Math.min(Math.max(1,Math.ceil(p.total/state.pagination.size)),p.page+(direction==='next'?1:-1)));await refresh();
    }
  }catch(error){toast(error.message,'error');}
});
window.addEventListener('hashchange',()=>{
  hidePanels();page=pageFromHash();query=resetQuery(query);
  if(user)void refresh().catch(error=>toast(error.message,'error'));
});
async function initialize(){try{const account=await request('auth/me');user=account.user;if(!user){await renderAuth();return;}updateAccount(user);await refresh();}catch(e){$('#view').innerHTML=emptyMarkup(escape(e.message));}}
async function renderAuth(){
  hidePanels();
  user=null;state=null;updateAccount(null,false);
  document.querySelectorAll('nav [data-page]').forEach(b=>b.hidden=true);
  const select=$('#building-select');if(select){select.hidden=true;select.innerHTML='';}
  $('.building-name').textContent='';
  await renderAuthScreen({request,onAuthenticated:initialize});
}
function pollNetwork(){if(user&&page==='network'&&!document.hidden&&!document.querySelector('dialog[open],[role=dialog]'))void refresh({background:true}).catch(()=>{});}
let networkTimer=setInterval(pollNetwork,10000);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(page==='network')refreshController?.abort();}else pollNetwork();});
window.addEventListener('pagehide',()=>{clearInterval(networkTimer);refreshController?.abort();});
window.addEventListener('pageshow',event=>{if(event.persisted){networkTimer=setInterval(pollNetwork,10000);pollNetwork();}});
void initialize();
