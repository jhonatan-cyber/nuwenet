import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from './ui/button';

export type TopoRole = 'provider' | 'central' | 'switch' | 'access';
export interface TopoNode {
  id: string;
  name: string;
  role: TopoRole;
  host?: string;
  model?: string;
  router_id?: string;
  customer_id?: string;
}
export interface TopoLink { from: string; to: string; from_port: string; to_port: string }
export interface TopoEquipment { id: string; status: string; compatibility: string }

const roleOrder: TopoRole[] = ['provider', 'central', 'switch', 'access'];
const roleLabels: Record<TopoRole, string> = {
  provider: 'Proveedor',
  central: 'MikroTik central',
  switch: 'Switch',
  access: 'Router depto',
};
const NODE_W = 200;
const NODE_H = 152;
const COL_X = 260;
const ROW_Y = 182;
const ICON_CY = 52;

function statusColor(equipment?: TopoEquipment, hasRouter?: boolean): string {
  if (!hasRouter) return '#9ca3af';
  if (!equipment) return '#9ca3af';
  if (equipment.status === 'connected') return '#16a34a';
  if (equipment.status === 'error') return '#dc2626';
  return '#d97706';
}

function layout(nodes: TopoNode[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const cols = roleOrder.map(role => nodes.filter(n => n.role === role));
  const maxRows = Math.max(1, ...cols.map(c => c.length));
  cols.forEach((col, ci) => {
    const offset = ((maxRows - col.length) * ROW_Y) / 2;
    col.forEach((node, ri) => {
      pos[node.id] = { x: 24 + ci * COL_X, y: 24 + offset + ri * ROW_Y };
    });
  });
  return pos;
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Dibujos distintos por tipo de equipo: nube, central MikroTik en rack, switch con puertos y router con Wi-Fi. */
function DeviceArt({ role }: { role: TopoRole }) {
  const body = '#f1f5f9';
  const edge = '#475569';
  const accent = role === 'provider' ? '#0284c7' : role === 'central' ? '#7c3aed' : role === 'switch' ? '#0d9488' : '#ea580c';
  if (role === 'provider') {
    return (
      <g>
        <path
          d="M38 78 Q34 58 56 56 Q62 38 86 40 Q108 36 114 56 Q136 58 132 78 Q128 90 112 90 L54 90 Q38 90 38 78 Z"
          fill={body}
          stroke={edge}
          strokeWidth={2}
        />
        <circle cx={85} cy={68} r={13} fill="#e0f2fe" stroke={accent} strokeWidth={2} />
        <ellipse cx={85} cy={68} rx={6} ry={13} fill="none" stroke={accent} strokeWidth={1.4} />
        <line x1={72} y1={68} x2={98} y2={68} stroke={accent} strokeWidth={1.4} />
        <path d="M60 34 Q70 26 80 30 M100 30 Q110 26 118 34" fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
      </g>
    );
  }
  if (role === 'central') {
    return (
      <g>
        <path d="M70 8 Q85 20 100 8 M62 2 Q85 20 108 2" fill="none" stroke={accent} strokeWidth={2} strokeLinecap="round" />
        <circle cx={85} cy={22} r={3} fill={accent} />
        <rect x={25} y={30} width={120} height={54} rx={9} fill={body} stroke={edge} strokeWidth={2} />
        <rect x={25} y={30} width={120} height={16} rx={8} fill={accent} opacity={0.9} />
        <text x={85} y={42} textAnchor="middle" fontSize={10} fontWeight={800} fill="#fff">MikroTik</text>
        {[0, 1, 2, 3, 4].map(i => (
          <rect key={i} x={35 + i * 20} y={54} width={14} height={12} rx={2} fill="#fff" stroke={edge} strokeWidth={1.4} />
        ))}
        {[0, 1, 2].map(i => (
          <circle key={i} cx={42 + i * 10} cy={74} r={2.6} fill="#16a34a" />
        ))}
      </g>
    );
  }
  if (role === 'switch') {
    return (
      <g>
        <rect x={20} y={36} width={130} height={46} rx={7} fill={body} stroke={edge} strokeWidth={2} />
        <rect x={20} y={36} width={130} height={13} rx={6} fill={accent} opacity={0.9} />
        <text x={85} y={46} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff">SWITCH</text>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <rect key={i} x={28 + i * 14} y={56} width={10} height={10} rx={1.5} fill="#fff" stroke={edge} strokeWidth={1.3} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <circle key={i} cx={33 + i * 14} cy={72} r={1.8} fill={i % 3 === 0 ? '#16a34a' : '#f59e0b'} />
        ))}
      </g>
    );
  }
  return (
    <g>
      <line x1={55} y1={62} x2={43} y2={28} stroke={edge} strokeWidth={3} strokeLinecap="round" />
      <line x1={115} y1={62} x2={127} y2={28} stroke={edge} strokeWidth={3} strokeLinecap="round" />
      <circle cx={43} cy={26} r={3.4} fill={edge} />
      <circle cx={127} cy={26} r={3.4} fill={edge} />
      <rect x={42} y={60} width={86} height={26} rx={8} fill={body} stroke={edge} strokeWidth={2} />
      <circle cx={85} cy={73} r={3} fill={accent} />
      <circle cx={62} cy={73} r={2} fill="#16a34a" />
      <circle cx={108} cy={73} r={2} fill="#16a34a" />
      <path d="M70 52 Q85 40 100 52 M64 45 Q85 29 106 45 M58 38 Q85 18 112 38" fill="none" stroke={accent} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

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
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const equipById = useMemo(() => new Map(equipment.map(e => [e.id, e])), [equipment]);
  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c.apartment])), [customers]);
  const incoming = useMemo(() => new Set(links.map(l => l.to)), [links]);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>(() => layout(nodes));
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const dragNode = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setPos(layout(nodes));
    setSelected(null);
  }, [nodes]);

  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  };

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (!interactive) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toSvg(e.clientX, e.clientY);
    const cur = pos[id] || { x: 0, y: 0 };
    dragNode.current = { id, dx: p.x - cur.x, dy: p.y - cur.y };
  }
  function onNodePointerMove(e: React.PointerEvent) {
    if (!interactive || !dragNode.current) return;
    const p = toSvg(e.clientX, e.clientY);
    const { id, dx, dy } = dragNode.current;
    setPos(prev => ({ ...prev, [id]: { x: Math.max(0, p.x - dx), y: Math.max(0, p.y - dy) } }));
  }
  function onNodePointerUp() {
    dragNode.current = null;
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  }
  function onBackgroundPointerMove(e: React.PointerEvent) {
    if (dragNode.current || !pan.current) return;
    if (e.buttons !== 1) return;
    setView(v => ({ ...v, tx: pan.current!.tx + (e.clientX - pan.current!.x), ty: pan.current!.ty + (e.clientY - pan.current!.y) }));
  }
  function openRouter(node: TopoNode) {
    setSelected(node.id);
    if (interactive && node.router_id && onSelectRouter) onSelectRouter(node.router_id);
  }
  function onBackgroundPointerUp() {
    pan.current = null;
  }

  if (!nodes.length) {
    return <p className="rounded-lg border p-6 text-sm text-muted-foreground">Sin equipos en el diseño. Crea la estructura inicial para ver el mapa.</p>;
  }

  const broken = nodes.filter(n => n.role !== 'provider' && !incoming.has(n.id));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>☁️ Proveedor</span>
        <span>🛰️ MikroTik central</span>
        <span>🔀 Switch</span>
        <span>📶 Router depto</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-full" style={{ background: '#16a34a' }} />OK</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-full" style={{ background: '#d97706' }} />Sin probar</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-full" style={{ background: '#dc2626' }} />Error</span>
        <span><i className="mr-1 inline-block size-2.5 rounded-full" style={{ background: '#9ca3af' }} />Inventario</span>
        {broken.length > 0 && <span className="text-amber-700 dark:text-amber-400">· {broken.length} sin entrada</span>}
        {!interactive && <span>· Solo lectura</span>}
      </div>
      <div className="relative overflow-hidden rounded-xl border bg-muted/30" style={{ height: 460 }}>
        <svg
          ref={svgRef}
          className="h-full w-full touch-none text-foreground select-none"
          role="img"
          aria-label={`Topología: ${nodes.length} equipos y ${links.length} conexiones`}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={e => { onBackgroundPointerMove(e); onNodePointerMove(e); }}
          onPointerUp={() => { onBackgroundPointerUp(); onNodePointerUp(); }}
          onPointerLeave={() => { onBackgroundPointerUp(); onNodePointerUp(); }}
          onWheel={e => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setView(v => ({ ...v, scale: Math.min(2.5, Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.08 : 0.92))) }));
          }}
        >
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {links.map((l, i) => {
              const a = pos[l.from];
              const b = pos[l.to];
              if (!a || !b) return null;
              const x1 = a.x + NODE_W;
              const y1 = a.y + ICON_CY;
              const x2 = b.x;
              const y2 = b.y + ICON_CY;
              const mx = (x1 + x2) / 2;
              const missing = !byId.has(l.from) || !byId.has(l.to);
              return (
                <g key={i}>
                  <path
                    d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={missing ? '#dc2626' : '#64748b'}
                    strokeWidth={missing ? 2.5 : 2}
                    strokeDasharray={missing ? '6 4' : undefined}
                    markerEnd="url(#topo-arrow)"
                  />
                  <text x={mx} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="11" fill="#64748b">
                    {l.from_port} → {l.to_port}
                  </text>
                </g>
              );
            })}
            <defs>
              <marker id="topo-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#64748b" />
              </marker>
            </defs>
            {nodes.map(n => {
              const p = pos[n.id];
              if (!p) return null;
              const eq = n.router_id ? equipById.get(n.router_id) : undefined;
              const color = statusColor(eq, !!n.router_id);
              const orphan = n.role !== 'provider' && !incoming.has(n.id);
              const apt = n.customer_id ? customerById.get(n.customer_id) : undefined;
              const isSel = selected === n.id;
              const statusLabel = n.router_id ? (eq?.status === 'connected' ? 'Conectado' : eq?.status === 'error' ? 'Error' : 'Sin probar') : 'Inventario';
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  role={interactive && n.router_id ? 'button' : undefined}
                  tabIndex={interactive && n.router_id ? 0 : undefined}
                  aria-label={`${n.name || roleLabels[n.role]}, ${statusLabel}${n.host ? `, ${n.host}` : ''}. ${interactive && n.router_id ? 'Doble clic para abrir su configuración.' : ''}`}
                  onPointerDown={e => onNodePointerDown(e, n.id)}
                  onClick={e => {
                    e.stopPropagation();
                    setSelected(n.id);
                  }}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    openRouter(n);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') openRouter(n);
                  }}
                  style={{ cursor: interactive ? 'grab' : 'default', outline: 'none' }}
                >
                  <title>{`${n.name || '(sin nombre)'} · ${roleLabels[n.role]}${n.host ? ` · ${n.host}` : ''}${n.model ? ` · ${n.model}` : ''} · ${statusLabel}${interactive && n.router_id ? ' · Doble clic para configurar' : ''}`}</title>
                  <rect x={4} y={4} width={NODE_W - 8} height={NODE_H - 8} rx={14} fill="none" stroke={isSel ? '#2563eb' : orphan ? '#d97706' : 'transparent'} strokeWidth={isSel ? 2.5 : 2} strokeDasharray={!isSel && orphan ? '7 5' : undefined} />
                  <g transform={`translate(${(NODE_W - 170) / 2},0)`}>
                    <DeviceArt role={n.role} />
                  </g>
                  <circle cx={NODE_W - 28} cy={22} r={9} fill={color} stroke="#fff" strokeWidth={2.5} />
                  {orphan && (
                    <g transform="translate(18,14)">
                      <path d="M10 0 L20 17 L0 17 Z" fill="#f59e0b" stroke="#92400e" strokeWidth={1.4} />
                      <text x={10} y={14} textAnchor="middle" fontSize={11} fontWeight={800} fill="#451a03">!</text>
                    </g>
                  )}
                  <text x={NODE_W / 2} y={108} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="currentColor">
                    {trunc(n.name || '(sin nombre)', 24)}
                  </text>
                  <text x={NODE_W / 2} y={123} textAnchor="middle" fontSize={10.5} fill="#64748b">
                    {trunc(`${roleLabels[n.role]}${apt ? ` · ${apt}` : ''}${orphan ? ' · sin entrada' : ''}`, 30)}
                  </text>
                  <text x={NODE_W / 2} y={137} textAnchor="middle" fontSize={10} fill="#64748b">
                    {trunc(n.host || n.model || (n.router_id ? `router #${n.router_id}` : statusLabel), 30)}
                  </text>
                  {isSel && interactive && n.router_id && (
                    <g
                      transform={`translate(${NODE_W / 2 - 52},138)`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Abrir configuración de ${n.name || roleLabels[n.role]}`}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); openRouter(n); }}
                      onDoubleClick={e => { e.stopPropagation(); openRouter(n); }}
                      onKeyDown={e => { if (e.key === 'Enter') openRouter(n); }}
                      style={{ cursor: 'pointer', outline: 'none' }}
                    >
                      <rect width={104} height={22} rx={11} fill="#2563eb" />
                      <text x={52} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">Configurar →</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="absolute top-2 right-2 flex gap-1">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Acercar" onClick={() => setView(v => ({ ...v, scale: Math.min(2.5, v.scale * 1.15) }))}><Plus aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Alejar" onClick={() => setView(v => ({ ...v, scale: Math.max(0.4, v.scale / 1.15) }))}><Minus aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Restablecer vista" onClick={() => { setView({ scale: 1, tx: 0, ty: 0 }); setPos(layout(nodes)); }}><Maximize aria-hidden="true" /></Button>
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
