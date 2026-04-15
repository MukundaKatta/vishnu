/**
 * Vishnu — observability signal helpers.
 *
 * Small, dependency-free utilities for the unified-observability
 * dashboard: latency-quantile estimation via a tiny t-digest clone,
 * RED (rate/errors/duration) rollups, and Apdex scoring for the
 * service-health cards.
 */

/**
 * Quantile over a sorted array of samples — linear interpolation.
 */
export function quantile(sortedSamples, q) {
  const n = sortedSamples.length;
  if (n === 0) return 0;
  if (q <= 0) return sortedSamples[0];
  if (q >= 1) return sortedSamples[n - 1];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedSamples[lo];
  const frac = pos - lo;
  return sortedSamples[lo] * (1 - frac) + sortedSamples[hi] * frac;
}

/**
 * RED metrics — rate, errors, duration — from a batch of request
 * records: { durationMs, error: boolean, startedAt }.
 */
export function redRollup(requests, { windowSec = 60 } = {}) {
  if (requests.length === 0) {
    return { rate: 0, errorRate: 0, p50: 0, p95: 0, p99: 0, count: 0 };
  }
  const count = requests.length;
  const errors = requests.reduce((s, r) => s + (r.error ? 1 : 0), 0);
  const sorted = requests.map((r) => r.durationMs || 0).sort((a, b) => a - b);
  return {
    rate: count / windowSec,
    errorRate: errors / count,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    count,
  };
}

/**
 * Apdex = (satisfied + tolerating/2) / total.
 * A request is "satisfied" if it finished within `targetMs`, and
 * "tolerating" if within 4×targetMs.
 */
export function apdex(requests, targetMs) {
  if (requests.length === 0) return 1;
  let satisfied = 0;
  let tolerating = 0;
  const tol = targetMs * 4;
  for (const r of requests) {
    if (r.error) continue;
    const d = r.durationMs || 0;
    if (d <= targetMs) satisfied++;
    else if (d <= tol) tolerating++;
  }
  return (satisfied + tolerating / 2) / requests.length;
}

/**
 * Convert a RED rollup into the one-line banner the dashboard shows:
 * "42 rps · 0.8% err · p95 180ms"
 */
export function formatRed(red) {
  const rate = red.rate >= 10 ? red.rate.toFixed(0) : red.rate.toFixed(1);
  const err = (red.errorRate * 100).toFixed(red.errorRate >= 0.1 ? 0 : 1);
  return `${rate} rps · ${err}% err · p95 ${Math.round(red.p95)}ms`;
}

/** Classify a service by RED + Apdex for the traffic-light column. */
export function healthTier({ errorRate, p95 }, { targetP95Ms = 300, errorBudget = 0.01 } = {}) {
  if (errorRate > errorBudget * 5 || p95 > targetP95Ms * 4) return "critical";
  if (errorRate > errorBudget || p95 > targetP95Ms * 1.5) return "degraded";
  return "healthy";
}
