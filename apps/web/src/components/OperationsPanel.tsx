import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Building2, Pencil, Plus, Power, Server, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { getOperations, getServerOperations, subscribeOperations, type OperationsContext } from '@/lib/operations-store';

interface Building { id: string; name: string; address?: string | null; disabled?: number | boolean; central_router_id?: string | null }
interface RouterItem { id: string; name: string; adapter: string; disabled?: number | boolean; building_id?: string | null; status?: string }
interface UserItem { id: string; username: string; role: string; first_name?: string; last_name?: string; ci?: string; phone?: string; address?: string; disabled?: boolean; building_ids?: string[] }

function useDialogFocus() {
  const trigger = useRef<HTMLButtonElement | null>(null);
  function capture(button: HTMLButtonElement) { trigger.current = button; }
  function restore() { trigger.current?.focus(); }
  return { capture, restore };
}

// ---------- Edificios ----------

type BuildingDraft =
  | { type: 'new' }
  | { type: 'edit'; building: Building }
  | { type: 'toggle'; building: Building }
  | { type: 'remove'; building: Building }
  | { type: 'central'; building: Building }
  | { type: 'access'; building: Building };

function BuildingsView({ context }: { context: OperationsContext }) {
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
  const centralName = (id?: string | null) => routers.find(r => r.id === id)?.name || 'Simulado';
  const options = (bid: string) => routers.filter(r => r.adapter === 'mikrotik-rest' && !r.disabled && (!r.building_id || r.building_id === bid));
  function open(next: BuildingDraft, button: HTMLButtonElement) { capture(button); setError(''); setDraft(next); setNotice(''); }
  function close() { if (!sending.current) setDraft(undefined); }
  async function saved(message: string) {
    setDraft(undefined); setNotice(message);
    try { await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado. Usa Actualizar.`); }
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
  return <PanelShell title="Edificios y accesos" description="Crea edificios, asigna administradores y define el equipo central de cada red."
    actions={<><Button type="button" variant="outline" onClick={() => { void context.refresh().catch(() => setNotice('No se pudo actualizar el listado.')); }}>Actualizar</Button><Button type="button" onClick={event => open({ type: 'new' }, event.currentTarget)}><Plus aria-hidden="true" />Nuevo edificio</Button></>} notice={notice}>
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Edificio', 'Dirección', 'Estado', 'Equipo central', 'Acciones'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{buildings.map(b => <TableRow key={b.id}>
          <TableCell><strong>{b.name}</strong><br /><span className="text-muted-foreground">ID {b.id}</span></TableCell>
          <TableCell>{b.address || '—'}</TableCell>
          <TableCell>{b.disabled ? <StatusText tone="danger">Deshabilitado</StatusText> : <StatusText>Habilitado</StatusText>}</TableCell>
          <TableCell>{centralName(b.central_router_id)}</TableCell>
          <TableCell><div className="flex flex-wrap gap-2">
            {([
              { type: 'edit', label: 'Editar', name: `Editar ${b.name}`, Icon: Pencil },
              { type: 'toggle', label: b.disabled ? 'Activar' : 'Desactivar', name: `${b.disabled ? 'Activar' : 'Desactivar'} ${b.name}`, Icon: Power },
              { type: 'remove', label: 'Eliminar', name: `Eliminar ${b.name}`, Icon: Trash2 },
            ] as const).map(({ type, label, name, Icon }) => <Tooltip key={type}>
              <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" aria-label={name} onClick={event => open({ type, building: b }, event.currentTarget)}><Icon aria-hidden="true" /></Button></TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>)}
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>
    {!buildings.length && <Card><CardContent><p className="text-sm text-muted-foreground">Crea tu primer edificio para empezar.</p></CardContent></Card>}
    <Card><CardContent><p className="text-sm text-muted-foreground">Cada edificio tiene su propia LAN y su propio MikroTik central. Un administrador puede tener varios edificios; el super-admin configura la red de cada uno. Los departamentos, planes e IPs son por edificio y pueden repetir rango privado en edificios distintos. Deshabilitar oculta el edificio a sus administradores. Eliminar exige que no tenga departamentos, routers ni planes.</p></CardContent></Card>
    {draft && <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restore(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
        <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>{draft.type === 'new' ? 'Nuevo edificio' : draft.type === 'edit' ? `Editar edificio · ${current!.name}` : draft.type === 'toggle' ? (current!.disabled ? 'Activar edificio' : 'Deshabilitar edificio') : draft.type === 'remove' ? 'Eliminar edificio' : draft.type === 'central' ? `Equipo central · ${current!.name}` : `Dar acceso · ID ${current!.id}`}</DialogTitle>
        <DialogDescription>{draft.type === 'new' ? 'Crea el edificio y asigna un administrador si ya existe.' : draft.type === 'central' ? 'Al cambiar se solicita la configuración de sus departamentos en el nuevo equipo. Vacío = simulado.' : draft.type === 'access' ? 'El usuario debe existir. Se le asigna este edificio sin quitarle los demás.' : draft.type === 'toggle' ? (current!.disabled ? `¿Activar el edificio ${current!.name}?` : `¿Deshabilitar el edificio ${current!.name}? Se ocultará a sus administradores.`) : draft.type === 'remove' ? `¿Eliminar definitivamente el edificio ${current!.name}? Exige que no tenga departamentos, routers ni planes. Esta acción no se puede deshacer.` : 'Corrige los datos del edificio.'}</DialogDescription></DialogHeader>
        <DialogBody>
        {draft.type === 'new' && <form id="bld-new-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings', { name: String(v.get('name') || '').trim(), address: String(v.get('address') || '').trim(), ...(v.get('admin_id') ? { admin_id: String(v.get('admin_id')) } : {}) }); }, 'Edificio creado.'); }}>
          <div className="grid gap-2"><label htmlFor="bld-name" className="text-sm font-medium">Nombre</label><Input id="bld-name" name="name" required maxLength={100} placeholder="Edificio Norte" disabled={pending} /></div>
          <div className="grid gap-2"><label htmlFor="bld-address" className="text-sm font-medium">Dirección</label><Input id="bld-address" name="address" required maxLength={200} placeholder="Av. Principal #123" disabled={pending} /></div>
          <div className="grid gap-2"><label htmlFor="bld-admin" className="text-sm font-medium">Administrador</label><NativeSelect id="bld-admin" name="admin_id" defaultValue="" disabled={pending || users === null}><NativeSelectOption value="">Sin asignar por ahora</NativeSelectOption>{admins.map(a => <NativeSelectOption key={a.id} value={a.id}>{`${a.first_name || ''} ${a.last_name || ''}`.trim() || a.username} · {a.username}</NativeSelectOption>)}</NativeSelect></div>
          <FormError message={error} />
        </form>}
        {draft.type === 'edit' && <form id="bld-edit-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings/update', { building_id: current!.id, name: String(v.get('name') || '').trim(), address: String(v.get('address') || '').trim() }); }, 'Edificio actualizado.'); }}>
          <div className="grid gap-2"><label htmlFor="bld-edit-name" className="text-sm font-medium">Nombre</label><Input id="bld-edit-name" name="name" required maxLength={100} defaultValue={current!.name} disabled={pending} /></div>
          <div className="grid gap-2"><label htmlFor="bld-edit-address" className="text-sm font-medium">Dirección</label><Input id="bld-edit-address" name="address" required maxLength={200} defaultValue={current!.address || ''} disabled={pending} /></div>
          <FormError message={error} />
        </form>}
        {draft.type === 'central' && <form id="bld-central-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { await context.request('buildings/central', { building_id: current!.id, central_router_id: v.get('central_router_id') ? String(v.get('central_router_id')) : null }); }, 'Equipo central actualizado.'); }}>
          <div className="grid gap-2"><label htmlFor="bld-central" className="text-sm font-medium">Router MikroTik</label><NativeSelect id="bld-central" name="central_router_id" defaultValue={current!.central_router_id || ''} disabled={pending}><NativeSelectOption value="">Sin equipo · simulado</NativeSelectOption>{options(current!.id).map(r => <NativeSelectOption key={r.id} value={r.id}>{r.name}</NativeSelectOption>)}</NativeSelect></div>
          <FormError message={error} />
        </form>}
        {draft.type === 'access' && <form id="bld-access-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async () => { const list: UserItem[] = await context.request('auth/users'); const u = list.find(x => x.username === String(v.get('username') || '').trim()); if (!u) throw new Error('Usuario no encontrado. Créalo primero en Usuarios y permisos.'); await context.request('buildings/assign', { user_id: u.id, building_id: current!.id }); }, 'Acceso asignado.'); }}>
          <div className="grid gap-2"><label htmlFor="bld-access-user" className="text-sm font-medium">Correo del administrador</label><Input id="bld-access-user" name="username" required maxLength={160} placeholder="admin@correo.com" disabled={pending} /></div>
          <FormError message={error} />
        </form>}
        {(draft.type === 'toggle' || draft.type === 'remove') && <div className="grid gap-4"><FormError message={error} /></div>}
        </DialogBody>
        {['new', 'edit', 'central', 'access'].includes(draft.type) && <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form={`bld-${draft.type}-form`} disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>}
        {(draft.type === 'toggle' || draft.type === 'remove') && <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="button" disabled={pending} onClick={() => { if (draft.type === 'toggle') void run(async () => { await context.request('buildings/toggle', { building_id: current!.id, disabled: !current!.disabled }); }, current!.disabled ? 'Edificio activado.' : 'Edificio deshabilitado.'); else void run(async () => { await context.request('buildings/remove', { building_id: current!.id }); }, 'Edificio eliminado.'); }}>{pending ? 'Guardando…' : draft.type === 'toggle' ? (current!.disabled ? 'Activar' : 'Deshabilitar') : 'Eliminar'}</Button></DialogFooter>}
      </DialogContent>
    </Dialog>}
  </PanelShell>;
}

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

function SettingsView({ context }: { context: OperationsContext }) {
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
      try { await context.refresh(); } catch { setNotice('Configuración guardada. No se pudo actualizar la vista. Usa Actualizar.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la configuración.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <PanelShell title="Edificio y automatización" description="Define las reglas de operación y el equipo central que controla los departamentos."
    actions={<Button type="button" variant="outline" onClick={() => { void context.refresh().catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button>} notice={notice}>
    <Card><CardContent className="grid gap-4"><h2 className="text-lg font-semibold">Equipo central por edificio (solo super-admin)</h2>
      <Table>
        <TableHeader><TableRow>{['Edificio', 'Central (MikroTik)', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{(context.buildings as Building[]).map(b => <TableRow key={b.id}>
          <TableCell>{b.name}</TableCell>
          <TableCell>{routers.find(r => r.id === b.central_router_id)?.name || 'Simulado'}</TableCell>
          <TableCell><Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" aria-label={`Cambiar central de ${b.name}`} onClick={event => { capture(event.currentTarget); setCentral(b); }}><Server aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Cambiar central</TooltipContent></Tooltip></TableCell>
        </TableRow>)}</TableBody>
      </Table>
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
    {central && <Dialog open onOpenChange={openState => { if (!openState && !sending.current) setCentral(null); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restore(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
        <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Central · {central.name}</DialogTitle><DialogDescription>Vacío = simulado.</DialogDescription></DialogHeader>
        <DialogBody><form id="settings-central-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); if (sending.current) return; const v = new FormData(event.currentTarget); sending.current = true; setPending(true); setError(''); context.request('buildings/central', { building_id: central.id, central_router_id: v.get('central_router_id') ? String(v.get('central_router_id')) : null }).then(() => { setCentral(null); setNotice('Equipo central actualizado.'); return context.refresh(); }).catch(err => setError(err instanceof Error ? err.message : 'No se pudo actualizar.')).finally(() => { sending.current = false; setPending(false); }); }}>
          <div className="grid gap-2"><label htmlFor="settings-central" className="text-sm font-medium">Router MikroTik</label><NativeSelect id="settings-central" name="central_router_id" defaultValue={central.central_router_id || ''} disabled={pending}><NativeSelectOption value="">Sin equipo · simulado</NativeSelectOption>{routers.filter(r => r.adapter === 'mikrotik-rest' && !r.disabled && (!r.building_id || r.building_id === central.id)).map(r => <NativeSelectOption key={r.id} value={r.id}>{r.name}{!r.building_id ? ' (sin asignar · se adopta)' : ''}</NativeSelectOption>)}</NativeSelect></div>
          <FormError message={error} />
        </form></DialogBody>
        <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={() => setCentral(null)} disabled={pending}>Cancelar</Button><Button type="submit" form="settings-central-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </PanelShell>;
}

// ---------- Usuarios ----------

type UserDraft =
  | { type: 'new' }
  | { type: 'edit'; user: UserItem }
  | { type: 'buildings'; user: UserItem }
  | { type: 'toggle'; user: UserItem }
  | { type: 'remove'; user: UserItem };

function UsersView({ context }: { context: OperationsContext }) {
  const [list, setList] = useState<UserItem[] | null>(null);
  const [draft, setDraft] = useState<UserDraft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const { capture, restore } = useDialogFocus();
  async function toggleUser(user: UserItem) {
    if (toggling !== null || sending.current) return false;
    setToggling(user.id); setNotice('');
    try {
      await context.request(`auth/users/${user.id}/update`, { role: user.role, disabled: !user.disabled });
      setNotice(user.disabled ? 'Administrador activado.' : 'Administrador deshabilitado.');
      const u: UserItem[] = await context.request('auth/users');
      setList(Array.isArray(u) ? u : []);
      await context.refresh();
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado.'); return false; }
    finally { setToggling(null); }
  }
  useEffect(() => {
    let cancelled = false;
    context.request('auth/users').then(u => { if (!cancelled) setList(Array.isArray(u) ? u : []); }).catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [context]);
  // El contenedor de acciones se rinde aunque esté vacío, como antes del cambio.
  if (!context.superadmin) return <PanelShell title="Usuarios y permisos" description="Super-admin: todo el sistema. Administrador: solo sus edificios. La red solo la configura el super-admin." notice="" actions={<></>}><Card><CardContent><p className="text-sm text-muted-foreground">Solo el super-admin gestiona usuarios.</p></CardContent></Card></PanelShell>;
  const bname = (id: string) => context.buildings.find(b => b.id === id)?.name || `ID ${String(id).slice(0, 8)}`;
  const fullName = (u: UserItem) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—';
  function open(next: UserDraft, button: HTMLButtonElement) { capture(button); setError(''); setDraft(next); setNotice(''); }
  function close() { if (!sending.current) setDraft(undefined); }
  async function saved(message: string) {
    setDraft(undefined); setNotice(message);
    try {
      const u: UserItem[] = await context.request('auth/users');
      setList(Array.isArray(u) ? u : []);
      await context.refresh();
    } catch { setNotice(`${message} No se pudo actualizar el listado. Usa Actualizar.`); }
  }
  async function run(fn: (values: FormData) => Promise<void>, message: string, values: FormData) {
    if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try { await fn(values); await saved(message); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la operación.'); }
    finally { sending.current = false; setPending(false); }
  }
  const rows = (list || []).filter(u => u.role !== 'superadmin');
  const current = draft && draft.type !== 'new' ? draft.user : null;
  return <PanelShell title="Usuarios y permisos" description="Super-admin: todo el sistema. Administrador: solo sus edificios. La red solo la configura el super-admin."
    actions={<><Button type="button" variant="outline" onClick={() => { void context.request('auth/users').then(u => setList(Array.isArray(u) ? u : [])).catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button><Button type="button" onClick={event => open({ type: 'new' }, event.currentTarget)}><Plus aria-hidden="true" />Crear administrador</Button></>} notice={notice}>
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Administrador', 'CI', 'Contacto', 'Edificios', 'Estado', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{rows.map(u => <TableRow key={u.id}>
          <TableCell><strong>{fullName(u)}</strong><br /><span className="text-muted-foreground">{u.username}</span></TableCell>
          <TableCell>{u.ci || '—'}</TableCell>
          <TableCell>{u.phone || '—'}<br /><span className="text-muted-foreground">{u.address || ''}</span></TableCell>
          <TableCell>{(u.building_ids || []).map(bname).join(', ') || '—'}</TableCell>
          <TableCell>{u.disabled ? 'Deshabilitado' : 'Habilitado'}</TableCell>
          <TableCell><div className="flex flex-wrap gap-2">
            {([
              { type: 'edit', label: 'Editar', name: `Editar ${u.username}`, Icon: Pencil },
              { type: 'buildings', label: 'Edificios', name: `Edificios de ${u.username}`, Icon: Building2 },
              { type: 'remove', label: 'Eliminar', name: `Eliminar ${u.username}`, Icon: Trash2 },
            ] as const).map(({ type, label, name, Icon }) => <Tooltip key={type}>
              <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" aria-label={name} disabled={toggling !== null} onClick={event => open({ type, user: u }, event.currentTarget)}><Icon aria-hidden="true" /></Button></TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>)}
            <Tooltip key="toggle">
              <TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" aria-label={`${u.disabled ? 'Activar' : 'Deshabilitar'} ${u.username}`} onClick={event => open({ type: 'toggle', user: u }, event.currentTarget)}><Power aria-hidden="true" /></Button></TooltipTrigger>
              <TooltipContent>{u.disabled ? 'Activar' : 'Deshabilitar'}</TooltipContent>
            </Tooltip>
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>
    {list && !rows.length && <Card><CardContent><p className="text-sm text-muted-foreground">Crea el primer administrador de edificio.</p></CardContent></Card>}
    {draft && <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restore(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
        <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>{draft.type === 'new' ? 'Crear administrador' : draft.type === 'edit' ? `Editar administrador · ${current!.username}` : draft.type === 'buildings' ? `Edificios de ${current!.username}` : draft.type === 'toggle' ? `${current!.disabled ? 'Activar' : 'Deshabilitar'} administrador` : 'Eliminar usuario'}</DialogTitle>
        <DialogDescription>{draft.type === 'new' ? 'El administrador solo verá sus edificios asignados.' : draft.type === 'edit' ? 'Corrige sus datos. El estado se cambia con el botón de la tabla. Se cerrarán sus sesiones.' : draft.type === 'buildings' ? 'Asigna o retira edificios sin quitar los demás accesos.' : draft.type === 'toggle' ? (current!.disabled ? `¿Activar a ${current!.username}? Recuperará el acceso a sus edificios.` : `¿Deshabilitar a ${current!.username}? No podrá iniciar sesión y se cerrarán sus sesiones.`) : `¿Eliminar definitivamente a ${`${current!.first_name || ''} ${current!.last_name || ''}`.trim() || current!.username} (${current!.username})? Se quitarán sus accesos y sesiones. Esta acción no se puede deshacer.`}</DialogDescription></DialogHeader>
        {draft.type === 'new' && <>
          <form id="user-form" className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { await context.request('auth/users', { ci: String(values.get('ci') || '').trim(), first_name: String(values.get('first_name') || '').trim(), last_name: String(values.get('last_name') || '').trim(), address: String(values.get('address') || '').trim(), phone: String(values.get('phone') || '').trim(), username: String(values.get('username') || '').trim(), password: String(values.get('password') || ''), role: 'admin' }); }, 'Administrador creado.', v); }}>
            <div className="grid gap-2"><label htmlFor="user-ci" className="text-sm font-medium">CI</label><Input id="user-ci" name="ci" required maxLength={40} autoComplete="off" placeholder="1234567" disabled={pending} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="user-first" className="text-sm font-medium">Nombre</label><Input id="user-first" name="first_name" required maxLength={80} autoComplete="off" disabled={pending} /></div><div className="grid gap-2"><label htmlFor="user-last" className="text-sm font-medium">Apellido</label><Input id="user-last" name="last_name" required maxLength={80} autoComplete="off" disabled={pending} /></div></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="user-address" className="text-sm font-medium">Dirección</label><Input id="user-address" name="address" required maxLength={200} autoComplete="off" disabled={pending} /></div><div className="grid gap-2"><label htmlFor="user-phone" className="text-sm font-medium">Teléfono</label><Input id="user-phone" name="phone" maxLength={80} autoComplete="off" disabled={pending} /></div></div>
            <div className="grid gap-2"><label htmlFor="user-username" className="text-sm font-medium">Usuario (correo)</label><Input id="user-username" name="username" required maxLength={160} autoComplete="off" placeholder="admin@correo.com" disabled={pending} /></div>
            <div className="grid gap-2"><label htmlFor="user-password" className="text-sm font-medium">Contraseña inicial</label><Input id="user-password" name="password" type="password" required minLength={8} maxLength={256} autoComplete="new-password" disabled={pending} /></div>
            <FormError message={error} />
          </form>
          <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="user-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
        </>}
        {draft.type === 'edit' && <>
          <form id="user-perms-form" className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { await context.request(`auth/users/${current!.id}/update`, { username: String(values.get('username') || '').trim(), ci: String(values.get('ci') || '').trim(), first_name: String(values.get('first_name') || '').trim(), last_name: String(values.get('last_name') || '').trim(), address: String(values.get('address') || '').trim(), phone: String(values.get('phone') || '').trim(), role: current!.role, disabled: Boolean(current!.disabled) }); }, 'Administrador actualizado.', v); }}>
            <div className="grid gap-2"><label htmlFor="user-edit-ci" className="text-sm font-medium">CI</label><Input id="user-edit-ci" name="ci" required maxLength={40} autoComplete="off" defaultValue={current!.ci || ''} disabled={pending} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="user-edit-first" className="text-sm font-medium">Nombre</label><Input id="user-edit-first" name="first_name" required maxLength={80} autoComplete="off" defaultValue={current!.first_name || ''} disabled={pending} /></div><div className="grid gap-2"><label htmlFor="user-edit-last" className="text-sm font-medium">Apellido</label><Input id="user-edit-last" name="last_name" required maxLength={80} autoComplete="off" defaultValue={current!.last_name || ''} disabled={pending} /></div></div>
            <div className="grid gap-2"><label htmlFor="user-edit-address" className="text-sm font-medium">Dirección</label><Input id="user-edit-address" name="address" required maxLength={200} autoComplete="off" defaultValue={current!.address || ''} disabled={pending} /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="user-edit-phone" className="text-sm font-medium">Teléfono</label><Input id="user-edit-phone" name="phone" maxLength={80} autoComplete="off" defaultValue={current!.phone || ''} disabled={pending} /></div><div className="grid gap-2"><label htmlFor="user-edit-username" className="text-sm font-medium">Usuario (correo)</label><Input id="user-edit-username" name="username" type="email" required maxLength={160} autoComplete="off" defaultValue={current!.username} disabled={pending} /></div></div>
            <FormError message={error} />
          </form>
          <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="user-perms-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
        </>}
        {draft.type === 'buildings' && <>
          <form id="user-buildings-form" className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { const wanted = context.buildings.filter(b => values.get(`bid_${b.id}`) === 'on').map(b => b.id); const currentIds = current!.building_ids || []; for (const bid of wanted.filter(b => !currentIds.includes(b))) await context.request('buildings/assign', { user_id: current!.id, building_id: bid }); for (const bid of currentIds.filter(b => !wanted.includes(b))) await context.request('buildings/unassign', { user_id: current!.id, building_id: bid }); }, 'Edificios actualizados.', v); }}>
            <fieldset className="grid gap-2"><legend className="text-sm font-medium">Edificios asignados</legend>{context.buildings.length ? context.buildings.map(b => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`bid_${b.id}`} defaultChecked={(current!.building_ids || []).includes(b.id)} disabled={pending} /> {b.name}</label>) : <p className="text-sm text-muted-foreground">Primero crea un edificio.</p>}</fieldset>
            <FormError message={error} />
          </form>
          <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="user-buildings-form" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
        </>}
        {draft.type === 'toggle' && <>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4"><FormError message={error} /></div>
          <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending || toggling !== null}>Cancelar</Button><Button type="button" disabled={pending || toggling !== null} onClick={() => { void toggleUser(current!).then(ok => { if (ok) close(); }); }}>{toggling !== null ? 'Guardando…' : current!.disabled ? 'Activar' : 'Deshabilitar'}</Button></DialogFooter>
        </>}
        {draft.type === 'remove' && <>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4"><FormError message={error} /></div>
          <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="button" disabled={pending} onClick={() => { void run(async () => { await context.request(`auth/users/${current!.id}/remove`, {}); }, 'Usuario eliminado.', new FormData()); }}>Eliminar</Button></DialogFooter>
        </>}
      </DialogContent>
    </Dialog>}
  </PanelShell>;
}

// ---------- Respaldos ----------

interface BackupItem { name: string; created_at: string; driver: string }

function BackupsView({ context }: { context: OperationsContext }) {
  const [list, setList] = useState<BackupItem[] | null>(null);
  const [policy, setPolicy] = useState<Record<string, any> | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, p] = await Promise.all([context.request('backups'), context.request('backups/policy')]);
        if (!cancelled) { setList(Array.isArray(b) ? b : []); setPolicy(p || {}); }
      } catch { if (!cancelled) setList([]); }
    })();
    return () => { cancelled = true; };
  }, [context]);
  async function reload() {
    try {
      const [b, p] = await Promise.all([context.request('backups'), context.request('backups/policy')]);
      setList(Array.isArray(b) ? b : []); setPolicy(p || {});
      await context.refresh();
    } catch { setNotice('No se pudo actualizar el listado. Usa Actualizar.'); }
  }
  return <PanelShell title="Respaldos" description="Copias verificadas de la base y la clave de los routers."
    actions={<><Button type="button" variant="outline" onClick={() => { void reload().catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button><Button type="button" disabled={busy !== null} onClick={() => { if (busy) return; setBusy('new'); context.request('backups', {}).then(() => { setNotice('Respaldo creado y verificado.'); return reload(); }).catch(err => setNotice(err instanceof Error ? err.message : 'No se pudo crear el respaldo.')).finally(() => setBusy(null)); }}>{busy === 'new' ? 'Creando…' : 'Crear respaldo ahora'}</Button></>} notice={notice}>
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Respaldo', 'Fecha', 'Motor', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{(list || []).map(b => <TableRow key={b.name}>
          <TableCell>{b.name}</TableCell>
          <TableCell>{context.date(b.created_at)}</TableCell>
          <TableCell>{b.driver}</TableCell>
          <TableCell><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => { if (busy) return; setBusy(b.name); context.request(`backups/${encodeURIComponent(b.name)}/verify`, {}).then(() => setNotice('Integridad del respaldo verificada.')).catch(err => setNotice(err instanceof Error ? err.message : 'No se pudo verificar.')).finally(() => setBusy(null)); }}>{busy === b.name ? 'Verificando…' : 'Verificar integridad'}</Button></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>
    {list && !list.length && <Card><CardContent><p className="text-sm text-muted-foreground">Aún no hay respaldos. Crea el primero.</p></CardContent></Card>}
    {policy && <Card><CardContent><p className="text-sm text-muted-foreground">{policy.retention_days} días de retención; se conservan al menos {policy.minimum_copies} copias verificadas. Copia externa: {policy.external_configured ? (policy.external_available ? 'configurada' : 'destino no disponible') : 'pendiente de configurar'}. La restauración se realiza en un directorio nuevo, sin sobrescribir la base en uso. El procedimiento está documentado en la guía de operación del proyecto.</p></CardContent></Card>}
  </PanelShell>;
}

// ---------- Auditoría ----------

interface AuditItem { created_at: string; username: string; action: string }

function AuditView({ context }: { context: OperationsContext }) {
  const [list, setList] = useState<AuditItem[] | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    context.request('audit').then(a => { if (!cancelled) setList(Array.isArray(a) ? a : []); }).catch(() => { if (!cancelled) { setList([]); setNotice('No se pudo cargar la auditoría.'); } });
    return () => { cancelled = true; };
  }, [context]);
  return <PanelShell title="Auditoría" description="Últimas 200 operaciones realizadas por usuarios autenticados."
    actions={<Button type="button" variant="outline" onClick={() => { void context.request('audit').then(a => setList(Array.isArray(a) ? a : [])).catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button>} notice={notice}>
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>{['Fecha', 'Usuario', 'Operación'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{(list || []).map((a, i) => <TableRow key={i}>
          <TableCell>{context.date(a.created_at)}</TableCell>
          <TableCell>{a.username}</TableCell>
          <TableCell>{a.action}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </CardContent></Card>
  </PanelShell>;
}

export default function OperationsPanel() {
  const state = useSyncExternalStore(subscribeOperations, getOperations, getServerOperations);
  if (!state.visible || !state.context) return null;
  const context = state.context;
  const key = `${state.context.userId}:${state.context.page}`;
  if (context.page === 'buildings') return <BuildingsView key={key} context={context} />;
  if (context.page === 'settings') return <SettingsView key={key} context={context} />;
  if (context.page === 'users') return <UsersView key={key} context={context} />;
  if (context.page === 'backups') return <BackupsView key={key} context={context} />;
  return <AuditView key={`${key}:audit`} context={context} />;
}
