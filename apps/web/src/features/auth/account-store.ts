export type Theme = 'light' | 'dark' | 'system';
export interface Preferences { compact: boolean; reduceMotion: boolean; theme: Theme }
export interface AccountUser { username: string; role: string }
const key = 'nuwenet.panel.preferences';
const defaults: Preferences = { compact: false, reduceMotion: false, theme: 'system' };
let preferences = defaults;
const listeners = new Set<() => void>();
const serverState = { open: false, page: 'settings' as 'settings' | 'profile', user: null as AccountUser | null, preferences: defaults, message: '' };
let state = serverState;
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getSnapshot = () => state;
export const getServerSnapshot = () => serverState;
function notify() { state = { ...state, preferences }; listeners.forEach(fn => fn()); }
export function applyTheme() {
  if (typeof window === 'undefined') return;
  const effective = preferences.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preferences.theme;
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.density = preferences.compact ? 'compact' : 'comfortable';
  document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
  document.querySelectorAll<HTMLInputElement>('input[name="theme-choice"]').forEach(input => { input.checked = input.value === preferences.theme; });
}
export function updatePreferences(update: Partial<Preferences>) {
  preferences = { ...preferences, ...update }; applyTheme();
  let message = 'Preferencias guardadas en este navegador.';
  try { localStorage.setItem(key, JSON.stringify(preferences)); }
  catch { message = 'Preferencias aplicadas. Este navegador no permite guardarlas.'; }
  state = { ...state, message }; notify();
}
export function setTheme(theme: Theme) {
  if (['light','dark','system'].includes(theme)) updatePreferences({theme});
}
export function openAccount(page: 'settings' | 'profile', user: AccountUser | null) {
  state = { ...state, open: true, page, user, message: '' }; notify();
}
export function closeAccount() { state = { ...state, open: false }; notify(); }
if (typeof window !== 'undefined') {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    preferences = { compact: saved.compact === true, reduceMotion: saved.reduceMotion === true, theme: ['light','dark','system'].includes(saved.theme) ? saved.theme : 'system' };
  } catch { /* Storage can be unavailable; apply the defaults. */ }
  state = { ...state, preferences }; applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}
