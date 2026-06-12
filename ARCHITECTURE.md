# Ava-DFS GASM Engine Architecture

## System Overview
The Ava-DFS GASM (Generative Advanced Synergy Metrics) Engine is a Daily Fantasy Sports (DFS) lineup optimization tool specifically engineered for MLB DraftKings. 

To maximize cost-efficiency, the system operates on a **Local-First Hybrid Architecture**, utilizing local compute for heavy processing and Google Cloud Platform (GCP) for data warehousing.

## Core Modules

### 1. Ingestion (`ava_dfs.ingestion`)
*   **`mlb_stats_api`**: Interfaces with the MLB Stats API to pull daily schedules, live game statuses, and box score data.
*   **`lineup_parser`**: Extracts and validates confirmed starting lineups from daily PDFs or external data sources to ensure only active players are considered.

### 2. Feature Engineering (`ava_dfs.features`)
*   **`rolling_projections`**: Calculates 14-day trailing averages for players to establish baseline performance projections and proxy salaries.
*   **`synergy_metrics`**: Injects advanced tactical metrics into the player pool, including:
    *   *Volatility Scores*: Measuring player variance.
    *   *Usage Vacuums*: Identifying value opportunities.
    *   *Stack Synergy*: Quantifying correlative teammate values.

### 3. Optimization (`ava_dfs.optimization`)
*   **`linear_solver`**: Uses Linear Programming (`pulp`) to generate mathematically optimal 10-man DFS lineups. It maximizes projected fantasy points while strictly adhering to DraftKings salary caps and positional constraints.

### 4. Storage & GCP Integration (`ava_dfs.storage`)
*   **`bigquery_client`**: Handles the one-way push of final generated projections and optimal lineups into the `gasm-481006` BigQuery data warehouse for historical archiving.

## Infrastructure & Security
*   **Cloud Project:** `gasm-481006`
*   **Authentication:** Application Default Credentials (ADC) impersonating the dedicated service account: `ava-dfs@gasm-481006.iam.gserviceaccount.com`.
*   **Cost Strategy:** Zero-cost processing. BigQuery is utilized strictly as a cold-storage archive (write-only during daily runs) to prevent query egress fees.