import { applyTheme, setTheme, openAccount, closeAccount, getSnapshot, type AccountUser } from '../features/auth/account-store';

const trigger = document.querySelector('#account-trigger') as HTMLButtonElement;
const menu = document.querySelector('#account-dropdown') as HTMLElement;
const sidebar = document.querySelector('#main-sidebar') as HTMLElement;
const toggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
const backdrop = document.querySelector('#sidebar-backdrop') as HTMLElement;
let user: AccountUser | null = null;
const initial = (value?: string | null): string => Array.from(value || 'A')[0].toUpperCase();
export function syncThemeControls(): void { applyTheme(); }
export { setTheme, getSnapshot };
applyTheme();

function closeMenu(focus = false): void { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); }
function openMenu(last = false): void {
  setSidebar(false);
  menu.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  const items = menu.querySelectorAll('[role="menuitem"]:not(:disabled)');
  (items[last ? items.length - 1 : 0] as HTMLElement | undefined)?.focus();
}
trigger.addEventListener('click', () => menu.hidden ? openMenu() : closeMenu());
trigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.key === 'ArrowUp'); }
});
menu.addEventListener('keydown', (event) => {
  const items = Array.from(menu.querySelectorAll('[role="menuitem"]:not(:disabled)'));
  const index = items.indexOf(document.activeElement as Element);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    (items[next] as HTMLElement | undefined)?.focus();
  }
});
document.addEventListener('click', (event) => { if (!(event.target as HTMLElement).closest('[data-account-menu]')) closeMenu(); });
document.addEventListener('focusin', (event) => { if (!(event.target as HTMLElement).closest('[data-account-menu]')) closeMenu(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!menu.hidden) { event.preventDefault(); closeMenu(true); }
    if (document.body.classList.contains('sidebar-open')) setSidebar(false, true);
  }
});

function setSidebar(open: boolean, restoreFocus = false): void {
  document.body.classList.toggle('sidebar-open',open);
  sidebar.dataset.open=String(open);
  backdrop.hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Cerrar navegación':'Abrir navegación');
  if (open) { closeMenu(); (sidebar.querySelector('nav [data-selected="true"],nav button') as HTMLElement | null)?.focus(); }
  else if (restoreFocus) toggle.focus();
}
toggle.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
backdrop.addEventListener('click', () => setSidebar(false, true));
sidebar.addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('[data-page]')) setSidebar(false); });
const mobile = window.matchMedia('(max-width:700px)');
mobile.addEventListener('change', () => setSidebar(false));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !document.body.classList.contains('sidebar-open')) return;
  const items = [toggle, ...sidebar.querySelectorAll('a,button:not(:disabled)')] as HTMLElement[];
  const index = items.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
});

menu.addEventListener('click', (event) => {
  const item = (event.target as HTMLElement).closest('[data-account],[data-action="logout"]') as HTMLElement | null;
  if (!item || (item as HTMLButtonElement).disabled) return;
  closeMenu(); setSidebar(false);
  const action = (item as HTMLElement).dataset.account;
  if (!action) return; // Logout is handled by the dashboard and its real session API.
  openAccount(action === 'profile' ? 'profile' : 'settings', user);
});

export function updateAccount(userInfo: AccountUser | null, enabled = true): void {
  user = userInfo;
  (document.querySelector('#account-name') as HTMLElement).textContent = user?.username || 'Administrador';
  (document.querySelector('#account-avatar') as HTMLElement).textContent = initial(user?.username);
  (menu.querySelector('[data-action="logout"]') as HTMLButtonElement).disabled = !user;
  trigger.disabled = !enabled;
  if (!enabled) { closeMenu(); setSidebar(false); closeAccount(); }
}
