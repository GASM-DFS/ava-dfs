'use strict';

/**
 * Fetches and standardizes player box scores from external APIs.
 * 
 * @param {Object} params
 * @param {string} params.provider - The data provider name.
 * @param {string} params.sport - The sport (nba, mlb, nfl).
 * @param {string} params.date - The target date in YYYY-MM-DD format.
 * @param {boolean} [params.mock=false] - Whether to use mock data.
 * @returns {Promise<Array>} Standardized box score objects.
 */
async function getBoxScores({ provider, sport, date, mock = false }) {
  let payload;

  if (mock) {
    // Generate mock data for end-to-end pipeline testing without a real API
    payload = {
      boxscores: [
        {
          provider_player_id: "mock-123",
          display_name: "Mock Player 1",
          minutes: 36.5,
          points: 25,
          rebounds: 8,
          assists: 7,
          steals: 2,
          blocks: 1,
          turnovers: 3,
          dk_points: 52.25
        },
        {
          provider_player_id: "mock-456",
          display_name: "Mock Player 2",
          minutes: 32.0,
          points: 18,
          rebounds: 12,
          assists: 3,
          steals: 1,
          blocks: 3,
          turnovers: 1,
          dk_points: 46.5
        }
      ]
    };
  } else {
    // In a production scenario, inject your exact API endpoint and authorization headers via env vars.
    const API_BASE_URL = process.env.SPORTS_API_BASE_URL || 'https://api.example-sports-provider.com/v1';
    const API_KEY      = process.env.SPORTS_API_KEY;

    if (!API_KEY) {
      throw new Error('SPORTS_API_KEY environment variable is missing.');
    }

    const endpoint = `${API_BASE_URL}/boxscores/${sport}?date=${date}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream API failed with status ${response.status}: ${response.statusText}`);
    }

    payload = await response.json();
  }

  // Strict Data Contract Enforcement
  if (!payload || !Array.isArray(payload.boxscores)) {
    throw new Error('Data contract violation: API response missing strictly structured "boxscores" array.');
  }

  // Map the external API data to the schema expected by our `fact_box_scores` BigQuery table
  return payload.boxscores.map(b => ({
    ID: b.provider_player_id,
    Name: b.display_name,
    GameDate: date,
    Minutes: b.minutes || 0.0,
    Points: b.points || 0,
    Rebounds: b.rebounds || 0,
    Assists: b.assists || 0,
    Steals: b.steals || 0,
    Blocks: b.blocks || 0,
    TO: b.turnovers || 0, // This maps to the `TO` column your database expects
    FantasyPointsDK: b.dk_points || 0.0
  }));
}

module.exports = { getBoxScores };