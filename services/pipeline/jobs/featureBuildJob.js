'use strict';

const { metrics } = require('../../observability/metrics');

/**
 * Pipeline job: compute derived features for each player and snapshot them
 * in the feature store with a version tag (Unix timestamp).
 *
 * Features added:
 *  - value         pts per $1,000 salary (pre-inference heuristic)
 *  - ceilingProxy  mean + 25 % of mean  (overwritten by inferenceJob with proper σ)
 *  - floorProxy    mean − 15 % of mean  (same)
 */
function createFeatureBuildJob(featureStore) {
  return {
    name: 'featureBuild',
    async run(ctx) {
      const players = ctx.players || [];
      const version = Date.now().toString();

      const enriched = players.map(player => {
        const pts    = player.projectedPoints;
        const value  = pts != null ? (pts / player.salary) * 1000 : 0;
        const ceiling = pts != null ? pts + (player.projectionStdDev ?? pts * 0.25) : 0;
        const floor   = pts != null ? Math.max(0, pts - (player.projectionStdDev ?? pts * 0.15)) : 0;
        return { ...player, features: { value, ceilingProxy: ceiling, floorProxy: floor, version } };
      });

      if (featureStore) featureStore.set('players', enriched, version);

      metrics.gauge('features.players.count', enriched.length);
      return { players: enriched, version };
    },
  };
}

module.exports = { createFeatureBuildJob };
