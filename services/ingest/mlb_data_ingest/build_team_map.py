import statsapi
from google.cloud import bigquery

PROJECT_ID = "gasm-481006"
client = bigquery.Client(project=PROJECT_ID)
DATASET_ID = f"{PROJECT_ID}.mlb_data"
TABLE_ID = f"{DATASET_ID}.dim_teams"

print("🛰️ FETCHING OFFICIAL MLB TEAM REGISTRY...")
# Fetch all active MLB teams (sportId=1)
teams_data = statsapi.get('teams', {'sportId': 1})['teams']

# Define the BigQuery schema
schema = [
    bigquery.SchemaField("team_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("team_name", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("abbreviation", "STRING", mode="REQUIRED")
]

# Create the table
table = bigquery.Table(TABLE_ID, schema=schema)
try:
    client.delete_table(TABLE_ID, not_found_ok=True) # Clear if exists
    table = client.create_table(table)
    print(f"✅ TABLE CREATED: {TABLE_ID}")
except Exception as e:
    print(f"⚠️ Table Creation Warning: {e}")

# Format the data
rows_to_insert = []
for t in teams_data:
    rows_to_insert.append({
        "team_id": str(t['id']),
        "team_name": t['name'],
        "abbreviation": t.get('abbreviation', 'UNK')
    })

# Insert into BigQuery
errors = client.insert_rows_json(TABLE_ID, rows_to_insert)
if errors == []:
    print(f"✅ REGISTRY POPULATED: {len(rows_to_insert)} MLB teams successfully mapped.")
else:
    print(f"❌ INSERT ERRORS: {errors}")
