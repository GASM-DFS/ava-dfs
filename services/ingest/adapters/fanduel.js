'use strict';

const { BaseAdapter } = require('./base');

/**
 * FanDuel adapter.
 * Expected CSV columns: Nickname, Position, Team, Salary, FPPG[, Id, Projected Ownership]
 */
class FanDuelAdapter extends BaseAdapter {
  constructor() { super('fanduel'); }

  transform(rows, { sport = 'nba', contestId = 'fd-default' } = {}) {
    if (!Array.isArray(rows)) throw new Error('FanDuelAdapter.transform expects an array of row objects');

    return rows
      .filter(row => row.Nickname && row.Position && row.Salary)
      .map((row, idx) => {
        this._requireFields(row, ['Nickname', 'Position', 'Team', 'Salary']);
        return {
          id:              `fd-${sport}-${row['Id'] || idx}`,
          name:            String(row.Nickname).trim(),
          position:        String(row.Position).trim(),
          team:            String(row.Team).trim(),
          salary:          this._parseSalary(row.Salary),
          projectedPoints: row.FPPG ? Number(row.FPPG) : undefined,
          ownership:       row['Projected Ownership'] ? Number(row['Projected Ownership']) / 100 : undefined,
          provider:        'fanduel',
          contestId,
          sport,
          _raw:            row,
        };
      });
  }
}

module.exports = { FanDuelAdapter };
