import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Activity, Ban, Clock, Gauge, Pencil, Play, Plus, Power, Server, Shield, SlidersHorizontal, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { getRouters, getServerRouters, subscribeRouters, type RouterClient, type RouterEntry, type RouterAdapterInfo, type RoutersContext } from '@/lib/routers-store';

const capNames: Record<string, string> = { identification: 'Identificación', status: 'Estado', interfaces: 'Interfaces', suspend: 'Suspensión', reactivate: 'Reactivación', speed_limit: 'Límite de velocidad', firewall: 'Firewall', parental_control: 'Control parental' };
const arrisCapNames: Record<string, string> = { ...capNames, suspend: 'Bloqueo IPv4 TCP/UDP', reactivate: 'Desbloqueo IPv4', firewall: 'Filtros de puertos IPv4', parental_control: 'Horarios IPv4' };

const opOrder = ['suspend', 'reactivate', 'speed_limit', 'firewall', 'parental_control'] as const;
type Op = typeof opOrder[number];
function opMeta(isArris: boolean): Record<Op, { label: string; Icon: typeof Ban }> {
  return {
    suspend: { label: isArris ? 'Bloquear IPv4 TCP/UDP' : 'Suspender internet', Icon: Ban },
    reactivate: { label: isArris ? 'Desbloquear IPv4' : 'Reactivar internet', Icon: Play },
    speed_limit: { label: 'Límite de velocidad', Icon: Gauge },
    firewall: { label: isArris ? 'Filtro de puertos IPv4' : 'Bloquear destino', Icon: Shield },
    parental_control: { label: isArris ? 'Horario IPv4' : 'Horario parental', Icon: Clock },
  };
}

const isIpv4 = (ip?: string | null) => typeof ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(ip);
const detailValue = (value: unknown) => value === null || value === undefined || value === '' ? 'Sin dato' : String(value);

