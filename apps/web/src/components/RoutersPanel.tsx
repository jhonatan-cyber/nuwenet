/**
 * RoutersPanel — dispatcher de la sección de equipos de red.
 *
 * Este archivo solo orquesta estado maestro-detalle, carga de datos y
 * apertura de dialogs. Cada responsabilidad vive en su propio módulo:
 *
 *   RouterForm            → routers/RouterForm.tsx
 *   DeviceControlDialog   → routers/DeviceControlDialog.tsx
 *   ProvisionDialog       → routers/ProvisionDialog.tsx
 *   RouterDetailsView     → routers/RouterDetailsView.tsx
 *   Discovery dialogs     → routers/RouterDiscoveryDialogs.tsx
 */
import NetworkSetupWizard from './NetworkSetupWizard';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, Plus, Radar, Rocket, RotateCcw, Search, Server, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ListSkeleton } from '@/components/ui/skeleton';
import { PanelShell, StatusText } from '@/components/panel-shell';
import { getRouters, getServerRouters, subscribeRouters, type RouterEntry, type RouterAdapterInfo, type RoutersContext } from '@/features/routers-network/routers-store';
import { ConfirmDialog, useDialogFocus } from '@/components/shared/dialog';
import { BuildingTopology } from './operations/BuildingTopology';
import { RouterForm } from './routers/RouterForm';
import { DeviceControlDialog } from './routers/DeviceControlDialog';
import { ProvisionDialog } from './routers/ProvisionDialog';
import { RouterDetailsView } from './routers/RouterDetailsView';
import { TrafficDialog, DiscoverDialog, LinkDialog, DiscoverLanDialog, OnboardDialog } from './routers/RouterDiscoveryDialogs';
import { badgeFor, type Draft } from './routers/router-types';
import { IconButton } from '@/components/shared/icon-button';

