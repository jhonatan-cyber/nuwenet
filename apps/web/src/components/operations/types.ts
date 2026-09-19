export interface Building {
  id: string;
  name: string;
  address?: string | null;
  disabled?: number | boolean;
  central_router_id?: string | null;
}
export interface RouterItem {
  id: string;
  name: string;
  adapter: string;
  disabled?: number | boolean;
  building_id?: string | null;
  status?: string;
}
export interface UserItem {
  id: string;
  username: string;
  role: string;
  first_name?: string;
  last_name?: string;
  ci?: string;
  phone?: string;
  address?: string;
  disabled?: boolean;
  building_ids?: string[];
}
export interface BackupItem {
  name: string;
  created_at: string;
  driver: string;
}
export interface AuditItem {
  created_at: string;
  username: string;
  action: string;
}
