import NetworkSetupWizard from './NetworkSetupWizard';
import NetworkTopologyMap from './NetworkTopologyMap';
import { useEffect, useRef, useState, useSyncExternalStore, type SubmitEvent } from 'react';
import { Activity, ArrowLeft, ArrowRight, Ban, Clock, Gauge, Pencil, Play, Plus, Power, Radar, Rocket, Search, Server, Shield, SlidersHorizontal, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormError, PanelShell, StatusText } from '@/components/panel-shell';
import { getRouters, getServerRouters, subscribeRouters, type RouterClient, type RouterEntry, type RouterAdapterInfo, type RoutersContext } from '@/lib/routers-store';

const capNames: Record<string, string> = { identification: 'Identificación', status: 'Estado', interfaces: 'Interfaces', suspend: 'Suspensión', reactivate: 'Reactivación', speed_limit: 'Límite de velocidad', firewall: 'Firewall', parental_control: 'Control parental', switch_ports: 'Puertos de switch' };
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
    {ops.map(op => { const { label, Icon } = meta[op]; return <Tooltip key={op}>
      <TooltipTrigger asChild><Button type="button" variant="outline" size="icon" aria-label={`${label} ${client.ip}`} data-active={op === 'suspend' && blocked ? 'true' : undefined} onClick={() => onControl(op, client.ip!)}><Icon aria-hidden="true" /></Button></TooltipTrigger>
      <TooltipContent>{label} · {client.ip}</TooltipContent>
    </Tooltip>; })}
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
      {snapshot.clients.length ? <Table dense>
        <TableHeader><TableRow>{['Dispositivo', 'IP', 'MAC', 'Conexión', 'Estado', 'Departamento', 'Acciones'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{snapshot.clients.map((c, i) => <TableRow key={`${c.mac || c.ip || i}`}>
          <TableCell>{detailValue(c.name)}</TableCell>
          <TableCell>{detailValue(c.ip)}{(c.addresses || []).filter(ip => ip !== c.ip).length ? <details><summary className="cursor-pointer text-xs">Otras IP ({(c.addresses || []).filter(ip => ip !== c.ip).length})</summary>{(c.addresses || []).filter(ip => ip !== c.ip).map(ip => <small key={ip} className="block">{ip}</small>)}</details> : null}</TableCell>
          <TableCell>{detailValue(c.mac)}</TableCell>
          <TableCell>{detailValue(c.connection)}</TableCell>
          <TableCell>{detailValue(c.status)}</TableCell>
          <TableCell><LinkButton router={router} mac={c.mac} onLink={onLink} /></TableCell>
          <TableCell><DeviceButtons router={router} client={c} canManage={canManage} onControl={onControl} /></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <p className="text-sm text-muted-foreground">El router no devolvió dispositivos en esta consulta.</p>}
    </div>}
  </div>;
}

// ---------- Formulario alta/edición ----------

function RouterForm({ router, preset, adapters, buildings, context, close, saved, restoreFocus }: { router: RouterEntry | null; preset?: { host?: string; name?: string; building_id?: string }; adapters: RouterAdapterInfo[]; buildings: { id: string; name: string }[]; context: RoutersContext; close: () => void; saved: (message: string) => void; restoreFocus: () => void }) {
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
  const freeBuildings = buildings;
  function readBody(form: HTMLFormElement) {
    const body: Record<string, unknown> = Object.fromEntries(new FormData(form));
    for (const key of ['username', 'password']) if (!body[key]) delete body[key];
    // Edificio opcional: "" = sin asignar, se vincula después desde Edificios o editando.
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
  return <Dialog open onOpenChange={openState => { if (!openState && !sending.current) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>{router ? 'Editar conexión' : 'Agregar router'}</DialogTitle><DialogDescription>{router ? 'Deja usuario y contraseña vacíos para conservar las credenciales. Usa una IP privada accesible por LAN o VPN.' : 'Detectaremos el equipo y consultaremos la información disponible. Las credenciales se guardan cifradas. Usa una IP privada accesible por LAN o VPN.'}</DialogDescription></DialogHeader>
      <DialogBody><form id="router-form" className="grid gap-4" onSubmit={submit} aria-busy={pending} onInput={() => { revision.current++; setTestResult(null); }}>
        <div className="grid gap-2"><label htmlFor="router-host" className="text-sm font-medium">IP de administración</label><Input id="router-host" name="host" required placeholder="192.168.0.1" defaultValue={router?.host || preset?.host || ''} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="router-username" className="text-sm font-medium">Usuario</label><Input id="router-username" name="username" autoComplete="off" maxLength={100} required={!router} disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="router-password" className="text-sm font-medium">Contraseña</label><Input id="router-password" name="password" type="password" autoComplete="new-password" maxLength={256} required={!router} disabled={pending} /></div>
        <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium">Configuración avanzada</summary><div className="grid gap-4 pt-3">
          <div className="grid gap-2"><label htmlFor="router-name" className="text-sm font-medium">Nombre</label><Input id="router-name" name="name" required maxLength={100} placeholder="Router principal" defaultValue={router?.name || preset?.name || 'Router principal'} disabled={pending || !advanced} /></div>
          <div className="grid gap-2"><label htmlFor="router-building" className="text-sm font-medium">Edificio (opcional)</label><NativeSelect id="router-building" name="building_id" defaultValue={router?.building_id || preset?.building_id || ''} disabled={pending || !advanced}><NativeSelectOption value="">Sin edificio · se asigna después</NativeSelectOption>{freeBuildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}{router?.building_id && !freeBuildings.some(b => b.id === router.building_id) && <NativeSelectOption value={router.building_id}>Edificio {router.building_id} (actual)</NativeSelectOption>}</NativeSelect><p className="text-sm text-muted-foreground">Puedes dejarlo vacío y vincularlo después. Un edificio puede tener varios equipos; el control central se selecciona por separado.</p></div>
          <div className="grid gap-2"><label htmlFor="router-adapter" className="text-sm font-medium">Adaptador</label><NativeSelect id="router-adapter" name="adapter" aria-label="Adaptador" defaultValue={router?.adapter || adapters[0]?.id} disabled={pending || !advanced}>{adapters.map(a => <NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="router-protocol" className="text-sm font-medium">Protocolo</label><NativeSelect id="router-protocol" name="protocol" aria-label="Protocolo" defaultValue={router?.protocol || 'http'} disabled={pending || !advanced} onChange={event => setPort(event.target.value === 'https' ? '443' : '80')}><NativeSelectOption value="http">HTTP</NativeSelectOption><NativeSelectOption value="https">HTTPS</NativeSelectOption></NativeSelect></div>
          <div className="grid gap-2"><label htmlFor="router-port" className="text-sm font-medium">Puerto</label><Input id="router-port" name="port" type="number" required min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} disabled={pending || !advanced} /></div></div>
        </div></details>
        {!router && <div className="grid gap-2"><Button type="button" variant="outline" disabled={pending || testing} onClick={event => { const f = event.currentTarget.closest('form'); if (f) void test(f); }}>{testing ? 'Probando…' : 'Probar conexión'}</Button>{testResult && <p role="status" className={testResult.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>{testResult.text}</p>}</div>}
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="router-form" disabled={pending || testing}>{pending ? (router || advanced ? 'Guardando…' : 'Conectando…') : (router || advanced ? 'Guardar' : 'Conectar router')}</Button></DialogFooter>
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
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Controlar dispositivo{preset?.ip ? ` · ${preset.ip}` : ''}</DialogTitle><DialogDescription>{isArris ? 'Las reglas afectan TCP/UDP por IPv4. No bloquean IPv6 ni otros protocolos. Los horarios usan la hora configurada en el router.' : 'Los cambios se aplican en el router seleccionado.'}</DialogDescription></DialogHeader>
      <DialogBody><form id="control-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="control-action" className="text-sm font-medium">Acción</label><NativeSelect id="control-action" name="action" value={action} onChange={event => setAction(event.target.value)} disabled={pending}>{available.map(a => <NativeSelectOption key={a} value={a}>{labels[a]}</NativeSelectOption>)}</NativeSelect></div>
        <div className="grid gap-2"><label htmlFor="control-ip" className="text-sm font-medium">IP del dispositivo</label><Input id="control-ip" name="ip" required placeholder="192.168.0.2" list="router-client-ips" defaultValue={preset?.ip || ''} disabled={pending} /><datalist id="router-client-ips">{(router.snapshot?.clients || []).filter(c => c.ip && !c.ip.includes(':')).map(c => <option key={c.ip!} value={c.ip!}>{c.name || c.mac || 'Dispositivo'}</option>)}</datalist></div>
        {action === 'speed_limit' && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="control-down" className="text-sm font-medium">Bajada (Mbps)</label><Input id="control-down" name="down" type="number" min={1} max={1000000} defaultValue="50" required disabled={pending} /></div><div className="grid gap-2"><label htmlFor="control-up" className="text-sm font-medium">Subida (Mbps)</label><Input id="control-up" name="up" type="number" min={1} max={1000000} defaultValue="20" required disabled={pending} /></div></div>}
        {action === 'firewall' && <><div className="grid gap-2"><label htmlFor="control-target" className="text-sm font-medium">{isArris ? 'Protocolo y puertos' : 'Destino (IP o dominio)'}</label><Input id="control-target" name="target" required placeholder={isArris ? 'tcp:80 o both:1000-2000' : 'ejemplo.com'} disabled={pending} /></div><div className="grid gap-2"><label htmlFor="control-remove" className="text-sm font-medium">Operación</label><NativeSelect id="control-remove" name="remove" defaultValue="false" disabled={pending}><NativeSelectOption value="false">Bloquear</NativeSelectOption><NativeSelectOption value="true">Quitar este filtro de NuweNet</NativeSelectOption></NativeSelect></div>{isArris && <p className="text-sm text-muted-foreground">Protocolos: tcp, udp o both. Solo se quita el filtro exacto indicado.</p>}</>}
        {action === 'parental_control' && <><div className="grid gap-2"><label htmlFor="control-schedule" className="text-sm font-medium">Horario de bloqueo</label><Input id="control-schedule" name="schedule" required placeholder="22h-7h,mon,tue,wed,thu,fri" disabled={pending} /></div><p className="text-sm text-muted-foreground">Días: sun, mon, tue, wed, thu, fri, sat. Escribe off para quitar el horario de NuweNet.</p></>}
        <p className="text-sm text-muted-foreground">Quitar un bloqueo conserva las demás restricciones del dispositivo.</p>
        <FormError message={error} />
      </form></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="control-form" disabled={pending}>{pending ? 'Aplicando…' : 'Aplicar'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

// ---------- Aprovisionar ----------

interface ServiceItem { name: string; port: number; disabled: boolean; address: string }

function ProvisionDialog({ router, context, close, restoreFocus }: { router: RouterEntry; context: RoutersContext; close: () => void; restoreFocus: () => void }) {
  const [tab, setTab] = useState<'services' | 'user' | 'network'>('services');
  const [services, setServices] = useState<ServiceItem[] | null>(null);
  const [servicesError, setServicesError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [username, setUsername] = useState('nuwenet-service');
  const [password, setPassword] = useState(randomSecret(16));
  const [updateVault, setUpdateVault] = useState(true);
  const [setupHttps, setSetupHttps] = useState(true);
  const [provPending, setProvPending] = useState(false);
  const [provResult, setProvResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [wanInterface, setWanInterface] = useState('ether1');
  const [wanDhcp, setWanDhcp] = useState(true);
  const [nat, setNat] = useState(true);
  const [lanInterface, setLanInterface] = useState('ether2');
  const [lan, setLan] = useState('');
  const [pool, setPool] = useState('');
  const [dns, setDns] = useState('8.8.8.8,1.1.1.1');
  const [leases, setLeases] = useState<{ mac: string; address: string; comment: string }[]>([{ mac: '', address: '', comment: 'switch' }]);
  const [script, setScript] = useState('');
  const [scriptError, setScriptError] = useState('');
  const [wanPending, setWanPending] = useState(false);
  const [wanResult, setWanResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [lanPending, setLanPending] = useState(false);
  const [lanResult, setLanResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    context.request(`routers/${router.id}/services`).then(s => { if (!cancelled) setServices(Array.isArray(s) ? s : []); }).catch(err => { if (!cancelled) setServicesError(err instanceof Error ? err.message : 'No se pudieron consultar los servicios.'); });
    return () => { cancelled = true; };
  }, [context, router.id]);
  useEffect(() => {
    let cancelled = false;
    const ready = leases.filter(l => l.mac.trim() && l.address.trim()).map(l => ({ mac: l.mac.trim(), address: l.address.trim(), ...(l.comment.trim() ? { comment: l.comment.trim() } : {}) }));
    const body: Record<string, unknown> = { username: username.trim() || 'nuwenet-service', password: password || 'CAMBIAR_ESTA_CLAVE', sslPort: Number(router.port) || 443, disableInsecure: true };
    if (wanDhcp || nat) { body.wanInterface = wanInterface.trim() || 'ether1'; if (wanDhcp) body.wanDhcp = true; if (nat) body.nat = true; }
    if (lan.trim() && pool.trim()) {
      body.lan = lan.trim(); body.lanInterface = lanInterface.trim() || 'ether2'; body.pool = pool.trim();
      if (dns.trim()) body.dns = dns.trim();
      if (ready.length) body.leases = ready;
    }
    context.request('routers/script', body).then(s => { if (!cancelled && s?.script) { setScript(s.script); setScriptError(''); } }).catch(err => { if (!cancelled) setScriptError(err instanceof Error ? err.message : 'Revisa los datos DHCP.'); });
    return () => { cancelled = true; };
  }, [context, router.port, router.id, username, password, wanInterface, wanDhcp, nat, lanInterface, lan, pool, dns, leases]);
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
      const data = await context.request(`routers/${router.id}/provision`, { username: username.trim(), password, updateStoredCredentials: updateVault, setup_https: setupHttps });
      setProvResult({ ok: true, text: `✓ Usuario ${data.username} y grupo nuwenet configurados.${data.credentialsUpdated ? ' Credenciales del router actualizadas en el sistema.' : ''}${data.https ? ` HTTPS activado con certificado ${data.https.certificate}.` : ''}` });
      setNotice('Aprovisionamiento completado con éxito.');
    } catch (err) { setProvResult({ ok: false, text: err instanceof Error ? err.message : 'Fallo al aprovisionar.' }); }
    finally { setProvPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(script); setNotice('Comandos copiados al portapapeles.'); }
    catch { setNotice('No se pudo copiar. Selecciona el texto manualmente.'); }
  }
  async function applyWan() {
    if (wanPending) return;
    if (!wanDhcp && !nat) { setWanResult({ ok: false, text: 'Activa DHCP en WAN o NAT saliente.' }); return; }
    setWanPending(true); setWanResult(null);
    try {
      const data = await context.request(`routers/${router.id}/wan`, { wanInterface: wanInterface.trim() || 'ether1', wanDhcp, nat });
      setWanResult({ ok: true, text: `✓ WAN aplicada en ${data.wanInterface}: DHCP ${data.dhcpClient ? 'activo' : 'omitido'}, NAT ${data.nat ? 'activo' : 'omitido'}. Verificado en el equipo.` });
      setNotice('WAN aplicada y verificada en el equipo.');
    } catch (err) { setWanResult({ ok: false, text: err instanceof Error ? err.message : 'Fallo al aplicar la WAN.' }); }
    finally { setWanPending(false); }
  }
  async function applyLan() {
    if (lanPending) return;
    if (!lan.trim() || !pool.trim()) { setLanResult({ ok: false, text: 'Indica la dirección LAN /24 y el pool DHCP.' }); return; }
    const ready = leases.filter(l => l.mac.trim() && l.address.trim()).map(l => ({ mac: l.mac.trim(), address: l.address.trim(), ...(l.comment.trim() ? { comment: l.comment.trim() } : {}) }));
    setLanPending(true); setLanResult(null);
    try {
      const data = await context.request(`routers/${router.id}/lan-dhcp`, {
        lan: lan.trim(), lanInterface: lanInterface.trim() || 'ether2', pool: pool.trim(),
        ...(dns.trim() ? { dns: dns.trim() } : {}), ...(ready.length ? { leases: ready } : {}),
      });
      setLanResult({ ok: true, text: `✓ LAN ${data.lan} en ${data.lanInterface}, pool ${data.pool} y ${data.leases} leases aplicados. Verificado en el equipo. No se eliminaron leases existentes.` });
      setNotice('LAN/DHCP aplicada y verificada en el equipo.');
    } catch (err) { setLanResult({ ok: false, text: err instanceof Error ? err.message : 'Fallo al aplicar la LAN.' }); }
    finally { setLanPending(false); }
  }
  return <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0 sm:max-w-3xl" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Aprovisionar MikroTik · {router.name}</DialogTitle><DialogDescription>Puertos, usuario de servicio y red WAN/LAN aplicadas directo en el equipo, sin pasar por la terminal.</DialogDescription></DialogHeader>
      <DialogBody>
      <div className="flex gap-2" role="tablist">
        {(['services', 'user', 'network'] as const).map((t, i) => <Button key={t} type="button" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>{i + 1}. {t === 'services' ? 'Servicios y Puertos' : t === 'user' ? 'Usuario NuweNet' : 'Red WAN/LAN'}</Button>)}
      </div>
      {tab === 'services' && <div className="grid gap-3"><p className="text-sm text-muted-foreground">Consulta y ajusta los servicios de RouterOS. Puedes activar o desactivar puertos y restringir la IP autorizada para conectarse.</p>
        {services ? <Table dense>
          <TableHeader><TableRow>{['Servicio', 'Puerto', 'Estado', 'IP Permitida', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{services.map(s => <ServiceRow key={s.name} service={s} saving={saving === s.name} onSave={saveService} />)}</TableBody>
        </Table> : servicesError ? <FormError message={servicesError} /> : <p className="text-sm text-muted-foreground">Cargando servicios de RouterOS…</p>}
      </div>}
      {tab === 'user' && <div className="grid gap-4"><p className="text-sm text-muted-foreground">Crea un usuario exclusivo en el grupo <code>nuwenet</code> con permisos reducidos (<code>read, write, api, firewall, queue, dhcp, rest-api</code>) para no operar con la cuenta maestra <code>admin</code>.</p>
        <div className="grid gap-2"><label htmlFor="prov-user" className="text-sm font-medium">Nombre de usuario de servicio</label><Input id="prov-user" value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} disabled={provPending} /></div>
        <div className="grid gap-2"><label htmlFor="prov-pass" className="text-sm font-medium">Contraseña segura</label><div className="flex gap-2"><Input id="prov-pass" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} disabled={provPending} /><Button type="button" variant="outline" onClick={() => setPassword(randomSecret(16))} disabled={provPending}>Generar otra</Button></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updateVault} onChange={event => setUpdateVault(event.target.checked)} disabled={provPending} /> Actualizar credenciales guardadas en NuweNet</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setupHttps} onChange={event => setSetupHttps(event.target.checked)} disabled={provPending} /> Configurar HTTPS con certificado local autofirmado</label>
        <p className="text-sm text-muted-foreground">El certificado autofirmado sirve para practicar y operar en LAN de gestión. NuweNet valida TLS: para producción instala un certificado válido.</p>
        <div><Button type="button" onClick={() => { void provision(); }} disabled={provPending}>{provPending ? 'Aprovisionando…' : 'Crear usuario y grupo en MikroTik'}</Button></div>
        {provResult && <p role="status" className={provResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{provResult.text}</p>}
      </div>}
      {tab === 'network' && <div className="grid gap-4"><p className="text-sm text-muted-foreground">Aplica la configuración directo en el equipo por REST y verifica el resultado. Ya no necesitas copiar comandos en la terminal de WinBox/SSH.</p>
        <h3 className="text-sm font-semibold">Uplink del proveedor</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="cli-wan-iface" className="text-sm font-medium">Interfaz WAN</label><Input id="cli-wan-iface" value={wanInterface} onChange={event => setWanInterface(event.target.value)} maxLength={64} placeholder="ether1" disabled={wanPending} /></div>
        <div className="grid gap-2"><span className="text-sm font-medium">Opciones</span><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wanDhcp} onChange={event => setWanDhcp(event.target.checked)} disabled={wanPending} /> DHCP en WAN</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nat} onChange={event => setNat(event.target.checked)} disabled={wanPending} /> NAT saliente</label></div></div></div>
        <div><Button type="button" onClick={() => { void applyWan(); }} disabled={wanPending}>{wanPending ? 'Aplicando…' : 'Aplicar WAN en el equipo'}</Button></div>
        {wanResult && <p role="status" className={wanResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{wanResult.text}</p>}
        <h3 className="text-sm font-semibold">Red LAN y DHCP</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="cli-lan-iface" className="text-sm font-medium">Interfaz LAN</label><Input id="cli-lan-iface" value={lanInterface} onChange={event => setLanInterface(event.target.value)} maxLength={64} placeholder="ether2" disabled={lanPending} /></div>
        <div className="grid gap-2"><label htmlFor="cli-lan" className="text-sm font-medium">Dirección LAN (/24)</label><Input id="cli-lan" value={lan} onChange={event => setLan(event.target.value)} placeholder="192.168.10.1/24" disabled={lanPending} /></div></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="cli-pool" className="text-sm font-medium">Pool DHCP dinámico</label><Input id="cli-pool" value={pool} onChange={event => setPool(event.target.value)} placeholder="192.168.10.100-192.168.10.200" disabled={lanPending} /></div>
        <div className="grid gap-2"><label htmlFor="cli-dns" className="text-sm font-medium">DNS (coma)</label><Input id="cli-dns" value={dns} onChange={event => setDns(event.target.value)} maxLength={64} disabled={lanPending} /></div></div>
        <div className="grid gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Leases estáticos (switch y departamentos)</span><Button type="button" variant="outline" size="sm" onClick={() => setLeases(rows => [...rows, { mac: '', address: '', comment: '' }])} disabled={lanPending}>Añadir fila</Button></div>
        {leases.map((row, i) => <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"><div className="grid gap-1"><label htmlFor={`cli-lease-mac-${i}`} className="text-xs text-muted-foreground">MAC</label><Input id={`cli-lease-mac-${i}`} value={row.mac} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, mac: event.target.value } : r))} placeholder="AA:BB:CC:DD:EE:FF" disabled={lanPending} /></div><div className="grid gap-1"><label htmlFor={`cli-lease-ip-${i}`} className="text-xs text-muted-foreground">IP fija</label><Input id={`cli-lease-ip-${i}`} value={row.address} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, address: event.target.value } : r))} placeholder="192.168.10.11" disabled={lanPending} /></div><Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar fila ${i + 1}`} onClick={() => setLeases(rows => rows.filter((_, j) => j !== i))} disabled={lanPending}>✕</Button><div className="grid gap-1 col-span-3"><label htmlFor={`cli-lease-comment-${i}`} className="text-xs text-muted-foreground">Comentario</label><Input id={`cli-lease-comment-${i}`} value={row.comment} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, comment: event.target.value } : r))} maxLength={80} placeholder="dep-201" disabled={lanPending} /></div></div>)}
        </div>
        <div><Button type="button" onClick={() => { void applyLan(); }} disabled={lanPending}>{lanPending ? 'Aplicando…' : 'Aplicar LAN/DHCP en el equipo'}</Button></div>
        {lanResult && <p role="status" className={lanResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{lanResult.text}</p>}
        <details><summary className="cursor-pointer text-sm font-medium">Ver comandos equivalentes (solo referencia)</summary><div className="grid gap-2 pt-2">
        <textarea id="cli-script-box" readOnly rows={9} value={script} className="w-full font-mono text-xs" />
        {scriptError && <p role="alert" className="text-sm text-destructive">{scriptError}</p>}
        <div><Button type="button" variant="outline" onClick={() => { void copy(); }}>Copiar comandos</Button></div>
        </div></details>
      </div>}
      <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ServiceRow({ service, saving, onSave }: { service: ServiceItem; saving: boolean; onSave: (name: string, port: number, disabled: boolean, address: string) => void }) {
  const [port, setPort] = useState(String(service.port));
  const [enabled, setEnabled] = useState(!service.disabled);
  const [address, setAddress] = useState(service.address || '');
  return <TableRow><TableCell><strong>{service.name}</strong></TableCell>
    <TableCell><Input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} className="w-20" disabled={saving} aria-label={`Puerto de ${service.name}`} /></TableCell>
    <TableCell><label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={saving} /> Activo</label></TableCell>
    <TableCell><Input type="text" value={address} onChange={event => setAddress(event.target.value)} placeholder="Cualquiera" className="w-32" disabled={saving} aria-label={`IP permitida de ${service.name}`} /></TableCell>
    <TableCell><Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => onSave(service.name, Number(port), !enabled, address.trim())}>{saving ? 'Guardando…' : 'Guardar'}</Button></TableCell></TableRow>;
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
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Tráfico en vivo</DialogTitle><DialogDescription>Tasas actuales en Mbps. Consumo desde el reinicio de la cola.</DialogDescription></DialogHeader>
      <DialogBody>
      {error ? <FormError message={error} /> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
        <div className="grid gap-3">{rows.map(r => <p key={r.name} className="text-sm"><strong>{r.name}</strong><br />{r.target}<br />Bajada {(r.downloadRate / 1e6).toFixed(2)} / Subida {(r.uploadRate / 1e6).toFixed(2)} Mbps<br />{((Number(r.downloadBytes) + Number(r.uploadBytes)) / 1e9).toFixed(3)} GB</p>)}</div>}
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
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
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Dispositivos sin departamento</DialogTitle><DialogDescription>Dispositivos vistos por DHCP que aún no están vinculados.</DialogDescription></DialogHeader>
      <DialogBody>
      {error ? <FormError message={error} /> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
        <div className="grid gap-3">{rows.map(r => <p key={r.mac} className="text-sm"><strong>{r.name || 'Sin nombre'}</strong><br />{r.mac} / {r.ip} / {r.status}<br /><Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => onLink(r.mac)}>Vincular departamento</Button></p>)}</div>}
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

interface CustomerOption { id: string; apartment: string; name: string }

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
    const customerId = String(new FormData(event.currentTarget).get('customer_id') || '') || null;
    sending.current = true; setPending(true); setError('');
    try {
      await context.request(`routers/${router.id}/devices`, { mac, customer_id: customerId });
      saved('Vinculación guardada.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); }
    finally { sending.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={openState => { if (!openState && !sending.current) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (sending.current) event.preventDefault(); }} onPointerDownOutside={event => { if (sending.current) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Vincular dispositivo con departamento</DialogTitle><DialogDescription>MAC: {mac}. La asociación se conserva aunque cambie la IP.</DialogDescription></DialogHeader>
      <DialogBody>
      <p className="text-sm text-muted-foreground">Al guardar se sincroniza el control IPv4 del departamento y su límite de velocidad compartido en el MikroTik central. Retirar la vinculación solicita limpiar las reglas del dispositivo.</p>
      <form id="link-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
        <div className="grid gap-2"><label htmlFor="link-customer" className="text-sm font-medium">Departamento</label><NativeSelect id="link-customer" name="customer_id" defaultValue={linked?.customer_id || ''} disabled={pending || !detail}><NativeSelectOption value="">Sin vinculación</NativeSelectOption>{reported ? (detail?.customers || []).map(c => <NativeSelectOption key={c.id} value={c.id}>{c.apartment} · {c.name}</NativeSelectOption>) : null}</NativeSelect></div>
        {!reported && detail && <p className="text-sm text-muted-foreground">El dispositivo no aparece en la última consulta. Puedes retirar su vinculación.</p>}
        <FormError message={error} />
      </form>
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="link-form" disabled={pending || !detail}>{pending ? 'Guardando…' : 'Guardar'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, close, restoreFocus }: { title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void>; close: () => void; restoreFocus: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <Dialog open onOpenChange={openState => { if (!openState && !pending) close(); }}>
    <DialogContent showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>{title}</DialogTitle><DialogDescription>{message}</DialogDescription></DialogHeader>
      <DialogBody><FormError message={error} /></DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="button" disabled={pending} onClick={() => { setPending(true); setError(''); onConfirm().then(close).catch(err => { setError(err instanceof Error ? err.message : 'No se pudo completar.'); setPending(false); }); }}>{pending ? 'Guardando…' : confirmLabel}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

// ---------- Descubrir en la red (MNDP) ----------

interface LanNeighbor { mac?: string | null; identity?: string | null; version?: string | null; platform?: string | null; board?: string | null; interface?: string | null; ips?: string[]; source?: string | null }

function DiscoverLanDialog({ context, close, onUse, restoreFocus }: { context: RoutersContext; close: () => void; onUse: (preset: { host?: string; name?: string }) => void; restoreFocus: () => void }) {
  const [neighbors, setNeighbors] = useState<LanNeighbor[] | null>(null);
  const [candidates, setCandidates] = useState<{ ip: string; ports: number[] }[]>([]);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setScanning(true); setError('');
    // Los anuncios MNDP salen cada ~30-60 s: escucha 30 s por ronda y acumula
    // hallazgos entre rondas; el barrido de puertos no depende del anuncio.
    context.request('routers/discover', { seconds: 30 }).then(r => {
      if (cancelled) return;
      const found: LanNeighbor[] = Array.isArray(r?.neighbors) ? r.neighbors : [];
      setNeighbors(previous => {
        const known = new Set((previous || []).map(n => n.mac || n.identity || n.ips?.[0]));
        return [...(previous || []), ...found.filter(n => !known.has(n.mac || n.identity || n.ips?.[0]))];
      });
      if (Array.isArray(r?.candidates)) setCandidates(r.candidates);
      setScanning(false);
    }).catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : 'No se pudo descubrir equipos.'); setScanning(false); } });
    return () => { cancelled = true; };
  }, [context, round]);
  return <Dialog open onOpenChange={openState => { if (!openState) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Descubrir en la red</DialogTitle><DialogDescription>Anuncios MNDP verificados más candidatos por puerto abierto (8291/80/443). Elegir uno precarga el formulario, no lo registra.</DialogDescription></DialogHeader>
      <DialogBody>
      {error ? <FormError message={error} /> : scanning && !neighbors?.length && !candidates.length ? <p className="text-sm text-muted-foreground">Escuchando la red (30 s, los anuncios salen cada ~30-60 s)…</p>
        : !neighbors?.length && !candidates.length ? <div className="grid gap-3"><p className="text-sm text-muted-foreground">Sin equipos a la vista. Verifica que el servidor esté en el mismo dominio broadcast (modo puente en VirtualBox) y que el firewall permita UDP 5678 entrante.</p><div><Button type="button" variant="outline" onClick={() => setRound(r => r + 1)}>Buscar de nuevo</Button></div></div>
        : <div className="grid gap-4">
          {!!neighbors?.length && <Table dense>
            <TableHeader><TableRow>{['Equipo (MNDP)', 'IP', 'MAC', 'Versión', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{neighbors.map((n, i) => <TableRow key={n.mac || `${n.identity}:${i}`}>
              <TableCell><strong>{n.identity || 'Sin identidad'}</strong><br /><span className="text-muted-foreground">{[n.platform, n.board].filter(Boolean).join(' · ') || '—'}</span></TableCell>
              <TableCell>{n.ips?.filter(ip => ip.includes('.')).join(', ') || n.source || '—'}</TableCell>
              <TableCell>{n.mac || '—'}</TableCell>
              <TableCell>{n.version || '—'}</TableCell>
              <TableCell><Button type="button" variant="outline" size="sm" disabled={!n.ips?.some(ip => ip.includes('.'))} onClick={() => onUse({ host: n.ips?.find(ip => ip.includes('.')), name: n.identity || undefined })}>Usar</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          {!!candidates.length && <Table dense>
            <TableHeader><TableRow>{['Candidato (puertos)', 'IP', 'Puertos', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{candidates.map(c => <TableRow key={c.ip}>
              <TableCell><span className="text-muted-foreground">Sin confirmar por MNDP</span></TableCell>
              <TableCell><strong>{c.ip}</strong></TableCell>
              <TableCell>{c.ports.join(', ')}</TableCell>
              <TableCell><Button type="button" variant="outline" size="sm" onClick={() => onUse({ host: c.ip })}>Usar</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>}
          <div><Button type="button" variant="outline" disabled={scanning} onClick={() => setRound(r => r + 1)}>{scanning ? 'Escuchando…' : 'Seguir buscando'}</Button></div>
        </div>}
      </DialogBody>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

// ---------- Puesta en marcha inicial ----------

function OnboardDialog({ context, close, onRegister, restoreFocus }: { context: RoutersContext; close: () => void; onRegister: (preset: { host?: string; name?: string }) => void; restoreFocus: () => void }) {
  const [host, setHost] = useState('192.168.88.1');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [identity, setIdentity] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [iface, setIface] = useState('ether2');
  const [dns, setDns] = useState('8.8.8.8,1.1.1.1');
  const [setupHttps, setSetupHttps] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ identity: string; managementIp: string; serviceUsername: string; servicePassword: string; https?: { certificate: string } | null; applied: string[] } | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    if (!identity.trim() || !newAddress.trim()) { setError('Indica identidad e IP de gestión.'); return; }
    setPending(true); setError(''); setResult(null);
    try {
      const data = await context.request('routers/onboard', { host: host.trim(), port: 80, protocol: 'http', username: username.trim() || 'admin', ...(password ? { password } : {}), identity: identity.trim(), newAddress: newAddress.trim(), interface: iface.trim() || 'ether2', ...(dns.trim() ? { dns: dns.trim() } : {}), setup_https: setupHttps });
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo completar la puesta en marcha.'); }
    finally { setPending(false); }
  }
  return <Dialog open onOpenChange={openState => { if (!openState && !pending) close(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden overflow-y-hidden p-0" showCloseButton={!pending} onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 px-6 pt-6"><DialogTitle>Puesta en marcha inicial</DialogTitle><DialogDescription>Configura un MikroTik nuevo desde el sistema: identidad, IP de gestión, DNS, usuario de servicio y HTTPS. Necesita reachable por IP con credenciales actuales (clave vacía = fábrica). Lo ya aplicado se informa si algo falla.</DialogDescription></DialogHeader>
      <DialogBody>
      {!result ? <form id="onboard-form" className="grid gap-4" aria-busy={pending} onSubmit={submit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="onboard-host" className="text-sm font-medium">IP actual del equipo</label><Input id="onboard-host" value={host} onChange={event => setHost(event.target.value)} required placeholder="192.168.88.1" disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="onboard-user" className="text-sm font-medium">Usuario actual</label><Input id="onboard-user" value={username} onChange={event => setUsername(event.target.value)} maxLength={100} autoComplete="off" disabled={pending} /></div></div>
        <div className="grid gap-2"><label htmlFor="onboard-pass" className="text-sm font-medium">Clave actual (vacía = fábrica)</label><Input id="onboard-pass" type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} autoComplete="off" disabled={pending} /></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="grid gap-2"><label htmlFor="onboard-identity" className="text-sm font-medium">Identidad</label><Input id="onboard-identity" value={identity} onChange={event => setIdentity(event.target.value)} required maxLength={64} placeholder="edificio-norte-central" disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="onboard-iface" className="text-sm font-medium">Interfaz de gestión</label><Input id="onboard-iface" value={iface} onChange={event => setIface(event.target.value)} maxLength={64} disabled={pending} /></div></div>
        <div className="grid gap-2"><label htmlFor="onboard-address" className="text-sm font-medium">IP de gestión (/24)</label><Input id="onboard-address" value={newAddress} onChange={event => setNewAddress(event.target.value)} required placeholder="192.168.10.1/24" disabled={pending} /></div>
        <div className="grid gap-2"><label htmlFor="onboard-dns" className="text-sm font-medium">DNS (coma, opcional)</label><Input id="onboard-dns" value={dns} onChange={event => setDns(event.target.value)} maxLength={64} disabled={pending} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setupHttps} onChange={event => setSetupHttps(event.target.checked)} disabled={pending} /> Configurar HTTPS con certificado local</label>
        <FormError message={error} />
      </form> : <div className="grid gap-4">
        <Card><CardContent className="grid gap-2"><p className="text-sm font-medium text-green-700 dark:text-green-400">✓ Equipo verificado en {result.managementIp}.</p><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.applied.map(a => <li key={a}>{a}</li>)}</ul><p className="text-sm">Usuario de servicio: <strong>{result.serviceUsername}</strong> · Clave: <strong className="[overflow-wrap:anywhere]">{result.servicePassword}</strong>{result.https ? ` · HTTPS ${result.https.certificate}` : ''}</p><p className="text-sm text-muted-foreground">Guarda estas credenciales y regístralo en NuweNet para administrarlo.</p></CardContent></Card>
      </div>}
      </DialogBody>
      {!result ? <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close} disabled={pending}>Cancelar</Button><Button type="submit" form="onboard-form" disabled={pending}>{pending ? 'Configurando…' : 'Ejecutar puesta en marcha'}</Button></DialogFooter> : <DialogFooter className="shrink-0 border-t px-6 py-4"><Button type="button" variant="outline" onClick={close}>Cerrar</Button><Button type="button" onClick={() => onRegister({ host: result.managementIp.split('/')[0], name: result.identity })}>Registrar en NuweNet</Button></DialogFooter>}
    </DialogContent>
  </Dialog>;
}

// ---------- Tarjeta y vista ----------

type Draft =
  | { type: 'form'; router: RouterEntry | null; preset?: { host?: string; name?: string; building_id?: string } }
  | { type: 'lan' }
  | { type: 'onboard' }
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

/** Nivel de administración calculado por la API (misma fuente que el asistente). Sin verificar = aún no consultado. */
const compatibilityLabels: Record<string, string> = { full: 'Administración completa', partial: 'Administración parcial', read_only: 'Solo consulta', unavailable: 'No disponible' };
function managementLevel(router: RouterEntry): { label: string; destructive: boolean } {
  if (router.compatibility === 'read_only' && !router.snapshot) return { label: 'Sin verificar', destructive: false };
  const label = (router.compatibility && compatibilityLabels[router.compatibility]) || 'Sin integración compatible';
  return { label, destructive: !router.compatibility || (router.compatibility === 'read_only' && router.adapter === 'tr369-usp') };
}

function SwitchPorts({ router, context, onChanged }: { router: RouterEntry; context: RoutersContext; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function toggle(name: string, disabled: boolean) {
    if (busy) return;
    setBusy(name); setError('');
    try {
      await context.request(`routers/${router.id}/ethernet`, { name, disabled });
      await context.request(`routers/${router.id}/check`, {});
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo modificar el puerto.'); }
    finally { setBusy(null); }
  }
  return <div className="grid gap-2">
    <h3 className="text-sm font-semibold">Puertos ethernet</h3>
    <p className="text-sm text-muted-foreground">Habilita o deshabilita puertos físicos con verificación. Útil para aislar un tramo sin desconectar cables.</p>
    <Table dense>
      <TableHeader><TableRow>{['Puerto', 'Enlace', 'Administración', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{(router.snapshot?.interfaces || []).map(i => <TableRow key={i.name}>
        <TableCell>{i.name}</TableCell>
        <TableCell>{i.state}</TableCell>
        <TableCell>{i.disabled ? 'Deshabilitado' : 'Habilitado'}</TableCell>
        <TableCell><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => { void toggle(i.name, !i.disabled); }}>{busy === i.name ? 'Aplicando…' : i.disabled ? 'Habilitar' : 'Deshabilitar'}</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {error && <FormError message={error} />}
  </div>;
}

function RouterDetails({ router, adapterName, buildingName, checking, canManage, context, onAction, onCheck, onChanged }: { router: RouterEntry; adapterName: string; buildingName: string; checking: boolean; canManage: boolean; context: RoutersContext; onAction: (draft: Draft, button: HTMLButtonElement) => void; onCheck: (id: string) => Promise<void>; onChanged: () => Promise<void> }) {
  const snapshot = router.snapshot;
  const labels = router.adapter === 'arris-touchstone' ? arrisCapNames : capNames;
  return <Card data-router-id={router.id} className="min-w-0">
    <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div className="grid gap-1"><h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{router.name}</h2><p className="text-sm text-muted-foreground">{adapterName}{buildingName ? ` · ${buildingName}` : ''}</p><Badge className="w-fit" variant={managementLevel(router).destructive ? 'outline-destructive' : 'outline'}>{managementLevel(router).label}</Badge></div><StatusText className="text-sm">{badgeFor(router, checking)}</StatusText></div></CardHeader>
    {canManage ? <CardFooter className="flex flex-wrap gap-2">
      {!router.disabled && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => { void onCheck(router.id); }}><Activity aria-hidden="true" />{checking ? 'Consultando…' : 'Probar conexión'}</Button>}
      {!router.disabled && router.adapter === 'mikrotik-rest' && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'provision', router }, event.currentTarget)}><Server aria-hidden="true" />Aprovisionar puertos y permisos</Button>}
      {!router.disabled && router.capabilities?.suspend && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'control', router }, event.currentTarget)}><SlidersHorizontal aria-hidden="true" />Controlar dispositivo</Button>}
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'toggle', router }, event.currentTarget)}><Power aria-hidden="true" />{router.disabled ? 'Activar' : 'Desactivar'}</Button>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'form', router }, event.currentTarget)}><Pencil aria-hidden="true" />Editar</Button>
      <Button type="button" variant="outline" size="sm" disabled={checking} onClick={event => onAction({ type: 'remove', router }, event.currentTarget)}><Trash aria-hidden="true" />Quitar conexión</Button>
    </CardFooter> : <CardContent><p className="text-sm text-muted-foreground">🔒 Solo el super-admin configura routers y aplica acciones de red.</p></CardContent>}
    <CardContent className="grid gap-5 [overflow-wrap:anywhere]">
      <h3 className="text-sm font-semibold">Información del equipo</h3>
      <p className="text-sm"><strong>{router.protocol}://{router.host}:{router.port}</strong><br />
        {snapshot ? <>{snapshot.manufacturer} · {snapshot.model || 'Modelo no identificado'}<br />Firmware: {snapshot.firmware || 'Sin dato'}<br />{snapshot.wan_status ? <>Enlace: {snapshot.wan_status}<br /></> : null}{snapshot.uptime ? <>Tiempo activo: {snapshot.uptime}<br /></> : null}</> : 'Prueba la conexión para obtener información del equipo.'}<br />
        <span className="text-muted-foreground">Credenciales guardadas con cifrado · {router.last_checked ? `Última consulta: ${new Date(router.last_checked).toLocaleString('es')}` : 'Todavía no se ha consultado'}</span></p>
      {router.diagnostic_host && <Facts items={[['IP de diagnóstico', router.diagnostic_host]]} />}
      <ConnectionDetails router={router} canManage={canManage} onControl={(op, ip) => onAction({ type: 'control', router, action: op, ip }, document.activeElement as HTMLButtonElement)} onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)} />
      {router.devices?.length ? <details><summary className="cursor-pointer text-sm font-medium">Dispositivos vinculados ({router.devices.length})</summary><p className="text-sm text-muted-foreground">El control automático del departamento incluye estas MAC y su IP de servicio. Requiere un MikroTik central y una consulta correcta de las IP actuales. El plan de velocidad se comparte entre sus dispositivos.</p><Table dense>
        <TableHeader><TableRow>{['MAC', 'Departamento', 'Última IP reportada', 'Acción'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{router.devices.map(d => <TableRow key={d.mac}>
          <TableCell>{d.mac}</TableCell>
          <TableCell>{d.apartment}{d.archived ? ' (archivado)' : ''}</TableCell>
          <TableCell>{snapshot?.clients?.find(c => c.mac?.toUpperCase() === d.mac)?.ip || 'No aparece en la última consulta'}</TableCell>
          <TableCell><LinkButton router={router} mac={d.mac} onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)} /></TableCell>
        </TableRow>)}</TableBody>
      </Table></details> : null}
      {router.last_error && <FormError message={router.last_error} />}
      <div className="flex flex-wrap gap-2">{Object.entries(router.capabilities || {}).map(([name, supported]) => <span key={name} className="text-xs">{supported ? '✓' : '—'} {labels[name]}{supported ? '' : router.adapter === 'arris-touchstone' && name === 'speed_limit' ? ' · no disponible en este firmware' : ' · no implementado'}</span>)}</div>
      {snapshot?.interfaces?.length ? <Table dense>
        <TableHeader><TableRow>{['Interfaz', 'Estado', 'Enlace'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{snapshot.interfaces.map(i => <TableRow key={i.name}><TableCell>{i.name}</TableCell><TableCell>{i.state}</TableCell><TableCell>{i.speed || '—'}</TableCell></TableRow>)}</TableBody>
      </Table> : null}
      {snapshot?.blocked?.length ? <p className="text-sm"><strong>{router.adapter === 'arris-touchstone' ? 'IP con bloqueo TCP/UDP' : 'IP bloqueadas'} ({snapshot.blocked.length}):</strong> {snapshot.blocked.join(', ')}</p> : null}
      {snapshot?.speedLimits?.length ? <Table dense>
        <TableHeader><TableRow>{['IP con límite', 'max-limit'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{snapshot.speedLimits.map(q => <TableRow key={q.ip}><TableCell>{q.ip}</TableCell><TableCell>{q.maxLimit}</TableCell></TableRow>)}</TableBody>
      </Table> : null}
      {snapshot?.firewallBlocks?.length ? <p className="text-sm"><strong>Destinos bloqueados ({snapshot.firewallBlocks.length}):</strong> {snapshot.firewallBlocks.map(b => `${b.ip} → ${b.target}`).join(', ')}</p> : null}
      {snapshot?.parental?.length ? <p className="text-sm"><strong>Horarios parentales ({snapshot.parental.length}):</strong> {snapshot.parental.map(p => `${p.ip} (${p.schedule})`).join(', ')}</p> : null}
      {typeof snapshot?.leases === 'number' && <p className="text-sm text-muted-foreground">Leases DHCP vistos: {snapshot.leases}. Pulsa «Probar conexión» para actualizar bloqueos y colas.</p>}
      {(snapshot?.notes || []).map((note, i) => <p key={i} className="text-sm text-muted-foreground">{note}</p>)}
      {router.adapter === 'mikrotik-rest' && !router.disabled && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={event => onAction({ type: 'traffic', router }, event.currentTarget)}>Tráfico en vivo</Button><Button type="button" variant="outline" size="sm" onClick={event => onAction({ type: 'discover', router }, event.currentTarget)}>Descubrir dispositivos</Button></div>}
      {canManage && router.capabilities?.switch_ports && !router.disabled && !!router.snapshot?.interfaces?.length && <SwitchPorts router={router} context={context} onChanged={onChanged} />}
    </CardContent>

  </Card>;
}

function BuildingTopology({ buildingId, context, onSelectRouter }: { buildingId: string; context: RoutersContext; onSelectRouter: (id: string) => void }) {
  const [data, setData] = useState<{ design: { nodes: { id: string; name: string; role: 'provider' | 'central' | 'switch' | 'access'; host?: string; model?: string; router_id?: string; customer_id?: string }[]; links: { from: string; to: string; from_port: string; to_port: string }[] }; published_design: { nodes: { id: string; name: string; role: 'provider' | 'central' | 'switch' | 'access'; host?: string; model?: string; router_id?: string; customer_id?: string }[]; links: { from: string; to: string; from_port: string; to_port: string }[] } | null; published_at: string | null; equipment: { id: string; status: string; compatibility: string }[]; customers: { id: string; apartment: string }[] } | null>(null);
  const [error, setError] = useState('');
  const [showPublished, setShowPublished] = useState(false);
  useEffect(() => {
    let cancelled = false;
    context.request(`building-networks/${buildingId}`).then(result => { if (!cancelled) setData(result); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar la topología.'); });
    return () => { cancelled = true; };
  }, [buildingId, context]);
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Cargando topología…</p>;
  const design = showPublished && data.published_design ? data.published_design : data.design;
  if (!design.nodes.length) return <p className="text-sm text-muted-foreground">Este edificio aún no tiene topología. Usa «Configurar red» para crearla.</p>;
  return <div className="grid gap-2">
    {data.published_design && <div className="flex flex-wrap items-center gap-2 text-sm">
      <Button type="button" variant={showPublished ? 'outline' : 'default'} size="sm" onClick={() => setShowPublished(false)}>Borrador</Button>
      <Button type="button" variant={showPublished ? 'default' : 'outline'} size="sm" onClick={() => setShowPublished(true)}>Publicada{data.published_at ? ` · ${new Date(data.published_at).toLocaleString('es')}` : ''}</Button>
    </div>}
    <NetworkTopologyMap
      nodes={design.nodes}
      links={design.links}
      equipment={data.equipment}
      customers={data.customers}
      interactive={context.canManage}
      onSelectRouter={onSelectRouter}
    />
  </div>;
}

function RoutersView({ context }: { context: RoutersContext }) {
  const [routers, setRouters] = useState<RouterEntry[]>([]);
  const [adapters, setAdapters] = useState<RouterAdapterInfo[]>([]);
  const [buildings, setBuildings] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [wizard, setWizard] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const detailHeading = useRef<HTMLDivElement>(null);
  const listTrigger = useRef<string | null>(null);
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
  async function check(id: string) {
    setBusy(prev => new Set(prev).add(id));
    setNotice('Consultando el router. En ARRIS puede tardar hasta tres minutos.');
    try {
      const result = await context.request(`routers/${id}/check`, {});
      await reload();
      setNotice(result.success ? 'Conexión verificada con el router.' : String(result.router?.last_error || 'Falló la consulta.'));
    } catch (err) { setNotice(err instanceof Error ? err.message : 'No se pudo consultar.'); }
    finally { setBusy(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }
  useEffect(() => {
    if (selectedId !== null) {
      detailHeading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    else if (listTrigger.current !== null) document.getElementById(`router-open-${listTrigger.current}`)?.focus();
  }, [selectedId]);
  function open(next: Draft, button: HTMLButtonElement | null) { trigger.current = button; setNotice(''); setDraft(next); }
  function close() { setDraft(undefined); }
  function restore() { trigger.current?.focus(); }
  async function saved(message: string) {
    close(); setNotice(message);
    try { await reload(); await context.refresh(); }
    catch { setNotice(`${message} No se pudo actualizar el listado.`); }
  }
  async function remove(id: string) {
    await context.request(`routers/${id}/remove`, {});
    setSelectedId(null);
    await saved('Conexión quitada del sistema.');
  }
  async function toggle(router: RouterEntry) {
    await context.request(`routers/${router.id}/toggle`, { disabled: !router.disabled });
    await saved(`Router ${router.disabled ? 'activado' : 'deshabilitado'}.`);
  }
  const buildingName = (id?: string | null) => (id ? (buildings.length ? buildings.find(b => b.id === id)?.name || `Edificio ${String(id).slice(0, 8)}` : `Edificio ${String(id).slice(0, 8)}`) : 'Sin edificio');
  const selected = routers.find(router => router.id === selectedId);
  const filtered = routers.filter(router => [router.name, router.host, buildingName(router.building_id), adapters.find(a => a.id === router.adapter)?.name || router.adapter].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const [wizardBuilding, setWizardBuilding] = useState<string | null>(null);
  // Grupos por edificio (proveedor, central, switches y accesos juntos); al final el pool sin asignar.
  const groups: { id: string | null; name: string; routers: typeof filtered }[] = [
    ...buildings.map(b => ({ id: b.id as string | null, name: b.name, routers: filtered.filter(r => r.building_id === b.id) })),
    { id: null, name: 'Sin edificio', routers: filtered.filter(r => !r.building_id) },
  ].filter(g => g.routers.length || !search.trim());
  if (wizard) return <NetworkSetupWizard context={context} buildings={buildings} initialBuildingId={wizardBuilding} close={() => { setWizard(false); setWizardBuilding(null); }} onOpenRouter={id => { setWizard(false); setWizardBuilding(null); listTrigger.current = id; setNotice(''); setSelectedId(id); }} />;
  return <PanelShell id="routers-panel" title={selected ? 'Detalle del equipo' : 'Equipos de red'} description={selected ? 'Información de la última consulta y administración del equipo.' : 'Encuentra un equipo y abre su ficha para consultar la información y administrar su conexión.'}
    actions={<>{selected ? <Button type="button" variant="outline" onClick={() => setSelectedId(null)}><ArrowLeft aria-hidden="true" />Volver a routers</Button> : <>{context.canManage && <Button type="button" variant="outline" disabled={!loaded || !!loadError} onClick={() => setWizard(true)}>Configurar red del edificio</Button>}<Button type="button" variant="outline" onClick={() => { void reload().then(() => context.refresh()).catch(() => setNotice('No se pudo actualizar.')); }}>Actualizar</Button>{context.canManage && <Button type="button" variant="outline" onClick={event => open({ type: 'onboard' }, event.currentTarget)}><Rocket aria-hidden="true" />Puesta en marcha inicial</Button>}{context.canManage && <Button type="button" variant="outline" onClick={event => open({ type: 'lan' }, event.currentTarget)}><Radar aria-hidden="true" />Descubrir en la red</Button>}{context.canManage && <Button type="button" onClick={event => open({ type: 'form', router: null }, event.currentTarget)}><Plus aria-hidden="true" />Agregar router</Button>}</>}</>}>
    <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
    {!loaded ? <Card><CardContent><div role="status" aria-label="Cargando conexiones…"><ListSkeleton rows={3} /></div></CardContent></Card>
      : loadError ? <Card><CardContent><p className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="mt-2" onClick={() => { setLoaded(false); setLoadError(''); void reload().then(() => setLoaded(true)).catch(err => { setLoadError(err instanceof Error ? err.message : 'No se pudo cargar.'); setLoaded(true); }); }}>Reintentar</Button></CardContent></Card>
      : !routers.length ? <Card><CardContent className="grid gap-2"><span aria-hidden="true">⌘</span><strong>Conecta tu primer router</strong><p className="text-sm text-muted-foreground">Registra su IP de administración y selecciona el adaptador compatible.</p></CardContent></Card>
      : selected ? <div ref={detailHeading} tabIndex={-1} aria-label={`Ficha de ${selected.name}`} className="grid min-w-0 gap-4 outline-none">
        <RouterDetails router={selected} adapterName={adapters.find(a => a.id === selected.adapter)?.name || selected.adapter} buildingName={buildingName(selected.building_id)} checking={busy.has(selected.id) || !!selected.checking} canManage={context.canManage} context={context} onAction={open} onCheck={check} onChanged={async () => { try { await reload(); await context.refresh(); } catch { setNotice('No se pudo actualizar el listado.'); } }} />
        <Card><CardContent className="grid gap-2"><h2 className="text-sm font-semibold">Compatibilidad del equipo</h2><p className="text-sm text-muted-foreground">{adapters.find(a => a.id === selected.adapter)?.requirements || 'No hay información adicional para este adaptador.'}</p></CardContent></Card>
      </div> : <div className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div className="grid w-full gap-2 sm:max-w-sm"><label htmlFor="router-search" className="text-sm font-medium">Buscar router</label><div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input id="router-search" className="pl-9" placeholder="Nombre, IP o edificio" value={search} onChange={event => setSearch(event.target.value)} /></div></div><p className="text-sm text-muted-foreground" role="status">{filtered.length} de {routers.length} routers</p></div>
        {filtered.length || groups.some(g => g.id !== null) ? groups.map(group => <section key={group.id ?? 0} aria-label={group.id ? `Edificio ${group.name}` : 'Sin edificio'} className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{group.id ? group.name : 'Sin edificio'}</h2><div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">{group.routers.length} equipo{group.routers.length === 1 ? '' : 's'}</span>{context.canManage && group.id !== null && <Button type="button" variant="outline" size="sm" disabled={!loaded || !!loadError} onClick={() => { setWizardBuilding(group.id); setWizard(true); }}>Configurar red de {group.name}</Button>}{context.canManage && <Button type="button" variant="outline" size="sm" onClick={event => open({ type: 'form', router: null, preset: group.id ? { building_id: group.id } : undefined }, event.currentTarget)}><Plus aria-hidden="true" />Agregar{group.id ? ` en ${group.name}` : ''}</Button>}</div></div>
          {group.id !== null && <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Ver topología del edificio</summary><div className="pt-3"><BuildingTopology buildingId={group.id} context={context} onSelectRouter={id => { listTrigger.current = id; setNotice(''); setSelectedId(id); }} /></div></details>}
          {group.routers.length ? <div className="overflow-hidden rounded-xl border bg-card divide-y">{group.routers.map(router => <div key={router.id} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-start gap-3"><span className="rounded-lg bg-muted p-2.5"><Server className="size-5" aria-hidden="true" /></span><div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{router.name}</h3><p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{buildingName(router.building_id)}</p></div></div>
            <div className="min-w-0 text-sm"><p className="[overflow-wrap:anywhere]">{router.host}:{router.port}</p><p className="text-muted-foreground">{adapters.find(a => a.id === router.adapter)?.name || router.adapter}</p><StatusText tone={router.last_error ? 'danger' : 'default'} className="text-xs">{badgeFor(router, busy.has(router.id) || !!router.checking)}</StatusText></div>
            <Button type="button" variant="outline" id={`router-open-${router.id}`} aria-label={`Ver router ${router.name}`} onClick={() => { listTrigger.current = router.id; setNotice(''); setSelectedId(router.id); }}>Ver router<ArrowRight aria-hidden="true" /></Button>
          </div>)}</div> : <p className="text-sm text-muted-foreground">Sin equipos registrados en este edificio.</p>}
        </section>) : <Card><CardContent className="grid gap-3 py-6"><p className="text-sm text-muted-foreground">No hay routers que coincidan con la búsqueda.</p><Button type="button" variant="outline" className="w-fit" onClick={() => setSearch('')}>Limpiar búsqueda</Button></CardContent></Card>}
      </div>}
    {draft?.type === 'form' && <RouterForm router={draft.router} preset={draft.preset} adapters={adapters} buildings={buildings} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'lan' && <DiscoverLanDialog context={context} close={close} restoreFocus={restore} onUse={preset => setDraft({ type: 'form', router: null, preset })} />}
    {draft?.type === 'onboard' && <OnboardDialog context={context} close={close} restoreFocus={restore} onRegister={preset => setDraft({ type: 'form', router: null, preset })} />}
    {draft?.type === 'control' && <ControlDialog router={draft.router} preset={{ action: draft.action, ip: draft.ip }} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'provision' && <ProvisionDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
    {draft?.type === 'traffic' && <TrafficDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
    {draft?.type === 'discover' && <DiscoverDialog router={draft.router} context={context} onLink={mac => setDraft({ type: 'link', router: draft.router, mac })} close={close} restoreFocus={restore} />}
    {draft?.type === 'link' && <LinkDialog router={draft.router} mac={draft.mac} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
    {draft?.type === 'remove' && <ConfirmDialog title="Quitar conexión" message={`¿Quitar ${draft.router.name} del sistema? No modifica el equipo. Esta acción no se puede deshacer.`} confirmLabel="Quitar" onConfirm={() => remove(draft.router.id)} close={close} restoreFocus={restore} />}
    {draft?.type === 'toggle' && <ConfirmDialog title={draft.router.disabled ? 'Activar router' : 'Deshabilitar router'} message={draft.router.disabled ? `¿Activar ${draft.router.name}?` : `¿Deshabilitar ${draft.router.name}? No se podrá consultar ni aplicar acciones hasta reactivarlo.`} confirmLabel={draft.router.disabled ? 'Activar' : 'Deshabilitar'} onConfirm={() => toggle(draft.router)} close={close} restoreFocus={restore} />}
  </PanelShell>;
}

export default function RoutersPanel() {
  const state = useSyncExternalStore(subscribeRouters, getRouters, getServerRouters);
  return state.visible && state.context ? <RoutersView key={state.context.userId} context={state.context} /> : null;
}
