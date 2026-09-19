import { useState } from 'react';
import { Activity, Link2, Pencil, Power, Radar, Server, SlidersHorizontal, Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { TableCell, TableRow } from '@/components/ui/table';
import { DataTable } from '@/components/shared/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FormError, StatusText } from '@/components/panel-shell';
import type { RouterEntry, RouterClient, RoutersContext } from '@/features/routers-network/routers-store';
import { capNames, arrisCapNames, detailValue, badgeFor, managementLevel, type Op } from './router-types';
import { DeviceButtons } from './DeviceControlDialog';
import type { Draft } from './router-types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Facts (lista clave/valor) ----------

function Facts({ items }: { items: [string, unknown][] }) {
  return (
    <dl className="grid gap-1 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-2">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd>{detailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Botón vincular MAC ↔ departamento ----------

export function LinkButton({ router, mac, onLink }: {
  router: RouterEntry;
  mac?: string | null;
  onLink: (mac: string) => void;
}) {
  if (!mac || router.disabled) return null;
  const linked = router.devices?.find(d => d.mac.toUpperCase() === mac.toUpperCase());
  const label = linked ? linked.apartment : 'Vincular departamento';
  return (
    <IconButton label={`${label} · ${mac}`} tip={<>{label} · {mac}</>} type="button" variant="outline" size="icon-sm" onClick={() => onLink(mac)}><Link2 aria-hidden="true" /></IconButton>
  );
}

// ---------- Detalles de conexión (WAN, LAN, Wi-Fi, clientes) ----------

function ConnectionDetails({ router, canManage, onControl, onLink }: {
  router: RouterEntry;
  canManage: boolean;
  onControl: (op: Op, ip: string) => void;
  onLink: (mac: string) => void;
}) {
  const snapshot = router.snapshot;
  if (!snapshot) return null;
  return (
    <div className="grid gap-3">
      {(snapshot.hardware || snapshot.serial) && <Facts items={[['Hardware', snapshot.hardware], ['Número de serie', snapshot.serial]]} />}
      {snapshot.wan && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Conexión a internet (WAN)</summary>
          <Facts items={[['Tipo', snapshot.wan.connection], ['IP', snapshot.wan.ip], ['Máscara', snapshot.wan.subnet], ['Puerta de enlace', snapshot.wan.gateway], ['MAC', snapshot.wan.mac], ['DNS', snapshot.wan.dns?.join(', ')]]} />
        </details>
      )}
      {snapshot.lan && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Red local (LAN)</summary>
          <Facts items={[['IP del router', snapshot.lan.ip], ['Máscara', snapshot.lan.subnet], ['Servidor DHCP', snapshot.lan.dhcp], ['Clientes LAN reportados', snapshot.lan.clients]]} />
        </details>
      )}
      {snapshot.wireless?.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Redes Wi-Fi</h3>
          {snapshot.wireless.map((w: { band: string; ssid?: string | null; channel?: unknown; mode?: unknown; mac?: unknown; clients?: unknown }) => (
            <div key={w.band}>
              <strong className="text-sm">{w.band}</strong>
              <Facts items={[['Red (SSID)', w.ssid], ['Canal', w.channel], ['Modo', w.mode], ['MAC', w.mac], ['Clientes reportados', w.clients]]} />
            </div>
          ))}
        </div>
      ) : null}
      {Array.isArray(snapshot.clients) && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Dispositivos reportados ({snapshot.clients.length})</h3>
          <p className="text-sm text-muted-foreground">Datos de la última consulta; la presencia en esta lista no confirma conectividad en tiempo real. Pulsa «Probar conexión» para actualizar. Usa los iconos para suspender, reactivar, limitar velocidad, filtrar o programar horario.</p>
          {snapshot.clients.length ? (
            <DataTable dense variant="plain" headings={['Dispositivo', 'IP', 'MAC', 'Conexión', 'Estado', 'Departamento', 'Acciones']} rows={snapshot.clients.map((c: RouterClient, i: number) => (
                  <TableRow key={`${c.mac || c.ip || i}`}>
                    <TableCell>{detailValue(c.name)}</TableCell>
                    <TableCell>
                      {detailValue(c.ip)}
                      {(c.addresses || []).filter((ip: string) => ip !== c.ip).length ? (
                        <details>
                          <summary className="cursor-pointer text-xs">Otras IP ({(c.addresses || []).filter((ip: string) => ip !== c.ip).length})</summary>
                          {(c.addresses || []).filter((ip: string) => ip !== c.ip).map((ip: string) => <small key={ip} className="block">{ip}</small>)}
                        </details>
                      ) : null}
                    </TableCell>
                    <TableCell>{detailValue(c.mac)}</TableCell>
                    <TableCell>{detailValue(c.connection)}</TableCell>
                    <TableCell>{detailValue(c.status)}</TableCell>
                    <TableCell><LinkButton router={router} mac={c.mac} onLink={onLink} /></TableCell>
                    <TableCell><DeviceButtons router={router} client={c} canManage={canManage} onControl={onControl} /></TableCell>
                  </TableRow>
                ))} />
          ) : <p className="text-sm text-muted-foreground">El router no devolvió dispositivos en esta consulta.</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Puertos ethernet (switch) ----------

function SwitchPorts({ router, context, onChanged }: {
  router: RouterEntry;
  context: RoutersContext;
  onChanged: () => Promise<void>;
}) {
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

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">Puertos ethernet</h3>
      <p className="text-sm text-muted-foreground">Habilita o deshabilita puertos físicos con verificación. Útil para aislar un tramo sin desconectar cables.</p>
      <DataTable dense variant="plain" headings={['Puerto', 'Enlace', 'Administración', 'Acción']} rows={(router.snapshot?.interfaces || []).map((i: { name: string; state: string; disabled?: boolean }) => (
            <TableRow key={i.name}>
              <TableCell>{i.name}</TableCell>
              <TableCell>{i.state}</TableCell>
              <TableCell>{i.disabled ? 'Deshabilitado' : 'Habilitado'}</TableCell>
              <TableCell>
                <IconButton label={`${i.disabled ? 'Habilitar' : 'Deshabilitar'} puerto ${i.name}`} tip={busy === i.name ? 'Aplicando…' : `${i.disabled ? 'Habilitar' : 'Deshabilitar'} puerto ${i.name}`} type="button" variant="outline" size="icon-sm" disabled={busy !== null} onClick={() => { void toggle(i.name, !i.disabled); }}>{busy === i.name ? <Activity aria-hidden="true" className="animate-pulse" /> : <Power aria-hidden="true" />}</IconButton>
              </TableCell>
            </TableRow>
          ))} />
      {error && <FormError message={error} />}
    </div>
  );
}

// ---------- Tarjeta de detalle del router ----------

export function RouterDetailsView({ router, adapterName, buildingName, checking, canManage, context, onAction, onCheck, onChanged }: {
  router: RouterEntry;
  adapterName: string;
  buildingName: string;
  checking: boolean;
  canManage: boolean;
  context: RoutersContext;
  onAction: (draft: Draft, button: HTMLButtonElement) => void;
  onCheck: (id: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const snapshot = router.snapshot;
  const labels = router.adapter === 'arris-touchstone' ? arrisCapNames : capNames;

  return (
    <Card data-router-id={router.id} className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{router.name}</h2>
            <p className="text-sm text-muted-foreground">{adapterName}{buildingName ? ` · ${buildingName}` : ''}</p>
            <Badge className="w-fit" variant={managementLevel(router).destructive ? 'outline-destructive' : 'outline'}>{managementLevel(router).label}</Badge>
          </div>
          <StatusText className="text-sm">{badgeFor(router, checking)}</StatusText>
        </div>
      </CardHeader>

      {canManage ? (
        <CardFooter className="flex flex-wrap gap-2">
          {!router.disabled && <IconButton label={checking ? 'Consultando…' : `Probar conexión · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={() => { void onCheck(router.id); }}><Activity aria-hidden="true" /></IconButton>}
          {!router.disabled && router.adapter === 'mikrotik-rest' && <IconButton label={`Aprovisionar puertos y permisos · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={event => onAction({ type: 'provision', router }, event.currentTarget)}><Server aria-hidden="true" /></IconButton>}
          {!router.disabled && router.capabilities?.suspend && <IconButton label={`Controlar dispositivo · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={event => onAction({ type: 'control', router }, event.currentTarget)}><SlidersHorizontal aria-hidden="true" /></IconButton>}
          <IconButton label={`${router.disabled ? 'Activar' : 'Desactivar'} · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={event => onAction({ type: 'toggle', router }, event.currentTarget)}><Power aria-hidden="true" /></IconButton>
          <IconButton label={`Editar · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={event => onAction({ type: 'form', router }, event.currentTarget)}><Pencil aria-hidden="true" /></IconButton>
          <IconButton label={`Quitar conexión · ${router.name}`} type="button" variant="outline" size="icon-sm" disabled={checking} onClick={event => onAction({ type: 'remove', router }, event.currentTarget)}><Trash aria-hidden="true" /></IconButton>
        </CardFooter>
      ) : (
        <CardContent><p className="text-sm text-muted-foreground">🔒 Solo el super-admin configura routers y aplica acciones de red.</p></CardContent>
      )}

      <CardContent className="grid gap-5 [overflow-wrap:anywhere]">
        <h3 className="text-sm font-semibold">Información del equipo</h3>
        <p className="text-sm">
          <strong>{router.protocol}://{router.host}:{router.port}</strong><br />
          {snapshot ? (
            <>
              {snapshot.manufacturer} · {snapshot.model || 'Modelo no identificado'}<br />
              Firmware: {snapshot.firmware || 'Sin dato'}<br />
              {snapshot.wan_status ? <>Enlace: {snapshot.wan_status}<br /></> : null}
              {snapshot.uptime ? <>Tiempo activo: {snapshot.uptime}<br /></> : null}
            </>
          ) : 'Prueba la conexión para obtener información del equipo.'}<br />
          <span className="text-muted-foreground">
            Credenciales guardadas con cifrado · {router.last_checked ? `Última consulta: ${new Date(router.last_checked).toLocaleString('es')}` : 'Todavía no se ha consultado'}
          </span>
        </p>

        {router.diagnostic_host && <Facts items={[['IP de diagnóstico', router.diagnostic_host]]} />}

        <ConnectionDetails
          router={router}
          canManage={canManage}
          onControl={(op, ip) => onAction({ type: 'control', router, action: op, ip }, document.activeElement as HTMLButtonElement)}
          onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)}
        />

        {router.devices?.length ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Dispositivos vinculados ({router.devices.length})</summary>
            <p className="text-sm text-muted-foreground">El control automático del departamento incluye estas MAC y su IP de servicio. Requiere un MikroTik central y una consulta correcta de las IP actuales. El plan de velocidad se comparte entre sus dispositivos.</p>
            <DataTable dense variant="plain" headings={['MAC', 'Departamento', 'Última IP reportada', 'Acción']} rows={router.devices.map((d: { mac: string; apartment: string; archived?: number; customer_id?: string }) => (
                  <TableRow key={d.mac}>
                    <TableCell>{d.mac}</TableCell>
                    <TableCell>{d.apartment}{d.archived ? ' (archivado)' : ''}</TableCell>
                    <TableCell>{snapshot?.clients?.find((c: RouterClient) => c.mac?.toUpperCase() === d.mac)?.ip || 'No aparece en la última consulta'}</TableCell>
                    <TableCell><LinkButton router={router} mac={d.mac} onLink={mac => onAction({ type: 'link', router, mac }, document.activeElement as HTMLButtonElement)} /></TableCell>
                  </TableRow>
                ))} />
          </details>
        ) : <p className="text-sm text-muted-foreground">Sin dispositivos vinculados a este equipo.</p>}

        {router.last_error && <FormError message={router.last_error} />}

        <div className="flex flex-wrap gap-2">
          {Object.entries(router.capabilities || {}).map(([name, supported]) => (
            <span key={name} className="text-xs">
              {supported ? '✓' : '—'} {labels[name]}
              {supported ? '' : router.adapter === 'arris-touchstone' && name === 'speed_limit' ? ' · no disponible en este firmware' : ' · no implementado'}
            </span>
          ))}
        </div>

        {snapshot?.interfaces?.length ? (
          <DataTable dense variant="plain" headings={['Interfaz', 'Estado', 'Enlace']} rows={snapshot.interfaces.map((i: { name: string; state: string; speed?: string }) => <TableRow key={i.name}><TableCell>{i.name}</TableCell><TableCell>{i.state}</TableCell><TableCell>{i.speed || '—'}</TableCell></TableRow>)} />
        ) : null}

        {snapshot?.blocked?.length ? <p className="text-sm"><strong>{router.adapter === 'arris-touchstone' ? 'IP con bloqueo TCP/UDP' : 'IP bloqueadas'} ({snapshot.blocked.length}):</strong> {snapshot.blocked.join(', ')}</p> : null}
        {snapshot?.speedLimits?.length ? (
          <DataTable dense variant="plain" headings={['IP con límite', 'max-limit']} rows={snapshot.speedLimits.map((q: { ip: string; maxLimit: string }) => <TableRow key={q.ip}><TableCell>{q.ip}</TableCell><TableCell>{q.maxLimit}</TableCell></TableRow>)} />
        ) : null}
        {snapshot?.firewallBlocks?.length ? <p className="text-sm"><strong>Destinos bloqueados ({snapshot.firewallBlocks.length}):</strong> {snapshot.firewallBlocks.map((b: { ip: string; target: string }) => `${b.ip} → ${b.target}`).join(', ')}</p> : null}
        {snapshot?.parental?.length ? <p className="text-sm"><strong>Horarios parentales ({snapshot.parental.length}):</strong> {snapshot.parental.map((p: { ip: string; schedule: string }) => `${p.ip} (${p.schedule})`).join(', ')}</p> : null}
        {typeof snapshot?.leases === 'number' && <p className="text-sm text-muted-foreground">Leases DHCP vistos: {snapshot.leases}. Pulsa «Probar conexión» para actualizar bloqueos y colas.</p>}
        {(snapshot?.notes || []).map((note: string, i: number) => <p key={i} className="text-sm text-muted-foreground">{note}</p>)}

        {router.adapter === 'mikrotik-rest' && !router.disabled && (
          <div className="flex flex-wrap gap-2">
            <IconButton label={`Tráfico en vivo · ${router.name}`} type="button" variant="outline" size="icon-sm" onClick={event => onAction({ type: 'traffic', router }, event.currentTarget)}><Activity aria-hidden="true" /></IconButton>
            <IconButton label={`Descubrir dispositivos · ${router.name}`} type="button" variant="outline" size="icon-sm" onClick={event => onAction({ type: 'discover', router }, event.currentTarget)}><Radar aria-hidden="true" /></IconButton>
          </div>
        )}

        {canManage && router.capabilities?.switch_ports && !router.disabled && !!router.snapshot?.interfaces?.length && (
          <SwitchPorts router={router} context={context} onChanged={onChanged} />
        )}
      </CardContent>
    </Card>
  );
}
