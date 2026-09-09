import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInitialImport } from '../../apps/api/dist/imports/initial-import-parser.js';

const header = 'recordType,code,name,saleUnit,customerCode,sku,warehouseCode,quantity,unitPrice';

test('initial import parses quoted UTF-8 CSV and normalizes business keys', () => {
  const result = parseInitialImport(`${header}\r\ncustomer, acme ,"에이씨엠, 강남점",,,,,,\r\nproduct,,종이컵,BOX,, cup-12 ,,,\r\nprice,,,, acme , cup-12 ,,,12500`);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows.map(row => [row.recordType, row.key]), [
    ['customer', 'ACME'], ['product', 'CUP-12'], ['price', 'ACME:CUP-12'],
  ]);
});

test('initial import reports duplicate keys, invalid numbers and missing references by source row', () => {
  const result = parseInitialImport(`${header}\ncustomer,C1,첫 거래처,,,,,,\ncustomer,C1,중복 거래처,,,,,,\nprice,,,,UNKNOWN,MISSING,,,12.5\nstock,,,,,MISSING,WH-1,-1,`);
  assert.deepEqual(result.errors.map(error => error.rowNumber), [3, 4, 5]);
  assert(result.errors[0].message.includes('중복'));
  assert(result.errors[1].message.includes('정수'));
  assert(result.errors[2].message.includes('0 이상의 정수'));
});

test('initial import rejects wrong headers, malformed quotes and excessive rows', () => {
  assert.throws(() => parseInitialImport('type,code\ncustomer,C1'));
  assert.throws(() => parseInitialImport(`${header}\ncustomer,"C1,Name,,,,,,`));
  const rows = Array.from({ length: 2001 }, (_, index) => `customer,C${index},고객 ${index},,,,,,`).join('\n');
  assert.throws(() => parseInitialImport(`${header}\n${rows}`));
});
