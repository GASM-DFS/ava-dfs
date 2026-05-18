'use strict';

const { ingest }  = require('../../ingest');
const { metrics } = require('../../observability/metrics');

const MIN_MATCH_RATE = 0.8;

/**
 * Pipeline job: ingest raw provider rows into canonical players + stable IDs.
 * Hard-fails when the match rate drops below MIN_MATCH_RATE to prevent
 * silently running the pipeline with a mis-aligned player pool.
 */
function createIngestJob(provider, rawRows, options, registry) {
  return {
    name: 'ingest',
    async run(ctx) {
      const result = ingest(provider, rawRows, options, registry);

      metrics.gauge('ingest.match_rate',      result.matchStats.matchRate);
      metrics.gauge('ingest.players.valid',   result.matchStats.valid);
      metrics.gauge('ingest.players.invalid', result.matchStats.invalid);

      if (result.matchStats.matchRate < MIN_MATCH_RATE) {
        throw new Error(
          `Match rate ${(result.matchStats.matchRate * 100).toFixed(1)}% below threshold ` +
          `(${MIN_MATCH_RATE * 100}%). Verify player registry alignment before continuing.`
        );
      }

      ctx.players      = result.players;
      ctx.ingestErrors = result.errors;
      ctx.matchStats   = result.matchStats;
      return result;
    },
  };
}

module.exports = { createIngestJob };
