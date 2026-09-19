import { escape } from '../../lib/html';
import { buttonOutline, input, mutedNote, table, tableHead, tableCell } from '../../lib/shadcn';

export interface UsageDay {
  date: string;
  download_bytes: number;
  upload_bytes: number;
  resets: number;
  gaps: number;
  estimated_bytes: number;
  observed: boolean;
}
export interface UsageEvent {
  detected_at: string;
  kind: string;
}
export interface UsageHistory {
  totals: { download_bytes: number; upload_bytes: number; resets: number; gaps: number; estimated_bytes: number };
  days: UsageDay[];
  events: UsageEvent[];
  coverage: {
    router: { status: string };
    last_sample: string | null;
    first_sample: string | null;
  };
}

const gb = (bytes: number | string): string => (Number(bytes) / 1e9).toLocaleString('es-BO', { maximumFractionDigits: 3, minimumFractionDigits: 3 });
const date = (at: string | null | undefined): string => at ? new Date(at).toLocaleString('es-BO', { timeZone: 'America/La_Paz' }) : 'Sin lecturas';
const currentMonth = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }).slice(0, 7);
const kinds: Record<string, string> = { baseline: 'Primera lectura de una cola', counter_reset: 'Disminución de contador: posible reinicio', queue_changed: 'Cola reemplazada: nueva lectura inicial', resumed: 'Cola reaparecida: nueva lectura inicial', sampling_gap: 'Más de 5 minutos entre lecturas', long_gap: 'Más de 31 días sin lecturas: nueva lectura inicial' };
const note = mutedNote;
const controlButton = buttonOutline;

export function usageMarkup(includeControls = true): string {return `<section data-usage class="py-6" aria-label="Historial mensual de consumo">
  ${includeControls?`<div class="flex flex-wrap items-center gap-5"><h3 class="text-sm font-semibold">Consumo mensual</h3><label class="flex items-center gap-2 text-sm">Mes <input data-usage-month type="month" class="${input}" min="2000-01" max="${currentMonth()}" value="${currentMonth()}"></label><button type="button" class="${controlButton}" data-usage-refresh>Actualizar</button></div>`:''}
  <p class="my-3 ${note}">Hora de Bolivia · GB decimales · Lecturas automáticas cada minuto mientras el servidor está activo.</p>
  <p data-usage-error class="text-sm text-destructive" role="alert"></p><div data-usage-content aria-live="polite">Consultando historial…</div>
</section>`;}

function renderHistory(data: UsageHistory): string {
  const total=data.totals, max=Math.max(1,...data.days.map(d=>d.download_bytes+d.upload_bytes));
  const barWidth=800/data.days.length;
  const bars=data.days.map((d,i)=>{
    const x=45+i*barWidth,up=d.upload_bytes/max*160,down=d.download_bytes/max*160;
    const label=d.observed?`${d.date}: bajada ${gb(d.download_bytes)} GB, subida ${gb(d.upload_bytes)} GB${d.resets?', posible reinicio':''}${d.estimated_bytes?', distribución estimada':''}`:`${d.date}: sin lecturas`;
    return `<g class="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring" tabindex="0" role="button" aria-label="${escape(label)}" data-usage-day="${d.date}"><title>${escape(label)}</title><rect x="${x}" y="30" width="${barWidth-3}" height="163" fill="transparent"/><rect x="${x}" y="${190-down}" width="${barWidth-3}" height="${down}" fill="var(--chart-1)"/><rect x="${x}" y="${190-down-up}" width="${barWidth-3}" height="${up}" fill="var(--chart-2)"/>${!d.observed?`<line x1="${x}" y1="192" x2="${x+barWidth-3}" y2="192" stroke="#888" stroke-dasharray="2 2"/>`:''}${d.resets?`<circle cx="${x+barWidth/2}" cy="20" r="4" fill="#e9a52e"/>`:''}<text class="fill-current text-[11px]" x="${x+barWidth/2}" y="209" text-anchor="middle">${i+1}</text></g>`;
  }).join('');
  const router=data.coverage.router,status={not_configured:'Sin MikroTik central configurado.',waiting:'Esperando la primera lectura del router.',unavailable:'La última consulta al router falló.',partial:'La última consulta contiene contadores inválidos.'}[router.status]||'';
  const stale=data.coverage.last_sample&&Date.now()-Date.parse(data.coverage.last_sample)>5*60_000;
  return `<div class="my-5 flex flex-wrap items-center gap-5"><p><small class="block text-sm text-muted-foreground">Bajada</small><strong class="block text-xl">${gb(total.download_bytes)} GB</strong></p><p><small class="block text-sm text-muted-foreground">Subida</small><strong class="block text-xl">${gb(total.upload_bytes)} GB</strong></p><p><small class="block text-sm text-muted-foreground">Total registrado</small><strong class="block text-xl">${gb(total.download_bytes+total.upload_bytes)} GB</strong></p><p><small class="block text-sm text-muted-foreground">Posibles reinicios / interrupciones</small><strong class="block text-xl">${total.resets} / ${total.gaps}</strong></p></div>
  <p>${escape(status)} ${stale?'Las lecturas del departamento no están actualizadas.':''}</p>
  <p class="my-3 ${note}">Última lectura: ${escape(date(data.coverage.last_sample))}. Inicio del registro: ${escape(date(data.coverage.first_sample))}.</p>
  ${!data.days.some(d=>d.observed)?'<p role="status">Sin mediciones para este mes. El historial comienza con la primera lectura; no recupera consumo anterior.</p>':''}
  <div class="flex flex-wrap items-center gap-5"><span><i class="mr-1.5 inline-block size-2.5 rounded-full bg-chart-1"></i>Bajada</span><span><i class="mr-1.5 inline-block size-2.5 rounded-full bg-chart-2"></i>Subida</span><span>● Posible reinicio</span></div>
  <svg class="mt-2 block h-auto min-h-40 w-full" viewBox="0 0 870 230" role="group" aria-label="Consumo diario en GB; selecciona un día para ver detalles"><text class="fill-current text-[11px]" x="0" y="32">${gb(max)}</text><text class="fill-current text-[11px]" x="15" y="193">0</text><line x1="42" y1="190" x2="845" y2="190" stroke="#8885"/>${bars}</svg>
  <p data-usage-detail class="min-h-10 text-sm">Selecciona un día en la gráfica o consulta la tabla.</p>
  <p class="my-3 ${note}">${gb(total.estimated_bytes)} GB con distribución estimada: intervalos entre días, pausas o reinicios. Un reinicio puede perder tráfico no observado; los totales no son una medición certificada para facturación.</p>
  <details class="mt-4"><summary class="cursor-pointer font-medium">Detalle diario accesible</summary><div class="max-h-90 overflow-auto rounded-lg border"><table class="${table} text-left"><thead><tr><th class="${tableHead}">Día</th><th class="${tableHead}">Bajada GB</th><th class="${tableHead}">Subida GB</th><th class="${tableHead}">Observaciones</th></tr></thead><tbody>${data.days.map(d=>`<tr><td class="${tableCell}">${d.date}</td><td class="${tableCell}">${d.observed?gb(d.download_bytes):'—'}</td><td class="${tableCell}">${d.observed?gb(d.upload_bytes):'—'}</td><td class="${tableCell}">${!d.observed?'Sin lecturas':`${d.resets} reinicios · ${d.gaps} interrupciones${d.estimated_bytes?' · estimado':''}`}</td></tr>`).join('')}</tbody></table></div></details>
  <details class="mt-4"><summary class="cursor-pointer font-medium">Eventos de medición (${data.events.length})</summary><ul class="max-h-40 overflow-auto text-[13px]">${data.events.map(e=>`<li>${escape(date(e.detected_at))} · ${escape(kinds[e.kind]||e.kind)}</li>`).join('')||'<li>Sin eventos registrados en este mes.</li>'}</ul></details>`;
}

