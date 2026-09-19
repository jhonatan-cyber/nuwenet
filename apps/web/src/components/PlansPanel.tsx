import { useMemo, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Users, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { useListControls } from '@/shared/lib/use-list-controls';
import { ConfirmDialog, DialogHead, FormField, Pagination, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { getPlans, getServerPlans, subscribePlans, type Plan, type PlansContext } from '@/features/plans/plans-store';
import { IconButton } from '@/components/shared/icon-button';

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
        ...(plan ? {id: plan.id} : {building_id: String(values.get('building_id') || context.buildingId || '') || undefined}),
      });
      saved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el plan.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
    <DialogHead title={plan ? 'Editar plan' : 'Crear plan'} description={plan ? 'El precio se aplicará a futuras mensualidades. La velocidad se actualizará en los departamentos vigentes.' : 'Define la velocidad y el precio mensual del servicio.'} />
    <DialogBody><form id="plan-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
      {!plan && context.superadmin && context.buildings.length > 1 && <FormField id="plan-building" label="Edificio"><NativeSelect id="plan-building" name="building_id" required defaultValue={context.buildingId || ''} disabled={pending}><NativeSelectOption value="" disabled>Selecciona un edificio</NativeSelectOption>{context.buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></FormField>}
      {plan && <p className="text-sm text-muted-foreground">Edificio: {context.buildings.find(b=>b.id===plan.building_id)?.name || 'Edificio asignado'}</p>}
      <FormField id="plan-name" label="Nombre del plan"><Input id="plan-name" name="name" required maxLength={160} defaultValue={plan?.name || ''} disabled={pending} /></FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{(['down','up'] as const).map(direction => <FormField key={direction} id={`plan-${direction}`} label={direction==='down'?'Bajada (Mbps)':'Subida (Mbps)'}><Input id={`plan-${direction}`} name={direction} type="number" required min={1} max={1000000} step={1} defaultValue={plan?.[direction] ?? ''} disabled={pending} /></FormField>)}</div>
      <FormField id="plan-price" label="Precio mensual" hint={context.currency ? `Moneda: ${context.currency}` : 'Importe mensual del plan.'}><Input id="plan-price" name="price" type="number" required min={0} max={1000000} step="0.01" defaultValue={plan ? plan.price / 100 : ''} disabled={pending} aria-describedby="plan-currency" /></FormField>
      <FormError message={error} />
    </form></DialogBody>
    <SubmitRow busy={pending} onClose={close} label="Guardar" form="plan-form" />
  </PendingDialog>;
}

type StatusFilter = 'all' | 'active' | 'disabled';

