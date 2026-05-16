output "storage_buckets" {
  value = { for key, bucket in google_storage_bucket.data_lake : key => bucket.name }
}

output "bigquery_datasets" {
  value = [for dataset in google_bigquery_dataset.datasets : dataset.dataset_id]
}

output "pubsub_topics" {
  value = [for topic in google_pubsub_topic.topics : topic.name]
}

output "composer_environment_name" {
  value = google_composer_environment.orchestrator.name
}

output "artifact_registry_repo" {
  value = google_artifact_registry_repository.containers.repository_id
}
