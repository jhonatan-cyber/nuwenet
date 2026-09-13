const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gb=bytes=>(Number(bytes)/1e9).toLocaleString('es-BO',{maximumFractionDigits:3,minimumFractionDigits:3});
const date=at=>at?new Date(at).toLocaleString('es-BO',{timeZone:'America/La_Paz'}):'Sin lecturas';
const currentMonth=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/La_Paz'}).slice(0,7);
const kinds={baseline:'Primera lectura de una cola',counter_reset:'Disminución de contador: posible reinicio',queue_changed:'Cola reemplazada: nueva lectura inicial',resumed:'Cola reaparecida: nueva lectura inicial',sampling_gap:'Más de 5 minutos entre lecturas',long_gap:'Más de 31 días sin lecturas: nueva lectura inicial'};

export function usageMarkup(includeControls=true){return `<section class="usage-widget" aria-label="Historial mensual de consumo">
  <style>.usage-widget{padding:1rem 0;color:inherit}.usage-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.usage-controls input{width:auto!important}.usage-summary{display:flex;gap:20px;flex-wrap:wrap;margin:18px 0}.usage-summary strong{display:block;font-size:1.35rem}.usage-summary small,.usage-note{opacity:.8}.usage-chart{width:100%;height:auto;min-height:160px;display:block}.usage-chart text{fill:currentColor;font:11px sans-serif}.usage-chart .usage-bar{cursor:pointer}.usage-chart .usage-bar:focus{outline:2px solid currentColor}.usage-widget table{width:100%;border-collapse:collapse;font-size:.85rem}.usage-widget th,.usage-widget td{padding:7px;text-align:left;border-bottom:1px solid #8884}.usage-detail{min-height:2.5em}.usage-error{color:#c64a3d}.usage-legend{display:flex;gap:20px}.usage-dot{display:inline-block;width:10px;height:10px;margin-right:5px}.usage-table{overflow:auto;max-height:360px}.usage-events{font-size:.85rem;max-height:160px;overflow:auto}.usage-summary p{margin:0}</style>
  ${includeControls?`<div class="usage-controls"><h3>Consumo mensual</h3><label>Mes <input data-usage-month type="month" min="2000-01" max="${currentMonth()}" value="${currentMonth()}"></label><button type="button" data-usage-refresh>Actualizar</button></div>`:''}
  <p class="usage-note">Hora de Bolivia · GB decimales · Lecturas automáticas cada minuto mientras el servidor está activo.</p>
  <p data-usage-error class="usage-error" role="alert"></p><div data-usage-content aria-live="polite">Consultando historial…</div>
</section>`;}

