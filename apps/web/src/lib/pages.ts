/** Single source of truth for sections: label, owning panels and visibility. */
export type PanelId = 'overview' | 'customers' | 'plans' | 'billing' | 'operations' | 'routers';
export type OverviewView = 'overview' | 'network' | 'activity';

export interface PageDefinition {
  label: string;
  /** Panels mounted while this section is active. */
  panels: PanelId[];
  /** View rendered by the overview panel. */
  view?: OverviewView;
  /** Landing section: customers render as cards, without search or pagination. */
  cards?: boolean;
  superadminOnly?: boolean;
}

const list = [
  ['users', { label: 'Usuarios y permisos', panels: ['operations'], superadminOnly: true }],
  ['buildings', { label: 'Edificios y accesos', panels: ['operations'], superadminOnly: true }],
  ['routers', { label: 'Equipos de red', panels: ['routers'] }],
  ['overview', { label: 'Resumen', panels: ['overview', 'customers'], view: 'overview', cards: true }],
  ['customers', { label: 'Departamentos', panels: ['customers'] }],
  ['plans', { label: 'Planes de internet', panels: ['plans'] }],
  ['billing', { label: 'Mensualidades y pagos', panels: ['billing'] }],
  ['payments', { label: 'Historial de pagos', panels: ['billing'] }],
  ['network', { label: 'Control de acceso', panels: ['overview'], view: 'network' }],
  ['activity', { label: 'Actividad', panels: ['overview'], view: 'activity' }],
  ['settings', { label: 'Edificio y automatización', panels: ['operations'], superadminOnly: true }],
  ['backups', { label: 'Respaldos', panels: ['operations'], superadminOnly: true }],
  ['audit', { label: 'Auditoría', panels: ['operations'], superadminOnly: true }],
] as const satisfies readonly (readonly [string, PageDefinition])[];

export const pages: Record<string, PageDefinition> = Object.fromEntries(list);
/** Navigation order used by the super-admin sidebar. */
export const sectionOrder: string[] = list.map(([id]) => id);
export const isSection = (section: string) => Object.hasOwn(pages, section);
export const canView = (section: string, superadmin: boolean) => {
  const page = pages[section];
  return Boolean(page) && (superadmin || !page.superadminOnly);
};
export const landingSection = (superadmin: boolean) => (superadmin ? 'users' : 'overview');
/** Falls back to the landing section when the hash is unknown or forbidden. */
export const resolveSection = (section: string, superadmin: boolean) => (canView(section, superadmin) ? section : landingSection(superadmin));
export const overviewView = (section: string): OverviewView => pages[section]?.view ?? 'overview';
