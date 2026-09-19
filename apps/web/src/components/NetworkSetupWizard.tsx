import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Cable, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Save, Server, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardHeader } from './ui/card';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { FormError, PanelShell } from './panel-shell';
import NetworkTopologyMap from './NetworkTopologyMap';
import type { RoutersContext } from '@/features/routers-network/routers-store';
import { IconButton } from '@/components/shared/icon-button';

type Role = 'provider' | 'central' | 'switch' | 'access';
type Node = { id: string; name: string; role: Role; host?: string; model?: string; router_id?: string; customer_id?: string };
type Link = { from: string; to: string; from_port: string; to_port: string };
type Service = { customer_id: string; vlan?: number; ssid?: string; wifi_password?: string };
type Design = { nodes: Node[]; links: Link[]; services: Service[] };
type Equipment = { id: string; name: string; host: string; model?: string; adapter: string; compatibility: string; status: string; features: { inspection: boolean; central: boolean; vlan: boolean; switch_ports: boolean; wifi: boolean } };
type Data = { revision: number; design: Design; published_at: string | null; equipment: Equipment[]; customers: { id: string; apartment: string; name: string; plan_name: string | null; ip: string | null; down: number | null; up: number | null }[] };
type Review = { revision: number; fingerprint: string; can_apply: boolean; blocked: string[]; warnings: string[]; steps: string[] };
const roles: Record<Role, string> = { provider: 'Entrada del proveedor', central: 'Control central', switch: 'Switch de distribución', access: 'Router / AP del departamento' };
const compatibility: Record<string, string> = { full: 'Administración completa', partial: 'Administración parcial', read_only: 'Solo consulta', unavailable: 'No disponible' };
const steps = ['Edificio', 'Equipos', 'Conexiones', 'Departamentos', 'Revisar y aplicar'];
const blank = (): Design => ({ nodes: [], links: [], services: [] });

