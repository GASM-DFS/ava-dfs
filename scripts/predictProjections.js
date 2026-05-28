#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS: Vertex AI Inference Microservice
 * 
 * Usage:
 *   node scripts/predictProjections.js --project <project-id> --dataset <dataset-id> \
 *                                      --location <region> --endpoint-id <vertex-endpoint-id>
 * 
 * Output:
 *   Writes a strict JSON array of probabilistic projections (Floor, Median, Ceiling) to stdout.
 */

const { BigQuery } = require('@google-cloud/bigquery');
const { GoogleAuth } = require('google-auth-library');

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project)       die('--project is required');
  if (!args.dataset)       die('--dataset is required');
  if (!args.location)      die('--location is required (e.g., us-central1)');
  if (!args['endpoint-id']) die('--endpoint-id is required (Vertex AI Endpoint ID)');

  const bigquery = new BigQuery({ projectId: args.project });
  
  // 1. Fetch the latest historical features per player to use for today's predictions
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
      FROM \`${args.project}.${args.dataset}.gold_player_features\`
    )
    WHERE rn = 1
  `;

  let features;
  try {
    const [rows] = await bigquery.query({ query });
    features = rows;
    if (!features || features.length === 0) {
      die('No features found in gold_player_features table.');
    }
  } catch (error) {
    die(`BigQuery execution failed: ${error.message}`);
  }

  // 2. Map features to the Vertex AI instances array contract.
  // BigQuery ML XGBoost models strictly require key-value object mappings for features.
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
    
    const url = `https://${args.location}-aiplatform.googleapis.com/v1/projects/${args.project}/locations/${args.location}/endpoints/${args['endpoint-id']}:predict`;
    
    const response = await client.request({
      url,
      method: 'POST',
      data: { instances }
    });

    // 4. Merge predictions back with player IDs.
    const predictions = response.data.predictions.map((pred, index) => {
      // BQML XGBoost exports return predictions in an object like { predicted_Target_FantasyPointsDK: 42.5 }
      const baseMedian = pred.predicted_Target_FantasyPointsDK || pred;
      
      return {
        ID: features[index].ID,
        Name: features[index].Name,
        ProjFloor: baseMedian * 0.8,   // Simulated Phase 2 Floor
        ProjMedian: baseMedian,
        ProjCeiling: baseMedian * 1.2  // Simulated Phase 2 Ceiling
      };
    });

    process.stdout.write(JSON.stringify(predictions, null, 2) + '\n');
  } catch (error) {
    die(`Vertex AI prediction failed: ${error.message}`);
  }
}

main();