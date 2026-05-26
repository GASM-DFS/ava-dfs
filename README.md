# Ava-DFS

A scalable DFS platform scaffold organized around GCP infrastructure and service boundaries.

## Structure

- `services/api` — Express API endpoints for ingestion, projections, and optimization
- `services/ingestors` — Source-specific ingestion runners following fetch → validate → store → publish
- `services/pipelines` — Airflow DAG skeletons and SQL transform placeholders
- `services/models` — Projection, variance, simulation, and ownership modeling scaffolds
- `services/optimizer` — Cash/GPP lineup generation scaffold with exposure controls
- `infra` — Terraform for storage, BigQuery, Pub/Sub, networking, IAM, Composer, Vertex Workbench, and secrets

## Commands

- `npm start` — run API service
- `npm test` — run node test suites
- `npm run ingest -- ingest-statcast` — execute a single ingestor stub

## Local Run

1. `npm install`
2. `npm start`
3. Verify service health: `curl http://localhost:8080/api/v1/health`

## Terraform

Use `infra/terraform.tfvars.example` as a starting point, then run:

```bash
cd infra
terraform init
terraform plan
```
