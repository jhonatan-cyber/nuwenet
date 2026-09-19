import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import { FormError, PanelShell } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { type OperationsContext } from '@/features/operations/operations-store';
import type { Building, RouterItem } from './types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Configuración ----------

const numberFields = [
  { key: 'grace_days', label: 'Días de gracia antes del corte', min: 0, max: 60 },
  { key: 'billing_day', label: 'Día de generación mensual', min: 1, max: 28 },
  { key: 'due_day', label: 'Día de vencimiento mensual', min: 1, max: 28 },
  { key: 'overdue_minutes', label: 'Revisar mora cada N minutos (0 desactiva)', min: 0, max: 1440 },
  { key: 'monitor_minutes', label: 'Consultar routers cada N minutos (0 desactiva)', min: 0, max: 1440 },
  { key: 'backup_hours', label: 'Crear respaldo cada N horas (0 desactiva)', min: 0, max: 720 },
  { key: 'portal_link_days', label: 'Vigencia del enlace del portal en días (0 = sin caducidad)', min: 0, max: 1825 },
] as const;

export function SettingsView({ context }: { context: OperationsContext }) {
  const [routers, setRouters] = useState<RouterItem[]>(context.routers);
  const [central, setCentral] = useState<Building | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [autoBilling, setAutoBilling] = useState(Boolean(context.settings.auto_billing));
  const sending = useRef(false);
  const { capture, restore } = useDialogFocus();
  const s = context.settings;
  useEffect(() => {
    let cancelled = false;
    context.request('routers').then(r => { if (!cancelled && r?.routers) setRouters(r.routers); }).catch(() => {});
    return () => { cancelled = true; };
  }, [context]);
  // El contenedor de acciones se rinde aunque esté vacío, como antes del cambio.
  if (!context.superadmin) return <PanelShell title="Edificio y automatización" description="Define las reglas de operación y el equipo central que controla los departamentos." notice="" actions={<></>}><Card><CardContent><p className="text-sm text-muted-foreground">Solo el super-admin configura la red y la automatización.</p></CardContent></Card></PanelShell>;
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const values = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { building_name: String(values.get('building_name') || '').trim(), currency: String(values.get('currency') || '').trim() };
    for (const f of numberFields) body[f.key] = Number(values.get(f.key));
    body.auto_billing = autoBilling;
    sending.current = true; setPending(true); setError('');
    try {
      await context.request('settings', body);
      setNotice('Configuración guardada.');
      try { await context.refresh(); } catch { setNotice('Configuración guardada. No se pudo actualizar la vista.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <PanelShell title="Edificio y automatización" description="Define las reglas de operación y el equipo central que controla los departamentos."
    notice={notice}>
    <Card><CardContent className="grid gap-4"><h2 className="text-lg font-semibold">Equipo central por edificio (solo super-admin)</h2>
      <DataTable
        variant="plain"
        headings={['Edificio', 'Central (MikroTik)', 'Acción']}
        empty="Crea tu primer edificio para asignarle un equipo central."
        rows={(context.buildings as Building[]).map(b => <TableRow key={b.id}>
          <TableCell>{b.name}</TableCell>
          <TableCell>{routers.find(r => r.id === b.central_router_id)?.name || 'Pendiente de asignar'}</TableCell>
          <TableCell><IconButton label={`Cambiar central de ${b.name}`} tip="Cambiar central" type="button" variant="outline" size="icon-sm" onClick={event => { capture(event.currentTarget); setCentral(b); }}><Server aria-hidden="true" /></IconButton></TableCell>
        </TableRow>)} />
    </CardContent></Card>
    <Card><CardContent>
      <form id="operations-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="settings-building-name" className="text-sm font-medium">Nombre del edificio</label><Input id="settings-building-name" name="building_name" required maxLength={100} defaultValue={s.building_name || ''} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="settings-currency" className="text-sm font-medium">Moneda</label><Input id="settings-currency" name="currency" maxLength={10} placeholder="Ej. Bs" defaultValue={s.currency || ''} disabled={pending} /></div>
        {numberFields.map(f => <div key={f.key} className="grid gap-2"><label htmlFor={`settings-${f.key}`} className="text-sm font-medium">{f.label}</label><Input id={`settings-${f.key}`} name={f.key} type="number" required min={f.min} max={f.max} defaultValue={s[f.key] ?? ''} disabled={pending} /></div>)}
        <div className="flex items-center justify-between gap-3"><label htmlFor="settings-auto-billing" className="text-sm font-medium">Generar mensualidades automáticamente</label><Switch id="settings-auto-billing" checked={autoBilling} onCheckedChange={setAutoBilling} disabled={pending} /></div>
        <p className="text-sm text-muted-foreground">Las tareas se ejecutan mientras el servidor está encendido. Los respaldos incluyen la clave de los routers cuando existe.</p>
        <FormError id="settings-error" message={error} />
        <div><Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar configuración'}</Button></div>
      </form>
    </CardContent></Card>
    {central && <PendingDialog busy={pending} onClose={() => setCentral(null)} restoreFocus={restore}>
      <DialogHead title={`Central · ${central.name}`} description="El equipo central es obligatorio." />
      <DialogBody><form id="settings-central-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); if (sending.current) return; const v = new FormData(event.currentTarget); sending.current = true; setPending(true); setError(''); context.request('buildings/central', { building_id: central.id, central_router_id: String(v.get('central_router_id') || '') }).then(() => { setCentral(null); setNotice('Equipo central actualizado.'); return context.refresh(); }).catch(err => setError(err instanceof Error ? err.message : 'No se pudo actualizar.')).finally(() => { sending.current = false; setPending(false); }); }}>
          <FormField id="settings-central" label="Router MikroTik"><NativeSelect id="settings-central" name="central_router_id" defaultValue={central.central_router_id || ''} required disabled={pending}>{routers.filter(r => r.adapter === 'mikrotik-rest' && !r.disabled && (!r.building_id || r.building_id === central.id)).map(r => <NativeSelectOption key={r.id} value={r.id}>{r.name}{!r.building_id ? ' (sin asignar · se adopta)' : ''}</NativeSelectOption>)}</NativeSelect></FormField>
          <FormError message={error} />
        </form></DialogBody>
      <SubmitRow busy={pending} onClose={() => setCentral(null)} label="Guardar" form="settings-central-form" />
    </PendingDialog>}
  </PanelShell>;
}
