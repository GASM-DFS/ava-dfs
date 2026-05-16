const test = require('node:test');
const assert = require('node:assert/strict');

const { generateLineups } = require('../src');

test('generateLineups builds requested count', () => {
  const players = [
    { playerId: 1, salary: 5000, baseProjection: 10, ceilingProjection: 18, ownershipProjection: 0.2 },
    { playerId: 2, salary: 5500, baseProjection: 12, ceilingProjection: 22, ownershipProjection: 0.12 },
    { playerId: 3, salary: 4000, baseProjection: 8, ceilingProjection: 16, ownershipProjection: 0.08 }
  ];

  const lineups = generateLineups(players, {
    mode: 'gpp',
    lineupCount: 2,
    lineupSize: 2,
    salaryCap: 12000,
    maxExposure: 1
  });

  assert.equal(lineups.length, 2);
  assert.ok(lineups[0].players.length > 0);
});
