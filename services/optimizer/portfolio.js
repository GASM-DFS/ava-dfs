'use strict';

const { solveLineup }       = require('./solver');
const { sampleProjections } = require('../inference/projections');

const DEFAULT_N_LINEUPS   = 20;
const DEFAULT_MAX_EXPOSURE = 0.5; // a player may appear in at most 50 % of lineups

/**
 * Build a portfolio of N distinct lineups with exposure controls.
 *
 * Cash mode  – projections are used deterministically (floor-biased, low variance).
 * GPP mode   – projections are sampled from each player's distribution each iteration,
 *              creating lineup diversity that mirrors the stochastic nature of a tournament.
 *
 * @param {object[]} players          - players enriched by addProbabilisticProjections()
 * @param {object}   contest          - { salaryCap, rosterSlots }
 * @param {object}   [opts]
 * @param {number}   [opts.n=20]           - number of lineups to generate
 * @param {number}   [opts.maxExposure=0.5] - max fraction of lineups a single player appears in
 * @param {'cash'|'gpp'} [opts.mode='gpp']
 * @param {string[]} [opts.lockedIds=[]]   - players forced into every lineup (late swap)
 * @param {string[]} [opts.excludedIds=[]] - players removed from pool (late swap)
 * @returns {{ lineups, n, mode, exposureReport, meta }}
 */
function buildPortfolio(players, contest, {
  n           = DEFAULT_N_LINEUPS,
  maxExposure = DEFAULT_MAX_EXPOSURE,
  mode        = 'gpp',
  lockedIds   = [],
  excludedIds = [],
} = {}) {
  const lineups        = [];
  /** @type {Map<string, number>} playerId -> appearance count */
  const exposureCounts = new Map();
  /** @type {Set<string>} hashed lineup ids for O(1) deduplication */
  const seenLineups    = new Set();
  let   attempts       = 0;
  const maxAttempts    = n * 15;

  // Determine strict global limit per player
  const maxAllowed = Math.max(1, Math.floor(n * maxExposure));

  while (lineups.length < n && attempts < maxAttempts) {
    attempts++;

    // GPP: sample each player's projected points from their distribution for diversity.
    // Cash: use base projections (deterministic, risk-averse).
    const pool = mode === 'gpp' ? sampleProjections(players) : players;

    // Respect global exposure cap: once a player hits maxAllowed, permanently exclude them.
    // However, if a player is explicitly locked, they bypass the maxExposure constraint.
    const eligible = pool.filter(p => {
      if (lockedIds.includes(String(p.id))) return true;
      const count = exposureCounts.get(p.id) || 0;
      return count < maxAllowed;
    });

    // If we can't fill a lineup with remaining eligible players, stop trying.
    if (eligible.length < contest.rosterSlots.length) break;

    const isShowdown = contest.id && contest.id.includes('showdown');
    const lineup = solveLineup(eligible, contest, { lockedIds, excludedIds, requireOpponent: isShowdown });
    if (!lineup) continue;

    // Deduplicate: skip exact duplicate player-set (same IDs regardless of slot order).
    const lineupKey = lineup.players.map(p => String(p.id)).sort().join(',');
    if (seenLineups.has(lineupKey)) continue;

    seenLineups.add(lineupKey);
    lineups.push(lineup);
    for (const p of lineup.players) {
      exposureCounts.set(p.id, (exposureCounts.get(p.id) || 0) + 1);
    }
  }

  return {
    lineups,
    n:              lineups.length,
    mode,
    exposureReport: buildExposureReport(exposureCounts, lineups.length),
    meta:           { attempts, requestedN: n, maxExposure },
  };
}

function buildExposureReport(exposureCounts, total) {
  if (total === 0) return [];
  return [...exposureCounts.entries()]
    .map(([id, count]) => ({ id, count, exposure: count / total }))
    .sort((a, b) => b.exposure - a.exposure);
}

module.exports = { buildPortfolio };
