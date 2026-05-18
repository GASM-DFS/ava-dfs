"""Daily morning DAG for Ava-DFS orchestration."""

from datetime import datetime

from airflow import DAG
from airflow.operators.python import PythonOperator


def noop(task_name: str) -> None:
    print(f"Executing {task_name}")


with DAG(
    dag_id="dag-daily-morning",
    start_date=datetime(2026, 1, 1),
    schedule="0 10 * * *",
    catchup=False,
    tags=["ava-dfs", "daily"],
) as dag:
    ingest_statcast = PythonOperator(
        task_id="ingest_statcast",
        python_callable=noop,
        op_kwargs={"task_name": "ingest-statcast"},
    )

    ingest_sportsradar = PythonOperator(
        task_id="ingest_sportsradar",
        python_callable=noop,
        op_kwargs={"task_name": "ingest-sportsradar"},
    )

    transform_core = PythonOperator(
        task_id="transform_core",
        python_callable=noop,
        op_kwargs={"task_name": "transform-statcast-and-player-metrics"},
    )

    run_models = PythonOperator(
        task_id="run_models",
        python_callable=noop,
        op_kwargs={"task_name": "model-base-variance-simulation-ownership"},
    )

    ingest_statcast >> ingest_sportsradar >> transform_core >> run_models
