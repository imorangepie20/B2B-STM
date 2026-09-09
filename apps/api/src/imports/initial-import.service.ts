import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { InitialImportRow, parseInitialImport } from './initial-import-parser';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
type RowDecision = InitialImportRow & { result: 'created' | 'skipped' };
type ImportError = { rowNumber: number; message: string };
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';

@Injectable()
export class InitialImportService {
  constructor(@Inject(DATABASE) private readonly pool: Pool) {}

  private body(body: any) {
    const filename = clean(body?.filename), content = typeof body?.content === 'string' ? body.content : '';
    if (!filename || !filename.toLowerCase().endsWith('.csv') || !content) throw new BadRequestException('CSV filename and content are required');
    return { filename: filename.slice(0, 200), content };
  }

  private async analyze(db: Queryable, rows: InitialImportRow[]) {
    const customers = await db.query('SELECT id,code,name,active FROM customers');
    const suppliers = await db.query('SELECT id,code,name,active FROM suppliers');
    const warehouses = await db.query('SELECT id,code,name,active FROM warehouses');
    const products = await db.query('SELECT id,sku,name,sale_unit AS "saleUnit",active FROM products');
    const prices = await db.query('SELECT c.code AS "customerCode",p.sku,cp.unit_price AS "unitPrice",cp.active FROM customer_prices cp JOIN customers c ON c.id=cp.customer_id JOIN products p ON p.id=cp.product_id');
    const stock = await db.query('SELECT w.code AS "warehouseCode",p.sku,b.on_hand_quantity AS "onHandQuantity",b.reserved_quantity AS "reservedQuantity" FROM inventory_balances b JOIN warehouses w ON w.id=b.warehouse_id JOIN products p ON p.id=b.product_id');
    const customerMap = new Map(customers.rows.map(row => [row.code, row]));
    const supplierMap = new Map(suppliers.rows.map(row => [row.code, row]));
    const warehouseMap = new Map(warehouses.rows.map(row => [row.code, row]));
    const productMap = new Map(products.rows.map(row => [row.sku, row]));
    const priceMap = new Map(prices.rows.map(row => [`${row.customerCode}:${row.sku}`, row]));
    const stockMap = new Map(stock.rows.map(row => [`${row.warehouseCode}:${row.sku}`, row]));
    for (const row of rows) {
      if (row.recordType === 'customer' && !customerMap.has(row.code)) customerMap.set(row.code, { id: null, code: row.code, name: row.name, active: true });
      if (row.recordType === 'supplier' && !supplierMap.has(row.code)) supplierMap.set(row.code, { id: null, code: row.code, name: row.name, active: true });
      if (row.recordType === 'warehouse' && !warehouseMap.has(row.code)) warehouseMap.set(row.code, { id: null, code: row.code, name: row.name, active: true });
      if (row.recordType === 'product' && !productMap.has(row.sku)) productMap.set(row.sku, { id: null, sku: row.sku, name: row.name, saleUnit: row.saleUnit, active: true });
    }
    const errors: ImportError[] = [], decisions: RowDecision[] = [];
    for (const row of rows) {
      let existing: any, matches = false;
      if (row.recordType === 'customer') { existing = customers.rows.find(item => item.code === row.code); matches = existing?.active && existing.name === row.name; }
      if (row.recordType === 'supplier') { existing = suppliers.rows.find(item => item.code === row.code); matches = existing?.active && existing.name === row.name; }
      if (row.recordType === 'warehouse') { existing = warehouses.rows.find(item => item.code === row.code); matches = existing?.active && existing.name === row.name; }
      if (row.recordType === 'product') { existing = products.rows.find(item => item.sku === row.sku); matches = existing?.active && existing.name === row.name && existing.saleUnit === row.saleUnit; }
      if (row.recordType === 'price') {
        if (!customerMap.has(row.customerCode) || !productMap.has(row.sku)) { errors.push({ rowNumber: row.rowNumber, message: '거래처 또는 상품을 찾을 수 없습니다.' }); continue; }
        existing = priceMap.get(row.key); matches = existing?.active && Number(existing.unitPrice) === row.unitPrice;
      }
      if (row.recordType === 'stock') {
        if (!warehouseMap.has(row.warehouseCode) || !productMap.has(row.sku)) { errors.push({ rowNumber: row.rowNumber, message: '창고 또는 상품을 찾을 수 없습니다.' }); continue; }
        existing = stockMap.get(row.key); matches = existing && Number(existing.onHandQuantity) === row.quantity && Number(existing.reservedQuantity) === 0;
        if (existing && !matches && (Number(existing.onHandQuantity) !== 0 || Number(existing.reservedQuantity) !== 0)) { errors.push({ rowNumber: row.rowNumber, message: '이미 재고가 존재해 초기 수량을 덮어쓸 수 없습니다.' }); continue; }
        if (existing && !matches && Number(existing.onHandQuantity) === 0 && Number(existing.reservedQuantity) === 0) existing = undefined;
      }
      if (existing && !matches) { errors.push({ rowNumber: row.rowNumber, message: '같은 식별자의 기존 값과 CSV 값이 다릅니다.' }); continue; }
      decisions.push({ ...row, result: existing && matches ? 'skipped' : 'created' });
    }
    return { decisions, errors };
  }

