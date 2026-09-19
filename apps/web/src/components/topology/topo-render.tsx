/**
 * topo-render.tsx
 * Renderizado SVG puro: dibujos de equipos (DeviceArt), aristas y tarjetas de nodo.
 * Sin estado de interacción — recibe pos, view y callbacks como props.
 */
import { NODE_W, NODE_H, ICON_CY, roleLabels, trunc, statusColor } from './topo-layout';
import type { TopoNode, TopoLink, TopoEquipment, TopoRole } from './topo-layout';

// ---------- Dibujos de equipo ----------

export function DeviceArt({ role }: { role: TopoRole }) {
  const body = '#f1f5f9';
  const edge = '#475569';
  const accent =
    role === 'provider' ? '#0284c7'
    : role === 'central' ? '#7c3aed'
    : role === 'switch'  ? '#0d9488'
    : '#ea580c';

  if (role === 'provider') {
    return (
      <g>
        <path d="M38 78 Q34 58 56 56 Q62 38 86 40 Q108 36 114 56 Q136 58 132 78 Q128 90 112 90 L54 90 Q38 90 38 78 Z" fill={body} stroke={edge} strokeWidth={2} />
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
        {[0, 1, 2, 3, 4].map(i => <rect key={i} x={35 + i * 20} y={54} width={14} height={12} rx={2} fill="#fff" stroke={edge} strokeWidth={1.4} />)}
        {[0, 1, 2].map(i => <circle key={i} cx={42 + i * 10} cy={74} r={2.6} fill="#16a34a" />)}
      </g>
    );
  }
  if (role === 'switch') {
    return (
      <g>
        <rect x={20} y={36} width={130} height={46} rx={7} fill={body} stroke={edge} strokeWidth={2} />
        <rect x={20} y={36} width={130} height={13} rx={6} fill={accent} opacity={0.9} />
        <text x={85} y={46} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff">SWITCH</text>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <rect key={i} x={28 + i * 14} y={56} width={10} height={10} rx={1.5} fill="#fff" stroke={edge} strokeWidth={1.3} />)}
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <circle key={i} cx={33 + i * 14} cy={72} r={1.8} fill={i % 3 === 0 ? '#16a34a' : '#f59e0b'} />)}
      </g>
    );
  }
  // access / default
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

// ---------- Aristas ----------

export function TopoEdges({
  links,
  pos,
  byId,
}: {
  links: TopoLink[];
  pos: Record<string, { x: number; y: number }>;
  byId: Map<string, TopoNode>;
}) {
  return (
    <>
      <defs>
        <marker id="topo-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#64748b" />
        </marker>
      </defs>
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
    </>
  );
}

// ---------- Nodos ----------

export function TopoNodes({
  nodes,
  pos,
  equipById,
  customerById,
  incoming,
  selected,
  interactive,
  onPointerDown,
  onClick,
  onDoubleClick,
  onKeyDown,
}: {
  nodes: TopoNode[];
  pos: Record<string, { x: number; y: number }>;
  equipById: Map<string, TopoEquipment>;
  customerById: Map<string, string>;
  incoming: Set<string>;
  selected: string | null;
  interactive: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onClick: (e: React.MouseEvent, node: TopoNode) => void;
  onDoubleClick: (e: React.MouseEvent, node: TopoNode) => void;
  onKeyDown: (e: React.KeyboardEvent, node: TopoNode) => void;
}) {
  return (
    <>
      {nodes.map(n => {
        const p = pos[n.id];
        if (!p) return null;
        const eq = n.router_id ? equipById.get(n.router_id) : undefined;
        const color = statusColor(eq, !!n.router_id);
        const orphan = n.role !== 'provider' && !incoming.has(n.id);
        const apt = n.customer_id ? customerById.get(n.customer_id) : undefined;
        const isSel = selected === n.id;
        const statusLabel = n.router_id
          ? (eq?.status === 'connected' ? 'Conectado' : eq?.status === 'error' ? 'Error' : 'Sin probar')
          : 'Inventario';

        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            role={interactive && n.router_id ? 'button' : undefined}
            tabIndex={interactive && n.router_id ? 0 : undefined}
            aria-label={`${n.name || roleLabels[n.role]}, ${statusLabel}${n.host ? `, ${n.host}` : ''}. ${interactive && n.router_id ? 'Doble clic para abrir su configuración.' : ''}`}
            onPointerDown={e => onPointerDown(e, n.id)}
            onClick={e => onClick(e, n)}
            onDoubleClick={e => onDoubleClick(e, n)}
            onKeyDown={e => onKeyDown(e, n)}
            style={{ cursor: interactive ? 'grab' : 'default', outline: 'none' }}
          >
            <title>{`${n.name || '(sin nombre)'} · ${roleLabels[n.role]}${n.host ? ` · ${n.host}` : ''}${n.model ? ` · ${n.model}` : ''} · ${statusLabel}${interactive && n.router_id ? ' · Doble clic para configurar' : ''}`}</title>
            <rect
              x={4} y={4} width={NODE_W - 8} height={NODE_H - 8} rx={14}
              fill="none"
              stroke={isSel ? '#2563eb' : orphan ? '#d97706' : 'transparent'}
              strokeWidth={isSel ? 2.5 : 2}
              strokeDasharray={!isSel && orphan ? '7 5' : undefined}
            />
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
                onClick={e => { e.stopPropagation(); onDoubleClick(e as unknown as React.MouseEvent, n); }}
                onDoubleClick={e => { e.stopPropagation(); onDoubleClick(e, n); }}
                onKeyDown={e => { if (e.key === 'Enter') onKeyDown(e, n); }}
                style={{ cursor: 'pointer', outline: 'none' }}
              >
                <rect width={104} height={22} rx={11} fill="#2563eb" />
                <text x={52} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">Configurar →</text>
              </g>
            )}
          </g>
        );
      })}
    </>
  );
}

// ---------- Leyenda ----------

export function TopoLegend({ nodes, links, interactive, broken }: {
  nodes: TopoNode[];
  links: TopoLink[];
  interactive: boolean;
  broken: TopoNode[];
}) {
  return (
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
  );
}
