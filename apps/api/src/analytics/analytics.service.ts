import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE } from '../database';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}

  async warehouse(days: number) {
    try {
      const [daily, agingBuckets, customers, returns] = await Promise.all([
        this.pool.query(`WITH dates AS (SELECT generate_series(current_date-($1::int-1),current_date,interval '1 day')::date AS date), shipped AS (
          SELECT s.shipped_at::date AS date,count(DISTINCT s.id)::int AS shipments,COALESCE(sum(sl.quantity),0)::int AS quantity
          FROM shipments s JOIN shipment_lines sl ON sl.shipment_id=s.id WHERE s.shipped_at>=current_date-($1::int-1)*interval '1 day' GROUP BY s.shipped_at::date
        ) SELECT to_char(d.date,'YYYY-MM-DD') AS date,COALESCE(s.shipments,0)::int AS shipments,COALESCE(s.quantity,0)::int AS quantity
        FROM dates d LEFT JOIN shipped s USING(date) ORDER BY d.date`,[days]),
        this.pool.query(`WITH queue AS (
          SELECT CASE WHEN now()-o.confirmed_at<interval '1 day' THEN '24시간 이내' WHEN now()-o.confirmed_at<interval '3 days' THEN '1~3일' ELSE '3일 초과' END AS label,
            CASE WHEN now()-o.confirmed_at<interval '1 day' THEN 1 WHEN now()-o.confirmed_at<interval '3 days' THEN 2 ELSE 3 END AS sort,
            o.id,GREATEST(r.quantity-r.shipped_quantity,0) AS quantity
          FROM reservations r JOIN order_lines ol ON ol.id=r.order_line_id JOIN orders o ON o.id=ol.order_id
          WHERE r.status='active' AND r.quantity>r.shipped_quantity
        ) SELECT label,count(DISTINCT id)::int AS orders,sum(quantity)::int AS quantity FROM queue GROUP BY label,sort ORDER BY sort`),
        this.pool.query(`SELECT c.code AS "customerCode",c.name AS "customerName",count(DISTINCT o.id)::int AS orders,
          sum(r.quantity-r.shipped_quantity)::int AS quantity FROM reservations r JOIN order_lines ol ON ol.id=r.order_line_id
          JOIN orders o ON o.id=ol.order_id JOIN customers c ON c.id=o.customer_id
          WHERE r.status='active' AND r.quantity>r.shipped_quantity GROUP BY c.id,c.code,c.name ORDER BY quantity DESC,c.code LIMIT 8`),
        this.pool.query(`SELECT rl.reason,count(DISTINCT r.id)::int AS returns,sum(rl.requested_quantity)::int AS "requestedQuantity",
          sum(rl.received_quantity)::int AS "receivedQuantity",sum(rl.normal_quantity)::int AS "normalQuantity",
          sum(rl.defective_quantity)::int AS "defectiveQuantity" FROM returns r JOIN return_lines rl ON rl.return_id=r.id
          WHERE r.requested_at>=current_date-($1::int-1)*interval '1 day' GROUP BY rl.reason ORDER BY "requestedQuantity" DESC,rl.reason LIMIT 8`,[days]),
      ]);
      return { days, daily: daily.rows, agingBuckets: agingBuckets.rows, customers: customers.rows, returns: returns.rows };
    } catch { throw new ServiceUnavailableException('Warehouse analytics unavailable'); }
  }

  async customer(customerId: string, days: number) {
    try {
      const [daily, productSpend, monthlyFinance] = await Promise.all([
        this.pool.query(`WITH dates AS (SELECT generate_series(current_date-($2::int-1),current_date,interval '1 day')::date AS date), orders_daily AS (
          SELECT created_at::date AS date,count(*)::int AS orders FROM orders WHERE customer_id=$1 AND created_at>=current_date-($2::int-1)*interval '1 day' GROUP BY created_at::date
        ), ledger AS (
          SELECT business_date AS date,COALESCE(sum(amount),0)::bigint AS amount FROM receivable_entries WHERE customer_id=$1 AND business_date>=current_date-($2::int-1) GROUP BY business_date
        ) SELECT to_char(d.date,'YYYY-MM-DD') AS date,COALESCE(o.orders,0)::int AS orders,COALESCE(l.amount,0)::bigint AS "netAmount"
        FROM dates d LEFT JOIN orders_daily o USING(date) LEFT JOIN ledger l USING(date) ORDER BY d.date`,[customerId,days]),
        this.pool.query(`SELECT COALESCE(p.sku,ol.sku) AS sku,COALESCE(p.name,ol.product_name) AS name,sum(re.quantity)::int AS quantity,
          sum(re.amount)::bigint AS amount FROM receivable_entries re JOIN shipment_lines sl ON sl.id=re.shipment_line_id
          JOIN reservations r ON r.id=sl.reservation_id JOIN order_lines ol ON ol.id=r.order_line_id LEFT JOIN products p ON p.id=r.product_id
          WHERE re.customer_id=$1 AND re.business_date>=current_date-($2::int-1) GROUP BY COALESCE(p.sku,ol.sku),COALESCE(p.name,ol.product_name)
          ORDER BY amount DESC,sku LIMIT 8`,[customerId,days]),
        this.pool.query(`WITH months AS (SELECT generate_series(date_trunc('month',current_date)-interval '5 months',date_trunc('month',current_date),interval '1 month')::date AS month), ledger AS (
          SELECT date_trunc('month',business_date)::date AS month,sum(amount)::bigint AS amount FROM receivable_entries WHERE customer_id=$1 GROUP BY 1
        ), paid AS (
          SELECT s.period AS month,sum(pa.amount)::bigint AS amount FROM settlements s JOIN payment_allocations pa ON pa.settlement_id=s.id
          LEFT JOIN payment_allocation_reversals pr ON pr.payment_allocation_id=pa.id WHERE s.customer_id=$1 AND pr.id IS NULL GROUP BY s.period
        ) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(l.amount,0)::bigint AS "ledgerAmount",COALESCE(p.amount,0)::bigint AS "paidAmount"
        FROM months m LEFT JOIN ledger l USING(month) LEFT JOIN paid p USING(month) ORDER BY m.month`,[customerId]),
      ]);
      return { days, daily: daily.rows, productSpend: productSpend.rows, monthlyFinance: monthlyFinance.rows };
    } catch { throw new ServiceUnavailableException('Customer analytics unavailable'); }
  }
}
