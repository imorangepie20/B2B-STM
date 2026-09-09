import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { Pool } from 'pg';
import { API_CONFIG, ApiConfig } from '../config';
import { DATABASE } from '../database';

type Purpose = 'invitation'|'password_reset';
@Injectable()
export class AccountEmailService {
  private readonly transport?: Transporter;
  constructor(@Inject(DATABASE) private readonly pool:Pool,@Inject(API_CONFIG) private readonly config:ApiConfig){
    if(config.mail) this.transport=nodemailer.createTransport(config.mail.transport==='json'?{jsonTransport:true}:config.mail.smtpUrl!);
  }
  async deliver(userId:string,recipient:string,purpose:Purpose,token:string,expiresAt:Date){
    if(!this.config.mail||!this.transport) return {status:'manual' as const};
    const id=randomUUID(), label=purpose==='invitation'?'계정 초대':'비밀번호 재설정';
    await this.pool.query('INSERT INTO account_email_deliveries(id,user_id,recipient,purpose,status) VALUES($1,$2,$3,$4,$5)',[id,userId,recipient,purpose,'pending']);
    const url=`${this.config.origin}/account-setup?purpose=${purpose}&token=${encodeURIComponent(token)}`;
    try{
      const info=await this.transport.sendMail({from:this.config.mail.from,to:recipient,subject:`[STM] ${label}`,text:`${label} 링크: ${url}\n만료: ${expiresAt.toISOString()}\n요청하지 않았다면 관리자에게 문의하세요.`});
      await this.pool.query("UPDATE account_email_deliveries SET status='sent',provider_message_id=$2,sent_at=now() WHERE id=$1",[id,info.messageId]);
      return {status:'sent' as const,id};
    }catch{
      await this.pool.query("UPDATE account_email_deliveries SET status='failed',error_code='delivery_failed' WHERE id=$1",[id]).catch(()=>{});
      return {status:'failed' as const,id};
    }
  }
}
