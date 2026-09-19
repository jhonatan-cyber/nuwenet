import { getSnapshot, setTheme, syncThemeControls } from './account';
import { emptyMarkup, escape } from '../lib/html';

export interface AuthRequest {
  (route: string, body?: unknown, headers?: Record<string, string>): Promise<any>;
}
export interface AuthStatus {
  users: number;
  setup_code_required?: boolean;
  setup_available?: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector(selector) as T;
const svg = (inner: string): string => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const eyeIcon = svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>');
const eyeOffIcon = svg('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>');
const fieldClass = 'h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';
let themeListeners: AbortController | undefined;

type ThemeName = 'light' | 'dark' | 'system';

export async function renderAuthScreen({ request, onAuthenticated }: { request: AuthRequest; onAuthenticated: () => Promise<void> }): Promise<void> {
  const view = $<HTMLElement>('#view');
  view.hidden = false;
  let status: AuthStatus;
  try { status = await request('auth/status'); }
  catch (error) { view.innerHTML = emptyMarkup(escape((error as Error).message)); return; }
  const setup = status.users === 0, codeRequired = setup && status.setup_code_required, setupBlocked = setup && status.setup_available === false;
  $('#breadcrumb').textContent = setup ? 'Crear super-admin' : 'Iniciar sesión';
  document.body.classList.add('setup-screen');
  const mark = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>`;
  view.innerHTML = `<div class="rounded-xl border bg-card p-8 shadow-sm max-[700px]:p-6">
    <div class="mb-7 flex items-center justify-between gap-4">
      <a class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight" href="/" aria-label="NuweNet, inicio"><span class="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground [&_svg]:size-6">${mark}</span><span>Nuwe<strong>Net</strong></span></a>
      <div class="relative">
        <button id="auth-theme-button" class="inline-flex size-9 items-center justify-center rounded-md border bg-background hover:bg-muted" type="button" aria-label="Selector de tema" aria-haspopup="menu" aria-expanded="false" aria-controls="auth-theme-menu"><span data-theme-icon aria-hidden="true"></span></button>
        <div id="auth-theme-menu" class="absolute top-[calc(100%+8px)] right-0 z-50 hidden w-44 rounded-md border bg-card p-1 shadow-xl" role="menu" aria-label="Selector de tema"></div>
      </div>
    </div>
    <section aria-labelledby="auth-title">
      <div class="flex justify-between gap-2 text-[10px] tracking-wider text-muted-foreground"><span>${setup ? 'CONFIGURACIÓN INICIAL' : 'ACCESO AL PANEL'}</span><span class="inline-flex items-center gap-1 [&_svg]:size-3 max-[700px]:hidden">${svg('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0"/>')} Acceso privado</span></div>
      <div class="my-6">${setup ? '' : '<h1 id="auth-title" class="text-2xl font-semibold">Bienvenido de nuevo</h1><p class="mt-2 text-sm text-muted-foreground">Ingresa tus credenciales para continuar con la administración de tu edificio.</p>'}</div>
      ${setupBlocked ? '<div class="my-4 rounded-lg border border-destructive p-3 text-sm text-destructive" role="status">La instalación aún no está lista para crear tu cuenta desde esta dirección. Contacta a quien instaló NuweNet.</div>' : ''}
      <form id="auth-form" class="grid gap-5" aria-describedby="auth-error">
        <div class="grid gap-2"><label for="auth-user" class="text-sm font-medium">Usuario</label><div class="relative [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-3 [&>svg]:left-3 [&>svg]:size-4 [&>svg]:text-muted-foreground">${svg('<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>')}<input id="auth-user" name="username" class="${fieldClass} pl-9" placeholder="${setup ? 'Elige un nombre de usuario' : 'Tu nombre de usuario'}" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="160" ${setupBlocked ? 'disabled' : ''}></div></div>
        <div class="grid gap-2"><label for="auth-pass" class="text-sm font-medium">Contraseña</label><div class="relative [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-3 [&>svg]:left-3 [&>svg]:size-4 [&>svg]:text-muted-foreground">${svg('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0"/>')}<input id="auth-pass" name="password" type="password" class="${fieldClass} pl-9 pr-10" placeholder="${setup ? 'Crea una contraseña' : 'Ingresa tu contraseña'}" autocomplete="${setup ? 'new-password' : 'current-password'}" aria-describedby="auth-caps${setup ? ' auth-password-hint' : ''}" required minlength="${setup ? 8 : 1}" maxlength="256" ${setupBlocked ? 'disabled' : ''}><button id="auth-show-password" class="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-4" type="button" aria-controls="auth-pass" aria-pressed="false" aria-label="Mostrar contraseña">${eyeIcon}</button></div>${setup ? '<p id="auth-password-hint" class="text-xs text-muted-foreground">Usa al menos 8 caracteres.</p>' : ''}<p id="auth-caps" class="text-xs text-muted-foreground" role="status" hidden>Bloq Mayús está activado.</p></div>
        ${codeRequired && !setupBlocked ? '<div class="grid gap-2"><label for="setup-token" class="flex justify-between text-sm font-medium"><span id="setup-token-label">Código de instalación</span><span class="text-xs font-normal text-muted-foreground" aria-hidden="true">Requerido</span></label><input id="setup-token" class="' + fieldClass + '" aria-labelledby="setup-token-label" type="password" autocomplete="off" required placeholder="Introduce tu código"></div>' : ''}
        <p id="auth-error" class="hidden rounded-lg border border-destructive p-3 text-sm text-destructive" role="alert" tabindex="-1"></p>
        <button id="auth-go" class="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 [&_svg]:size-4" type="submit" ${setupBlocked ? 'disabled' : ''}><span data-spinner class="hidden size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true"></span><span data-label>${setup ? 'Crear y entrar' : 'Entrar'}</span>${svg('<path d="M5 12h14m-5-5 5 5-5 5"/>')}</button>
      </form>
      <p class="my-4 text-center text-xs text-muted-foreground">${setup ? 'Tú eliges el usuario y la contraseña de esta cuenta.' : '¿Necesitas acceso? Contacta al administrador del sistema.'}</p>
    </section>
  </div>`;
  const themeIcons: Record<ThemeName, string> = {
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  };
  const themeLabels: Record<ThemeName, string> = { light: 'Claro', dark: 'Oscuro', system: 'Sistema' };
  const themeButton = $<HTMLButtonElement>('#auth-theme-button'), themeMenu = $('#auth-theme-menu'), themeIcon = themeButton.querySelector('[data-theme-icon]') as HTMLElement;
  const paintTheme = (): void => {
    const current = getSnapshot().preferences.theme as ThemeName;
    themeIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${themeIcons[current]}</svg>`;
    themeButton.setAttribute('aria-label', `Tema actual: ${themeLabels[current]}. Abrir selector de tema`);
    themeMenu.innerHTML = (Object.entries(themeLabels) as [ThemeName, string][]).map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${value === current}" data-theme-value="${value}" class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${themeIcons[value]}</svg>${label}${value === current ? '<span class="ml-auto" aria-hidden="true">✓</span>' : ''}</button>`).join('');
  };
  const setMenu = (open: boolean): void => {
    themeMenu.classList.toggle('hidden', !open);
    themeButton.setAttribute('aria-expanded', String(open));
    if (open) (themeMenu.querySelector('[role="menuitemradio"]') as HTMLElement | null)?.focus();
  };
  paintTheme();
  themeButton.addEventListener('click', () => setMenu(themeMenu.classList.contains('hidden')));
  themeMenu.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest('[data-theme-value]') as HTMLElement | null;
    if (!item) return;
    setTheme((item.dataset.themeValue as ThemeName | undefined) as 'light' | 'dark' | 'system'); paintTheme(); setMenu(false); themeButton.focus();
  });
  themeListeners?.abort();
  themeListeners = new AbortController();
  const { signal } = themeListeners;
  document.addEventListener('click', (event) => { if (!(event.target as HTMLElement).closest('#auth-theme-button,#auth-theme-menu')) setMenu(false); }, { signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !themeMenu.classList.contains('hidden')) { setMenu(false); themeButton.focus(); }
  }, { signal });
  syncThemeControls();
  ($<HTMLButtonElement>('#auth-show-password')).onclick = () => {
    const input = $<HTMLInputElement>('#auth-pass'), show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const toggle = $<HTMLButtonElement>('#auth-show-password');
    toggle.innerHTML = show ? eyeOffIcon : eyeIcon;
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  };
  for (const eventName of ['keyup', 'keydown'] as const) $<HTMLInputElement>('#auth-pass').addEventListener(eventName, (event) => { $<HTMLElement>('#auth-caps').hidden = !(event as KeyboardEvent).getModifierState('CapsLock'); });
  $<HTMLInputElement>('#auth-pass').addEventListener('blur', () => { $<HTMLElement>('#auth-caps').hidden = true; });
  ($<HTMLFormElement>('#auth-form')).onsubmit = async (event) => {
    event.preventDefault();
    const submit = $<HTMLButtonElement>('#auth-go'), label = $<HTMLElement>('#auth-go [data-label]'), spinner = $<HTMLElement>('#auth-go [data-spinner]'), error = $<HTMLElement>('#auth-error');
    const previous = label.textContent;
    submit.disabled = true;
    label.textContent = setup ? 'Creando tu cuenta…' : 'Ingresando…';
    spinner.classList.remove('hidden');
    ($<HTMLFormElement>('#auth-form')).setAttribute('aria-busy', 'true');
    error.textContent = ''; error.hidden = true;
    try {
      const credentials = { username: $<HTMLInputElement>('#auth-user').value.trim(), password: $<HTMLInputElement>('#auth-pass').value };
      if (setup) await request('auth/setup', credentials, { 'X-Setup-Token': (document.querySelector('#setup-token') as HTMLInputElement | null)?.value.trim() || '' });
      await request('auth/login', credentials);
      await onAuthenticated();
    } catch (err) {
      error.textContent = (err as Error).message; error.hidden = false; error.focus();
      submit.disabled = false; label.textContent = previous; spinner.classList.add('hidden');
      ($<HTMLFormElement>('#auth-form')).setAttribute('aria-busy', 'false');
    }
  };
}
