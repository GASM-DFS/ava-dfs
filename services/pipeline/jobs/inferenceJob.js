'use strict';

const { addProbabilisticProjections } = require('../../inference/projections');
const { metrics }                     = require('../../observability/metrics');

/**
 * Pipeline job: enrich players with probabilistic projection metadata
 * (mean, std dev, quantiles, ceiling p90, floor p10).
 */
function createInferenceJob(modelRegistry) {
  return {
    name: 'inference',
    async run(ctx) {
      const players      = ctx.featureBuild?.players || ctx.players || [];
      const modelVersion = modelRegistry ? modelRegistry.latestVersion() : 'builtin-v1';

      const start     = Date.now();
      const projected = addProbabilisticProjections(players, { modelVersion });
      const latency   = Date.now() - start;

      metrics.histogram('inference.latency',      latency);
      metrics.gauge('inference.players.count', projected.length);

      return { players: projected, modelVersion };
    },
  };
}

module.exports = { createInferenceJob };
