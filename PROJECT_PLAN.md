# Ava-DFS / GASM — Complete Project Plan

**Last updated:** 2026-06-10  
**Platform:** GCP (Cloud Run, Cloud Functions, BigQuery, Cloud Scheduler)  
**Sports in scope:** MLB, NBA, NFL, WNBA, CFB, CBB, NHL  
**Platforms in scope:** DraftKings, FanDuel, Yahoo, Dabble  

---

## Current State

| Component | Status | Notes |
|-----------|--------|-------|
| MLB game log ingest | ✅ Live | 199K rows, current through June 9 |
| MLB projections | ✅ Live | 3,637 players, refreshed daily at 8am ET |
| MLB salary list | ⚠️ Static | ~823 DK salaries — one-time upload, not auto-refreshed |
| NBA game logs | ⚠️ Partial | 3,996 rows through June 5; no daily ingest job |
| NBA projections | ⚠️ Minimal | Only 33 projections (insufficient for optimizer) |
| NBA salary list | ⚠️ Static | 72 entries — one-time upload |
| NFL / WNBA / NHL / CFB / CBB | ❌ None | No data pipelines exist |
| DraftKings contests | ✅ Configured | MLB, NBA, WNBA, NFL, Showdown formats |
| FanDuel / Yahoo / Dabble | ❌ None | No contest configs or salary support |
| API (Cloud Run) | ✅ Live | Slate, projections, optimizer endpoints |
| Web dashboard | ✅ Live | Projections table, optimizer, lineup export |
| ML projection model | ❌ Basic | Weighted average only; no Vertex AI / BQML |
| User management | ❌ None | Single hardcoded API key |
| Salary auto-refresh | ❌ None | Manual CSV upload only |

---

## Phase 1 — Data Reliability
*Make MLB and NBA fully production-ready with automated, current data.*

### 1.1 — Automate MLB Salary Ingestion
The DK salary CSV is a one-time upload. Without fresh salaries the optimizer prices players on stale data.

- [ ] **1.1.1** Build `dk-salary-fetcher` Cloud Function (Python) that fetches the MLB salary CSV from DraftKings' public lineup tool API endpoint and parses it into `mlb_dfs_projections.v1_player_list`
- [ ] **1.1.2** Add `game_date` column to `v1_player_list` and partition by it so historical salary data is preserved
- [ ] **1.1.3** Create Cloud Scheduler job `mlb-salary-sync` at 7:30am ET daily to run before the ingest/projection pipeline
- [ ] **1.1.4** Update `getMlbSlate()` in `services/data/bigquery.js` to query today's salary partition

### 1.2 — Complete NBA Daily Pipeline
NBA has raw game logs but no automated ingest and only 33 projections — too few to build meaningful lineups.

- [ ] **1.2.1** Build `nba-data-ingest` Cloud Function (Python): fetch yesterday's NBA box scores from NBA Stats API, calculate DK fantasy points (PTS×1 + REB×1.25 + AST×1.5 + STL×2 + BLK×2 + TO×-0.5 + DD×1.5 + TD×3), write to `nba_dfs_projections.nba_game_logs`
- [ ] **1.2.2** Build `nba-pipeline-refresh` Cloud Function: update `nba_dfs_projections.nba_features` (5-game and 14-game rolling averages) and regenerate `nba_dfs_projections.nba_projections` for today
- [ ] **1.2.3** Build `nba-salary-fetcher` Cloud Function to fetch DK NBA salary CSV into `nba_dfs_projections.v1_player_list`
- [ ] **1.2.4** Create Cloud Scheduler jobs: `nba-salary-sync` (7:30am ET), `nba-daily-sync` (7:45am ET), `nba-pipeline-chain` (8:30am ET)
- [ ] **1.2.5** Update `getNbaSlate()` in `services/data/bigquery.js` to join on today's salary partition
- [ ] **1.2.6** Verify NBA optimizer produces valid 8-player classic lineups end-to-end

### 1.3 — WNBA Pipeline
WNBA season is live. The contest config is already built; it just needs data.