// ---------- Vista principal ----------

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
  const [wizardBuilding, setWizardBuilding] = useState<string | null>(null);
  const detailHeading = useRef<HTMLDivElement>(null);
  const listTrigger = useRef<string | null>(null);
  const { capture, restore } = useDialogFocus();

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

  useEffect(() => {
    if (selectedId !== null) {
      detailHeading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else if (listTrigger.current !== null) {
      document.getElementById(`router-open-${listTrigger.current}`)?.focus();
    }
  }, [selectedId]);

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

  function open(next: Draft, button: HTMLButtonElement | null) { if (button) capture(button); setNotice(''); setDraft(next); }
  function close() { setDraft(undefined); }

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

  const buildingName = (id?: string | null) =>
    id ? (buildings.length ? buildings.find(b => b.id === id)?.name || `Edificio ${String(id).slice(0, 8)}` : `Edificio ${String(id).slice(0, 8)}`) : 'Sin edificio';

  const selected = routers.find(r => r.id === selectedId);
  const filtered = routers.filter(r =>
    [r.name, r.host, buildingName(r.building_id), adapters.find(a => a.id === r.adapter)?.name || r.adapter]
      .join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  const groups: { id: string | null; name: string; routers: typeof filtered }[] = [
    ...buildings.map(b => ({ id: b.id as string | null, name: b.name, routers: filtered.filter(r => r.building_id === b.id) })),
    { id: null, name: 'Sin edificio', routers: filtered.filter(r => !r.building_id) },
  ].filter(g => g.routers.length || !search.trim());

  if (wizard) return (
    <NetworkSetupWizard
      context={context}
      buildings={buildings}
      initialBuildingId={wizardBuilding}
      close={() => { setWizard(false); setWizardBuilding(null); }}
      onOpenRouter={id => { setWizard(false); setWizardBuilding(null); listTrigger.current = id; setNotice(''); setSelectedId(id); }}
    />
  );

  return (
    <PanelShell
      id="routers-panel"
      title={selected ? 'Detalle del equipo' : 'Equipos de red'}
      description={selected ? 'Información de la última consulta y administración del equipo.' : 'Encuentra un equipo y abre su ficha para consultar la información y administrar su conexión.'}
      actions={<>
        {selected
          ? <IconButton label="Volver a routers" type="button" variant="outline" size="icon-sm" onClick={() => setSelectedId(null)}><ArrowLeft aria-hidden="true" /></IconButton>
          : <>
            {context.canManage && <IconButton label="Configurar red del edificio" type="button" variant="outline" size="icon-sm" disabled={!loaded || !!loadError} onClick={() => setWizard(true)}><Settings aria-hidden="true" /></IconButton>}
            {context.canManage && <IconButton label="Puesta en marcha inicial" type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'onboard' }, event.currentTarget)}><Rocket aria-hidden="true" /></IconButton>}
            {context.canManage && <IconButton label="Descubrir en la red" type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'lan' }, event.currentTarget)}><Radar aria-hidden="true" /></IconButton>}
            {context.canManage && <IconButton label="Agregar router" type="button" variant="default" size="icon-sm" onClick={event => open({ type: 'form', router: null }, event.currentTarget)}><Plus aria-hidden="true" /></IconButton>}
          </>}
      </>}
    >
      <p role="status" className={notice ? 'text-sm text-muted-foreground' : 'sr-only'}>{notice}</p>

      {!loaded
        ? <Card><CardContent><div role="status" aria-label="Cargando conexiones…"><ListSkeleton rows={3} /></div></CardContent></Card>
        : loadError
        ? <Card><CardContent>
            <p className="text-sm text-destructive">{loadError}</p>
            <IconButton label="Reintentar" type="button" variant="outline" size="icon-sm" className="mt-2" onClick={() => { setLoaded(false); setLoadError(''); void reload().then(() => setLoaded(true)).catch(err => { setLoadError(err instanceof Error ? err.message : 'No se pudo cargar.'); setLoaded(true); }); }}><RotateCcw aria-hidden="true" /></IconButton>
          </CardContent></Card>
        : !routers.length
        ? <Card><CardContent className="grid gap-2"><span aria-hidden="true">⌘</span><strong>Conecta tu primer router</strong><p className="text-sm text-muted-foreground">Registra su IP de administración y selecciona el adaptador compatible.</p></CardContent></Card>
        : selected
        ? <div ref={detailHeading} tabIndex={-1} aria-label={`Ficha de ${selected.name}`} className="grid min-w-0 gap-4 outline-none">
            <RouterDetailsView
              router={selected}
              adapterName={adapters.find(a => a.id === selected.adapter)?.name || selected.adapter}
              buildingName={buildingName(selected.building_id)}
              checking={busy.has(selected.id) || !!selected.checking}
              canManage={context.canManage}
              context={context}
              onAction={open}
              onCheck={check}
              onChanged={async () => { try { await reload(); await context.refresh(); } catch { setNotice('No se pudo actualizar el listado.'); } }}
            />
            <Card><CardContent className="grid gap-2">
              <h2 className="text-sm font-semibold">Compatibilidad del equipo</h2>
              <p className="text-sm text-muted-foreground">{adapters.find(a => a.id === selected.adapter)?.requirements || 'No hay información adicional para este adaptador.'}</p>
            </CardContent></Card>
          </div>
        : <div className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid w-full gap-2 sm:max-w-sm">
                <label htmlFor="router-search" className="text-sm font-medium">Buscar router</label>
                <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input id="router-search" className="pl-9" placeholder="Nombre, IP o edificio" value={search} onChange={event => setSearch(event.target.value)} /></div>
              </div>
              <p className="text-sm text-muted-foreground" role="status">{filtered.length} de {routers.length} routers</p>
            </div>
            {filtered.length || groups.some(g => g.id !== null) ? groups.map(group => (
              <section key={group.id ?? 0} aria-label={group.id ? `Edificio ${group.name}` : 'Sin edificio'} className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">{group.id ? group.name : 'Sin edificio'}</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">{group.routers.length} equipo{group.routers.length === 1 ? '' : 's'}</span>
                    {context.canManage && group.id !== null && <IconButton label={`Configurar red de ${group.name}`} type="button" variant="outline" size="icon-sm" disabled={!loaded || !!loadError} onClick={() => { setWizardBuilding(group.id); setWizard(true); }}><Settings aria-hidden="true" /></IconButton>}
                    {context.canManage && <IconButton label={group.id ? `Agregar en ${group.name}` : 'Agregar router'} type="button" variant="outline" size="icon-sm" onClick={event => open({ type: 'form', router: null, preset: group.id ? { building_id: group.id } : undefined }, event.currentTarget)}><Plus aria-hidden="true" /></IconButton>}
                  </div>
                </div>
                {group.id !== null && (
                  <details className="rounded-xl border bg-card p-4">
                    <summary className="cursor-pointer text-sm font-medium">Ver topología del edificio</summary>
                    <div className="pt-3"><BuildingTopology buildingId={group.id} context={context} onSelectRouter={id => { listTrigger.current = id; setNotice(''); setSelectedId(id); }} /></div>
                  </details>
                )}
                {group.routers.length
                  ? <div className="overflow-hidden rounded-xl border bg-card divide-y">
                      {group.routers.map(router => (
                        <div key={router.id} className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="rounded-lg bg-muted p-2.5"><Server className="size-5" aria-hidden="true" /></span>
                            <div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{router.name}</h3><p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{buildingName(router.building_id)}</p></div>
                          </div>
                          <div className="min-w-0 text-sm">
                            <p className="[overflow-wrap:anywhere]">{router.host}:{router.port}</p>
                            <p className="text-muted-foreground">{adapters.find(a => a.id === router.adapter)?.name || router.adapter}</p>
                            <StatusText tone={router.last_error ? 'danger' : 'default'} className="text-xs">{badgeFor(router, busy.has(router.id) || !!router.checking)}</StatusText>
                          </div>
                          <IconButton label={`Ver router ${router.name}`} type="button" variant="outline" size="icon-sm" id={`router-open-${router.id}`} onClick={() => { listTrigger.current = router.id; setNotice(''); setSelectedId(router.id); }}><ArrowRight aria-hidden="true" /></IconButton>
                        </div>
                      ))}
                    </div>
                  : <p className="text-sm text-muted-foreground">Sin equipos registrados en este edificio.</p>}
              </section>
            )) : (
              <Card><CardContent className="grid gap-3 py-6">
                <p className="text-sm text-muted-foreground">No hay routers que coincidan con la búsqueda.</p>
                <IconButton label="Limpiar búsqueda" type="button" variant="outline" size="icon-sm" onClick={() => setSearch('')}><X aria-hidden="true" /></IconButton>
              </CardContent></Card>
            )}
          </div>}

      {/* Dialogs — solo el activo se monta */}
      {draft?.type === 'form' && <RouterForm router={draft.router} preset={draft.preset} adapters={adapters} buildings={buildings} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
      {draft?.type === 'lan' && <DiscoverLanDialog context={context} close={close} restoreFocus={restore} onUse={preset => setDraft({ type: 'form', router: null, preset })} />}
      {draft?.type === 'onboard' && <OnboardDialog context={context} close={close} restoreFocus={restore} onRegister={preset => setDraft({ type: 'form', router: null, preset })} />}
      {draft?.type === 'control' && <DeviceControlDialog router={draft.router} preset={{ action: draft.action, ip: draft.ip }} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
      {draft?.type === 'provision' && <ProvisionDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
      {draft?.type === 'traffic' && <TrafficDialog router={draft.router} context={context} close={close} restoreFocus={restore} />}
      {draft?.type === 'discover' && <DiscoverDialog router={draft.router} context={context} onLink={mac => setDraft({ type: 'link', router: draft.router, mac })} close={close} restoreFocus={restore} />}
      {draft?.type === 'link' && <LinkDialog router={draft.router} mac={draft.mac} context={context} close={close} saved={m => { void saved(m); }} restoreFocus={restore} />}
      {draft?.type === 'remove' && <ConfirmDialog title="Quitar conexión" message={`¿Quitar ${draft.router.name} del sistema? No modifica el equipo. Esta acción no se puede deshacer.`} confirmLabel="Quitar" onConfirm={() => remove(draft.router.id)} close={close} restoreFocus={restore} />}
      {draft?.type === 'toggle' && <ConfirmDialog title={draft.router.disabled ? 'Activar router' : 'Deshabilitar router'} message={draft.router.disabled ? `¿Activar ${draft.router.name}?` : `¿Deshabilitar ${draft.router.name}? No se podrá consultar ni aplicar acciones hasta reactivarlo.`} confirmLabel={draft.router.disabled ? 'Activar' : 'Deshabilitar'} onConfirm={() => toggle(draft.router)} close={close} restoreFocus={restore} />}
    </PanelShell>
  );
}

export default function RoutersPanel() {
  const state = useSyncExternalStore(subscribeRouters, getRouters, getServerRouters);
  return state.visible && state.context ? <RoutersView key={state.context.userId} context={state.context} /> : null;
}
