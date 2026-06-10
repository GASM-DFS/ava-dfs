# Ava-DFS / GASM — Complete Project Plan

**Last updated:** 2026-06-10  
**Platform:** GCP (Cloud Run, Cloud Functions, BigQuery, Cloud Scheduler)  
**Target:** Multi-sport DFS projection and lineup optimization engine  
**Sports in scope:** MLB, NBA, NFL, WNBA, CFB, CBB, NHL  
**Platforms in scope:** DraftKings, FanDuel, Yahoo, Dabble  

---

## Current State (as of June 10, 2026)

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

## Phase 1 — Data Reliability (Weeks 1–2)
*Goal: Make MLB and NBA fully production-ready with automated, current data.*

### 1.1 — Automate MLB Salary Ingestion
The DK salary CSV is currently a one-time upload. Without fresh salaries the optimizer prices players on stale data.

- [ ] **1.1.1** Build `dk-salary-fetcher` Cloud Function (Python) that fetches the MLB salary CSV from DraftKings' public lineup tool API endpoint and parses it into `mlb_dfs_projections.v1_player_list`, replacing prior values
- [ ] **1.1.2** Add `game_date` column to `v1_player_list` and partition by it so historical salary data is preserved
- [ ] **1.1.3** Create Cloud Scheduler job `mlb-salary-sync` at 7:30am ET daily to run before the ingest/projection pipeline
- [ ] **1.1.4** Update `getMlbSlate()` in `services/data/bigquery.js` to query today's salary partition instead of all rows

### 1.2 — Complete NBA Daily Pipeline
NBA has raw game logs but no automated ingest and only 33 projections — too few to build meaningful lineups.

- [ ] **1.2.1** Build `nba-data-ingest` Cloud Function (Python) mirroring `mlb-data-ingest`: fetches yesterday's NBA box scores from NBA Stats API (`nba_api` package), calculates DK fantasy points (PTS×1 + REB×1.25 + AST×1.5 + STL×2 + BLK×2 + TO×-0.5 + DD×1.5 + TD×3), writes to `nba_dfs_projections.nba_game_logs`
- [ ] **1.2.2** Build `nba-pipeline-refresh` Cloud Function that updates `nba_dfs_projections.nba_features` (5-game and 14-game rolling averages) and regenerates `nba_dfs_projections.nba_projections` for today
- [ ] **1.2.3** Build `nba-salary-fetcher` Cloud Function that fetches DK NBA salary CSV and loads it into `nba_dfs_projections.v1_player_list`
- [ ] **1.2.4** Create Cloud Scheduler jobs: `nba-daily-sync` (7:45am ET), `nba-salary-sync` (7:30am ET), `nba-pipeline-chain` (8:30am ET)
- [ ] **1.2.5** Update `getNbaSlate()` in `services/data/bigquery.js` to join on `nba_dfs_projections.v1_player_list` for today's salary data (currently joins on `player_id` which works but needs fresh salary)
- [ ] **1.2.6** Verify NBA optimizer produces valid 8-player classic lineups end-to-end

### 1.3 — WNBA Pipeline (Season Active Now)
WNBA season is live. The contest config is already built; it just needs data.

- [ ] **1.3.1** Build `wnba-data-ingest` Cloud Function using WNBA Stats API for game logs and DK fantasy scoring (same formula as NBA)
- [ ] **1.3.2** Build `wnba-pipeline-refresh` Cloud Function for features and projections
- [ ] **1.3.3** Build `wnba-salary-fetcher` for DK salary CSV to new `wnba_dfs_projections.v1_player_list` table
- [ ] **1.3.4** Create scheduler jobs: `wnba-daily-sync`, `wnba-salary-sync`, `wnba-pipeline-chain`
- [ ] **1.3.5** Add `wnba` to `SUPPORTED_SPORTS` in `services/api/routes/slate.js` and add `getWnbaSlate()` to `services/data/bigquery.js`
- [ ] **1.3.6** Add WNBA to dashboard sport selector

### 1.4 — Pipeline Monitoring & Alerting
No visibility into daily runs failing silently.

- [ ] **1.4.1** Add Slack webhook notification to each pipeline refresh function: post success count + timing, and error traceback on failure
- [ ] **1.4.2** Create a `GET /api/v1/pipeline/status` endpoint that queries the last refresh timestamps from each sport's projections table and reports staleness
- [ ] **1.4.3** Add pipeline status badge to the dashboard header (green/yellow/red based on data age)

---

## Phase 2 — Dashboard & Optimizer Quality (Weeks 3–4)
*Goal: Make the web product something users find genuinely useful daily.*

### 2.1 — Dashboard Upgrades

