'use strict';

/**
 * Lightweight in-process metrics store.
 * Supports counters, gauges, and histograms; exported as JSON via /metrics.
 */
class Metrics {
  constructor() {
    this._counters   = new Map();
    this._gauges     = new Map();
    this._histograms = new Map();
  }

  increment(name, labels = {}, delta = 1) {
    const key = buildKey(name, labels);
    this._counters.set(key, (this._counters.get(key) || 0) + delta);
  }

  gauge(name, value, labels = {}) {
    const key = buildKey(name, labels);
    this._gauges.set(key, { value, updatedAt: Date.now() });
  }

  histogram(name, value, labels = {}) {
    const key = buildKey(name, labels);
    if (!this._histograms.has(key)) {
      this._histograms.set(key, { count: 0, sum: 0, min: Infinity, max: -Infinity, values: [] });
    }
    const h = this._histograms.get(key);
    h.count++;
    h.sum   += value;
    h.min    = Math.min(h.min, value);
    h.max    = Math.max(h.max, value);
    h.values.push(value);
    if (h.values.length > 1000) h.values.shift(); // ring buffer
  }

  snapshot() {
    const histograms = {};
    for (const [key, h] of this._histograms) {
      const sorted = [...h.values].sort((a, b) => a - b);
      histograms[key] = {
        count: h.count,
        sum:   h.sum,
        mean:  h.count > 0 ? h.sum / h.count : 0,
        min:   h.min,
        max:   h.max,
        p50:   percentile(sorted, 0.50),
        p95:   percentile(sorted, 0.95),
        p99:   percentile(sorted, 0.99),
      };
    }
    return {
      counters:   Object.fromEntries(this._counters),
      gauges:     Object.fromEntries([...this._gauges].map(([k, v]) => [k, v.value])),
      histograms,
    };
  }

  /** Reset all metrics (useful in tests). */
  reset() {
    this._counters.clear();
    this._gauges.clear();
    this._histograms.clear();
  }
}

function buildKey(name, labels) {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  return parts ? `${name}{${parts}}` : name;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

const metrics = new Metrics();

module.exports = { Metrics, metrics };
