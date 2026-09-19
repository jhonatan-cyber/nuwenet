import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Check, Link2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody } from '@/components/ui/dialog';
import { TableCell, TableRow } from '@/components/ui/table';
import { DataTable } from '@/components/shared/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError } from '@/components/panel-shell';
import { DialogActions, DialogHead, FormField, PendingDialog, SubmitRow } from '@/components/shared/dialog';
import type { RouterEntry, RouterClient, RoutersContext } from '@/features/routers-network/routers-store';
import { fmtTraffic } from '@/shared/lib/format';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Tráfico en vivo ----------

interface TrafficStat { name: string; target?: string; downloadRate: number; uploadRate: number; downloadBytes: number; uploadBytes: number }

export function TrafficDialog({ router, context, close, restoreFocus }: {
  router: RouterEntry;
  context: RoutersContext;
  close: () => void;
  restoreFocus: () => void;
}) {
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

  return (
    <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead title="Tráfico en vivo" description="Tasas actuales en Mbps. Consumo desde el reinicio de la cola." />
        <DialogBody>
          {error ? <FormError message={error} /> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
            <div className="grid gap-3">{rows.map(r => <p key={r.name} className="text-sm"><strong>{r.name}</strong><br />{r.target}<br />{fmtTraffic(r.downloadRate, r.uploadRate, r.downloadBytes, r.uploadBytes)}</p>)}</div>}
        </DialogBody>
        <DialogActions><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogActions>
    </PendingDialog>
  );
}

// ---------- Dispositivos sin departamento ----------

interface UnlinkedDevice { mac: string; ip: string | null; name: string | null; status: string | null }