- [ ] **2.1.1** Add player injury/news feed: display `Status` field from salary table as color-coded badge (GTD, OUT, Q, Active) — sourced from the DK salary export which already includes this field
- [ ] **2.1.2** Add "Value" column sort highlighting — top 10 value plays highlighted in amber
- [ ] **2.1.3** Add floor/ceiling columns to the projections table (already computed in `addProbabilisticProjections()`, just not displayed)
- [ ] **2.1.4** Add search/filter box for player name in the projections table
- [ ] **2.1.5** Add "stack" controls to optimizer panel: specify a team to stack with (pull multiple players from same game), minimum stack size
- [ ] **2.1.6** Add ownership projection column (% of lineups expected to use that player) — start with simple inverse-salary-weighted estimate
- [ ] **2.1.7** Add "Quick Lineup" single-lineup view on the projections tab (show the top optimal lineup without going to the Optimizer tab)

### 2.2 — Lineup Export Improvements

- [ ] **2.2.1** Format CSV export to match DraftKings upload template exactly (player IDs in DK format, correct column headers per sport)
- [ ] **2.2.2** Add per-lineup exposure report in the Lineups tab: show which players appear in what % of lineups
- [ ] **2.2.3** Add copy-to-clipboard button per lineup for quick DK entry

### 2.3 — Optimizer Constraint Improvements

- [ ] **2.3.1** Add weather integration for MLB: call NWS/Open-Meteo API in `getMlbSlate()`, attach wind/temp to player data, add a "weather penalty" to projection for exposed hitters in high-wind games
- [ ] **2.3.2** Add confirmed starter flag for MLB: check if SP is in the starting lineup via MLB Stats API before showing in slate
- [ ] **2.3.3** Add max exposure control to the UI (slider: 0–100% max exposure per player across N lineups — currently hardcoded in `portfolio.js`)
- [ ] **2.3.4** Add game stack constraint: require X players from same game (for GPP correlation)

---

## Phase 3 — NFL Pipeline (Weeks 5–8, before September start)
*Goal: Have NFL projections and optimizer ready before Week 1.*

### 3.1 — NFL Data Pipeline

- [ ] **3.1.1** Design NFL BigQuery schema: `nfl_data.game_logs` (rushing yards, receiving yards, TDs, receptions, pass yards, pass TDs, INTs, sacks, fumbles), `nfl_data.nfl_projections`, `nfl_data.nfl_features`
- [ ] **3.1.2** Build `nfl-data-ingest` Cloud Function using NFL Stats API (ESPN API or Pro Football Reference) for weekly box scores
- [ ] **3.1.3** Build NFL DK fantasy scoring: pass TD×4, pass yd×0.04, INT×-1, rush yd×0.1, rush TD×6, rec×1, rec yd×0.1, rec TD×6, 300-yd bonus×3, 100-yd rush bonus×3, fumble lost×-2
- [ ] **3.1.4** Build `nfl-pipeline-refresh` for features (3-game and 6-game rolling) and projections
- [ ] **3.1.5** Build `nfl-salary-fetcher` for DK NFL salary CSV
- [ ] **3.1.6** Create scheduler jobs (NFL runs weekly — Sunday game processing Monday morning)
- [ ] **3.1.7** Add `nfl` to the API and dashboard

### 3.2 — Vegas Lines Integration (NFL)

- [ ] **3.2.1** Connect The Odds API (free tier) to pull implied team totals and game spreads for NFL
- [ ] **3.2.2** Store odds in `nfl_data.game_odds` table
- [ ] **3.2.3** Incorporate implied team total as a projection multiplier (higher total = more expected fantasy points)

---

## Phase 4 — ML Projection Models (Weeks 6–10)
*Goal: Replace the static weighted-average formula with trained models.*

### 4.1 — BigQuery ML (BQML) Models
Start with BQML for fast iteration without infrastructure overhead.

- [ ] **4.1.1** Create MLB batter BQML model: `CREATE OR REPLACE MODEL mlb_data.batter_proj_model OPTIONS (model_type='LINEAR_REG', input_label_cols=['target_fantasy_pts'])` with features from `dfs_feature_store` (batting avg, recent avg, opponent ERA, park factor, weather)
- [ ] **4.1.2** Create MLB pitcher BQML model: same approach using `dfs_pitcher_feature_store`
- [ ] **4.1.3** Add park factor table `mlb_data.park_factors` (runs per game at each ballpark, sourced from Baseball Reference historical data)
- [ ] **4.1.4** Add opponent quality features: opposing pitcher ERA, opposing team defense rating (last 14 games)
- [ ] **4.1.5** Integrate BQML predictions into `mlb-pipeline-refresh`: run `ML.PREDICT` as part of the projection query
- [ ] **4.1.6** Create NBA BQML model: usage rate, pace, opponent defensive rating as key features
- [ ] **4.1.7** Add backtesting job: weekly Cloud Scheduler job that compares projected_pts vs actual for the prior week, writes MAE/RMSE to `mlb_data.model_accuracy` table
- [ ] **4.1.8** Display model accuracy metrics in the dashboard (e.g., "Model accuracy: 3.2 MAE last 7 days")

