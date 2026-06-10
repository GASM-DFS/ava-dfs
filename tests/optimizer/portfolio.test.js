'use strict';

const { test }  = require('node:test');
const assert    = require('node:assert/strict');
const { solveLineup }  = require('../../services/optimizer/solver');
const { buildPortfolio } = require('../../services/optimizer/portfolio');

const DK_NBA = {
  id:          'test-dk-nba',
  provider:    'draftkings',
  sport:       'nba',
  salaryCap:   50000,
  rosterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
};

/** Minimal player pool that can always fill the 8-slot DK NBA roster under $50k. */
function makePlayers() {
  return [
    { id: 'p1',  name: 'A PG1', position: 'PG', salary: 8000, projectedPoints: 40, projectionStdDev: 8  },
    { id: 'p2',  name: 'B PG2', position: 'PG', salary: 6500, projectedPoints: 30, projectionStdDev: 6  },
    { id: 'p3',  name: 'C SG1', position: 'SG', salary: 7500, projectedPoints: 35, projectionStdDev: 7  },
    { id: 'p4',  name: 'D SG2', position: 'SG', salary: 5500, projectedPoints: 25, projectionStdDev: 5  },
    { id: 'p5',  name: 'E SF1', position: 'SF', salary: 7000, projectedPoints: 32, projectionStdDev: 6  },
    { id: 'p6',  name: 'F SF2', position: 'SF', salary: 5000, projectedPoints: 22, projectionStdDev: 5  },
    { id: 'p7',  name: 'G PF1', position: 'PF', salary: 6000, projectedPoints: 28, projectionStdDev: 6  },
    { id: 'p8',  name: 'H PF2', position: 'PF', salary: 4500, projectedPoints: 18, projectionStdDev: 4  },
    { id: 'p9',  name: 'I C1',  position: 'C',  salary: 7000, projectedPoints: 30, projectionStdDev: 7  },
    { id: 'p10', name: 'J C2',  position: 'C',  salary: 4000, projectedPoints: 15, projectionStdDev: 4  },
    { id: 'p11', name: 'K PG3', position: 'PG', salary: 5000, projectedPoints: 20, projectionStdDev: 5  },
    { id: 'p12', name: 'L SG3', position: 'SG', salary: 4800, projectedPoints: 18, projectionStdDev: 4  },
    { id: 'p13', name: 'M SF3', position: 'SF', salary: 4600, projectedPoints: 17, projectionStdDev: 4  },
    { id: 'p14', name: 'N PF3', position: 'PF', salary: 4400, projectedPoints: 16, projectionStdDev: 4  },
    { id: 'p15', name: 'O PG4', position: 'PG', salary: 4200, projectedPoints: 14, projectionStdDev: 3  },
  ];
}

test('solveLineup returns a valid lineup within salary cap', () => {
  const lineup = solveLineup(makePlayers(), DK_NBA);

  assert.ok(lineup,                                           'lineup should be non-null');
  assert.equal(lineup.players.length, DK_NBA.rosterSlots.length, 'must fill all slots');
  assert.ok(lineup.totalSalary  <= DK_NBA.salaryCap,          'salary must be within cap');
  assert.ok(lineup.totalProjection > 0,                       'projected points should be positive');

  // No duplicates
  const ids = lineup.players.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate players');
});

test('solveLineup returns null when every player exceeds remaining salary', () => {
  const expensive = makePlayers().map(p => ({ ...p, salary: 100_000 }));
  assert.equal(solveLineup(expensive, DK_NBA), null);
});

test('buildPortfolio generates at least 1 lineup', () => {
  const players   = makePlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const portfolio = buildPortfolio(players, DK_NBA, { n: 3, maxExposure: 1.0 });

  assert.ok(portfolio.lineups.length >= 1,   'should have at least 1 lineup');
  assert.ok(portfolio.lineups.length <= 3,   'should not exceed requested n');
  assert.ok(Array.isArray(portfolio.exposureReport));
});

test('buildPortfolio exposure report lists all used players', () => {
  const players   = makePlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const portfolio = buildPortfolio(players, DK_NBA, { n: 5, maxExposure: 1.0 });

  // Every player in any lineup should appear in the exposure report
  const reportedIds = new Set(portfolio.exposureReport.map(e => e.id));
  for (const lineup of portfolio.lineups) {
    for (const p of lineup.players) {
      assert.ok(reportedIds.has(p.id), `player ${p.id} missing from exposure report`);
    }
  }
});

test('buildPortfolio cash mode uses deterministic projections', () => {
  // With cash mode and a fixed player pool the lineup should always be the same
  const players = makePlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const a = buildPortfolio(players, DK_NBA, { n: 1, mode: 'cash', maxExposure: 1.0 });
  const b = buildPortfolio(players, DK_NBA, { n: 1, mode: 'cash', maxExposure: 1.0 });

  assert.ok(a.lineups.length >= 1);
  assert.deepEqual(
    a.lineups[0].players.map(p => p.id).sort(),
    b.lineups[0].players.map(p => p.id).sort(),
    'cash mode should produce deterministic lineups'
  );
});
