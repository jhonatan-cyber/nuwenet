import { useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody } from '@/components/ui/dialog';
import { FormError } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog } from '@/components/shared/dialog';
import { subscribe, getSnapshot, getServerSnapshot, closeAccount, setTheme, updatePreferences } from '@/features/auth/account-store';

function PasswordForm() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/auth/password', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo cambiar la contraseña.');
      location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña.'); setPending(false); }
  }
  return <form onSubmit={submit} className="grid gap-4" aria-busy={pending}>
    <FormField id="current-password" label="Contraseña actual"><Input id="current-password" name="current_password" type="password" autoComplete="current-password" required disabled={pending} /></FormField>
    <FormField id="new-password" label="Nueva contraseña"><Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required disabled={pending} /></FormField>
    <FormError message={error} />
    <Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Cambiar y cerrar sesiones'}</Button>
  </form>;
}
export default function AccountPanel() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const settings = state.page === 'settings';
  return <PendingDialog open={state.open} busy={false} id="account-dialog" onClose={closeAccount}
    restoreFocus={() => { document.querySelector<HTMLButtonElement>('#account-trigger')?.focus(); }}>
      <DialogHead title={settings ? 'Configuraciones' : 'Perfil'} description={settings ? 'Personaliza cómo se muestra tu panel.' : 'Administra tu cuenta y contraseña.'} />
      {settings ? <DialogBody>
        <fieldset className="grid gap-3"><legend className="mb-3 text-sm font-medium">Tema</legend><div className="grid grid-cols-3 gap-2">
          {([{value:'light',label:'Claro',Icon:Sun},{value:'dark',label:'Oscuro',Icon:Moon},{value:'system',label:'Sistema',Icon:Monitor}] as const).map(({value,label,Icon}) =>
            <Button type="button" key={value} variant={state.preferences.theme === value ? 'default' : 'outline'} aria-pressed={state.preferences.theme === value} onClick={() => setTheme(value)}><Icon aria-hidden="true" />{label}</Button>)}
        </div></fieldset>
        <Card className="gap-0 py-0"><CardContent className="grid gap-5 p-4">
          <div className="flex items-center justify-between gap-4"><div className="grid gap-1"><label htmlFor="compact" className="text-sm font-medium">Vista compacta</label><p id="compact-description" className="text-sm text-muted-foreground">Reduce el espacio entre filas y tarjetas.</p></div><Switch id="compact" checked={state.preferences.compact} onCheckedChange={compact => updatePreferences({compact})} aria-describedby="compact-description" /></div>
          <div className="flex items-center justify-between gap-4"><div className="grid gap-1"><label htmlFor="reduce-motion" className="text-sm font-medium">Reducir animaciones</label><p id="motion-description" className="text-sm text-muted-foreground">Evita transiciones en la navegación.</p></div><Switch id="reduce-motion" checked={state.preferences.reduceMotion} onCheckedChange={reduceMotion => updatePreferences({reduceMotion})} aria-describedby="motion-description" /></div>
        </CardContent></Card>
        <p role="status" className="text-sm text-muted-foreground">{state.message || 'Los cambios se guardan automáticamente en este navegador.'}</p>
      </DialogBody> : <DialogBody>
        <Card><CardContent className="grid gap-1"><p className="font-medium break-all">{state.user?.username}</p><p className="text-sm text-muted-foreground">{state.user?.role === 'superadmin' ? 'Super-admin (dueño del sistema)' : 'Administrador de edificio'}</p></CardContent></Card>
        <PasswordForm key={String(state.open)} />
      </DialogBody>}
    </PendingDialog>;
}
