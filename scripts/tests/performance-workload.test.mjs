import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArrivalSchedule, buildWorkloadPlan, summarizeMixedWorkload } from '../lib/performance-workload.mjs';

test('mixed workload keeps an exact 70 percent read and 30 percent write distribution', () => {
  const plan = buildWorkloadPlan(100);
  assert.equal(plan.filter(item => item === 'read').length, 70);
  assert.equal(plan.filter(item => item === 'write').length, 30);
  assert.throws(() => buildWorkloadPlan(99), /multiple of 10/);
});

test('mixed workload evaluates read and write latency independently', () => {
  const measurements = [
    { kind: 'read', durationMs: 100, status: 200, expectedStatus: 200 },
    { kind: 'read', durationMs: 1100, status: 200, expectedStatus: 200 },
    { kind: 'write', durationMs: 1800, status: 201, expectedStatus: 201 },
    { kind: 'write', durationMs: 2100, status: 201, expectedStatus: 201 },
  ];
  const result = summarizeMixedWorkload(measurements, { readP95Ms: 1000, writeP95Ms: 2000, unexpectedErrorRate: 0.001 });
  assert.equal(result.read.p95Ms, 1100);
  assert.equal(result.write.p95Ms, 2100);
  assert.deepEqual(result.failures, ['read p95 1100ms exceeds 1000ms', 'write p95 2100ms exceeds 2000ms']);
});

test('arrival schedule staggers active users evenly across each request interval', () => {
  assert.deepEqual(buildArrivalSchedule(8, 4, 4000), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
  assert.throws(() => buildArrivalSchedule(8, 0, 4000), /active users/i);
  assert.throws(() => buildArrivalSchedule(8, 4, 0), /interval/);
});
