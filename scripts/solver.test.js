'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { solveLineup } = require('../services/optimizer/solver');

describe('Optimizer Solver: Late Swap Constraints', () => {
  // Define a simple 2-player contest for easy math
  const contest = {
    salaryCap: 50000,
    rosterSlots: ['PG', 'SG'],
    maxPlayersPerTeam: 3
  };

  const players = [
    { id: '1', name: 'Player A (Top PG)', position: 'PG', salary: 10000, projectedPoints: 50, team: 'LAL' },
    { id: '2', name: 'Player B (Alt SG)', position: 'SG', salary: 10000, projectedPoints: 45, team: 'NYK' },
    { id: '3', name: 'Player C (Alt PG)', position: 'PG', salary: 10000, projectedPoints: 40, team: 'BOS' },
    { id: '4', name: 'Player D (Top SG)', position: 'SG', salary: 10000, projectedPoints: 60, team: 'MIA' }
  ];

  it('should pick the optimal lineup without constraints', () => {
    const result = solveLineup(players, contest);
    assert.ok(result, 'Lineup should be feasible');
    const ids = result.players.map(p => String(p.id));
    
    assert.ok(ids.includes('1'), 'Should pick the highest projected PG');
    assert.ok(ids.includes('4'), 'Should pick the highest projected SG');
  });

  it('should completely exclude a player when excludedIds is provided', () => {
    const result = solveLineup(players, contest, { excludedIds: ['4'] });
    assert.ok(result, 'Lineup should be feasible');
    const ids = result.players.map(p => String(p.id));
    
    assert.ok(!ids.includes('4'), 'Should NOT pick the excluded top SG');
    assert.ok(ids.includes('2'), 'Should fall back to the next best SG');
  });

  it('should force a sub-optimal player into the lineup when lockedIds is provided', () => {
    const result = solveLineup(players, contest, { lockedIds: ['3'] });
    assert.ok(result, 'Lineup should be feasible');
    const ids = result.players.map(p => String(p.id));
    
    assert.ok(ids.includes('3'), 'Should force the locked PG into the lineup despite lower projection');
    assert.ok(!ids.includes('1'), 'Should drop the higher projected PG to accommodate the lock');
  });

  it('should handle both locks and exclusions simultaneously', () => {
    const result = solveLineup(players, contest, { lockedIds: ['3'], excludedIds: ['4'] });
    assert.ok(result, 'Lineup should be feasible');
    const ids = result.players.map(p => String(p.id));
    
    assert.deepStrictEqual(ids.sort(), ['2', '3'], 'Should only draft the locked PG and the alternate SG');
  });
});