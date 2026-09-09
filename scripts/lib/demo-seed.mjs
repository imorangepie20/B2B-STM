import assert from 'node:assert/strict';

export const demoId = number => `d${String(number).padStart(7, '0')}-0000-4000-8000-000000000000`;

const customers = [
  { id: demoId(10), code: 'DEMO-CAFE-001', name: '성수카페 강남점' },
  { id: demoId(11), code: 'DEMO-BAKERY-002', name: '소담베이커리' },
  { id: demoId(12), code: 'DEMO-KITCHEN-003', name: '키친랩 성수' },
];

const products = [
  ['DEMO-CUP-12', '무지 종이컵 12oz', '박스', 120, 114, 10, 12500],
  ['DEMO-LID-12', '종이컵 리드 12oz', '박스', 50, 50, 5, 5800],
  ['DEMO-CTN-750', '사각 펄프용기 750ml', '박스', 80, 76, 6, 19800],
  ['DEMO-BAG-M', '크라프트 쇼핑백 중형', '묶음', 30, 30, 20, 8700],
  ['DEMO-STRAW-BIO', '생분해 빨대 21cm', '박스', 40, 28, 0, 3800],
  ['DEMO-CUTLERY', '일회용 커트러리 세트', '박스', 25, 21, 0, 7200],
  ['DEMO-NAPKIN', '브라운 냅킨 2겹', '박스', 200, 200, 0, 9400],
  ['DEMO-GLOVE-M', '니트릴 장갑 M', '박스', 15, 15, 0, 16400],
  ['DEMO-CARRIER', '테이크아웃 컵 캐리어', '박스', 0, 0, 0, 11200],
  ['DEMO-BOWL-900', '종이 샐러드볼 900ml', '박스', 65, 65, 0, 24600],
  ['DEMO-SEAL-FILM', '용기 실링필름', '롤', 24, 24, 0, 31500],
  ['DEMO-WIPE', '주방용 살균티슈', '박스', 8, 8, 0, 22800],
].map((row, index) => ({
  id: demoId(100 + index), sku: row[0], name: row[1], saleUnit: row[2],
  receiptQuantity: row[3], onHandQuantity: row[4], reservedQuantity: row[5], unitPrice: row[6],
}));

const orders = [
  { id: demoId(200), customer: 0, status: 'submitted', daysAgo: 0, lines: [{ product: 5, requested: 15, reserved: 0, shipped: 0 }] },
  { id: demoId(201), customer: 0, status: 'confirmed', daysAgo: 2, lines: [
    { product: 0, requested: 16, reserved: 16, shipped: 6, reservationStatus: 'active' },
    { product: 2, requested: 10, reserved: 10, shipped: 4, reservationStatus: 'active' },
  ] },
  { id: demoId(202), customer: 1, status: 'confirmed', daysAgo: 1, lines: [{ product: 1, requested: 20, reserved: 5, shipped: 0, reservationStatus: 'active' }] },
  { id: demoId(203), customer: 2, status: 'confirmed', daysAgo: 0, cancellationRequest: 'submitted', lines: [{ product: 3, requested: 30, reserved: 20, shipped: 0, reservationStatus: 'active' }] },
  { id: demoId(204), customer: 1, status: 'confirmed', daysAgo: 8, lines: [{ product: 4, requested: 12, reserved: 12, shipped: 12, reservationStatus: 'shipped' }] },
  { id: demoId(205), customer: 2, status: 'cancelled', daysAgo: 5, cancellationRequest: 'approved', lines: [{ product: 5, requested: 10, reserved: 10, shipped: 4, reservationStatus: 'released' }] },
].map(order => ({
  ...order,
  requestedQuantity: order.lines.reduce((sum, line) => sum + line.requested, 0),
  reservedQuantity: order.lines.reduce((sum, line) => sum + line.reserved, 0),
  shippedQuantity: order.lines.reduce((sum, line) => sum + line.shipped, 0),
}));

export const demoDefinition = {
  customers,
  users: {
    customer: { id: demoId(20), email: 'demo.customer@stm.local', customerId: customers[0].id },
    customerBakery: { id: demoId(21), email: 'demo.bakery@stm.local', customerId: customers[1].id },
    customerKitchen: { id: demoId(22), email: 'demo.kitchen@stm.local', customerId: customers[2].id },
    warehouse: { id: demoId(23), email: 'demo.warehouse@stm.local' },
    operations: { id: demoId(24), email: 'demo.operations@stm.local' },
  },
  suppliers: [
    { id: demoId(30), code: 'DEMO-SUP-PACK', name: '대한패키징' },
    { id: demoId(31), code: 'DEMO-SUP-ECO', name: '그린소재 유통' },
  ],
  warehouse: { id: demoId(40), code: 'DEMO-WH-SEOUL', name: '서울 통합물류센터' },
  products,
  orders,
};

export function assertDemoTarget(connectionString) {
  const target = new URL(connectionString);
  assert(['postgresql:', 'postgres:'].includes(target.protocol), 'PostgreSQL URL required');
  assert.equal(target.pathname, '/b2b_stm', 'Local B2B development database required');
  assert(['127.0.0.1', 'localhost'].includes(target.hostname), 'Local PostgreSQL host required');
  return target;
}

export function validateDemoDefinition(definition) {
  const ids = [
    ...definition.customers.map(item => item.id),
    ...Object.values(definition.users).map(item => item.id),
    ...definition.suppliers.map(item => item.id),
    definition.warehouse.id,
    ...definition.products.map(item => item.id),
    ...definition.orders.map(item => item.id),
  ];
  assert.equal(new Set(ids).size, ids.length, 'Demo IDs must be unique');
  for (const id of ids) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i, 'Invalid demo UUID');
  assert(definition.customers.every(item => item.code.startsWith('DEMO-')), 'Demo customer code required');
  assert(definition.products.every(item => item.sku.startsWith('DEMO-')), 'Demo SKU required');
  for (const product of definition.products) {
    assert(Number.isInteger(product.receiptQuantity) && product.receiptQuantity >= 0, 'Invalid receipt quantity');
    assert(product.reservedQuantity <= product.onHandQuantity, 'Demo reservation exceeds stock');
  }
  return definition;
}
