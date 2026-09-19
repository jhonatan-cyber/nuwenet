import { openCustomerAction, showCustomerToken } from '../features/customers/customer-actions-store';
import { showCustomers, hideCustomers, editCustomer } from '../features/customers/customers-store';
import { showPlans, hidePlans } from '../features/plans/plans-store';
import { showBilling, hideBilling } from '../features/billing/billing-store';
import { showOperations, hideOperations } from '../features/operations/operations-store';
import { showRouters, hideRouters } from '../features/routers-network/routers-store';
import { showOverview, hideOverview } from '../features/overview/overview-store';
import { emptyMarkup, escape } from '../lib/html';
import { pages, canView, isSection, landingSection, resolveSection, overviewView, type PanelId } from '../lib/pages';
import type { OperationsPage } from '../features/operations/operations-store';
import type { CustomerAction } from '../features/customers/customer-actions-store';
import { defaultQuery, queryFromSearch, queryParams, resetQuery, selectBuilding, type PanelQuery } from '../shared/lib/panel-query';
import { renderAuthScreen } from './auth-screen';
import { updateAccount } from './account';

interface DashboardUser {
  id: string;
  role: string;
  username: string;
}
interface RequestError extends Error {
  status?: number;
}

let refreshController: AbortController | undefined, reusableSnapshot: { key: string; data: any } | undefined;
const viewKey = (): string => JSON.stringify([user?.id, page, query]);
let state: any, user: DashboardUser | null, requestVersion = 0, buildingName = '';
let page: string = isSection(location.hash.slice(1)) ? location.hash.slice(1) : landingSection(false);
let query: PanelQuery = queryFromSearch(location.search);
function persistQuery(): void { const url = new URL(location.href); url.search = queryParams(query).toString(); history.replaceState(null, '', url); }
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
const money = (cents: number | string): string => `${state?.currency ? state.currency + ' ' : ''}${new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cents) / 100)}`;
const date = (value: string | null | undefined): string => value ? new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')) : '—';
const superadmin = (): boolean => user?.role === 'superadmin';
const admin = (): boolean => ['admin', 'superadmin'].includes(user?.role ?? ''), cash = (): boolean => ['admin', 'superadmin'].includes(user?.role ?? '');
const hidePanel: Record<PanelId, () => void> = { plans: hidePlans, customers: hideCustomers, billing: hideBilling, operations: hideOperations, routers: hideRouters, overview: hideOverview };
function hidePanels(): void { for (const hide of Object.values(hidePanel)) hide(); }
window.addEventListener('customer-notice', (event) => toast((event as CustomEvent<string>).detail));
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, tone = 'info'): void { const el = $<HTMLElement>('#toast'); el.textContent = message; el.dataset.tone = tone; el.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; el.dataset.tone = 'info'; }, tone === 'error' ? 8000 : 5000); }
async function request(route: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<any> {
  const key=viewKey(),version=requestVersion;
  if(body!==undefined)reusableSnapshot=undefined;
  const response=await fetch(`/api/${route}`,body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) { const error = new Error((data as { error?: string }).error || 'No se pudo completar la operación.') as RequestError; error.status = response.status; if (response.status === 401 && user) { user = null; state = null; void renderAuth(); } throw error; }
  if(body!==undefined && data?.pagination && key===viewKey() && version===requestVersion &&
    !query.search && query.archived!=='1' && !query.customer_id &&
    (['customer_page', 'invoice_page', 'payment_page'] as const).every((k) => !query[k] || query[k] === 1) &&
    String(data.active_building_id||'')===String(query.building_id||''))reusableSnapshot={key,data};
  return data;
}
async function refresh({ background = false }: { background?: boolean } = {}): Promise<void> {
  if(background && refreshController)return;
  const key=viewKey(),cached=reusableSnapshot;reusableSnapshot=undefined;
  refreshController?.abort();
  const controller=new AbortController();refreshController=controller;
  const version=++requestVersion;
  const section=()=>resolveSection(page,superadmin());
  try{
    if (superadmin()) delete query.building_id;
    let result;
    if(cached?.key===key)result=cached.data;
    else try { result = await request(`state?${queryParams(query, { section: section() })}`, undefined, {}, controller.signal); }
    catch (error) {
      const err = error as RequestError;
      if (err.status !== 403 || !query.building_id) throw error;
      query = defaultQuery();
      result = await request(`state?section=${section()}`, undefined, {}, controller.signal);
    }
    if (version !== requestVersion || !user) return;
    state = result; if (state.active_building_id && !superadmin()) query.building_id = state.active_building_id;
    persistQuery(); render();
  } catch (error) { if ((error as RequestError).name !== 'AbortError') throw error; }
  finally { if (refreshController === controller) refreshController = undefined; }
}
// Each panel receives the slice of state it renders; the section registry decides
// which of them are mounted for the active page.
const mountPanel: Record<PanelId, (definition?: any) => void> = {
  customers:(definition)=>showCustomers({customers:state.customers,plans:state.plans,buildingId:state.active_building_id,buildingName,buildings:state.buildings||[],userId:user!.id,canEdit:cash(),overview:Boolean(definition?.cards),search:query.search,archived:query.archived,pagination:state.pagination.customers,size:state.pagination.size,money,date,save:request,refresh,showLink:showPortalLinkOnce,filter:async(search,archived)=>{query.search=search;query.archived=archived;query.customer_page=1;await refresh();},paginate:async(next)=>{query.customer_page=next;await refresh();}}),
  overview:()=>showOverview({page:overviewView(page),summary:state.summary,commands:state.commands||[],events:state.events||[],automation:state.automation||{tasks:[],queue:{pending:0,failed:0,oldest:null}},isAdmin:admin(),superadmin:superadmin(),userId:user!.id,money,date,request,refresh}),
  plans:()=>showPlans({plans:state.plans,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,canEdit:admin(),superadmin:superadmin(),userId:user!.id,save:request,refresh}),
  billing:()=>showBilling({page:page as 'billing'|'payments',invoices:state.invoices,payments:state.payments,pagination:state.pagination,buildings:state.buildings||[],buildingId:state.active_building_id,currency:state.currency,today:state.today,customerId:query.customer_id||null,canPay:cash(),isAdmin:admin(),superadmin:superadmin(),userId:user!.id,money,date,request,refresh,goto:target=>{page=target;void refresh().catch(error=>toast((error as Error).message,'error'));},clearStatement:async()=>{delete query.customer_id;query.invoice_page=1;query.payment_page=1;await refresh();},paginate:async(kind,next)=>{query[kind==='invoices'?'invoice_page':'payment_page']=next;await refresh();}}),
  operations:()=>showOperations({page:page as OperationsPage,buildings:state.buildings||[],routers:state.routers||[],settings:state.settings,date,superadmin:superadmin(),userId:user!.id,request,refresh}),
  routers:()=>showRouters({canManage:superadmin(),userId:user!.id,request,refresh}),
};
function render(): void {
  if (!state || !user) return;
  document.body.classList.remove('setup-screen');
  page = resolveSection(page, superadmin());
  if (location.hash !== `#${page}`) { const url = new URL(location.href); url.hash = page; history.replaceState(null, '', url); }
  const definition = pages[page];
  const view = $<HTMLElement>('#view');
  view.dataset.page = page; view.onclick = null;
  $<HTMLElement>('#breadcrumb').textContent = definition.label;
  document.querySelectorAll('nav [data-page]').forEach((b) => { const el = b as HTMLElement; el.hidden = !canView((el.dataset.page as string), superadmin()); el.dataset.selected = String(el.dataset.page === page); });
  // El orden y los grupos los define el servidor (Sidebar.astro); aquí solo visibilidad y selección.
  // El super-admin ve todo el sistema y no filtra por edificio: sin selector en el navbar.
  const isSuper = superadmin();
  const multi = (state.buildings || []).length > 1 && !isSuper;
  buildingName = (state.buildings?.find((b: any) => b.id === state.active_building_id)?.name) || state.settings.building_name;
  const select = $<HTMLSelectElement>('#building-select');
  if (select) {
    if (multi) { select.hidden = false; select.innerHTML = (state.buildings || []).map((b: any) => `<option value="${b.id}" ${b.id === state.active_building_id ? 'selected' : ''}>${escape(b.name)}</option>`).join(''); }
    else { select.hidden = true; select.innerHTML = ''; }
  }
  $<HTMLElement>('.building-name').textContent = (multi || isSuper) ? '' : buildingName + ' / ';
  // Panels are React islands; #view queda solo para la autenticación.
  view.hidden = true; view.innerHTML = '';
  for (const [id, hide] of Object.entries(hidePanel) as [PanelId, () => void][]) if (!definition.panels.includes(id)) hide();
  for (const id of definition.panels) mountPanel[id](definition);
}
// B5: el enlace completo solo se muestra una vez, al emitirlo. El estado solo
// trae metadatos; copiar ahora es la única entrega.
function showPortalLinkOnce(link: { token: string }): void { showCustomerToken(link.token); }

const pageFromHash = (): string => isSection(location.hash.slice(1)) ? location.hash.slice(1) : landingSection(false);
// Cambio de edificio activo: conserva filtros y departamento elegido, reinicia la paginación.
$<HTMLSelectElement>('#building-select')?.addEventListener('change', (event) => {
  hidePanels();
  query = selectBuilding(query, (event.target as HTMLSelectElement).value);
  void refresh().catch((error) => toast((error as Error).message, 'error'));
});
document.addEventListener('click', async (event) => {
  const target = (event.target as HTMLElement).closest('[data-action], [data-slot="button"][data-action]') as HTMLElement | null;
  if (target) {
    const action = target.dataset.action;
    if (action) {
      if (action === 'logout') { try { await request('auth/logout', {}); location.reload(); } catch (e) { toast((e as Error).message, 'error'); } return; }
      if (!state) return;
      const id = target.dataset.id || '', customer = state.customers.find((c: any) => c.id === id);
      try {
        if (['usage-history', 'portal-link', 'rotate-portal-link', 'change-holder', 'set-ip', 'archive', 'access'].includes(action)) { if (customer) openCustomerAction({ kind: action as CustomerAction, customer, request, refresh, notify: toast }); return; }

        if (action === 'new-customer') editCustomer(null);
        if (action === 'edit-customer') editCustomer(customer || null);
        if (action === 'statement') { query.customer_id = id; query.invoice_page = 1; query.payment_page = 1; page = 'billing'; await refresh(); }
      } catch (error) { toast((error as Error).message, 'error'); }
      return;
    }
  }
  const button = (event.target as HTMLElement).closest('button');
  if (!button) return;
  if (button.dataset.page) { if (!user) return; hidePanels(); page = button.dataset.page as string; query = resetQuery(query); try { await refresh(); } catch (e) { toast((e as Error).message, 'error'); } return; }
});
window.addEventListener('hashchange', () => {
  hidePanels(); page = pageFromHash(); query = resetQuery(query);
  if (user) void refresh().catch((error) => toast((error as Error).message, 'error'));
});
async function initialize(): Promise<void> { try { const account = await request('auth/me'); user = account.user; if (!user) { await renderAuth(); return; } updateAccount(user); await refresh(); } catch (e) { $<HTMLElement>('#view').innerHTML = emptyMarkup(escape((e as Error).message)); } }
async function renderAuth(): Promise<void> {
  hidePanels();
  user = null; state = null; updateAccount(null, false);
  document.querySelectorAll('nav [data-page]').forEach((b) => { (b as HTMLElement).hidden = true; });
  const select = $<HTMLSelectElement>('#building-select'); if (select) { select.hidden = true; select.innerHTML = ''; }
  $<HTMLElement>('.building-name').textContent = '';
  await renderAuthScreen({ request, onAuthenticated: initialize });
}
function pollNetwork(): void { if (user && page === 'network' && !document.hidden && !document.querySelector('dialog[open],[role=dialog]')) void refresh({ background: true }).catch(() => {}); }
let networkTimer = setInterval(pollNetwork, 10000);
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (page === 'network') refreshController?.abort(); } else pollNetwork(); });
window.addEventListener('pagehide', () => { clearInterval(networkTimer); refreshController?.abort(); });
window.addEventListener('pageshow', (event) => { if ((event as PageTransitionEvent).persisted) { networkTimer = setInterval(pollNetwork, 10000); pollNetwork(); } });
void initialize();
