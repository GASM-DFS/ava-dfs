const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');

test('GET / returns health message', async () => {
  const server = app.listen(0);
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.equal(text, 'Ava-DFS platform is online.');
  } finally {
    server.close();
  }
});

test('POST /optimize returns generated lineups', async () => {
  const server = app.listen(0);
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/optimize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        players: [
          { playerId: 1, salary: 5000, baseProjection: 10, ceilingProjection: 20, ownershipProjection: 0.1 },
          { playerId: 2, salary: 4500, baseProjection: 9, ceilingProjection: 18, ownershipProjection: 0.12 }
        ],
        constraints: { lineupCount: 1, lineupSize: 2, salaryCap: 10000, mode: 'cash' }
      })
    });

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.lineups.length, 1);
    assert.equal(payload.lineups[0].players.length, 2);
  } finally {
    server.close();
  }
});