- [ ] **1.3.1** Build `wnba-data-ingest` Cloud Function using WNBA Stats API for game logs and DK fantasy scoring (same formula as NBA)
- [ ] **1.3.2** Build `wnba-pipeline-refresh` Cloud Function for features and projections
- [ ] **1.3.3** Build `wnba-salary-fetcher` for DK salary CSV to new `wnba_dfs_projections.v1_player_list` table
- [ ] **1.3.4** Create scheduler jobs: `wnba-salary-sync`, `wnba-daily-sync`, `wnba-pipeline-chain`
- [ ] **1.3.5** Add `wnba` to `SUPPORTED_SPORTS` in `services/api/routes/slate.js` and add `getWnbaSlate()` to `services/data/bigquery.js`
- [ ] **1.3.6** Add WNBA to dashboard sport selector

### 1.4 — Pipeline Monitoring & Alerting
No visibility into daily runs failing silently.

- [ ] **1.4.1** Add Slack webhook notification to each pipeline refresh function: post success count + timing on success, full error traceback on failure
- [ ] **1.4.2** Create `GET /api/v1/pipeline/status` endpoint that queries last refresh timestamps from each sport's projections table and reports staleness
- [ ] **1.4.3** Add pipeline status badge to dashboard header (green = fresh, yellow = >12h, red = >24h)

---

## Phase 2 — Dashboard & Optimizer Quality
*Make the web product something users find genuinely useful every day.*

### 2.1 — Dashboard Upgrades

- [ ] **2.1.1** Add player status badges (GTD, OUT, Q, Active) sourced from the `Status` field in DK salary export
- [ ] **2.1.2** Highlight top 10 value plays in amber on the projections table
- [ ] **2.1.3** Add floor/ceiling columns to projections table (already computed in `addProbabilisticProjections()`, not yet displayed)
- [ ] **2.1.4** Add player name search/filter input
- [ ] **2.1.5** Add team stack controls to optimizer panel: select a team to stack, set minimum stack size
- [ ] **2.1.6** Add ownership projection column (inverse-salary-weighted estimate to start)
- [ ] **2.1.7** Add "Quick Lineup" single-lineup preview directly on the Projections tab

### 2.2 — Lineup Export Improvements

- [ ] **2.2.1** Format CSV export to exactly match DraftKings upload template (player IDs in DK format, correct column headers per sport)
- [ ] **2.2.2** Add per-lineup exposure report in Lineups tab (player appears in X of N lineups)
- [ ] **2.2.3** Add copy-to-clipboard button per lineup for quick DK manual entry

### 2.3 — Optimizer Constraint Improvements

- [ ] **2.3.1** Add weather integration for MLB: call NWS/Open-Meteo API, attach wind/temp to player data, apply projection penalty for hitters in high-wind games
- [ ] **2.3.2** Add confirmed starter flag for MLB: verify SP is in starting lineup via MLB Stats API before including in slate
- [ ] **2.3.3** Add max exposure slider to UI (currently hardcoded in `portfolio.js`)
- [ ] **2.3.4** Add game stack constraint: require minimum X players from the same game

---

## Phase 3 — NFL Pipeline

### 3.1 — NFL Data Pipeline

- [ ] **3.1.1** Design NFL BigQuery schema: `nfl_data.game_logs`, `nfl_data.nfl_projections`, `nfl_data.nfl_features`
- [ ] **3.1.2** Build `nfl-data-ingest` Cloud Function using ESPN API for weekly box scores
- [ ] **3.1.3** DK NFL scoring: pass TD×4, pass yd×0.04, INT×-1, rush yd×0.1, rush TD×6, REC×1, rec yd×0.1, rec TD×6, 300-yd pass bonus×3, 100-yd rush bonus×3, fumble lost×-2
- [ ] **3.1.4** Build `nfl-pipeline-refresh` for features (3-game and 6-game rolling) and projections
- [ ] **3.1.5** Build `nfl-salary-fetcher` for DK NFL salary CSV
- [ ] **3.1.6** Create weekly scheduler jobs (Sunday games → Monday morning processing)
- [ ] **3.1.7** Add `nfl` to the API and dashboard

### 3.2 — Vegas Lines Integration

- [ ] **3.2.1** Connect The Odds API (free tier) to pull implied team totals and game spreads for NFL
- [ ] **3.2.2** Store odds in `nfl_data.game_odds` table
- [ ] **3.2.3** Incorporate implied team total as a projection multiplier

---

## Phase 4 — ML Projection Models
*Replace the weighted-average formula with trained models.*

### 4.1 — BigQuery ML (BQML) Models

