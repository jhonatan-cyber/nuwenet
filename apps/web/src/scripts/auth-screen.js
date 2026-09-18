import { setTheme, syncThemeControls } from './account.js';
import { emptyMarkup, escape } from '../lib/html.js';

const $ = selector => document.querySelector(selector);
const svg = inner => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const fieldClass = 'h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

/** Login and first-run screen. Owns #view while no session is open. */
export async function renderAuthScreen({ request, onAuthenticated }) {
  const view = $('#view');
  view.hidden = false;
  let status;
  try { status = await request('auth/status'); }
  catch (error) { view.innerHTML = emptyMarkup(escape(error.message)); return; }
  const setup = status.users === 0, codeRequired = setup && status.setup_code_required, setupBlocked = setup && status.setup_available === false;
  $('#breadcrumb').textContent = setup ? 'Crear super-admin' : 'Iniciar sesión';
  document.body.classList.add('setup-screen');
  const mark = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 16a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>`;
  view.innerHTML = `<div class="rounded-xl border bg-card p-8 shadow-sm max-[700px]:p-6">
    <section class="mb-7" aria-label="NuweNet">
      <a class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight" href="/" aria-label="NuweNet, inicio"><span class="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground [&_svg]:size-6">${mark}</span><span>Nuwe<strong>Net</strong></span></a>
    </section>
    <section aria-labelledby="auth-title">
      <div class="flex justify-between gap-2 text-[10px] tracking-wider text-muted-foreground"><span>${setup?'CONFIGURACIÓN INICIAL':'ACCESO AL PANEL'}</span><span class="inline-flex items-center gap-1 [&_svg]:size-3 max-[700px]:hidden">${svg('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0"/>')} Acceso privado</span></div>
      <div class="my-6">${setup?'':'<h1 id="auth-title" class="text-2xl font-semibold">Bienvenido de nuevo</h1><p class="mt-2 text-sm text-muted-foreground">Ingresa tus credenciales para continuar con la administración de tu edificio.</p>'}</div>
      ${setupBlocked?'<div class="my-4 rounded-lg border border-destructive p-3 text-sm text-destructive" role="status">La instalación aún no está lista para crear tu cuenta desde esta dirección. Contacta a quien instaló NuweNet.</div>':''}
      <form id="auth-form" class="grid gap-5" aria-describedby="auth-error">
        <div class="grid gap-2"><label for="auth-user" class="text-sm font-medium">Usuario</label><div class="relative [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-3 [&>svg]:left-3 [&>svg]:size-4 [&>svg]:text-muted-foreground">${svg('<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>')}<input id="auth-user" name="username" class="${fieldClass} pl-9" placeholder="${setup?'Elige un nombre de usuario':'Tu nombre de usuario'}" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="160" ${setupBlocked?'disabled':''}></div></div>
        <div class="grid gap-2"><label for="auth-pass" class="text-sm font-medium">Contraseña</label><div class="relative [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:top-3 [&>svg]:left-3 [&>svg]:size-4 [&>svg]:text-muted-foreground">${svg('<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0"/>')}<input id="auth-pass" name="password" type="password" class="${fieldClass} pl-9 pr-20" placeholder="${setup?'Crea una contraseña':'Ingresa tu contraseña'}" autocomplete="${setup?'new-password':'current-password'}" aria-describedby="auth-caps${setup?' auth-password-hint':''}" required minlength="${setup?8:1}" maxlength="256" ${setupBlocked?'disabled':''}><button id="auth-show-password" class="absolute top-1 right-1 h-8 rounded-md px-2 text-xs font-medium hover:bg-muted" type="button" aria-controls="auth-pass" aria-pressed="false" aria-label="Mostrar contraseña">Mostrar</button></div>${setup?'<p id="auth-password-hint" class="text-xs text-muted-foreground">Usa al menos 8 caracteres.</p>':''}<p id="auth-caps" class="text-xs text-muted-foreground" role="status" hidden>Bloq Mayús está activado.</p></div>
        ${codeRequired&&!setupBlocked?'<div class="grid gap-2"><label for="setup-token" class="flex justify-between text-sm font-medium"><span id="setup-token-label">Código de instalación</span><span class="text-xs font-normal text-muted-foreground" aria-hidden="true">Requerido</span></label><input id="setup-token" class="'+fieldClass+'" aria-labelledby="setup-token-label" type="password" autocomplete="off" required placeholder="Introduce tu código"></div>':''}
        <p id="auth-error" class="hidden rounded-lg border border-destructive p-3 text-sm text-destructive" role="alert" tabindex="-1"></p>
        <button id="auth-go" class="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 [&_svg]:size-4" type="submit" ${setupBlocked?'disabled':''}><span data-spinner class="hidden size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true"></span><span data-label>${setup?'Crear y entrar':'Entrar'}</span>${svg('<path d="M5 12h14m-5-5 5 5-5 5"/>')}</button>
      </form>
      <p class="my-4 text-center text-xs text-muted-foreground">${setup?'Tú eliges el usuario y la contraseña de esta cuenta.':'¿Necesitas acceso? Contacta al administrador del sistema.'}</p>
      <div class="grid gap-4 border-t pt-5 text-center"><fieldset class="flex justify-center gap-1"><legend class="mb-2 text-xs text-muted-foreground">Apariencia</legend>${[['light','Claro'],['dark','Oscuro'],['system','Sistema']].map(([value,label])=>`<label class="relative cursor-pointer"><input class="peer sr-only" type="radio" name="theme-choice" value="${value}"><span class="block rounded-md px-3 py-1.5 text-xs peer-checked:bg-muted peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">${label}</span></label>`).join('')}</fieldset><span class="text-xs text-muted-foreground">NuweNet · Gestión de internet</span></div>
    </section>
  </div>`;
  document.querySelectorAll('#view input[name="theme-choice"]').forEach(radio => radio.addEventListener('change', () => setTheme(radio.value)));
  syncThemeControls();
  $('#auth-show-password').onclick = () => {
    const input = $('#auth-pass'), show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const toggle = $('#auth-show-password');
    toggle.textContent = show ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
  };
  for (const eventName of ['keyup', 'keydown']) $('#auth-pass').addEventListener(eventName, event => { $('#auth-caps').hidden = !event.getModifierState('CapsLock'); });
  $('#auth-pass').addEventListener('blur', () => { $('#auth-caps').hidden = true; });
  $('#auth-form').onsubmit = async event => {
    event.preventDefault();
    const submit = $('#auth-go'), label = $('#auth-go [data-label]'), spinner = $('#auth-go [data-spinner]'), error = $('#auth-error');
    const previous = label.textContent;
    submit.disabled = true;
    label.textContent = setup ? 'Creando tu cuenta…' : 'Ingresando…';
    spinner.classList.remove('hidden');
    $('#auth-form').setAttribute('aria-busy', 'true');
    error.textContent = ''; error.hidden = true;
    try {
      const credentials = { username: $('#auth-user').value.trim(), password: $('#auth-pass').value };
      if (setup) await request('auth/setup', credentials, { 'X-Setup-Token': $('#setup-token')?.value.trim() || '' });
      await request('auth/login', credentials);
      await onAuthenticated();
    } catch (err) {
      error.textContent = err.message; error.hidden = false; error.focus();
      submit.disabled = false; label.textContent = previous; spinner.classList.add('hidden');
      $('#auth-form').setAttribute('aria-busy', 'false');
    }
  };
}
