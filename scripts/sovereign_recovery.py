#!/usr/bin/env python3
"""sovereign_recovery.py: Emergency manual elite record injection bypassing API lag."""
import subprocess
import sys

def inject_record(player_name, game_date, pts, reb, ast, fpts):
    sql = (
        f"INSERT INTO `gasm-481006.nba_data.game_by_game_logs` "
        f"(player_name, game_date, pts, reb, ast, fantasy_pts) "
        f"VALUES ('{player_name}', DATE '{game_date}', {float(pts)}, {float(reb)}, {float(ast)}, {float(fpts)});"
    )
    subprocess.run(["bq", "--project_id=gasm-481006", "--location=us-central1", "query", "--use_legacy_sql=false", "--quiet", sql], check=True)
    print(f"✅ RECOVERY INJECTED: {player_name} ({game_date}) -> {fpts} FPTS")

if __name__ == "__main__":
    if len(sys.argv) == 7:
        inject_record(*sys.argv[1:7])
    else:
        print("✅ sovereign_recovery.py online. Usage: python3 ~/ava-mcp-agent/sovereign_recovery.py 'Name' 'YYYY-MM-DD' PTS REB AST FPTS")
