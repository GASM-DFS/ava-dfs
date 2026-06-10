import logging
import functions_framework
from google.cloud import bigquery
from datetime import date

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ID = "gasm-481006"
client = bigquery.Client(project=PROJECT_ID)


def _bq(sql):
    return client.query(sql).result()


@functions_framework.http
def refresh_mlb_pipeline(request):
    if request.method == "OPTIONS":
        return ("", 204, {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type"})

    headers = {"Access-Control-Allow-Origin": "*"}
    today = date.today().isoformat()
    logger.info("Starting MLB pipeline refresh for %s", today)

    try:
        # ── Step 1: How many new game-log rows since the last feature snapshot ──
        rows = list(_bq(f"""
            SELECT COUNT(*) AS cnt
            FROM `{PROJECT_ID}.mlb_data.game_by_game_logs`
            WHERE game_date > (
                SELECT COALESCE(MAX(game_date), DATE('2024-01-01'))
                FROM `{PROJECT_ID}.mlb_data.mlb_features_v2`
            )
        """))
        new_game_rows = rows[0]["cnt"]
        logger.info("New game-log rows since last feature update: %d", new_game_rows)

        # ── Step 2: Append features for any new game dates ──
        if new_game_rows > 0:
            _bq(f"""
                INSERT INTO `{PROJECT_ID}.mlb_data.mlb_features_v2`
                WITH windowed AS (
                    SELECT
                        gl.player_id,
                        gl.player_name,
                        gl.game_date,
                        gl.fantasy_pts                                          AS target_fantasy_pts,
                        AVG(gl.fantasy_pts) OVER w14                            AS avg_fantasy_pts_last_14,
                        MAX(gl.fantasy_pts) OVER w14                            AS max_fantasy_pts_last_14,
                        AVG(CAST(gl.ip AS FLOAT64)) OVER w14                   AS avg_ip_last_14,
                        AVG(CAST(gl.k AS FLOAT64)) OVER w14                    AS avg_k_last_14,
                        AVG(CAST(gl.er AS FLOAT64)) OVER w14                   AS avg_er_last_14,
                        AVG(CAST(gl.hits AS FLOAT64)) OVER w14                 AS avg_hits_last_14,
                        AVG(CAST(gl.hr AS FLOAT64)) OVER w14                   AS avg_hr_last_14,
                        AVG(CAST(gl.sb AS FLOAT64)) OVER w14                   AS avg_sb_last_14
                    FROM `{PROJECT_ID}.mlb_data.game_by_game_logs` gl
                    WINDOW w14 AS (
                        PARTITION BY gl.player_id
                        ORDER BY gl.game_date
                        ROWS BETWEEN 14 PRECEDING AND 1 PRECEDING
                    )
                )
                SELECT w.*
                FROM windowed w
                WHERE w.game_date > (
                    SELECT COALESCE(MAX(game_date), DATE('2024-01-01'))
                    FROM `{PROJECT_ID}.mlb_data.mlb_features_v2`
                )
                AND NOT EXISTS (
                    SELECT 1 FROM `{PROJECT_ID}.mlb_data.mlb_features_v2` f
                    WHERE f.player_id = w.player_id AND f.game_date = w.game_date
                )
            """)
            logger.info("Features refreshed for new game dates")

        # ── Step 3: Delete and regenerate today's projections ──
        _bq(f"""
            DELETE FROM `{PROJECT_ID}.mlb_data.mlb_projections`
            WHERE projection_date = DATE('{today}')
        """)

        # Projection = 70% 14-game avg + 30% 14-game max (recency-weighted ceiling blend)
        _bq(f"""
            INSERT INTO `{PROJECT_ID}.mlb_data.mlb_projections`
            SELECT
                player_id,
                player_name,
                ROUND(
                    COALESCE(avg_fantasy_pts_last_14, 0) * 0.7
                    + COALESCE(max_fantasy_pts_last_14, 0) * 0.3,
                    2
                ) AS projected_pts,
                DATE('{today}') AS projection_date
            FROM `{PROJECT_ID}.mlb_data.mlb_features_v2`
            QUALIFY ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY game_date DESC) = 1
        """)

        cnt = list(_bq(f"""
            SELECT COUNT(*) AS cnt FROM `{PROJECT_ID}.mlb_data.mlb_projections`
            WHERE projection_date = DATE('{today}')
        """))[0]["cnt"]

        logger.info("Pipeline refresh complete: %d new feature rows, %d projections for %s", new_game_rows, cnt, today)
        return (
            f"✅ Refreshed: {new_game_rows} new feature rows, {cnt} projections for {today}",
            200,
            headers,
        )

    except Exception:
        logger.exception("Pipeline refresh failed")
        return ("❌ Pipeline refresh failed — check logs", 500, headers)