function PlansView({ context }: { context: PlansContext }) {
  const [draft, setDraft] = useState<Plan | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<'muted' | 'destructive'>('muted');
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [toDelete, setToDelete] = useState<Plan | null>(null);
  const { capture, restore } = useDialogFocus();
  const PAGE_SIZE = 10;

  const toast = (message: string, tone: 'info' | 'error' = 'info') => {
    setNotice(message);
    setNoticeTone(tone === 'error' ? 'destructive' : 'muted');
    window.setTimeout(() => {
      setNotice(current => current === message ? '' : current);
      setNoticeTone(current => tone === 'error' && current === 'destructive' ? 'muted' : current);
    }, tone === 'error' ? 8000 : 5000);
  };

  const money = (cents: number) => `${context.currency ? `${context.currency} ` : ''}${new Intl.NumberFormat('es',{minimumFractionDigits:2,maximumFractionDigits:2}).format(cents / 100)}`;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return context.plans.filter(plan => {
      if (status === 'active' && plan.disabled) return false;
      if (status === 'disabled' && !plan.disabled) return false;
      if (query) {
        const haystack = `${plan.name} ${context.buildings.find(b => b.id === plan.building_id)?.name ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [context.plans, context.buildings, search, status]);

  const { page, pages, setPage, slice } = useListControls({ items: filtered, pageSize: PAGE_SIZE, resetKeys: [search, status] });
  const paged = slice(filtered);

  function close() { setDraft(undefined); }
  function edit(plan: Plan | null, button: HTMLButtonElement) { capture(button); setDraft(plan); setNotice(''); }
  async function saved() {
    close(); toast('Plan guardado.');
    try { await context.refresh(); }
    catch { toast('El plan se guardó, pero no se pudo actualizar el listado.', 'error'); }
  }

  async function togglePlan(plan: Plan, next: boolean) {
    if (!context.canEdit) return;
    const id = plan.id;
    setBusy(prev => new Set(prev).add(id));
    try {
      await context.save('plans/toggle', { id, disabled: next ? 1 : 0 });
      await context.refresh();
      toast(next ? `Plan "${plan.name}" desactivado.` : `Plan "${plan.name}" activado.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo actualizar el estado del plan.', 'error');
      try { await context.refresh(); } catch { /* ignora */ }
    } finally {
      setBusy(prev => {
        const nextSet = new Set(prev); nextSet.delete(id); return nextSet;
      });
    }
  }

  async function confirmDelete(plan: Plan) {
    if (!context.canEdit) return;
    setPending(true);
    try {
      await context.save('plans/delete', { id: plan.id });
      await context.refresh();
      toast(`Plan "${plan.name}" eliminado.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se pudo eliminar el plan.', 'error');
    } finally {
      setPending(false);
      setToDelete(null);
    }
  }

  const counts = useMemo(() => ({
    total: context.plans.length,
    active: context.plans.filter(p => !p.disabled).length,
    disabled: context.plans.filter(p => p.disabled).length,
  }), [context.plans]);

  return <PanelShell id="plans-panel" title="Planes de internet" description="Los cambios de precio se aplican a futuras mensualidades." notice={notice} tone={noticeTone}
    actions={context.canEdit ? <IconButton label="Crear plan" type="button" size="icon-sm" data-action="new-plan" onClick={event=>edit(null,event.currentTarget)}><Plus aria-hidden="true" /></IconButton> : undefined}>

    {!!context.plans.length && (
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-xl font-semibold">{counts.total}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Activos</p><p className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">{counts.active}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Desactivados</p><p className="text-xl font-semibold text-destructive">{counts.disabled}</p></CardContent></Card>
      </div>
    )}

    <form onSubmit={event => event.preventDefault()} className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros de planes">
      <div className="grid min-w-[200px] flex-1 gap-1.5">
        <label htmlFor="plan-search" className="text-sm font-medium">Buscar</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="plan-search" className="pl-8" placeholder="Nombre del plan, edificio…" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="plan-status" className="text-sm font-medium">Estado</label>
        <NativeSelect id="plan-status" value={status} onChange={event => setStatus(event.target.value as StatusFilter)}>
          <NativeSelectOption value="all">Todos ({counts.total})</NativeSelectOption>
          <NativeSelectOption value="active">Activos ({counts.active})</NativeSelectOption>
          <NativeSelectOption value="disabled">Desactivados ({counts.disabled})</NativeSelectOption>
        </NativeSelect>
      </div>
    </form>

    {context.plans.length ? (
      <>
        {paged.length ? <DataTable
          variant="box"
          tableClassName="[&_th:last-child]:text-right [&_td:last-child]:text-right"
          headings={[
            'Nombre',
            { label: 'Edificio', className: 'hidden sm:table-cell' },
            'Velocidad',
            { label: 'Uso', className: 'hidden md:table-cell' },
            'Precio',
            'Estado',
            ...(context.canEdit ? [{ label: 'Acciones', className: 'text-right' }] : []),
          ]}
          rows={paged.map(plan => {
                const disabled = !!plan.disabled;
                const isBusy = busy.has(plan.id);
                return (
                  <TableRow key={plan.id} data-plan-id={plan.id} className={disabled ? 'opacity-70' : ''}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium [overflow-wrap:anywhere]">{plan.name}</span>
                        <span className="sm:hidden inline-flex items-center gap-1 text-xs text-muted-foreground">{context.buildings.find(b => b.id === plan.building_id)?.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground">{context.buildings.find(b => b.id === plan.building_id)?.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <span className="inline-flex items-center gap-1 whitespace-nowrap"><ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium tabular-nums">{plan.down}</span><span className="text-xs text-muted-foreground">Mbps</span></span>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap"><ArrowUp className="size-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium tabular-nums">{plan.up}</span><span className="text-xs text-muted-foreground">Mbps</span></span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline" className="gap-1">
                        <Users className="size-3" aria-hidden="true" />
                        <span>{plan.customer_count} {Number(plan.customer_count) === 1 ? 'depto' : 'deptos'}</span>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold tabular-nums">{money(plan.price)}</span>
                        <span className="text-xs text-muted-foreground">mensual</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {disabled ? <StatusText tone="danger">Desactivado</StatusText> : <StatusText>Activo</StatusText>}
                    </TableCell>
                    {context.canEdit && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <div className="flex items-center gap-2" title={disabled ? 'Activar plan' : 'Desactivar plan'}>
                            <Switch
                              size="sm"
                              checked={!disabled}
                              onCheckedChange={value => togglePlan(plan, !value)}
                              disabled={isBusy || pending}
                              aria-label={`${disabled ? 'Activar' : 'Desactivar'} plan ${plan.name}`}
                            />
                            <span className="sr-only">{disabled ? 'Plan desactivado' : 'Plan activo'}</span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon-sm" aria-label={`Más acciones para ${plan.name}`}>
                                <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="5" r="1.7" className="fill-current" /><circle cx="12" cy="12" r="1.7" className="fill-current" /><circle cx="12" cy="19" r="1.7" className="fill-current" /></svg>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => edit(plan, document.querySelector(`[data-plan-id="${plan.id}"] button`) || null!)}>
                                <Pencil aria-hidden="true" /><span>Editar</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setToDelete(plan)} disabled={!!Number(plan.customer_count)} className="text-destructive focus:text-destructive data-[disabled]:opacity-40 data-[disabled]:pointer-events-none">
                                <Trash2 aria-hidden="true" /><span>Eliminar{Number(plan.customer_count) ? ` (en uso)` : ''}</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })} /> : <Card><CardContent className="py-8 text-center"><p className="text-sm text-muted-foreground">No se encontraron planes con los filtros seleccionados.</p></CardContent></Card>}

        {filtered.length > PAGE_SIZE && (
          <Pagination className="mt-4" page={page} pages={pages} total={filtered.length}
            onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)} disableAll={pending} />
        )}
      </>
    ) : (
      <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Crea tu primer plan para asignarlo a los departamentos.</p></CardContent></Card>
    )}

    {draft !== undefined && <PlanEditor plan={draft} context={context} close={close} saved={()=>{void saved();}} restoreFocus={restore} />}

    {toDelete && <ConfirmDialog
      title="Eliminar plan"
      message={`Esta acción es permanente. Vas a eliminar el plan ${toDelete.name}. El backend rechazará la eliminación si aún tiene departamentos vigentes.`}
      confirmLabel="Sí, eliminar plan"
      destructive
      onConfirm={() => confirmDelete(toDelete)}
      close={() => { if (!pending) setToDelete(null); }} />}
  </PanelShell>;
}

export default function PlansPanel() {
  const state = useSyncExternalStore(subscribePlans,getPlans,getServerPlans);
  return state.visible && state.context ? <PlansView key={`${state.context.userId}:${state.context.buildingId}`} context={state.context} /> : null;
}
