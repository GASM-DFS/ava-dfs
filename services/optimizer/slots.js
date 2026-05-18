'use strict';

/**
 * Flex / multi-eligibility mapping.
 * Keys are "virtual" roster slots; values list the real positions that fill them.
 */
const FLEX_MAP = {
  UTIL: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'],
  G:    ['PG', 'SG'],
  F:    ['SF', 'PF'],
  FLEX: ['RB', 'WR', 'TE'],
  SP:   ['SP', 'P'],
  OF:   ['OF', 'RF', 'LF', 'CF'],
};

/**
 * Returns true when a player at `position` is eligible to fill `slot`.
 * @param {string} position - player's primary position
 * @param {string} slot     - roster slot to check
 */
function isEligibleForSlot(position, slot) {
  if (position === slot) return true;
  return (FLEX_MAP[slot] || []).includes(position);
}

module.exports = { isEligibleForSlot, FLEX_MAP };
