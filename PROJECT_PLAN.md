# Ava-DFS / GASM — Complete Project Plan

**Last updated:** 2026-06-10  
**Platform:** GCP (Cloud Run, Cloud Functions gen2, BigQuery us-central1, Cloud Scheduler)  
**Sports in scope:** MLB, NBA, NFL, WNBA, CFB, CBB, NHL  
**Platforms in scope:** DraftKings, FanDuel, Yahoo, Dabble  
**GCP Project:** `gasm-481006`  
**API URL:** `https://ava-dfs-api-5i4dg43y2q-uc.a.run.app`

---

## Current State Snapshot

| Component | Status | Detail |
|-----------|--------|--------|
| MLB game log ingest | ✅ Live | 199K rows through 2026-06-09; runs 8am ET daily via `mlb-daily-sync` |
| MLB features (v2) | ✅ Live | 14-game rolling window in `mlb_data.mlb_features_v2` |
| MLB projections | ✅ Live | 3,637 players for today; `mlb-pipeline-chain` runs 8:30am ET |
| MLB salary list | ⚠️ Static | 3 rows in `mlb_dfs_projections.v1_player_list`; was ~823 but is stale |
| NBA game logs | ⚠️ Partial | 3,996 rows through 2026-06-05; no daily ingest job |
| NBA projections | ⚠️ Minimal | 33 rows — insufficient for a meaningful lineup |
| NBA salary list | ⚠️ Static | 72 entries, one-time upload |
| WNBA / NFL / NHL / CFB / CBB | ❌ None | No BQ datasets, no functions, no pipelines |
| DK contest configs | ✅ Built | MLB, NBA, NFL, WNBA classic; NBA/WNBA showdown in `services/optimizer/contests.js` |
| FanDuel / Yahoo / Dabble | ❌ None | No contest configs, no scoring, no salary fetchers |
| API (Cloud Run) | ✅ Live | `/api/v1/slate/:sport/:date`, `/projections/:sport/:date`, `/optimize/:sport/:date` |
| Web dashboard | ✅ Live | Projections table, optimizer, lineup display, CSV export |
| Probabilistic projections | ✅ Built | Box-Muller Normal sampling, p10/p25/p50/p75/p90 quantiles, floor/ceiling |
| ILP Optimizer | ✅ Built | `javascript-lp-solver`; salary cap, slot constraints, team max, lock/exclude, dedup |
| Portfolio builder | ✅ Built | GPP/cash modes, exposure caps, deduplication |
| Auth middleware | ✅ Built | `API_KEYS` env var; `X-API-Key` header or `?api_key=` query param |
| Rate limiting | ✅ Built | In-memory per-tenant 60 req/min rolling window |
| ML projection model | ❌ Placeholder | Weighted avg (70% 14-game avg + 30% 14-game max); no BQML yet |
| User management | ❌ None | Single hardcoded key; no OAuth, no user table |
| Salary auto-refresh | ❌ None | Manual CSV upload only |

---

## Phase 1 — Data Reliability

> Goal: Every live sport has a fully automated daily pipeline — fresh salaries, fresh game logs, fresh projections — by the time users open the dashboard each morning.

---

### 1.1 — MLB Salary Auto-Refresh

**Problem:** `mlb_dfs_projections.v1_player_list` is a one-time upload (currently 3 rows). The optimizer joins salary data from this table; stale or missing salaries mean incorrect lineup values.

**Solution:** A Cloud Function that discovers today's DK MLB draft group via DK's public API, downloads the salary CSV, and replaces the table contents daily.

#### Tasks

**1.1.1 — Discover DK draft group for MLB**

Create `services/ingest/dk_salary_fetcher/main.py`.

DK exposes draft groups at:
```
GET https://api.draftkings.com/draftgroups/v1/draftgroups
  ?sportId=5          ← MLB
  &startTimeBefore=YYYY-MM-DDT23:59:59Z
  &startTimeAfter=YYYY-MM-DDT00:00:00Z
```
Sport IDs: MLB=5, NBA=4, NFL=1, WNBA=8, NHL=9.

Parse the response array, filter `gameType.gameTypeName == "Classic"`, take the first `draftGroupId`. If no classic group exists for today, log and exit cleanly (no games today).

**1.1.2 — Download salary CSV from DK**

Once `draftGroupId` is known, download:
```
GET https://www.draftkings.com/lineup/getavailableplayerscsv
  ?contestTypeId=28   ← MLB Classic contestTypeId
  &draftGroupId={id}
```
CSV columns returned by DK: `Position, Name + ID, Name, ID, Roster Position, Salary, Game Info, TeamAbbrev, AvgPointsPerGame`.

Parse with Python `csv.DictReader`. Strip the `(XXXXXX)` suffix from the `Name + ID` field to extract the clean `Name`.

**1.1.3 — Add `slate_date` and `provider` columns to `v1_player_list`**

Alter the existing table schema to add:
- `slate_date DATE` — the date this salary row applies to
- `provider STRING` — always `"draftkings"` for now

Run via `bq update` or DDL `ALTER TABLE`. Partition the table by `slate_date`.

After altering, do `INSERT INTO ... SELECT ... WHERE slate_date = DATE('YYYY-MM-DD')` rather than full table replace, so historical salary data is preserved. Use `MERGE` to upsert on `(ID, slate_date)` to avoid duplicates on reruns.

**1.1.4 — Write rows to BQ**

Use `google-cloud-bigquery` Python client. Insert rows as JSON with the following field mapping from DK CSV → BQ:

| DK CSV field | BQ column | Type |
|---|---|---|
| Name | Name | STRING |
| ID | ID | INT64 |
| Position | Position | STRING |
| Salary | Salary | INT64 |
| AvgPointsPerGame | AvgPts | FLOAT64 |
| TeamAbbrev | Team | STRING |
| Status (if present) | Status | STRING |
| (computed) | slate_date | DATE |
| (computed) | provider | STRING |

**1.1.5 — Deploy as `dk-mlb-salary-fetcher` Cloud Function**

```
gcloud functions deploy dk-mlb-salary-fetcher
  --gen2 --runtime=python312 --region=us-central1
  --entry-point=fetch_mlb_salaries --trigger-http
  --allow-unauthenticated --memory=256MB --timeout=120s
```

**1.1.6 — Create Cloud Scheduler job `mlb-salary-sync`**

```
Schedule: 30 7 * * *   (7:30am ET — 30 min before ingest)
Target: https://dk-mlb-salary-fetcher-5i4dg43y2q-uc.a.run.app/
Method: POST
```

**1.1.7 — Update `getMlbSlate()` in `services/data/bigquery.js`**

Change the FROM clause to filter by today's `slate_date` partition:
```sql
FROM `gasm-481006.mlb_dfs_projections.v1_player_list` s
WHERE s.slate_date = DATE("{date}")
```

Also add `s.Status` to the SELECT so the dashboard can display injury flags.

**Done when:** Running the function for a day with MLB games returns ≥100 players with valid salaries in `v1_player_list`; running it on a day without games returns 0 rows and exits with 200 + explanatory message; the slate API endpoint returns correct salaries for today.

---

### 1.2 — NBA Daily Pipeline (Complete Rebuild)

**Problem:** NBA has 33 projections and no automated ingest. The NBA season may be over for this year, but the pipeline needs to be ready for next season and for playoff/finals scenarios.

**Solution:** Three Cloud Functions (ingest, features+projections, salary) plus three scheduler jobs, mirroring the proven MLB pattern exactly.

#### Tasks

**1.2.1 — Create `nba-data-ingest` Cloud Function**

File: `services/ingest/nba_data_ingest/main.py`

Use NBA Stats API directly (no `nba_api` package — too brittle; use raw HTTP):
```
GET https://stats.nba.com/stats/leaguegamelog
  ?Counter=1000&DateFrom=MM/DD/YYYY&DateTo=MM/DD/YYYY
  &Direction=DESC&LeagueID=00&PlayerOrTeam=P&Season=2025-26
  &SeasonType=Regular+Season&Sorter=DATE
Headers: {"User-Agent": "Mozilla/5.0", "Referer": "https://stats.nba.com"}
```

DK NBA fantasy scoring formula (apply to `NBA_FANTASY_PTS` already in the log — but also compute it independently to verify):
```
PTS×1.0 + REB×1.25 + AST×1.5 + STL×2.0 + BLK×2.0 + TOV×-0.5 + DD2×1.5 + TD3×3.0
```

The `nba_game_logs` table already has `NBA_FANTASY_PTS` from the Stats API — use that column directly as `fantasy_pts` to avoid recomputing.

