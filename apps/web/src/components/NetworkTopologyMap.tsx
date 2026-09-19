/**
 * NetworkTopologyMap — wrapper de interacciones (zoom, pan, drag de nodos).
 *
 * Lógica de layout  → topology/topo-layout.ts
 * Renderizado SVG   → topology/topo-render.tsx
 * Interacciones     → este archivo
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { layout, NODE_W } from './topology/topo-layout';
import type { TopoNode, TopoLink, TopoEquipment } from './topology/topo-layout';
import { TopoEdges, TopoNodes, TopoLegend } from './topology/topo-render';
import { IconButton } from '@/components/shared/icon-button';

// Re-export types so existing consumers keep their imports working.
export type { TopoNode, TopoLink, TopoEquipment };
export type { TopoRole } from './topology/topo-layout';

export default function NetworkTopologyMap({
  nodes,
  links,
  equipment = [],
  customers = [],
  interactive = false,
  onSelectRouter,
}: {
  nodes: TopoNode[];
  links: TopoLink[];
  equipment?: TopoEquipment[];
  customers?: { id: string; apartment: string }[];
  /** true = super-admin: arrastrar nodos + clic a ficha. false = solo lectura con pan/zoom. */
  interactive?: boolean;
  onSelectRouter?: (routerId: string) => void;
}) {
  const byId        = useMemo(() => new Map(nodes.map(n => [n.id, n])),        [nodes]);
  const equipById   = useMemo(() => new Map(equipment.map(e => [e.id, e])),    [equipment]);
  const customerById= useMemo(() => new Map(customers.map(c => [c.id, c.apartment])), [customers]);
  const incoming    = useMemo(() => new Set(links.map(l => l.to)),             [links]);

  const [pos, setPos]     = useState<Record<string, { x: number; y: number }>>(() => layout(nodes));
  const [view, setView]   = useState({ scale: 1, tx: 0, ty: 0 });
  const [selected, setSelected] = useState<string | null>(null);

  const dragNode = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pan      = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const svgRef   = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setPos(layout(nodes));
    setSelected(null);
  }, [nodes]);

  // ---------- helpers de coordenadas ----------

  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left  - view.tx) / view.scale,
      y: (clientY - rect.top   - view.ty) / view.scale,
    };
  };

  // ---------- drag de nodo ----------

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (!interactive) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSvg(e.clientX, e.clientY);
    const cur = pos[id] || { x: 0, y: 0 };
    dragNode.current = { id, dx: p.x - cur.x, dy: p.y - cur.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    // nodo
    if (interactive && dragNode.current) {
      const p = toSvg(e.clientX, e.clientY);
      const { id, dx, dy } = dragNode.current;
      setPos(prev => ({ ...prev, [id]: { x: Math.max(0, p.x - dx), y: Math.max(0, p.y - dy) } }));
    }
    // pan del fondo
    if (!dragNode.current && pan.current && e.buttons === 1) {
      setView(v => ({ ...v, tx: pan.current!.tx + (e.clientX - pan.current!.x), ty: pan.current!.ty + (e.clientY - pan.current!.y) }));
    }
  }

  function onPointerUp() {
    dragNode.current = null;
    pan.current = null;
  }

  // ---------- pan del fondo ----------

  function onBackgroundPointerDown(e: React.PointerEvent) {
    pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }

  // ---------- apertura de router ----------

  function openRouter(node: TopoNode) {
    setSelected(node.id);
    if (interactive && node.router_id && onSelectRouter) onSelectRouter(node.router_id);
  }

  // ---------- callbacks para TopoNodes ----------

  function handleNodeClick(e: React.MouseEvent, node: TopoNode) {
    e.stopPropagation();
    setSelected(node.id);
  }

  function handleNodeDblClick(e: React.MouseEvent, node: TopoNode) {
    e.stopPropagation();
    openRouter(node);
  }

  function handleNodeKeyDown(e: React.KeyboardEvent, node: TopoNode) {
    if (e.key === 'Enter') openRouter(node);
  }

  // ---------- zoom con rueda ----------

  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setView(v => ({ ...v, scale: Math.min(2.5, Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.08 : 0.92))) }));
  }

  // ---------- render ----------

  if (!nodes.length) {
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">Sin equipos en el diseño. Crea la estructura inicial para ver el mapa.</p>;
  }

  const broken = nodes.filter(n => n.role !== 'provider' && !incoming.has(n.id));

  return (
    <div>
      <TopoLegend nodes={nodes} links={links} interactive={interactive} broken={broken} />

      <div className="relative overflow-hidden rounded-xl border bg-muted/30" style={{ height: 460 }}>
        <svg
          ref={svgRef}
          className="h-full w-full touch-none text-foreground select-none"
          role="img"
          aria-label={`Topología: ${nodes.length} equipos y ${links.length} conexiones`}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            <TopoEdges links={links} pos={pos} byId={byId} />
            <TopoNodes
              nodes={nodes}
              pos={pos}
              equipById={equipById}
              customerById={customerById}
              incoming={incoming}
              selected={selected}
              interactive={interactive}
              onPointerDown={onNodePointerDown}
              onClick={handleNodeClick}
              onDoubleClick={handleNodeDblClick}
              onKeyDown={handleNodeKeyDown}
            />
          </g>
        </svg>

        {/* Controles de zoom */}
        <div className="absolute top-2 right-2 flex gap-1">
          <IconButton label="Acercar" type="button" variant="outline" size="icon-sm" onClick={() => setView(v => ({ ...v, scale: Math.min(2.5, v.scale * 1.15) }))}><Plus aria-hidden="true" /></IconButton>
          <IconButton label="Alejar" type="button" variant="outline" size="icon-sm" onClick={() => setView(v => ({ ...v, scale: Math.max(0.4, v.scale / 1.15) }))}><Minus aria-hidden="true" /></IconButton>
          <IconButton label="Restablecer vista" type="button" variant="outline" size="icon-sm" onClick={() => { setView({ scale: 1, tx: 0, ty: 0 }); setPos(layout(nodes)); }}><Maximize aria-hidden="true" /></IconButton>
        </div>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {interactive
          ? 'Arrastra los dibujos para ordenar la vista (no cambia el cableado). Doble clic o botón Configurar en un equipo con conexión para abrir su ficha. Ctrl + rueda para zoom, arrastra el fondo para mover.'
          : 'Vista de solo lectura. Ctrl + rueda para zoom, arrastra el fondo para mover.'}
      </p>
    </div>
  );
}
