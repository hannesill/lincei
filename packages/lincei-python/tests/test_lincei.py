from __future__ import annotations

import builtins
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import lincei


def completed(stdout: str, returncode: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["lincei"],
        returncode=returncode,
        stdout=stdout,
        stderr=stderr,
    )


class LinceiPythonTests(unittest.TestCase):
    def test_status_returns_decoded_dict(self) -> None:
        with patch("subprocess.run", return_value=completed('{"runtime":{}}')) as run:
            self.assertEqual(lincei.status(), {"runtime": {}})
            run.assert_called_once_with(
                ["lincei", "dataset", "status"],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_schema_describe_and_context_return_decoded_dicts(self) -> None:
        payload = completed('{"ok":true}')
        with patch("subprocess.run", return_value=payload):
            self.assertEqual(lincei.schema(dataset="mimic-iv-demo"), {"ok": True})
            self.assertEqual(lincei.describe_table("patients", backend="duckdb"), {"ok": True})
            self.assertEqual(lincei.context(), {"ok": True})
            subprocess.run.assert_any_call(
                ["lincei", "dataset", "context", "--structured"],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_nonzero_cli_exit_raises_lincei_error(self) -> None:
        with patch("subprocess.run", return_value=completed("", returncode=2, stderr="bad")):
            with self.assertRaises(lincei.LinceiError) as raised:
                lincei.schema()

        self.assertEqual(raised.exception.stderr, "bad")
        self.assertEqual(raised.exception.exit_code, 2)

    def test_query_converts_cli_rows_and_columns_to_dataframe(self) -> None:
        calls: list[tuple[object, object]] = []

        class FakeDataFrame:
            def __init__(self, rows: object, columns: object = None) -> None:
                calls.append((rows, columns))

        fake_pandas = types.SimpleNamespace(DataFrame=FakeDataFrame)
        payload = json.dumps({"columns": ["a"], "rows": [{"a": 1}]})
        with (
            patch.dict(sys.modules, {"pandas": fake_pandas}),
            patch("subprocess.run", return_value=completed(payload)),
        ):
            frame = lincei.query("select 1", dataset="mimic-iv-demo")

        self.assertIsInstance(frame, FakeDataFrame)
        self.assertEqual(calls, [([{"a": 1}], ["a"])])

    def test_missing_pandas_only_affects_query(self) -> None:
        original_import = builtins.__import__

        def guarded_import(name: str, *args: object, **kwargs: object):
            if name == "pandas":
                raise ImportError("missing pandas")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=guarded_import):
            with self.assertRaises(lincei.LinceiError) as raised:
                lincei.query("select 1")

        self.assertIn("pandas is required", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
