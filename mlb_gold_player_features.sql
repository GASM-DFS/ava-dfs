CREATE OR REPLACE VIEW `gasm-481006.mlb_dfs_data.gold_player_features` AS
WITH PlayerGameLogs AS (
  SELECT
    ID,
    Name,
    GameDate,
    Salary,
    TeamAbbrev,
    FantasyPointsDK
  FROM 
    `gasm-481006.mlb_dfs_data.fact_box_scores`
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ID, GameDate ORDER BY GameDate DESC) = 1
),
RollingStats AS (
  SELECT
    ID,
    Name,
    GameDate,
    FantasyPointsDK as Target_FantasyPointsDK,
    AVG(FantasyPointsDK) OVER(PARTITION BY ID ORDER BY GameDate ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING) AS rolling_5g_dk_points
  FROM PlayerGameLogs
),
-- Aggregate batter metrics from Statcast per game
BatterStatcast AS (
  SELECT
    batter AS MLB_ID,
    game_date AS GameDate,
    AVG(launch_speed) AS avg_launch_speed,
    AVG(launch_angle) AS avg_launch_angle,
    AVG(estimated_woba_using_speedangle) AS avg_xwoba
  FROM `gasm-481006.mlb_dfs_data.fact_statcast`
  WHERE batter IS NOT NULL
  GROUP BY batter, game_date
),
-- Aggregate pitcher metrics from Statcast per game
PitcherStatcast AS (
  SELECT
    pitcher AS MLB_ID,
    game_date AS GameDate,
    AVG(release_speed) AS avg_release_speed,
    AVG(release_spin_rate) AS avg_spin_rate
  FROM `gasm-481006.mlb_dfs_data.fact_statcast`
  WHERE pitcher IS NOT NULL
  GROUP BY pitcher, game_date
)
SELECT
  r.*,
  COALESCE(bs.avg_launch_speed, 0.0) AS avg_launch_speed,
  COALESCE(bs.avg_launch_angle, 0.0) AS avg_launch_angle,
  COALESCE(bs.avg_xwoba, 0.0) AS avg_xwoba,
  COALESCE(ps.avg_release_speed, 0.0) AS avg_release_speed,
  COALESCE(ps.avg_spin_rate, 0.0) AS avg_spin_rate,
  COALESCE(w.Temperature, 72.0) AS Temperature,
  COALESCE(w.WindSpeed, 0.0) AS WindSpeed
FROM RollingStats r
-- Cross-reference with MLB mapping (Assuming dim_players holds the DraftKings to MLBAM mapping)
LEFT JOIN `gasm-481006.mlb_dfs_data.dim_players` dp
  ON r.ID = dp.ID
LEFT JOIN BatterStatcast bs 
  ON dp.MLB_ID = bs.MLB_ID AND r.GameDate = bs.GameDate
LEFT JOIN PitcherStatcast ps 
  ON dp.MLB_ID = ps.MLB_ID AND r.GameDate = ps.GameDate
LEFT JOIN `gasm-481006.mlb_dfs_data.silver_weather` w 
  ON r.GameDate = w.GameDate AND r.Name = w.HomeTeam
ORDER BY r.Name, r.GameDate DESC;