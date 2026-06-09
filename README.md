# Ava-DFS GASM Engine

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

## Local setup

1. Install dependencies and configure git hooks:
   ```bash
   npm ci
   ```
2. Copy `.env.example` to `.env` or export the variables you need in your shell.
3. Run the test suite:
   ```bash
   npm test
   ```
4. Start the API locally:
   ```bash
   API_KEYS='*' npm start
   ```
5. Verify the service:
   ```bash
   curl http://localhost:8080/api/v1/health
   ```

For local development, `API_KEYS='*'` disables API-key auth. Do not use that setting in production.

## Terraform

Use `infra/terraform.tfvars.example` as a starting point, then run:

```bash
cd infra
terraform init
terraform plan
```
