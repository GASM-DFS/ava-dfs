'use strict';

const VALID_POSITIONS = [
  'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL',
  'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'FLEX',
  'SP', 'RP', 'OF', '1B', '2B', '3B', 'SS', 'P',
];

const VALID_PROVIDERS = ['draftkings', 'fanduel', 'yahoo'];

/**
 * Validate a canonical player object.
 * @param {object} player
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePlayer(player) {
  const errors = [];
  if (!player || typeof player !== 'object') {
    return { valid: false, errors: ['player must be an object'] };
  }

  if (!player.id       || typeof player.id       !== 'string') errors.push('id: required string');
  if (!player.name     || typeof player.name     !== 'string') errors.push('name: required string');
  if (!player.team     || typeof player.team     !== 'string') errors.push('team: required string');
  if (!player.position || typeof player.position !== 'string') errors.push('position: required string');
  if (typeof player.salary !== 'number' || player.salary <= 0) errors.push('salary: required positive number');

  if (player.projectedPoints !== undefined &&
      (typeof player.projectedPoints !== 'number' || !isFinite(player.projectedPoints))) {
    errors.push('projectedPoints: must be a finite number');
  }
  if (player.projectionStdDev !== undefined &&
      (typeof player.projectionStdDev !== 'number' || player.projectionStdDev < 0)) {
    errors.push('projectionStdDev: must be a non-negative number');
  }
  if (player.ownership !== undefined &&
      (typeof player.ownership !== 'number' || player.ownership < 0 || player.ownership > 1)) {
    errors.push('ownership: must be a number in [0, 1]');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a canonical contest configuration object.
 * @param {object} contest
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateContest(contest) {
  const errors = [];
  if (!contest || typeof contest !== 'object') {
    return { valid: false, errors: ['contest must be an object'] };
  }

  if (!contest.id       || typeof contest.id       !== 'string') errors.push('id: required string');
  if (!contest.provider || !VALID_PROVIDERS.includes(contest.provider)) {
    errors.push(`provider: must be one of ${VALID_PROVIDERS.join(', ')}`);
  }
  if (!contest.sport    || typeof contest.sport    !== 'string') errors.push('sport: required string');
  if (typeof contest.salaryCap !== 'number' || contest.salaryCap <= 0) {
    errors.push('salaryCap: required positive number');
  }
  if (!Array.isArray(contest.rosterSlots) || contest.rosterSlots.length === 0) {
    errors.push('rosterSlots: required non-empty array');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePlayer, validateContest, VALID_POSITIONS, VALID_PROVIDERS };
