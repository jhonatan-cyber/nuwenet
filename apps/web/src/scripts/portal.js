import {usageMarkup,mountUsage} from './usage.js';
import {receiptHtml,printReceipt} from './receipt.js';
import { escape } from '../lib/html.js';
import { badge, badgeSuccess, badgeDestructive, buttonOutline, tableCell } from '../lib/shadcn.js';
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

async function apiGet(path, signal) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Error ${res.status}`);
  }
  return res.json();
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
    tbody.innerHTML = `<tr><td colspan="5" class="${tableCell} text-center text-muted-foreground">Sin facturas registradas.</td></tr>`;
    return;
  }
  tbody.innerHTML = invoices.map(inv => {
    const paid = !!inv.paid_at;
    const statusLabel = paid
      ? `<span class="${badgeSuccess}">✓ Pagado</span>`
      : `<span class="${badgeDestructive}">Pendiente</span>`;
    return `<tr>
      <td class="${tableCell} text-muted-foreground">#${inv.id}</td>
      <td class="${tableCell} font-medium">${escape(inv.period)}</td>
      <td class="${tableCell} ${paid ? 'text-success' : 'text-destructive'}">${fmtDate(inv.due)}</td>
      <td class="${tableCell}">${fmtMoney(inv.amount,portalData.currency)}<small class="block text-sm text-muted-foreground">Saldo ${fmtMoney(inv.amount-Number(inv.paid_total),portalData.currency)}</small></td>
      <td class="${tableCell}">${statusLabel}</td>
    </tr>`;
  }).join('');
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
    mountUsage($('usage-history').querySelector('[data-usage]'),month=>apiGet(`/portal/usage?token=${encodeURIComponent(TOKEN)}&month=${encodeURIComponent(month)}`));
    const { customer, invoices } = data;
    $('payments-list').innerHTML=data.payments.map(p=>`<div class="border-b py-4 last:border-0">${receiptHtml(p,data.currency)}<button type="button" class="${buttonOutline} mt-3" data-receipt="${p.id}">Imprimir recibo</button></div>`).join('')||'<p class="text-sm text-muted-foreground">Sin pagos registrados.</p>';

    $('building-name').textContent = customer.building_name || '';
    $('p-apt').textContent   = customer.apartment;
    $('p-name').textContent  = customer.name || 'Vacío · sin titular';
    $('p-plan').textContent  = customer.plan_name || 'Sin plan';
    $('p-speed').textContent = customer.down != null && customer.up != null ? `↓${customer.down} / ↑${customer.up} Mbps` : 'Sin velocidad asignada';

    const statusEl = $('p-status');
    if (customer.status === 'active') {
      statusEl.innerHTML = `<span class="${badgeSuccess}">● Activo</span>`;
    } else {
      statusEl.innerHTML = `<span class="${badgeDestructive}">● Suspendido</span>`;
    }

    renderInvoices(invoices);

    loadingEl.style.display = 'none';
    content.style.display   = 'block';
    void buildSwitcher();
  } catch (err) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'flex';
    errorMsg.textContent    = err.message || 'No se pudo cargar tu portal. Verifica el enlace.';
  }
}

load();

$('payments-list').addEventListener('click',event=>{const button=event.target.closest('[data-receipt]');if(!button)return;const p=portalData.payments.find(p=>p.id===button.dataset.receipt);if(p)printReceipt(p,portalData.currency,Number($('ticket-width').value));});
let trafficTimer,trafficController;
async function traffic(){
  if(!TOKEN || document.hidden || trafficController)return;
  const controller=new AbortController();trafficController=controller;
  try {const data=await apiGet(`/portal/traffic?token=${encodeURIComponent(TOKEN)}`,controller.signal);$('p-traffic').textContent=data.available?data.stats.map(s=>`Bajada ${(s.downloadRate/1e6).toFixed(2)} / Subida ${(s.uploadRate/1e6).toFixed(2)} Mbps - ${((s.downloadBytes+s.uploadBytes)/1e9).toFixed(3)} GB`).join(' | ')||'Sin cola registrada':'Consumo no disponible';}catch(error){if(error.name!=='AbortError')$('p-traffic').textContent='Consumo no disponible';}finally{if(trafficController===controller)trafficController=undefined;}
}
traffic();trafficTimer=setInterval(traffic,10000);window.addEventListener('pagehide',()=>{clearInterval(trafficTimer);trafficController?.abort();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)trafficController?.abort();else void traffic();});

window.addEventListener('pageshow',event=>{if(event.persisted){trafficTimer=setInterval(traffic,10000);void traffic();}});
