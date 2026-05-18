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
  // P slot accepts both generic "P" and DraftKings "SP"/"RP" designations
  P:    ['SP', 'RP'],
  SP:   ['SP', 'P'],
  OF:   ['OF', 'RF', 'LF', 'CF'],
};

/**
 * Parse a DraftKings position string (possibly multi-position like "PG/SG" or "1B/OF")
 * into the individual position tokens it represents.
 * @param {string} position
 * @returns {string[]}
 */
function parsePositions(position) {
  if (!position) return [];
  return position.split('/').map(p => p.trim()).filter(Boolean);
}

/**
 * Returns true when a player at `position` is eligible to fill `slot`.
 * Handles multi-position strings such as "PG/SG", "1B/OF", "SF/PF", etc.
 * @param {string} position - player's position (may be a slash-separated multi-position string)
 * @param {string} slot     - roster slot to check
 */
function isEligibleForSlot(position, slot) {
  const positions = parsePositions(position);
  for (const pos of positions) {
    if (pos === slot) return true;
    if ((FLEX_MAP[slot] || []).includes(pos)) return true;
  }
  return false;
}

module.exports = { isEligibleForSlot, FLEX_MAP, parsePositions };
