import {usageMarkup,mountUsage} from './usage.js';
import {receiptHtml,printReceipt,bankHtml,updateBankQr} from './receipt.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let portalData;
// portal.js — Lógica del Portal del Residente
// Acceso mediante URL pública: /portal?token=XXXX

const params = new URLSearchParams(location.search);
// Multi-departamento: ?token=A,B o ?token=A&token=B. Se recuerdan en este navegador.
const STORAGE_KEY = 'nuwenet-portal-tokens';
const PARAM_TOKENS = params.getAll('token').flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
function loadStoredTokens() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter(t => typeof t === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(t)) : [];
  } catch { return []; }
}
function saveStoredTokens(tokens) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens.slice(0, 10))); } catch { /* almacenamiento no disponible */ }
}
let storedTokens = loadStoredTokens();
if (PARAM_TOKENS.length) {
  const valid = PARAM_TOKENS.filter(t => /^[a-zA-Z0-9_-]{43}$/.test(t));
  storedTokens = [...valid, ...storedTokens.filter(t => !valid.includes(t))];
  saveStoredTokens(storedTokens);
}
let TOKEN = PARAM_TOKENS[0] || storedTokens[0] || '';
if (TOKEN && !PARAM_TOKENS.length) {
  const url = new URL(location.href);
  url.searchParams.set('token', TOKEN);
  history.replaceState(null, '', url);
}

const $ = id => document.getElementById(id);
const loadingEl = $('portal-loading');
const errorEl   = $('portal-error');
const errorMsg  = $('error-msg');
const content   = $('portal-content');
const switchWrap = $('portal-switch-wrap');
const switchSelect = $('portal-dept-switch');

async function fetchDeptLabel(token) {
  try {
    const data = await apiGet(`/portal?token=${encodeURIComponent(token)}`);
    const c = data.customer || {};
    return { token, label: `${c.building_name ? c.building_name + ' · ' : ''}${c.apartment || 'Departamento'}${c.name ? ' — ' + c.name : ''}` };
  } catch {
    return { token, label: `Departamento …${token.slice(-4)}` };
  }
}

async function buildSwitcher() {
  if (!switchWrap || !switchSelect) return;
  const tokens = [...new Set([TOKEN, ...storedTokens].filter(Boolean))].slice(0, 10);
  if (tokens.length < 2) { switchWrap.style.display = 'none'; return; }
  switchWrap.style.display = 'flex';
  switchSelect.innerHTML = '<option>Cargando…</option>';
  const labels = await Promise.all(tokens.map(fetchDeptLabel));
  switchSelect.innerHTML = labels.map(({ token, label }) =>
    `<option value="${escape(token)}" ${token === TOKEN ? 'selected' : ''}>${escape(label)}</option>`).join('');
}

switchSelect?.addEventListener('change', e => {
  const next = e.target.value;
  if (next && next !== TOKEN) {
    const url = new URL(location.href);
    url.searchParams.set('token', next);
    location.href = url.toString();
  }
});

$('portal-forget')?.addEventListener('click', () => {
  storedTokens = storedTokens.filter(t => t !== TOKEN);
  saveStoredTokens(storedTokens);
  const next = storedTokens[0];
  if (next) {
    const url = new URL(location.href);
    url.searchParams.set('token', next);
    location.href = url.toString();
  } else {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    const url = new URL(location.href);
    url.searchParams.delete('token');
    location.href = url.toString();
  }
});

async function apiGet(path) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Error ${res.status}`);
  }
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || `Error ${res.status}`);
  return body;
}

function fmtMoney(cents, currency = '') {
  const val = (cents / 100).toFixed(2);
  return currency ? `${currency} ${val}` : val;
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(`${s.slice(0,10)}T12:00:00Z`).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

function renderInvoices(invoices) {
  const tbody = $('invoices-body');
  if (!invoices || invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem">Sin facturas registradas.</td></tr>';
    return;
  }
  tbody.innerHTML = invoices.map(inv => {
    const paid = !!inv.paid_at;
    const statusLabel = paid
      ? `<span class="badge badge-green">✓ Pagado</span>`
      : `<span class="badge badge-red">Pendiente</span>`;
    return `<tr>
      <td style="color:var(--muted)">#${inv.id}</td>
      <td style="font-weight:500">${escape(inv.period)}</td>
      <td class="${paid ? 'paid' : 'pending-inv'}">${fmtDate(inv.due)}</td>
      <td>${fmtMoney(inv.amount,portalData.currency)}<small> · Saldo ${fmtMoney(inv.amount-Number(inv.paid_total),portalData.currency)}</small></td>
      <td>${statusLabel}</td>
    </tr>`;
  }).join('');
}

function renderReports(reports) {
  const el = $('reports-list');
  if (!reports || reports.length === 0) { el.innerHTML = ''; return; }
  const colors = { pending: 'var(--yellow)', approved: 'var(--green)', rejected: 'var(--red)' };
  const labels = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
  el.innerHTML = `
    <p style="font-size:.8rem;color:var(--muted);margin-bottom:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Tus reportes anteriores</p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${reports.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.65rem 1rem;background:var(--bg3);border-radius:8px;font-size:.85rem">
          <span>Ref. <strong>${escape(r.reference)}</strong> · ${fmtMoney(r.amount,portalData.currency)}</span>
          <span style="color:${colors[r.status] || 'var(--muted)'}">● ${labels[r.status] || r.status}</span>
        </div>`).join('')}
    </div>`;
}

