import { closeCustomerAction } from './customer-actions-store';
import type { Plan } from './plans-store';
export interface Customer {
  id: number; building_id: number; apartment: string; name: string; phone: string;
  plan_id: number | null; plan_name: string | null; down: number | null; up: number | null;
  ip: string | null; status: string; archived: number; manual_hold: number;
  network_state: string; network_checked_at: string | null; debt: number;
}
export interface CustomersContext {
  customers: Customer[]; plans: Plan[]; buildingId: number; buildingName: string;
  userId: number; canEdit: boolean; overview: boolean; search: string; archived: string;
  pagination: { page: number; total: number }; size: number;
  money: (value: number) => string; date: (value: string) => string;
  save: (route: string, body: Record<string, unknown>) => Promise<{ portal_link?: { token: string } }>;
  refresh: () => Promise<void>; filter: (search: string, archived: string) => Promise<void>;
  showLink: (link: { token: string }) => void;
}
const initial = { context: null as CustomersContext | null, draft: undefined as Customer | null | undefined };
let state = initial;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
export const subscribeCustomers = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getCustomers = () => state;
export const getServerCustomers = () => initial;
export function showCustomers(context: CustomersContext) { state = { context, draft: state.context?.buildingId === context.buildingId ? state.draft : undefined }; emit(); }
export function hideCustomers() { closeCustomerAction(); state = initial; emit(); }
export function editCustomer(draft: Customer | null) { state = { ...state, draft }; emit(); }
export function closeCustomer() { state = { ...state, draft: undefined }; emit(); }
