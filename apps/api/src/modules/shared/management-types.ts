import { validateRouterHost } from '../../routers/router-network';

export interface Customer {
  id: string;
  apartment: string;
  name: string;
  phone: string;
  status: 'active' | 'suspended';
  ip: string | null;
  plan_id: string | null;
  building_id: string | null;
  archived: number;
  manual_hold: number;
  down: number | null;
  up: number | null;
}

export interface NetworkJob {
  routerId: string | null;
  ip: string | null;
  status: 'active' | 'suspended';
  down: number;
  up: number;
  previous?: { routerId: string; ip: string };
  grouped?: boolean;
}

export const now = (): string => new Date().toISOString();

export function localDay(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });
}

export const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export const ipValue = (value?: string | null): string | null => {
  if (!value?.trim()) return null;
  validateRouterHost(value.trim());
  return value.trim();
};
