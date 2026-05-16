locals {
  storage_buckets = ["raw-data-lake", "processed-data", "model-artifacts"]
  bigquery_datasets = {
    baseball_raw   = "Raw baseball feeds"
    baseball_clean = "Cleaned baseball analytics tables"
    projections    = "DFS projection outputs"
    ownership      = "Ownership projection outputs"
  }

  pubsub_topics = ["lineup-updates", "weather-updates", "injury-updates", "odds-updates", "game-context-updates"]

  api_secrets = [
    "statcast_api_key",
    "sportsradar_api_key",
    "openweather_api_key",
    "vegas_odds_api_key"
  ]

  project_roles = [
    "roles/storage.admin",
    "roles/bigquery.dataEditor",
    "roles/pubsub.publisher",
    "roles/pubsub.subscriber",
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
    "roles/composer.worker"
  ]
}

resource "google_compute_network" "ava_dfs" {
  name                    = var.network_name
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "ava_dfs" {
  name          = "ava-dfs-subnetwork"
  ip_cidr_range = "10.42.0.0/20"
  region        = var.region
  network       = google_compute_network.ava_dfs.id

  private_ip_google_access = true
}

resource "google_compute_global_address" "service_networking" {
  name          = "ava-dfs-private-service-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.ava_dfs.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.ava_dfs.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.service_networking.name]
}

resource "google_storage_bucket" "data_lake" {
  for_each                    = toset(local.storage_buckets)
  name                        = "${var.project_id}-${each.value}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
}

resource "google_bigquery_dataset" "datasets" {
  for_each   = local.bigquery_datasets
  dataset_id = each.key
  location   = var.region
  description = each.value
}

resource "google_pubsub_topic" "topics" {
  for_each = toset(local.pubsub_topics)
  name     = each.value
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "ava-dfs-containers"
  description   = "Container repository for Ava-DFS services"
  format        = "DOCKER"
}

resource "google_composer_environment" "orchestrator" {
  name   = "ava-dfs-composer"
  region = var.region

  config {
    node_config {
      network    = google_compute_network.ava_dfs.id
      subnetwork = google_compute_subnetwork.ava_dfs.id
    }

    software_config {
      image_version = "composer-2.11.3-airflow-2.10.2"
    }
  }

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

resource "google_notebooks_instance" "vertex_workbench" {
  name         = "ava-dfs-vertex-workbench"
  location     = var.zone
  machine_type = "e2-standard-4"

  vm_image {
    project      = "deeplearning-platform-release"
    image_family = "common-cpu-notebooks"
  }

  install_gpu_driver = false
  no_public_ip       = true
  no_proxy_access    = false
}

resource "google_secret_manager_secret" "api_credentials" {
  for_each  = toset(local.api_secrets)
  secret_id = each.value

  replication {
    auto {}
  }
}

resource "google_project_iam_member" "ava_dfs_access" {
  for_each = toset(local.project_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${var.service_account_email}"
}
