'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Metrics } = require('../../services/observability/metrics');

test('Metrics: increment accurately tracks counts with and without labels', () => {
  const m = new Metrics();
  m.increment('http_requests'); // defaults to delta=1
  m.increment('http_requests', { route: '/api/v1/health' }, 2);

  const snap = m.snapshot();
  assert.equal(snap.counters['http_requests'], 1);
  assert.equal(snap.counters['http_requests{route="/api/v1/health"}'], 2);
});

test('Metrics: gauge tracks the latest value', () => {
  const m = new Metrics();
  m.gauge('memory_usage', 1024);
  m.gauge('memory_usage', 2048);

  const snap = m.snapshot();
  assert.equal(snap.gauges['memory_usage'], 2048);
});

test('Metrics: histogram calculates min, max, mean, and count accurately', () => {
  const m = new Metrics();
  m.histogram('db_latency', 100);
  m.histogram('db_latency', 200);
  m.histogram('db_latency', 300);

  const snap = m.snapshot();
  const h = snap.histograms['db_latency'];
  assert.equal(h.count, 3);
  assert.equal(h.sum, 600);
  assert.equal(h.min, 100);
  assert.equal(h.max, 300);
  assert.equal(h.mean, 200);
});

test('Metrics: reset clears all tracked data', () => {
  const m = new Metrics();
  m.increment('temp_counter');
  m.reset();
  
  const snap = m.snapshot();
  assert.deepEqual(snap.counters, {});
});