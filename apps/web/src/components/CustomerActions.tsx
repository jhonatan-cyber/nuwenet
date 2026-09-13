import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { closeCustomerAction, getCustomerAction, getServerCustomerAction, openCustomerAction, showCustomerToken, subscribeCustomerActions, type CustomerActionContext, type CustomerActionState } from '@/lib/customer-actions-store';
import { usageMarkup, mountUsage } from '@/scripts/usage.js';

// This visualization is shared with the resident portal. Its lifecycle ends with the dialog.
function Usage({ context }: { context: CustomerActionContext }) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }).slice(0, 7);
  useEffect(() => {
    const element = root.current!;
    body.current!.innerHTML = usageMarkup(false);
    return mountUsage(element, (month: string) => context.request(`customers/${context.customer.id}/usage?month=${encodeURIComponent(month)}`));
  }, [context]);
  return <div ref={root}><div className="flex flex-wrap items-end gap-3"><div className="grid gap-2"><label htmlFor="action-usage-month" className="text-sm font-medium">Mes</label><Input id="action-usage-month" data-usage-month type="month" min="2000-01" max={month} defaultValue={month} /></div><Button type="button" variant="outline" data-usage-refresh>Actualizar</Button></div><div ref={body} /></div>;
}

function ActionContent({ state }: { state: CustomerActionState }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const context = state.context;
  const customer = context?.customer;
  const kind = context?.kind;
  const link = state.token ? `${location.origin}/portal?token=${encodeURIComponent(state.token)}` : '';
  const title = link ? 'Enlace del portal (única vez)' : kind === 'usage-history' ? 'Consumo mensual' : kind === 'portal-link' ? 'Portal del residente' : kind === 'rotate-portal-link' ? `Regenerar enlace de ${customer!.apartment}` : kind === 'change-holder' ? `Cambio de titular de ${customer!.apartment}` : kind === 'set-ip' ? `IP de ${customer!.apartment}` : kind === 'archive' ? customer!.archived ? 'Restaurar departamento' : 'Archivar departamento' : customer!.status === 'active' ? 'Cortar internet' : 'Reactivar internet';
  const description = link ? 'Copia y entrega este enlace ahora. No volverá a mostrarse. Quien lo tenga puede consultar la cuenta y reportar pagos.' : kind === 'usage-history' ? `Historial del departamento ${customer!.apartment}.` : kind === 'portal-link' ? `Enlace privado del departamento ${customer!.apartment}. Genera uno nuevo para entregarlo; solo se verá una vez.` : kind === 'rotate-portal-link' ? 'Se invalidará de inmediato el enlace anterior. Pagos e historial se conservan. El nuevo enlace se mostrará una sola vez.' : kind === 'change-holder' ? 'Actualiza el titular e invalida el acceso anterior. El nuevo enlace se mostrará una sola vez.' : kind === 'set-ip' ? 'Se limpiarán las reglas de la dirección anterior y se aplicará el estado del servicio a la nueva. Vacío para quitarla.' : kind === 'archive' ? `${customer!.archived ? 'Restaurar' : 'Archivar y suspender'} el departamento ${customer!.apartment}. Se conserva su historial.` : `${customer!.status === 'active' ? 'Cortar' : 'Reactivar'} el internet del departamento ${customer!.apartment}. La orden se enviará al equipo central configurado.`;
  const submitLabel = kind === 'rotate-portal-link' ? 'Regenerar e invalidar anterior' : kind === 'change-holder' ? 'Cambiar titular e invalidar acceso' : kind === 'archive' ? customer!.archived ? 'Restaurar' : 'Archivar' : kind === 'access' ? customer!.status === 'active' ? 'Cortar' : 'Reactivar' : 'Guardar';
  const readOnly = !!link || kind === 'portal-link' || kind === 'usage-history';
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || !context || !customer) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get('name') || '').trim();
    if (kind === 'change-holder' && !name) { setError('Escribe el nuevo titular.'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      const route = kind === 'rotate-portal-link' ? 'customers/portal-link' : kind === 'change-holder' ? 'customers/change-holder' : kind === 'set-ip' ? 'customers/ip' : kind === 'archive' ? 'customers/archive' : 'access';
      const body = { id: customer.id, ...(kind === 'change-holder' ? { name, phone: String(values.get('phone') || '').trim() } : kind === 'set-ip' ? { ip: String(values.get('ip') || '').trim() || undefined } : kind === 'archive' ? { archived: !customer.archived } : kind === 'access' ? { status: customer.status === 'active' ? 'suspended' : 'active' } : {}) };
      const result = await context.request(route, body);
      // Do not reopen a dismissed dialog after navigation or a session change.
      if (getCustomerAction() !== state) return;
      if (result?.portal_link?.token) showCustomerToken(result.portal_link.token);
      else closeCustomerAction();
      context.notify('Operación guardada.');
      void context.refresh().catch(() => context.notify('La operación se guardó, pero no se pudo actualizar el listado. Usa Actualizar.'));
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la operación.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !sending.current) closeCustomerAction(); }}>
    <DialogContent className={kind === 'usage-history' ? 'sm:max-w-3xl' : undefined} showCloseButton={!pending} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); if (!getCustomerAction()) state.trigger?.focus(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {link && <div className="grid gap-3"><label htmlFor="customer-portal-token" className="text-sm font-medium">Enlace privado</label><Input id="customer-portal-token" data-portal-link readOnly value={link} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} /><Button asChild variant="outline"><a href={link} target="_blank" rel="noreferrer">Abrir portal</a></Button></div>}
      {kind === 'usage-history' && context && <Usage context={context} />}
      {kind === 'portal-link' && context && <div className="grid gap-4"><p className="text-sm text-muted-foreground">Emitido: {customer!.access_issued_at || '—'} · Vence: {customer!.access_expires_at || 'sin caducidad'} · v{customer!.access_version || 1}</p><div className="flex flex-wrap gap-2"><Button onClick={() => openCustomerAction({ ...context, kind: 'rotate-portal-link' })}>Generar y entregar enlace</Button><Button variant="outline" onClick={() => openCustomerAction({ ...context, kind: 'change-holder' })}>Cambio de titular</Button></div></div>}
      {readOnly ? <DialogFooter><Button variant="outline" onClick={closeCustomerAction}>Cerrar</Button></DialogFooter> : <form id="customer-action-form" onSubmit={submit} aria-busy={pending} className="grid gap-4">
        {kind === 'set-ip' && <div className="grid gap-2"><label htmlFor="action-ip" className="text-sm font-medium">IP privada</label><Input id="action-ip" name="ip" defaultValue={customer!.ip || ''} disabled={pending} /></div>}
        {kind === 'change-holder' && <><div className="grid gap-2"><label htmlFor="action-holder" className="text-sm font-medium">Nuevo titular</label><Input id="action-holder" name="name" maxLength={160} required disabled={pending} /></div><div className="grid gap-2"><label htmlFor="action-phone" className="text-sm font-medium">Teléfono (opcional)</label><Input id="action-phone" name="phone" maxLength={80} disabled={pending} /></div></>}
        <p role="alert" className="text-sm text-destructive">{error}</p><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={closeCustomerAction}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Guardando…' : submitLabel}</Button></DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
export default function CustomerActions() {
  const state = useSyncExternalStore(subscribeCustomerActions, getCustomerAction, getServerCustomerAction);
  return state ? <ActionContent key={state.revision} state={state} /> : null;
}
