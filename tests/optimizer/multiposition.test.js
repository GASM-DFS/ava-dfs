'use strict';

const { test }  = require('node:test');
const assert    = require('node:assert/strict');
const { isEligibleForSlot, parsePositions } = require('../../services/optimizer/slots');
const { solveLineup }   = require('../../services/optimizer/solver');
const { buildPortfolio } = require('../../services/optimizer/portfolio');
const { getContest }    = require('../../services/optimizer/contests');

// ---------------------------------------------------------------------------
// parsePositions
// ---------------------------------------------------------------------------

test('parsePositions handles a single position', () => {
  assert.deepEqual(parsePositions('PG'), ['PG']);
  assert.deepEqual(parsePositions('OF'), ['OF']);
  assert.deepEqual(parsePositions('P'),  ['P']);
});

test('parsePositions splits slash-separated multi-position strings', () => {
  assert.deepEqual(parsePositions('PG/SG'),  ['PG', 'SG']);
  assert.deepEqual(parsePositions('SF/PF'),  ['SF', 'PF']);
  assert.deepEqual(parsePositions('1B/OF'),  ['1B', 'OF']);
  assert.deepEqual(parsePositions('2B/SS'),  ['2B', 'SS']);
  assert.deepEqual(parsePositions('1B/3B'),  ['1B', '3B']);
  assert.deepEqual(parsePositions('SS/OF'),  ['SS', 'OF']);
});

// ---------------------------------------------------------------------------
// isEligibleForSlot – single-position backward compat
// ---------------------------------------------------------------------------

test('isEligibleForSlot: exact match (single position)', () => {
  assert.ok(isEligibleForSlot('PG', 'PG'));
  assert.ok(isEligibleForSlot('C',  'C'));
  assert.ok(isEligibleForSlot('OF', 'OF'));
  assert.ok(isEligibleForSlot('P',  'P'));
});

test('isEligibleForSlot: FLEX_MAP match (single position)', () => {
  assert.ok(isEligibleForSlot('PG', 'G'));
  assert.ok(isEligibleForSlot('SG', 'G'));
  assert.ok(isEligibleForSlot('SF', 'F'));
  assert.ok(isEligibleForSlot('PF', 'F'));
  assert.ok(isEligibleForSlot('PG', 'UTIL'));
  assert.ok(isEligibleForSlot('C',  'UTIL'));
  assert.ok(isEligibleForSlot('P',  'SP'));
});

test('isEligibleForSlot: no match (single position)', () => {
  assert.ok(!isEligibleForSlot('C',  'PG'));
  assert.ok(!isEligibleForSlot('OF', 'P'));
  assert.ok(!isEligibleForSlot('RB', 'G'));
});

// ---------------------------------------------------------------------------
// isEligibleForSlot – multi-position strings
// ---------------------------------------------------------------------------

test('isEligibleForSlot: PG/SG eligible for PG, SG, G, UTIL', () => {
  assert.ok(isEligibleForSlot('PG/SG', 'PG'));
  assert.ok(isEligibleForSlot('PG/SG', 'SG'));
  assert.ok(isEligibleForSlot('PG/SG', 'G'));
  assert.ok(isEligibleForSlot('PG/SG', 'UTIL'));
});

test('isEligibleForSlot: SF/PF eligible for SF, PF, F, UTIL', () => {
  assert.ok(isEligibleForSlot('SF/PF', 'SF'));
  assert.ok(isEligibleForSlot('SF/PF', 'PF'));
  assert.ok(isEligibleForSlot('SF/PF', 'F'));
  assert.ok(isEligibleForSlot('SF/PF', 'UTIL'));
});

test('isEligibleForSlot: 1B/OF eligible for 1B and OF slots', () => {
  assert.ok(isEligibleForSlot('1B/OF', '1B'));
  assert.ok(isEligibleForSlot('1B/OF', 'OF'));
  assert.ok(!isEligibleForSlot('1B/OF', 'P'));
  assert.ok(!isEligibleForSlot('1B/OF', 'SS'));
});

test('isEligibleForSlot: 2B/SS eligible for 2B and SS slots', () => {
  assert.ok(isEligibleForSlot('2B/SS', '2B'));
  assert.ok(isEligibleForSlot('2B/SS', 'SS'));
  assert.ok(!isEligibleForSlot('2B/SS', '1B'));
  assert.ok(!isEligibleForSlot('2B/SS', 'OF'));
});

test('isEligibleForSlot: 1B/3B eligible for 1B and 3B slots', () => {
  assert.ok(isEligibleForSlot('1B/3B', '1B'));
  assert.ok(isEligibleForSlot('1B/3B', '3B'));
  assert.ok(!isEligibleForSlot('1B/3B', '2B'));
});

