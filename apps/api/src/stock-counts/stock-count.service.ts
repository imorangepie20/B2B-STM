import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value:unknown)=>typeof value==='string'?value.trim():'';

@Injectable()
export class StockCountService {
  constructor(@Inject(DATABASE) private readonly pool:Pool){}

  private async transaction<T>(work:(db:PoolClient)=>Promise<T>){
    const db=await this.pool.connect();
    try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result}
    catch(error){await db.query('ROLLBACK').catch(()=>{});if(error instanceof HttpException)throw error;throw new ServiceUnavailableException('Stock count unavailable')}
    finally{db.release()}
  }

  private input(body:unknown){
    const value=body as Record<string,unknown>|null,requestId=text(value?.requestId);
    if(!uuid.test(requestId))throw new BadRequestException('Valid request ID is required');
    return{value,requestId};
  }

  private async stored(db:PoolClient,actorId:string,type:string,requestId:string){
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actorId}:${type}:${requestId}`]);
    return(await db.query('SELECT response FROM command_results WHERE actor_id=$1 AND command_type=$2 AND request_id=$3',[actorId,type,requestId])).rows[0]?.response;
  }

  async list(){
    try{return(await this.pool.query(`SELECT sc.id,sc.status,sc.warehouse_id AS "warehouseId",sc.product_id AS "productId",w.code AS "warehouseCode",p.sku,p.name,p.sale_unit AS "saleUnit",
      sc.snapshot_on_hand_quantity AS "snapshotOnHandQuantity",sc.snapshot_reserved_quantity AS "snapshotReservedQuantity",sc.counted_quantity AS "countedQuantity",
      sc.released_reservation_quantity AS "releasedReservationQuantity",sc.reason,sc.started_at AS "startedAt",starter.email AS "startedBy",sc.finalized_at AS "finalizedAt",finalizer.email AS "finalizedBy",sc.cancelled_at AS "cancelledAt",canceller.email AS "cancelledBy",
      b.on_hand_quantity AS "currentOnHandQuantity",b.reserved_quantity AS "currentReservedQuantity",
      COALESCE((SELECT json_agg(json_build_object('orderId',o.id,'customerCode',c.code,'customerName',c.name,'reservationId',r.id,'remainingQuantity',r.quantity-r.shipped_quantity) ORDER BY o.created_at DESC,o.id DESC,r.id DESC)
        FROM reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN orders o ON o.id=l.order_id JOIN customers c ON c.id=o.customer_id
        WHERE r.warehouse_id=sc.warehouse_id AND r.product_id=sc.product_id AND r.status='active' AND r.quantity>r.shipped_quantity),'[]') AS reservations
      FROM stock_counts sc JOIN warehouses w ON w.id=sc.warehouse_id JOIN products p ON p.id=sc.product_id
      JOIN inventory_balances b ON b.warehouse_id=sc.warehouse_id AND b.product_id=sc.product_id JOIN users starter ON starter.id=sc.started_by
      LEFT JOIN users finalizer ON finalizer.id=sc.finalized_by LEFT JOIN users canceller ON canceller.id=sc.cancelled_by ORDER BY CASE WHEN sc.status='counting' THEN 0 ELSE 1 END,sc.started_at DESC,sc.id DESC LIMIT 200`)).rows}
    catch{throw new ServiceUnavailableException('Stock counts unavailable')}
  }

  async start(actorId:string,body:unknown){
    const{value,requestId}=this.input(body),warehouseId=text(value?.warehouseId),productId=text(value?.productId),reason=text(value?.reason);
    if(!uuid.test(warehouseId)||!uuid.test(productId)||!reason||reason.length>300)throw new BadRequestException('Warehouse, SKU and reason are required');
    return this.transaction(async db=>{const type='stock-count.start',existing=await this.stored(db,actorId,type,requestId);if(existing)return existing;
      const balance=await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[warehouseId,productId]);
      if(!balance.rowCount)throw new NotFoundException('Inventory balance unavailable');
      if((await db.query("SELECT id FROM stock_counts WHERE warehouse_id=$1 AND product_id=$2 AND status='counting'",[warehouseId,productId])).rowCount)throw new ConflictException('SKU is already under stock count');
      if((await db.query(`SELECT 1 FROM shipment_work_lines swl JOIN reservations r ON r.id=swl.reservation_id
        WHERE r.warehouse_id=$1 AND r.product_id=$2 AND r.status='active' AND (swl.picked_quantity>0 OR swl.inspected_quantity>0) LIMIT 1`,[warehouseId,productId])).rowCount)throw new ConflictException('Picked or inspected stock must be cleared before counting');
      const id=randomUUID(),row=balance.rows[0];
      await db.query("INSERT INTO stock_counts(id,warehouse_id,product_id,status,snapshot_on_hand_quantity,snapshot_reserved_quantity,reason,started_by) VALUES($1,$2,$3,'counting',$4,$5,$6,$7)",[id,warehouseId,productId,row.on_hand_quantity,row.reserved_quantity,reason,actorId]);
      const response={id,status:'counting',snapshotOnHandQuantity:row.on_hand_quantity,snapshotReservedQuantity:row.reserved_quantity};
      await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)',[actorId,type,requestId,JSON.stringify(response)]);return response;
    })
  }

  async finalize(actorId:string,id:string,body:unknown){
    if(!uuid.test(id))throw new BadRequestException('Invalid stock count ID');const{value,requestId}=this.input(body),countedQuantity=Number(value?.countedQuantity),reason=text(value?.reason);
    if(!Number.isInteger(countedQuantity)||countedQuantity<0||!reason||reason.length>300)throw new BadRequestException('Counted quantity and reason are required');
    return this.transaction(async db=>{const type='stock-count.finalize',existing=await this.stored(db,actorId,type,requestId);if(existing)return existing;
      const count=await db.query("SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE",[id]);if(!count.rowCount)throw new NotFoundException('Stock count unavailable');if(count.rows[0].status!=='counting')throw new ConflictException('Stock count is already closed');const row=count.rows[0];
      const reservations=await db.query(`SELECT r.id,r.order_line_id,r.quantity,r.shipped_quantity,o.id AS order_id
        FROM reservations r JOIN order_lines l ON l.id=r.order_line_id JOIN orders o ON o.id=l.order_id
        WHERE r.warehouse_id=$1 AND r.product_id=$2 AND r.status='active' AND r.quantity>r.shipped_quantity
        ORDER BY o.created_at DESC,o.id DESC,r.id DESC FOR UPDATE OF r,l,o`,[row.warehouse_id,row.product_id]);
      const balance=await db.query('SELECT on_hand_quantity,reserved_quantity FROM inventory_balances WHERE warehouse_id=$1 AND product_id=$2 FOR UPDATE',[row.warehouse_id,row.product_id]);
      if((await db.query(`SELECT 1 FROM shipment_work_lines swl JOIN reservations r ON r.id=swl.reservation_id
        WHERE r.warehouse_id=$1 AND r.product_id=$2 AND r.status='active' AND (swl.picked_quantity>0 OR swl.inspected_quantity>0) LIMIT 1`,[row.warehouse_id,row.product_id])).rowCount)throw new ConflictException('Picked or inspected stock changed during counting');
      let shortage=Math.max(0,balance.rows[0].reserved_quantity-countedQuantity),released=0;
      if(shortage){for(const reservation of reservations.rows){if(!shortage)break;const remaining=reservation.quantity-reservation.shipped_quantity,quantity=Math.min(shortage,remaining),full=quantity===remaining;
          await db.query(`UPDATE reservations SET quantity=CASE WHEN $3 THEN quantity ELSE quantity-$2 END,status=CASE WHEN $3 THEN 'released' ELSE 'active' END,updated_at=now() WHERE id=$1`,[reservation.id,quantity,full]);
          await db.query('UPDATE order_lines SET reserved_quantity=reserved_quantity-$2 WHERE id=$1',[reservation.order_line_id,quantity]);
          await db.query("INSERT INTO reservation_events(id,reservation_id,event_type,quantity,created_by) VALUES($1,$2,'released',$3,$4)",[randomUUID(),reservation.id,quantity,actorId]);
          await db.query('INSERT INTO stock_count_reservation_adjustments(id,stock_count_id,reservation_id,released_quantity) VALUES($1,$2,$3,$4)',[randomUUID(),id,reservation.id,quantity]);shortage-=quantity;released+=quantity;
        }
        if(shortage)throw new ConflictException('Reserved inventory cannot be reconciled');
      }
      const delta=countedQuantity-balance.rows[0].on_hand_quantity;let adjustmentId:null|string=null;
      if(delta){adjustmentId=randomUUID();await db.query('INSERT INTO inventory_adjustments(id,warehouse_id,product_id,quantity_delta,reason,adjusted_by) VALUES($1,$2,$3,$4,$5,$6)',[adjustmentId,row.warehouse_id,row.product_id,delta,`실사 확정: ${reason}`,actorId]);await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,adjustment_id,created_by) VALUES($1,$2,$3,'adjustment',$4,$5,$6)",[randomUUID(),row.warehouse_id,row.product_id,delta,adjustmentId,actorId])}
      await db.query('UPDATE inventory_balances SET on_hand_quantity=$3,reserved_quantity=reserved_quantity-$4,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2',[row.warehouse_id,row.product_id,countedQuantity,released]);
      await db.query("UPDATE stock_counts SET status='finalized',counted_quantity=$2,released_reservation_quantity=$3,reason=$4,finalized_by=$5,finalized_at=now(),adjustment_id=$6,version=version+1 WHERE id=$1",[id,countedQuantity,released,reason,actorId,adjustmentId]);
      const response={id,status:'finalized',countedQuantity,releasedReservationQuantity:released,adjustmentQuantity:delta};await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)',[actorId,type,requestId,JSON.stringify(response)]);return response;
    })
  }

  async cancel(actorId:string,id:string,body:unknown){
    if(!uuid.test(id))throw new BadRequestException('Invalid stock count ID');const{value,requestId}=this.input(body),reason=text(value?.reason);if(!reason||reason.length>300)throw new BadRequestException('Cancellation reason is required');
    return this.transaction(async db=>{const type='stock-count.cancel',existing=await this.stored(db,actorId,type,requestId);if(existing)return existing;const result=await db.query("UPDATE stock_counts SET status='cancelled',reason=$2,cancelled_by=$3,cancelled_at=now(),version=version+1 WHERE id=$1 AND status='counting' RETURNING id",[id,reason,actorId]);if(!result.rowCount)throw new ConflictException('Active stock count unavailable');const response={id,status:'cancelled'};await db.query('INSERT INTO command_results(actor_id,command_type,request_id,response) VALUES($1,$2,$3,$4)',[actorId,type,requestId,JSON.stringify(response)]);return response})
  }
}
