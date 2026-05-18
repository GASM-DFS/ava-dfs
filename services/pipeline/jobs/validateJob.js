'use strict';

const { validatePlayer }      = require('../../ingest/schemas/player');
const { isEligibleForSlot }   = require('../../optimizer/slots');
const { metrics }             = require('../../observability/metrics');

const MIN_PLAYERS_REQUIRED = 8;

/**
 * Pipeline job: validate the canonical player pool against the contest schema.
 * Asserts:
 *  - Minimum player count
 *  - No schema violations after ingest
 *  - At least one player available per required roster slot
 */
function createValidateJob(contestConfig) {
  return {
    name: 'validate',
    async run(ctx) {
      const players = ctx.players || [];

      if (players.length < MIN_PLAYERS_REQUIRED) {
        throw new Error(`Insufficient players: ${players.length} < ${MIN_PLAYERS_REQUIRED} required`);
      }

      const schemaInvalid = players.filter(p => !validatePlayer(p).valid);
      if (schemaInvalid.length > 0) {
        throw new Error(`${schemaInvalid.length} player(s) failed schema validation after ingest`);
      }

      const { rosterSlots } = contestConfig;
      const coverage = {};
      for (const slot of rosterSlots) {
        coverage[slot] = players.filter(p => isEligibleForSlot(p.position, slot)).length;
        metrics.gauge(`validate.position.${slot}`, coverage[slot]);
        if (coverage[slot] === 0) {
          throw new Error(`No players available for roster slot: ${slot}`);
        }
      }

      metrics.gauge('validate.players.total', players.length);
      return { positionCoverage: coverage, playerCount: players.length };
    },
  };
}

module.exports = { createValidateJob };
