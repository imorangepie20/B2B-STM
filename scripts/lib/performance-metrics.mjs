import assert from 'node:assert/strict';

export function percentile(values, ratio) {
  assert(values.length > 0, 'At least one measurement is required');
  assert(ratio > 0 && ratio <= 1, 'Percentile ratio must be greater than 0 and at most 1');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1];
}

const rounded = value => Math.round(value * 10) / 10;

export function summarizeMeasurements(measurements) {
  assert(measurements.length > 0, 'At least one measurement is required');
  const durations = measurements.map(measurement => measurement.durationMs);
  const unexpectedErrors = measurements.filter(
    measurement => measurement.status !== measurement.expectedStatus,
  ).length;
  return {
    requests: measurements.length,
    p50Ms: rounded(percentile(durations, 0.5)),
    p95Ms: rounded(percentile(durations, 0.95)),
    maxMs: rounded(Math.max(...durations)),
    unexpectedErrors,
    unexpectedErrorRate: unexpectedErrors / measurements.length,
  };
}

export function evaluateReadSmoke(summary, targets) {
  const failures = [];
  if (summary.p95Ms > targets.p95Ms) {
    failures.push(`p95 ${summary.p95Ms}ms exceeds ${targets.p95Ms}ms`);
  }
  if (summary.unexpectedErrorRate > targets.unexpectedErrorRate) {
    failures.push(
      `unexpected error rate ${(summary.unexpectedErrorRate * 100).toFixed(3)}% exceeds ${(targets.unexpectedErrorRate * 100).toFixed(3)}%`,
    );
  }
  return failures;
}
