'use strict';

const { Router } = require('express');
const { metrics } = require('../../observability/metrics');

const router = Router();

/** GET /api/v1/health — liveness + basic metrics snapshot.  No auth required. */
router.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    version: process.env.npm_package_version || '1.0.0',
    uptime:  process.uptime(),
    metrics: metrics.snapshot(),
  });
});

/** GET /api/v1/metrics — raw metrics JSON.  No auth required. */
router.get('/metrics', (req, res) => {
  res.json(metrics.snapshot());
});

module.exports = { healthRouter: router };