Write to `nba_dfs_projections.nba_game_logs` using `INSERT INTO ... SELECT ... WHERE game_date = '{bq_date}'` with a `NOT EXISTS` guard to prevent duplicate ingestion.

Handle the `GAME_DATE` column (currently stored as STRING "YYYY-MM-DD" in existing table) — cast to DATE on insert.

**1.2.2 — Create `nba-pipeline-refresh` Cloud Function**

File: `services/ingest/nba_pipeline_refresh/main.py`

Step 1 — Check for new game log rows since last feature snapshot (same pattern as MLB):
```sql
SELECT COUNT(*) AS cnt
FROM `nba_dfs_projections.nba_game_logs`
WHERE CAST(GAME_DATE AS DATE) > (
  SELECT COALESCE(MAX(game_date), DATE('2024-01-01'))
  FROM `nba_dfs_projections.nba_features`
)
```

Step 2 — If new rows exist, append to `nba_dfs_projections.nba_features`:
```sql
INSERT INTO `nba_dfs_projections.nba_features`
WITH base AS (
  SELECT
    CAST(PLAYER_ID AS STRING)            AS player_id,
    PLAYER_NAME                          AS player_name,
    TEAM_ABBREVIATION                    AS team,
    CAST(GAME_DATE AS DATE)              AS game_date,
    NBA_FANTASY_PTS                      AS fantasy_pts,
    MIN                                  AS minutes,
    PTS, REB, AST, STL, BLK, TOV
  FROM `nba_dfs_projections.nba_game_logs`
),
windowed AS (
  SELECT
    player_id, player_name, team, game_date,
    fantasy_pts                                          AS target_fantasy_pts,
    AVG(fantasy_pts)  OVER w5                            AS avg_pts_last_5,
    MAX(fantasy_pts)  OVER w5                            AS max_pts_last_5,
    AVG(fantasy_pts)  OVER w14                           AS avg_pts_last_14,
    MAX(fantasy_pts)  OVER w14                           AS max_pts_last_14,
    AVG(minutes)      OVER w14                           AS avg_min_last_14,
    AVG(PTS)          OVER w14                           AS avg_pts_stat_last_14,
    AVG(REB)          OVER w14                           AS avg_reb_last_14,
    AVG(AST)          OVER w14                           AS avg_ast_last_14
  FROM base
  WINDOW
    w5  AS (PARTITION BY player_id ORDER BY game_date ROWS BETWEEN 5  PRECEDING AND 1 PRECEDING),
    w14 AS (PARTITION BY player_id ORDER BY game_date ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING)
)
SELECT w.*
FROM windowed w
WHERE w.game_date > (SELECT COALESCE(MAX(game_date), DATE('2024-01-01')) FROM `nba_dfs_projections.nba_features`)
AND NOT EXISTS (
  SELECT 1 FROM `nba_dfs_projections.nba_features` f
  WHERE f.player_id = w.player_id AND f.game_date = w.game_date
)
```

Step 3 — Regenerate today's projections. Create schema for `nba_dfs_projections.nba_projections`:
```
player_id STRING, player_name STRING, team STRING,
projected_pts FLOAT64, projected_minutes FLOAT64,
projection_date DATE
```

Projection formula (same weighted blend as MLB):
```sql
INSERT INTO `nba_dfs_projections.nba_projections`
SELECT
  player_id, player_name, team,
  ROUND(COALESCE(avg_pts_last_14, 0) * 0.6
      + COALESCE(max_pts_last_14, 0) * 0.25
      + COALESCE(avg_pts_last_5,  0) * 0.15, 2) AS projected_pts,
  avg_min_last_14                               AS projected_minutes,
  DATE('{today}')                               AS projection_date
FROM `nba_dfs_projections.nba_features`
QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) = 1
```

**1.2.3 — Create `nba-salary-fetcher` Cloud Function**

Same structure as `dk-mlb-salary-fetcher` but for NBA:
- `sportId=4` (NBA)
- `contestTypeId=70` (DK NBA Classic contestTypeId)
- Target table: `nba_dfs_projections.v1_player_list`
- Add `slate_date` partition column

**1.2.4 — Create Cloud Scheduler jobs**

| Job | Schedule | Target |
|-----|----------|--------|
| `nba-salary-sync` | `30 7 * * *` ET | `nba-salary-fetcher` function |
| `nba-daily-sync` | `45 7 * * *` ET | `nba-data-ingest` function |
| `nba-pipeline-chain` | `30 8 * * *` ET | `nba-pipeline-refresh` function |

Also update `nba-data-ingest` to fire-and-forget to `nba-pipeline-refresh` on success (same threading pattern as `mlb-data-ingest`).

**1.2.5 — Update `getNbaSlate()` in `services/data/bigquery.js`**

Current: joins `nba_dfs_projections.v1_player_list` without date filter — returns stale salary for every day.

Updated query:
```sql
FROM `nba_dfs_projections.v1_player_list` s
WHERE s.slate_date = DATE("{date}")
```

Also: map `NBA_FANTASY_PTS_RANK` to a `value_rank` field so the dashboard can highlight top values.

**1.2.6 — Add `nba` to `getProjections()` in `services/data/bigquery.js`**

The projections endpoint already handles NBA but needs to be updated to use the new `nba_features` columns (avg_pts_last_5, avg_pts_last_14) in its response for model transparency.

**Done when:** NBA optimizer generates valid 8-player lineups under the $50,000 DK cap with correctly sourced salary data; projections update each day after the nightly game logs are loaded.

---

### 1.3 — WNBA Daily Pipeline

**Problem:** WNBA season is live. The DK contest config exists in `contests.js` but there is no BQ dataset, no ingest function, and no salary data.

#### Tasks

**1.3.1 — Create BigQuery dataset and tables**

```bash
bq mk --dataset --location=us-central1 gasm-481006:wnba_dfs_projections
```

Tables to create (DDL):
```sql
-- wnba_dfs_projections.wnba_game_logs  (identical schema to nba_game_logs but for WNBA)
-- wnba_dfs_projections.wnba_features   (same as nba_features)
-- wnba_dfs_projections.wnba_projections
-- wnba_dfs_projections.v1_player_list  (same as nba v1_player_list with slate_date partition)
-- wnba_dfs_projections.dim_players
```

**1.3.2 — Create `wnba-data-ingest` Cloud Function**

File: `services/ingest/wnba_data_ingest/main.py`

WNBA uses NBA Stats API with `LeagueID=10` and `Season=2025`:
```
GET https://stats.nba.com/stats/leaguegamelog
  ?LeagueID=10&Season=2025&SeasonType=Regular+Season
  &DateFrom=MM/DD/YYYY&DateTo=MM/DD/YYYY&PlayerOrTeam=P
```

DK WNBA fantasy scoring (different from NBA):
```
PTS×1.0 + REB×1.25 + AST×1.5 + STL×3.0 + BLK×3.0 + TOV×-1.0 + DD2×1.5 + TD3×3.0
```

The `WNBA_FANTASY_PTS` column from the API can be used directly.

Write to `wnba_dfs_projections.wnba_game_logs` with dedup guard.

**1.3.3 — Create `wnba-pipeline-refresh` Cloud Function**

Identical logic to `nba-pipeline-refresh` but against `wnba_dfs_projections.*` tables. Use the same rolling window SQL with `WNBA_FANTASY_PTS` as the target.

**1.3.4 — Create `wnba-salary-fetcher` Cloud Function**

- `sportId=8` (WNBA in DK API)
- `contestTypeId=` (find via DK gametypes API; typically around 150-180 for WNBA classic)
- Target: `wnba_dfs_projections.v1_player_list`

**1.3.5 — Create Cloud Scheduler jobs**

| Job | Schedule | Target |
|-----|----------|--------|
| `wnba-salary-sync` | `30 7 * * *` ET | `wnba-salary-fetcher` |
| `wnba-daily-sync` | `45 7 * * *` ET | `wnba-data-ingest` |
| `wnba-pipeline-chain` | `30 8 * * *` ET | `wnba-pipeline-refresh` |

**1.3.6 — Add `wnba` to the API and dashboard**

In `services/api/routes/slate.js`: add `'wnba'` to `SUPPORTED_SPORTS`.

In `services/data/bigquery.js`: add `getWnbaSlate()` function following the same pattern as `getNbaSlate()`, joining `wnba_dfs_projections.v1_player_list` with `wnba_dfs_projections.wnba_projections`.

In `public/index.html`: add `<option value="wnba">🏀 WNBA</option>` to the sport selector; add `dk-wnba-classic` and `dk-wnba-showdown` to the contest selector logic in `onSportChange()`.

