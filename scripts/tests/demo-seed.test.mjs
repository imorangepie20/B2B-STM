import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDemoTarget, demoId, validateDemoDefinition, demoDefinition } from '../lib/demo-seed.mjs';

test('demo seed accepts only the local B2B development database', () => {
  assert.doesNotThrow(() => assertDemoTarget('postgresql://demo:secret@127.0.0.1:5432/b2b_stm'));
  for (const target of [
    'postgresql://demo:secret@127.0.0.1:5432/b2b_stm_test',
    'postgresql://demo:secret@example.test:5432/b2b_stm',
    'postgresql://demo:secret@127.0.0.1:5432/property_manager',
  ]) assert.throws(() => assertDemoTarget(target));
});

test('demo identifiers are deterministic unique UUIDs and records stay in the DEMO namespace', () => {
  assert.equal(demoId(1), 'd0000001-0000-4000-8000-000000000000');
  assert.match(demoId(999), /^[a-f0-9-]{36}$/);
  assert.doesNotThrow(() => validateDemoDefinition(demoDefinition));
  assert.equal(new Set(demoDefinition.products.map(product => product.id)).size, demoDefinition.products.length);
  assert(demoDefinition.customers.every(customer => customer.code.startsWith('DEMO-')));
  assert(demoDefinition.products.every(product => product.sku.startsWith('DEMO-')));
});

test('demo scenarios cover operational states without exceeding stock reservations', () => {
  assert.deepEqual(new Set(demoDefinition.orders.map(order => order.status)), new Set(['submitted', 'confirmed', 'cancelled']));
  assert(demoDefinition.orders.some(order => order.cancellationRequest === 'submitted'));
  assert(demoDefinition.orders.some(order => order.shippedQuantity > 0 && order.reservedQuantity > order.shippedQuantity));
  assert(demoDefinition.orders.some(order => order.requestedQuantity > order.reservedQuantity));
  for (const product of demoDefinition.products) assert(product.reservedQuantity <= product.onHandQuantity);
});
