'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

/**
 * Calculates micro matchup advantages for a given slate of players.
 * 
 * @param {Object} params
 * @param {Array} params.slate - Array of player objects from the daily slate.
 * @param {string} params.date - The target date in YYYY-MM-DD format.
 * @param {string} [params.project] - GCP Project ID (required if not using mock).
 * @param {string} [params.dataset] - BigQuery Dataset ID (required if not using mock).
 * @param {boolean} [params.mock=false] - Whether to use mock data instead of querying BigQuery.
 * @returns {Promise<Array>} An array of objects with { ID, Name, Opponent, MicroMatchupAdvantage }.
 */
async function getMatchupAdvantages({ slate, date, project, dataset, mock = false }) {
  if (!Array.isArray(slate)) {
    throw new Error('Data contract violation: slate input must be a JSON array of players.');
  }

  let matchupData = {}; // Map of TeamAbbrev -> { Opponent, DvP_Modifiers: {} }

  if (mock) {
    // Generate mock Defense vs Position (DvP) and matchup data for testing
    matchupData = {
      "LAL": { Opponent: "NYK", DvP_Modifiers: { "PG": 1.15, "SG": 0.95, "SF": 1.00, "PF": 1.05, "C": 0.80 } },
      "NYK": { Opponent: "LAL", DvP_Modifiers: { "PG": 0.85, "SG": 1.10, "SF": 0.90, "PF": 1.15, "C": 1.05 } },
      "MIA": { Opponent: "BOS", DvP_Modifiers: { "PG": 1.00, "SG": 1.00, "SF": 0.95, "PF": 0.95, "C": 1.20 } },
      "BOS": { Opponent: "MIA", DvP_Modifiers: { "PG": 0.90, "SG": 0.85, "SF": 1.05, "PF": 1.10, "C": 0.90 } }
    };
  } else {
    if (!project || !dataset) {
      throw new Error('project and dataset are required unless using mock data.');
    }
    const bigquery = new BigQuery({ projectId: project });
    
    const query = `
      SELECT 
        Team, 
        Opponent, 
        Def_PG_Multiplier, 
        Def_SG_Multiplier, 
        Def_SF_Multiplier, 
        Def_PF_Multiplier, 
        Def_C_Multiplier 
      FROM \`${project}.${dataset}.defense_vs_position\`
      WHERE GameDate = @targetDate
    `;
    
    try {
      const [rows] = await bigquery.query({ query, params: { targetDate: date } });
      rows.forEach(r => {
        matchupData[r.Team] = {
          Opponent: r.Opponent,
          DvP_Modifiers: { "PG": r.Def_PG_Multiplier, "SG": r.Def_SG_Multiplier, "SF": r.Def_SF_Multiplier, "PF": r.Def_PF_Multiplier, "C": r.Def_C_Multiplier }
        };
      });
    } catch (error) {
      throw new Error(`Failed to execute BigQuery SQL for matchups: ${error.message}`);
    }
  }

  return slate.map(player => {
    const primaryPos = player.Position ? player.Position.split('/')[0] : 'UTIL';
    const teamData = matchupData[player.TeamAbbrev];
    
    let advantage = 1.0;
    let opponent = "UNKNOWN";
    
    if (teamData) {
      opponent = teamData.Opponent;
      advantage = teamData.DvP_Modifiers[primaryPos] || 1.0;
    }

    return { ID: player.ID, Name: player.Name, Opponent: opponent, MicroMatchupAdvantage: parseFloat(advantage.toFixed(3)) };
  });
}

module.exports = { getMatchupAdvantages };