'use strict';

const { test, describe, afterEach, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { getBoxScores } = require('../../services/ingestors/boxscores');

describe('Boxscores Ingestor Integration (Mocked Fetch)', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SPORTS_API_KEY;

  beforeEach(() => {
    // Ensure the API key exists so the script doesn't fail early
    process.env.SPORTS_API_KEY = 'test-mock-api-key';
  });

  afterEach(() => {
    // Restore the native fetch and environment state after each test
    global.fetch = originalFetch;
    if (originalApiKey) {
      process.env.SPORTS_API_KEY = originalApiKey;
    } else {
      delete process.env.SPORTS_API_KEY;
    }
  });

  test('getBoxScores successfully fetches and maps external generic API data', async () => {
    // Intercept the HTTP call and provide a controlled payload
    global.fetch = async (url, options) => {
      assert.ok(url.includes('/boxscores/nba?date=2024-02-15'), 'Should hit the correct endpoint');
      assert.equal(options.headers['Authorization'], 'Bearer test-mock-api-key', 'Should pass auth header');

      return {
        ok: true,
        json: async () => ({
          boxscores: [
            { provider_player_id: "ext-999", display_name: "Integration Player", minutes: 35.0, points: 30, rebounds: 10, assists: 5, steals: 2, blocks: 1, turnovers: 4, dk_points: 58.5 }
          ]
        })
      };
    };

    const results = await getBoxScores({ provider: 'generic', sport: 'nba', date: '2024-02-15', mock: false });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].ID, 'ext-999');
    assert.equal(results[0].Name, 'Integration Player');
    assert.equal(results[0].FantasyPointsDK, 58.5);
  });

  test('getBoxScores throws a deterministic error if the upstream API fails', async () => {
    // Simulate a 500 Internal Server Error
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await assert.rejects(
      async () => await getBoxScores({ provider: 'generic', sport: 'nba', date: '2024-02-15', mock: false }),
      /Upstream API failed with status 500: Internal Server Error/,
      'Should fail loudly with the exact API error'
    );
  });

  test('getBoxScores successfully fetches and maps SportsData.io API data concurrently', async () => {
    // Intercept multiple concurrent HTTP calls based on the URL
    global.fetch = async (url, options) => {
      assert.equal(options.headers['Accept'], 'application/json', 'Should request JSON');

      if (url.includes('/stats/json/PlayerGameStatsByDate/')) {
        return {
          ok: true,
          json: async () => ([
            {
              PlayerID: 1001,
              Name: "SportsData Player",
              Minutes: 38.5,
              Points: 28,
              Rebounds: 9,
              Assists: 11,
              Steals: 1,
              BlockedShots: 1,
              Turnovers: 3,
              FantasyPointsDraftKings: 63.25
            }
          ])
        };
      }

      if (url.includes('/dfs/json/DfsSlatesByDate/')) {
        return {
          ok: true,
          json: async () => ([
            {
              Operator: "DraftKings",
              DfsSlatePlayers: [
                { PlayerID: 1001, OperatorPlayerID: "dk-99999" }
              ]
            }
          ])
        };
      }

      throw new Error(`Unexpected fetch call to: ${url}`);
    };

    const results = await getBoxScores({ provider: 'sportsdataio', sport: 'nba', date: '2024-02-15', mock: false });
    
    assert.equal(results.length, 1);
    assert.equal(results[0].ID, 'dk-99999', 'Should successfully map SportsData PlayerID to DraftKings OperatorPlayerID');
    assert.equal(results[0].Name, 'SportsData Player');
    assert.equal(results[0].FantasyPointsDK, 63.25);
  });
});