export function DiscoverDialog({ router, onLink, context, close, restoreFocus }: {
  router: RouterEntry;
  onLink: (mac: string) => void;
  context: RoutersContext;
  close: () => void;
  restoreFocus: () => void;
}) {
  const [rows, setRows] = useState<UnlinkedDevice[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    context.request(`routers/${router.id}/unlinked-devices`)
      .then(r => { if (!cancelled) setRows(Array.isArray(r) ? r : []); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo consultar.'); });
    return () => { cancelled = true; };
  }, [context, router.id]);

  return (
    <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead title="Dispositivos sin departamento" description="Dispositivos vistos por DHCP que aún no están vinculados." />
        <DialogBody>
          {error ? <FormError message={error} /> : !rows ? <p className="text-sm text-muted-foreground">Consultando...</p> : !rows.length ? <p className="text-sm text-muted-foreground">Sin resultados.</p> :
            <div className="grid gap-3">{rows.map(r => <p key={r.mac} className="text-sm"><strong>{r.name || 'Sin nombre'}</strong><br />{r.mac} / {r.ip} / {r.status}<br /><IconButton label={`Vincular departamento · ${r.mac}`} type="button" variant="outline" size="icon-sm" className="mt-1" onClick={() => onLink(r.mac)}><Link2 aria-hidden="true" /></IconButton></p>)}</div>}
        </DialogBody>
        <DialogActions><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogActions>
    </PendingDialog>
  );
}

// ---------- Vincular MAC ↔ departamento ----------

interface CustomerOption { id: string; apartment: string; name: string }

export function LinkDialog({ router, mac, context, close, saved, restoreFocus }: {
  router: RouterEntry;
  mac: string;
  context: RoutersContext;
  close: () => void;
  saved: (message: string) => void;
  restoreFocus: () => void;
}) {
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

  const linked = detail?.router.devices?.find((d: { mac: string }) => d.mac === mac.toUpperCase());

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

  return (
    <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead title="Vincular dispositivo con departamento" description={`MAC: ${mac}. La asociación se conserva aunque cambie la IP.`} />
        <DialogBody>
          <p className="text-sm text-muted-foreground">Al guardar se sincroniza el control IPv4 del departamento y su límite de velocidad compartido en el MikroTik central. Retirar la vinculación solicita limpiar las reglas del dispositivo.</p>
          <form id="link-form" className="grid gap-4" onSubmit={submit} aria-busy={pending}>
            <FormField id="link-customer" label="Departamento">
              <NativeSelect id="link-customer" name="customer_id" defaultValue={(linked as { customer_id?: string } | undefined)?.customer_id || ''} disabled={pending || !detail}>
                <NativeSelectOption value="">Sin vinculación</NativeSelectOption>
                {reported ? (detail?.customers || []).map(c => <NativeSelectOption key={c.id} value={c.id}>{c.apartment} · {c.name}</NativeSelectOption>) : null}
              </NativeSelect>
            </FormField>
            {!reported && detail && <p className="text-sm text-muted-foreground">El dispositivo no aparece en la última consulta. Puedes retirar su vinculación.</p>}
            <FormError message={error} />
          </form>
        </DialogBody>
      <SubmitRow busy={pending} onClose={close} label="Guardar" form="link-form" submitDisabled={!detail} />
    </PendingDialog>
  );
}

// ---------- Descubrir en la red (MNDP + barrido de puertos) ----------

interface LanNeighbor { mac?: string | null; identity?: string | null; version?: string | null; platform?: string | null; board?: string | null; interface?: string | null; ips?: string[]; source?: string | null }

export function DiscoverLanDialog({ context, close, onUse, restoreFocus }: {
  context: RoutersContext;
  close: () => void;
  onUse: (preset: { host?: string; name?: string }) => void;
  restoreFocus: () => void;
}) {
  const [neighbors, setNeighbors] = useState<LanNeighbor[] | null>(null);
  const [candidates, setCandidates] = useState<{ ip: string; ports: number[] }[]>([]);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setScanning(true); setError('');
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

  return (
    <PendingDialog busy={false} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead title="Descubrir en la red" description="Anuncios MNDP verificados más candidatos por puerto abierto (8291/80/443). Elegir uno precarga el formulario, no lo registra." />
        <DialogBody>
          {error ? <FormError message={error} />
            : scanning && !neighbors?.length && !candidates.length ? <p className="text-sm text-muted-foreground">Escuchando la red (30 s, los anuncios salen cada ~30-60 s)…</p>
            : !neighbors?.length && !candidates.length ? (
              <div className="grid gap-3">
                <p className="text-sm text-muted-foreground">Sin equipos a la vista. Verifica que el servidor esté en el mismo dominio broadcast (modo puente en VirtualBox) y que el firewall permita UDP 5678 entrante.</p>
                <div><IconButton label="Buscar de nuevo" type="button" variant="outline" size="icon-sm" onClick={() => setRound(r => r + 1)}><RotateCcw aria-hidden="true" /></IconButton></div>
              </div>
            ) : (
              <div className="grid gap-4">
                {!!neighbors?.length && (
                  <DataTable dense variant="plain" headings={['Equipo (MNDP)', 'IP', 'MAC', 'Versión', 'Acción']} rows={neighbors.map((n, i) => (
                        <TableRow key={n.mac || `${n.identity}:${i}`}>
                          <TableCell><strong>{n.identity || 'Sin identidad'}</strong><br /><span className="text-muted-foreground">{[n.platform, n.board].filter(Boolean).join(' · ') || '—'}</span></TableCell>
                          <TableCell>{n.ips?.filter(ip => ip.includes('.')).join(', ') || n.source || '—'}</TableCell>
                          <TableCell>{n.mac || '—'}</TableCell>
                          <TableCell>{n.version || '—'}</TableCell>
                          <TableCell><IconButton label={`Usar ${n.ips?.find(ip => ip.includes('.')) || ''}`} tip="Usar este equipo" type="button" variant="outline" size="icon-sm" disabled={!n.ips?.some(ip => ip.includes('.'))} onClick={() => onUse({ host: n.ips?.find(ip => ip.includes('.')), name: n.identity || undefined })}><Check aria-hidden="true" /></IconButton></TableCell>
                        </TableRow>
                      ))} />
                )}
                {!!candidates.length && (
                  <DataTable dense variant="plain" headings={['Candidato (puertos)', 'IP', 'Puertos', 'Acción']} rows={candidates.map(c => (
                        <TableRow key={c.ip}>
                          <TableCell><span className="text-muted-foreground">Sin confirmar por MNDP</span></TableCell>
                          <TableCell><strong>{c.ip}</strong></TableCell>
                          <TableCell>{c.ports.join(', ')}</TableCell>
                          <TableCell><IconButton label={`Usar ${c.ip}`} tip="Usar este equipo" type="button" variant="outline" size="icon-sm" onClick={() => onUse({ host: c.ip })}><Check aria-hidden="true" /></IconButton></TableCell>
                        </TableRow>
                      ))} />
                )}
                <div><IconButton label={scanning ? 'Escuchando…' : 'Seguir buscando'} type="button" variant="outline" size="icon-sm" disabled={scanning} onClick={() => setRound(r => r + 1)}><RotateCcw aria-hidden="true" /></IconButton></div>
              </div>
            )}
        </DialogBody>
        <DialogActions><Button type="button" variant="outline" onClick={close}>Cerrar</Button></DialogActions>
    </PendingDialog>
  );
}

// ---------- Puesta en marcha inicial ----------

export function OnboardDialog({ context, close, onRegister, restoreFocus }: {
  context: RoutersContext;
  close: () => void;
  onRegister: (preset: { host?: string; name?: string }) => void;
  restoreFocus: () => void;
}) {
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

  return (
    <PendingDialog busy={pending} onClose={close} restoreFocus={restoreFocus}>
      <DialogHead title="Puesta en marcha inicial" description="Configura un MikroTik nuevo desde el sistema: identidad, IP de gestión, DNS, usuario de servicio y HTTPS. Necesita reachable por IP con credenciales actuales (clave vacía = fábrica). Lo ya aplicado se informa si algo falla." />
        <DialogBody>
          {!result ? (
            <form id="onboard-form" className="grid gap-4" aria-busy={pending} onSubmit={submit}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2"><label htmlFor="onboard-host" className="text-sm font-medium">IP actual del equipo</label><Input id="onboard-host" value={host} onChange={event => setHost(event.target.value)} required placeholder="192.168.88.1" disabled={pending} /></div>
                <div className="grid gap-2"><label htmlFor="onboard-user" className="text-sm font-medium">Usuario actual</label><Input id="onboard-user" value={username} onChange={event => setUsername(event.target.value)} maxLength={100} autoComplete="off" disabled={pending} /></div>
              </div>
              <div className="grid gap-2"><label htmlFor="onboard-pass" className="text-sm font-medium">Clave actual (vacía = fábrica)</label><Input id="onboard-pass" type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={256} autoComplete="off" disabled={pending} /></div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2"><label htmlFor="onboard-identity" className="text-sm font-medium">Identidad</label><Input id="onboard-identity" value={identity} onChange={event => setIdentity(event.target.value)} required maxLength={64} placeholder="edificio-norte-central" disabled={pending} /></div>
                <div className="grid gap-2"><label htmlFor="onboard-iface" className="text-sm font-medium">Interfaz de gestión</label><Input id="onboard-iface" value={iface} onChange={event => setIface(event.target.value)} maxLength={64} disabled={pending} /></div>
              </div>
              <div className="grid gap-2"><label htmlFor="onboard-address" className="text-sm font-medium">IP de gestión (/24)</label><Input id="onboard-address" value={newAddress} onChange={event => setNewAddress(event.target.value)} required placeholder="192.168.10.1/24" disabled={pending} /></div>
              <div className="grid gap-2"><label htmlFor="onboard-dns" className="text-sm font-medium">DNS (coma, opcional)</label><Input id="onboard-dns" value={dns} onChange={event => setDns(event.target.value)} maxLength={64} disabled={pending} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={setupHttps} onChange={event => setSetupHttps(event.target.checked)} disabled={pending} /> Configurar HTTPS con certificado local</label>
              <FormError message={error} />
            </form>
          ) : (
            <div className="grid gap-4">
              <Card><CardContent className="grid gap-2">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">✓ Equipo verificado en {result.managementIp}.</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.applied.map(a => <li key={a}>{a}</li>)}</ul>
                <p className="text-sm">Usuario de servicio: <strong>{result.serviceUsername}</strong> · Clave: <strong className="[overflow-wrap:anywhere]">{result.servicePassword}</strong>{result.https ? ` · HTTPS ${result.https.certificate}` : ''}</p>
                <p className="text-sm text-muted-foreground">Guarda estas credenciales y regístralo en NuweNet para administrarlo.</p>
              </CardContent></Card>
            </div>
          )}
        </DialogBody>
      {!result
        ? <SubmitRow busy={pending} onClose={close} form="onboard-form" label="Ejecutar puesta en marcha" busyLabel="Configurando…" />
        : <DialogActions><Button type="button" variant="outline" onClick={close}>Cerrar</Button><Button type="button" onClick={() => onRegister({ host: result.managementIp.split('/')[0], name: result.identity })}>Registrar en NuweNet</Button></DialogActions>}
    </PendingDialog>
  );
}
