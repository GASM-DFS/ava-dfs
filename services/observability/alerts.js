'use strict';

const { logger } = require('./logger');
const { metrics } = require('./metrics');

const DEFAULT_THRESHOLDS = {
  'ingest.match_rate':       { min: 0.8,  severity: 'error', message: 'Ingest match rate below 80%' },
  'validate.players.total':  { min: 8,    severity: 'error', message: 'Insufficient players validated' },
  'optimize.lineups.count':  { min: 1,    severity: 'error', message: 'Optimizer produced no lineups' },
  'inference.latency':       { max: 5000, severity: 'warn',  message: 'Inference latency above 5 s' },
};

/**
 * Check current metrics against thresholds and emit structured log alerts.
 * @param {object} [thresholds]
 * @returns {Array<object>} fired alerts
 */
function checkAlerts(thresholds = DEFAULT_THRESHOLDS) {
  const snap = metrics.snapshot();
  const fired = [];

  for (const [key, rule] of Object.entries(thresholds)) {
    const value = snap.gauges[key] ?? snap.histograms[key]?.mean;
    if (value === undefined) continue;

    const triggered =
      (rule.min !== undefined && value < rule.min) ||
      (rule.max !== undefined && value > rule.max);

    if (triggered) {
      const alert = { key, value, rule, message: rule.message };
      fired.push(alert);
      (logger[rule.severity] || logger.warn)(alert, `ALERT: ${rule.message}`);
    }
  }

  return fired;
}

module.exports = { checkAlerts, DEFAULT_THRESHOLDS };
