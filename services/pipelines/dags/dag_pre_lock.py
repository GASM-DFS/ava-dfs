"""Pre-lock DAG for lineup/weather refresh and rerun inference."""

from datetime import datetime

from airflow import DAG
from airflow.operators.python import PythonOperator


def noop(task_name: str) -> None:
    print(f"Executing {task_name}")


with DAG(
    dag_id="dag-pre-lock",
    start_date=datetime(2026, 1, 1),
    schedule="0 */1 * * *",
    catchup=False,
    tags=["ava-dfs", "pre-lock"],
) as dag:
    refresh_weather = PythonOperator(
        task_id="refresh_weather",
        python_callable=noop,
        op_kwargs={"task_name": "ingest-weather"},
    )

    refresh_lineups = PythonOperator(
        task_id="refresh_lineups",
        python_callable=noop,
        op_kwargs={"task_name": "ingest-sportsradar"},
    )

    rerun_inference = PythonOperator(
        task_id="rerun_inference",
        python_callable=noop,
        op_kwargs={"task_name": "models-and-optimizer-refresh"},
    )

    refresh_weather >> refresh_lineups >> rerun_inference
