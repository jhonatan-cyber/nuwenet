import QRCode from 'qrcode';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function receiptHtml(p,currency='') {
  return `<article class="receipt"><h2>${escape(p.building_name)}</h2><h3>Recibo NNW-${Number(p.id)}</h3><p>${escape(p.name)} · Depto. ${escape(p.apartment)}</p><hr><p>Internet · ${escape(p.period)}</p><p><strong>Total: ${escape(currency)} ${(Number(p.amount)/100).toFixed(2)}</strong></p><p>Método: ${escape(p.method)}<br>Referencia: ${escape(p.reference||'—')}</p><p>${escape(p.created_at)}<br>Operador: ${escape(p.actor||'Sistema')}</p>${p.reversed_at?`<p><strong>REVERTIDO</strong>: ${escape(p.reversal_reason)}</p>`:''}<hr><p>Firma de integridad HMAC-SHA256:</p><small style="overflow-wrap:anywhere">${escape(p.signature)}</small><p>Comprobante interno de pago.</p></article>`;
}

export function printReceipt(p,currency='',width=80) {
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;width:1px;height:1px;left:-9999px;border:0';
  frame.title='Impresión del recibo';
  document.body.append(frame);
  const mm=width===58?58:80;
  const doc=frame.contentDocument;
  doc.open();doc.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Recibo NNW-${Number(p.id)}</title><style>@page{size:${mm}mm auto;margin:3mm}*{box-sizing:border-box}body{margin:0;width:${mm-6}mm;font:12px monospace;color:#000;background:#fff}h2,h3{text-align:center;font-size:15px}p{margin:10px 0}small{font-size:9px}hr{border:0;border-top:1px dashed #000}</style></head><body>${receiptHtml(p,currency)}</body></html>`);doc.close();
  frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
  setTimeout(()=>{frame.contentWindow.focus();frame.contentWindow.print();},100);
}

export function bankHtml(bank,amount,currency='') {
  const image=/^(\/[^/]|https:\/\/)/.test(bank.qr_image||'')?`<img src="${escape(bank.qr_image)}" alt="QR bancario" style="display:block;width:220px;max-width:100%;margin:auto" referrerpolicy="no-referrer">`:'';
  return `<div class="bank-payment"><h3>Pago por transferencia / QR</h3><p>${escape(bank.bank)} · ${escape(bank.holder)}<br>Cuenta / alias: ${escape(bank.account||'Sin configurar')}</p>${image}<img data-generated-qr hidden alt="QR bancario generado" style="width:220px;max-width:100%"><p><strong>Importe a pagar: <span data-bank-amount>${escape(currency)} ${(Number(amount)/100).toFixed(2)}</span></strong></p><small data-qr-note>Comprueba titular e importe en tu aplicación bancaria. El QR configurado es estático; introduce el importe si tu banco lo solicita.</small></div>`;
}

const qrRequests=new WeakMap();
export async function updateBankQr(root,bank,cents) {
  const image=root.querySelector('[data-generated-qr]'),note=root.querySelector('[data-qr-note]');
  if(!image||!note||bank.qr_image||!bank.qr_text)return;
  const request={};qrRequests.set(image,request);image.hidden=true;
  if(!Number.isSafeInteger(cents)||cents<1){note.textContent='Introduce un importe válido para mostrar el QR.';return;}
  // Only substitute the explicit placeholder supplied in the bank's template.
  // Signed/encrypted payloads must be provided as-is by the bank.
  const payload=String(bank.qr_text).replaceAll('{amount}',(cents/100).toFixed(2));
  try {
    const url=await QRCode.toDataURL(payload,{width:440,margin:4,errorCorrectionLevel:'M'});
    if(qrRequests.get(image)!==request||!image.isConnected)return;
    image.src=url;image.hidden=false;
    note.textContent=bank.qr_text.includes('{amount}')?'Importe incorporado en la plantilla QR configurada. Comprueba titular e importe en tu banco antes de confirmar.':'QR estático. Comprueba el importe en tu banco antes de confirmar.';
  }catch{if(qrRequests.get(image)===request)note.textContent='No se pudo generar el QR. Revisa el contenido bancario configurado.';}
}
