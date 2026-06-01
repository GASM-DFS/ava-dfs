-- -----------------------------------------------------------------------------
-- Ava-DFS: MLB Gold Layer Feature Store
-- Target Dataset: gasm-481006.mlb_dfs_data.gold_player_features
-- Purpose: Serves as the strict training/inference contract for Vertex AI XGBoost.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW `gasm-481006.mlb_dfs_data.gold_player_features` AS
WITH DailyStatcast AS (
  -- 1. Aggregate pitch-by-pitch Statcast data into daily player summaries
  SELECT
    game_date AS date,
    batter AS mlb_id,
    MAX(player_name) AS player_name,
    MAX(home_team) AS team_abbrev, -- Needs mapping logic depending on pybaseball output
    
    -- Core Statcast ML Features
    AVG(launch_speed) AS avg_exit_velocity,
    MAX(launch_speed) AS max_exit_velocity,
    AVG(launch_angle) AS avg_launch_angle,
    
    -- Compute Barrel Rate (Launch speed >= 98mph and optimal launch angle)
    SAFE_DIVIDE(
      SUM(CASE WHEN launch_speed >= 98 AND launch_angle BETWEEN 26 AND 30 THEN 1 ELSE 0 END),
      COUNT(launch_speed)
    ) AS barrel_rate,
    
    -- Expected metrics for positive regression
    AVG(estimated_woba_using_speedangle) AS xwoba,
    
    -- Target variable placeholder (to be joined with actual box scores)
    SUM(CASE WHEN events = 'home_run' THEN 14 ELSE 0 END) AS proxy_fpts
  FROM `gasm-481006.mlb_dfs_data.fact_statcast`
  WHERE game_date IS NOT NULL
  GROUP BY game_date, batter
)

SELECT
  s.date,
  s.mlb_id,
  s.player_name,
  s.team_abbrev,
  
  -- Feature Group: Batter Profile
  s.avg_exit_velocity,
  s.max_exit_velocity,
  s.avg_launch_angle,
  s.barrel_rate,
  s.xwoba,
  
  -- Feature Group: Context & Odds (From Multi-Sport Ingestion)
  o.implied_team_total,
  o.moneyline,
  
  -- Feature Group: Environmental (From Stadium Weather Ingestion)
  w.temperature_2m AS temperature,
  w.wind_speed_10m AS wind_speed,
  w.wind_direction_10m AS wind_direction
  
FROM DailyStatcast s
-- Join Vegas Odds on Date & Team
LEFT JOIN `gasm-481006.ava_dfs_analytics.silver_vegas_odds` o
  ON s.date = o.date 
  AND s.team_abbrev = o.team_abbrev
-- Join Weather Context on Date & Team (Assuming silver_weather maps stadium to home_team)
LEFT JOIN `gasm-481006.mlb_dfs_data.silver_weather` w
  ON s.date = w.date
  AND s.team_abbrev = w.home_team_abbrev
WHERE s.date IS NOT NULL;