- [ ] **4.1.1** Create MLB batter BQML model (`LINEAR_REG`) with features from `dfs_feature_store`: batting avg, recent avg, opponent ERA, park factor, weather
- [ ] **4.1.2** Create MLB pitcher BQML model using `dfs_pitcher_feature_store`
- [ ] **4.1.3** Build `mlb_data.park_factors` table (runs per game per ballpark from historical data)
- [ ] **4.1.4** Add opponent quality features: opposing pitcher ERA, opposing team defense rating (last 14 games)
- [ ] **4.1.5** Integrate BQML predictions into `mlb-pipeline-refresh` via `ML.PREDICT`
- [ ] **4.1.6** Create NBA BQML model: usage rate, pace, opponent defensive rating as key features
- [ ] **4.1.7** Add weekly backtesting Cloud Scheduler job: compare projected_pts vs actual, write MAE/RMSE to `mlb_data.model_accuracy`
- [ ] **4.1.8** Display model accuracy in the dashboard ("Model accuracy: 3.2 MAE last 7 days")

### 4.2 — Advanced MLB Features

- [ ] **4.2.1** Integrate Statcast data via `pybaseball`: barrel rate, hard-hit %, xFIP, SIERA — weekly Cloud Function
- [ ] **4.2.2** Add platoon splits: batter vs LHP vs RHP performance per player
- [ ] **4.2.3** Add ballpark-adjusted projections per matchup

---

## Phase 5 — Platform Expansion
*Support FanDuel and Yahoo in addition to DraftKings.*

### 5.1 — FanDuel Support

- [ ] **5.1.1** Add FanDuel contest configs to `services/optimizer/contests.js`: MLB ($35,000 cap), NBA ($60,000 cap), NFL, WNBA with FD-specific roster slots
- [ ] **5.1.2** Build `fd-salary-fetcher` Cloud Function to fetch FanDuel salary CSV per sport
- [ ] **5.1.3** Add FanDuel scoring formulas per sport
- [ ] **5.1.4** Add `provider` selector to dashboard UI (DraftKings / FanDuel)
- [ ] **5.1.5** Format CSV export to match FanDuel upload template

### 5.2 — Yahoo DFS Support

- [ ] **5.2.1** Add Yahoo contest configs (MLB: $200 cap, $10 increments)
- [ ] **5.2.2** Build `yahoo-salary-fetcher`
- [ ] **5.2.3** Add Yahoo scoring formulas

### 5.3 — Dabble Support

- [ ] **5.3.1** Audit Dabble contest formats and scoring rules
- [ ] **5.3.2** Add contest configs and salary fetcher

---

## Phase 6 — NHL & College Sports

### 6.1 — NHL Pipeline

- [ ] **6.1.1** Build `nhl-data-ingest` using NHL Stats API: goals, assists, shots, +/-, blocks, powerplay points
- [ ] **6.1.2** DK NHL skater scoring: G×8 + A×5 + SOG×0.9 + SHPT×2 + PPP×0.5 + BLK×0.5 + HAT×3
- [ ] **6.1.3** DK NHL goalie scoring: W×6 + SO×4 + GA×-1 + SA×0.2
- [ ] **6.1.4** Full pipeline: ingest → features → projections → scheduler → API
- [ ] **6.1.5** Add NHL to dashboard

### 6.2 — College Football (CFB)

- [ ] **6.2.1** Use CFBD API (free) for game logs
- [ ] **6.2.2** Build CFB pipeline (August–January season)
- [ ] **6.2.3** Add CFB to API and dashboard

### 6.3 — College Basketball (CBB)

- [ ] **6.3.1** Use Sports Reference API for game logs
- [ ] **6.3.2** Build CBB pipeline (November–April season)
- [ ] **6.3.3** Add CBB to API and dashboard

---

## Phase 7 — User Management & Multi-Tenant

### 7.1 — Authentication

- [ ] **7.1.1** Add Google OAuth 2.0 login to dashboard (replace API key modal with "Sign in with Google")
- [ ] **7.1.2** Issue per-user JWT tokens signed with Cloud KMS; validate in API middleware
- [ ] **7.1.3** Create `gasm_warehouse.users` table: user_id, email, plan, created_at, api_key_hash

### 7.2 — User Data Isolation

- [ ] **7.2.1** Per-user lineup history: save generated lineups to `gasm_dfs_analytics.lineup_history` keyed by user_id
- [ ] **7.2.2** Per-user saved player tags (lock preferences, custom projections)
- [ ] **7.2.3** Per-user contest entries: track which lineups were entered and actual DK scores

