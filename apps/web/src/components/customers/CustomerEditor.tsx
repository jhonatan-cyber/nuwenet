import { useRef, useState, type SubmitEvent } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { FormError } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog, SubmitRow } from '@/components/shared/dialog';
import { closeCustomer, type Customer, type CustomersContext } from '@/features/customers/customers-store';
import type { Plan } from '@/features/plans/plans-store';

export function CustomerEditor({ customer, context }: { customer: Customer | null; context: CustomersContext }) {
  const [pending, setPending]       = useState(false);
  const [error, setError]           = useState('');
  const [buildingId, setBuildingId] = useState(customer?.building_id || context.buildingId);
  const [plans, setPlans]           = useState<Plan[]>(context.plans);
  const [plansNotice, setPlansNotice] = useState('');
  const sending = useRef(false);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const multiBuilding = !customer && context.buildings.length > 1;

  async function changeBuilding(id: string) {
    setBuildingId(id); setPlansNotice('');
    if (id === context.buildingId) { setPlans(context.plans); return; }
    try {
      const data = await (context.save as unknown as (route: string) => Promise<{ plans?: Plan[] }>)(
        `state?building_id=${id}&section=customers`,
      );
      setPlans(Array.isArray(data?.plans) ? data.plans : []);
    } catch { setPlans([]); setPlansNotice('No se pudieron cargar los planes de ese edificio; elige Sin plan o reintenta.'); }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values    = new FormData(event.currentTarget);
    const apartment = String(values.get('apartment') || '').trim();
    if (!apartment) { setError('Escribe el departamento.'); return; }
    sending.current = true; setPending(true); setError('');
    try {
      const result = await context.save(customer ? 'customers/update' : 'customers', {
        apartment,
        name:  String(values.get('name')  || '').trim(),
        phone: String(values.get('phone') || '').trim(),
        plan_id: values.get('plan_id') ? String(values.get('plan_id')) : null,
        ...(customer
          ? { id: customer.id }
          : { building_id: buildingId, ...(values.get('ip') ? { ip: String(values.get('ip')).trim() } : {}) }),
      });
      closeCustomer();
      if (result?.portal_link?.token) setTimeout(() => context.showLink(result.portal_link!), 0);
      if (!customer && buildingId !== context.buildingId) {
        const name = context.buildings.find(b => b.id === buildingId)?.name || 'otro edificio';
        window.dispatchEvent(new CustomEvent('customer-notice', { detail: `Departamento creado en ${name}. Cambia de edificio para verlo.` }));
      }
      void context.refresh().catch(() =>
        window.dispatchEvent(new CustomEvent('customer-notice', { detail: 'El departamento se guardó, pero no se pudo actualizar el listado.' })),
      );
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el departamento.'); }
    finally { sending.current = false; setPending(false); }
  }

  return (
    <PendingDialog busy={pending} onClose={closeCustomer} restoreFocus={() => trigger.current?.focus()}>
      <DialogHead
        title={customer ? 'Editar departamento' : 'Agregar departamento'}
        description={customer
          ? 'Corrige los datos y el plan. Para un nuevo ocupante, usa Cambio de titular en Portal del residente.'
          : 'Elige el edificio (el departamento puede repetirse en otro edificio, pero no en el mismo). Al guardar se mostrará su enlace de portal una sola vez.'}
      />
      <DialogBody>
        <form id="customer-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
          {multiBuilding
            ? <FormField id="customer-building" label="Edificio">
                <NativeSelect id="customer-building" value={buildingId} onChange={event => { void changeBuilding(event.target.value); }} disabled={pending}>
                  {context.buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
                </NativeSelect>
              </FormField>
            : <p className="text-sm text-muted-foreground">
                Edificio: {customer ? context.buildings.find(b => b.id === customer.building_id)?.name || context.buildingName : context.buildingName}
              </p>}

          {([
            { name: 'apartment', label: 'Departamento',               value: customer?.apartment, required: true, max: 160 },
            { name: 'name',      label: 'Nombre del titular (opcional)', value: customer?.name,      max: 160 },
            { name: 'phone',     label: 'Teléfono (opcional)',           value: customer?.phone,     max: 80  },
          ] as const).map(field => (
            <FormField key={field.name} id={`customer-${field.name}`} label={field.label}>
              <Input id={`customer-${field.name}`} name={field.name} required={field.name === 'apartment'} maxLength={field.max} defaultValue={field.value || ''} disabled={pending} />
            </FormField>
          ))}

          <FormField id="customer-plan" label="Plan de internet (opcional)">
            <NativeSelect id="customer-plan" name="plan_id" defaultValue={customer ? (customer.plan_id ?? '') : (plans[0]?.id ?? '')} disabled={pending}>
              <NativeSelectOption value="">Sin plan</NativeSelectOption>
              {plans.map(plan => <NativeSelectOption key={plan.id} value={plan.id}>{plan.name} · {context.money(plan.price)}</NativeSelectOption>)}
            </NativeSelect>
            {plansNotice && <p className="text-sm text-muted-foreground">{plansNotice}</p>}
          </FormField>

          {!customer && (
            <FormField id="customer-ip" label="IP privada (opcional)">
              <Input id="customer-ip" name="ip" placeholder="192.168.88.50" disabled={pending} />
            </FormField>
          )}

          <FormError message={error} />
        </form>
      </DialogBody>
      <SubmitRow busy={pending} onClose={closeCustomer} label="Guardar" form="customer-form" />
    </PendingDialog>
  );
}
