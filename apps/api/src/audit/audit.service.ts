import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE } from '../database';
import { pageResult, Pagination } from '../orders/pagination';

const types=['inventory_adjustment','order_cancellation','return_inspection','settlement_finalized','account_status','mfa_reset','shipment_work','shipment_delivery','stock_count','defect_resolution','refund','data_export','attachment'] as const;
const events=`
  SELECT ia.id::text id,'inventory_adjustment' type,ia.adjusted_at "occurredAt",u.email actor,w.code||' · '||p.sku target,'재고 '||CASE WHEN ia.quantity_delta>0 THEN '+' ELSE '' END||ia.quantity_delta summary,ia.reason
  FROM inventory_adjustments ia JOIN users u ON u.id=ia.adjusted_by JOIN warehouses w ON w.id=ia.warehouse_id JOIN products p ON p.id=ia.product_id
  UNION ALL SELECT oc.order_id::text,'order_cancellation',oc.cancelled_at,u.email,c.code||' · '||left(oc.order_id::text,8),'주문 취소',oc.reason
  FROM order_cancellations oc JOIN users u ON u.id=oc.cancelled_by JOIN orders o ON o.id=oc.order_id JOIN customers c ON c.id=o.customer_id
  UNION ALL SELECT ri.id::text,'return_inspection',ri.inspected_at,u.email,c.code||' · '||p.sku,'반품 검수 '||ri.received_quantity||'개',COALESCE(ri.defective_reason,rl.reason)
  FROM return_inspections ri JOIN users u ON u.id=ri.inspected_by JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id
  UNION ALL SELECT s.id::text,'settlement_finalized',s.finalized_at,u.email,c.code||' · '||to_char(s.period,'YYYY-MM'),'정산 마감',NULL
  FROM settlements s JOIN users u ON u.id=s.finalized_by JOIN customers c ON c.id=s.customer_id WHERE s.status='finalized'
  UNION ALL SELECT a.id::text,'account_status',a.created_at,u.email,t.email,CASE WHEN a.active THEN '계정 활성화' ELSE '계정 비활성화' END,a.reason
  FROM account_status_changes a JOIN users u ON u.id=a.changed_by JOIN users t ON t.id=a.user_id
  UNION ALL SELECT m.id::text,'mfa_reset',m.created_at,u.email,t.email,'MFA 초기화',m.reason
  FROM mfa_device_resets m JOIN users u ON u.id=m.reset_by JOIN users t ON t.id=m.user_id
  UNION ALL SELECT e.id::text,'shipment_work',e.created_at,u.email,c.code||' · '||left(e.order_id::text,8),
    CASE e.event_type WHEN 'claimed' THEN '출고 작업 시작' WHEN 'released' THEN '출고 작업 반납' WHEN 'completed' THEN '출고 작업 완료' ELSE '주문 취소로 작업 종료' END,e.reason
  FROM shipment_work_assignment_events e JOIN users u ON u.id=e.actor_id JOIN orders o ON o.id=e.order_id JOIN customers c ON c.id=o.customer_id
  UNION ALL SELECT e.id::text,'shipment_work',e.created_at,u.email,c.code||' · '||l.sku,
    CASE e.event_type WHEN 'picked' THEN '피킹 수량 변경' WHEN 'inspected' THEN '검수 수량 변경' WHEN 'shipped' THEN '검수 완료분 출고' ELSE '피킹·검수 초기화' END||' · 피킹 '||e.picked_quantity||' / 검수 '||e.inspected_quantity,e.reason
  FROM shipment_work_line_events e JOIN users u ON u.id=e.actor_id JOIN reservations r ON r.id=e.reservation_id JOIN order_lines l ON l.id=r.order_line_id JOIN orders o ON o.id=l.order_id JOIN customers c ON c.id=o.customer_id
  UNION ALL SELECT e.id::text,'shipment_delivery',e.created_at,u.email,c.code||' · '||left(e.shipment_id::text,8),
    CASE e.event_type WHEN 'created' THEN '배송 업무 생성' WHEN 'scheduled' THEN '배송 일정 등록' WHEN 'rescheduled' THEN '배송 재예약' WHEN 'dispatched' THEN '배송 출발' WHEN 'delivered' THEN '배송 완료' ELSE '배송 실패' END,
    COALESCE(e.detail->>'reason',e.detail->>'proofNote')
  FROM shipment_delivery_events e JOIN users u ON u.id=e.actor_id JOIN shipments s ON s.id=e.shipment_id JOIN orders o ON o.id=s.order_id JOIN customers c ON c.id=o.customer_id
  UNION ALL SELECT sc.id::text,'stock_count',COALESCE(sc.finalized_at,sc.cancelled_at,sc.started_at),COALESCE(closer.email,starter.email),w.code||' · '||p.sku,
    CASE sc.status WHEN 'counting' THEN '재고 실사 시작' WHEN 'finalized' THEN '재고 실사 확정 · 실측 '||sc.counted_quantity||' / 예약 해제 '||sc.released_reservation_quantity ELSE '재고 실사 취소' END,sc.reason
  FROM stock_counts sc JOIN users starter ON starter.id=sc.started_by LEFT JOIN users closer ON closer.id=COALESCE(sc.finalized_by,sc.cancelled_by)
  JOIN warehouses w ON w.id=sc.warehouse_id JOIN products p ON p.id=sc.product_id
  UNION ALL SELECT d.id::text,'defect_resolution',d.created_at,u.email,c.code||' · '||p.sku,
    CASE d.disposition WHEN 'quarantine' THEN '불량 격리 ' WHEN 'disposed' THEN '불량 폐기 ' ELSE '공급처 반환 ' END||d.quantity||'개',d.reason
  FROM return_defect_dispositions d JOIN users u ON u.id=d.decided_by JOIN return_inspections ri ON ri.id=d.return_inspection_id JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id
  UNION ALL SELECT x.id::text,'defect_resolution',x.resolved_at,u.email,c.code||' · '||p.sku,
    CASE x.resolution WHEN 'disposed' THEN '격리품 폐기 ' ELSE '격리품 공급처 반환 ' END||x.quantity||'개',x.reason
  FROM return_defect_resolutions x JOIN users u ON u.id=x.resolved_by JOIN return_defect_dispositions d ON d.id=x.quarantine_disposition_id JOIN return_inspections ri ON ri.id=d.return_inspection_id JOIN return_lines rl ON rl.id=ri.return_line_id JOIN returns r ON r.id=rl.return_id JOIN customers c ON c.id=r.customer_id JOIN products p ON p.id=rl.product_id
  UNION ALL SELECT rf.id::text,'refund',rf.recorded_at,u.email,c.code||' · '||rf.reference,'실제 환불 '||rf.amount||'원',rf.reason
  FROM refunds rf JOIN users u ON u.id=rf.recorded_by JOIN customers c ON c.id=rf.customer_id
  UNION ALL SELECT de.id::text,'data_export',de.created_at,u.email,de.dataset||' · '||de.format, de.row_count||'행 내보내기',de.filters::text
  FROM data_exports de JOIN users u ON u.id=de.actor_id
  UNION ALL SELECT a.id::text,'attachment',a.created_at,u.email,a.resource_type||' · '||left(a.resource_id::text,8),a.filename||' · '||a.byte_size||' bytes',a.sha256
  FROM business_attachments a JOIN users u ON u.id=a.uploaded_by`;

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly pool:Pool){}
  async list(pagination:Pagination,input:Record<string,string|undefined>){
    const type=input.type??'all',query=input.query?.trim()??'',from=input.from,to=input.to;
    const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
    if(!['all',...types].includes(type as never)||query.length>100||(from&&!valid(from))||(to&&!valid(to))||(from&&to&&from>to)) throw new BadRequestException('Invalid audit filters');
    const values:unknown[]=[],where:string[]=[];
    if(type!=='all'){values.push(type);where.push(`type=$${values.length}`)}
    if(query){values.push(`%${query}%`);where.push(`(actor ILIKE $${values.length} OR target ILIKE $${values.length} OR summary ILIKE $${values.length} OR COALESCE(reason,'') ILIKE $${values.length})`)}
    if(from){values.push(from);where.push(`"occurredAt">=$${values.length}::date`)}
    if(to){values.push(to);where.push(`"occurredAt"<$${values.length}::date+interval '1 day'`)}
    const filter=where.length?`WHERE ${where.join(' AND ')}`:'';
    try{const[count,items]=await Promise.all([this.pool.query(`WITH events AS (${events}) SELECT count(*)::int total FROM events ${filter}`,values),this.pool.query(`WITH events AS (${events}) SELECT * FROM events ${filter} ORDER BY "occurredAt" DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset])]);return pageResult(items.rows,count.rows[0].total,pagination)}catch(error){if(error instanceof BadRequestException)throw error;throw new ServiceUnavailableException('Audit log unavailable')}
  }
}