**Done when:** WNBA slate loads with salary data, optimizer generates valid 8-player WNBA lineups, and projections refresh daily.

---

### 1.4 — Pipeline Monitoring & Alerting

**Problem:** Pipelines fail silently. If `mlb-data-ingest` fails at 8am, nobody knows until a user sees stale projections.

#### Tasks

**1.4.1 — Slack webhook notifications**

Add to every `*-pipeline-refresh` function (MLB, NBA, WNBA):

```python
import os, requests as req_lib

SLACK_WEBHOOK = os.environ.get("SLACK_WEBHOOK_URL")

def notify_slack(text):
    if SLACK_WEBHOOK:
        req_lib.post(SLACK_WEBHOOK, json={"text": text}, timeout=5)
```

On success: `✅ MLB pipeline: 247 new feature rows, 3,637 projections for 2026-06-10 (took 14s)`  
On failure: `❌ MLB pipeline FAILED for 2026-06-10 — {exception type}: {message}\n\`\`\`{traceback}\`\`\``

Set `SLACK_WEBHOOK_URL` as a Cloud Run environment variable sourced from Secret Manager.

**1.4.2 — `GET /api/v1/pipeline/status` endpoint**

Add to `services/api/routes/pipeline.js`. Query each sport's projection table for the latest `projection_date` and compare to today:

```js
GET /api/v1/pipeline/status
Response:
{
  "checked_at": "2026-06-10T12:00:00Z",
  "sports": {
    "mlb": { "latest_projection_date": "2026-06-10", "row_count": 3637, "status": "fresh" },
    "nba": { "latest_projection_date": "2026-06-09", "row_count": 33,   "status": "stale" },
    "wnba":{ "latest_projection_date": null,          "row_count": 0,    "status": "missing" }
  }
}
```

`status` rules: `fresh` = today's date; `stale` = yesterday's date; `missing` = no rows or >24h old.

This endpoint bypasses auth (same as the health check) so monitoring tools can poll it.

**1.4.3 — Dashboard pipeline status badge**

In `public/index.html`, add a pipeline health indicator next to the sport selector. On `boot()`, call `/api/v1/pipeline/status` and set a colored dot next to each sport option:

- 🟢 green — fresh data
- 🟡 yellow — yesterday's data
- 🔴 red — missing or older

Display the `latest_projection_date` as a tooltip on hover.

**1.4.4 — Move `SLACK_WEBHOOK_URL` to Secret Manager**

```bash
gcloud secrets create slack-webhook-url --data-file=<(echo -n "https://hooks.slack.com/...")
gcloud secrets add-iam-policy-binding slack-webhook-url \
  --member="serviceAccount:218987434388-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Reference in Cloud Function environment via `--set-secrets SLACK_WEBHOOK_URL=slack-webhook-url:latest`.

**Done when:** A failed pipeline posts to Slack within 30 seconds; `/api/v1/pipeline/status` returns correct freshness for all configured sports; dashboard shows colored freshness indicators without requiring a page reload.

---

## Phase 2 — Dashboard & Optimizer Quality

> Goal: Turn the dashboard into something a serious DFS player would use as their primary tool every day.

---

### 2.1 — Player Status Badges

**Problem:** The `Status` column exists in DK salary CSVs (`ACTIVE`, `GTD`, `Q`, `O`) but is not yet displayed. Users can't see which players are questionable or out.

**2.1.1 — Surface Status from salary table**

The `getMlbSlate()` query already selects `CAST(NULL AS STRING) AS status`. After Phase 1.1 adds the `Status` column from the DK CSV, update the query to `s.Status AS status`.

**2.1.2 — Add status badge component to projections table**

In `public/index.html`, update the `renderTable()` function. After the player name cell, add:

```html
<td class="px-4 py-2.5">
  <span class="status-badge">${statusBadge(p.status)}</span>
</td>
```

```js
function statusBadge(s) {
  const map = {
    'GTD': '<span class="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-900 text-yellow-300">GTD</span>',
    'Q':   '<span class="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-900 text-yellow-300">Q</span>',
    'O':   '<span class="px-1.5 py-0.5 rounded text-xs font-bold bg-red-900 text-red-300">OUT</span>',
    'INJ': '<span class="px-1.5 py-0.5 rounded text-xs font-bold bg-red-900 text-red-300">INJ</span>',
  };
  return map[s?.toUpperCase()] || '';
}
```

Automatically exclude `O` / `OUT` players from the optimizer's player pool (add a `status !== 'O'` filter in `handleOptimize()` before passing to `solveLineup()`).

**2.1.3 — Add OUT player toggle**

Add a checkbox "Show OUT players" above the table (default: unchecked). When unchecked, filter `O` status players from the display entirely.

---

### 2.2 — Floor, Ceiling & Value Columns

**Problem:** Probabilistic projections (floor p10, ceiling p90) are computed server-side by `addProbabilisticProjections()` and returned in the API response, but the dashboard table only shows `projectedPoints`.

**2.2.1 — Add Floor and Ceiling columns to projections table**

In `renderTable()` in `public/index.html`, add two columns after `Proj`:

```js
<th onclick="sortBy('floor')">Floor</th>
<th onclick="sortBy('ceiling')">Ceil</th>
```

```js
<td class="px-4 py-2.5 text-right text-xs text-gray-500 tabular-nums">${(p.floor||0).toFixed(1)}</td>
<td class="px-4 py-2.5 text-right text-xs text-emerald-600 tabular-nums">${(p.ceiling||0).toFixed(1)}</td>
```

The data is already in the API response (`p.floor`, `p.ceiling`).

**2.2.2 — Top-10 value plays highlighted in amber**

After loading players, compute value rank (`projectedPoints / salary * 1000`). Add CSS class `ring-1 ring-amber-500` to the row for the top 10 value scores:

```js
const valueRanks = new Set(
  [...players].sort((a,b) => b.value - a.value).slice(0, 10).map(p => p.id)
);
// In row rendering:
const isTopValue = valueRanks.has(p.id);
const rowCls = isE ? 'opacity-30' : (isL ? 'bg-indigo-950/20' : (isTopValue ? 'bg-amber-950/20' : ''));
```

---

### 2.3 — Player Search & Filtering

**2.3.1 — Add name search input**

Add `<input id="playerSearch" type="text" placeholder="Search players…">` above the projections table. Wire to an `oninput` handler that filters `players` array before passing to `renderTable()`:

```js
function getFilteredPlayers() {
  const q = document.getElementById('playerSearch').value.toLowerCase().trim();
  return players.filter(p =>
    (posFilter === 'ALL' || p.position === posFilter) &&
    (!q || p.name.toLowerCase().includes(q) || (p.team||'').toLowerCase().includes(q))
  );
}
```

Call `getFilteredPlayers()` inside `renderTable()` instead of directly reading `players`.

---

### 2.4 — Team Stacking Controls

**Problem:** GPP lineups need correlation. The optimizer currently builds lineups greedily without forcing same-game stacks.

**2.4.1 — Add stack UI controls to Optimizer panel**

In the Optimizer panel, add a "Stacking" section:

```html
<label>Stack Team</label>
<select id="stackTeam">
  <option value="">None</option>
  <!-- populated from players array on load -->
</select>
<label>Min players from stack team</label>
<input type="number" id="stackMin" min="2" max="5" value="3">
```

`stackTeam` is populated by `[...new Set(players.map(p=>p.team))].sort()` when the slate loads.

**2.4.2 — Pass stack constraint to optimize endpoint**

Add `&stack=${team}&stackMin=${n}` to the optimize URL built in `runOptimizer()`.

**2.4.3 — Handle stack constraint in `handleOptimize()` in `services/api/routes/slate.js`**

```js
const stack    = req.query.stack    || null;
const stackMin = Number(req.query.stackMin) || 3;
```

Before calling `solveLineup()`, if `stack` is set, add a constraint to the solver: count of players where `p.team === stack` must be `>= stackMin`. This is implemented as a BigM lower-bound constraint in the ILP model in `services/optimizer/solver.js`:

```js
if (stack) {
  model.constraints[`stack_min_${stack}`] = { min: stackMin };
  // set coefficient 1 for all players on that team in the stack constraint row
}
```

---

### 2.5 — Max Exposure UI Control

**Problem:** Max exposure is hardcoded at 50% in `services/optimizer/portfolio.js`. Users need to control this per run.

**2.5.1 — Add exposure slider to Optimizer panel**

Add below the lineup count slider:
```html
<label>Max Exposure: <span id="exposureVal">50</span>%</label>
<input type="range" id="exposureSlider" min="10" max="100" value="50"
  oninput="document.getElementById('exposureVal').textContent=this.value">
