'use strict';

const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'gasm-481006';
const bq = new BigQuery({ projectId: PROJECT_ID });

// Normalize a player name for fuzzy matching (strip accents, punctuation, extra spaces)
function normalizeName(col) {
  return `LOWER(TRIM(REGEXP_REPLACE(NORMALIZE(${col}, NFC), r"[^a-zA-Z ]", "")))`;
}

/**
 * Fetch the MLB slate for a given date.
 * Joins mlb_projections (by name) with the DK salary list.
 * Returns players with salary, position, and projectedPoints.
 *
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<object[]>}
 */
async function getMlbSlate(date) {
  const query = `
    SELECT
      CAST(s.ID AS STRING)                      AS id,
      s.Name                                    AS name,
      s.Team                                    AS team,
      s.Position                                AS position,
      s.Salary                                  AS salary,
      COALESCE(p.projected_pts, s.AvgPts, 0.0)  AS projectedPoints,
      s.AvgPts                                  AS avgPoints,
      CAST(NULL AS STRING)                      AS status,
      "MLB"                                     AS sport,
      "draftkings"                              AS provider
    FROM \`${PROJECT_ID}.mlb_dfs_projections.v1_player_list\` s
    LEFT JOIN (
      SELECT player_name, projected_pts
      FROM \`${PROJECT_ID}.mlb_data.mlb_projections\`
      WHERE projection_date = DATE("${date}")
      QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY projection_date DESC) = 1
    ) p
      ON ${normalizeName('s.Name')} = ${normalizeName('p.player_name')}
    WHERE s.Salary IS NOT NULL AND s.Salary > 0
    ORDER BY projectedPoints DESC
  `;

  const [rows] = await bq.query({ query, location: 'us-central1' });
  return rows.map(r => ({
    id:              r.id,
    name:            r.name,
    team:            r.team,
    position:        r.position,
    salary:          Number(r.salary),
    projectedPoints: Number(r.projectedPoints) || 0,
    avgPoints:       Number(r.avgPoints) || 0,
    status:          r.status,
    sport:           r.sport,
    provider:        r.provider,
  }));
}

/**
 * Fetch the NBA slate for a given date.
 * Joins nba_projections (by player_id) with the DK NBA salary list.
 *
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<object[]>}
 */
async function getNbaSlate(date) {
  const query = `
    SELECT
      CAST(s.ID AS STRING)                      AS id,
      s.Name                                    AS name,
      s.TeamAbbrev                              AS team,
      s.Position                                AS position,
      s.Salary                                  AS salary,
      COALESCE(p.projected_pts, s.AvgPointsPerGame, 0.0) AS projectedPoints,
      s.AvgPointsPerGame                        AS avgPoints,
      s.Status                                  AS status,
      "NBA"                                     AS sport,
      "draftkings"                              AS provider
    FROM \`${PROJECT_ID}.nba_dfs_projections.v1_player_list\` s
    LEFT JOIN \`${PROJECT_ID}.nba_dfs_projections.nba_projections\` p
      ON CAST(s.ID AS STRING) = p.player_id
      AND p.projection_date = DATE("${date}")
    WHERE s.Salary IS NOT NULL AND s.Salary > 0
    ORDER BY projectedPoints DESC
  `;

  const [rows] = await bq.query({ query, location: 'us-central1' });
  return rows.map(r => ({
    id:              r.id,
    name:            r.name,
    team:            r.team,
    position:        r.position,
    salary:          Number(r.salary),
    projectedPoints: Number(r.projectedPoints) || 0,
    avgPoints:       Number(r.avgPoints) || 0,
    status:          r.status,
    sport:           r.sport,
    provider:        r.provider,
  }));
}

/**
 * Fetch top MLB projections for a date — no salary join required.
 * Used for analytics and the projections endpoint.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {'MLB'|'NBA'} sport
 * @returns {Promise<object[]>}
 */
async function getProjections(sport, date) {
  const sportUpper = sport.toUpperCase();

  if (sportUpper === 'NBA') {
    const query = `
      SELECT p.player_id, p.player_name, d.team, p.projected_pts, p.projected_minutes, p.projection_date
      FROM \`${PROJECT_ID}.nba_dfs_projections.nba_projections\` p
      LEFT JOIN \`${PROJECT_ID}.nba_dfs_projections.dim_players\` d USING (player_id)
      WHERE p.projection_date = DATE("${date}")
      ORDER BY p.projected_pts DESC
    `;
    const [rows] = await bq.query({ query, location: 'us-central1' });
    return rows;
  }

  const query = `
    SELECT p.player_id, p.player_name, d.team, d.position, p.projected_pts, p.projection_date
    FROM \`${PROJECT_ID}.mlb_data.mlb_projections\` p
    LEFT JOIN \`${PROJECT_ID}.mlb_data.dim_players\` d USING (player_id)
    WHERE p.projection_date = DATE("${date}")
    ORDER BY p.projected_pts DESC
  `;
  const [rows] = await bq.query({ query, location: 'us-central1' });
  return rows;
}

const SLATE_FETCHERS = {
  mlb:  getMlbSlate,
  nba:  getNbaSlate,
};

/**
 * Generic slate fetcher by sport slug.
 * @param {string} sport - 'mlb' | 'nba'
 * @param {string} date  - YYYY-MM-DD
 */
async function getSlate(sport, date) {
  const fetcher = SLATE_FETCHERS[sport.toLowerCase()];
  if (!fetcher) throw new Error(`Unsupported sport: ${sport}`);
  return fetcher(date);
}

module.exports = { getSlate, getMlbSlate, getNbaSlate, getProjections };
