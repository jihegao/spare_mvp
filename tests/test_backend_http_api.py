from __future__ import annotations

import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest
from urllib import request

from src.spare_mvp_backend.http_server import create_backend_server


REPO_ROOT = Path(__file__).resolve().parents[1]


class BackendHttpApiTest(unittest.TestCase):
    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def test_http_api_serves_frontend_contract_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                project = self._fixture("smoke_project.json")

                validation = self._json(base_url, "POST", "/projects/validate", project)
                saved = self._json(base_url, "POST", "/projects", project)
                snapshot = self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "http contract smoke", "steps": 2}},
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/simulation-runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                    },
                )
                stored_run = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}")
                result = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/chain")

                self.assertTrue(validation["ok"])
                self.assertEqual(snapshot["project_id"], saved["project_id"])
                self.assertEqual(stored_run["run_id"], run["run_id"])
                self.assertEqual(result["run_id"], run["run_id"])
                self.assertEqual(artifacts["run_id"], run["run_id"])
                self.assertEqual(chain["run_id"], run["run_id"])
                self.assertEqual(chain["modeling_snapshot_id"], snapshot["snapshot_id"])
                self.assertEqual(chain["experiment_plan_id"], plan["experiment_plan_id"])
                self.assertEqual(chain["result_summary_id"], run["result_summary_id"])
                self.assertEqual(chain["artifact_manifest_id"], run["artifact_manifest_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_server_serves_static_frontend_on_same_origin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_address[1]}/front/index.html"
                req = request.Request(url, method="GET")
                opener = request.build_opener(request.ProxyHandler({}))
                with opener.open(req, timeout=10) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("text/html", response.headers["content-type"])
                    body = response.read().decode("utf-8")
                self.assertIn("备件规划", body)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_persistent_database_can_query_project_run_result_and_artifacts_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database_path = Path(tmp) / "m3-1.sqlite3"
            artifact_dir = Path(tmp) / "artifacts"
            first_server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=database_path,
                output_dir=artifact_dir,
            )
            first_thread = Thread(target=first_server.serve_forever, daemon=True)
            first_thread.start()
            try:
                base_url = f"http://127.0.0.1:{first_server.server_address[1]}/api"
                project = self._fixture("smoke_project.json")
                saved = self._json(base_url, "POST", "/projects", project)
                self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "persistent http smoke", "steps": 2}},
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/simulation-runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                    },
                )
            finally:
                first_server.shutdown()
                first_server.server_close()
                first_thread.join(timeout=5)

            second_server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=database_path,
                output_dir=artifact_dir,
            )
            second_thread = Thread(target=second_server.serve_forever, daemon=True)
            second_thread.start()
            try:
                base_url = f"http://127.0.0.1:{second_server.server_address[1]}/api"
                stored_project = self._json(base_url, "GET", f"/projects/{saved['project_id']}")
                stored_run = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}")
                result = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/simulation-runs/{run['run_id']}/chain")

                self.assertEqual(stored_project["project_id"], saved["project_id"])
                self.assertEqual(stored_run["run_id"], run["run_id"])
                self.assertEqual(result["run_id"], run["run_id"])
                self.assertEqual(artifacts["run_id"], run["run_id"])
                self.assertEqual(chain["project_id"], saved["project_id"])
                self.assertEqual(chain["run_id"], run["run_id"])
                self.assertEqual(chain["result_summary_id"], run["result_summary_id"])
                self.assertEqual(chain["artifact_manifest_id"], run["artifact_manifest_id"])
            finally:
                second_server.shutdown()
                second_server.server_close()
                second_thread.join(timeout=5)

    def test_http_server_does_not_serve_repo_files_outside_frontend(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_address[1]}/tests/test_backend_http_api.py"
                req = request.Request(url, method="GET")
                opener = request.build_opener(request.ProxyHandler({}))
                with self.assertRaises(Exception):
                    opener.open(req, timeout=10)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def _json(self, base_url: str, method: str, path: str, payload: dict | None = None) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{base_url}{path}",
            data=data,
            method=method,
            headers={"content-type": "application/json"} if payload is not None else {},
        )
        opener = request.build_opener(request.ProxyHandler({}))
        with opener.open(req, timeout=10) as response:
            self.assertEqual(response.status, 200)
            return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
