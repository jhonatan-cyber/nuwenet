export interface Plan { id: number; name: string; down: number; up: number; price: number; customer_count: number; building_id: number }
export interface PlanInput { name: string; down: number; up: number; price: number; building_id?: number; id?: number }
export interface PlansContext {
  plans: Plan[]; buildings: { id: number; name: string }[];
  buildingId: number | null; currency: string; canEdit: boolean; superadmin: boolean; userId: number;
  save: (route: 'plans' | 'plans/update', body: PlanInput) => Promise<unknown>;
  refresh: () => Promise<void>;
}
const listeners = new Set<() => void>();
const initial = { visible: false, context: null as PlansContext | null };
let state = initial;
export const subscribePlans = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getPlans = () => state;
export const getServerPlans = () => initial;
export function showPlans(context: PlansContext) {
  state = { visible: true, context }; listeners.forEach(fn => fn());
}
export function hidePlans() {
  state = initial; listeners.forEach(fn => fn());
}
