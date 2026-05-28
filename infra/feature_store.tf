variable "project_id" {
  type        = string
  description = "The GCP Project ID"
}

variable "dataset_id" {
  type        = string
  description = "The BigQuery Dataset ID where the feature store table will reside"
  default     = "ava_dfs_analytics" 
}

resource "google_bigquery_table" "feature_store" {
  project    = var.project_id
  dataset_id = var.dataset_id
  table_id   = "feature_store"

  description = "Versioned feature store backing the Ava-DFS GASM Engine"

  schema = <<EOF
[
  {
    "name": "feature_set_name",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Name of the feature set (e.g., 'players')"
  },
  {
    "name": "version",
    "type": "STRING",
    "mode": "REQUIRED",
    "description": "Version identifier string, typically a Unix timestamp"
  },
  {
    "name": "data",
    "type": "JSON",
    "mode": "REQUIRED",
    "description": "The stored snapshot payload"
  },
  {
    "name": "created_at",
    "type": "TIMESTAMP",
    "mode": "REQUIRED",
    "description": "Timestamp when the feature snapshot was stored"
  }
]
EOF

  # Partitioning by day optimizes query costs and improves performance
  # when the store looks up recent versions or prunes old snapshots.
  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }
}