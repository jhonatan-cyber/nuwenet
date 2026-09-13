import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
export const notificationChannel=()=>process.env.NOTIFY_CHANNEL==='whatsapp'?'whatsapp':'log';
export function whatsappConfig(){
  const {WHATSAPP_TOKEN:token,WHATSAPP_PHONE_NUMBER_ID:phone,WHATSAPP_API_VERSION:version,WHATSAPP_TEMPLATE:template,WHATSAPP_LANGUAGE:language}=process.env;
  return token&&phone&&/^\d+$/.test(phone)&&version&&/^v\d+\.\d+$/.test(version)&&template&&language?{token,phone,version,template,language}:null;
}
@Injectable()
export class NotifierService {
  constructor(private readonly database:DatabaseService){}
  configuration(){
    const config=whatsappConfig();
    return {
      channel:notificationChannel(),
      enabled:process.env.WHATSAPP_SEND_ENABLED==='true',
      configured:Boolean(config),
      phone_number_id:process.env.WHATSAPP_PHONE_NUMBER_ID||null,
      api_version:process.env.WHATSAPP_API_VERSION||null,
      template:process.env.WHATSAPP_TEMPLATE||null,
      language:process.env.WHATSAPP_LANGUAGE||'es',
    };
  }
  async notify(target:string,message:string,buildingId:number|null=null){
    const channel=notificationChannel(),status=channel==='whatsapp'?'pending':'internal';
    await this.database.write(tx=>tx`INSERT INTO notifications(channel,target,message,created_at,building_id,delivery_status,next_attempt) VALUES (${channel},${target},${message},${new Date().toISOString()},${buildingId},${status},${new Date().toISOString()})`);
  }
  async retry(id:number,dto:{target?:string;acknowledge_duplicate?:boolean}){
    const [row]=await this.database.read(tx=>tx`SELECT * FROM notifications WHERE id=${id}`);
    if(!row)throw new NotFoundException('Aviso no encontrado.');
    if(row.channel!=='whatsapp')throw new BadRequestException('Solo se pueden reintentar avisos de WhatsApp.');
    if(['accepted','delivered','read'].includes(row.delivery_status)&&!dto.acknowledge_duplicate){
      throw new BadRequestException('Este aviso ya fue aceptado o entregado. Confirma el reenvío si deseas duplicarlo.');
    }
    if(row.delivery_status==='sending'){
      throw new BadRequestException('El aviso se está enviando en este momento.');
    }
    const target=dto.target?dto.target.trim():row.target;
    await this.database.write(tx=>tx`UPDATE notifications SET target=${target},delivery_status='pending',attempts=0,next_attempt=${new Date().toISOString()},last_error=NULL WHERE id=${id}`);
    return {ok:true,id};
  }
  async cancel(id:number){
    const [row]=await this.database.read(tx=>tx`SELECT * FROM notifications WHERE id=${id}`);
    if(!row)throw new NotFoundException('Aviso no encontrado.');
    if(['delivered','read'].includes(row.delivery_status)){
      throw new BadRequestException('El aviso ya fue entregado y no puede cancelarse.');
    }
    await this.database.write(tx=>tx`UPDATE notifications SET delivery_status='cancelled',next_attempt=NULL WHERE id=${id}`);
    return {ok:true,id};
  }
  async processQueue(){
    const config=whatsappConfig();if(!config||notificationChannel()!=='whatsapp'||process.env.WHATSAPP_SEND_ENABLED!=='true')return;
    await this.database.write(tx=>tx`UPDATE notifications SET delivery_status='uncertain',last_error='Envío sin confirmación. Revisa WhatsApp antes de volver a enviarlo.' WHERE delivery_status='sending' AND next_attempt<${new Date().toISOString()}`);
    for(let i=0;i<10;i++){
      const job=await this.database.write(async tx=>{
        const [row]=await tx`SELECT * FROM notifications WHERE channel='whatsapp' AND delivery_status IN ('pending','retry') AND next_attempt<=${new Date().toISOString()} AND attempts<5 ORDER BY id LIMIT 1`;
        if(!row)return null;
        await tx`UPDATE notifications SET delivery_status='sending',attempts=attempts+1,next_attempt=${new Date(Date.now()+120000).toISOString()} WHERE id=${row.id}`;return row;
      });
      if(!job)break;
      let status='blocked',error:string|null=null,providerId:string|null=null;
      const to=String(job.target).replace(/[+\s()-]/g,'');
      if(!/^[1-9]\d{8,14}$/.test(to))error='Indica un teléfono con código de país para WhatsApp.';
      else try{
        const response=await fetch(`https://graph.facebook.com/${config.version}/${config.phone}/messages`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:config.template,language:{code:config.language},components:[{type:'body',parameters:[{type:'text',text:String(job.message)}]}]}})});
        const body=await response.json() as {messages?:{id:string}[]};
        if(response.ok&&body.messages?.[0]?.id){status='accepted';providerId=body.messages[0].id;}
        else {status=response.status===429||response.status>=500?'retry':'blocked';error=response.status===401||response.status===403?'WhatsApp rechazó las credenciales o permisos.':response.status===429?'WhatsApp limitó los envíos. Se reintentará.':'WhatsApp rechazó el envío. Revisa la plantilla, el número y la configuración.';}
      }catch{status='uncertain';error='No se recibió confirmación de WhatsApp. Revisa el proveedor antes de reenviar.';}
      if(status==='retry'&&Number(job.attempts)>=4)status='blocked';
      await this.database.write(tx=>tx`UPDATE notifications SET delivery_status=${status},last_error=${error},provider_id=COALESCE(${providerId},provider_id),next_attempt=${new Date(Date.now()+60000*2**Number(job.attempts)).toISOString()} WHERE id=${job.id}`);
    }
  }
}
