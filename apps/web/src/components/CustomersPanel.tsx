import { useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { FormError, StatusText } from '@/components/panel-shell';
import { closeCustomer, editCustomer, getCustomers, getServerCustomers, subscribeCustomers, type Customer, type CustomersContext } from '@/lib/customers-store';
import type { Plan } from '@/lib/plans-store';

function CustomerEditor({ customer, context }: { customer: Customer | null; context: CustomersContext }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [buildingId, setBuildingId] = useState(customer?.building_id || context.buildingId);
  const [plans, setPlans] = useState<Plan[]>(context.plans);
  const [plansNotice, setPlansNotice] = useState('');
  const sending = useRef(false);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const multiBuilding = !customer && context.buildings.length > 1;
  async function changeBuilding(id: string) {
    setBuildingId(id); setPlansNotice('');
    if (id === context.buildingId) { setPlans(context.plans); return; }
    try {
      const data = await (context.save as unknown as (route: string) => Promise<{ plans?: Plan[] }>)(
        `state?building_id=${id}&section=customers`);
      setPlans(Array.isArray(data?.plans) ? data.plans : []);
    } catch { setPlans([]); setPlansNotice('No se pudieron cargar los planes de ese edificio; elige Sin plan o reintenta.'); }
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values = new FormData(event.currentTarget);
    const apartment = String(values.get('apartment') || '').trim();
    if (!apartment) { setError('Escribe el departamento.'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      const result = await context.save(customer ? 'customers/update' : 'customers', {
        apartment, name: String(values.get('name') || '').trim(), phone: String(values.get('phone') || '').trim(),
        plan_id: values.get('plan_id') ? String(values.get('plan_id')) : null,
        ...(customer ? { id: customer.id } : { building_id: buildingId, ...(values.get('ip') ? { ip: String(values.get('ip')).trim() } : {}) }),
      });
      closeCustomer();
      // Deliver the one-time token even when refreshing the list fails.
      if (result?.portal_link?.token) setTimeout(() => context.showLink(result.portal_link!), 0);
      if (!customer && buildingId !== context.buildingId) {
        const name = context.buildings.find(b => b.id === buildingId)?.name || 'otro edificio';
        window.dispatchEvent(new CustomEvent('customer-notice', { detail: `Departamento creado en ${name}. Cambia de edificio para verlo.` }));
      }
      void context.refresh().catch(() => window.dispatchEvent(new CustomEvent('customer-notice', { detail: 'El departamento se guardó, pero no se pudo actualizar el listado. Usa Actualizar.' })));
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el departamento.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) closeCustomer(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>{customer ? 'Editar departamento' : 'Agregar departamento'}</DialogTitle><DialogDescription>{customer ? 'Corrige los datos y el plan. Para un nuevo ocupante, usa Cambio de titular en Portal del residente.' : 'Elige el edificio (el departamento puede repetirse en otro edificio, pero no en el mismo). Al guardar se mostrará su enlace de portal una sola vez.'}</DialogDescription></DialogHeader>
      <DialogBody><form id="customer-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        {multiBuilding ? <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="customer-building">Edificio</label><NativeSelect id="customer-building" value={buildingId} onChange={event => { void changeBuilding(event.target.value); }} disabled={pending}>{context.buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></div> : <p className="text-sm text-muted-foreground">Edificio: {customer ? context.buildings.find(b => b.id === customer.building_id)?.name || context.buildingName : context.buildingName}</p>}
        {([{ name: 'apartment', label: 'Departamento', value: customer?.apartment, required: true, max: 160 }, { name: 'name', label: 'Nombre del titular (opcional)', value: customer?.name, max: 160 }, { name: 'phone', label: 'Teléfono (opcional)', value: customer?.phone, max: 80 }] as const).map(field => <div key={field.name} className="grid gap-2"><label className="text-sm font-medium" htmlFor={`customer-${field.name}`}>{field.label}</label><Input id={`customer-${field.name}`} name={field.name} required={field.name === 'apartment'} maxLength={field.max} defaultValue={field.value || ''} disabled={pending} /></div>)}
        <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="customer-plan">Plan de internet (opcional)</label><NativeSelect id="customer-plan" name="plan_id" defaultValue={customer ? customer.plan_id ?? '' : plans[0]?.id ?? ''} disabled={pending}><NativeSelectOption value="">Sin plan</NativeSelectOption>{plans.map(plan => <NativeSelectOption key={plan.id} value={plan.id}>{plan.name} · {context.money(plan.price)}</NativeSelectOption>)}</NativeSelect>{plansNotice && <p className="text-sm text-muted-foreground">{plansNotice}</p>}</div>
        {!customer && <div className="grid gap-2"><label className="text-sm font-medium" htmlFor="customer-ip">IP privada (opcional)</label><Input id="customer-ip" name="ip" placeholder="192.168.88.50" disabled={pending} /></div>}
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" disabled={pending} onClick={closeCustomer}>Cancelar</Button><Button type="submit" form="customer-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
const networkLabels: Record<string, string> = { simulated: 'Simulado', pending: 'Pendiente', running: 'Aplicando', applied: 'Aplicado', failed: 'Fallido', legacy_failed: 'Fallo histórico' };
function CustomersView({ context, draft }: { context: CustomersContext; draft: Customer | null | undefined }) {
  const [search, setSearch] = useState(context.search);
  const [notice, setNotice] = useState('');
  const pages = Math.max(1, Math.ceil(context.pagination.total / context.size));
  const action = (customer: Customer, name: string, label: string) => <Button key={name} type="button" variant="outline" size="sm" data-action={name} data-id={customer.id}>{label}</Button>;
  return <div id="customers-panel" className="grid gap-4 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="grid gap-2">{context.overview ? <h2 className="text-2xl font-semibold">Departamentos</h2> : <h1 className="text-2xl font-semibold">Departamentos</h1>}<p className="text-sm text-muted-foreground">Edita datos y planes; archiva conservando el historial.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { void context.refresh().catch(() => setNotice('No se pudo actualizar el listado.')); }}>Actualizar</Button>{context.canEdit && <Button onClick={() => editCustomer(null)}>Agregar departamento</Button>}</div></div>
    {!context.overview && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void context.filter(search, context.archived).catch(() => setNotice('No se pudo buscar. Reintenta.')); }}><div className="grid flex-1 gap-2"><label className="text-sm" htmlFor="customer-search">Buscar departamento</label><Input id="customer-search" placeholder="Departamento o titular" maxLength={160} value={search} onChange={event => setSearch(event.target.value)} /></div><Button type="submit" variant="outline">Buscar</Button><div className="grid gap-2"><label className="text-sm" htmlFor="archived-filter">Mostrar</label><NativeSelect id="archived-filter" value={context.archived} onChange={event => { void context.filter(search, event.target.value).catch(() => setNotice('No se pudo cambiar el filtro.')); }}><NativeSelectOption value="0">Vigentes</NativeSelectOption><NativeSelectOption value="1">Archivados</NativeSelectOption></NativeSelect></div></form>}
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{context.customers.map(customer => <Card key={customer.id} data-customer-id={customer.id} className="min-w-0">
      <CardHeader><h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{customer.apartment}</h3><p className="text-sm [overflow-wrap:anywhere]">{customer.name || 'Vacío · sin titular'}</p>{context.buildings.length > 1 && <p className="text-sm text-muted-foreground">{context.buildings.find(b => b.id === customer.building_id)?.name || `Edificio ${customer.building_id}`}</p>}{customer.phone && <p className="text-sm text-muted-foreground">{customer.phone}</p>}</CardHeader>
      <CardContent className="grid gap-4"><div className="grid gap-2 text-sm"><p>{customer.plan_name || 'Sin plan'} · {customer.down != null && customer.up != null ? `${customer.down} / ${customer.up} Mbps` : 'Sin velocidad asignada'}</p><p>{customer.ip || 'Sin IP'}</p><StatusText>{customer.status === 'suspended' ? 'Suspensión solicitada' : 'Servicio activo'}</StatusText><p className="text-muted-foreground">{customer.manual_hold ? 'Bloqueo manual · ' : ''}{networkLabels[customer.network_state] || 'Sin verificar'}{customer.network_checked_at ? ` · ${context.date(customer.network_checked_at)}` : ''}</p><p>{Number(customer.debt) > 0 ? `Debe ${context.money(customer.debt)}` : '● Al día'}</p></div>
      {context.canEdit && <div className="flex flex-wrap gap-2">{action(customer, 'usage-history', 'Consumo mensual')}{action(customer, 'portal-link', 'Portal del residente')}<Button variant="outline" size="sm" onClick={() => editCustomer(customer)}>Editar</Button>{action(customer, 'statement', 'Estado de cuenta')}{action(customer, 'set-ip', 'Cambiar IP')}{action(customer, 'archive', customer.archived ? 'Restaurar' : 'Archivar')}{!customer.archived && action(customer, 'access', customer.status === 'active' ? 'Cortar internet' : 'Reactivar internet')}</div>}</CardContent>
    </Card>)}</div>
    {!context.customers.length && <Card><CardContent><p className="text-sm text-muted-foreground">No hay registros.</p></CardContent></Card>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" data-action="prev-customers" disabled={context.pagination.page <= 1}>← Anteriores</Button><p className="text-sm">Página {context.pagination.page} de {pages} · {context.pagination.total} registros</p><Button variant="outline" data-action="next-customers" disabled={context.pagination.page >= pages}>Siguientes →</Button></div>
    {draft !== undefined && <CustomerEditor customer={draft} context={context} />}
  </div>;
}
export default function CustomersPanel() {
  const state = useSyncExternalStore(subscribeCustomers, getCustomers, getServerCustomers);
  return state.context ? <CustomersView key={`${state.context.userId}:${state.context.buildingId}:${state.context.overview}`} context={state.context} draft={state.draft} /> : null;
}