function randomSecret(length = 16) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let res = '';
  for (let i = 0; i < length; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function DeviceButtons({ router, client, canManage, onControl }: { router: RouterEntry; client: RouterClient; canManage: boolean; onControl: (op: Op, ip: string) => void }) {
  if (!canManage) return <span title="Solo el super-admin aplica acciones de red">🔒</span>;
  if (router?.disabled) return <span title="Router deshabilitado">🔒</span>;
  if (!router || !client || !isIpv4(client.ip)) return <span>—</span>;
  const isArris = router.adapter === 'arris-touchstone';
  const meta = opMeta(isArris);
  const blocked = Array.isArray(router.snapshot?.blocked) && router.snapshot.blocked.includes(client.ip!);
  const ops = opOrder.filter(op => router.capabilities?.[op]);
  if (!ops.length) return <span>—</span>;
  return <div className="flex flex-wrap gap-1" role="group" aria-label={`Acciones para ${client.ip}`}>
    {ops.map(op => { const { label, Icon } = meta[op]; return <Button key={op} type="button" variant="outline" size="icon" title={`${label} · ${client.ip}`} aria-label={`${label} ${client.ip}`} data-active={op === 'suspend' && blocked ? 'true' : undefined} onClick={() => onControl(op, client.ip!)}><Icon aria-hidden="true" /></Button>; })}
  </div>;
}

function LinkButton({ router, mac, onLink }: { router: RouterEntry; mac?: string | null; onLink: (mac: string) => void }) {
  if (!mac || router.disabled) return null;
  const linked = router.devices?.find(d => d.mac.toUpperCase() === mac.toUpperCase());
  return <Button type="button" variant="outline" size="sm" onClick={() => onLink(mac)}>{linked ? linked.apartment : 'Vincular departamento'}</Button>;
}

function Facts({ items }: { items: [string, unknown][] }) {
  return <dl className="grid gap-1 text-sm">{items.map(([label, value]) => <div key={label} className="flex gap-2"><dt className="text-muted-foreground">{label}:</dt><dd>{detailValue(value)}</dd></div>)}</dl>;
}

function ConnectionDetails({ router, canManage, onControl, onLink }: { router: RouterEntry; canManage: boolean; onControl: (op: Op, ip: string) => void; onLink: (mac: string) => void }) {
  const snapshot = router.snapshot;
  if (!snapshot) return null;
  return <div className="grid gap-3">
    {(snapshot.hardware || snapshot.serial) && <Facts items={[['Hardware', snapshot.hardware], ['Número de serie', snapshot.serial]]} />}
    {snapshot.wan && <details><summary className="cursor-pointer text-sm font-medium">Conexión a internet (WAN)</summary><Facts items={[['Tipo', snapshot.wan.connection], ['IP', snapshot.wan.ip], ['Máscara', snapshot.wan.subnet], ['Puerta de enlace', snapshot.wan.gateway], ['MAC', snapshot.wan.mac], ['DNS', snapshot.wan.dns?.join(', ')] ]} /></details>}
    {snapshot.lan && <details><summary className="cursor-pointer text-sm font-medium">Red local (LAN)</summary><Facts items={[['IP del router', snapshot.lan.ip], ['Máscara', snapshot.lan.subnet], ['Servidor DHCP', snapshot.lan.dhcp], ['Clientes LAN reportados', snapshot.lan.clients]]} /></details>}
    {snapshot.wireless?.length ? <div className="grid gap-2"><h3 className="text-sm font-semibold">Redes Wi-Fi</h3>{snapshot.wireless.map(w => <div key={w.band}><strong className="text-sm">{w.band}</strong><Facts items={[['Red (SSID)', w.ssid], ['Canal', w.channel], ['Modo', w.mode], ['MAC', w.mac], ['Clientes reportados', w.clients]]} /></div>)}</div> : null}
    {Array.isArray(snapshot.clients) && <div className="grid gap-2"><h3 className="text-sm font-semibold">Dispositivos reportados ({snapshot.clients.length})</h3><p className="text-sm text-muted-foreground">Datos de la última consulta; la presencia en esta lista no confirma conectividad en tiempo real. Pulsa «Probar conexión» para actualizar. Usa los iconos para suspender, reactivar, limitar velocidad, filtrar o programar horario.</p>
      {snapshot.clients.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Dispositivo</th><th className="p-2 text-left">IP</th><th className="p-2 text-left">MAC</th><th className="p-2 text-left">Conexión</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Departamento</th><th className="p-2 text-left">Acciones</th></tr></thead><tbody>
        {snapshot.clients.map((c, i) => <tr key={`${c.mac || c.ip || i}`} className="border-t"><td className="p-2">{detailValue(c.name)}</td><td className="p-2">{detailValue(c.ip)}{(c.addresses || []).filter(ip => ip !== c.ip).length ? <details><summary className="cursor-pointer text-xs">Otras IP ({(c.addresses || []).filter(ip => ip !== c.ip).length})</summary>{(c.addresses || []).filter(ip => ip !== c.ip).map(ip => <small key={ip} className="block">{ip}</small>)}</details> : null}</td><td className="p-2">{detailValue(c.mac)}</td><td className="p-2">{detailValue(c.connection)}</td><td className="p-2">{detailValue(c.status)}</td><td className="p-2"><LinkButton router={router} mac={c.mac} onLink={onLink} /></td><td className="p-2"><DeviceButtons router={router} client={c} canManage={canManage} onControl={onControl} /></td></tr>)}
      </tbody></table></div> : <p className="text-sm text-muted-foreground">El router no devolvió dispositivos en esta consulta.</p>}
    </div>}
  </div>;
}

// ---------- Formulario alta/edición ----------

function RouterForm({ router, adapters, buildings, routers, context, close, saved, restoreFocus }: { router: RouterEntry | null; adapters: RouterAdapterInfo[]; buildings: { id: number; name: string }[]; routers: RouterEntry[]; context: RoutersContext; close: () => void; saved: (message: string) => void; restoreFocus: () => void }) {
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
  const freeBuildings = buildings.filter(b => !routers.some(r => r.building_id === b.id && (!router || r.id !== router.id)));
  function readBody(form: HTMLFormElement) {
    const body: Record<string, unknown> = Object.fromEntries(new FormData(form));
    for (const key of ['username', 'password']) if (!body[key]) delete body[key];
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
  return <Dialog open onOpenChange={openState => { if (!openState && !sending.current) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{router ? 'Editar conexión' : 'Agregar router'}</DialogTitle><DialogDescription>{router ? 'Deja usuario y contraseña vacíos para conservar las credenciales. Usa una IP privada accesible por LAN o VPN.' : 'Detectaremos el equipo y consultaremos la información disponible. Las credenciales se guardan cifradas. Usa una IP privada accesible por LAN o VPN.'}</DialogDescription></DialogHeader>
      <form id="router-form" className="grid gap-4" onSubmit={submit} aria-busy={pending} onInput={() => { revision.current++; setTestResult(null); }}>
        <div className="grid gap-2"><label htmlFor="router-host" className="text-sm font-medium">IP de administración</label><Input id="router-host" name="host" required placeholder="192.168.0.1" defaultValue={router?.host || ''} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="router-username" className="text-sm font-medium">Usuario</label><Input id="router-username" name="username" autoComplete="off" maxLength={100} required={!router} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="router-password" className="text-sm font-medium">Contraseña</label><Input id="router-password" name="password" type="password" autoComplete="new-password" maxLength={256} required={!router} disabled={pending} /></div>
        <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Configuración avanzada</summary><div className="grid gap-4 pt-3">
          <div className="grid gap-2"><label htmlFor="router-name" className="text-sm font-medium">Nombre</label><Input id="router-name" name="name" required maxLength={100} placeholder="Router principal" defaultValue={router?.name || 'Router principal'} disabled={pending || !advanced} /></div>
          {freeBuildings.length ? <div className="grid gap-2"><label htmlFor="router-building" className="text-sm font-medium">Edificio (solo sin router asignado)</label><NativeSelect id="router-building" name="building_id" defaultValue={router?.building_id || ''} disabled={pending || !advanced}>{freeBuildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></div> : (!router && <p className="text-sm text-muted-foreground">Todos los edificios ya tienen un router asignado. Edita uno existente para cambiarlo de edificio.</p>)}
          <div className="grid gap-2"><label htmlFor="router-adapter" className="text-sm font-medium">Adaptador</label><NativeSelect id="router-adapter" name="adapter" aria-label="Adaptador" defaultValue={router?.adapter || adapters[0]?.id} disabled={pending || !advanced}>{adapters.map(a => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="router-protocol" className="text-sm font-medium">Protocolo</label><NativeSelect id="router-protocol" name="protocol" aria-label="Protocolo" defaultValue={router?.protocol || 'http'} disabled={pending || !advanced} onChange={event => setPort(event.target.value === 'https' ? '443' : '80')}><NativeSelectOption value="http">HTTP</NativeSelectOption><NativeSelectOption value="https">HTTPS</NativeSelectOption></NativeSelect></div>
          <div className="grid gap-2"><label htmlFor="router-port" className="text-sm font-medium">Puerto</label><Input id="router-port" name="port" type="number" required min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} disabled={pending || !advanced} /></div></div>
        </div></details>
        {!router && <div className="grid gap-2"><Button type="button" variant="outline" disabled={pending || testing} onClick={event => { const f = event.currentTarget.closest('form'); if (f) void test(f); }}>{testing ? 'Probando…' : 'Probar conexión'}</Button>{testResult && <p role="status" className={testResult.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>{testResult.text}</p>}</div>}
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || testing}>{pending ? (router || advanced ? 'Guardando…' : 'Conectando…') : (router || advanced ? 'Guardar' : 'Conectar router')}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

// ---------- Controlar dispositivo ----------

const controlActions: Op[] = [...opOrder];

function ControlDialog({ router, preset, context, close, saved, restoreFocus }: { router: RouterEntry; preset?: { action?: string; ip?: string }; context: RoutersContext; close: () => void; saved: (message: string) => void; restoreFocus: () => void }) {
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
  return <Dialog open onOpenChange={openState => { if (!openState && !sending.current) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Controlar dispositivo{preset?.ip ? ` · ${preset.ip}` : ''}</DialogTitle><DialogDescription>{isArris ? 'Las reglas afectan TCP/UDP por IPv4. No bloquean IPv6 ni otros protocolos. Los horarios usan la hora configurada en el router.' : 'Los cambios se aplican en el router seleccionado.'}</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="control-action" className="text-sm font-medium">Acción</label><NativeSelect id="control-action" name="action" value={action} onChange={event => setAction(event.target.value)} disabled={pending}>{available.map(a => <NativeSelectOption key={a} value={a}>{labels[a]}</NativeSelectOption>)}</NativeSelect></div>
        <div className="grid gap-2"><label htmlFor="control-ip" className="text-sm font-medium">IP del dispositivo</label><Input id="control-ip" name="ip" required placeholder="192.168.0.2" list="router-client-ips" defaultValue={preset?.ip || ''} disabled={pending} /><datalist id="router-client-ips">{(router.snapshot?.clients || []).filter(c => c.ip && !c.ip.includes(':')).map(c => <option key={c.ip!} value={c.ip!}>{c.name || c.mac || 'Dispositivo'}</option>)}</datalist></div>
        {action === 'speed_limit' && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="control-down" className="text-sm font-medium">Bajada (Mbps)</label><Input id="control-down" name="down" type="number" min={1} max={1000000} defaultValue="50" required disabled={pending} /></div><div className="grid gap-2"><label htmlFor="control-up" className="text-sm font-medium">Subida (Mbps)</label><Input id="control-up" name="up" type="number" min={1} max={1000000} defaultValue="20" required disabled={pending} /></div></div>}
        {action === 'firewall' && <><div className="grid gap-2"><label htmlFor="control-target" className="text-sm font-medium">{isArris ? 'Protocolo y puertos' : 'Destino (IP o dominio)'}</label><Input id="control-target" name="target" required placeholder={isArris ? 'tcp:80 o both:1000-2000' : 'ejemplo.com'} disabled={pending} /></div><div className="grid gap-2"><label htmlFor="control-remove" className="text-sm font-medium">Operación</label><NativeSelect id="control-remove" name="remove" defaultValue="false" disabled={pending}><NativeSelectOption value="false">Bloquear</NativeSelectOption><NativeSelectOption value="true">Quitar este filtro de NuweNet</NativeSelectOption></NativeSelect></div>{isArris && <p className="text-sm text-muted-foreground">Protocolos: tcp, udp o both. Solo se quita el filtro exacto indicado.</p>}</>}
        {action === 'parental_control' && <><div className="grid gap-2"><label htmlFor="control-schedule" className="text-sm font-medium">Horario de bloqueo</label><Input id="control-schedule" name="schedule" required placeholder="22h-7h,mon,tue,wed,thu,fri" disabled={pending} /></div><p className="text-sm text-muted-foreground">Días: sun, mon, tue, wed, thu, fri, sat. Escribe off para quitar el horario de NuweNet.</p></>}
        <p className="text-sm text-muted-foreground">Quitar un bloqueo conserva las demás restricciones del dispositivo.</p>
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending ? 'Aplicando…' : 'Aplicar'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

// ---------- Aprovisionar ----------

interface ServiceItem { name: string; port: number; disabled: boolean; address: string }

function ProvisionDialog({ router, context, close, restoreFocus }: { router: RouterEntry; context: RoutersContext; close: () => void; restoreFocus: () => void }) {
  const [tab, setTab] = useState<'services' | 'user' | 'script'>('services');
  const [services, setServices] = useState<ServiceItem[] | null>(null);
  const [servicesError, setServicesError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [username, setUsername] = useState('nuwenet-service');
  const [password, setPassword] = useState(randomSecret(16));
  const [updateVault, setUpdateVault] = useState(true);
  const [provPending, setProvPending] = useState(false);
  const [provResult, setProvResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sslPort, setSslPort] = useState(String(router.port || 443));
  const [disableInsecure, setDisableInsecure] = useState(true);
  const [script, setScript] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    context.request(`routers/${router.id}/services`).then(s => { if (!cancelled) setServices(Array.isArray(s) ? s : []); }).catch(err => { if (!cancelled) setServicesError(err instanceof Error ? err.message : 'No se pudieron consultar los servicios.'); });
    return () => { cancelled = true; };
  }, [context, router.id]);
  useEffect(() => {
    let cancelled = false;
    context.request('routers/script', { username: username.trim() || 'nuwenet-service', password: password || 'CAMBIAR_ESTA_CLAVE', sslPort: Number(sslPort) || 443, disableInsecure }).then(s => { if (!cancelled && s?.script) setScript(s.script); }).catch(() => {});
    return () => { cancelled = true; };
  }, [context, username, password, sslPort, disableInsecure]);
  async function saveService(svc: string, port: number, disabled: boolean, address: string) {
    setSaving(svc);
    try {
      await context.request(`routers/${router.id}/services`, { service: svc, port, disabled, address });
      setNotice(`Servicio ${svc} actualizado.`);
    } catch (err) { setNotice(err instanceof Error ? `Error: ${err.message}` : 'Error al guardar.'); }
    finally { setSaving(null); }
  }
  async function provision() {
    if (provPending) return;
    setProvPending(true); setProvResult(null);
    try {
      const data = await context.request(`routers/${router.id}/provision`, { username: username.trim(), password, updateStoredCredentials: updateVault });
      setProvResult({ ok: true, text: `✓ Usuario ${data.username} y grupo nuwenet configurados.${data.credentialsUpdated ? ' Credenciales del router actualizadas en el sistema.' : ''}` });
      setNotice('Aprovisionamiento completado con éxito.');
    } catch (err) { setProvResult({ ok: false, text: err instanceof Error ? err.message : 'Fallo al aprovisionar.' }); }
    finally { setProvPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(script); setNotice('Script copiado al portapapeles.'); }
    catch { setNotice('No se pudo copiar. Selecciona el texto manualmente.'); }
  }
  return <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
    <DialogContent className="sm:max-w-3xl" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader><DialogTitle>Aprovisionar MikroTik · {router.name}</DialogTitle><DialogDescription>Puertos, usuario de servicio y script de configuración inicial.</DialogDescription></DialogHeader>
      <div className="flex gap-2" role="tablist">
        {(['services', 'user', 'script'] as const).map((t, i) => <Button key={t} type="button" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>{i + 1}. {t === 'services' ? 'Servicios y Puertos' : t === 'user' ? 'Usuario NuweNet' : 'Script CLI'}</Button>)}
      </div>
      {tab === 'services' && <div className="grid gap-3"><p className="text-sm text-muted-foreground">Consulta y ajusta los servicios de RouterOS. Puedes activar o desactivar puertos y restringir la IP autorizada para conectarse.</p>
        {services ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Servicio</th><th className="p-2 text-left">Puerto</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">IP Permitida</th><th className="p-2 text-left">Acción</th></tr></thead><tbody>
          {services.map(s => <ServiceRow key={s.name} service={s} saving={saving === s.name} onSave={saveService} />)}
        </tbody></table></div> : servicesError ? <p role="alert" className="text-sm text-destructive">{servicesError}</p> : <p className="text-sm text-muted-foreground">Cargando servicios de RouterOS…</p>}
      </div>}
      {tab === 'user' && <div className="grid gap-4"><p className="text-sm text-muted-foreground">Crea un usuario exclusivo en el grupo <code>nuwenet</code> con permisos reducidos (<code>read, write, api, firewall, queue, dhcp, rest-api</code>) para no operar con la cuenta maestra <code>admin</code>.</p>
        <div className="grid gap-2"><label htmlFor="prov-user" className="text-sm font-medium">Nombre de usuario de servicio</label><Input id="prov-user" value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} disabled={provPending} /></div>
        <div className="grid gap-2"><label htmlFor="prov-pass" className="text-sm font-medium">Contraseña segura</label><div className="flex gap-2"><Input id="prov-pass" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} disabled={provPending} /><Button type="button" variant="outline" onClick={() => setPassword(randomSecret(16))} disabled={provPending}>Generar otra</Button></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updateVault} onChange={event => setUpdateVault(event.target.checked)} disabled={provPending} /> Actualizar credenciales guardadas en NuweNet</label>
        <div><Button type="button" onClick={() => { void provision(); }} disabled={provPending}>{provPending ? 'Aprovisionando…' : 'Crear usuario y grupo en MikroTik'}</Button></div>
        {provResult && <p role="status" className={provResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{provResult.text}</p>}
      </div>}
      {tab === 'script' && <div className="grid gap-4"><p className="text-sm text-muted-foreground">Si el MikroTik no tiene REST habilitado o prefieres configurarlo manualmente, copia y pega este script en la terminal de WinBox o SSH.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="cli-ssl-port" className="text-sm font-medium">Puerto SSL</label><Input id="cli-ssl-port" type="number" value={sslPort} onChange={event => setSslPort(event.target.value)} min={1} max={65535} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={disableInsecure} onChange={event => setDisableInsecure(event.target.checked)} /> Desactivar servicios inseguros</label></div>
        <textarea id="cli-script-box" readOnly rows={9} value={script} className="w-full font-mono text-xs" />
        <div><Button type="button" variant="outline" onClick={() => { void copy(); }}>Copiar script al portapapeles</Button></div>
      </div>}
      <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ServiceRow({ service, saving, onSave }: { service: ServiceItem; saving: boolean; onSave: (name: string, port: number, disabled: boolean, address: string) => void }) {
  const [port, setPort] = useState(String(service.port));
  const [enabled, setEnabled] = useState(!service.disabled);
  const [address, setAddress] = useState(service.address || '');
  return <tr className="border-t"><td className="p-2"><strong>{service.name}</strong></td>
    <td className="p-2"><Input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} className="w-20" disabled={saving} aria-label={`Puerto de ${service.name}`} /></td>
    <td className="p-2"><label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={saving} /> Activo</label></td>
    <td className="p-2"><Input type="text" value={address} onChange={event => setAddress(event.target.value)} placeholder="Cualquiera" className="w-32" disabled={saving} aria-label={`IP permitida de ${service.name}`} /></td>
    <td className="p-2"><Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => onSave(service.name, Number(port), !enabled, address.trim())}>{saving ? 'Guardando…' : 'Guardar'}</Button></td></tr>;
}

// ---------- Tráfico / Descubrir / Vincular / Confirmar ----------

interface TrafficStat { name: string; target?: string; downloadRate: number; uploadRate: number; downloadBytes: number; uploadBytes: number }

function TrafficDialog({ router, context, close, restoreFocus }: { router: RouterEntry; context: RoutersContext; close: () => void; restoreFocus: () => void }) {
  const [rows, setRows] = useState<TrafficStat[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data: TrafficStat[] = await context.request(`routers/${router.id}/traffic`);
        if (!stopped) setRows(Array.isArray(data) ? data : []);
      } catch (err) { if (!stopped) setError(err instanceof Error ? err.message : 'No se pudo consultar.'); }
      if (!stopped) timer = setTimeout(load, 3000);
    }
    void load();
    const onHash = () => { stopped = true; clearTimeout(timer); };
    window.addEventListener('hashchange', onHash, { once: true });
    return () => { stopped = true; clearTimeout(timer); window.removeEventListener('hashchange', onHash); };
  }, [context, router.id]);
  return <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
    <DialogContent showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader><DialogTitle>Tráfico en vivo</DialogTitle><DialogDescription>Tasas actuales en Mbps. Consumo desde el reinicio de la cola.</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
        <div className="grid gap-3">{rows.map(r => <p key={r.name} className="text-sm"><strong>{r.name}</strong><br />{r.target}<br />Bajada {(r.downloadRate / 1e6).toFixed(2)} / Subida {(r.uploadRate / 1e6).toFixed(2)} Mbps<br />{((Number(r.downloadBytes) + Number(r.uploadBytes)) / 1e9).toFixed(3)} GB</p>)}</div>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

interface UnlinkedDevice { mac: string; ip: string | null; name: string | null; status: string | null }

function DiscoverDialog({ router, onLink, context, close, restoreFocus }: { router: RouterEntry; onLink: (mac: string) => void; context: RoutersContext; close: () => void; restoreFocus: () => void }) {
  const [rows, setRows] = useState<UnlinkedDevice[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    context.request(`routers/${router.id}/unlinked-devices`).then(r => { if (!cancelled) setRows(Array.isArray(r) ? r : []); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo consultar.'); });
    return () => { cancelled = true; };
  }, [context, router.id]);
  return <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
    <DialogContent showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader><DialogTitle>Dispositivos sin departamento</DialogTitle><DialogDescription>Dispositivos vistos por DHCP que aún no están vinculados.</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
        <div className="grid gap-3">{rows.map(r => <p key={r.mac} className="text-sm"><strong>{r.name || 'Sin nombre'}</strong><br />{r.mac} / {r.ip} / {r.status}<br /><Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => onLink(r.mac)}>Vincular departamento</Button></p>)}</div>}
      <DialogFooter><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

interface CustomerOption { id: number; apartment: string; name: string }

function LinkDialog({ router, mac, context, close, saved, restoreFocus }: { router: RouterEntry; mac: string; context: RoutersContext; close: () => void; saved: (message: string) => void; restoreFocus: () => void }) {
  const [detail, setDetail] = useState<{ router: RouterEntry; customers: CustomerOption[] } | null>(null);
  const [reported, setReported] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await context.request(`routers/${router.id}`);
      if (cancelled) return;
      setDetail(data);
      const seen = data.router.snapshot?.clients?.some((c: RouterClient) => c.mac?.toUpperCase() === mac.toUpperCase());
      if (seen || data.router.adapter !== 'mikrotik-rest') { setReported(!!seen); return; }
      try {
        const unlinked: UnlinkedDevice[] = await context.request(`routers/${router.id}/unlinked-devices`);
        if (!cancelled) setReported(unlinked.some(c => c.mac === mac.toUpperCase()));
      } catch { if (!cancelled) setReported(false); }
    })().catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar.'); });
    return () => { cancelled = true; };
  }, [context, router.id, mac]);
  const linked = detail?.router.devices?.find(d => d.mac === mac.toUpperCase());
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    const customerId = Number(new FormData(event.currentTarget).get('customer_id')) || null;
    sending.current = true; setPending(true); setError('');
    try {
      await context.request(`routers/${router.id}/devices`, { mac, customer_id: customerId });
      saved('Vinculación guardada.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={openState => { if (!openState && !sending.current) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Vincular dispositivo con departamento</DialogTitle><DialogDescription>MAC: {mac}. La asociación se conserva aunque cambie la IP.</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">Al guardar se sincroniza el control IPv4 del departamento y su límite de velocidad compartido en el MikroTik central. Retirar la vinculación solicita limpiar las reglas del dispositivo.</p>
      <form className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="link-customer" className="text-sm font-medium">Departamento</label><NativeSelect id="link-customer" name="customer_id" defaultValue={linked?.customer_id || ''} disabled={pending || !detail}><NativeSelectOption value="">Sin vinculación</NativeSelectOption>{reported ? (detail?.customers || []).map(c => <NativeSelectOption key={c.id} value={c.id}>{c.apartment} · {c.name}</NativeSelectOption>) : null}</NativeSelect></div>
        {!reported && detail && <p className="text-sm text-muted-foreground">El dispositivo no aparece en la última consulta. Puedes retirar su vinculación.</p>}
        <p role="alert" className="text-sm text-destructive">{error}</p>
        <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending || !detail}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, close, restoreFocus }: { title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void>; close: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <Dialog open onOpenChange={openState => { if (!openState && !pending) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{message}</DialogDescription></DialogHeader>
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <DialogFooter><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="button" disabled={pending} onClick={() => { setPending(true); setError(''); onConfirm().then(close).catch(err => { setError(err instanceof Error ? err.message : 'No se pudo completar.'); setPending(false); }); }}>{pending ? 'Guardando…' : confirmLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

// ---------- Tarjeta y vista ----------

type Draft =
  | { type: 'form'; router: RouterEntry | null }
  | { type: 'control'; router: RouterEntry; action?: string; ip?: string }
  | { type: 'provision'; router: RouterEntry }
  | { type: 'traffic'; router: RouterEntry }
  | { type: 'discover'; router: RouterEntry }
  | { type: 'link'; router: RouterEntry; mac: string }
  | { type: 'remove'; router: RouterEntry }
  | { type: 'toggle'; router: RouterEntry };

function badgeFor(router: RouterEntry, checking: boolean) {
  if (router.disabled) return 'Deshabilitado';
  if (checking) return 'Consultando…';
  return { connected: 'Consulta correcta', untested: 'Sin probar', error: 'Error de conexión' }[router.status] || router.status;
}

function RouterCard({ router, adapterName, buildingName, checking, canManage, onAction }: { router: RouterEntry; adapterName: string; buildingName: string; checking: boolean; canManage: boolean; onAction: (draft: Draft, button: HTMLButtonElement) => void }) {
  const snapshot = router.snapshot;
  const labels = router.adapter === 'arris-touchstone' ? arrisCapNames : capNames;
  return <Card data-router-id={router.id} className="min-w-0">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div className="grid gap-1"><h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{router.name}</h2><p className="text-sm text-muted-foreground">{adapterName}{buildingName ? ` · ${buildingName}` : ''}</p></div><span className="text-sm font-medium">{badgeFor(router, checking)}</span></div></CardHeader>
    <CardContent className="grid gap-3">
      <p className="text-sm"><strong>{router.protocol}://{router.host}:{router.port}</strong><br />
        {snapshot ? <>{snapshot.manufacturer} · {snapshot.model || 'Modelo no identificado'}<br />Firmware: {snapshot.firmware || 'Sin dato'}<br />{snapshot.wan_status ? <>Enlace: {snapshot.wan_status}<br /></> : null}{snapshot.uptime ? <>Tiempo activo: {snapshot.uptime}<br /></> : null}</> : 'Prueba la conexión para obtener información del equipo.'}<br />
        <span className="text-muted-foreground">Credenciales guardadas con cifrado · {router.last_checked ? `Última consulta: ${new Date(router.last_checked).toLocaleString('es')}` : 'Todavía no se ha consultado'}</span></p>
      <ConnectionDetails router={router} canManage={canManage} onControl={(op, ip) => onAction({ type: 'control', router, action: op, ip }, document.activeElement as HTMLButtonElement)} onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)} />
      {router.devices?.length ? <details><summary className="cursor-pointer text-sm font-medium">Dispositivos vinculados ({router.devices.length})</summary><p className="text-sm text-muted-foreground">El control automático del departamento incluye estas MAC y su IP de servicio. Requiere un MikroTik central y una consulta correcta de las IP actuales. El plan de velocidad se comparte entre sus dispositivos.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">MAC</th><th className="p-2 text-left">Departamento</th><th className="p-2 text-left">Última IP reportada</th><th className="p-2 text-left">Acción</th></tr></thead><tbody>
        {router.devices.map(d => <tr key={d.mac} className="border-t"><td className="p-2">{d.mac}</td><td className="p-2">{d.apartment}{d.archived ? ' (archivado)' : ''}</td><td className="p-2">{snapshot?.clients?.find(c => c.mac?.toUpperCase() === d.mac)?.ip || 'No aparece en la última consulta'}</td><td className="p-2"><LinkButton router={router} mac={d.mac} onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)} /></td></tr>)}
      </tbody></table></div></details> : null}
      {router.last_error && <p role="alert" className="text-sm text-destructive">{router.last_error}</p>}
      <div className="flex flex-wrap gap-2">{Object.entries(router.capabilities || {}).map(([name, supported]) => <span key={name} className="text-xs">{supported ? '✓' : '—'} {labels[name]}{supported ? '' : router.adapter === 'arris-touchstone' && name === 'speed_limit' ? ' · no disponible en este firmware' : ' · no implementado'}</span>)}</div>
      {snapshot?.interfaces?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Interfaz</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Enlace</th></tr></thead><tbody>{snapshot.interfaces.map(i => <tr key={i.name} className="border-t"><td className="p-2">{i.name}</td><td className="p-2">{i.state}</td><td className="p-2">{i.speed || '—'}</td></tr>)}</tbody></table></div> : null}
      {snapshot?.blocked?.length ? <p className="text-sm"><strong>{router.adapter === 'arris-touchstone' ? 'IP con bloqueo TCP/UDP' : 'IP bloqueadas'} ({snapshot.blocked.length}):</strong> {snapshot.blocked.slice(0, 20).join(', ')}</p> : null}
      {snapshot?.speedLimits?.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">IP con límite</th><th className="p-2 text-left">max-limit</th></tr></thead><tbody>{snapshot.speedLimits.slice(0, 50).map(q => <tr key={q.ip} className="border-t"><td className="p-2">{q.ip}</td><td className="p-2">{q.maxLimit}</td></tr>)}</tbody></table></div> : null}
      {snapshot?.firewallBlocks?.length ? <p className="text-sm"><strong>Destinos bloqueados ({snapshot.firewallBlocks.length}):</strong> {snapshot.firewallBlocks.slice(0, 20).map(b => `${b.ip} → ${b.target}`).join(', ')}</p> : null}
      {snapshot?.parental?.length ? <p className="text-sm"><strong>Horarios parentales ({snapshot.parental.length}):</strong> {snapshot.parental.slice(0, 20).map(p => `${p.ip} (${p.schedule})`).join(', ')}</p> : null}
      {typeof snapshot?.leases === 'number' && <p className="text-sm text-muted-foreground">Leases DHCP vistos: {snapshot.leases}. Pulsa «Probar conexión» para actualizar bloqueos y colas.</p>}
      {(snapshot?.notes || []).map((note, i) => <p key={i} className="text-sm text-muted-foreground">{note}</p>)}
      {router.adapter === 'mikrotik-rest' && !router.disabled && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={event => onAction({ type: 'traffic', router }, event.currentTarget)}>Tráfico en vivo</Button><Button type="button" variant="outline" size="sm" onClick={event => onAction({ type: 'discover', router }, event.currentTarget)}>Descubrir dispositivos</Button></div>}
    </CardContent>
    {canManage ? <CardFooter className="flex flex-wrap gap-2">
      {!router.disabled && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => { void (onCheckRef.current?.(router.id)); }}><Activity aria-hidden="true" />{checking ? 'Consultando…' : 'Probar conexión'}</Button>}
      {!router.disabled && router.adapter === 'mikrotik-rest' && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'provision', router }, event.currentTarget)}><Server aria-hidden="true" />Aprovisionar puertos y permisos</Button>}
      {!router.disabled && router.capabilities?.suspend && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'control', router }, event.currentTarget)}><SlidersHorizontal aria-hidden="true" />Controlar dispositivo</Button>}
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'toggle', router }, event.currentTarget)}><Power aria-hidden="true" />{router.disabled ? 'Activar' : 'Desactivar'}</Button>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'form', router }, event.currentTarget)}><Pencil aria-hidden="true" />Editar</Button>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'remove', router }, event.currentTarget)}><Trash aria-hidden="true" />Quitar conexión</Button>
    </CardFooter> : <CardContent><p className="text-sm text-muted-foreground">🔒 Solo el super-admin configura routers y aplica acciones de red.</p></CardContent>}
  </Card>;
}

