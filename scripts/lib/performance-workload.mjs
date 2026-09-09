import assert from 'node:assert/strict';
import { summarizeMeasurements } from './performance-metrics.mjs';

export function buildWorkloadPlan(requestCount) {
  assert(Number.isInteger(requestCount) && requestCount > 0 && requestCount % 10 === 0, 'Request count must be a positive multiple of 10');
  return Array.from({ length: requestCount }, (_, index) => index % 10 < 7 ? 'read' : 'write');
}

export function buildArrivalSchedule(requestCount, activeUsers, intervalMs) {
  assert(Number.isInteger(requestCount) && requestCount > 0, 'Request count must be positive');
  assert(Number.isInteger(activeUsers) && activeUsers > 0, 'Active users must be positive');
  assert(Number.isFinite(intervalMs) && intervalMs > 0, 'Request interval must be positive');
  const spacing = intervalMs / activeUsers;
  return Array.from({ length: requestCount }, (_, index) => index * spacing);
}

export function summarizeMixedWorkload(measurements, targets) {
  const read = summarizeMeasurements(measurements.filter(item => item.kind === 'read'));
  const write = summarizeMeasurements(measurements.filter(item => item.kind === 'write'));
  const all = summarizeMeasurements(measurements);
  const failures = [];
  if (read.p95Ms > targets.readP95Ms) failures.push(`read p95 ${read.p95Ms}ms exceeds ${targets.readP95Ms}ms`);
  if (write.p95Ms > targets.writeP95Ms) failures.push(`write p95 ${write.p95Ms}ms exceeds ${targets.writeP95Ms}ms`);
  if (all.unexpectedErrorRate > targets.unexpectedErrorRate) {
    failures.push(`unexpected error rate ${(all.unexpectedErrorRate * 100).toFixed(3)}% exceeds ${(targets.unexpectedErrorRate * 100).toFixed(3)}%`);
  }
  return { read, write, overall: all, failures };
}