```

**2.5.2 — Pass to API**

Add `&maxExposure=${exposureSlider.value / 100}` to the optimize URL.

**2.5.3 — Read in `handleOptimize()`**

```js
const maxExposure = Math.min(1.0, Math.max(0.1, Number(req.query.maxExposure) || 0.5));
```

Pass to `buildPortfolio()` which already accepts `maxExposure` in its options.

---

### 2.6 — Ownership Projections

**Problem:** GPP players need to know how many other lineups will include a player (ownership %) to target contrarian value.

**2.6.1 — Compute ownership estimate server-side**

In `services/api/routes/slate.js`, after fetching the slate, compute estimated ownership for each player. Use inverse-salary formula weighted by projected points:

```js
function estimateOwnership(players) {
  const total = players.reduce((s, p) => s + (p.projectedPoints / Math.max(p.salary, 1)), 0);
  return players.map(p => ({
    ...p,
    ownership: total > 0
      ? Math.round((p.projectedPoints / Math.max(p.salary, 1)) / total * 100 * 10) / 10
      : 0,
  }));
}
```

**2.6.2 — Add ownership column to projections table**

After the Value column:
```html
<th onclick="sortBy('ownership')">Own%</th>
```
```js
<td class="text-right text-xs text-gray-400">${(p.ownership||0).toFixed(1)}%</td>
```

---

### 2.7 — DK-Format CSV Export

**Problem:** The current CSV export writes player names in a basic format. DraftKings' bulk lineup upload requires exact player ID format: `Name (ID)` in a specific column order per sport.

**2.7.1 — DK MLB Classic export format**

DK expects: `P, P, C, 1B, 2B, 3B, SS, OF, OF, OF` as column headers. Each cell value is `"Name (ID)"` where `ID` is the DK player ID (the integer value from `v1_player_list.ID`).

```js
function exportDkCsv() {
  if (!generatedLineups.length) return;
  const slots = generatedLineups[0].players.map(p => p.assignedSlot || p.position);
  const header = slots.join(',');
  const rows = generatedLineups.map(l =>
    l.players.map(p => `"${p.name} (${p.id})"`).join(',')
  );
  download([header, ...rows].join('\n'), `dk-${sport}-${date}.csv`, 'text/csv');
}
```

**2.7.2 — Add per-lineup copy button**

In each lineup card in `renderLineups()`, add:
```html
<button onclick="copyLineup(${i})" class="text-xs text-gray-500 hover:text-white">Copy</button>
```

```js
function copyLineup(i) {
  const l = generatedLineups[i];
  const text = l.players.map(p => `${p.assignedSlot}: ${p.name} $${p.salary.toLocaleString()}`).join('\n');
  navigator.clipboard.writeText(text);
}
```

---

### 2.8 — Exposure Report in Lineups Tab

**Problem:** Users need to see how concentrated their lineups are before uploading.

**2.8.1 — Render exposure report table below lineup grid**

The API already returns `exposureReport` from `buildPortfolio()`. Store it alongside `generatedLineups`.

Below the lineup grid in the Lineups tab, add an exposure section:

```js
function renderExposureReport(report, n) {
  if (!report || !report.length) return;
  const rows = report.map(r => {
    const player = players.find(p => p.id === r.id);
    const pct = Math.round(r.exposure * 100);
    const bar = `<div class="h-1.5 bg-indigo-500 rounded" style="width:${pct}%"></div>`;
    return `<tr>
      <td class="py-1.5 text-sm text-gray-300">${esc((player||{}).name || r.id)}</td>
      <td class="py-1.5 text-xs text-gray-500 w-12 text-right">${r.count}/${n}</td>
      <td class="py-1.5 w-32 pl-3">${bar}</td>
      <td class="py-1.5 text-xs text-right text-gray-400">${pct}%</td>
    </tr>`;
  }).join('');
  document.getElementById('exposureTable').innerHTML = `<table class="w-full">${rows}</table>`;
}
```

---

### 2.9 — Weather Integration for MLB

**Problem:** Wind speed and direction significantly affect batter projections at open-air stadiums. The data is already in `game_by_game_logs.wind` but not used in projections.

**2.9.1 — Fetch today's weather for MLB stadiums**

In `services/ingest/mlb_pipeline_refresh/main.py`, after inserting features, call Open-Meteo:

```python
STADIUM_COORDS = {
  "Fenway Park":   (42.3467, -71.0972),
  "Wrigley Field": (41.9484, -87.6553),
  # ... all 30 stadiums
}
def get_wind_speed(lat, lon):
    r = requests.get(
      f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
      f"&hourly=windspeed_10m&forecast_days=1&timezone=America/New_York"
    )
    return r.json()["hourly"]["windspeed_10m"][13]  # 1pm slot
```

Store in `mlb_data.game_weather` table: `(game_date DATE, stadium STRING, wind_mph FLOAT64, temp_f FLOAT64)`.

**2.9.2 — Apply wind penalty in `getMlbSlate()`**

Join `game_weather` in the slate query and compute:
```sql
CASE
  WHEN gw.wind_mph > 15 THEN p.projected_pts * 0.92  -- 8% penalty in high wind
  WHEN gw.wind_mph > 10 THEN p.projected_pts * 0.96  -- 4% penalty
  ELSE p.projected_pts