test('isEligibleForSlot: SS/OF eligible for SS and OF slots', () => {
  assert.ok(isEligibleForSlot('SS/OF', 'SS'));
  assert.ok(isEligibleForSlot('SS/OF', 'OF'));
  assert.ok(!isEligibleForSlot('SS/OF', '1B'));
});

// ---------------------------------------------------------------------------
// Contest configs
// ---------------------------------------------------------------------------

test('getContest returns dk-nba-classic', () => {
  const c = getContest('dk-nba-classic');
  assert.ok(c);
  assert.equal(c.sport, 'nba');
  assert.equal(c.salaryCap, 50000);
  assert.deepEqual(c.rosterSlots, ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']);
});

test('getContest returns dk-wnba-classic', () => {
  const c = getContest('dk-wnba-classic');
  assert.ok(c);
  assert.equal(c.sport, 'wnba');
  assert.equal(c.salaryCap, 50000);
  assert.ok(c.rosterSlots.includes('G'));
  assert.ok(c.rosterSlots.includes('F'));
  assert.ok(c.rosterSlots.includes('UTIL'));
});

test('getContest returns dk-mlb-classic', () => {
  const c = getContest('dk-mlb-classic');
  assert.ok(c);
  assert.equal(c.sport, 'mlb');
  assert.equal(c.salaryCap, 50000);
  assert.deepEqual(c.rosterSlots, ['P', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF']);
});

test('getContest returns undefined for unknown id', () => {
  assert.equal(getContest('dk-showdown-nba'), undefined);
});

// ---------------------------------------------------------------------------
// WNBA classic lineup construction
// ---------------------------------------------------------------------------

function makeWnbaPlayers() {
  // DraftKings WNBA players have positions like G, F, or G/F
  return [
    { id: 'w1',  name: 'W PG1',  position: 'G',   salary: 8000,  projectedPoints: 40, projectionStdDev: 8  },
    { id: 'w2',  name: 'W PG2',  position: 'G',   salary: 7500,  projectedPoints: 36, projectionStdDev: 7  },
    { id: 'w3',  name: 'W PG3',  position: 'G',   salary: 6500,  projectedPoints: 30, projectionStdDev: 6  },
    { id: 'w4',  name: 'W PG4',  position: 'G',   salary: 5500,  projectedPoints: 24, projectionStdDev: 5  },
    { id: 'w5',  name: 'W SF1',  position: 'F',   salary: 7000,  projectedPoints: 32, projectionStdDev: 6  },
    { id: 'w6',  name: 'W SF2',  position: 'F',   salary: 6000,  projectedPoints: 27, projectionStdDev: 5  },
    { id: 'w7',  name: 'W SF3',  position: 'F',   salary: 5000,  projectedPoints: 20, projectionStdDev: 4  },
    { id: 'w8',  name: 'W GF1',  position: 'G/F', salary: 6800,  projectedPoints: 31, projectionStdDev: 6  },
    { id: 'w9',  name: 'W GF2',  position: 'G/F', salary: 5800,  projectedPoints: 25, projectionStdDev: 5  },
    { id: 'w10', name: 'W GF3',  position: 'G/F', salary: 4800,  projectedPoints: 19, projectionStdDev: 4  },
  ];
}

test('WNBA classic: solveLineup fills all 8 slots', () => {
  const contest = getContest('dk-wnba-classic');
  const players = makeWnbaPlayers();
  const lineup  = solveLineup(players, contest);

  assert.ok(lineup, 'lineup should be non-null');
  assert.equal(lineup.players.length, contest.rosterSlots.length, 'must fill all slots');
  assert.ok(lineup.totalSalary <= contest.salaryCap, 'salary must be within cap');

  const ids = lineup.players.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate players');
});

test('WNBA classic: G/F multi-position player can fill G, F, or UTIL slot', () => {
  const contest = getContest('dk-wnba-classic');
  assert.ok(isEligibleForSlot('G/F', 'G'));
  assert.ok(isEligibleForSlot('G/F', 'F'));
  assert.ok(isEligibleForSlot('G/F', 'UTIL'));
  assert.ok(!isEligibleForSlot('G/F', 'P'));
});

test('WNBA classic: buildPortfolio generates at least 1 lineup', () => {
  const contest = getContest('dk-wnba-classic');
  const players = makeWnbaPlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const portfolio = buildPortfolio(players, contest, { n: 3, maxExposure: 1.0 });

  assert.ok(portfolio.lineups.length >= 1, 'should have at least 1 lineup');
  assert.ok(portfolio.lineups.length <= 3, 'should not exceed requested n');
});

// ---------------------------------------------------------------------------
// MLB classic lineup construction
// ---------------------------------------------------------------------------

function makeMlbPlayers() {
  // Mix of single and multi-position players matching DraftKings MLB exports.
  // Salaries are sized so the cheapest valid 10-player lineup fits under $50,000.
  return [
    { id: 'm1',  name: 'M SP1',   position: 'SP',    salary: 8000,  projectedPoints: 40, projectionStdDev: 8  },
    { id: 'm2',  name: 'M SP2',   position: 'SP',    salary: 7500,  projectedPoints: 38, projectionStdDev: 7  },
    { id: 'm3',  name: 'M P1',    position: 'P',     salary: 7000,  projectedPoints: 34, projectionStdDev: 7  },
    { id: 'm4',  name: 'M C1',    position: 'C',     salary: 4500,  projectedPoints: 20, projectionStdDev: 4  },
    { id: 'm5',  name: 'M 1B1',   position: '1B',    salary: 5000,  projectedPoints: 22, projectionStdDev: 4  },
    { id: 'm6',  name: 'M 1BOF1', position: '1B/OF', salary: 4800,  projectedPoints: 21, projectionStdDev: 4  },
    { id: 'm7',  name: 'M 2B1',   position: '2B',    salary: 4500,  projectedPoints: 20, projectionStdDev: 4  },
    { id: 'm8',  name: 'M 2BSS1', position: '2B/SS', salary: 4300,  projectedPoints: 19, projectionStdDev: 4  },
    { id: 'm9',  name: 'M 3B1',   position: '3B',    salary: 4500,  projectedPoints: 20, projectionStdDev: 4  },
    { id: 'm10', name: 'M SS1',   position: 'SS',    salary: 4300,  projectedPoints: 19, projectionStdDev: 4  },
    { id: 'm11', name: 'M OF1',   position: 'OF',    salary: 4000,  projectedPoints: 18, projectionStdDev: 3  },
    { id: 'm12', name: 'M OF2',   position: 'OF',    salary: 3700,  projectedPoints: 16, projectionStdDev: 3  },
    { id: 'm13', name: 'M OF3',   position: 'OF',    salary: 3500,  projectedPoints: 15, projectionStdDev: 3  },
    { id: 'm14', name: 'M SSOF1', position: 'SS/OF', salary: 4100,  projectedPoints: 18, projectionStdDev: 3  },
  ];
}

test('MLB classic: solveLineup fills all 10 slots', () => {
  const contest = getContest('dk-mlb-classic');
  const players = makeMlbPlayers();
  const lineup  = solveLineup(players, contest);

  assert.ok(lineup, 'lineup should be non-null');
  assert.equal(lineup.players.length, contest.rosterSlots.length, 'must fill all 10 slots');
  assert.ok(lineup.totalSalary <= contest.salaryCap, 'salary must be within cap');

  const ids = lineup.players.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate players');
});

test('MLB classic: SP position fills P slot', () => {
  // DraftKings exports starting pitchers as "SP" but the slot is "P"
  assert.ok(isEligibleForSlot('SP', 'P'));
  assert.ok(isEligibleForSlot('SP', 'SP'));
});

test('MLB classic: 1B/OF fills 1B and OF slots', () => {
  assert.ok(isEligibleForSlot('1B/OF', '1B'));
  assert.ok(isEligibleForSlot('1B/OF', 'OF'));
});

test('MLB classic: buildPortfolio generates at least 1 lineup', () => {
  const contest = getContest('dk-mlb-classic');
  const players = makeMlbPlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const portfolio = buildPortfolio(players, contest, { n: 3, maxExposure: 1.0 });

  assert.ok(portfolio.lineups.length >= 1, 'should have at least 1 lineup');
});

// ---------------------------------------------------------------------------
// Backward compatibility – existing NBA behavior unchanged
// ---------------------------------------------------------------------------

function makeNbaPlayers() {
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

const DK_NBA = {
  id:          'test-dk-nba',
  provider:    'draftkings',
  sport:       'nba',
  salaryCap:   50000,
  rosterSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'],
};

test('backward compat: NBA solveLineup still works with single-position players', () => {
  const lineup = solveLineup(makeNbaPlayers(), DK_NBA);

  assert.ok(lineup, 'lineup should be non-null');
  assert.equal(lineup.players.length, DK_NBA.rosterSlots.length, 'must fill all 8 slots');
  assert.ok(lineup.totalSalary <= DK_NBA.salaryCap, 'salary must be within cap');

  const ids = lineup.players.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate players');
});

test('backward compat: NBA buildPortfolio still works', () => {
  const players   = makeNbaPlayers().map(p => ({ ...p, ceiling: p.projectedPoints + p.projectionStdDev }));
  const portfolio = buildPortfolio(players, DK_NBA, { n: 3, maxExposure: 1.0 });

  assert.ok(portfolio.lineups.length >= 1, 'should have at least 1 lineup');
});
