export type OperationsPage = 'buildings' | 'settings' | 'users' | 'backups' | 'audit';
export interface OperationsContext {
  page: OperationsPage;
  buildings: { id: string; name: string; address?: string; disabled?: number | boolean; central_router_id?: string | null }[];
  routers: { id: string; name: string; adapter: string; disabled?: number | boolean; building_id?: string | null; status?: string }[];
  settings: Record<string, any>;
  date: (value: string) => string;
  superadmin: boolean;
  userId: string;
  request: (route: string, body?: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<void>;
}
const listeners = new Set<() => void>();
const initial = { visible: false, context: null as OperationsContext | null };
let state = initial;
export const subscribeOperations = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getOperations = () => state;
export const getServerOperations = () => initial;
export function showOperations(context: OperationsContext) {
  state = { visible: true, context }; listeners.forEach(fn => fn());
}
export function hideOperations() {
  state = initial; listeners.forEach(fn => fn());
}