  async preview(body: unknown) {
    const { filename, content } = this.body(body);
    let parsed;
    try { parsed = parseInitialImport(content, { allowExternalReferences: true }); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'CSV를 읽을 수 없습니다.'); }
    if (parsed.errors.length) return { filename, totalRows: parsed.rows.length, createdRows: 0, skippedRows: 0, errors: parsed.errors, rows: parsed.rows };
    const analyzed = await this.analyze(this.pool, parsed.rows);
    return { filename, totalRows: parsed.rows.length, createdRows: analyzed.decisions.filter(row => row.result === 'created').length, skippedRows: analyzed.decisions.filter(row => row.result === 'skipped').length, errors: analyzed.errors, rows: analyzed.decisions };
  }

  async apply(actorId: string, body: unknown) {
    const { filename, content } = this.body(body);
    let parsed;
    try { parsed = parseInitialImport(content, { allowExternalReferences: true }); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'CSV를 읽을 수 없습니다.'); }
    if (parsed.errors.length) throw new BadRequestException({ message: 'CSV validation failed', errors: parsed.errors });
    const fileHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`initial-import:${fileHash}`]);
      const duplicate = await db.query('SELECT id,filename,total_rows AS "totalRows",created_rows AS "createdRows",skipped_rows AS "skippedRows",created_at AS "createdAt" FROM import_batches WHERE file_hash=$1', [fileHash]);
      if (duplicate.rowCount) { await db.query('COMMIT'); return { ...duplicate.rows[0], duplicate: true }; }
      const analyzed = await this.analyze(db, parsed.rows);
      if (analyzed.errors.length) throw new BadRequestException({ message: 'CSV validation failed', errors: analyzed.errors });
      const customerIds = new Map((await db.query('SELECT code,id FROM customers')).rows.map(row => [row.code, row.id]));
      const supplierIds = new Map((await db.query('SELECT code,id FROM suppliers')).rows.map(row => [row.code, row.id]));
      const warehouseIds = new Map((await db.query('SELECT code,id FROM warehouses')).rows.map(row => [row.code, row.id]));
      const productIds = new Map((await db.query('SELECT sku,id FROM products')).rows.map(row => [row.sku, row.id]));
      for (const row of analyzed.decisions.filter(item => item.result === 'created')) {
        if (row.recordType === 'customer') { const id=randomUUID(); await db.query('INSERT INTO customers(id,code,name) VALUES($1,$2,$3)',[id,row.code,row.name]); customerIds.set(row.code,id); }
        if (row.recordType === 'supplier') { const id=randomUUID(); await db.query('INSERT INTO suppliers(id,code,name) VALUES($1,$2,$3)',[id,row.code,row.name]); supplierIds.set(row.code,id); }
        if (row.recordType === 'warehouse') { const id=randomUUID(); await db.query('INSERT INTO warehouses(id,code,name) VALUES($1,$2,$3)',[id,row.code,row.name]); warehouseIds.set(row.code,id); }
        if (row.recordType === 'product') { const id=randomUUID(); await db.query('INSERT INTO products(id,sku,name,sale_unit) VALUES($1,$2,$3,$4)',[id,row.sku,row.name,row.saleUnit]); productIds.set(row.sku,id); }
      }
      for (const row of analyzed.decisions.filter(item => item.result === 'created')) {
        if (row.recordType === 'price') await db.query('INSERT INTO customer_prices(customer_id,product_id,unit_price) VALUES($1,$2,$3)', [customerIds.get(row.customerCode), productIds.get(row.sku), row.unitPrice]);
        if (row.recordType === 'stock') {
          const warehouseId=warehouseIds.get(row.warehouseCode), productId=productIds.get(row.sku);
          await db.query('INSERT INTO inventory_balances(warehouse_id,product_id,on_hand_quantity) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[warehouseId,productId]);
          if ((row.quantity ?? 0) > 0) {
            const adjustmentId=randomUUID();
            await db.query("INSERT INTO inventory_adjustments(id,warehouse_id,product_id,quantity_delta,reason,adjusted_by) VALUES($1,$2,$3,$4,'초기 데이터 이관',$5)",[adjustmentId,warehouseId,productId,row.quantity,actorId]);
            await db.query('UPDATE inventory_balances SET on_hand_quantity=$3,version=version+1,updated_at=now() WHERE warehouse_id=$1 AND product_id=$2',[warehouseId,productId,row.quantity]);
            await db.query("INSERT INTO inventory_movements(id,warehouse_id,product_id,movement_type,quantity_delta,adjustment_id,created_by) VALUES($1,$2,$3,'adjustment',$4,$5,$6)",[randomUUID(),warehouseId,productId,row.quantity,adjustmentId,actorId]);
          }
        }
      }
      const batchId=randomUUID(), createdRows=analyzed.decisions.filter(row => row.result === 'created').length, skippedRows=analyzed.decisions.length-createdRows;
      await db.query("INSERT INTO import_batches(id,file_hash,filename,status,total_rows,created_rows,skipped_rows,created_by) VALUES($1,$2,$3,'completed',$4,$5,$6,$7)",[batchId,fileHash,filename,analyzed.decisions.length,createdRows,skippedRows,actorId]);
      for (const row of analyzed.decisions) await db.query('INSERT INTO import_rows(batch_id,row_number,record_type,business_key,result) VALUES($1,$2,$3,$4,$5)',[batchId,row.rowNumber,row.recordType,row.key,row.result]);
      await db.query('COMMIT');
      return { id: batchId, filename, totalRows: analyzed.decisions.length, createdRows, skippedRows, duplicate: false };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Initial import unavailable');
    } finally { db.release(); }
  }

  async batches() {
    try { return (await this.pool.query('SELECT id,filename,status,total_rows AS "totalRows",created_rows AS "createdRows",skipped_rows AS "skippedRows",created_at AS "createdAt" FROM import_batches ORDER BY created_at DESC,id DESC LIMIT 20')).rows; }
    catch { throw new ServiceUnavailableException('Import history unavailable'); }
  }
}
