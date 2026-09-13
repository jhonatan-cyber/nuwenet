import {BadRequestException,Body,Controller,Get,HttpCode,Param,ParseIntPipe,Post,Query,Req,Res} from '@nestjs/common';
import {IsBoolean,IsOptional,IsString,Matches} from 'class-validator';
import type {Request,Response} from 'express';
import {DatabaseService} from '../database/database.service';
import {NotifierService} from './notifier.service';
import {Roles} from '../common/roles.decorator';
import {recordReceipts,validateWebhook,webhookChallenge} from './whatsapp-delivery';

class RetryNoticeDto {
  @IsOptional() @IsString() @Matches(/^\+?[1-9]\d{8,14}$/) target?:string;
  @IsOptional() @IsBoolean() acknowledge_duplicate?:boolean;
}
@Roles('superadmin')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifier:NotifierService){}
  @Get('configuration') configuration(){return this.notifier.configuration();}
  @Post(':id/retry') @HttpCode(200) retry(@Param('id',ParseIntPipe) id:number,@Body() dto:RetryNoticeDto){return this.notifier.retry(id,dto);}
  @Post(':id/cancel') @HttpCode(200) cancel(@Param('id',ParseIntPipe) id:number){return this.notifier.cancel(id);}
}
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  constructor(private readonly db:DatabaseService){}
  @Get() challenge(@Query() query:Record<string,unknown>,@Res() res:Response){res.type('text/plain').send(webhookChallenge(query['hub.mode'],query['hub.verify_token'],query['hub.challenge']));}
  @Post() @HttpCode(200) async receive(@Req() req:Request){
    validateWebhook(req.body,req.get('x-hub-signature-256'),process.env.WHATSAPP_APP_SECRET);
    let payload:unknown;try{payload=JSON.parse(req.body.toString('utf8'));}catch{throw new BadRequestException('JSON inválido.');}
    await this.db.write(tx=>recordReceipts(tx,payload));return {ok:true};
  }
}
