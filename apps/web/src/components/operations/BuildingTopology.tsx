import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import NetworkTopologyMap from '../NetworkTopologyMap';
import type { RoutersContext } from '@/features/routers-network/routers-store';

export function BuildingTopology({ buildingId, context, onSelectRouter }: { buildingId: string; context: RoutersContext; onSelectRouter: (id: string) => void }) {
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
