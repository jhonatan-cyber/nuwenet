import { useRef, useState, type SubmitEvent } from 'react';
import { Ban, Clock, Gauge, Play, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError } from '@/components/panel-shell';
import { IconButton } from '@/components/shared/icon-button';
import { DialogHead, FormField, PendingDialog, SubmitRow } from '@/components/shared/dialog';
import type { RouterEntry, RouterClient, RoutersContext } from '@/features/routers-network/routers-store';
import { capNames, arrisCapNames, opOrder, isIpv4, type Op } from './router-types';

const opIcons: Record<Op, typeof Ban> = {
  suspend: Ban,
  reactivate: Play,
  speed_limit: Gauge,
  firewall: Shield,
  parental_control: Clock,
};

// ---------- Botones de acción por dispositivo (usados en la tabla de clientes) ----------

export function DeviceButtons({ router, client, canManage, onControl }: {
  router: RouterEntry;
  client: RouterClient;
  canManage: boolean;
  onControl: (op: Op, ip: string) => void;
}) {
  if (!canManage) return <span title="Solo el super-admin aplica acciones de red">🔒</span>;
  if (router?.disabled) return <span title="Router deshabilitado">🔒</span>;
  if (!router || !client || !isIpv4(client.ip)) return <span>—</span>;
  const isArris = router.adapter === 'arris-touchstone';
  const labels = isArris ? arrisCapNames : capNames;
  const blocked = Array.isArray(router.snapshot?.blocked) && router.snapshot.blocked.includes(client.ip!);
  const ops = opOrder.filter(op => router.capabilities?.[op]);
  if (!ops.length) return <span>—</span>;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`Acciones para ${client.ip}`}>
      {ops.map(op => {
        const Icon = opIcons[op];
        return (
          <IconButton key={op} label={`${labels[op]} ${client.ip}`} tip={<>{labels[op]} · {client.ip}</>} type="button" variant="outline" size="icon" data-active={op === 'suspend' && blocked ? 'true' : undefined} onClick={() => onControl(op, client.ip!)}><Icon aria-hidden="true" /></IconButton>
        );
      })}
    </div>
  );
}

// ---------- Dialog de control de dispositivo ----------

const controlActions: Op[] = [...opOrder];

export function DeviceControlDialog({ router, preset, context, close, saved, restoreFocus }: {
  router: RouterEntry;
  preset?: { action?: string; ip?: string };
  context: RoutersContext;
  close: () => void;
  saved: (message: string) => void;
  restoreFocus: () => void;
}) {
  const isArris = router.adapter === 'arris-touchstone';
  const labels = isArris ? arrisCapNames : capNames;
  const available = controlActions.filter(a => router.capabilities?.[a]);
  const [action, setAction] = useState(preset?.action && available.includes(preset.action as Op) ? preset.action : available[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const body: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget));
    if (body.remove !== undefined) body.remove = body.remove === 'true';
    sending.current = true; setPending(true); setError('');
    try {
      const result = await context.request(`routers/${router.id}/actions`, body);
      saved(`${result.result} Usa Probar conexión para actualizar el resumen.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo aplicar la acción.'); }
    finally { sending.current = false; setPending(false); }
  }

  return (
    <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead
        title={<>Controlar dispositivo{preset?.ip ? ` · ${preset.ip}` : ''}</>}
        description={isArris ? 'Las reglas afectan TCP/UDP por IPv4. No bloquean IPv6 ni otros protocolos. Los horarios usan la hora configurada en el router.' : 'Los cambios se aplican en el router seleccionado.'}
      />
      <DialogBody>
        <form id="control-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
          <FormField id="control-action" label="Acción"><NativeSelect id="control-action" name="action" value={action} onChange={event => setAction(event.target.value)} disabled={pending}>{available.map(a => <NativeSelectOption key={a} value={a}>{labels[a]}</NativeSelectOption>)}</NativeSelect></FormField>
          <FormField id="control-ip" label="IP del dispositivo">
            <Input id="control-ip" name="ip" required placeholder="192.168.0.2" list="router-client-ips" defaultValue={preset?.ip || ''} disabled={pending} />
            <datalist id="router-client-ips">{(router.snapshot?.clients || []).filter(c => c.ip && !c.ip.includes(':')).map(c => <option key={c.ip!} value={c.ip!}>{c.name || c.mac || 'Dispositivo'}</option>)}</datalist>
          </FormField>
          {action === 'speed_limit' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="control-down" label="Bajada (Mbps)"><Input id="control-down" name="down" type="number" min={1} max={1000000} defaultValue="50" required disabled={pending} /></FormField>
              <FormField id="control-up" label="Subida (Mbps)"><Input id="control-up" name="up" type="number" min={1} max={1000000} defaultValue="20" required disabled={pending} /></FormField>
            </div>
          )}
          {action === 'firewall' && (
            <>
              <FormField id="control-target" label={isArris ? 'Protocolo y puertos' : 'Destino (IP o dominio)'}><Input id="control-target" name="target" required placeholder={isArris ? 'tcp:80 o both:1000-2000' : 'ejemplo.com'} disabled={pending} /></FormField>
              <FormField id="control-remove" label="Operación"><NativeSelect id="control-remove" name="remove" defaultValue="false" disabled={pending}><NativeSelectOption value="false">Bloquear</NativeSelectOption><NativeSelectOption value="true">Quitar este filtro de NuweNet</NativeSelectOption></NativeSelect></FormField>
              {isArris && <p className="text-sm text-muted-foreground">Protocolos: tcp, udp o both. Solo se quita el filtro exacto indicado.</p>}
            </>
          )}
          {action === 'parental_control' && (
            <FormField id="control-schedule" label="Horario de bloqueo" hint="Días: sun, mon, tue, wed, thu, fri, sat. Escribe off para quitar el horario de NuweNet.">
              <Input id="control-schedule" name="schedule" required placeholder="22h-7h,mon,tue,wed,thu,fri" disabled={pending} />
            </FormField>
          )}
          <p className="text-sm text-muted-foreground">Quitar un bloqueo conserva las demás restricciones del dispositivo.</p>
          <FormError message={error} />
        </form>
      </DialogBody>
      <SubmitRow busy={pending} onClose={close} label="Aplicar" busyLabel="Aplicando…" form="control-form" />
    </PendingDialog>
  );
}
