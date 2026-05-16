'use strict';

const DEFAULT_STD_DEV_RATIO = 0.30; // 30 % of mean when σ is unknown

/**
 * Sample one value from N(mean, stdDev) using the Box-Muller transform.
 */
function sampleNormal(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Inverse normal CDF (Beasley-Springer-Moro approximation).
 * Used to compute quantile values from a standard normal.
 */
function normalQuantile(p) {
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
             0.0276438810333863, 0.0038405729373609, 0.0003951896511349,
             0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
  const q = p - 0.5;
  if (Math.abs(q) <= 0.42) {
    const r = q * q;
    return q * (((a[3]*r + a[2])*r + a[1])*r + a[0]) /
               ((((b[3]*r + b[2])*r + b[1])*r + b[0])*r + 1);
  }
  const r = q < 0 ? p : 1 - p;
  const s = Math.log(-Math.log(r));
  let t = c[0];
  for (let i = 1; i < 9; i++) t += c[i] * Math.pow(s, i);
  return q < 0 ? -t : t;
}

/**
 * Compute named quantile values for N(mean, stdDev).
 * @param {number}   mean
 * @param {number}   stdDev
 * @param {number[]} quantiles - probabilities, e.g. [0.1, 0.25, 0.5, 0.75, 0.9]
 * @returns {object}  e.g. { p10: 22.1, p25: 26.4, p50: 31.0, p75: 35.6, p90: 39.9 }
 */
function computeQuantiles(mean, stdDev, quantiles = [0.1, 0.25, 0.5, 0.75, 0.9]) {
  return Object.fromEntries(
    quantiles.map(q => [`p${Math.round(q * 100)}`, Math.max(0, mean + stdDev * normalQuantile(q))])
  );
}

/**
 * Enrich each player with:
 *   projectionStdDev, quantiles { p10…p90 }, ceiling (p90), floor (p10), modelVersion.
 * Players without projectedPoints are returned unchanged.
 *
 * @param {object[]} players
 * @param {{ modelVersion?: string }} options
 * @returns {object[]}
 */
function addProbabilisticProjections(players, { modelVersion = 'builtin-v1' } = {}) {
  return players.map(player => {
    const mean = player.projectedPoints;
    if (mean == null) return player;

    const stdDev   = player.projectionStdDev ?? mean * DEFAULT_STD_DEV_RATIO;
    const quantiles = computeQuantiles(mean, stdDev);

    return {
      ...player,
      projectedPoints:    mean,
      projectionStdDev:   stdDev,
      quantiles,
      ceiling:            quantiles.p90,
      floor:              quantiles.p10,
      modelVersion,
    };
  });
}

/**
 * Return a new player array where each player's projectedPoints is randomly sampled
 * from their N(mean, σ) distribution.  Used by the portfolio builder to generate
 * lineup diversity without deterministic repetition.
 *
 * @param {object[]} players
 * @returns {object[]}
 */
function sampleProjections(players) {
  return players.map(player => {
    if (player.projectedPoints == null) return player;
    const stdDev  = player.projectionStdDev ?? player.projectedPoints * DEFAULT_STD_DEV_RATIO;
    const sampled = Math.max(0, sampleNormal(player.projectedPoints, stdDev));
    return { ...player, projectedPoints: sampled };
  });
}

module.exports = { addProbabilisticProjections, sampleProjections, computeQuantiles, sampleNormal };
