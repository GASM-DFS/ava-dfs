# Ava-DFS GASM Engine - Master Checklist

## Phase 1: Robust Data Ingestion & Telemetry (✅ Completed)

- [x] **Cost Optimization:** Decouple from paid sports APIs and utilize DraftKings' free public JSON endpoints (`fetchDailySlate.js`).
- [x] **Smart Slate Filtering:** Automatically exclude "Showdown" and "Captain Mode" slates unless explicitly requested.
- [x] **Enterprise Resilience:** Implement true exponential back-off in both Node.js (`runner.js`) and shell execution (`with_retry` in Actions).
- [x] **Advanced Alerting:** Capture raw `stderr` process streams and push formatted Slack failure alerts with direct GitHub Action debug links.
- [x] **Infrastructure as Code:** Establish daily scheduled ingestion pipelines (`daily-ingest.yml`) authenticating via GCP Workload Identity Federation.

## Phase 2: Inference & Local Optimization Verification (✅ Completed)

- [x] **Verify Google Sheets Export:** Ensure the `sa-key.json` has `Editor` access to the target Google Sheet and can successfully clear/write rows.
- [x] **Validate MME Optimizer Locally:** Run the portfolio optimizer using mocked `/tmp/today_slate.json` and `/tmp/projections.json` to generate 20 valid lineups.
- [x] **Verify Vertex AI Deployment:** Confirm the BigQuery ML XGBoost model is properly exported, registered, and deployed to the `$VERTEX_ENDPOINT_ID`.
- [x] **Validate Probabilistic Inference:** Ensure `predictProjections.js` correctly queries Vertex AI and maps the response to our Phase 2 schema (Floor, Median, Ceiling).

## Phase 3: Cloud Automation & End-to-End Testing (✅ Completed)

- [x] **Configure Optimizer Secrets:** Add `SPREADSHEET_ID` and `VERTEX_ENDPOINT_ID` to GitHub Actions Repository Secrets.
- [x] **End-to-End Pipeline Test:** Manually dispatch the `daily-optimizer.yml` workflow and verify it successfully flows from DraftKings -> Vertex AI -> PuLP Solver -> Google Sheets.
- [x] **Verify Slack Success Telemetry:** Confirm the successful portfolio generation triggers the Slack webhook with the completed status.

## Phase 4: Advanced MME Tuning & Constraints (✅ Completed)

- [x] **Exposure Limits:** Implement strict global exposure caps in the PuLP solver (e.g., no player > 40% across the 20 lineups).
- [x] **Correlation Stacking:** Add constraints to force PG/C or QB/WR correlations based on sport.
- [x] **Dynamic Injury Updates:** Implement a pre-solver check to drop players if `InjuryRisk` from `silver_player_sentiment` is flagged high.

## Phase 5: Multi-Sport Expansion (MLB & NFL) (✅ Completed)

- [x] **MLB Weather Context:** Integrate Open-Meteo or NWS API to pull stadium weather features for the MLB pipeline.
- [x] **MLB Statcast Integration:** Design ingestion scripts for pybaseball/Baseball Savant advanced metrics.
- [x] **NFL Vegas Odds:** Connect The Odds API to pull live moneylines, spreads, and implied team totals.

## Phase 6: Continuous Model Tuning & Backtesting (✅ Completed)

- [x] **Automated Backtesting:** Create a CLI command to evaluate historical lineup performance against actual DraftKings box scores.
- [x] **Feature Store Monitoring:** Implement data drift detection to alert if player distributions shift significantly.
- [x] **Hyperparameter Tuning:** Automate Vertex AI XGBoost retuning pipelines based on backtesting feedback.