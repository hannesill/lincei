from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Any

__all__ = [
    "LinceiError",
    "context",
    "describe_table",
    "query",
    "schema",
    "status",
]


@dataclass
class LinceiError(RuntimeError):
    message: str
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None

    def __post_init__(self) -> None:
        RuntimeError.__init__(self, self.message)


def _cli_executable() -> str:
    return os.environ.get("LINCEI_CLI", "lincei")


def _dataset_backend_args(dataset: str | None, backend: str | None) -> list[str]:
    args: list[str] = []
    if dataset is not None:
        args.extend(["--dataset", dataset])
    if backend is not None:
        args.extend(["--backend", backend])
    return args


def _run_json(args: list[str]) -> dict[str, Any]:
    completed = subprocess.run(
        [_cli_executable(), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise LinceiError(
            "lincei CLI command failed.",
            stdout=completed.stdout,
            stderr=completed.stderr,
            exit_code=completed.returncode,
        )
    try:
        decoded = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise LinceiError(
            f"lincei CLI returned invalid JSON: {exc}",
            stdout=completed.stdout,
            stderr=completed.stderr,
            exit_code=completed.returncode,
        ) from exc
    if not isinstance(decoded, dict):
        raise LinceiError(
            "lincei CLI returned JSON that was not an object.",
            stdout=completed.stdout,
            stderr=completed.stderr,
            exit_code=completed.returncode,
        )
    return decoded


def status() -> dict[str, Any]:
    return _run_json(["dataset", "status"])


def schema(dataset: str | None = None, backend: str | None = None) -> dict[str, Any]:
    return _run_json(["dataset", "schema", *_dataset_backend_args(dataset, backend)])


def describe_table(
    table: str,
    dataset: str | None = None,
    backend: str | None = None,
) -> dict[str, Any]:
    return _run_json(
        ["dataset", "describe-table", table, *_dataset_backend_args(dataset, backend)]
    )


def context(dataset: str | None = None, backend: str | None = None) -> dict[str, Any]:
    return _run_json(
        ["dataset", "context", "--format", "json", *_dataset_backend_args(dataset, backend)]
    )


def query(sql: str, dataset: str | None = None, backend: str | None = None):
    try:
        import pandas as pd
    except ImportError as exc:
        raise LinceiError(
            "pandas is required for lincei.query(); install lincei[pandas] or pandas.",
            exit_code=None,
        ) from exc

    result = _run_json(["dataset", "query", "--sql", sql, *_dataset_backend_args(dataset, backend)])
    rows = result.get("rows", [])
    columns = result.get("columns")
    if isinstance(columns, list):
        return pd.DataFrame(rows, columns=columns)
    return pd.DataFrame(rows)
