import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

type EventType = 'order_submitted'|'shipment_created'|'settlement_finalized';
type AggregateType = 'order'|'shipment'|'settlement';

async function insert(db:PoolClient,users:{id:string;email:string}[],eventType:EventType,aggregateType:AggregateType,aggregateId:string,subject:string,body:string){
  for(const user of users) await db.query(`INSERT INTO notification_outbox(id,event_type,aggregate_type,aggregate_id,recipient_user_id,recipient_email,subject,body,next_attempt_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(event_type,aggregate_id,recipient_user_id) DO NOTHING`,
    [randomUUID(),eventType,aggregateType,aggregateId,user.id,user.email,subject,body]);
}

export async function notifyCustomer(db:PoolClient,customerId:string,eventType:EventType,aggregateType:AggregateType,aggregateId:string,subject:string,body:string){
  const users=(await db.query("SELECT id,email FROM users WHERE customer_id=$1 AND active AND account_type='customer' ORDER BY id",[customerId])).rows;
  await insert(db,users,eventType,aggregateType,aggregateId,subject,body);
}

export async function notifyInternal(db:PoolClient,roles:string[],eventType:EventType,aggregateType:AggregateType,aggregateId:string,subject:string,body:string){
  const users=(await db.query("SELECT DISTINCT u.id,u.email FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.active AND u.account_type='internal' AND r.role=ANY($1::text[]) ORDER BY u.id",[roles])).rows;
  await insert(db,users,eventType,aggregateType,aggregateId,subject,body);
}
