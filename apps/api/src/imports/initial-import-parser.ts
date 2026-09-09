export const INITIAL_IMPORT_HEADER = ['recordType', 'code', 'name', 'saleUnit', 'customerCode', 'sku', 'warehouseCode', 'quantity', 'unitPrice'] as const;
export type InitialImportType = 'customer' | 'supplier' | 'warehouse' | 'product' | 'price' | 'stock';
export type InitialImportRow = {
  rowNumber: number;
  recordType: InitialImportType;
  key: string;
  code: string;
  name: string;
  saleUnit: string;
  customerCode: string;
  sku: string;
  warehouseCode: string;
  quantity: number | null;
  unitPrice: number | null;
};
export type InitialImportError = { rowNumber: number; message: string };

const clean = (value: string) => value.trim();
const businessKey = (value: string) => clean(value).toUpperCase();
const safeInteger = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

function parseCsv(content: string): string[][] {
  if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('CSV 파일은 1MiB 이하여야 합니다.');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field.length) throw new Error('CSV 인용부호 형식이 올바르지 않습니다.');
      quoted = true;
    } else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (quoted) throw new Error('CSV 인용부호가 닫히지 않았습니다.');
  row.push(field);
  if (row.some(value => value.length) || rows.length === 0) rows.push(row);
  return rows.filter(values => values.some(value => value.trim()));
}

export function parseInitialImport(content: string, options: { allowExternalReferences?: boolean } = {}) {
  const parsed = parseCsv(content.replace(/^\uFEFF/, ''));
  if (!parsed.length || parsed[0].map(clean).join(',') !== INITIAL_IMPORT_HEADER.join(',')) throw new Error('CSV header가 초기 이관 형식과 일치하지 않습니다.');
  if (parsed.length - 1 > 2000) throw new Error('CSV 데이터는 2,000행 이하여야 합니다.');
  const rows: InitialImportRow[] = [];
  const errors: InitialImportError[] = [];
  const keys = new Set<string>();
  const customerCodes = new Set<string>();
  const warehouseCodes = new Set<string>();
  const productSkus = new Set<string>();

  for (let index = 1; index < parsed.length; index += 1) {
    const rowNumber = index + 1;
    const values = parsed[index];
    if (values.length !== INITIAL_IMPORT_HEADER.length) { errors.push({ rowNumber, message: '열 개수가 header와 일치하지 않습니다.' }); continue; }
    const [typeValue, codeValue, nameValue, unitValue, customerValue, skuValue, warehouseValue, quantityValue, priceValue] = values.map(clean);
    if (!['customer', 'supplier', 'warehouse', 'product', 'price', 'stock'].includes(typeValue)) { errors.push({ rowNumber, message: '지원하지 않는 recordType입니다.' }); continue; }
    const recordType = typeValue as InitialImportType;
    const code = businessKey(codeValue), name = nameValue, saleUnit = unitValue;
    const customerCode = businessKey(customerValue), sku = businessKey(skuValue), warehouseCode = businessKey(warehouseValue);
    const quantity = quantityValue ? safeInteger(quantityValue) : null;
    const unitPrice = priceValue ? safeInteger(priceValue) : null;
    let key = '';
    if (recordType === 'customer' || recordType === 'supplier' || recordType === 'warehouse') key = code;
    else if (recordType === 'product') key = sku;
    else if (recordType === 'price') key = `${customerCode}:${sku}`;
    else key = `${warehouseCode}:${sku}`;
    const scopedKey = `${recordType}:${key}`;
    let error = '';
    if (!key || key === ':') error = '업무 식별 코드가 필요합니다.';
    else if (keys.has(scopedKey)) error = `파일 안에 중복된 ${recordType} 식별자가 있습니다.`;
    else if (['customer', 'supplier', 'warehouse'].includes(recordType) && (!code || !name)) error = 'code와 name이 필요합니다.';
    else if (recordType === 'product' && (!sku || !name || !saleUnit)) error = 'sku, name, saleUnit이 필요합니다.';
    else if (recordType === 'price' && unitPrice === null) error = 'unitPrice는 0 이상의 정수여야 합니다.';
    else if (recordType === 'stock' && quantity === null) error = 'quantity는 0 이상의 정수여야 합니다.';
    if (error) errors.push({ rowNumber, message: error });
    else keys.add(scopedKey);
    const normalized = { rowNumber, recordType, key, code, name, saleUnit, customerCode, sku, warehouseCode, quantity, unitPrice };
    rows.push(normalized);
    if (!error && recordType === 'customer') customerCodes.add(code);
    if (!error && recordType === 'warehouse') warehouseCodes.add(code);
    if (!error && recordType === 'product') productSkus.add(sku);
  }

  for (const row of rows) {
    if (errors.some(error => error.rowNumber === row.rowNumber)) continue;
    if (!options.allowExternalReferences && row.recordType === 'price' && (!customerCodes.has(row.customerCode) || !productSkus.has(row.sku))) errors.push({ rowNumber: row.rowNumber, message: 'price가 참조하는 거래처 또는 상품이 파일에 없습니다.' });
    if (!options.allowExternalReferences && row.recordType === 'stock' && (!warehouseCodes.has(row.warehouseCode) || !productSkus.has(row.sku))) errors.push({ rowNumber: row.rowNumber, message: 'stock이 참조하는 창고 또는 상품이 파일에 없습니다.' });
  }
  errors.sort((left, right) => left.rowNumber - right.rowNumber);
  return { rows, errors };
}
