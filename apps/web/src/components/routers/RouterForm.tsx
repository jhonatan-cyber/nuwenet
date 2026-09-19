import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DialogBody } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError } from '@/components/panel-shell';
import { DialogHead, FormField, PendingDialog, SubmitRow } from '@/components/shared/dialog';
import type { RouterEntry, RouterAdapterInfo, RoutersContext } from '@/features/routers-network/routers-store';
import { IconButton } from '@/components/shared/icon-button';

interface RouterFormProps {
  router: RouterEntry | null;
  preset?: { host?: string; name?: string; building_id?: string };
  adapters: RouterAdapterInfo[];
  buildings: { id: string; name: string }[];
  context: RoutersContext;
  close: () => void;
  saved: (message: string) => void;
  restoreFocus: () => void;
}

export function RouterForm({ router, preset, adapters, buildings, context, close, saved, restoreFocus }: RouterFormProps) {
  const [advanced, setAdvanced] = useState(!!router);
  const [port, setPort] = useState(String(router?.port || 80));
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const sending = useRef(false);
  const revision = useRef(0);
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);

  function readBody(form: HTMLFormElement) {
    const body: Record<string, unknown> = Object.fromEntries(new FormData(form));
    for (const key of ['username', 'password']) if (!body[key]) delete body[key];
    if (body.building_id === '' || body.building_id == null) delete body.building_id;
    return body;
  }

  async function test(form: HTMLFormElement) {
    if (testing || !form.reportValidity()) return;
    const body = readBody(form); delete body.name;
    const version = ++revision.current;
    setTesting(true); setTestResult({ ok: true, text: 'Consultando el equipo. Puede tardar hasta tres minutos.' }); setError('');
    try {
      const result = await context.request('routers/test', body);
      if (!active.current || version !== revision.current) return;
      setTestResult({ ok: true, text: `Conexión correcta · ${result.snapshot.manufacturer}${result.snapshot.model ? ' ' + result.snapshot.model : ''}. El router todavía no se ha guardado.` });
    } catch (err) {
      if (!active.current || version !== revision.current) return;
      setTestResult({ ok: false, text: err instanceof Error ? err.message : 'No se pudo probar la conexión.' });
    } finally { if (active.current) setTesting(false); }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || testing) return;
    const form = event.currentTarget;
    sending.current = true; setPending(true); setError('');
    const automatic = !router && !advanced;
    try {
      const body = readBody(form);
      if (router?.diagnostic_host && body.adapter === 'arris-touchstone') body.diagnostic_host = router.diagnostic_host;
      await context.request(router ? `routers/${router.id}/update` : automatic ? 'routers/connect' : 'routers', body);
      saved(automatic ? 'Router conectado. Información actualizada.' : 'Conexión guardada. Usa «Probar conexión» para consultar el equipo.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la conexión.'); }
    finally { sending.current = false; setPending(false); }
  }

  return (
    <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead
        title={router ? 'Editar conexión' : 'Agregar router'}
        description={router ? 'Deja usuario y contraseña vacíos para conservar las credenciales. Usa una IP privada accesible por LAN o VPN.' : 'Detectaremos el equipo y consultaremos la información disponible. Las credenciales se guardan cifradas. Usa una IP privada accesible por LAN o VPN.'}
      />
      <DialogBody>
        <form id="router-form" className="grid gap-4" onSubmit={submit} aria-busy={pending} onInput={() => { revision.current++; setTestResult(null); }}>
          <FormField id="router-host" label="IP de administración"><Input id="router-host" name="host" required placeholder="192.168.0.1" defaultValue={router?.host || preset?.host || ''} disabled={pending} /></FormField>
          <FormField id="router-username" label="Usuario"><Input id="router-username" name="username" autoComplete="off" maxLength={100} required={!router} disabled={pending} /></FormField>
          <FormField id="router-password" label="Contraseña"><Input id="router-password" name="password" type="password" autoComplete="new-password" maxLength={256} required={!router} disabled={pending} /></FormField>
          <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
            <summary className="cursor-pointer text-sm font-medium">Configuración avanzada</summary>
            <div className="grid gap-4 pt-3">
              <FormField id="router-name" label="Nombre"><Input id="router-name" name="name" required maxLength={100} placeholder="Router principal" defaultValue={router?.name || preset?.name || 'Router principal'} disabled={pending || !advanced} /></FormField>
              <FormField id="router-building" label="Edificio (opcional)" hint="Puedes dejarlo vacío y vincularlo después. Un edificio puede tener varios equipos; el control central se selecciona por separado.">
                <NativeSelect id="router-building" name="building_id" defaultValue={router?.building_id || preset?.building_id || ''} disabled={pending || !advanced}>
                  <NativeSelectOption value="">Sin edificio · se asigna después</NativeSelectOption>
                  {buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}
                  {router?.building_id && !buildings.some(b => b.id === router.building_id) && <NativeSelectOption value={router.building_id}>Edificio {router.building_id} (actual)</NativeSelectOption>}
                </NativeSelect>
              </FormField>
              <FormField id="router-adapter" label="Adaptador"><NativeSelect id="router-adapter" name="adapter" aria-label="Adaptador" defaultValue={router?.adapter || adapters[0]?.id} disabled={pending || !advanced}>{adapters.map(a => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect></FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField id="router-protocol" label="Protocolo"><NativeSelect id="router-protocol" name="protocol" aria-label="Protocolo" defaultValue={router?.protocol || 'http'} disabled={pending || !advanced} onChange={event => setPort(event.target.value === 'https' ? '443' : '80')}><NativeSelectOption value="http">HTTP</NativeSelectOption><NativeSelectOption value="https">HTTPS</NativeSelectOption></NativeSelect></FormField>
                <FormField id="router-port" label="Puerto"><Input id="router-port" name="port" type="number" required min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} disabled={pending || !advanced} /></FormField>
              </div>
            </div>
          </details>
          {!router && (
            <div className="grid gap-2">
              <div><IconButton label={testing ? 'Probando conexión…' : 'Probar conexión'} type="button" variant="outline" size="icon-sm" disabled={pending || testing} onClick={event => { const f = event.currentTarget.closest('form'); if (f) void test(f); }}><Activity aria-hidden="true" /></IconButton></div>
              {testResult && <p role="status" className={testResult.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>{testResult.text}</p>}
            </div>
          )}
          <FormError message={error} />
        </form>
      </DialogBody>
      <SubmitRow busy={pending} onClose={close} form="router-form" submitDisabled={testing}
        label={router || advanced ? 'Guardar' : 'Conectar router'}
        busyLabel={router || advanced ? 'Guardando…' : 'Conectando…'} />
    </PendingDialog>
  );
}
