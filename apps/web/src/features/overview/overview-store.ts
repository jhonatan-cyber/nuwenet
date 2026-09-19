export interface OverviewSummary { customers: number; active: number; collected: number; overdue: number }
export interface NetworkCommand {
  id: string; apartment: string; action: string; status: string;
  last_error?: string | null; attempts: number; next_attempt?: string | null;
}
export interface ActivityEvent { message: string; created_at: string; actor?: string | null }
export interface AutomationTask { name: string; last_success?: string | null; duration_ms?: number | null; last_error?: string | null }
export interface Automation { tasks: AutomationTask[]; queue: { pending: number; failed: number; oldest?: string | null } }
import type { OverviewView } from '@/lib/pages';

export interface OverviewContext {
  page: OverviewView;
  summary?: OverviewSummary;
  commands: NetworkCommand[];
  events: ActivityEvent[];
  automation: Automation;
  isAdmin: boolean; superadmin: boolean; userId: string;
  money: (value: number) => string; date: (value: string) => string;
  request: (route: string, body?: Record<string, unknown>) => Promise<any>;
  refresh: () => Promise<void>;
}
const listeners = new Set<() => void>();
const initial = { context: null as OverviewContext | null };
let state = initial;
export const subscribeOverview = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getOverview = () => state;
export const getServerOverview = () => initial;
export function showOverview(context: OverviewContext) {
  state = { context }; listeners.forEach(fn => fn());
}
export function hideOverview() {
  state = initial; listeners.forEach(fn => fn());
}
