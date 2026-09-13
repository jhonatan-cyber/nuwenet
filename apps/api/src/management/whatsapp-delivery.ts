import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac,timingSafeEqual } from 'node:crypto';
import type {TransactionSQL} from 'bun';

export function validateWebhook(body:Buffer,signature:string|undefined,secret:string|undefined){
  if(!secret||!signature||!/^sha256=[a-f0-9]{64}$/i.test(signature)||!Buffer.isBuffer(body))throw new ForbiddenException('Firma de WhatsApp inválida.');
  const expected=createHmac('sha256',secret).update(body).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw new ForbiddenException('Firma de WhatsApp inválida.');
}
export function webhookChallenge(mode:unknown,token:unknown,challenge:unknown){
  const configured=process.env.WHATSAPP_VERIFY_TOKEN;
  if(mode!=='subscribe'||typeof token!=='string'||!configured||token.length!==configured.length||!timingSafeEqual(Buffer.from(token),Buffer.from(configured)))throw new ForbiddenException('Verificación de WhatsApp rechazada.');
  if(typeof challenge!=='string'||!/^[0-9]{1,100}$/.test(challenge))throw new BadRequestException('Desafío inválido.');
  return challenge;
}
export async function applyReceipt(tx:TransactionSQL,id:string){
  const [receipt]=await tx`SELECT * FROM whatsapp_receipts WHERE provider_id=${id}`;if(!receipt)return;
  const state=receipt.state==='sent'?'accepted':receipt.state;
  await tx`UPDATE notifications SET delivery_status=${state},last_error=${state==='failed'?'WhatsApp informó un fallo de entrega. Revisa el destinatario antes de reintentar.':null},delivered_at=CASE WHEN ${['delivered','read'].includes(state)} THEN COALESCE(delivered_at,${receipt.event_at}) ELSE delivered_at END,read_at=CASE WHEN ${state==='read'} THEN ${receipt.event_at} ELSE read_at END WHERE provider_id=${id} AND delivery_status<>'cancelled'`;
}
const rank:Record<string,number>={sent:1,failed:2,delivered:3,read:4};
export async function recordReceipts(tx:TransactionSQL,payload:unknown){
  const data=payload as {object?:string;entry?:{changes?:{field?:string;value?:{metadata?:{phone_number_id?:string};statuses?:{id?:string;status?:string;timestamp?:string}[]}}[]}[]};
  if(data?.object!=='whatsapp_business_account'||!Array.isArray(data.entry))throw new BadRequestException('Evento de WhatsApp inválido.');
  for(const entry of data.entry){
    if(!Array.isArray(entry.changes))continue;
    for(const change of entry.changes){
      if(change.field!=='messages'||!process.env.WHATSAPP_PHONE_NUMBER_ID||change.value?.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID||!Array.isArray(change.value.statuses))continue;
      for(const receipt of change.value.statuses){
        if(typeof receipt.id!=='string'||receipt.id.length>512||!receipt.id||!Object.hasOwn(rank,receipt.status||''))continue;
        const timestamp=Number(receipt.timestamp)*1000;
        if(!Number.isFinite(timestamp)||timestamp<0||timestamp>Date.now()+86400000)continue;
        const at=new Date(timestamp).toISOString(),state=receipt.status!,id=receipt.id;
        const [previous]=await tx`SELECT state FROM whatsapp_receipts WHERE provider_id=${id}`;
        if(previous && rank[previous.state]>=rank[state])continue;
        await tx`INSERT INTO whatsapp_receipts(provider_id,state,event_at,received_at) VALUES (${id},${state},${at},${new Date().toISOString()}) ON CONFLICT(provider_id) DO UPDATE SET state=excluded.state,event_at=excluded.event_at,received_at=excluded.received_at`;
        await applyReceipt(tx,id);
      }
    }
  }
}
