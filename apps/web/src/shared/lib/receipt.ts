import { escape } from '../../lib/html';

export interface ReceiptPayment {
  id: string;
  building_name?: string;
  name?: string;
  apartment?: string;
  period?: string;
  amount: number;
  method?: string;
  reference?: string;
  created_at?: string;
  actor?: string | null;
  reversed_at?: string | null;
  reversal_reason?: string;
  signature?: string;
}

// Los identificadores son UUID v7. La forma corta toma los 8 dígitos aleatorios
// finales: el tramo de tiempo inicial solo cambia cada ~65 s, así que dos recibos
// del mismo minuto compartirían número.
const shortId = (id: unknown): string => String(id || '').replace(/-/g, '').slice(-8).toUpperCase();

export function receiptHtml(p: ReceiptPayment, currency = ''): string {
  return `<article class="receipt text-sm"><h2 class="text-center text-base font-semibold">${escape(p.building_name)}</h2><h3 class="text-center font-semibold">Recibo NNW-${shortId(p.id)}</h3><p class="my-3">${escape(p.name)} · Depto. ${escape(p.apartment)}</p><hr class="my-4 border-dashed"><p class="my-3">Internet · ${escape(p.period)}</p><p class="my-3"><strong>Total: ${escape(currency)} ${(Number(p.amount)/100).toFixed(2)}</strong></p><p class="my-3">Método: ${escape(p.method)}<br>Referencia: ${escape(p.reference||'—')}</p><p class="my-3">${escape(p.created_at)}<br>Operador: ${escape(p.actor||'Sistema')}</p>${p.reversed_at?`<p class="my-3"><strong>REVERTIDO</strong>: ${escape(p.reversal_reason)}</p>`:''}<hr class="my-4 border-dashed"><p class="my-3">Firma de integridad HMAC-SHA256:</p><small class="block text-xs text-muted-foreground [overflow-wrap:anywhere]">${escape(p.signature)}</small><p class="my-3">Comprobante interno de pago.</p></article>`;
}

export function printReceipt(p: ReceiptPayment, currency = '', width = 80): void {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;border:0';
  frame.title = 'Impresión del recibo';
  document.body.append(frame);
  const mm = width === 58 ? 58 : 80;
  const doc = frame.contentDocument as Document;
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.append(meta);
  doc.title = `Recibo NNW-${shortId(p.id)}`;
  const style = doc.createElement('style');
  style.textContent = `@page{size:${mm}mm auto;margin:3mm}*{box-sizing:border-box}body{margin:0;width:${mm - 6}mm;font:12px monospace;color:#000;background:#fff}h2,h3{text-align:center;font-size:15px}p{margin:10px 0}small{font-size:9px}hr{border:0;border-top:1px dashed #000}`;
  doc.head.append(style);
  const body = doc.createElement('div');
  body.innerHTML = receiptHtml(p, currency);
  doc.body.append(body);
  const win = frame.contentWindow as Window;
  win.addEventListener('afterprint', () => frame.remove(), { once: true });
  setTimeout(() => { win.focus(); win.print(); }, 100);
}
