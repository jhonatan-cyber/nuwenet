/**
 * CustomerActions — dialog de operaciones sobre un departamento.
 *
 * Configuración declarativa  → customers/customer-action-config.ts
 * Widget de consumo           → customers/UsageWidget.tsx
 */
import { useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { ExternalLink, KeyRound, UserPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError } from '@/components/panel-shell';
import { DialogActions, DialogHead, FormField, PendingDialog, SubmitRow } from '@/components/shared/dialog';
import {
  closeCustomerAction, getCustomerAction, getServerCustomerAction,
  openCustomerAction, showCustomerToken, subscribeCustomerActions,
  type CustomerActionContext, type CustomerActionState,
} from '@/features/customers/customer-actions-store';
import { UsageWidget } from './customers/UsageWidget';
import { actionConfig, READ_ONLY_KINDS } from './customers/customer-action-config';
import { IconButton } from '@/components/shared/icon-button';

function ActionContent({ state }: { state: CustomerActionState }) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState('');
  const sending  = useRef(false);
  const context  = state.context;
  const customer = context?.customer;
  const kind     = context?.kind;

  // Token de portal (estado post-submit)
  const link = state.token ? `${location.origin}/portal?token=${encodeURIComponent(state.token)}` : '';

  // Derivar título, descripción y submitLabel desde config o casos especiales
  const cfg = kind ? actionConfig[kind] : undefined;
  const title = link
    ? 'Enlace del portal (única vez)'
    : kind === 'usage-history' ? 'Consumo mensual'
    : kind === 'portal-link'  ? 'Portal del residente'
    : cfg && context ? cfg.title(context) : '';

  const description = link
    ? 'Copia y entrega este enlace ahora. No volverá a mostrarse. Quien lo tenga puede consultar la cuenta y reportar pagos.'
    : kind === 'usage-history' ? `Historial del departamento ${customer!.apartment}.`
    : kind === 'portal-link'   ? `Enlace privado del departamento ${customer!.apartment}. Genera uno nuevo para entregarlo; solo se verá una vez.`
    : cfg && context ? cfg.description(context) : '';

  const submitLabel = cfg && context ? cfg.submitLabel(context) : 'Guardar';
  const readOnly    = !!link || (kind ? READ_ONLY_KINDS.includes(kind) : false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || !context || !customer || !cfg) return;
    const values = new FormData(event.currentTarget);
    if (kind === 'change-holder' && !String(values.get('name') || '').trim()) {
      setError('Escribe el nuevo titular.'); return;
    }
    sending.current = true; setPending(true); setError('');
    try {
      const result = await context.request(cfg.route, cfg.buildBody(context, values));
      if (getCustomerAction() !== state) return;
      if (result?.portal_link?.token) showCustomerToken(result.portal_link.token);
      else closeCustomerAction();
      context.notify('Operación guardada.');
      void context.refresh().catch(() => context.notify('La operación se guardó, pero no se pudo actualizar el listado.'));
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la operación.'); }
    finally { sending.current = false; setPending(false); }
  }

  return (
    <PendingDialog
      busy={!!sending.current}
      onClose={closeCustomerAction}
      className={kind === 'usage-history' ? 'sm:max-w-3xl' : undefined}
      restoreFocus={() => { if (!getCustomerAction()) state.trigger?.focus(); }}
    >
      <DialogHead title={title} description={description} />

      <DialogBody>
          {/* Enlace del portal — solo lectura tras submit */}
          {link && (
            <div className="grid gap-3">
              <label htmlFor="customer-portal-token" className="text-sm font-medium">Enlace privado</label>
              <Input id="customer-portal-token" data-portal-link readOnly value={link} onFocus={e => e.currentTarget.select()} onClick={e => e.currentTarget.select()} />
              <div className="flex gap-2"><Tooltip><TooltipTrigger asChild><Button asChild variant="outline" size="icon-sm" aria-label="Abrir portal"><a href={link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /></a></Button></TooltipTrigger><TooltipContent>Abrir portal</TooltipContent></Tooltip></div>
            </div>
          )}

          {/* Historial de consumo */}
          {kind === 'usage-history' && context && <UsageWidget context={context} />}

          {/* Info del portal + acciones rápidas */}
          {kind === 'portal-link' && context && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                Emitido: {customer!.access_issued_at || '—'} · Vence: {customer!.access_expires_at || 'sin caducidad'} · v{customer!.access_version || 1}
              </p>
              <div className="flex flex-wrap gap-2">
                <IconButton label="Generar y entregar enlace" size="icon-sm" onClick={() => openCustomerAction({ ...context, kind: 'rotate-portal-link' })}><KeyRound aria-hidden="true" /></IconButton>
                <IconButton label="Cambio de titular" variant="outline" size="icon-sm" onClick={() => openCustomerAction({ ...context, kind: 'change-holder' })}><UserPen aria-hidden="true" /></IconButton>
              </div>
            </div>
          )}

          {/* Formulario de mutación */}
          {!readOnly && (
            <form id="customer-action-form" onSubmit={submit} aria-busy={pending} className="grid gap-4">
              {kind === 'set-ip' && (
                <FormField id="action-ip" label="IP privada">
                  <Input id="action-ip" name="ip" defaultValue={customer!.ip || ''} disabled={pending} />
                </FormField>
              )}
              {kind === 'change-holder' && (
                <>
                  <FormField id="action-holder" label="Nuevo titular">
                    <Input id="action-holder" name="name" maxLength={160} required disabled={pending} />
                  </FormField>
                  <FormField id="action-phone" label="Teléfono (opcional)">
                    <Input id="action-phone" name="phone" maxLength={80} disabled={pending} />
                  </FormField>
                </>
              )}
              <FormError message={error} />
            </form>
          )}
        </DialogBody>

        {readOnly
          ? <DialogActions><Button variant="outline" onClick={closeCustomerAction}>Cerrar</Button></DialogActions>
          : <SubmitRow busy={pending} onClose={closeCustomerAction} label={submitLabel} form="customer-action-form" />}
    </PendingDialog>
  );
}

export default function CustomerActions() {
  const state = useSyncExternalStore(subscribeCustomerActions, getCustomerAction, getServerCustomerAction);
  return state ? <ActionContent key={state.revision} state={state} /> : null;
}