### 4.2 — Advanced MLB Features

- [ ] **4.2.1** Integrate Statcast data via `pybaseball`: barrel rate, hard-hit %, xFIP, SIERA — pull weekly via a Cloud Function
- [ ] **4.2.2** Add platoon splits: batter vs LHP vs RHP performance stored per player
- [ ] **4.2.3** Add ballpark-adjusted projections per matchup

---

## Phase 5 — Platform Expansion (Weeks 8–12)
*Goal: Support FanDuel and Yahoo in addition to DraftKings.*

### 5.1 — FanDuel Support

- [ ] **5.1.1** Add FanDuel contest configs to `services/optimizer/contests.js`: MLB (P, C/1B, 2B, 3B, SS, OF, OF, OF, UTIL — $35,000 cap), NBA (PG, PG, SG, SG, SF, SF, PF, PF, C — $60,000 cap), NFL, WNBA
- [ ] **5.1.2** Build `fd-salary-fetcher` Cloud Function to fetch FanDuel salary CSV per sport
- [ ] **5.1.3** Add FanDuel scoring formulas per sport (slightly different from DK)
- [ ] **5.1.4** Add `provider` selector to dashboard UI (DraftKings / FanDuel)
- [ ] **5.1.5** Ensure CSV export format matches FanDuel's upload template

### 5.2 — Yahoo DFS Support

- [ ] **5.2.1** Add Yahoo contest configs (MLB: SP, SP, C, 1B, 2B, 3B, SS, OF, OF, OF — $200 cap with $10 increments)
- [ ] **5.2.2** Build `yahoo-salary-fetcher` for Yahoo salary CSV
- [ ] **5.2.3** Add Yahoo scoring formulas

### 5.3 — Dabble Support

- [ ] **5.3.1** Audit Dabble's contest formats and scoring
- [ ] **5.3.2** Add contest configs and salary fetcher

---

## Phase 6 — NHL & College Sports (Weeks 10–16)
*Goal: Expand to remaining in-scope sports.*

### 6.1 — NHL Pipeline

- [ ] **6.1.1** Build `nhl-data-ingest` using NHL Stats API: goals, assists, shots, +/-, blocks, powerplay points
- [ ] **6.1.2** DK NHL scoring: G×8 + A×5 + SOG×0.9 + SHPT×2 + PPP×0.5 + BLK×0.5 + HAT×3 + win×3
- [ ] **6.1.3** NHL goalie scoring: W×6 + SO×4 + GA×-1 + SA×0.2
- [ ] **6.1.4** Full pipeline: ingest → features → projections → scheduler → API
- [ ] **6.1.5** Add NHL to dashboard

### 6.2 — College Football (CFB)

- [ ] **6.2.1** Use CFBD API (free) for game logs
- [ ] **6.2.2** Build CFB pipeline (runs during college football season, August–January)
- [ ] **6.2.3** Add CFB to API and dashboard

### 6.3 — College Basketball (CBB)

- [ ] **6.3.1** Use CBBD / Sports Reference API for game logs
- [ ] **6.3.2** Build CBB pipeline (November–April)
- [ ] **6.3.3** Add CBB to API and dashboard

---

## Phase 7 — User Management & Multi-Tenant (Weeks 12–16)
*Goal: Enable multiple users with isolated accounts.*

### 7.1 — Authentication

- [ ] **7.1.1** Add Google OAuth 2.0 login to the dashboard (replace API key modal with "Sign in with Google")
- [ ] **7.1.2** Issue per-user JWT tokens signed with a Cloud KMS key; validate on API via middleware replacing the hardcoded API key check
- [ ] **7.1.3** Create `gasm_warehouse.users` table: user_id, email, plan, created_at, api_key_hash

### 7.2 — User Data Isolation

- [ ] **7.2.1** Per-user lineup history: save generated lineups to `gasm_dfs_analytics.lineup_history` keyed by user_id
- [ ] **7.2.2** Per-user saved player notes and tags (lock preferences, custom projections)
- [ ] **7.2.3** Per-user contest entries: track which lineups were entered and actual scores

### 7.3 — Admin Panel

- [ ] **7.3.1** Build a simple admin route `/admin` (restricted to admin email) showing: active users, daily pipeline status, data freshness by sport
- [ ] **7.3.2** Salary CSV upload UI: admin can drag-and-drop a DK salary CSV to refresh any sport's salary table manually

