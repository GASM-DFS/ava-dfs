'use strict';

const { BaseAdapter } = require('./base');

/**
 * DraftKings adapter.
 * Expected CSV columns: Name, Position, TeamAbbrev, Salary, AvgPointsPerGame[, ID, OwnershipProjection]
 */
class DraftKingsAdapter extends BaseAdapter {
  constructor() { super('draftkings'); }

  transform(rows, { sport = 'nba', contestId = 'dk-default' } = {}) {
    if (!Array.isArray(rows)) throw new Error('DraftKingsAdapter.transform expects an array of row objects');

    return rows
      .filter(row => row.Name && row.Position && row.Salary)
      .map((row, idx) => {
        this._requireFields(row, ['Name', 'Position', 'TeamAbbrev', 'Salary']);
        return {
          id:               `dk-${sport}-${row['ID'] || idx}`,
          name:             String(row.Name).trim(),
          position:         String(row.Position).trim(),
          team:             String(row.TeamAbbrev).trim(),
          salary:           this._parseSalary(row.Salary),
          projectedPoints:  row.AvgPointsPerGame ? Number(row.AvgPointsPerGame) : undefined,
          ownership:        row.OwnershipProjection ? Number(row.OwnershipProjection) / 100 : undefined,
          provider:         'draftkings',
          contestId,
          sport,
          _raw:             row,
        };
      });
  }
}

module.exports = { DraftKingsAdapter };
