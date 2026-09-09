import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, pageResult } from '../../apps/api/dist/orders/pagination.js';
import { parseOrderFilters } from '../../apps/api/dist/orders/order-filters.js';
import { parseQueueSearch } from '../../apps/api/dist/orders/queue-search.js';

test('pagination accepts a bounded positive page and page size', () => {
  assert.deepEqual(parsePagination('2', '50'), { page: 2, pageSize: 50, offset: 50 });
  assert.deepEqual(parsePagination(undefined, undefined), { page: 1, pageSize: 50, offset: 0 });
});

test('pagination rejects partial, non-integer and excessive values', () => {
  for (const values of [['1', undefined], [undefined, '50'], ['0', '50'], ['1.5', '50'], ['1', '101']]) {
    assert.throws(() => parsePagination(values[0], values[1]), /Invalid pagination/);
  }
});

test('page result exposes stable navigation metadata', () => {
  assert.deepEqual(pageResult(['a', 'b'], 101, { page: 2, pageSize: 50, offset: 50 }), {
    items: ['a', 'b'],
    page: 2,
    pageSize: 50,
    total: 101,
    totalPages: 3,
  });
});

test('order filters normalize search, status and inclusive dates', () => {
  assert.deepEqual(parseOrderFilters('  DEMO-001  ','completed','2026-09-01','2026-09-30',['active','completed','cancelled']), { query:'DEMO-001', status:'completed', from:'2026-09-01', to:'2026-09-30' });
  assert.deepEqual(parseOrderFilters(undefined,undefined,undefined,undefined,['active']), { query:'', status:'all' });
});

test('order filters reject unsupported status, invalid dates and excessive input', () => {
  assert.throws(()=>parseOrderFilters('x','submitted',undefined,undefined,['active']),/Invalid order filters/);
  assert.throws(()=>parseOrderFilters('x'.repeat(101),'all',undefined,undefined,['active']),/Invalid order filters/);
  assert.throws(()=>parseOrderFilters('',undefined,'2026-02-30','2026-03-01',['active']),/Invalid order filters/);
  assert.throws(()=>parseOrderFilters('',undefined,'2026-10-01','2026-09-01',['active']),/Invalid order filters/);
});

test('queue search trims input and rejects excessive terms', () => {
  assert.equal(parseQueueSearch('  DEMO-ORDER  '), 'DEMO-ORDER');
  assert.equal(parseQueueSearch(undefined), '');
  assert.throws(() => parseQueueSearch('x'.repeat(101)), /Invalid queue search/);
});
