import test from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile,
  summarizeMeasurements,
  evaluateReadSmoke,
} from '../lib/performance-metrics.mjs';

test('percentile uses the nearest-rank value without mutating samples', () => {
  const samples = [400, 10, 200, 100, 300];
  assert.equal(percentile(samples, 0.5), 200);
  assert.equal(percentile(samples, 0.95), 400);
  assert.deepEqual(samples, [400, 10, 200, 100, 300]);
});

test('measurement summary reports latency percentiles and unexpected errors', () => {
  const summary = summarizeMeasurements([
    { durationMs: 10, status: 200, expectedStatus: 200 },
    { durationMs: 30, status: 200, expectedStatus: 200 },
    { durationMs: 20, status: 503, expectedStatus: 200 },
  ]);

  assert.deepEqual(summary, {
    requests: 3,
    p50Ms: 20,
    p95Ms: 30,
    maxMs: 30,
    unexpectedErrors: 1,
    unexpectedErrorRate: 1 / 3,
  });
});

test('read smoke evaluation enforces p95 and unexpected error targets', () => {
  assert.deepEqual(
    evaluateReadSmoke({ p95Ms: 999.4, unexpectedErrorRate: 0.0009 }, { p95Ms: 1000, unexpectedErrorRate: 0.001 }),
    [],
  );
  assert.deepEqual(
    evaluateReadSmoke({ p95Ms: 1001, unexpectedErrorRate: 0.002 }, { p95Ms: 1000, unexpectedErrorRate: 0.001 }),
    ['p95 1001ms exceeds 1000ms', 'unexpected error rate 0.200% exceeds 0.100%'],
  );
});
