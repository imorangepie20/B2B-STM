import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertLocalRehearsalTarget,
  assertSafeContainerName,
  compareSnapshots,
  assertNoIntegrityViolations,
} from '../lib/operational-integrity.mjs';

test('backup rehearsal accepts only the local B2B development database and a safe container name', () => {
  assert.doesNotThrow(() => assertLocalRehearsalTarget('postgresql://user:secret@127.0.0.1:5432/b2b_stm'));
  for (const target of [
    'postgresql://user:secret@127.0.0.1:5432/b2b_stm_test',
    'postgresql://user:secret@example.test:5432/b2b_stm',
    'postgresql://user:secret@127.0.0.1:5432/property_manager',
  ]) assert.throws(() => assertLocalRehearsalTarget(target));
  assert.equal(assertSafeContainerName('property-manager-postgres'), 'property-manager-postgres');
  assert.throws(() => assertSafeContainerName('property-manager-postgres;dropdb'));
});

test('restore comparison reports the exact table whose row count changed', () => {
  const source = { orders: 3, order_lines: 5, inventory_balances: 2 };
  assert.doesNotThrow(() => compareSnapshots(source, { ...source }));
  assert.throws(
    () => compareSnapshots(source, { ...source, order_lines: 4 }),
    /order_lines: source=5 restored=4/,
  );
  assert.throws(() => compareSnapshots(source, { orders: 3 }), /inventory_balances|order_lines/);
});

test('operational integrity rejects any nonzero violation without hiding its check name', () => {
  assert.doesNotThrow(() => assertNoIntegrityViolations({ inventory_reservation_mismatch: 0, shipment_ledger_mismatch: 0 }));
  assert.throws(
    () => assertNoIntegrityViolations({ inventory_reservation_mismatch: 2, shipment_ledger_mismatch: 0 }),
    /inventory_reservation_mismatch=2/,
  );
});
