import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TableCell, TableRow } from '@/components/ui/table';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { type OperationsContext } from '@/features/operations/operations-store';
import type { Building, RouterItem, UserItem } from './types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Edificios ----------

type BuildingDraft =
  | { type: 'new' }
  | { type: 'edit'; building: Building }
  | { type: 'toggle'; building: Building }
  | { type: 'remove'; building: Building }
  | { type: 'central'; building: Building }
  | { type: 'access'; building: Building };

export function BuildingsView({ context }: { context: OperationsContext }) {
  const [routers, setRouters] = useState<RouterItem[]>(context.routers);
  const [users, setUsers] = useState<UserItem[] | null>(null);
  const [draft, setDraft] = useState<BuildingDraft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const { capture, restore } = useDialogFocus();
  useEffect(() => {
    let cancelled = false;
    context.request('routers').then(r => { if (!cancelled && r?.routers) setRouters(r.routers); }).catch(() => {});
    return () => { cancelled = true; };
  }, [context]);
  useEffect(() => {
    if (draft?.type !== 'new') return;
    let cancelled = false;
    context.request('auth/users').then(u => { if (!cancelled) setUsers(Array.isArray(u) ? u : []); }).catch(() => { if (!cancelled) setUsers([]); });
    return () => { cancelled = true; };
  }, [context, draft]);
  // El contenedor de acciones se rinde aunque esté vacío, como antes del cambio.
  if (!context.superadmin) return <PanelShell title="Edificios y accesos" description="Crea edificios, asigna administradores y define el equipo central de cada red." notice="" actions={<></>}><Card><CardContent><p className="text-sm text-muted-foreground">Solo el super-admin gestiona edificios y accesos.</p></CardContent></Card></PanelShell>;
  const buildings = context.buildings;
  const centralName = (id?: string | null) => routers.find(r => r.id === id)?.name || 'Pendiente de asignar';
  const options = (bid: string) => routers.filter(r => r.adapter === 'mikrotik-rest' && !r.disabled && (!r.building_id || r.building_id === bid));
  function open(next: BuildingDraft, button: HTMLButtonElement) { capture(button); setError(''); setDraft(next); setNotice(''); }
  function close() { if (!sending.current) setDraft(undefined); }
  async function saved(message: string) {
    setDraft(undefined); setNotice(message);
    try { await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado.`); }
  }
  async function run(fn: () => Promise<void>, message: string) {
    if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try { await fn(); await saved(message); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la operación.'); }
    finally { sending.current = false; setPending(false); }
  }
  const admins = (users || []).filter(u => u.role === 'admin' && !u.disabled);
  const current = draft?.type !== 'new' && draft ? draft.building : null;
  return <PanelShell title="Edificios" description="Crea edificios, asigna administradores y define el equipo central de cada red."
    actions={<IconButton label="Nuevo edificio" type="button" size="icon-sm" onClick={event => open({ type: 'new' }, event.currentTarget)}><Plus aria-hidden="true" /></IconButton>} notice={notice}>
    <DataTable
      headings={['Edificio', 'Dirección', 'Estado', 'Equipo central', 'Acciones']}
      empty="Crea tu primer edificio para empezar."
      rows={buildings.map(b => <TableRow key={b.id}>
          <TableCell><strong>{b.name}</strong></TableCell>
          <TableCell>{b.address || '—'}</TableCell>
          <TableCell>{b.disabled ? <StatusText tone="danger">Deshabilitado</StatusText> : <StatusText>Habilitado</StatusText>}</TableCell>
          <TableCell>{centralName(b.central_router_id)}</TableCell>
          <TableCell><div className="flex flex-wrap gap-2">
            {([
              { type: 'edit', label: 'Editar', name: `Editar ${b.name}`, Icon: Pencil },
              { type: 'toggle', label: b.disabled ? 'Activar' : 'Desactivar', name: `${b.disabled ? 'Activar' : 'Desactivar'} ${b.name}`, Icon: Power },
              { type: 'remove', label: 'Eliminar', name: `Eliminar ${b.name}`, Icon: Trash2 },
            ] as const).map(({ type, label, name, Icon }) => <IconButton key={type} label={name} tip={label} type="button" variant="outline" size="icon-sm" onClick={event => open({ type, building: b }, event.currentTarget)}><Icon aria-hidden="true" /></IconButton>)}
          </div></TableCell>
        </TableRow>)} />
    <Card><CardContent><p className="text-sm text-muted-foreground">Cada edificio tiene su propia LAN y su propio MikroTik central. Un administrador puede tener varios edificios; el super-admin configura la red de cada uno. Los departamentos, planes e IPs son por edificio y pueden repetir rango privado en edificios distintos. Deshabilitar oculta el edificio a sus administradores. Eliminar exige que no tenga departamentos, routers ni planes.</p></CardContent></Card>
    {draft && <PendingDialog busy={pending} onClose={close} restoreFocus={restore}>
      <DialogHead title={draft.type === 'new' ? 'Nuevo edificio' : draft.type === 'edit' ? `Editar edificio · ${current!.name}` : draft.type === 'toggle' ? (current!.disabled ? 'Activar edificio' : 'Deshabilitar edificio') : draft.type === 'remove' ? 'Eliminar edificio' : draft.type === 'central' ? `Equipo central · ${current!.name}` : `Dar acceso · ID ${current!.id}`}
        description={draft.type === 'new' ? 'Crea el edificio y asigna un administrador si ya existe.' : draft.type === 'central' ? 'Al cambiar se solicita la configuración de sus departamentos en el nuevo equipo. El equipo central es obligatorio.' : draft.type === 'access' ? 'El usuario debe existir. Se le asigna este edificio sin quitarle los demás.' : draft.type === 'toggle' ? (current!.disabled ? `¿Activar el edificio ${current!.name}?` : `¿Deshabilitar el edificio ${current!.name}? Se ocultará a sus administradores.`) : draft.type === 'remove' ? `¿Eliminar definitivamente el edificio ${current!.name}? Exige que no tenga departamentos, routers ni planes. Esta acción no se puede deshacer.` : 'Corrige los datos del edificio.'} />
      <DialogBody>
        {draft.type === 'new' && <form id="bld-new-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings', { name: String(v.get('name') || '').trim(), address: String(v.get('address') || '').trim(), ...(v.get('admin_id') ? { admin_id: String(v.get('admin_id')) } : {}) }); }, 'Edificio creado.'); }}>
          <FormField id="bld-name" label="Nombre"><Input id="bld-name" name="name" required maxLength={100} placeholder="Edificio Norte" disabled={pending} /></FormField>
          <FormField id="bld-address" label="Dirección"><Input id="bld-address" name="address" required maxLength={200} placeholder="Av. Principal #123" disabled={pending} /></FormField>
          <FormField id="bld-admin" label="Administrador"><NativeSelect id="bld-admin" name="admin_id" defaultValue="" disabled={pending || users === null}><NativeSelectOption value="">Sin asignar por ahora</NativeSelectOption>{admins.map(a => <NativeSelectOption key={a.id} value={a.id}>{`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username} · {a.username}</NativeSelectOption>)}</NativeSelect></FormField>
          <FormError message={error} />
        </form>}
        {draft.type === 'edit' && <form id="bld-edit-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings/update', { building_id: current!.id, name: String(v.get('name') || '').trim(), address: String(v.get('address') || '').trim() }); }, 'Edificio actualizado.'); }}>
          <FormField id="bld-edit-name" label="Nombre"><Input id="bld-edit-name" name="name" required maxLength={100} defaultValue={current!.name} disabled={pending} /></FormField>
          <FormField id="bld-edit-address" label="Dirección"><Input id="bld-edit-address" name="address" required maxLength={200} defaultValue={current!.address || ''} disabled={pending} /></FormField>
          <FormError message={error} />
        </form>}
        {draft.type === 'central' && <form id="bld-central-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings/central', { building_id: current!.id, central_router_id: String(v.get('central_router_id') || '') }); }, 'Equipo central actualizado.'); }}>
          <FormField id="bld-central" label="Router MikroTik"><NativeSelect id="bld-central" name="central_router_id" defaultValue={current!.central_router_id || ''} required disabled={pending}>{options(current!.id).map(r => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}</NativeSelect></FormField>
          <FormError message={error} />
        </form>}
        {draft.type === 'access' && <form id="bld-access-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { const list: UserItem[] = await context.request('auth/users'); const u = list.find(x => x.username === String(v.get('username') || '').trim()); if (!u) throw new Error('Usuario no encontrado. Créalo primero en Usuarios.'); await context.request('buildings/assign', { user_id: u.id, building_id: current!.id }); }, 'Acceso asignado.'); }}>
          <FormField id="bld-access-user" label="Correo del administrador"><Input id="bld-access-user" name="username" required maxLength={160} placeholder="admin@correo.com" disabled={pending} /></FormField>
          <FormError message={error} />
        </form>}
        {(draft.type === 'toggle' || draft.type === 'remove') && <div className="grid gap-4"><FormError message={error} /></div>}
      </DialogBody>
      {['new', 'edit', 'central', 'access'].includes(draft.type) && <SubmitRow busy={pending} onClose={close} label="Guardar" form={`bld-${draft.type}-form`} />}
      {(draft.type === 'toggle' || draft.type === 'remove') && <SubmitRow busy={pending} onClose={close} label={draft.type === 'toggle' ? (current!.disabled ? 'Activar' : 'Deshabilitar') : 'Eliminar'} onConfirm={() => { if (draft.type === 'toggle') void run(async () => { await context.request('buildings/toggle', { building_id: current!.id, disabled: !current!.disabled }); }, current!.disabled ? 'Edificio activado.' : 'Edificio deshabilitado.'); else void run(async () => { await context.request('buildings/remove', { building_id: current!.id }); }, 'Edificio eliminado.'); }} />}
    </PendingDialog>}
  </PanelShell>;
}
