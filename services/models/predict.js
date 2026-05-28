'use strict';

const { BigQuery } = require('@google-cloud/bigquery');
const { GoogleAuth } = require('google-auth-library');

/**
 * Fetches latest features from BigQuery and retrieves probabilistic projections from Vertex AI.
 * 
 * @param {Object} params
 * @param {string} params.project - GCP Project ID
 * @param {string} params.dataset - BigQuery Dataset ID
 * @param {string} params.location - Vertex AI Location (e.g., us-central1)
 * @param {string} params.endpointId - Vertex AI Endpoint ID
 * @returns {Promise<Array>} Array of player projection objects
 */
async function getPredictions({ project, dataset, location, endpointId }) {
  const bigquery = new BigQuery({ projectId: project });
  
  // 1. Fetch the latest historical features per player
  const query = `
    SELECT * FROM (
      SELECT 
        ID, 
        Name,
        rolling_5g_minutes,
        rolling_5g_points,
        rolling_5g_rebounds,
        rolling_5g_assists,
        rolling_5g_steals,
        rolling_5g_blocks,
        rolling_5g_turnovers,
        ROW_NUMBER() OVER(PARTITION BY ID ORDER BY GameDate DESC) as rn
      FROM \`${project}.${dataset}.gold_player_features\`
    )
    WHERE rn = 1
  `;

  let features;
  try {
    const [rows] = await bigquery.query({ query });
    features = rows;
    if (!features || features.length === 0) {
      throw new Error('No features found in gold_player_features table.');
    }
  } catch (error) {
    throw new Error(`BigQuery execution failed: ${error.message}`);
  }

  // 2. Map features to the Vertex AI instances array contract.
  const instances = features.map(f => ({
    rolling_5g_minutes: f.rolling_5g_minutes || 0,
    rolling_5g_points: f.rolling_5g_points || 0,
    rolling_5g_rebounds: f.rolling_5g_rebounds || 0,
    rolling_5g_assists: f.rolling_5g_assists || 0,
    rolling_5g_steals: f.rolling_5g_steals || 0,
    rolling_5g_blocks: f.rolling_5g_blocks || 0,
    rolling_5g_turnovers: f.rolling_5g_turnovers || 0
  }));

  // 3. Authenticate and request Vertex AI Predictions
  try {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/${endpointId}:predict`;
    
    const response = await client.request({ url, method: 'POST', data: { instances } });

    // 4. Merge predictions back with player IDs.
    return response.data.predictions.map((pred, index) => {
      const baseMedian = pred.predicted_Target_FantasyPointsDK || pred;
      return {
        ID: features[index].ID,
        Name: features[index].Name,
        ProjFloor: baseMedian * 0.8,   // Simulated Phase 2 Floor
        ProjMedian: baseMedian,
        ProjCeiling: baseMedian * 1.2  // Simulated Phase 2 Ceiling
      };
    });
  } catch (error) {
    throw new Error(`Vertex AI prediction failed: ${error.message}`);
  }
}

module.exports = { getPredictions };