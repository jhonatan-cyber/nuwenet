export interface Invoice {
  id: string; apartment: string; name: string; period: string; due: string;
  amount: number; paid_total: number | string; paid_at: string | null;
}
export interface Payment {
  id: string; apartment: string; period: string; amount: number; method: string;
  reference: string; created_at: string; actor: string | null;
  reversed_at: string | null; reversal_reason: string | null;
}
export interface BillingContext {
  page: 'billing' | 'payments';
  invoices: Invoice[]; payments: Payment[];
  pagination: { size: number; invoices: { page: number; total: number }; payments: { page: number; total: number } };
  buildings: { id: string; name: string }[];
  buildingId: string | null; currency: string; today: string;
  customerId: string | null; canPay: boolean; isAdmin: boolean; superadmin: boolean; userId: string;
  money: (value: number) => string; date: (value: string) => string;
  request: (route: string, body?: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<void>;
  goto: (page: 'billing' | 'payments') => void;
  clearStatement: () => Promise<void>;
  paginate: (kind: 'invoices' | 'payments', page: number) => Promise<void>;
}
const listeners = new Set<() => void>();
const initial = { visible: false, context: null as BillingContext | null };
let state = initial;
export const subscribeBilling = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getBilling = () => state;
export const getServerBilling = () => initial;
export function showBilling(context: BillingContext) {
  state = { visible: true, context }; listeners.forEach(fn => fn());
}
export function hideBilling() {
  state = initial; listeners.forEach(fn => fn());
}
