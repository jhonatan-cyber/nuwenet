import type { Customer } from './customers-store';
export type CustomerAction = 'usage-history' | 'portal-link' | 'rotate-portal-link' | 'change-holder' | 'set-ip' | 'archive' | 'access';
export interface CustomerActionContext {
  kind: CustomerAction;
  customer: Customer & { access_issued_at?: string; access_expires_at?: string; access_version?: number };
  request: (route: string, body?: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<void>; notify: (message: string) => void;
}
export interface CustomerActionState { context?: CustomerActionContext; token?: string; trigger: HTMLElement | null; revision: number }
const listeners = new Set<() => void>();
let revision = 0;
let state: CustomerActionState | null = null;
const emit = () => listeners.forEach(fn => fn());
export const subscribeCustomerActions = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getCustomerAction = () => state;
export const getServerCustomerAction = () => null;
export function openCustomerAction(context: CustomerActionContext) {
  state = { context, trigger: state?.trigger || document.activeElement as HTMLElement | null, revision: ++revision }; emit();
}
export function showCustomerToken(token: string) {
  state = { token, trigger: state?.trigger || document.activeElement as HTMLElement | null, revision: ++revision }; emit();
}
export function closeCustomerAction() { state = null; emit(); }