### 7.3 — Admin Panel

- [ ] **7.3.1** Build `/admin` route (restricted to admin@ava-dfs.com): active users, pipeline status per sport, data freshness
- [ ] **7.3.2** Salary CSV upload UI: drag-and-drop to refresh any sport's salary table manually

---

## Phase 8 — Performance & Reliability

### 8.1 — API Performance

- [ ] **8.1.1** Add Memorystore Redis caching for BigQuery slate queries (sport+date key, 5-min TTL) — target <500ms warm response
- [ ] **8.1.2** Add pagination to projections endpoint (currently returns all 3,637 rows in one response)
- [ ] **8.1.3** Pre-warm Cloud Run at 8am after pipeline refresh so first user request isn't cold

### 8.2 — Error Recovery

- [ ] **8.2.1** Add Pub/Sub dead-letter retry for pipeline failures: up to 3 retries before Slack alert
- [ ] **8.2.2** Add `GET /api/v1/health/deep` endpoint validating BQ connectivity and data freshness
- [ ] **8.2.3** Set up Cloud Monitoring alerts: API error rate > 5%, data stale > 24h, BQ cost > $5/day

### 8.3 — Cost Controls

- [ ] **8.3.1** Partition all projection tables by date with 90-day expiration
- [ ] **8.3.2** Audit and decommission confirmed-empty BigQuery datasets (`gasm_vault`, `gasm_raw`, `ava_mlb_data`)
- [ ] **8.3.3** Decommission `run` Cloud Function (FAILED, us-east1 — wrong region, unused)

---

## Phase 9 — Monetization & API Productization

### 9.1 — Subscription Plans

- [ ] **9.1.1** Define plan tiers: Free (MLB only, 20 lineups/day), Pro (all sports, 150 lineups/day), Elite (all sports, unlimited, raw API access)
- [ ] **9.1.2** Integrate Stripe for subscription billing
- [ ] **9.1.3** Enforce plan limits in API middleware

### 9.2 — Developer API

- [ ] **9.2.1** Generate OpenAPI spec from existing routes, publish at `/api/docs`
- [ ] **9.2.2** Self-service API key management in dashboard
- [ ] **9.2.3** Per-key rate limiting (requests/min, lineup generations/day)

---

## Infrastructure & Security (Parallel / Ongoing)

- [ ] **IC.1** Rotate all GCP service account keys — credentials were found exposed in Google Drive; this is urgent
- [ ] **IC.2** Move API key from Cloud Run env var to Secret Manager
- [ ] **IC.3** Investigate or delete `ava-data-harvester` Cloud Function (state: UNKNOWN)
- [ ] **IC.4** Audit IAM bindings, remove any overly-permissive roles
- [ ] **IC.5** Add `.env.example` documenting all required env vars; verify no secrets in git history

---

## Build Order

```
Phase 1   Data Reliability      MLB salary refresh → NBA pipeline → WNBA pipeline → monitoring
Phase 2   Dashboard Quality     Status badges → export formats → weather → exposure controls
Phase 3   NFL                   Game log pipeline → Vegas odds → weekly scheduler
Phase 4   ML Models             BQML batters/pitchers → park factors → Statcast → backtesting
Phase 5   Platform Expansion    FanDuel → Yahoo → Dabble
Phase 6   Sports Expansion      NHL → CFB → CBB
Phase 7   User Management       Google OAuth → lineup history → admin panel
Phase 8   Performance           Redis cache → retry queues → Cloud Monitoring
Phase 9   Monetization          Stripe → API docs → rate limiting
```

---

## Decision Log

| Decision | Chosen | Reason |
|----------|--------|--------|
| Salary source | DraftKings public CSV endpoint | Free, no API key required |
| Game data (MLB) | MLB Stats API via `statsapi` | Free, official, no rate limits |
| Game data (NBA/WNBA) | NBA Stats API via `nba_api` | Free, comprehensive |
| Game data (NFL) | ESPN API | Free tier covers needed data |
| ML framework | BigQuery ML first | Runs in-warehouse, no serving infrastructure needed |
| Auth | Google OAuth → JWT | Eliminates password management |
| Caching | Memorystore Redis | Same VPC as Cloud Run, lowest latency |
