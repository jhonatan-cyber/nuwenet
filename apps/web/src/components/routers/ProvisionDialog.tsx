import { useEffect, useState } from 'react';
import { Check, Copy, Dices, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogBody } from '@/components/ui/dialog';
import { DialogActions, DialogHead, FormField, PendingDialog } from '@/components/shared/dialog';
import { FormError } from '@/components/panel-shell';
import { TableCell, TableRow } from '@/components/ui/table';
import { DataTable } from '@/components/shared/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { RouterEntry, RoutersContext } from '@/features/routers-network/routers-store';
import { randomSecret } from './router-types';
import { IconButton } from '@/components/shared/icon-button';

interface ServiceItem { name: string; port: number; disabled: boolean; address: string }

function ServiceRow({ service, saving, onSave }: {
  service: ServiceItem;
  saving: boolean;
  onSave: (name: string, port: number, disabled: boolean, address: string) => void;
}) {
  const [port, setPort] = useState(String(service.port));
  const [enabled, setEnabled] = useState(!service.disabled);
  const [address, setAddress] = useState(service.address || '');
  return (
    <TableRow>
      <TableCell><strong>{service.name}</strong></TableCell>
      <TableCell><Input type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} className="w-20" disabled={saving} aria-label={`Puerto de ${service.name}`} /></TableCell>
      <TableCell><label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={saving} /> Activo</label></TableCell>
      <TableCell><Input type="text" value={address} onChange={event => setAddress(event.target.value)} placeholder="Cualquiera" className="w-32" disabled={saving} aria-label={`IP permitida de ${service.name}`} /></TableCell>
      <TableCell><IconButton label={`Guardar ${service.name}`} tip={<>{saving ? 'Guardando…' : `Guardar ${service.name}`}</>} type="button" variant="outline" size="icon-sm" disabled={saving} onClick={() => onSave(service.name, Number(port), !enabled, address.trim())}><Check aria-hidden="true" /></IconButton></TableCell>
    </TableRow>
  );
}