function renderHistory(data){
  const total=data.totals, max=Math.max(1,...data.days.map(d=>d.download_bytes+d.upload_bytes));
  const barWidth=800/data.days.length;
  const bars=data.days.map((d,i)=>{
    const x=45+i*barWidth,up=d.upload_bytes/max*160,down=d.download_bytes/max*160;
    const label=d.observed?`${d.date}: bajada ${gb(d.download_bytes)} GB, subida ${gb(d.upload_bytes)} GB${d.resets?', posible reinicio':''}${d.estimated_bytes?', distribución estimada':''}`:`${d.date}: sin lecturas`;
    return `<g class="usage-bar" tabindex="0" role="button" aria-label="${escape(label)}" data-usage-day="${d.date}"><title>${escape(label)}</title><rect x="${x}" y="30" width="${barWidth-3}" height="163" fill="transparent"/><rect x="${x}" y="${190-down}" width="${barWidth-3}" height="${down}" fill="#238acb"/><rect x="${x}" y="${190-down-up}" width="${barWidth-3}" height="${up}" fill="#b275db"/>${!d.observed?`<line x1="${x}" y1="192" x2="${x+barWidth-3}" y2="192" stroke="#888" stroke-dasharray="2 2"/>`:''}${d.resets?`<circle cx="${x+barWidth/2}" cy="20" r="4" fill="#e9a52e"/>`:''}<text x="${x+barWidth/2}" y="209" text-anchor="middle">${i+1}</text></g>`;
  }).join('');
  const router=data.coverage.router,status={not_configured:'Sin MikroTik central configurado.',waiting:'Esperando la primera lectura del router.',unavailable:'La última consulta al router falló.',partial:'La última consulta contiene contadores inválidos.'}[router.status]||'';
  const stale=data.coverage.last_sample&&Date.now()-Date.parse(data.coverage.last_sample)>5*60_000;
  return `<div class="usage-summary"><p><small>Bajada</small><strong>${gb(total.download_bytes)} GB</strong></p><p><small>Subida</small><strong>${gb(total.upload_bytes)} GB</strong></p><p><small>Total registrado</small><strong>${gb(total.download_bytes+total.upload_bytes)} GB</strong></p><p><small>Posibles reinicios / interrupciones</small><strong>${total.resets} / ${total.gaps}</strong></p></div>
  <p>${escape(status)} ${stale?'Las lecturas del departamento no están actualizadas.':''}</p>
  <p class="usage-note">Última lectura: ${escape(date(data.coverage.last_sample))}. Inicio del registro: ${escape(date(data.coverage.first_sample))}.</p>
  ${!data.days.some(d=>d.observed)?'<p role="status">Sin mediciones para este mes. El historial comienza con la primera lectura; no recupera consumo anterior.</p>':''}
  <div class="usage-legend"><span><i class="usage-dot" style="background:#238acb"></i>Bajada</span><span><i class="usage-dot" style="background:#b275db"></i>Subida</span><span>● Posible reinicio</span></div>
  <svg class="usage-chart" viewBox="0 0 870 230" role="group" aria-label="Consumo diario en GB; selecciona un día para ver detalles"><text x="0" y="32">${gb(max)}</text><text x="15" y="193">0</text><line x1="42" y1="190" x2="845" y2="190" stroke="#8885"/>${bars}</svg>
  <p data-usage-detail class="usage-detail">Selecciona un día en la gráfica o consulta la tabla.</p>
  <p class="usage-note">${gb(total.estimated_bytes)} GB con distribución estimada: intervalos entre días, pausas o reinicios. Un reinicio puede perder tráfico no observado; los totales no son una medición certificada para facturación.</p>
  <details><summary>Detalle diario accesible</summary><div class="usage-table"><table><thead><tr><th>Día</th><th>Bajada GB</th><th>Subida GB</th><th>Observaciones</th></tr></thead><tbody>${data.days.map(d=>`<tr><td>${d.date}</td><td>${d.observed?gb(d.download_bytes):'—'}</td><td>${d.observed?gb(d.upload_bytes):'—'}</td><td>${!d.observed?'Sin lecturas':`${d.resets} reinicios · ${d.gaps} interrupciones${d.estimated_bytes?' · estimado':''}`}</td></tr>`).join('')}</tbody></table></div></details>
  <details><summary>Eventos de medición (${data.events.length})</summary><ul class="usage-events">${data.events.map(e=>`<li>${escape(date(e.detected_at))} · ${escape(kinds[e.kind]||e.kind)}</li>`).join('')||'<li>Sin eventos registrados en este mes.</li>'}</ul></details>`;
}

export function mountUsage(root,fetchHistory){
  const input=root.querySelector('[data-usage-month]'),refresh=root.querySelector('[data-usage-refresh]'),content=root.querySelector('[data-usage-content]'),error=root.querySelector('[data-usage-error]');
  let revision=0,data,stopped=false,busy=false;
  const dialog=root.closest('dialog');
  async function load(){
    const version=++revision,month=input.value;
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){error.textContent='Selecciona un mes válido.';return;}
    busy=true;refresh.disabled=true;error.textContent='';
    try{const result=await fetchHistory(month);if(stopped||version!==revision||!root.isConnected)return;data=result;content.innerHTML=renderHistory(data);}
    catch(err){if(!stopped&&version===revision)error.textContent=err.message||'No se pudo consultar el historial.';}
    finally{if(version===revision){busy=false;refresh.disabled=false;}}
  }
  const showDay=event=>{const target=event.target.closest('[data-usage-day]');if(!target||!data)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();const day=data.days.find(d=>d.date===target.dataset.usageDay);root.querySelector('[data-usage-detail]').textContent=day.observed?`${day.date} · Bajada ${gb(day.download_bytes)} GB · Subida ${gb(day.upload_bytes)} GB · ${day.resets} posibles reinicios · ${day.gaps} interrupciones`:`${day.date}: sin lecturas.`;};
  input.addEventListener('change',load);refresh.addEventListener('click',load);content.addEventListener('click',showDay);content.addEventListener('keydown',showDay);
  const stop=()=>{stopped=true;revision++;clearInterval(timer);input.removeEventListener('change',load);refresh.removeEventListener('click',load);content.removeEventListener('click',showDay);content.removeEventListener('keydown',showDay);dialog?.removeEventListener('close',stop);window.removeEventListener('pagehide',stop);};
  const timer=setInterval(()=>{if(!root.isConnected||(dialog&&!dialog.open)){stop();return;}if(!document.hidden&&!busy)void load();},60_000);
  dialog?.addEventListener('close',stop,{once:true});window.addEventListener('pagehide',stop,{once:true});
  void load();return stop;
}
