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

// ---------- Dimensiones ----------

export const NODE_W = 200;
export const NODE_H = 152;
export const COL_X = 260;
export const ROW_Y = 182;
export const ICON_CY = 52;

export const roleOrder: TopoRole[] = ['provider', 'central', 'switch', 'access'];

export const roleLabels: Record<TopoRole, string> = {
  provider: 'Proveedor',
  central: 'MikroTik central',
  switch: 'Switch',
  access: 'Router depto',
};

// ---------- Layout algorítmico ----------

export function layout(nodes: TopoNode[]): Record<string, { x: number; y: number }> {
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

// ---------- Color de estado ----------

export function statusColor(equipment?: TopoEquipment, hasRouter?: boolean): string {
  if (!hasRouter) return '#9ca3af';
  if (!equipment) return '#9ca3af';
  if (equipment.status === 'connected') return '#16a34a';
  if (equipment.status === 'error') return '#dc2626';
  return '#d97706';
}

// ---------- Helpers ----------

export const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