---

## Phase 8 — Performance & Reliability (Ongoing)

### 8.1 — API Performance

- [ ] **8.1.1** Add Redis/Memorystore caching for BigQuery slate queries (cache by sport+date, 5-minute TTL) — reduces BQ costs and response time from 4s to <500ms for warm cache
- [ ] **8.1.2** Add query result pagination for projections endpoint (currently returns all 3,637 in one response)
- [ ] **8.1.3** Pre-warm the optimizer: run a dummy slate load at 8am after pipeline refresh to ensure first user request isn't slow

### 8.2 — Error Recovery

- [ ] **8.2.1** Add dead-letter queue pattern to pipeline: if `mlb-pipeline-refresh` fails, retry up to 3 times via Pub/Sub
- [ ] **8.2.2** Add a `GET /api/v1/health/deep` endpoint that validates BQ connectivity and data freshness, used by Cloud Monitoring uptime checks
- [ ] **8.2.3** Set up Cloud Monitoring alerts for: API error rate > 5%, pipeline stale > 24h, BQ query costs > $5/day

### 8.3 — Cost Controls

- [ ] **8.3.1** Add BQ slot reservations for pipeline jobs to avoid on-demand billing spikes
- [ ] **8.3.2** Partition all projection tables by `projection_date` and add data expiration (retain 90 days)
- [ ] **8.3.3** Audit and decommission unused BigQuery datasets (`gasm_vault`, `gasm_raw`, `ava_mlb_data`, `ava_dfs_analytics` if empty or redundant)

---

## Phase 9 — Monetization & API Productization (Weeks 16+)

### 9.1 — Subscription Plans

- [ ] **9.1.1** Define plan tiers: Free (MLB only, 20 lineups/day), Pro ($X/mo, all sports, 150 lineups/day), Elite ($Y/mo, all sports, unlimited, API access, model accuracy reports)
- [ ] **9.1.2** Integrate Stripe for subscription billing
- [ ] **9.1.3** Enforce plan limits in the API middleware

### 9.2 — API Documentation & Developer Access

- [ ] **9.2.1** Generate OpenAPI spec from existing routes and publish at `/api/docs`
- [ ] **9.2.2** Build API key self-service: users generate and rotate their own keys from the dashboard
- [ ] **9.2.3** Add rate limiting per API key (requests/minute, lineup generations/day)

---

## Infrastructure Cleanup (Parallel / Ongoing)

- [ ] **IC.1** Decommission the `run` Cloud Function (state: FAILED, region: us-east1) — it's broken and in the wrong region
- [ ] **IC.2** Investigate `ava-data-harvester` (state: UNKNOWN) — determine if still needed or delete
- [ ] **IC.3** Delete empty/redundant BigQuery datasets: `ava_dfs_analytics`, `gasm_vault`, `gasm_raw`, `ava_mlb_data` (verify empty first)
- [ ] **IC.4** Rotate all GCP service account keys — credentials were found exposed in Google Drive (see prior security note); audit IAM and remove any overly-permissive bindings
- [ ] **IC.5** Move API key from Cloud Run env var to Secret Manager for proper secrets management
- [ ] **IC.6** Add `.env.example` with all required env vars documented; ensure no secrets in git history

---

## Build Order Summary

```
Week 1–2   Phase 1    MLB salary auto-refresh → NBA pipeline → WNBA pipeline → monitoring
Week 3–4   Phase 2    Dashboard upgrades → export formats → optimizer constraints
Week 5–8   Phase 3    NFL pipeline → Vegas odds integration
Week 6–10  Phase 4    BQML models → Statcast features → backtesting
Week 8–12  Phase 5    FanDuel → Yahoo → Dabble
Week 10–16 Phase 6    NHL → CFB → CBB
Week 12–16 Phase 7    Google OAuth → user tables → lineup history
Week 16+   Phase 8+   Caching → monitoring → Stripe billing → API docs
```

---

## Decision Log

| Decision | Chosen | Reason |
|----------|--------|--------|
| Salary source | DraftKings public CSV endpoint | Free, reliable, no API key needed |
| Game data source (MLB) | MLB Stats API (statsapi) | Free, official, no rate limits |
| Game data source (NBA) | nba_api Python package | Free, comprehensive |
| Game data source (NFL) | ESPN API / CFBD | Free tiers cover needed data |
| ML framework | BigQuery ML first, Vertex AI if needed | BQML runs in-warehouse, no serving infra needed |
| Auth | Google OAuth → JWT | Eliminates password management; users already have Google |
| Caching | Memorystore Redis | Same VPC as Cloud Run, low latency |