async function load() {
  if (!TOKEN) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'flex';
    errorMsg.textContent = 'Token no encontrado. Usa el enlace que te envió el administrador.';
    return;
  }
  try {
    const data = await apiGet(`/portal?token=${encodeURIComponent(TOKEN)}`);
    portalData=data;
    $('usage-history').innerHTML=usageMarkup();
    mountUsage($('usage-history').querySelector('.usage-widget'),month=>apiGet(`/portal/usage?token=${encodeURIComponent(TOKEN)}&month=${encodeURIComponent(month)}`));
    const { customer, invoices, paymentReports } = data;
    $('bank-details').innerHTML=bankHtml(data.bank,invoices.reduce((n,i)=>n+i.amount-Number(i.paid_total),0),data.currency);
    void updateBankQr($('bank-details'),data.bank,invoices.reduce((n,i)=>n+i.amount-Number(i.paid_total),0));
    $('payments-list').innerHTML=data.payments.map(p=>`<div>${receiptHtml(p,data.currency)}<button type="button" data-receipt="${p.id}">Imprimir recibo</button></div>`).join('')||'<p>Sin pagos registrados.</p>';
    $('bank-contact').textContent=data.bank.contact||'';

    $('building-name').textContent = customer.building_name || '';
    $('p-apt').textContent   = customer.apartment;
    $('p-name').textContent  = customer.name || 'Vacío · sin titular';
    $('p-plan').textContent  = customer.plan_name || 'Sin plan';
    $('p-speed').textContent = customer.down != null && customer.up != null ? `↓${customer.down} / ↑${customer.up} Mbps` : 'Sin velocidad asignada';

    const statusEl = $('p-status');
    if (customer.status === 'active') {
      statusEl.innerHTML = '<span class="badge badge-green">● Activo</span>';
    } else {
      statusEl.innerHTML = '<span class="badge badge-red">● Suspendido</span>';
    }

    renderInvoices(invoices);
    renderReports(paymentReports);

    loadingEl.style.display = 'none';
    content.style.display   = 'block';
    void buildSwitcher();
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'flex';
    errorMsg.textContent    = err.message || 'No se pudo cargar tu portal. Verifica el enlace.';
  }
}

// Report form submission
$('report-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn   = $('rep-btn');
  const alert = $('rep-alert');
  const amount    = parseFloat($('rep-amount').value);
  const reference = $('rep-ref').value.trim();
  const notes     = $('rep-notes').value.trim();

  if (!reference || amount <= 0) return;
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  alert.style.display = 'none';

  try {
    await apiPost('/portal/report', { token: TOKEN, amount, reference, notes: notes || undefined });
    alert.className = 'alert alert-ok';
    alert.textContent = '✓ Reporte enviado. El administrador lo revisará pronto.';
    alert.style.display = 'block';
    e.target.reset();
    // Refresh reports list
    const data = await apiGet(`/portal?token=${encodeURIComponent(TOKEN)}`);
    renderReports(data.paymentReports);
  } catch (err) {
    alert.className = 'alert alert-err';
    alert.textContent = err.message || 'No se pudo enviar el reporte.';
    alert.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar reporte';
  }
});

load();

$('payments-list').addEventListener('click',event=>{const button=event.target.closest('[data-receipt]');if(!button)return;const p=portalData.payments.find(p=>p.id===Number(button.dataset.receipt));if(p)printReceipt(p,portalData.currency,Number($('ticket-width').value));});
let trafficTimer;
async function traffic(){
  if(!TOKEN || document.hidden)return;
  try {const data=await apiGet(`/portal/traffic?token=${encodeURIComponent(TOKEN)}`);$('p-traffic').textContent=data.available?data.stats.map(s=>`Bajada ${(s.downloadRate/1e6).toFixed(2)} / Subida ${(s.uploadRate/1e6).toFixed(2)} Mbps - ${((s.downloadBytes+s.uploadBytes)/1e9).toFixed(3)} GB`).join(' | ')||'Sin cola registrada':'Consumo no disponible';}catch{$('p-traffic').textContent='Consumo no disponible';}
}
traffic();trafficTimer=setInterval(traffic,10000);window.addEventListener('pagehide',()=>clearInterval(trafficTimer));
