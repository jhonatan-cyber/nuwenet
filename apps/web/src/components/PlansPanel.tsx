import { useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { getPlans, getServerPlans, subscribePlans, type Plan, type PlansContext } from '@/lib/plans-store';

function PlanEditor({ plan, context, close, saved, restoreFocus }: { plan: Plan | null; context: PlansContext; close: () => void; saved: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get('name') || '').trim();
    if (!name) { setError('Escribe el nombre del plan.'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      await context.save(plan ? 'plans/update' : 'plans', {
        name, down: Number(values.get('down')), up: Number(values.get('up')), price: Number(values.get('price')),
        ...(plan ? {id: plan.id} : {building_id: Number(values.get('building_id') || context.buildingId) || undefined}),
      });
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el plan.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event=>{event.preventDefault();restoreFocus();}} onEscapeKeyDown={event => {if(sending.current)event.preventDefault();}} onPointerDownOutside={event => {if(sending.current)event.preventDefault();}}>
      <DialogHeader><DialogTitle>{plan ? 'Editar plan' : 'Crear plan'}</DialogTitle><DialogDescription>{plan ? 'El precio se aplicará a futuras mensualidades. La velocidad se actualizará en los departamentos vigentes.' : 'Define la velocidad y el precio mensual del servicio.'}</DialogDescription></DialogHeader>
      <form id="plan-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        {!plan && context.superadmin && context.buildings.length > 1 && <div className="grid gap-2"><label htmlFor="plan-building" className="text-sm font-medium">Edificio</label><NativeSelect id="plan-building" name="building_id" required defaultValue={context.buildingId || ''} disabled={pending}><NativeSelectOption value="" disabled>Selecciona un edificio</NativeSelectOption>{context.buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></div>}
        {plan && <p className="text-sm text-muted-foreground">Edificio: {context.buildings.find(b=>b.id===plan.building_id)?.name || 'Edificio asignado'}</p>}
        <div className="grid gap-2"><label htmlFor="plan-name" className="text-sm font-medium">Nombre del plan</label><Input id="plan-name" name="name" required maxLength={160} defaultValue={plan?.name || ''} disabled={pending} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{(['down','up'] as const).map(direction => <div key={direction} className="grid gap-2"><label htmlFor={`plan-${direction}`} className="text-sm font-medium">{direction==='down'?'Bajada (Mbps)':'Subida (Mbps)'}</label><Input id={`plan-${direction}`} name={direction} type="number" required min={1} max={1000000} step={1} defaultValue={plan?.[direction] ?? ''} disabled={pending} /></div>)}</div>
        <div className="grid gap-2"><label htmlFor="plan-price" className="text-sm font-medium">Precio mensual</label><Input id="plan-price" name="price" type="number" required min={0} max={1000000} step="0.01" defaultValue={plan ? plan.price / 100 : ''} disabled={pending} aria-describedby="plan-currency" /><p id="plan-currency" className="text-sm text-muted-foreground">{context.currency ? `Moneda: ${context.currency}` : 'Importe mensual del plan.'}</p></div>
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
function PlansView({ context }: { context: PlansContext }) {
  const [draft, setDraft] = useState<Plan | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const money = (cents: number) => `${context.currency ? `${context.currency} ` : ''}${new Intl.NumberFormat('es',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents / 100)}`;
  function close() { setDraft(undefined); }
  function edit(plan: Plan | null, button: HTMLButtonElement) { trigger.current = button; setDraft(plan); setNotice(''); }
  async function saved() {
    close(); setNotice('Plan guardado.');
    try { await context.refresh(); }
    catch { setNotice('El plan se guardó, pero no se pudo actualizar el listado. Usa Actualizar para consultarlo.'); }
  }
  return <div className="shadcn-root grid gap-6 py-6" id="plans-panel">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="grid gap-2"><h1 className="text-2xl font-semibold tracking-tight">Planes de internet</h1><p className="text-sm text-muted-foreground">Los cambios de precio se aplican a futuras mensualidades.</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => {void context.refresh().catch(()=>setNotice('No se pudo actualizar el listado. Reintenta.'));}}>Actualizar</Button>{context.canEdit && <Button type="button" data-action="new-plan" onClick={event=>edit(null,event.currentTarget)}><Plus aria-hidden="true" />Crear plan</Button>}</div></div>
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    {context.plans.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{context.plans.map(plan => <Card key={plan.id} className="min-w-0" data-plan-id={plan.id}>
      <CardHeader><h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{plan.name}</h2></CardHeader>
      <CardContent className="grid gap-4"><p className="text-3xl font-semibold tracking-tight">{money(plan.price)}<span className="ml-2 text-sm font-normal text-muted-foreground">/ mes</span></p><div className="flex flex-wrap gap-4 text-sm"><span className="inline-flex items-center gap-1"><ArrowDown className="size-4" aria-hidden="true" />{plan.down} Mbps</span><span className="inline-flex items-center gap-1"><ArrowUp className="size-4" aria-hidden="true" />{plan.up} Mbps</span></div><p className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" aria-hidden="true" />{plan.customer_count} {Number(plan.customer_count)===1?'departamento':'departamentos'}</p></CardContent>
      {context.canEdit && <CardFooter><Button type="button" variant="outline" aria-label={`Editar plan ${plan.name}`} onClick={event=>edit(plan,event.currentTarget)}><Pencil aria-hidden="true" />Editar plan</Button></CardFooter>}
    </Card>)}</div> : <Card><CardContent><p className="text-sm text-muted-foreground">Crea tu primer plan para asignarlo a los departamentos.</p></CardContent></Card>}
    {draft !== undefined && <PlanEditor plan={draft} context={context} close={close} saved={()=>{void saved();}} restoreFocus={()=>trigger.current?.focus()} />}
  </div>;
}
export default function PlansPanel() {
  const state = useSyncExternalStore(subscribePlans,getPlans,getServerPlans);
  return state.visible && state.context ? <PlansView key={`${state.context.userId}:${state.context.buildingId}`} context={state.context} /> : null;
}