export default function NetworkSetupWizard({ context, buildings, initialBuildingId, close, onOpenRouter }: { context: RoutersContext; buildings: { id: string; name: string }[]; initialBuildingId?: string | null; close: () => void; onOpenRouter?: (routerId: string) => void }) {
  const [building, setBuilding] = useState(initialBuildingId || '');
  const [data, setData] = useState<Data | null>(null);
  const [design, setDesign] = useState<Design>(blank);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const sending = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setData(null); setReview(null); setDesign(blank()); setError(''); setNotice(''); setStep(0);
    if (building) {
      setPending(true);
      context.request(`building-networks/${building}`).then(result => { if (!cancelled) { setData(result); setDesign(result.design); setDirty(false); } }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setPending(false); });
    }
    return () => { cancelled = true; };
  }, [building]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function change(next: Design) { setDesign(next); setDirty(true); setReview(null); setNotice(''); }
  function nodeChange(id: string, patch: Partial<Node>) { change({ ...design, nodes: design.nodes.map(node => node.id === id ? { ...node, ...patch } : node) }); }
  function template() {
    if (!data) return;
    const central = data.equipment.find(e => e.features.central);
    const nodes: Node[] = [
      { id: 'provider', name: 'Router del proveedor', role: 'provider' },
      { id: 'central', name: central?.name || 'MikroTik central', role: 'central', router_id: central?.id },
      { id: 'switch', name: 'Switch de distribución', role: 'switch' },
      ...data.customers.map(c => ({ id: `access-${c.id}`, name: `Router departamento ${c.apartment}`, role: 'access' as Role, customer_id: c.id })),
    ];
    const links: Link[] = [
      { from: 'provider', to: 'central', from_port: 'LAN1', to_port: 'ether1' },
      { from: 'central', to: 'switch', from_port: 'ether2', to_port: '1' },
      ...data.customers.map((c, i) => ({ from: 'switch', to: `access-${c.id}`, from_port: String(i + 2), to_port: 'WAN' })),
    ];
    change({ nodes, links, services: [] });
    setNotice('Estructura propuesta. Confirma los modelos, conexiones y puertos reales antes de aplicar.');
  }
  async function run(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setPending(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { sending.current = false; setPending(false); }
  }
  // La clave Wi-Fi nunca viaja al servidor: se conserva solo en esta pantalla y
  // se pedirá al aplicar cuando un adaptador verificado la admita.
  const persisted = (next: Design): Design => ({ ...next, services: next.services.map(({ wifi_password, ...service }) => service) });
  async function save() {
    if (!data) return;
    const passwords = new Map(design.services.filter(s => s.wifi_password).map(s => [s.customer_id, s.wifi_password] as const));
    const result = await context.request(`building-networks/${building}`, { ...persisted(design), revision: data.revision });
    setData(result);
    setDesign({ ...result.design, services: result.design.services.map((s: Service) => (passwords.has(s.customer_id) ? { ...s, wifi_password: passwords.get(s.customer_id) } : s)) });
    setDirty(false); setNotice('Borrador guardado. Aún no se ha modificado la red.');
  }
  async function inspectReview() {
    if (dirty || !data?.revision) await save();
    const result = await context.request(`building-networks/${building}/review`);
    setReview(result); setStep(4);
  }
  const patchService = (id: string, patch: Partial<Service>) => {
    const current = design.services.find(s => s.customer_id === id) || { customer_id: id };
    const next = { ...current, ...patch };
    change({ ...design, services: [...design.services.filter(s => s.customer_id !== id), ...(next.vlan || next.ssid || next.wifi_password ? [next] : [])] });
  };
  return <PanelShell title="Configurar red del edificio" description="Organiza equipos y conexiones, comprueba la compatibilidad y revisa los cambios antes de aplicar."
    actions={<IconButton label="Volver a equipos" variant="outline" size="icon-sm" disabled={pending || dirty} onClick={close}><ArrowLeft aria-hidden="true" /></IconButton>}>
    <ol className="grid gap-2 sm:grid-cols-5" aria-label="Pasos de configuración">{steps.map((label, index) => <li key={label}><Button className="h-auto w-full justify-start whitespace-normal py-3" variant={step === index ? 'default' : 'outline'} aria-current={step === index ? 'step' : undefined} disabled={pending || (index > 0 && !data)} onClick={() => index === 4 ? void run(inspectReview) : setStep(index)}>{index + 1}. {label}</Button></li>)}</ol>
    <FormError message={error} />
    <p role="status" className="text-sm text-muted-foreground">{pending ? 'Procesando…' : notice}</p>
    {step === 0 && <Card><CardContent className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Edificio<NativeSelect aria-label="Edificio" value={building} disabled={pending || dirty} onChange={event => setBuilding(event.target.value)}><NativeSelectOption value="">Selecciona un edificio</NativeSelectOption>{buildings.map(b => <NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>)}</NativeSelect></label>
      {!buildings.length && <p className="text-sm text-muted-foreground">Primero registra un edificio en Edificios y accesos.</p>}
      <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed">Proveedor → MikroTik → Switch → Departamentos. Puedes añadir varios switches y equipos de distintas marcas. Registra las conexiones administradas desde Equipos de red; aquí también puedes incluir equipos sin integración.</div>
      {data && <p className="text-sm text-muted-foreground">{data.equipment.length} conexiones administradas · {data.customers.length} departamentos. {data.published_at ? `Última publicación: ${new Date(data.published_at).toLocaleString('es')}.` : 'Diseño aún no publicado.'}</p>}
    </CardContent></Card>}
    {data && step === 1 && <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Inventario del edificio</h2><IconButton label="Añadir equipo al diseño" variant="outline" size="icon-sm" disabled={pending} onClick={() => change({ ...design, nodes: [...design.nodes, { id: crypto.randomUUID(), name: '', role: 'switch' }] })}><Plus aria-hidden="true" /></IconButton></div>
      {!design.nodes.length && <Card><CardContent className="grid gap-3"><p className="text-sm text-muted-foreground">Añade los equipos o comienza con una estructura propuesta para los departamentos registrados. Confirma el cableado y los modelos reales.</p><IconButton label="Crear estructura inicial" variant="outline" size="icon-sm" disabled={pending || data.customers.length > 247} onClick={template}><Sparkles aria-hidden="true" /></IconButton></CardContent></Card>}
      {design.nodes.map((node, i) => { const equipment = data.equipment.find(e => e.id === node.router_id); return <Card key={node.id}><CardHeader className="flex flex-row items-center justify-between"><h3 className="flex items-center gap-2 font-medium"><Server className="size-4" />Equipo {i + 1}</h3><Button variant="ghost" size="icon" disabled={pending} aria-label={`Retirar equipo ${i + 1}`} onClick={() => change({ ...design, nodes: design.nodes.filter(n => n.id !== node.id), links: design.links.filter(l => l.from !== node.id && l.to !== node.id) })}><Trash2 /></Button></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">Nombre<Input value={node.name} maxLength={100} disabled={pending} onChange={e => nodeChange(node.id, { name: e.target.value })} /></label>
        <label className="grid gap-2 text-sm">Función<NativeSelect aria-label="Función" value={node.role} disabled={pending} onChange={e => nodeChange(node.id, { role: e.target.value as Role, customer_id: undefined })}>{Object.entries(roles).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>
        <label className="grid gap-2 text-sm">Conexión administrada<NativeSelect aria-label="Conexión administrada" value={node.router_id || ''} disabled={pending} onChange={e => { const selected = data.equipment.find(r => r.id === e.target.value); nodeChange(node.id, { router_id: selected?.id, ...(selected ? { name: selected.name, host: selected.host, model: selected.model || '' } : {}) }); }}><NativeSelectOption value="">Sin integración · solo inventario</NativeSelectOption>{data.equipment.map(r => <NativeSelectOption key={r.id} value={r.id}>{r.name} · {r.host}</NativeSelectOption>)}</NativeSelect></label>
        <label className="grid gap-2 text-sm">Marca y modelo<Input disabled={pending || !!equipment} value={equipment?.model || node.model || ''} maxLength={100} onChange={e => nodeChange(node.id, { model: e.target.value })} /></label>
        <label className="grid gap-2 text-sm">IP de administración (opcional)<Input disabled={pending || !!equipment} value={equipment?.host || node.host || ''} onChange={e => nodeChange(node.id, { host: e.target.value || undefined })} placeholder="192.168.1.1" /></label>
        {node.role === 'access' && <label className="grid gap-2 text-sm">Departamento<NativeSelect aria-label="Departamento" value={node.customer_id || ''} disabled={pending} onChange={e => nodeChange(node.id, { customer_id: e.target.value || undefined })}><NativeSelectOption value="">Selecciona un departamento</NativeSelectOption>{data.customers.map(c => <NativeSelectOption key={c.id} value={c.id}>{c.apartment} · {c.name}</NativeSelectOption>)}</NativeSelect></label>}
        <div className="rounded-md bg-muted p-3 text-sm sm:col-span-2"><strong>{equipment ? (compatibility[equipment.compatibility] || equipment.compatibility) : 'Sin integración compatible'}</strong><p className="mt-1 text-muted-foreground">{equipment?.features.central ? 'Admite consulta y control central del servicio. ' : equipment?.features.inspection ? 'Admite consulta del equipo. ' : 'Se conserva en el inventario. '}{equipment?.features.switch_ports ? 'Sus puertos ethernet se administran desde su ficha. ' : ''}Configuración automática de VLAN y Wi-Fi no disponible.</p></div>
      </CardContent></Card>; })}
    </div>}
    {data && step === 2 && <div className="grid gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Conexiones entre equipos</h2><IconButton label="Añadir conexión" variant="outline" size="icon-sm" disabled={pending || design.nodes.length < 2} onClick={() => change({ ...design, links: [...design.links, { from: design.nodes[0].id, to: design.nodes[1].id, from_port: '', to_port: '' }] })}><Cable aria-hidden="true" /></IconButton></div><p className="text-sm text-muted-foreground">Indica el cableado físico. Cada puerto puede usarse una vez. Esto documenta la conexión; no configura VLAN ni modifica los puertos.</p>
      {!!design.nodes.length && <Card><CardContent className="grid gap-2"><h3 className="text-sm font-semibold">Mapa del cableado (borrador)</h3><NetworkTopologyMap nodes={design.nodes} links={design.links} equipment={data.equipment.map(e => ({ id: e.id, status: e.status, compatibility: e.compatibility }))} customers={data.customers.map(c => ({ id: c.id, apartment: c.apartment }))} interactive onSelectRouter={onOpenRouter} /></CardContent></Card>}
      {design.links.map((link, i) => <Card key={i}><CardContent className="grid gap-4 sm:grid-cols-2">{(['from', 'to'] as const).map(side => <div key={side} className="grid gap-3"><label className="grid gap-2 text-sm">{side === 'from' ? 'Desde' : 'Hacia'}<NativeSelect aria-label={side === 'from' ? 'Desde' : 'Hacia'} disabled={pending} value={link[side]} onChange={e => change({ ...design, links: design.links.map((l, j) => j === i ? { ...l, [side]: e.target.value } : l) })}>{design.nodes.map(n => <NativeSelectOption key={n.id} value={n.id}>{n.name || roles[n.role]}</NativeSelectOption>)}</NativeSelect></label><label className="grid gap-2 text-sm">{side === 'from' ? 'Puerto de salida' : 'Puerto de entrada'}<Input value={link[`${side}_port`]} maxLength={60} disabled={pending} placeholder={side === 'from' ? 'ether2 / puerto 5' : 'ether1 / WAN'} onChange={e => change({ ...design, links: design.links.map((l, j) => j === i ? { ...l, [`${side}_port`]: e.target.value } : l) })} /></label></div>)}<IconButton label={`Retirar conexión ${i + 1}`} tip="Retirar conexión" variant="ghost" size="icon-sm" disabled={pending} onClick={() => change({ ...design, links: design.links.filter((_, j) => i !== j) })}><Trash2 aria-hidden="true" /></IconButton></CardContent></Card>)}
      {!design.links.length && <p className="rounded-lg border p-6 text-sm text-muted-foreground">Aún no hay conexiones. Añade el enlace del proveedor al central y continúa hacia los departamentos.</p>}
    </div>}
    {data && step === 3 && <div className="grid gap-4"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Servicio de los departamentos</h2><div className="grid w-full gap-2 sm:max-w-xs"><label htmlFor="service-search" className="text-sm font-medium">Buscar departamento</label><Input id="service-search" placeholder="Departamento o titular" value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} /></div></div><p className="text-sm text-muted-foreground">Los planes e IP se administran en Departamentos. VLAN y nombre Wi-Fi se guardan como pendientes y bloquean la aplicación hasta disponer de integración compatible. La clave Wi-Fi no se guarda en el servidor: vive solo en esta pantalla.</p>
      {data.customers.filter(c => `${c.apartment} ${c.name}`.toLocaleLowerCase().includes(serviceSearch.trim().toLocaleLowerCase())).map(c => { const service = design.services.find(s => s.customer_id === c.id); return <Card key={c.id}><CardContent className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><h3 className="font-semibold">Departamento {c.apartment}</h3><p className="text-sm text-muted-foreground">{c.plan_name || 'Sin plan'} · {c.ip || 'Sin IP de servicio'} · Equipo: {design.nodes.filter(n => n.customer_id === c.id).map(n => n.name).join(', ') || 'Sin asignar'}</p></div><label className="grid gap-2 text-sm">VLAN solicitada (opcional)<Input type="number" min={1} max={4094} disabled={pending} value={service?.vlan || ''} onChange={e => patchService(c.id, { vlan: e.target.value ? Number(e.target.value) : undefined })} /></label><label className="grid gap-2 text-sm">Nombre Wi-Fi solicitado (opcional)<Input disabled={pending} maxLength={32} value={service?.ssid || ''} onChange={e => patchService(c.id, { ssid: e.target.value || undefined })} /></label><label className="grid gap-2 text-sm">Contraseña Wi-Fi solicitada (opcional)<Input type="password" autoComplete="new-password" minLength={8} maxLength={128} disabled={pending} value={service?.wifi_password || ''} onChange={e => patchService(c.id, { wifi_password: e.target.value || undefined })} /></label></CardContent></Card>; })}
      {!data.customers.length && <p className="text-sm text-muted-foreground">Registra los departamentos para asignarles equipos y servicios.</p>}
    </div>}
    {data && step === 4 && review && <div className="grid gap-4"><Card><CardHeader><h2 className="text-lg font-semibold">Cambios que se aplicarán</h2></CardHeader><CardContent className="grid gap-3"><ol className="list-decimal space-y-3 pl-5 text-sm">{review.steps.map(s => <li key={s}>{s}</li>)}</ol><div className="grid gap-2 border-t pt-4"><h3 className="text-sm font-semibold">Topología a publicar</h3><NetworkTopologyMap nodes={design.nodes} links={design.links} equipment={data.equipment.map(e => ({ id: e.id, status: e.status, compatibility: e.compatibility }))} customers={data.customers.map(c => ({ id: c.id, apartment: c.apartment }))} interactive onSelectRouter={onOpenRouter} />{design.links.map((l, i) => <p key={i} className="text-sm [overflow-wrap:anywhere]">{design.nodes.find(n => n.id === l.from)?.name} ({l.from_port}) → {design.nodes.find(n => n.id === l.to)?.name} ({l.to_port})</p>)}</div></CardContent></Card>
      {!!review.blocked.length && <Card><CardContent className="grid gap-2"><h3 className="font-semibold text-destructive">Pendiente antes de aplicar</h3><ul className="list-disc space-y-2 pl-5 text-sm">{review.blocked.map((message, i) => <li key={i}>{message}</li>)}</ul><p className="text-sm text-muted-foreground">El borrador queda guardado; no se ha modificado ningún equipo.</p></CardContent></Card>}
      {!!review.warnings.length && <Card><CardContent><ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">{review.warnings.map((message, i) => <li key={i}>{message}</li>)}</ul></CardContent></Card>}
      <div className="flex flex-wrap gap-3"><IconButton label="Revisar de nuevo" variant="outline" size="icon-sm" disabled={pending} onClick={() => void run(inspectReview)}><RotateCcw aria-hidden="true" /></IconButton><IconButton label="Aplicar cambios revisados" size="icon-sm" disabled={pending || !review.can_apply || dirty} onClick={() => void run(async () => { const result = await context.request(`building-networks/${building}/apply`, { revision: review.revision, fingerprint: review.fingerprint }); const updated = await context.request(`building-networks/${building}`); setData(updated); setDesign(updated.design); setReview(null); setDirty(false); setStep(0); setNotice(result.message); })}><Check aria-hidden="true" /></IconButton></div>
    </div>}
    {data && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><div className="flex flex-wrap gap-2"><IconButton label="Guardar borrador" variant="outline" size="icon-sm" disabled={pending || !dirty} onClick={() => void run(save)}><Save aria-hidden="true" /></IconButton><IconButton label="Descartar y recargar" variant="ghost" size="icon-sm" disabled={pending} onClick={() => void run(async () => { const latest = await context.request(`building-networks/${building}`); setData(latest); setDesign(latest.design); setDirty(false); setReview(null); setStep(0); setNotice('Diseño guardado recargado.'); })}><Undo2 aria-hidden="true" /></IconButton></div><div className="flex gap-2"><IconButton label="Anterior" variant="outline" size="icon-sm" disabled={pending || step === 0} onClick={() => setStep(step - 1)}><ChevronLeft aria-hidden="true" /></IconButton>{step < 4 && <IconButton label="Continuar" size="icon-sm" disabled={pending} onClick={() => step === 3 ? void run(inspectReview) : setStep(step + 1)}><ChevronRight aria-hidden="true" /></IconButton>}</div></div>}
  </PanelShell>;
}
