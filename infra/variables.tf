variable "project_id" {
  description = "GCP project ID for Ava-DFS GASM Engine resources"
  type        = string
}

variable "region" {
  description = "Primary GCP region"
  type        = string
  default     = "us-central1"
}

variable "service_account_email" {
  description = "Primary ava-dfs service account email"
  type        = string
  default     = "ava-dfs@gasm-481006.iam.gserviceaccount.com"
}

variable "network_name" {
  description = "VPC network name"
  type        = string
  default     = "ava-dfs-network"
}
