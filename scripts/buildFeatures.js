#!/usr/bin/env node
'use strict';

/**
 * Ava-DFS GASM Engine: Feature Builder Microservice
 * 
 * Usage:
 *   node scripts/buildFeatures.js --project <project-id> --dataset <dataset-id>
 * 
 * Example:
 *   node scripts/buildFeatures.js --project gasm-481006 --dataset nba_dfs_data
 */

const { BigQuery } = require('@google-cloud/bigquery');

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

  if (!args.project) die('--project is required');
  if (!args.dataset) die('--dataset is required');

  const bigquery = new BigQuery({ projectId: args.project });

  // Define the exact SQL query with dynamic dataset injection
  const query = `
    CREATE OR REPLACE TABLE \`${args.project}.${args.dataset}.gold_player_features\`
    PARTITION BY GameDate
    CLUSTER BY ID AS
    WITH PlayerGameLogs AS (
      SELECT
        ID,
        Name,
        GameDate,
        Minutes,
        Points,
        Rebounds,
        Assists,
        Steals,
        Blocks,
        TO as Turnovers,
        FantasyPointsDK
      FROM 
        \`${args.project}.${args.dataset}.fact_box_scores\`
      QUALIFY ROW_NUMBER() OVER (PARTITION BY ID, GameDate ORDER BY GameDate DESC) = 1
    ),
    RollingStats AS (
      SELECT
        ID,
        Name,
        GameDate,
        FantasyPointsDK as Target_FantasyPointsDK,
        AVG(Minutes) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_minutes,
        AVG(Points) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_points,
        AVG(Rebounds) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_rebounds,
        AVG(Assists) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_assists,
        AVG(Steals) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_steals,
        AVG(Blocks) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_blocks,
        AVG(Turnovers) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_turnovers,
        AVG(FantasyPointsDK) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_dk_points
      FROM PlayerGameLogs
    )
    SELECT
      r.*,
      COALESCE(sps.SentimentScore, 0.0) AS SentimentScore,
      COALESCE(sps.InjuryRisk, 0.0) AS InjuryRisk,
      COALESCE(stf.CircadianFatigueIndex, 0.0) AS CircadianFatigueIndex,
      COALESCE(smm.MicroMatchupAdvantage, 1.0) AS MicroMatchupAdvantage
    FROM RollingStats r
    -- 1. Bridge player to their Team
    LEFT JOIN \`${args.project}.${args.dataset}.dim_players\` dp 
      ON r.ID = dp.ID
    -- 2. Join Omni-Context Sentiment
    LEFT JOIN \`${args.project}.${args.dataset}.silver_player_sentiment\` sps 
      ON r.Name = sps.Name AND r.GameDate = sps.GameDate
    -- 3. Join Omni-Context Fatigue
    LEFT JOIN \`${args.project}.${args.dataset}.silver_team_fatigue\` stf 
      ON dp.TeamAbbrev = stf.Team AND r.GameDate = stf.GameDate
    -- 4. Join Omni-Context Micro Matchups
    LEFT JOIN \`${args.project}.${args.dataset}.silver_micro_matchups\` smm 
      ON r.ID = smm.ID AND r.GameDate = smm.GameDate
    ORDER BY r.Name, r.GameDate DESC;
  `;

  try {
    process.stdout.write(`🚀 Executing Feature Engineering SQL on ${args.project}:${args.dataset}...\n`);
    
    const [job] = await bigquery.createQueryJob({ query });
    process.stdout.write(`⏳ Job ${job.id} started. Waiting for completion...\n`);
    
    await job.getQueryResults();
    process.stdout.write('✅ Successfully built gold_player_features table.\n');
  } catch (error) {
    die(`Failed to execute BigQuery SQL: ${error.message}`);
  }
}

main();