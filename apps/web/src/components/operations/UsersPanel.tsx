import { useEffect, useRef, useState } from 'react';
import { Building2, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TableCell, TableRow } from '@/components/ui/table';
import { FormError, PanelShell } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog, SubmitRow, useDialogFocus } from '@/components/shared/dialog';
import { DataTable } from '@/components/shared/table';
import { type OperationsContext } from '@/features/operations/operations-store';
import type { UserItem } from './types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Usuarios ----------

type UserDraft =
  | { type: 'new' }
  | { type: 'edit'; user: UserItem }
  | { type: 'buildings'; user: UserItem }
  | { type: 'toggle'; user: UserItem }
  | { type: 'remove'; user: UserItem };

export function UsersView({ context }: { context: OperationsContext }) {
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
  if (!context.superadmin) return <PanelShell title="Usuarios" description="Super-admin: todo el sistema. Administrador: solo sus edificios. La red solo la configura el super-admin." notice="" actions={<></>}><Card><CardContent><p className="text-sm text-muted-foreground">Solo el super-admin gestiona usuarios.</p></CardContent></Card></PanelShell>;
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
    } catch { setNotice(`${message} No se pudo actualizar el listado.`); }
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
  return <PanelShell title="Usuarios" description="Super-admin: todo el sistema. Administrador: solo sus edificios. La red solo la configura el super-admin."
    actions={<IconButton label="Crear administrador" type="button" size="icon-sm" onClick={event => open({ type: 'new' }, event.currentTarget)}><Plus aria-hidden="true" /></IconButton>} notice={notice}>
    <DataTable
      headings={['Administrador', 'CI', 'Contacto', 'Edificios', 'Estado', 'Acción']}
      empty={list && 'Crea el primer administrador de edificio.'}
      rows={rows.map(u => <TableRow key={u.id}>
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
            ] as const).map(({ type, label, name, Icon }) => <IconButton key={type} label={name} tip={label} type="button" variant="outline" size="icon-sm" disabled={toggling !== null} onClick={event => open({ type, user: u }, event.currentTarget)}><Icon aria-hidden="true" /></IconButton>)}
            <IconButton key="toggle" label={`${u.disabled ? 'Activar' : 'Deshabilitar'} ${u.username}`} tip={u.disabled ? 'Activar' : 'Deshabilitar'} type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'toggle', user: u }, event.currentTarget)}><Power aria-hidden="true" /></IconButton>
          </div></TableCell>
        </TableRow>)} />
    {draft && <PendingDialog busy={pending} onClose={close} restoreFocus={restore}>
      <DialogHead title={draft.type === 'new' ? 'Crear administrador' : draft.type === 'edit' ? `Editar administrador · ${current!.username}` : draft.type === 'buildings' ? `Edificios de ${current!.username}` : draft.type === 'toggle' ? `${current!.disabled ? 'Activar' : 'Deshabilitar'} administrador` : 'Eliminar usuario'}
        description={draft.type === 'new' ? 'El administrador solo verá sus edificios asignados.' : draft.type === 'edit' ? 'Corrige sus datos. El estado se cambia con el botón de la tabla. Se cerrarán sus sesiones.' : draft.type === 'buildings' ? 'Asigna o retira edificios sin quitar los demás accesos.' : draft.type === 'toggle' ? (current!.disabled ? `¿Activar a ${current!.username}? Recuperará el acceso a sus edificios.` : `¿Deshabilitar a ${current!.username}? No podrá iniciar sesión y se cerrarán sus sesiones.`) : `¿Eliminar definitivamente a ${`${current!.first_name || ''} ${current!.last_name || ''}`.trim() || current!.username} (${current!.username})? Se quitarán sus accesos y sesiones. Esta acción no se puede deshacer.`} />
      {draft.type === 'new' && <>
        <DialogBody>
          <form id="user-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { await context.request('auth/users', { ci: String(values.get('ci') || '').trim(), first_name: String(values.get('first_name') || '').trim(), last_name: String(values.get('last_name') || '').trim(), address: String(values.get('address') || '').trim(), phone: String(values.get('phone') || '').trim(), username: String(values.get('username') || '').trim(), password: String(values.get('password') || ''), role: 'admin' }); }, 'Administrador creado.', v); }}>
            <FormField id="user-ci" label="CI"><Input id="user-ci" name="ci" required maxLength={40} autoComplete="off" placeholder="1234567" disabled={pending} /></FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField id="user-first" label="Nombre"><Input id="user-first" name="first_name" required maxLength={80} autoComplete="off" disabled={pending} /></FormField><FormField id="user-last" label="Apellido"><Input id="user-last" name="last_name" required maxLength={80} autoComplete="off" disabled={pending} /></FormField></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField id="user-address" label="Dirección"><Input id="user-address" name="address" required maxLength={200} autoComplete="off" disabled={pending} /></FormField><FormField id="user-phone" label="Teléfono"><Input id="user-phone" name="phone" maxLength={80} autoComplete="off" disabled={pending} /></FormField></div>
            <FormField id="user-username" label="Usuario (correo)"><Input id="user-username" name="username" required maxLength={160} autoComplete="off" placeholder="admin@correo.com" disabled={pending} /></FormField>
            <FormField id="user-password" label="Contraseña inicial"><Input id="user-password" name="password" type="password" required minLength={8} maxLength={256} autoComplete="new-password" disabled={pending} /></FormField>
            <FormError message={error} />
          </form>
        </DialogBody>
        <SubmitRow busy={pending} onClose={close} label="Guardar" form="user-form" />
      </>}
      {draft.type === 'edit' && <>
        <DialogBody>
          <form id="user-perms-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { await context.request(`auth/users/${current!.id}/update`, { username: String(values.get('username') || '').trim(), ci: String(values.get('ci') || '').trim(), first_name: String(values.get('first_name') || '').trim(), last_name: String(values.get('last_name') || '').trim(), address: String(values.get('address') || '').trim(), phone: String(values.get('phone') || '').trim(), role: current!.role, disabled: Boolean(current!.disabled) }); }, 'Administrador actualizado.', v); }}>
            <FormField id="user-edit-ci" label="CI"><Input id="user-edit-ci" name="ci" required maxLength={40} autoComplete="off" defaultValue={current!.ci || ''} disabled={pending} /></FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField id="user-edit-first" label="Nombre"><Input id="user-edit-first" name="first_name" required maxLength={80} autoComplete="off" defaultValue={current!.first_name || ''} disabled={pending} /></FormField><FormField id="user-edit-last" label="Apellido"><Input id="user-edit-last" name="last_name" required maxLength={80} autoComplete="off" defaultValue={current!.last_name || ''} disabled={pending} /></FormField></div>
            <FormField id="user-edit-address" label="Dirección"><Input id="user-edit-address" name="address" required maxLength={200} autoComplete="off" defaultValue={current!.address || ''} disabled={pending} /></FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField id="user-edit-phone" label="Teléfono"><Input id="user-edit-phone" name="phone" maxLength={80} autoComplete="off" defaultValue={current!.phone || ''} disabled={pending} /></FormField><FormField id="user-edit-username" label="Usuario (correo)"><Input id="user-edit-username" name="username" type="email" required maxLength={160} autoComplete="off" defaultValue={current!.username} disabled={pending} /></FormField></div>
            <FormError message={error} />
          </form>
        </DialogBody>
        <SubmitRow busy={pending} onClose={close} label="Guardar" form="user-perms-form" />
      </>}
      {draft.type === 'buildings' && <>
        <DialogBody>
          <form id="user-buildings-form" className="grid gap-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); const v = new FormData(event.currentTarget); void run(async values => { const wanted = context.buildings.filter(b => values.get(`bid_${b.id}`) === 'on').map(b => b.id); const currentIds = current!.building_ids || []; for (const bid of wanted.filter(b => !currentIds.includes(b))) await context.request('buildings/assign', { user_id: current!.id, building_id: bid }); for (const bid of currentIds.filter(b => !wanted.includes(b))) await context.request('buildings/unassign', { user_id: current!.id, building_id: bid }); }, 'Edificios actualizados.', v); }}>
            <FormField label="Edificios asignados"><fieldset className="grid gap-2">{context.buildings.length ? context.buildings.map(b => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`bid_${b.id}`} defaultChecked={(current!.building_ids || []).includes(b.id)} disabled={pending} /> {b.name}</label>) : <p className="text-sm text-muted-foreground">Primero crea un edificio.</p>}</fieldset></FormField>
            <FormError message={error} />
          </form>
        </DialogBody>
        <SubmitRow busy={pending} onClose={close} label="Guardar" form="user-buildings-form" />
      </>}
      {draft.type === 'toggle' && <>
        <DialogBody><FormError message={error} /></DialogBody>
        <SubmitRow busy={pending || toggling !== null} onClose={close} label={current!.disabled ? 'Activar' : 'Deshabilitar'} busyLabel="Guardando…" onConfirm={() => { void toggleUser(current!).then(ok => { if (ok) close(); }); }} />
      </>}
      {draft.type === 'remove' && <>
        <DialogBody><FormError message={error} /></DialogBody>
        <SubmitRow busy={pending} onClose={close} label="Eliminar" onConfirm={() => { void run(async () => { await context.request(`auth/users/${current!.id}/remove`, {}); }, 'Usuario eliminado.', new FormData()); }} />
      </>}
    </PendingDialog>}
  </PanelShell>;
}
