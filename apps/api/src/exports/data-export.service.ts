import { BadRequestException, Inject, Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { Pool } from 'pg';
import { DATABASE } from '../database';
import { parseOrderFilters } from '../orders/order-filters';

type Dataset = 'orders' | 'inventory' | 'settlements';
type Format = 'csv' | 'xlsx';
type Cell = string | number | null;
type ExportData = { sheet: string; headers: string[]; rows: Cell[][] };

const MAX_ROWS = 10_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const formulaPrefix = /^[=+\-@\t\r]/;
const numericHeaders = new Set(['주문 수량','출고 수량','잔량','단가','세율(bps)','보유 수량','예약 수량','가용 수량','공급가액','세액','청구 합계','지급 기준일','입금 배분액']);

function safeText(value: Cell) {
  const text = value === null ? '' : String(value);
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(text)) return text;
  return formulaPrefix.test(text) ? `'${text}` : text;
}

function xlsxCell(value: Cell, header: string) {
  if (value === null) return '';
  if (typeof value === 'number') return value;
  if (numericHeaders.has(header) && /^-?\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return safeText(value);
}

function csvCell(value: Cell) {
  const text = safeText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Injectable()
export class DataExportService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}

  async create(actorId: string, datasetValue: string, input: Record<string, string | undefined>) {
    const dataset = datasetValue as Dataset;
    const format = (input.format ?? 'csv') as Format;
    if (!['orders', 'inventory', 'settlements'].includes(dataset) || !['csv', 'xlsx'].includes(format)) {
      throw new BadRequestException('Invalid export target or format');
    }
    const filters = Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => entry[0] !== 'format' && entry[1] !== undefined && entry[1] !== ''));
    try {
      const data = await this.load(dataset, filters);
      if (data.rows.length > MAX_ROWS) throw new PayloadTooLargeException(`Export exceeds ${MAX_ROWS} rows; narrow the filters`);
      await this.pool.query(
        'INSERT INTO data_exports(id,actor_id,dataset,format,filters,row_count) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), actorId, dataset, format, JSON.stringify(filters), data.rows.length],
      );
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        const lines = [data.headers, ...data.rows].map(row => row.map(csvCell).join(','));
        return { filename: `${dataset}-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8') };
      }
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'B2B-STM';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet(data.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.addRow(data.headers);
      for (const row of data.rows) sheet.addRow(row.map((value, index) => xlsxCell(value, data.headers[index])));
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.headers.length } };
      sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }; });
      sheet.columns.forEach((column, index) => { const values = [data.headers[index], ...data.rows.map(row => safeText(row[index]))]; column.width = Math.min(36, Math.max(12, ...values.map(value => value.length + 2))); });
      const bytes = await workbook.xlsx.writeBuffer();
      return { filename: `${dataset}-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(bytes) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof PayloadTooLargeException) throw error;
      throw new ServiceUnavailableException('Data export unavailable');
    }
  }

  private async load(dataset: Dataset, input: Record<string, string>) : Promise<ExportData> {
    if (dataset === 'orders') return this.orders(input);
    if (dataset === 'inventory') return this.inventory(input);
    return this.settlements(input);
  }

  private async orders(input: Record<string, string>): Promise<ExportData> {
    const filter = parseOrderFilters(input.query, input.status, input.from, input.to, ['submitted','in_progress','completed','cancelled']);
    const values: unknown[] = [], where: string[] = [];
    if (filter.query) { values.push(`%${filter.query}%`); where.push(`(c.code ILIKE $${values.length} OR c.name ILIKE $${values.length} OR o.id::text ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR p.name ILIKE $${values.length})`); }
    if (filter.from) { values.push(filter.from); where.push(`o.created_at >= $${values.length}::date`); }
    if (filter.to) { values.push(filter.to); where.push(`o.created_at < $${values.length}::date + interval '1 day'`); }
    const statusSql = `CASE WHEN o.status='cancelled' THEN 'cancelled' WHEN COALESCE(x.shipped,0)+COALESCE(x.cancelled,0)>=ol.requested_quantity THEN 'completed' WHEN COALESCE(x.shipped,0)>0 OR o.status='confirmed' THEN 'in_progress' ELSE 'submitted' END`;
    if (filter.status !== 'all') { values.push(filter.status); where.push(`${statusSql}=$${values.length}`); }
    values.push(MAX_ROWS + 1);
    const rows = await this.pool.query(`SELECT to_char(o.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') ordered_at,o.id::text order_id,c.code customer_code,c.name customer_name,w.code warehouse_code,${statusSql} fulfillment_status,p.sku,p.name product_name,ol.sale_unit,ol.requested_quantity,COALESCE(x.shipped,0)::int shipped_quantity,(ol.requested_quantity-COALESCE(x.shipped,0)-COALESCE(x.cancelled,0))::int remaining_quantity,ol.unit_price::text,ol.tax_category,ol.tax_rate_bps FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id JOIN order_lines ol ON ol.order_id=o.id JOIN products p ON p.id=ol.product_id LEFT JOIN LATERAL (SELECT (SELECT COALESCE(sum(sl.quantity),0)::int FROM reservations r JOIN shipment_lines sl ON sl.reservation_id=r.id WHERE r.order_line_id=ol.id) shipped,(SELECT COALESCE(sum(re.quantity),0)::int FROM reservations r JOIN reservation_events re ON re.reservation_id=r.id WHERE r.order_line_id=ol.id AND re.event_type='cancelled') cancelled) x ON true ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC,o.id,ol.id LIMIT $${values.length}`, values);
    return { sheet: '주문 이력', headers: ['주문일시','주문 ID','거래처 코드','거래처명','창고','처리 상태','SKU','상품명','판매 단위','주문 수량','출고 수량','잔량','단가','과세 구분','세율(bps)'], rows: rows.rows.map(row => Object.values(row) as Cell[]) };
  }

  private async inventory(input: Record<string, string>): Promise<ExportData> {
    const query = input.query?.trim() ?? '';
    if (query.length > 100) throw new BadRequestException('Invalid inventory filter');
    const values: unknown[] = [];
    const where = query ? (values.push(`%${query}%`), `WHERE w.code ILIKE $1 OR w.name ILIKE $1 OR p.sku ILIKE $1 OR p.name ILIKE $1`) : '';
    values.push(MAX_ROWS + 1);
    const rows = await this.pool.query(`SELECT w.code warehouse_code,w.name warehouse_name,p.sku,p.name product_name,p.sale_unit,b.on_hand_quantity,b.reserved_quantity,(b.on_hand_quantity-b.reserved_quantity)::int available_quantity,to_char(b.updated_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') updated_at FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id ${where} ORDER BY w.code,p.sku LIMIT $${values.length}`, values);
    return { sheet: '재고 현황', headers: ['창고 코드','창고명','SKU','상품명','판매 단위','보유 수량','예약 수량','가용 수량','갱신일시'], rows: rows.rows.map(row => Object.values(row) as Cell[]) };
  }

  private async settlements(input: Record<string, string>): Promise<ExportData> {
    if (input.customerId && !uuid.test(input.customerId)) throw new BadRequestException('Invalid customer filter');
    if (input.period && !periodPattern.test(input.period)) throw new BadRequestException('Invalid settlement period');
    const values: unknown[] = [input.customerId || null, input.period ? `${input.period}-01` : null, MAX_ROWS + 1];
    const rows = await this.pool.query(`SELECT to_char(s.period,'YYYY-MM') period,c.code customer_code,c.name customer_name,s.status,s.supply_amount::text,s.tax_amount::text,s.total_amount::text,s.payment_due_day,s.due_date::text,COALESCE(a.allocated_amount,0)::text allocated_amount,to_char(s.finalized_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI') finalized_at FROM settlements s JOIN customers c ON c.id=s.customer_id LEFT JOIN (SELECT settlement_id,sum(amount) allocated_amount FROM payment_allocations WHERE reversed_at IS NULL GROUP BY settlement_id) a ON a.settlement_id=s.id WHERE ($1::uuid IS NULL OR s.customer_id=$1) AND ($2::date IS NULL OR s.period=$2) ORDER BY s.period DESC,c.code,s.created_at DESC LIMIT $3`, values);
    return { sheet: '정산 현황', headers: ['정산월','거래처 코드','거래처명','상태','공급가액','세액','청구 합계','지급 기준일','지급 기한','입금 배분액','마감일시'], rows: rows.rows.map(row => Object.values(row) as Cell[]) };
  }
}
