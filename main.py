import os
import csv
import json
import logging
from datetime import datetime, timezone
import requests
import functions_framework
from google.cloud import bigquery

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "gasm-481006")

@functions_framework.http
def fetch_mlb_salaries(request):
    """Cloud Function entry point to fetch MLB DraftKings salaries."""
    now = datetime.now(timezone.utc)
    start_time_after = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_time_before = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    # 1. Discover DK draft group for MLB (sportId=5)
    url_draftgroups = "https://api.draftkings.com/draftgroups/v1/draftgroups"
    params_dg = {
        "sportId": 5,
        "startTimeBefore": start_time_before.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "startTimeAfter": start_time_after.strftime("%Y-%m-%dT%H:%M:%SZ")
    }

    resp_dg = requests.get(url_draftgroups, params=params_dg, timeout=10)
    resp_dg.raise_for_status()
    
    draft_group_id = None
    for dg in resp_dg.json().get("draftGroups", []):
        if dg.get("gameType", {}).get("gameTypeName") == "Classic":
            draft_group_id = dg.get("draftGroupId")
            break

    if not draft_group_id:
        logger.info("No Classic MLB draft group found for today.")
        return ("No MLB Classic slate today.", 200)

    # 2. Download salary CSV
    url_csv = "https://www.draftkings.com/lineup/getavailableplayerscsv"
    params_csv = {
        "contestTypeId": 28,
        "draftGroupId": draft_group_id
    }

    resp_csv = requests.get(url_csv, params=params_csv, timeout=10)
    resp_csv.raise_for_status()

    # 3. Parse CSV into target Schema
    lines = resp_csv.text.splitlines()
    reader = csv.DictReader(lines)
    
    slate_date = now.strftime("%Y-%m-%d")
    rows = []
    
    for row in reader:
        if not row.get("ID"):
            continue

        name_plus_id = row.get("Name + ID", "")
        clean_name = name_plus_id.split("(")[0].strip() if "(" in name_plus_id else row.get("Name", "")

        rows.append({
            "Name": clean_name,
            "ID": int(row["ID"]),
            "Position": row.get("Position", ""),
            "Salary": int(row.get("Salary", 0)),
            "AvgPts": float(row.get("AvgPointsPerGame") or 0.0),
            "Team": row.get("TeamAbbrev", ""),
            "Status": row.get("Status", ""),
            "slate_date": slate_date,
            "provider": "draftkings"
        })

    if not rows:
        return ("No players parsed from CSV.", 200)

    # 4. Upsert rows via MERGE mapping exactly to Phase 1.1 specs
    client = bigquery.Client(project=PROJECT_ID)
    table_id = f"{PROJECT_ID}.mlb_dfs_projections.v1_player_list"

    query = f"""
    MERGE `{table_id}` T
    USING (
      SELECT
        CAST(JSON_VALUE(x, '$.Name') AS STRING) AS Name,
        CAST(JSON_VALUE(x, '$.ID') AS INT64) AS ID,
        CAST(JSON_VALUE(x, '$.Position') AS STRING) AS Position,
        CAST(JSON_VALUE(x, '$.Salary') AS INT64) AS Salary,
        CAST(JSON_VALUE(x, '$.AvgPts') AS FLOAT64) AS AvgPts,
        CAST(JSON_VALUE(x, '$.Team') AS STRING) AS Team,
        CAST(JSON_VALUE(x, '$.Status') AS STRING) AS Status,
        CAST(JSON_VALUE(x, '$.slate_date') AS DATE) AS slate_date,
        CAST(JSON_VALUE(x, '$.provider') AS STRING) AS provider
      FROM UNNEST(JSON_EXTRACT_ARRAY(@json_data, '$')) x
    ) S
    ON T.ID = S.ID AND T.slate_date = S.slate_date AND T.provider = S.provider
    WHEN MATCHED THEN
      UPDATE SET Name = S.Name, Position = S.Position, Salary = S.Salary, AvgPts = S.AvgPts, Team = S.Team, Status = S.Status
    WHEN NOT MATCHED THEN
      INSERT (Name, ID, Position, Salary, AvgPts, Team, Status, slate_date, provider)
      VALUES (S.Name, S.ID, S.Position, S.Salary, S.AvgPts, S.Team, S.Status, S.slate_date, S.provider)
    """

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("json_data", "STRING", json.dumps(rows))
        ]
    )
    
    client.query(query, job_config=job_config).result()
    return (f"Successfully upserted {len(rows)} salaries for {slate_date}.", 200)