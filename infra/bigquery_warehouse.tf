-- -----------------------------------------------------------------------------
-- Ava-DFS: Master BigQuery Data Warehouse Configuration
-- -----------------------------------------------------------------------------

variable "gcp_project_id" {
  type        = string
  description = "The GCP Project ID"
  default     = "gasm-481006"
}

variable "gcp_region" {
  type        = string
  default     = "US"
}

# ==============================================================================
# 1. DATASETS (Logically isolating sports and analytics)
# ==============================================================================

resource "google_bigquery_dataset" "nba_dfs_data" {
  dataset_id  = "nba_dfs_data"
  project     = var.gcp_project_id
  location    = var.gcp_region
  description = "NBA Bronze/Silver/Gold data tables"
}

resource "google_bigquery_dataset" "mlb_dfs_data" {
  dataset_id  = "mlb_dfs_data"
  project     = var.gcp_project_id
  location    = var.gcp_region
  description = "MLB Bronze/Silver/Gold data tables"
}

resource "google_bigquery_dataset" "ava_dfs_analytics" {
  dataset_id  = "ava_dfs_analytics"
  project     = var.gcp_project_id
  location    = var.gcp_region
  description = "Cross-sport analytics, Vegas Odds, and Feature Stores"
}

# ==============================================================================
# 2. BRONZE LAYER (Raw Data / Short Retention)
# ==============================================================================

resource "google_bigquery_table" "bronze_daily_slates" {
  dataset_id = google_bigquery_dataset.nba_dfs_data.dataset_id
  project    = var.gcp_project_id
  table_id   = "bronze_daily_slates"
  
  # Cost Control: Delete raw API dumps after 30 days
  expiration_time = null 
  
  time_partitioning {
    type  = "DAY"
    field = "ingestion_date"
  }

  schema = <<EOF
[
  {"name": "ingestion_date", "type": "DATE", "mode": "REQUIRED"},
  {"name": "provider", "type": "STRING", "mode": "REQUIRED", "description": "dk, fd, etc."},
  {"name": "raw_payload", "type": "JSON", "mode": "REQUIRED"}
]
EOF
}

# ==============================================================================
# 3. SILVER LAYER (Cleaned Facts & Advanced Metrics)
# ==============================================================================

# Fact: Standardized Box Scores
resource "google_bigquery_table" "fact_box_scores_nba" {
  dataset_id = google_bigquery_dataset.nba_dfs_data.dataset_id
  project    = var.gcp_project_id
  table_id   = "fact_box_scores"

  time_partitioning {
    type  = "DAY"
    field = "GameDate"
  }

  # Strict Data Contract
  schema = <<EOF
[
  {"name": "ID", "type": "STRING", "mode": "REQUIRED", "description": "DraftKings Player ID"},
  {"name": "Name", "type": "STRING", "mode": "REQUIRED"},
  {"name": "GameDate", "type": "DATE", "mode": "REQUIRED"},
  {"name": "Minutes", "type": "FLOAT", "mode": "NULLABLE"},
  {"name": "Points", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "Rebounds", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "Assists", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "Steals", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "Blocks", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "TO", "type": "INTEGER", "mode": "NULLABLE"},
  {"name": "FantasyPointsDK", "type": "FLOAT", "mode": "REQUIRED"}
]
EOF
}

# Advanced Data: NBA Micro Matchups
resource "google_bigquery_table" "silver_micro_matchups_nba" {
  dataset_id = google_bigquery_dataset.nba_dfs_data.dataset_id
  project    = var.gcp_project_id
  table_id   = "silver_micro_matchups"

  time_partitioning {
    type  = "DAY"
    field = "GameDate"
  }

  schema = <<EOF
[
  {"name": "GameDate", "type": "DATE", "mode": "REQUIRED"},
  {"name": "OffensivePlayerID", "type": "STRING", "mode": "REQUIRED"},
  {"name": "PrimaryDefenderID", "type": "STRING", "mode": "NULLABLE"},
  {"name": "PaceAdvantage", "type": "FLOAT", "mode": "NULLABLE", "description": "Offensive pace vs Defensive pace"},
  {"name": "ReboundRateAdvantage", "type": "FLOAT", "mode": "NULLABLE"},
  {"name": "ExpectedUsageShift", "type": "FLOAT", "mode": "NULLABLE", "description": "Usage increase due to teammate injuries"}
]
EOF
}

# Advanced Data: Team Fatigue / Circadian Rhythm
resource "google_bigquery_table" "silver_team_fatigue_nba" {
  dataset_id = google_bigquery_dataset.nba_dfs_data.dataset_id
  project    = var.gcp_project_id
  table_id   = "silver_team_fatigue"

  time_partitioning {
    type  = "DAY"
    field = "GameDate"
  }

  schema = <<EOF
[
  {"name": "GameDate", "type": "DATE", "mode": "REQUIRED"},
  {"name": "TeamAbbrev", "type": "STRING", "mode": "REQUIRED"},
  {"name": "IsB2B", "type": "BOOLEAN", "mode": "REQUIRED", "description": "Back to Back"},
  {"name": "Is3in4", "type": "BOOLEAN", "mode": "REQUIRED", "description": "3rd game in 4 nights"},
  {"name": "TimezoneCrossings", "type": "INTEGER", "mode": "NULLABLE", "description": "Number of timezones crossed in last 48 hrs"},
  {"name": "FatigueIndex", "type": "FLOAT", "mode": "REQUIRED", "description": "Calculated total fatigue penalty (0.0 to 1.0)"}
]
EOF
}