export function mountUsage(root: Element, fetchHistory: (month: string) => Promise<UsageHistory>): () => void {
  const input = root.querySelector('[data-usage-month]') as HTMLInputElement;
  const refresh = root.querySelector('[data-usage-refresh]') as HTMLButtonElement;
  const content = root.querySelector('[data-usage-content]') as HTMLElement;
  const error = root.querySelector('[data-usage-error]') as HTMLElement;
  let revision = 0, stopped = false, busy = false;
  let data: UsageHistory | undefined;
  const dialog = root.closest('dialog');
  async function load(): Promise<void> {
    const version = ++revision, month = input.value;
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) { error.textContent = 'Selecciona un mes válido.'; return; }
    busy = true; refresh.disabled = true; error.textContent = '';
    try { const result = await fetchHistory(month); if (stopped || version !== revision || !root.isConnected) return; data = result; content.innerHTML = renderHistory(data); }
    catch (err) { if (!stopped && version === revision) error.textContent = (err as Error).message || 'No se pudo consultar el historial.'; }
    finally { if (version === revision) { busy = false; refresh.disabled = false; } }
  }
  const showDay = (event: Event): void => {
    const target = (event.target as HTMLElement).closest('[data-usage-day]');
    if (!target || !data) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return;
    event.preventDefault();
    const day = data.days.find((d) => d.date === (target as HTMLElement).dataset.usageDay);
    if (!day) return;
    (root.querySelector('[data-usage-detail]') as HTMLElement).textContent = day.observed ? `${day.date} · Bajada ${gb(day.download_bytes)} GB · Subida ${gb(day.upload_bytes)} GB · ${day.resets} posibles reinicios · ${day.gaps} interrupciones` : `${day.date}: sin lecturas.`;
  };
  input.addEventListener('change',load);refresh.addEventListener('click',load);content.addEventListener('click',showDay);content.addEventListener('keydown',showDay);
  const stop=()=>{stopped=true;revision++;clearInterval(timer);input.removeEventListener('change',load);refresh.removeEventListener('click',load);content.removeEventListener('click',showDay);content.removeEventListener('keydown',showDay);dialog?.removeEventListener('close',stop);window.removeEventListener('pagehide',stop);};
  const timer=setInterval(()=>{if(!root.isConnected||(dialog&&!dialog.open)){stop();return;}if(!document.hidden&&!busy)void load();},60_000);
  dialog?.addEventListener('close',stop,{once:true});window.addEventListener('pagehide',stop,{once:true});
  void load();return stop;
}
