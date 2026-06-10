import logging
import threading
import functions_framework
from google.cloud import bigquery
import statsapi
import requests
from datetime import datetime, timedelta

PIPELINE_REFRESH_URL = "https://mlb-pipeline-refresh-5i4dg43y2q-uc.a.run.app/"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ID = "gasm-481006"
TABLE_REF = f"{PROJECT_ID}.mlb_data.game_by_game_logs"

def calculate_fantasy_points(stats, is_pitcher):
    try:
        if is_pitcher:
            ip_raw = str(stats.get('inningsPitched', '0'))
            if '.' in ip_raw:
                full, partial = ip_raw.split('.')
                ip_val = float(full) + (float(partial) / 3.0)
            else:
                ip_val = float(ip_raw)
                
            points = (ip_val * 2.25) + \
                     (float(stats.get('strikeOuts', 0)) * 2.0) + \
                     (float(stats.get('earnedRuns', 0)) * -2.0) + \
                     ((float(stats.get('hits', 0)) + float(stats.get('baseOnBalls', 0))) * -0.6)
            return round(float(points), 2)
        else:
            hr = float(stats.get('homeRuns', 0))
            t3b = float(stats.get('triples', 0))
            t2b = float(stats.get('doubles', 0))
            t1b = float(stats.get('hits', 0)) - hr - t3b - t2b
            points = (t1b * 3.0) + (t2b * 5.0) + (t3b * 8.0) + (hr * 10.0) + \
                     (float(stats.get('rbi', 0)) * 2.0) + (float(stats.get('runs', 0)) * 2.0) + \
                     (float(stats.get('baseOnBalls', 0)) * 2.0) + (float(stats.get('stolenBases', 0)) * 5.0)
            return round(float(points), 2)
    except Exception as e:
        logger.exception("Scoring math error")
        return 0.0

@functions_framework.http
def update_mlb_data(request):
    if request.method == 'OPTIONS':
        headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type'}
        return ('', 204, headers)

    headers = {'Access-Control-Allow-Origin': '*'}
    request_json = request.get_json(silent=True)
    target_date = request_json.get('date') if request_json and request_json.get('date') else (datetime.now() - timedelta(days=1)).strftime("%m/%d/%Y")
    bq_date = datetime.strptime(target_date, "%m/%d/%Y").strftime("%Y-%m-%d")
    
    client = bigquery.Client(project=PROJECT_ID)
    logger.info("Starting MLB data ingest for date=%s", target_date)

    try:
        games = statsapi.schedule(date=target_date)
        all_stats = []

        for game in games:
            game_id = str(game.get('game_id', '0'))
            if game_id == '0': continue

            home_name = game.get('home_name', 'Unknown')
            away_name = game.get('away_name', 'Unknown')
            logger.info("Processing game %s: %s vs %s", game_id, away_name, home_name)

            # Fetch Weather from Raw API Endpoint (More reliable than the wrapper)
            temp = None
            wind = "Unknown"
            try:
                raw_game_data = requests.get(f"https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live", timeout=10).json()
                weather = raw_game_data.get('gameData', {}).get('weather', {})
                temp_str = weather.get('temp')
                if temp_str: temp = int(temp_str)
                wind = weather.get('wind', 'Unknown')
            except Exception:
                logger.warning("Failed to fetch weather for game %s", game_id)
            
            box = statsapi.boxscore_data(int(game_id))
            
            for team_type in ['home', 'away']:
                team_data = box.get(team_type, {})
                team_info = team_data.get('team', {})
                team_id = team_info.get('id', '0')
                
                is_home = (team_type == 'home')
                opponent = away_name if is_home else home_name
                
                # Batters
                for p_id in team_data.get('players', []):
                    p = team_data['players'][p_id]
                    s = p.get('stats', {}).get('batting', {})
                    batting_order = str(p.get('battingOrder', 'Unknown'))
                    
                    if s.get('atBats', 0) > 0 or s.get('baseOnBalls', 0) > 0:
                        all_stats.append({
                            "player_id": str(p.get('person', {}).get('id', p_id)),
                            "player_name": p.get('person', {}).get('fullName', 'Unknown'),
                            "game_date": bq_date,
                            "game_id": game_id,
                            "team_id": str(team_id),
                            "opponent": opponent,
                            "is_home": is_home,
                            "is_pitcher": False,
                            "batting_order": batting_order,
                            "temperature": temp,
                            "wind": wind,
                            "ab": s.get('atBats', 0), "hits": s.get('hits', 0), "runs": s.get('runs', 0),
                            "hr": s.get('homeRuns', 0), "rbi": s.get('rbi', 0), "ip": 0.0,
                            "er": 0, "k": s.get('strikeOuts', 0), "bb": s.get('baseOnBalls', 0),
                            "sb": s.get('stolenBases', 0), "doubles": s.get('doubles', 0), "triples": s.get('triples', 0),
                            "fantasy_pts": calculate_fantasy_points(s, False)
                        })
                
                # Pitchers
                for p_id in team_data.get('pitchers', []):
                    lookup_id = f"ID{p_id}" if f"ID{p_id}" in team_data['players'] else p_id
                    p = team_data['players'].get(lookup_id)
                    if not p: continue
                    
                    s = p.get('stats', {}).get('pitching', {})
                    all_stats.append({
                        "player_id": str(p_id),
                        "player_name": p.get('person', {}).get('fullName', 'Unknown'),
                        "game_date": bq_date,
                        "game_id": game_id,
                        "team_id": str(team_id),
                        "opponent": opponent,
                        "is_home": is_home,
                        "is_pitcher": True,
                        "batting_order": "Pitcher",
                        "temperature": temp,
                        "wind": wind,
                        "ab": 0, "hits": s.get('hits', 0), "runs": s.get('runs', 0),
                        "hr": s.get('homeRuns', 0), "rbi": 0, "ip": float(s.get('inningsPitched', 0)),
                        "er": s.get('earnedRuns', 0), "k": s.get('strikeOuts', 0), "bb": s.get('baseOnBalls', 0),
                        "sb": 0, "doubles": 0, "triples": 0,
                        "fantasy_pts": calculate_fantasy_points(s, True)
                    })

        if all_stats:
            errors = client.insert_rows_json(TABLE_REF, all_stats)
            if errors:
                logger.error("BigQuery insert errors: %s", errors)
                return (f"❌ BQ Errors: {errors}", 500, headers)

        logger.info("Ingest complete: %d records for %s", len(all_stats), target_date)

        # Fire pipeline refresh in background so this function returns within its timeout
        def _trigger_refresh():
            try:
                requests.post(PIPELINE_REFRESH_URL, timeout=300)
            except Exception:
                logger.warning("Pipeline refresh trigger failed — scheduler job will retry at 8:30am ET")

        threading.Thread(target=_trigger_refresh, daemon=True).start()

        return (f"✅ Harvested {len(all_stats)} records with Weather and Lineup data for {target_date}.", 200, headers)

    except Exception as e:
        logger.exception("Engine failure for date=%s", target_date)
        return (f"❌ Engine Failure: {str(e)}", 500, headers)
