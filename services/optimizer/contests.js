'use strict';

/**
 * Built-in contest configurations for supported DraftKings slate types.
 *
 * Supported:
 *   - DraftKings WNBA Classic  (dk-wnba-classic)
 *   - DraftKings MLB Classic   (dk-mlb-classic)
 *   - DraftKings NBA Classic   (dk-nba-classic)  – existing default
 *
 * Not supported in this release:
 *   - NBA/WNBA Showdown Captain Mode (CPT + UTIL duplicate-player format)
 *   - NFL/NHL/PGA/Soccer slates
 *
 * Assumptions:
 *   - Salary cap is $50,000 for all contests (DraftKings standard).
 *   - Roster slots match the standard DraftKings classic format for each sport.
 *   - WNBA UTIL slot accepts any position (G or F eligible).
 *   - MLB P slot accepts both P and SP designations from DraftKings exports.
 */

const CONTESTS = {
  'dk-nba-classic': {
    id:          'dk-nba-classic',
    provider:    'draftkings',
    sport:       'nba',
    salaryCap:   50000,
    rosterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
  },

  'dk-wnba-classic': {
    id:          'dk-wnba-classic',
    provider:    'draftkings',
    sport:       'wnba',
    salaryCap:   50000,
    // DraftKings WNBA classic: 3 G, 3 F, 1 more G, and 1 UTIL.
    // Each slot is stored as a single token ('G' or 'F'); players with multi-position
    // strings like 'G/F' are eligible for both via isEligibleForSlot.
    rosterSlots: ['G', 'G', 'F', 'F', 'G', 'F', 'G', 'UTIL'],
  },

  'dk-mlb-classic': {
    id:          'dk-mlb-classic',
    provider:    'draftkings',
    sport:       'mlb',
    salaryCap:   50000,
    // DraftKings MLB classic: P, P, C, 1B, 2B, 3B, SS, OF, OF, OF
    rosterSlots: ['P', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF'],
  },
};

/**
 * Retrieve a built-in contest config by ID.
 * Returns undefined if the contest ID is not known.
 * @param {string} id
 * @returns {object|undefined}
 */
function getContest(id) {
  return CONTESTS[id];
}

module.exports = { CONTESTS, getContest };