export function ProvisionDialog({ router, context, close, restoreFocus }: {
  router: RouterEntry;
  context: RoutersContext;
  close: () => void;
  restoreFocus: () => void;
}) {
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
    context.request(`routers/${router.id}/services`)
      .then(s => { if (!cancelled) setServices(Array.isArray(s) ? s : []); })
      .catch(err => { if (!cancelled) setServicesError(err instanceof Error ? err.message : 'No se pudieron consultar los servicios.'); });
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
    context.request('routers/script', body)
      .then(s => { if (!cancelled && s?.script) { setScript(s.script); setScriptError(''); } })
      .catch(err => { if (!cancelled) setScriptError(err instanceof Error ? err.message : 'Revisa los datos DHCP.'); });
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
      const data = await context.request(`routers/${router.id}/lan-dhcp`, { lan: lan.trim(), lanInterface: lanInterface.trim() || 'ether2', pool: pool.trim(), ...(dns.trim() ? { dns: dns.trim() } : {}), ...(ready.length ? { leases: ready } : {}) });
      setLanResult({ ok: true, text: `✓ LAN ${data.lan} en ${data.lanInterface}, pool ${data.pool} y ${data.leases} leases aplicados. Verificado en el equipo. No se eliminaron leases existentes.` });
      setNotice('LAN/DHCP aplicada y verificada en el equipo.');
    } catch (err) { setLanResult({ ok: false, text: err instanceof Error ? err.message : 'Fallo al aplicar la LAN.' }); }
    finally { setLanPending(false); }
  }

  return (
    <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus} className="sm:max-w-3xl">
      <DialogHead title={`Aprovisionar MikroTik · ${router.name}`} description="Puertos, usuario de servicio y red WAN/LAN aplicadas directo en el equipo, sin pasar por la terminal." />
        <DialogBody>
          <div className="flex gap-2" role="tablist">
            {(['services', 'user', 'network'] as const).map((t, i) => (
              <Button key={t} type="button" variant={tab === t ? 'default' : 'outline'} onClick={() => setTab(t)}>
                {i + 1}. {t === 'services' ? 'Servicios y Puertos' : t === 'user' ? 'Usuario NuweNet' : 'Red WAN/LAN'}
              </Button>
            ))}
          </div>

          {tab === 'services' && (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">Consulta y ajusta los servicios de RouterOS. Puedes activar o desactivar puertos y restringir la IP autorizada para conectarse.</p>
              {services
                ? <DataTable dense variant="plain" headings={['Servicio', 'Puerto', 'Estado', 'IP Permitida', 'Acción']} empty="RouterOS no reporta servicios en este equipo." rows={services.map(s => <ServiceRow key={s.name} service={s} saving={saving === s.name} onSave={saveService} />)} />
                : servicesError ? <FormError message={servicesError} /> : <p className="text-sm text-muted-foreground">Cargando servicios de RouterOS…</p>}
            </div>
          )}

          {tab === 'user' && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">Crea un usuario exclusivo en el grupo <code>nuwenet</code> con permisos reducidos (<code>read, write, api, firewall, queue, dhcp, rest-api</code>) para no operar con la cuenta maestra <code>admin</code>.</p>
              <FormField id="prov-user" label="Nombre de usuario de servicio"><Input id="prov-user" value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} disabled={provPending} /></FormField>
              <FormField id="prov-pass" label="Contraseña segura"><div className="flex gap-2"><Input id="prov-pass" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} disabled={provPending} /><IconButton label="Generar otra contraseña" type="button" variant="outline" size="icon-sm" onClick={() => setPassword(randomSecret(16))} disabled={provPending}><Dices aria-hidden="true" /></IconButton></div></FormField>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={updateVault} onChange={event => setUpdateVault(event.target.checked)} disabled={provPending} /> Actualizar credenciales guardadas en NuweNet</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setupHttps} onChange={event => setSetupHttps(event.target.checked)} disabled={provPending} /> Configurar HTTPS con certificado local autofirmado</label>
              <p className="text-sm text-muted-foreground">El certificado autofirmado sirve para practicar y operar en LAN de gestión. NuweNet valida TLS: para producción instala un certificado válido.</p>
              <div><Button type="button" onClick={() => { void provision(); }} disabled={provPending}>{provPending ? 'Aprovisionando…' : 'Crear usuario y grupo en MikroTik'}</Button></div>
              {provResult && <p role="status" className={provResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{provResult.text}</p>}
            </div>
          )}

          {tab === 'network' && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">Aplica la configuración directo en el equipo por REST y verifica el resultado. Ya no necesitas copiar comandos en la terminal de WinBox/SSH.</p>
              <h3 className="text-sm font-semibold">Uplink del proveedor</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField id="cli-wan-iface" label="Interfaz WAN"><Input id="cli-wan-iface" value={wanInterface} onChange={event => setWanInterface(event.target.value)} maxLength={64} placeholder="ether1" disabled={wanPending} /></FormField>
                <FormField label="Opciones"><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wanDhcp} onChange={event => setWanDhcp(event.target.checked)} disabled={wanPending} /> DHCP en WAN</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={nat} onChange={event => setNat(event.target.checked)} disabled={wanPending} /> NAT saliente</label></div></FormField>
              </div>
              <div><Button type="button" onClick={() => { void applyWan(); }} disabled={wanPending}>{wanPending ? 'Aplicando…' : 'Aplicar WAN en el equipo'}</Button></div>
              {wanResult && <p role="status" className={wanResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{wanResult.text}</p>}

              <h3 className="text-sm font-semibold">Red LAN y DHCP</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField id="cli-lan-iface" label="Interfaz LAN"><Input id="cli-lan-iface" value={lanInterface} onChange={event => setLanInterface(event.target.value)} maxLength={64} placeholder="ether2" disabled={lanPending} /></FormField>
                <FormField id="cli-lan" label="Dirección LAN (/24)"><Input id="cli-lan" value={lan} onChange={event => setLan(event.target.value)} placeholder="192.168.10.1/24" disabled={lanPending} /></FormField>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField id="cli-pool" label="Pool DHCP dinámico"><Input id="cli-pool" value={pool} onChange={event => setPool(event.target.value)} placeholder="192.168.10.100-192.168.10.200" disabled={lanPending} /></FormField>
                <FormField id="cli-dns" label="DNS (coma)"><Input id="cli-dns" value={dns} onChange={event => setDns(event.target.value)} maxLength={64} disabled={lanPending} /></FormField>
              </div>
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Leases estáticos (switch y departamentos)</span>
                  <IconButton label="Añadir fila de lease" type="button" variant="outline" size="icon-sm" onClick={() => setLeases(rows => [...rows, { mac: '', address: '', comment: '' }])} disabled={lanPending}><Plus aria-hidden="true" /></IconButton>
                </div>
                {leases.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <div className="grid gap-1"><label htmlFor={`cli-lease-mac-${i}`} className="text-xs text-muted-foreground">MAC</label><Input id={`cli-lease-mac-${i}`} value={row.mac} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, mac: event.target.value } : r))} placeholder="AA:BB:CC:DD:EE:FF" disabled={lanPending} /></div>
                    <div className="grid gap-1"><label htmlFor={`cli-lease-ip-${i}`} className="text-xs text-muted-foreground">IP fija</label><Input id={`cli-lease-ip-${i}`} value={row.address} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, address: event.target.value } : r))} placeholder="192.168.10.11" disabled={lanPending} /></div>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar fila ${i + 1}`} onClick={() => setLeases(rows => rows.filter((_, j) => j !== i))} disabled={lanPending}>✕</Button>
                    <div className="grid gap-1 col-span-3"><label htmlFor={`cli-lease-comment-${i}`} className="text-xs text-muted-foreground">Comentario</label><Input id={`cli-lease-comment-${i}`} value={row.comment} onChange={event => setLeases(rows => rows.map((r, j) => j === i ? { ...r, comment: event.target.value } : r))} maxLength={80} placeholder="dep-201" disabled={lanPending} /></div>
                  </div>
                ))}
              </div>
              <div><Button type="button" onClick={() => { void applyLan(); }} disabled={lanPending}>{lanPending ? 'Aplicando…' : 'Aplicar LAN/DHCP en el equipo'}</Button></div>
              {lanResult && <p role="status" className={lanResult.ok ? 'text-sm font-medium text-green-700 dark:text-green-400' : 'text-sm text-destructive'}>{lanResult.text}</p>}
              <details>
                <summary className="cursor-pointer text-sm font-medium">Ver comandos equivalentes (solo referencia)</summary>
                <div className="grid gap-2 pt-2">
                  <textarea id="cli-script-box" readOnly rows={9} value={script} className="w-full font-mono text-xs" />
                  {scriptError && <p role="alert" className="text-sm text-destructive">{scriptError}</p>}
                  <div><IconButton label="Copiar comandos" type="button" variant="outline" size="icon-sm" onClick={() => { void copy(); }}><Copy aria-hidden="true" /></IconButton></div>
                </div>
              </details>
            </div>
          )}

          <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>
        </DialogBody>
      <DialogActions><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogActions>
    </PendingDialog>
  );
}