const onCheckRef: { current: ((id: number) => void) | null } = { current: null };

function RoutersView({ context }: { context: RoutersContext }) {
  const [routers, setRouters] = useState<RouterEntry[]>([]);
  const [adapters, setAdapters] = useState<RouterAdapterInfo[]>([]);
  const [buildings, setBuildings] = useState<{ id: number; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  async function reload() {
    const data = await context.request('routers');
    setRouters(data.routers || []); setAdapters(data.adapters || []);
    try {
      const b = await context.request('buildings');
      setBuildings(Array.isArray(b) ? b : []);
    } catch { /* sin edificios visibles */ }
  }
  useEffect(() => {
    let cancelled = false;
    reload().then(() => { if (!cancelled) setLoaded(true); }).catch(err => { if (!cancelled) { setLoadError(err instanceof Error ? err.message : 'No se pudo cargar.'); setLoaded(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function check(id: number) {
    setBusy(prev => new Set(prev).add(id));
    setNotice('Consultando el router. En ARRIS puede tardar hasta tres minutos.');
    try {
      const result = await context.request(`routers/${id}/check`, {});
      await reload();
      setNotice(result.success ? 'Conexión verificada con el router.' : String(result.router?.last_error || 'Falló la consulta.'));
    } catch (err) { setNotice(err instanceof Error ? err.message : 'No se pudo consultar.'); }
    finally { setBusy(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }
  useEffect(() => { onCheckRef.current = check; return () => { onCheckRef.current = null; }; });
  function open(next: Draft, button: HTMLButtonElement | null) { trigger.current = button; setNotice(''); setDraft(next); }
  function close() { setDraft(undefined); }
  function restore() { trigger.current?.focus(); }
  async function saved(message: string) {
    close(); setNotice(message);
    try { await reload(); await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado.`); }
  }
  async function remove(id: number) {
    await context.request(`routers/${id}/remove`, {});
    await saved('Conexión quitada del sistema.');
  }
  async function toggle(router: RouterEntry) {
    await context.request(`routers/${router.id}/toggle`, { disabled: !router.disabled });
    await saved(`Router ${router.disabled ? 'activado' : 'deshabilitado'}.`);
  }
  const buildingName = (id?: number | null) => (id && buildings.length ? buildings.find(b => b.id === id)?.name || `Edificio ${id}` : '');
  return <div className="shadcn-root grid gap-6 py-6" id="routers-panel">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="grid gap-2"><h1 className="text-2xl font-semibold tracking-tight">Routers</h1><p className="text-sm text-muted-foreground">{context.canManage ? 'Registra el router principal de cada edificio (uno por edificio) y consulta sus funciones.' : 'Consulta de equipos. Solo el super-admin configura la red.'}</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { void reload().then(() => context.refresh()).catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button>{context.canManage && <Button type="button" onClick={event => open({ type: 'form', router: null }, event.currentTarget)}><Plus aria-hidden="true" />Agregar router</Button>}</div></div>
    <Card><CardContent><p className="text-sm text-muted-foreground"><strong>Conexión y control:</strong> Solo MikroTik admite control total y equipo central. ARRIS validado permite filtros IPv4 TCP/UDP por IP, puertos y horarios. OpenWrt es solo consulta. Usa IP privada por LAN o VPN.</p></CardContent></Card>
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    {!loaded ? <Card><CardContent><p className="text-sm text-muted-foreground">Cargando conexiones…</p></CardContent></Card>
      : loadError ? <Card><CardContent><p className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="mt-2" onClick={() => { setLoaded(false); setLoadError(''); void reload().then(() => setLoaded(true)).catch(err => { setLoadError(err instanceof Error ? err.message : 'No se pudo cargar.'); setLoaded(true); }); }}>Reintentar</Button></CardContent></Card>
      : !routers.length ? <Card><CardContent className="grid gap-2"><span aria-hidden="true">⌘</span><strong>Conecta tu primer router</strong><p className="text-sm text-muted-foreground">Registra su IP de administración y selecciona el adaptador compatible.</p></CardContent></Card>
      : <div className="grid gap-4">{routers.map(router => <RouterCard key={router.id} router={router} adapterName={adapters.find(a => a.id === router.adapter)?.name || router.adapter} buildingName={buildingName(router.building_id)} checking={busy.has(router.id) || !!router.checking} canManage={context.canManage} onAction={open} />)}</div>}
    <Card><CardContent className="grid gap-2"><strong className="text-sm">Compatibilidad por adaptadores</strong>{adapters.map(a => <p key={a.id} className="text-sm"><strong>{a.name}</strong><br />{a.requirements}</p>)}<p className="text-sm text-muted-foreground">No existe una API universal para todos los routers. Podemos añadir adaptadores cuando el equipo ofrezca una interfaz de administración compatible.</p></CardContent></Card>
    {draft?.type === 'form' && <RouterForm router={draft.router} adapters={adapters} buildings={buildings} routers={routers} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'control' && <ControlDialog router={draft.router} preset={{ action: draft.action, ip: draft.ip }} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'provision' && <ProvisionDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
    {draft?.type === 'traffic' && <TrafficDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
    {draft?.type === 'discover' && <DiscoverDialog router={draft.router} context={context} onLink={mac => setDraft({ type: 'link', router: draft.router, mac })} close={close} restoreFocus={restore} />}
    {draft?.type === 'link' && <LinkDialog router={draft.router} mac={draft.mac} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'remove' && <ConfirmDialog title="Quitar conexión" message={`¿Quitar ${draft.router.name} del sistema? No modifica el equipo. Esta acción no se puede deshacer.`} confirmLabel="Quitar" onConfirm={() => remove(draft.router.id)} close={close} restoreFocus={restore} />}
    {draft?.type === 'toggle' && <ConfirmDialog title={draft.router.disabled ? 'Activar router' : 'Deshabilitar router'} message={draft.router.disabled ? `¿Activar ${draft.router.name}?` : `¿Deshabilitar ${draft.router.name}? No se podrá consultar ni aplicar acciones hasta reactivarlo.`} confirmLabel={draft.router.disabled ? 'Activar' : 'Deshabilitar'} onConfirm={() => toggle(draft.router)} close={close} restoreFocus={restore} />}
  </div>;
}

export default function RoutersPanel() {
  const state = useSyncExternalStore(subscribeRouters, getRouters, getServerRouters);
  return state.visible && state.context ? <RoutersView key={state.context.userId} context={state.context} /> : null;
}
