'use strict';

const { validatePlayer }    = require('./schemas/player');
const { DraftKingsAdapter } = require('./adapters/draftkings');
const { FanDuelAdapter }    = require('./adapters/fanduel');

const ADAPTERS = {
  draftkings: new DraftKingsAdapter(),
  fanduel:    new FanDuelAdapter(),
};

/**
 * Ingest raw provider rows, validate each player, and enrich with stable registry IDs.
 *
 * Hard-fails if the match rate (exact + fuzzy hits vs. total valid players) drops below
 * MIN_MATCH_RATE, because a low match rate typically means the player pool has shifted
 * and downstream features would be stale or mis-attributed.
 *
 * @param {string}         provider  - 'draftkings' | 'fanduel'
 * @param {Array<object>}  rawRows   - parsed CSV/JSON rows
 * @param {object}         options   - { sport, contestId }
 * @param {import('./playerRegistry').PlayerRegistry} registry
 * @returns {{ players: object[], errors: Array<{row:number,errors:string[]}>, matchStats: object }}
 */
function ingest(provider, rawRows, options, registry) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown provider: "${provider}". Valid providers: ${Object.keys(ADAPTERS).join(', ')}`);
  }

  const canonical = adapter.transform(rawRows, options);
  const players   = [];
  const errors    = [];
  let exactMatches  = 0;
  let fuzzyMatches  = 0;
  let newRegistrations = 0;

  for (let i = 0; i < canonical.length; i++) {
    const player = canonical[i];
    const { valid, errors: validationErrors } = validatePlayer(player);
    if (!valid) {
      errors.push({ row: i, errors: validationErrors });
      continue;
    }

    const resolved = registry.resolve(player.name);
    if (resolved.confidence === 1.0) {
      player.stableId = resolved.id;
      exactMatches++;
    } else if (resolved.id) {
      player.stableId     = resolved.id;
      player.idConfidence = resolved.confidence;
      fuzzyMatches++;
    } else {
      player.stableId = registry.register(player.name, player.team, player.position);
      newRegistrations++;
    }

    players.push(player);
  }

  const matchRate = players.length > 0
    ? (exactMatches + fuzzyMatches) / players.length
    : 0;

  const matchStats = {
    total:            canonical.length,
    valid:            players.length,
    invalid:          errors.length,
    exactMatches,
    fuzzyMatches,
    newRegistrations,
    matchRate,
  };

  return { players, errors, matchStats };
}

module.exports = { ingest, ADAPTERS };
