'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const http     = require('http');

// Use API_KEYS=* so the health route (which is unauthenticated) works in tests.
process.env.API_KEYS = '*';

const { createServer } = require('../../services/api/server');

/** Helper: spin up a server on an ephemeral port, make a GET request, close it. */
function httpGet(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.get(`http://127.0.0.1:${port}${path}`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close();
          try { resolve({ statusCode: res.statusCode, body: JSON.parse(data) }); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', err => { server.close(); reject(err); });
    });
  });
}

test('GET /api/v1/health returns 200 with status ok', async () => {
  const res = await httpGet(createServer(), '/api/v1/health');
  assert.equal(res.statusCode,   200);
  assert.equal(res.body.status,  'ok');
  assert.ok(typeof res.body.uptime === 'number', 'uptime should be a number');
});

test('GET /api/v1/metrics returns 200 with counters/gauges/histograms keys', async () => {
  const res = await httpGet(createServer(), '/api/v1/metrics');
  assert.equal(res.statusCode, 200);
  assert.ok('counters'   in res.body);
  assert.ok('gauges'     in res.body);
  assert.ok('histograms' in res.body);
});