END AS projectedPoints
```

This requires knowing which team plays at which stadium — join via `mlb_data.dim_teams` which has `stadium` and `home_team` columns.

---

### 2.10 — Confirmed MLB Starter Check

**Problem:** The salary list includes pitchers who may not start. Projecting a reliever as the SP slot is a waste.

**2.10.1 — Check probable starters via MLB Stats API**

Add to `getMlbSlate()` in `services/data/bigquery.js` (or as a pre-query step in the route):

```js
async function getProbableStarters(date) {
  const r = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher`
  );
  const data = await r.json();
  const confirmed = new Set();
  for (const date of data.dates || []) {
    for (const game of date.games || []) {
      const awayId = game.teams?.away?.probablePitcher?.id;
      const homeId = game.teams?.home?.probablePitcher?.id;
      if (awayId) confirmed.add(String(awayId));
      if (homeId) confirmed.add(String(homeId));
    }
  }
  return confirmed;
}
```

**2.10.2 — Mark unconfirmed starters in slate**

After fetching the MLB slate, enrich each pitcher:
```js
players = players.map(p => ({
  ...p,
  confirmedStarter: p.position === 'SP' ? confirmedStarters.has(p.id) : null,
}));
```

In the dashboard table, show a ⚡ icon next to confirmed starters and a `?` next to unconfirmed SP slots. The optimizer should not penalize unconfirmed starters (let users decide), but the UI warning is critical for decision-making.

---

## Phase 3 — NFL Pipeline

> NFL is a weekly sport (not daily). The pipeline runs Monday morning after Sunday games, with special handling for Thursday Night, Monday Night, and Saturday games.

---

### 3.1 — NFL BigQuery Schema

Create dataset `nfl_data`:
```bash
bq mk --dataset --location=us-central1 gasm-481006:nfl_data
```

Tables:
```sql
-- nfl_data.game_logs
player_id STRING, player_name STRING, team STRING, opponent STRING,
game_date DATE, week INT64, season INT64, position STRING,
pass_yards INT64, pass_td INT64, interceptions INT64, pass_attempts INT64,
rush_yards INT64, rush_td INT64, rush_attempts INT64,
rec_yards INT64, rec_td INT64, receptions INT64, targets INT64,
fumbles_lost INT64, sacks FLOAT64,
fantasy_pts FLOAT64,
game_id STRING

-- nfl_data.nfl_features
player_id STRING, player_name STRING, team STRING, position STRING,
game_date DATE, week INT64, season INT64,
target_pts FLOAT64,
avg_pts_last_3 FLOAT64, max_pts_last_3 FLOAT64,
avg_pts_last_6 FLOAT64, max_pts_last_6 FLOAT64,
avg_targets_last_3 FLOAT64, avg_snap_pct_last_3 FLOAT64

-- nfl_data.nfl_projections
player_id STRING, player_name STRING, team STRING, position STRING,
projected_pts FLOAT64, projection_date DATE

-- nfl_data.game_odds
game_id STRING, game_date DATE, home_team STRING, away_team STRING,
home_implied_total FLOAT64, away_implied_total FLOAT64,
home_spread FLOAT64, game_total FLOAT64

-- nfl_dfs_projections.v1_player_list (same structure as MLB, with slate_date partition)
```

### 3.2 — DK NFL Scoring Formula

```python
def calculate_nfl_fantasy_pts(stats, position):
    pts = 0.0
    if position == 'QB':
        pts += stats.get('pass_yards', 0) * 0.04
        pts += stats.get('pass_td', 0) * 4.0
        pts += stats.get('interceptions', 0) * -1.0
        pts += stats.get('rush_yards', 0) * 0.1
        pts += stats.get('rush_td', 0) * 6.0
        if stats.get('pass_yards', 0) >= 300: pts += 3.0
    elif position in ('RB', 'WR', 'TE'):
        pts += stats.get('rush_yards', 0) * 0.1
        pts += stats.get('rush_td', 0) * 6.0
        pts += stats.get('receptions', 0) * 1.0
        pts += stats.get('rec_yards', 0) * 0.1
        pts += stats.get('rec_td', 0) * 6.0
        if stats.get('rush_yards', 0) >= 100: pts += 3.0
        if stats.get('rec_yards', 0) >= 100: pts += 3.0
    elif position == 'DST':
        pts += stats.get('sacks', 0) * 1.0
        pts += stats.get('interceptions', 0) * 2.0
        pts += stats.get('fumble_recoveries', 0) * 2.0
        pts += stats.get('safeties', 0) * 2.0
        pts += stats.get('defensive_td', 0) * 6.0
        pts_allowed = stats.get('points_allowed', 30)
        pts += {0: 10, 1: 7, 6: 4, 13: 1, 20: 0, 27: -1}.get(
            next((k for k in [0,1,6,13,20,27] if pts_allowed <= k), 28), -4
        )
    pts += stats.get('fumbles_lost', 0) * -1.0
    return round(pts, 2)
```

### 3.3 — NFL Data Source: ESPN API

```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
  ?dates=YYYYMMDD
```

Returns game list. For each game, fetch box score:
```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={gameId}
```

Alternative: `nfl_data` Python library for complete historical data, then ESPN for live/recent.

### 3.4 — NFL Pipeline Functions

Create `services/ingest/nfl_data_ingest/main.py` — entry point: `ingest_nfl_data`
Create `services/ingest/nfl_pipeline_refresh/main.py` — entry point: `refresh_nfl_pipeline`
Create `services/ingest/nfl_salary_fetcher/main.py` — entry point: `fetch_nfl_salaries` (`sportId=1`)

### 3.5 — NFL Scheduling Logic

NFL games run Thursday, Sunday, Monday (and occasional Saturday in late December). The pipeline should run:
- Daily Monday–Thursday 6am ET to catch recent games
- Skip if no new game data found (check counts before processing)

Cloud Scheduler: `0 6 * * 1,2,3,4` (Mon–Thu 6am ET), plus `0 6 * * 6` (Sat 6am for late-season games).

### 3.6 — Vegas Odds Integration

```
GET https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds
  ?apiKey={key}&regions=us&markets=totals,spreads&oddsFormat=american
```

Compute implied totals:
```python
def implied_total(total_line, spread):
    # team implied = (game_total / 2) - (spread / 2)
    home_total = (total_line / 2) - (spread / 2)
    away_total = total_line - home_total
    return home_total, away_total
```

Store in `nfl_data.game_odds`. Join to projections: multiply `projected_pts` by `(implied_total / league_avg_implied_total)` to scale by game environment.

### 3.7 — Add NFL to API and Dashboard

In `slate.js`: add `'nfl'` to `SUPPORTED_SPORTS`.
In `bigquery.js`: add `getNflSlate()` joining `nfl_dfs_projections.v1_player_list` with `nfl_data.nfl_projections`.
In `public/index.html`: add `<option value="nfl">🏈 NFL</option>`; add `dk-nfl-classic` to contest options. The `dk-nfl-classic` config is already in `contests.js`.

---

## Phase 4 — ML Projection Models

> Replace the static weighted-average formula with trained models that use opponent quality, park factors, platoon splits, and Statcast data.

---

### 4.1 — Enrich Feature Stores

**4.1.1 — MLB batter feature store upgrades**

Add columns to `mlb_data.dfs_feature_store`:
```sql
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN avg_hr_last_5  FLOAT64;
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN avg_sb_last_5  FLOAT64;
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN avg_bb_last_14 FLOAT64;
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN opp_era_last_14 FLOAT64;  -- opponent pitcher ERA
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN park_factor    FLOAT64;
ALTER TABLE `mlb_data.dfs_feature_store` ADD COLUMN platoon_advantage BOOL;   -- batter vs pitcher handedness
```

**4.1.2 — Build `mlb_data.park_factors` table**

```sql
CREATE TABLE `mlb_data.park_factors` (
  team_id STRING,
  stadium STRING,
  park_factor_runs FLOAT64,  -- league avg = 1.0; Coors ~1.35, Petco ~0.92
  park_factor_hr   FLOAT64,
  park_factor_hits FLOAT64,
  season INT64
)
```

Seed with 2023–2025 Baseball Reference park factors (historical data, static load). Refresh annually.

**4.1.3 — Build opponent ERA join**

In `mlb-pipeline-refresh`, add a step that computes each pitcher's rolling ERA and stores it in `mlb_data.pitcher_era_rolling`:

```sql
CREATE OR REPLACE TABLE `mlb_data.pitcher_era_rolling` AS
SELECT
  player_id, player_name, game_date,
  SAFE_DIVIDE(
    SUM(er) OVER (PARTITION BY player_id ORDER BY game_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING),
    SUM(ip) OVER (PARTITION BY player_id ORDER BY game_date ROWS BETWEEN 5 PRECEDING AND 1 PRECEDING)
  ) * 9 AS rolling_era_5
FROM `mlb_data.game_by_game_logs`
WHERE is_pitcher = TRUE
```

Join to batter feature store via the `opponent` column (match opponent team's starting pitcher from the schedule).

**4.1.4 — Statcast weekly ingest**

Create `services/ingest/statcast_ingest/main.py`. Use `pybaseball` to pull Statcast data weekly:

```python
from pybaseball import statcast
data = statcast(start_dt=last_monday, end_dt=yesterday)
```

Key columns: `barrel_rate`, `hard_hit_pct`, `xwoba`, `launch_angle`, `exit_velocity`.

Store in `mlb_data.statcast_weekly` (partitioned by `game_date`). Cloud Scheduler: every Monday 9am ET.

Join to batter feature store by `player_id` (MLB player ID, already the key in both tables).

---

### 4.2 — BigQuery ML Models

**4.2.1 — MLB batter projection model**

```sql
CREATE OR REPLACE MODEL `mlb_data.batter_proj_model`
OPTIONS (
  model_type           = 'BOOSTED_TREE_REGRESSOR',
  num_parallel_tree    = 6,
  max_tree_depth       = 6,
  subsample            = 0.8,
  input_label_cols     = ['target_pts'],
  data_split_method    = 'RANDOM',
  data_split_eval_fraction = 0.15
) AS
SELECT
  target_pts,
  avg_pts_last_14,
  max_pts_last_14,
  avg_pts_last_5,       -- add this column in 4.1.1
  avg_ab_last_14,
  avg_k_last_14,
  avg_hr_last_14,
  avg_bb_last_14,
  opp_era_last_14,
  park_factor,
  CAST(platoon_advantage AS INT64) AS platoon_advantage,
  CAST(is_home AS INT64) AS is_home,
  CAST(batting_order AS FLOAT64) AS batting_order_num,
  COALESCE(temperature, 72) AS temperature
FROM `mlb_data.dfs_feature_store`
WHERE target_pts IS NOT NULL
  AND avg_pts_last_14 IS NOT NULL
  AND game_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
```

**4.2.2 — MLB pitcher projection model**

```sql
CREATE OR REPLACE MODEL `mlb_data.pitcher_proj_model`
OPTIONS (
  model_type        = 'BOOSTED_TREE_REGRESSOR',
  input_label_cols  = ['target_pts'],
  data_split_method = 'RANDOM'
) AS
SELECT
  target_pts,
  avg_pts_last_14,
  avg_ip_last_14,
  avg_k_last_14,
  avg_er_last_14,
  CAST(is_home AS INT64) AS is_home
FROM `mlb_data.dfs_pitcher_feature_store`
WHERE target_pts IS NOT NULL
```

**4.2.3 — Integrate BQML into pipeline refresh**

In `mlb-pipeline-refresh`, replace the weighted-average INSERT with `ML.PREDICT`:

```sql
INSERT INTO `mlb_data.mlb_projections`
SELECT
  fs.player_id,
  fs.player_name,
  pred.predicted_target_pts AS projected_pts,
  DATE('{today}')            AS projection_date
FROM ML.PREDICT(
  MODEL `mlb_data.batter_proj_model`,
  (SELECT * FROM `mlb_data.dfs_feature_store`
   QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) = 1)
) pred
JOIN `mlb_data.dfs_feature_store` fs USING (player_id)
WHERE NOT fs.is_pitcher
```

Keep the weighted-average as a fallback `COALESCE(ml_projection, weighted_avg_projection)` for players with insufficient history (<5 games in the feature store).

**4.2.4 — Model retraining schedule**

Cloud Scheduler job `mlb-model-retrain` running every Sunday 2am ET:
```sql
CREATE OR REPLACE MODEL `mlb_data.batter_proj_model` OPTIONS (...) AS SELECT ...
```
Retraining in BQML replaces the model in place. No serving infrastructure changes needed.

**4.2.5 — Model accuracy tracking**

At the end of each `mlb-pipeline-refresh` run, compute last 7-day accuracy:

```sql
INSERT INTO `mlb_data.model_accuracy`
SELECT
  CURRENT_DATE()          AS evaluation_date,
  'batter_proj_model'     AS model_name,
  AVG(ABS(p.projected_pts - g.fantasy_pts)) AS mae,
  SQRT(AVG(POW(p.projected_pts - g.fantasy_pts, 2))) AS rmse,
  COUNT(*)                AS sample_size
FROM `mlb_data.mlb_projections` p
JOIN `mlb_data.game_by_game_logs` g
  ON p.player_id = g.player_id
  AND p.projection_date = g.game_date
WHERE p.projection_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND NOT EXISTS (SELECT 1 FROM `mlb_data.game_by_game_logs` WHERE is_pitcher AND player_id = p.player_id)
```

**4.2.6 — Display model accuracy in dashboard**

Add to the dashboard header:
```js
async function loadModelAccuracy() {
  const d = await apiFetch('/api/v1/model/accuracy');
  document.getElementById('modelAccuracy').textContent =
    `MAE: ${d.mae?.toFixed(2)} pts (last 7d)`;
}
```

Add `GET /api/v1/model/accuracy` endpoint that queries `mlb_data.model_accuracy` for the latest row.

---

## Phase 5 — Platform Expansion (FanDuel, Yahoo, Dabble)

---

### 5.1 — FanDuel Support

**5.1.1 — FanDuel contest configs in `services/optimizer/contests.js`**

```js
'fd-mlb-classic': {
  id: 'fd-mlb-classic', provider: 'fanduel', sport: 'mlb',
  salaryCap: 35000, maxPlayersPerTeam: 4,
  rosterSlots: ['P', 'C/1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL'],
},
'fd-nba-classic': {
  id: 'fd-nba-classic', provider: 'fanduel', sport: 'nba',
  salaryCap: 60000, maxPlayersPerTeam: 4,
  rosterSlots: ['PG', 'PG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'C'],
},
'fd-nfl-classic': {
  id: 'fd-nfl-classic', provider: 'fanduel', sport: 'nfl',
  salaryCap: 60000, maxPlayersPerTeam: 4,
  rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'],
},
```

**5.1.2 — FanDuel scoring differences**

FanDuel MLB scoring (vs DK): no bonus for 300-yd passers; different per-stat values.  
Store scoring multipliers per provider in a config object rather than hardcoding in ingest functions:

```js
// services/optimizer/scoring.js
const SCORING = {
  'draftkings-mlb-batter': { '1B': 3.0, '2B': 5.0, '3B': 8.0, 'HR': 10.0, 'RBI': 2.0, 'R': 2.0, 'BB': 2.0, 'SB': 5.0 },
  'fanduel-mlb-batter':    { '1B': 3.0, '2B': 6.0, '3B': 9.0, 'HR': 12.0, 'RBI': 3.5, 'R': 3.2, 'BB': 3.0, 'SB': 6.0 },
};
```

**5.1.3 — FanDuel salary fetcher**

FanDuel has a public CSV export at:
```
GET https://www.fanduel.com/contest/download-csv
```
FD requires login for CSV download. Alternative: use FD's public API slate endpoint (no auth required):
```
GET https://api.fanduel.com/fixture-lists?sport=MLB
```

Store in separate tables: `mlb_fd_projections.v1_player_list`, `nba_fd_projections.v1_player_list`.

**5.1.4 — Provider selector in dashboard**

Add `<select id="providerSelect">` to the header alongside the sport selector. Options: `DraftKings`, `FanDuel`, `Yahoo`. When provider changes, reload the slate and filter contest options to matching provider's formats.

**5.1.5 — FanDuel CSV export format**

FD upload CSV format differs: `PG, PG, SG, SG, SF, SF, PF, PF, C` headers with `Name:ID` format (`John Doe:12345`). Update `exportDkCsv()` to branch by provider and format accordingly.

---

### 5.2 — Yahoo DFS Support

**5.2.1 — Yahoo contest configs**

```js
'yahoo-mlb-classic': {
  id: 'yahoo-mlb-classic', provider: 'yahoo', sport: 'mlb',
  salaryCap: 200, maxPlayersPerTeam: 5,      // Yahoo uses $200 cap
  rosterSlots: ['SP', 'SP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF'],
},
```

Note: Yahoo salary increments are $10, not $1. Salary values in Yahoo CSV are whole dollar amounts. Ensure the ILP solver handles the $200/$10 scale correctly (multiply all salaries by 1 and cap by 200).

**5.2.2 — Yahoo salary fetcher**

Yahoo publishes a public salary CSV:
```
GET https://dfyql-ro.sports.yahoo.com/v2/export/players?sport=mlb&leagueType=daily
```

**5.2.3 — Yahoo CSV export format**

Yahoo upload format uses `Name` only (no ID) in player columns. Order: `SP, SP, C, 1B, 2B, 3B, SS, OF, OF, OF`.

---

### 5.3 — Dabble Support

**5.3.1 — Research Dabble format**

Dabble is a smaller platform. Audit at `dabble.com/help` for:
- Roster format (pick'em style vs classic lineup)
- Salary cap amount
- Scoring rules per sport
- CSV upload format (if supported)

If Dabble uses a pick'em / over-under format (not classic lineups), the optimizer needs a separate solver mode: select a set of players and predict their over/under rather than optimizing a salary-capped lineup.

**5.3.2 — Implement after format audit**

Once format is confirmed, implement contest configs and fetcher following the same pattern as FanDuel.

---

## Phase 6 — NHL & College Sports

---

### 6.1 — NHL Pipeline

**6.1.1 — NHL BigQuery schema**

```sql
-- nhl_data.game_logs
player_id STRING, player_name STRING, team STRING, opponent STRING,
game_date DATE, game_id STRING, position STRING,
goals INT64, assists INT64, shots INT64, plus_minus INT64,
blocked_shots INT64, powerplay_points INT64, shorthanded_points INT64,
hat_trick BOOL,
-- Goalie fields:
wins BOOL, saves INT64, goals_against INT64, shutout BOOL,
fantasy_pts FLOAT64
```

**6.1.2 — NHL data source**

NHL Stats API (official, free):
```
GET https://api-web.nhle.com/v1/gamecenter/{gameId}/boxscore
GET https://api-web.nhle.com/v1/schedule/{YYYY-MM-DD}
```

**6.1.3 — DK NHL scoring**

```python
def calculate_nhl_fantasy_pts(stats, is_goalie):
    if is_goalie:
        pts = 0.0
        pts += 6.0 if stats.get('wins') else 0
        pts += 4.0 if stats.get('shutout') else 0
        pts += stats.get('saves', 0) * 0.2
        pts += stats.get('goals_against', 0) * -1.0
        return pts
    pts = 0.0
    pts += stats.get('goals', 0) * 8.0
    pts += stats.get('assists', 0) * 5.0
    pts += stats.get('shots', 0) * 0.9
    pts += stats.get('blocked_shots', 0) * 0.5
    pts += stats.get('powerplay_points', 0) * 0.5
    pts += stats.get('shorthanded_points', 0) * 2.0
    pts += 3.0 if stats.get('hat_trick') else 0
    return round(pts, 2)
```

**6.1.4 — NHL contest configs**

```js
'dk-nhl-classic': {
  id: 'dk-nhl-classic', provider: 'draftkings', sport: 'nhl',
  salaryCap: 50000, maxPlayersPerTeam: 5,
  rosterSlots: ['C', 'C', 'W', 'W', 'W', 'D', 'D', 'G', 'UTIL'],
  // UTIL accepts C, W, or D
},
```

**6.1.5 — Season-aware scheduling**

NHL regular season runs October–April; playoffs April–June. Use a season-detection helper:

```python
from datetime import date
def is_nhl_season_active():
    today = date.today()
    month = today.month
    return month >= 10 or month <= 6  # Oct through June
```

Cloud Scheduler: run year-round but `main.py` exits early with 200 if season is inactive.

---

### 6.2 — College Football (CFB)

**6.2.1 — CFBD API**

```
GET https://api.collegefootballdata.com/games/players
  ?year=2026&week=1&seasonType=regular&authorization=Bearer {API_KEY}
```

CFBD provides a free API key (register at `collegefootballdata.com`). Store in Secret Manager.

**6.2.2 — DK CFB scoring**

Same formula as NFL (DK uses identical scoring for college).

**6.2.3 — Season detection**

CFB runs August–January. Scheduler: `0 6 * * 0` (Sunday) during season; year-round with inactive check outside.

---

### 6.3 — College Basketball (CBB)

**6.3.1 — Data source**

Use `sports-reference` API (rate-limited free tier) or directly scrape `sports-reference.com/cbb/`. Alternative: `cbbd.sportsdataio.com` (free tier covers basic stats).

**6.3.2 — DK CBB scoring**

```python
# Same as NBA scoring:
PTS×1.0 + REB×1.25 + AST×1.5 + STL×2.0 + BLK×2.0 + TOV×-0.5 + DD2×1.5 + TD3×3.0
```

**6.3.3 — Season detection**

November–April (including March Madness).

---

## Phase 7 — User Management & Multi-Tenant

---

### 7.1 — Google OAuth 2.0 Login

**7.1.1 — Replace API key modal with "Sign in with Google"**

In `public/index.html`, replace the key input modal with:

```html
<div id="keyModal" class="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
  <div class="bg-gray-900 rounded-2xl p-8 w-full max-w-sm">
    <h2 class="text-xl font-bold text-white mb-6">Ava-DFS</h2>
    <div id="g_id_onload"
      data-client_id="{GOOGLE_CLIENT_ID}"
      data-callback="handleGoogleSignIn">
    </div>
    <div class="g_id_signin" data-type="standard"></div>
  </div>
</div>
```

Load Google Identity Services: `<script src="https://accounts.google.com/gsi/client"></script>`

**7.1.2 — Handle Google credential on the API**

`handleGoogleSignIn(response)` receives a JWT from Google. POST it to `POST /api/v1/auth/google`:

```js
router.post('/auth/google', async (req, res) => {
  const { credential } = req.body;
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: CLIENT_ID });
  const { email, sub, name, picture } = ticket.getPayload();
  // upsert user in gasm_warehouse.users
  // issue our own short-lived JWT
  const token = jwt.sign({ userId: sub, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { email, name, picture } });
});
```

Store the returned token in `localStorage` (not `sessionStorage` — persists across browser sessions). Send as `Authorization: Bearer {token}` header on all API requests.

**7.1.3 — Replace `authMiddleware` with JWT verification**

Update `services/api/middleware/auth.js`:

```js
const jwt = require('jsonwebtoken');
function authMiddleware(req, res, next) {
  if (process.env.API_KEYS === '*') return next();
  const header = req.headers['authorization'] || '';
  const legacy = req.headers['x-api-key'] || req.query.api_key;
  if (legacy) { /* existing key check for backwards compat */ }
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token expired or invalid' }); }
}
```

**7.1.4 — `gasm_warehouse.users` table schema**

```sql
CREATE TABLE `gasm_warehouse.users` (
  user_id      STRING NOT NULL,   -- Google sub
  email        STRING NOT NULL,
  display_name STRING,
  picture_url  STRING,
  plan         STRING DEFAULT 'free',  -- 'free', 'pro', 'elite'
  api_key_hash STRING,            -- SHA256 of their personal API key
  created_at   TIMESTAMP,
  last_login   TIMESTAMP
)
CLUSTER BY user_id
```

---

### 7.2 — User Data Isolation

**7.2.1 — Per-user lineup history**

```sql
CREATE TABLE `gasm_dfs_analytics.lineup_history` (
  lineup_id     STRING,           -- UUID generated server-side
  user_id       STRING,
  generated_at  TIMESTAMP,
  sport         STRING,
  contest_type  STRING,
  provider      STRING,
  slate_date    DATE,
  mode          STRING,           -- 'gpp' or 'cash'
  total_salary  INT64,
  total_projected FLOAT64,
  players       JSON,             -- serialized array of player objects
  entered_dk    BOOL DEFAULT FALSE,
  actual_score  FLOAT64           -- filled in after contest finishes
)
PARTITION BY DATE(generated_at)
CLUSTER BY user_id, sport
```

Save lineups on every `/optimize` call. Return `lineupId` in the response so the client can reference them.

**7.2.2 — Per-user saved projections (custom overrides)**

```sql
CREATE TABLE `gasm_dfs_analytics.user_projections`(
  user_id STRING, player_id STRING, slate_date DATE,
  custom_pts FLOAT64, notes STRING, updated_at TIMESTAMP
)
```

Allow users to override a player's projection in the dashboard. The override applies only to that user's optimizer calls (join via `LEFT JOIN user_projections USING (user_id, player_id, slate_date)` on the optimize route).

**7.2.3 — Contest entry tracking**

Add a "Entered" toggle to each lineup card. When toggled, `POST /api/v1/lineups/{lineupId}/entered` flips `entered_dk = TRUE`. After contest results come in (user provides the actual score), `POST /api/v1/lineups/{lineupId}/result` stores `actual_score`.

---

### 7.3 — Admin Panel

**7.3.1 — `/admin` route**

Protected by email check: `if (req.user?.email !== 'admin@ava-dfs.com') return res.status(403)`.

Renders a lightweight HTML page (no SPA complexity) showing:
- Active users (count + list from `gasm_warehouse.users`)
- Pipeline freshness per sport (calls `/api/v1/pipeline/status`)
- BigQuery storage costs (from Cloud Monitoring API or GCP billing API)
- Last 10 errors from Cloud Run logs

**7.3.2 — Manual salary CSV upload**

Add a drag-and-drop zone in the admin panel. On upload, POST the CSV to `POST /api/v1/admin/salaries/upload?sport={sport}&provider={provider}`. The route parses the CSV and calls the same BQ insert logic used by the automated salary fetchers, allowing a manual override when DK changes their API format.

---

## Phase 8 — Performance & Reliability

---

### 8.1 — Redis Caching Layer

**Problem:** Every slate request hits BigQuery (4s warm, 8s+ cold). With many concurrent users this is expensive and slow.

**8.1.1 — Provision Memorystore (Redis) instance**

```bash
gcloud redis instances create ava-dfs-cache \
  --size=1 --region=us-central1 --redis-version=redis_7_0 \
  --tier=basic --connect-mode=direct-peering
```

Configure Cloud Run service's VPC connector to reach Redis private IP.

**8.1.2 — Cache slate queries**

In `services/data/bigquery.js`:

```js
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });

async function getCachedSlate(sport, date) {
  const key = `slate:${sport}:${date}`;
  const cached = await client.get(key);
  if (cached) return JSON.parse(cached);
  const data = await getSlate(sport, date);
  await client.setEx(key, 300, JSON.stringify(data));  // 5-min TTL
  return data;
}
```

The optimizer endpoint still calls `getSlate()` (not the cached version) for the first request of the day to ensure the optimizer always gets the freshest data. Subsequent requests within 5 minutes get the cached version.

**8.1.3 — Cache invalidation**

At the end of each pipeline refresh function, call the API's cache-bust endpoint:
```
POST /api/v1/internal/cache/bust?sport=mlb&date=2026-06-10
```
This deletes the Redis key so the next request fetches fresh data.

---

### 8.2 — Pub/Sub Retry Queue for Pipelines

**8.2.1 — Create Pub/Sub topic and subscriptions**

```bash
gcloud pubsub topics create pipeline-retry
gcloud pubsub subscriptions create pipeline-retry-sub \
  --topic=pipeline-retry --ack-deadline=600 --max-delivery-attempts=3
```

**8.2.2 — Publish on failure**

In each pipeline refresh function's `except` block:

```python
from google.cloud import pubsub_v1
publisher = pubsub_v1.PublisherClient()
topic = "projects/gasm-481006/topics/pipeline-retry"
publisher.publish(topic, json.dumps({"sport": "mlb", "date": today, "attempt": 1}).encode())
```

**8.2.3 — Retry subscriber function**

Create `ava-pipeline-retry` Cloud Function subscribed to `pipeline-retry` topic. It calls the failed sport's pipeline-refresh function via HTTP. After 3 failures, sends a Slack alert and stops retrying.

---

### 8.3 — Cloud Monitoring Alerts

```bash
# Create uptime check for the API
gcloud monitoring uptime create ava-dfs-api-uptime \
  --display-name="Ava-DFS API" \
  --resource-type=uptime-url \
  --hostname=ava-dfs-api-5i4dg43y2q-uc.a.run.app \
  --path=/api/v1/health

# Create alert policy for error rate
gcloud monitoring policies create \
  --notification-channels={channel-id} \
  --conditions="..."
```

Alert policies:
- API 5xx rate > 5% over 5 minutes → Slack + email
- Pipeline data stale > 24h → Slack (checked by a Cloud Scheduler job polling `/api/v1/pipeline/status`)
- Cloud Run CPU > 80% sustained 10 min → email
- BigQuery bytes billed > 10GB/day → email

---

### 8.4 — BQ Table Cleanup

**8.4.1 — Add 90-day partition expiration**

```sql
ALTER TABLE `mlb_data.mlb_projections`
  SET OPTIONS (partition_expiration_days = 90);
ALTER TABLE `nba_dfs_projections.nba_projections`
  SET OPTIONS (partition_expiration_days = 90);
-- repeat for all projection and feature tables
```

**8.4.2 — Decommission broken Cloud Functions**

```bash
gcloud functions delete run --region=us-east1 --project=gasm-481006 --quiet
# Investigate ava-data-harvester (UNKNOWN state) before deleting
```

**8.4.3 — Delete empty datasets**

Verify empty, then delete:
```bash
bq query "SELECT table_name FROM gasm-481006.gasm_vault.INFORMATION_SCHEMA.TABLES"
bq rm -r -f gasm-481006:gasm_vault
bq rm -r -f gasm-481006:gasm_raw
bq rm -r -f gasm-481006:ava_mlb_data  # only if empty
```

---

## Phase 9 — Monetization & API Productization

---

### 9.1 — Subscription Plan Tiers

| Feature | Free | Pro | Elite |
|---------|------|-----|-------|
| Sports | MLB only | MLB, NBA, WNBA, NFL | All 7 sports |
| Lineups/day | 20 | 150 | Unlimited |
| Portfolio optimizer | ✅ | ✅ | ✅ |
| Raw API access | ❌ | ❌ | ✅ |
| Model accuracy reports | ❌ | ✅ | ✅ |
| Custom projection overrides | ❌ | ✅ | ✅ |
| CSV export | ✅ | ✅ | ✅ |
| Price | Free | $19/mo | $49/mo |

**9.1.1 — Enforce plan limits in middleware**

In `services/api/middleware/auth.js`, after JWT validation, load the user's plan from a short-lived in-memory cache (or Redis) and attach to `req.user.plan`.

In the optimize route, check lineup count:
```js
const maxLineups = { free: 20, pro: 150, elite: Infinity }[req.user.plan] || 20;
if (n > maxLineups) return res.status(403).json({ error: `Plan limit: max ${maxLineups} lineups` });
```

In the slate route, check sport access:
```js
const allowedSports = { free: ['mlb'], pro: ['mlb','nba','wnba','nfl'], elite: '*' }[req.user.plan];
if (allowedSports !== '*' && !allowedSports.includes(sport)) {
  return res.status(403).json({ error: `Upgrade to Pro to access ${sport.toUpperCase()}` });
}
```

**9.1.2 — Stripe integration**

Use Stripe Checkout (hosted page, no card handling on our servers):

```js
// POST /api/v1/billing/checkout
const session = await stripe.checkout.sessions.create({
  customer_email: req.user.email,
  mode: 'subscription',
  line_items: [{ price: STRIPE_PRICE_IDS[plan], quantity: 1 }],
  success_url: `${BASE_URL}/dashboard?upgraded=true`,
  cancel_url: `${BASE_URL}/dashboard`,
});
res.json({ url: session.url });
```

Stripe webhook at `POST /api/v1/billing/webhook` handles `checkout.session.completed` — updates `gasm_warehouse.users.plan` in BigQuery.

**9.1.3 — Upgrade prompt in dashboard**

When a Free user tries to access a Pro feature (NBA optimizer, >20 lineups), show an inline upgrade modal instead of a bare error message. Link directly to the Stripe Checkout session.

---

### 9.2 — OpenAPI Documentation

**9.2.1 — Generate OpenAPI spec**

Use `swagger-jsdoc` to auto-generate from JSDoc comments in route files:

```bash
npm install swagger-jsdoc swagger-ui-express
```

Add `/** @swagger` annotations to all route handlers. Serve UI at `GET /api/docs` with `swaggerUi.serve` and `swaggerUi.setup(spec)`.

**9.2.2 — Self-service API keys**

Add `POST /api/v1/keys/generate` to create a new API key for the authenticated user:
```js
const key = crypto.randomBytes(32).toString('hex');
const hash = crypto.createHash('sha256').update(key).digest('hex');
// store hash in gasm_warehouse.users.api_key_hash
// return the plaintext key once — never stored, never retrievable again
res.json({ apiKey: key, warning: 'Store this key securely. It will not be shown again.' });
```

**9.2.3 — Per-key rate limiting**

Move rate limiting from in-memory `Map` (lost on restart) to Redis:

```js
const key = `rl:${req.user.userId}`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 60);
if (count > QUOTA_PER_MINUTE[req.user.plan]) {
  return res.status(429).json({ error: 'Rate limit exceeded' });
}
```

Quotas: Free=30 req/min, Pro=120 req/min, Elite=500 req/min.

---

## Infrastructure & Security (Parallel / Ongoing)

| Task | Priority | Detail |
|------|----------|--------|
| **Rotate GCP service account keys** | 🔴 URGENT | Credentials found in Google Drive. Rotate `ava-dfs@gasm-481006.iam.gserviceaccount.com` and `218987434388-compute@developer.gserviceaccount.com`. Revoke old keys via `gcloud iam service-accounts keys delete`. |
| Move API keys to Secret Manager | 🔴 High | `API_KEYS` env var on Cloud Run → `gcloud secrets create ava-dfs-api-keys` |
| Move JWT secret to Secret Manager | 🔴 High | Before Phase 7 ships |
| Delete `run` Cloud Function | 🟡 Medium | State: FAILED, region: us-east1. Confirmed broken, confirmed wrong region. |
| Audit `ava-data-harvester` | 🟡 Medium | State: UNKNOWN. Determine if needed; delete if not. |
| Delete empty BQ datasets | 🟢 Low | `gasm_vault`, `gasm_raw`, `ava_mlb_data` — verify empty before deleting |
| `.env.example` file | 🟢 Low | Document all required env vars: `GCP_PROJECT_ID`, `API_KEYS`, `JWT_SECRET`, `REDIS_URL`, `SLACK_WEBHOOK_URL`, `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

---

## Build Order

```
Phase 1    Data pipelines        MLB salary → NBA pipeline → WNBA pipeline → monitoring
Phase 2    Dashboard quality     Status badges → floor/ceiling → search → stacking → weather
Phase 3    NFL                   Schema → ingest → scoring → Vegas odds → scheduler
Phase 4    ML models             Feature enrichment → BQML batter/pitcher → Statcast → backtesting
Phase 5    Platforms             FanDuel → Yahoo → Dabble
Phase 6    Sports expansion      NHL → CFB → CBB
Phase 7    User management       Google OAuth → JWT → users table → lineup history → admin panel
Phase 8    Performance           Redis cache → Pub/Sub retry → Cloud Monitoring alerts → BQ cleanup
Phase 9    Monetization          Stripe → plan enforcement → API docs → self-service keys
```

---

## Decision Log

| Decision | Chosen | Reason |
|----------|--------|--------|
| Salary data source | DraftKings public CSV/API endpoint | Free, no API key required, official |
| Game data — MLB | MLB Stats API (`statsapi` wrapper) | Free, official, no rate limits |
| Game data — NBA/WNBA | NBA Stats API (direct HTTP, `LeagueID=00` / `10`) | Free, comprehensive; `nba_api` package is fragile |
| Game data — NFL | ESPN public API | Free tier; Pro Football Reference as backup |
| Game data — NHL | NHL official API (`api-web.nhle.com/v1`) | Free, official, well-documented |
| Game data — CFB | CFBD API (free tier, API key required) | Best free CFB data source |
| ML framework | BigQuery ML (BQML) | Runs in-warehouse; no serving infrastructure; fast iteration |
| Auth | Google OAuth 2.0 → server-issued JWT | Eliminates password management; users already have Google |
| Caching | Memorystore Redis (same VPC) | Lowest latency; no network egress costs |
| Retry queue | Pub/Sub | Native GCP integration; built-in dead-letter and backoff |
| Billing | Stripe Checkout (hosted) | No PCI scope on our servers |
