from __future__ import annotations

import json
import http.client
from pathlib import Path
import sqlite3
import tempfile
from threading import Thread
import unittest
from unittest import mock
from urllib import request
from urllib.parse import quote

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

    def test_http_api_exposes_canonical_run_status_routes_and_keeps_legacy_raw_run(self) -> None:
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                snapshot = created["modelingSnapshot"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "canonical runs", "steps": 2}},
                )

                missing_family = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "run_type": "single",
                    },
                )
                submitted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "single",
                    },
                )
                status = self._json(base_url, "GET", f"/runs/{submitted['run_id']}")
                result = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/chain")
                legacy_run = self._json(base_url, "GET", f"/simulation-runs/{submitted['run_id']}")

                self.assertEqual(missing_family["code"], "bad_run_request")
                self.assertEqual(submitted["phase"], "completed")
                self.assertEqual(submitted["progress"], 1)
                self.assertEqual(submitted["experiment_plan_id"], plan["experiment_plan_id"])
                self.assertEqual(status["run_id"], submitted["run_id"])
                self.assertEqual(status["modeling_snapshot_id"], snapshot["snapshot_id"])
                self.assertEqual(result["run_id"], submitted["run_id"])
                self.assertEqual(artifacts["run_id"], submitted["run_id"])
                self.assertEqual(chain["run_id"], submitted["run_id"])
                self.assertEqual(legacy_run["run_id"], submitted["run_id"])
                self.assertEqual(legacy_run["schema_version"], "run-v0")
                self.assertIn("model_id", legacy_run)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_reject_non_imported_sample_project(self) -> None:
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
                saved = self._json(base_url, "POST", "/projects", project)
                self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "canonical formal run gate", "steps": 1}},
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "single",
                    },
                )

                self.assertEqual(error["code"], "formal_run_requires_imported_sample")
                self.assertEqual(error["details"]["project_id"], saved["project_id"])
                self.assertIsNone(error["details"]["source_import_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_reject_forged_import_source_project(self) -> None:
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
                auth_token = self._login_token(base_url, "data", "data")
                import_package = self._fixture("modeling_import_project.json")
                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
                self._json(
                    base_url,
                    "POST",
                    f"/modeling-imports/{quote(import_package['importId'], safe='')}/publish",
                    auth_token=auth_token,
                )
                forged_project = self._fixture("smoke_project.json")
                forged_project["project_id"] = import_package["projectId"]
                forged_project["missionProfile"] = {"sourceImportId": import_package["importId"]}
                saved = self._json(base_url, "POST", "/projects", forged_project)
                self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "forged canonical formal run", "steps": 1}},
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "single",
                    },
                )

                self.assertEqual(error["code"], "formal_run_requires_imported_sample")
                self.assertEqual(error["details"]["project_id"], saved["project_id"])
                self.assertEqual(error["details"]["source_import_id"], import_package["importId"])
                self.assertEqual(error["details"]["reason"], "missing_create_project_audit")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_legacy_simulation_runs_accept_preview_project(self) -> None:
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
                saved = self._json(base_url, "POST", "/projects", project)
                self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "legacy preview run", "steps": 1}},
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

                self.assertEqual(run["status"], "succeeded")
                self.assertEqual(run["project_id"], saved["project_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_accept_formal_monte_carlo_run_type(self) -> None:
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                snapshot = created["modelingSnapshot"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {
                        "config": {
                            "name": "http formal monte carlo",
                            "steps": 2,
                            "projectJson": created["project"],
                            "analysisRequests": {
                                "largeSample": {
                                    "enabled": True,
                                    "samples": 8,
                                    "sweep": {
                                        "failureRates": [0.06, 0.08],
                                        "spareMultipliers": [0.75, 1.0],
                                        "supportCapacities": [2, 3],
                                    },
                                },
                                "spareShortfall": {"enabled": True},
                                "carryList": {"enabled": True},
                                "missionReliability": {"enabled": True},
                                "downtimeFactors": {"enabled": True},
                            },
                        }
                    },
                )

                submitted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "monte_carlo",
                    },
                )
                artifacts = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/artifacts")
                kinds = {artifact["kind"] for artifact in artifacts["artifacts"]}
                base_artifact = next(artifact for artifact in artifacts["artifacts"] if artifact["kind"] == "monte_carlo_base")
                payload = json.loads((Path(tmp) / "artifacts" / base_artifact["path"]).read_text(encoding="utf-8"))

                self.assertEqual(submitted["status"], "succeeded")
                self.assertEqual(submitted["run_type"], "monte_carlo")
                self.assertEqual(submitted["modeling_snapshot_id"], snapshot["snapshot_id"])
                self.assertIn("monte_carlo_base", kinds)
                self.assertEqual(len([kind for kind in kinds if kind.startswith("analysis_projection_")]), 4)
                self.assertEqual(payload["sample_count"], 8)
                self.assertEqual(payload["sweep"]["supportCapacities"], [2, 3])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_reject_request_level_monte_carlo_config(self) -> None:
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                self._json(base_url, "POST", f"/projects/{saved['project_id']}/modeling-snapshots")
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {
                        "config": {
                            "name": "http reject request monte carlo config",
                            "steps": 1,
                            "projectJson": created["project"],
                            "analysisRequests": {
                                "largeSample": {
                                    "enabled": True,
                                    "samples": 4,
                                    "sweep": {
                                        "failureRates": [0.07],
                                        "spareMultipliers": [1.0],
                                        "supportCapacities": [3],
                                    },
                                }
                            },
                        }
                    },
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "smoke",
                        "run_type": "monte_carlo",
                        "sample_count": 99,
                        "sweep": {"supportCapacities": [9]},
                    },
                )

                self.assertEqual(error["code"], "bad_run_request")
                self.assertIn("ExperimentPlan.config.analysisRequests.largeSample", error["message"])
                self.assertIn("sample_count", error["details"]["fields"])
                self.assertIn("sweep", error["details"]["fields"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_return_compile_gate_diagnostics(self) -> None:
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "http compiler gate", "steps": 1, "projectJson": created["project"]}},
                )

                submitted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aviation_support",
                        "run_type": "single",
                    },
                )
                artifacts = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/chain")

                self.assertEqual(submitted["status"], "failed")
                self.assertEqual(submitted["phase"], "failed")
                self.assertIsNone(submitted["scenario_id"])
                self.assertEqual(submitted["error"]["code"], "unsupported_model_family")
                self.assertEqual(
                    submitted["error"]["details"]["issues"][0]["field_path"],
                    "missionProfile.durationHours",
                )
                self.assertEqual(submitted["error"]["details"]["provenance"]["model_family"], "aviation_support")
                self.assertEqual(submitted["result_summary_id"], None)
                self.assertIsNone(artifacts["scenario_id"])
                self.assertEqual(artifacts["artifacts"], [])
                self.assertIsNone(chain.get("scenario_id"))
                self.assertIsNone(chain.get("scenario_version"))
                self.assertIsNone(chain.get("scenario_schema_version"))
                self.assertEqual(chain["artifact_manifest_id"], submitted["artifact_manifest_id"])
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

    def test_http_server_does_not_reuse_sqlite_connection_across_request_threads(self) -> None:
        connection_calls = []
        original_connect = sqlite3.connect

        def spy_connect(*args, **kwargs):
            connection_calls.append((args, kwargs))
            return original_connect(*args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp, mock.patch(
            "src.spare_mvp_backend.http_server.sqlite3.connect",
            side_effect=spy_connect,
        ):
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
                self._json(base_url, "POST", "/auth/login", {"username": "admin", "password": "admin"})
                self._json(base_url, "POST", "/auth/login", {"username": "admin", "password": "admin"})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

        self.assertGreaterEqual(len(connection_calls), 3)
        self.assertFalse(any(call[1].get("check_same_thread") is False for call in connection_calls))

    def test_http_server_rejects_oversized_json_request_body(self) -> None:
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
                connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
                connection.putrequest("POST", "/api/projects/validate")
                connection.putheader("content-type", "application/json")
                connection.putheader("content-length", str(1024 * 1024 + 1))
                connection.endheaders()
                response = connection.getresponse()
                payload = json.loads(response.read().decode("utf-8"))
                connection.close()
                self.assertEqual(response.status, 413)
                self.assertEqual(payload["code"], "request_too_large")
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

    def test_http_modeling_import_routes_validate_save_get_and_publish(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                import_package["importId"] = "import/http demo"
                encoded_import_id = quote(import_package["importId"], safe="")
                auth_token = self._login_token(base_url, "data", "data")

                validation = self._json(base_url, "POST", "/modeling-imports/validate", import_package)
                saved = self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
                stored = self._json(base_url, "GET", f"/modeling-imports/{encoded_import_id}")
                published = self._json(base_url, "POST", f"/modeling-imports/{encoded_import_id}/publish", auth_token=auth_token)

                self.assertTrue(validation["ok"])
                self.assertEqual(saved["import_id"], import_package["importId"])
                self.assertEqual(saved["validation_status"], "valid")
                self.assertEqual(stored["importId"], import_package["importId"])
                self.assertEqual(stored["draftPackage"]["importId"], import_package["importId"])
                self.assertIsNone(stored["publishedPackage"])
                self.assertEqual(published["lifecycle"]["state"], "published")
                self.assertEqual(published["publishedPackage"]["lifecycle"]["state"], "published")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_mutations_require_m4_session(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")

                unauthenticated = self._json_error(base_url, "POST", "/modeling-imports", import_package)
                session = self._json(
                    base_url,
                    "POST",
                    "/auth/login",
                    {"username": "data", "password": "data"},
                )
                saved = self._json(
                    base_url,
                    "POST",
                    "/modeling-imports",
                    import_package,
                    auth_token=session["session"]["token"],
                )

                self.assertEqual(unauthenticated["code"], "unauthorized")
                self.assertEqual(session["user"]["role"], "数据管理员")
                self.assertEqual(saved["import_id"], import_package["importId"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_compile_scenario_requires_m4_session(self) -> None:
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

                unauthenticated = self._json_error(
                    base_url,
                    "POST",
                    "/modeling-imports/import-carrier-day-night-001/compile-scenario",
                    {"model_family": "smoke"},
                )

                self.assertEqual(unauthenticated["code"], "unauthorized")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_publish_denies_regular_user_and_records_audit(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                data_session = self._json(base_url, "POST", "/auth/login", {"username": "data", "password": "data"})
                user_session = self._json(base_url, "POST", "/auth/login", {"username": "user", "password": "user"})

                self._json(
                    base_url,
                    "POST",
                    "/modeling-imports",
                    import_package,
                    auth_token=data_session["session"]["token"],
                )
                denied = self._json_error(
                    base_url,
                    "POST",
                    f"/modeling-imports/{import_package['importId']}/publish",
                    auth_token=user_session["session"]["token"],
                )
                audit = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(import_package['importId'], safe='')}",
                    auth_token=data_session["session"]["token"],
                )

                self.assertEqual(denied["code"], "forbidden")
                self.assertEqual(audit["events"][-1]["action"], "modeling_import.publish")
                self.assertEqual(audit["events"][-1]["outcome"], "denied")
                self.assertEqual(audit["events"][-1]["actor_user_id"], user_session["user"]["user_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_user_management_routes_list_create_and_update_users(self) -> None:
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
                admin_token = self._login_token(base_url, "admin", "admin")

                before = self._json(base_url, "GET", "/users", auth_token=admin_token)
                created = self._json(
                    base_url,
                    "POST",
                    "/users",
                    {
                        "username": "planner",
                        "password": "planner",
                        "role": "数据管理员",
                        "display_name": "规划员",
                        "status": "active",
                    },
                    auth_token=admin_token,
                )
                updated = self._json(
                    base_url,
                    "POST",
                    f"/users/{quote(created['user_id'], safe='')}",
                    {"display_name": "规划员二号", "role": "普通用户", "status": "disabled"},
                    auth_token=admin_token,
                )
                after = self._json(base_url, "GET", "/users", auth_token=admin_token)

                self.assertIn("admin", {user["username"] for user in before["users"]})
                self.assertEqual(created["username"], "planner")
                self.assertNotIn("password_hash", created)
                self.assertEqual(updated["display_name"], "规划员二号")
                self.assertEqual(updated["role"], "普通用户")
                self.assertEqual(updated["status"], "disabled")
                self.assertIn("planner", {user["username"] for user in after["users"]})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_user_management_denies_regular_user_and_records_audit(self) -> None:
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
                admin_token = self._login_token(base_url, "admin", "admin")
                user_token = self._login_token(base_url, "user", "user")
                created = self._json(
                    base_url,
                    "POST",
                    "/users",
                    {"username": "readonly", "password": "readonly", "role": "普通用户"},
                    auth_token=admin_token,
                )

                denied_create = self._json_error(
                    base_url,
                    "POST",
                    "/users",
                    {"username": "blocked", "password": "blocked", "role": "普通用户"},
                    auth_token=user_token,
                )
                denied_update = self._json_error(
                    base_url,
                    "POST",
                    f"/users/{quote(created['user_id'], safe='')}",
                    {"display_name": "不应修改"},
                    auth_token=user_token,
                )
                audit = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(created['user_id'], safe='')}",
                    auth_token=admin_token,
                )

                self.assertEqual(denied_create["code"], "forbidden")
                self.assertEqual(denied_update["code"], "forbidden")
                self.assertEqual(audit["events"][-1]["action"], "users.update")
                self.assertEqual(audit["events"][-1]["outcome"], "denied")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_get_restores_draft_and_published_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database_path = Path(tmp) / "m5-2-import.sqlite3"
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
                import_package = self._fixture("modeling_import_project.json")
                import_id = quote(import_package["importId"], safe="")
                auth_token = self._login_token(base_url, "data", "data")
                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
                self._json(base_url, "POST", f"/modeling-imports/{import_id}/publish", auth_token=auth_token)

                changed_package = self._fixture("modeling_import_project.json")
                changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
                target_index = next(
                    index for index, component in enumerate(changed_package["objects"]["equipmentAssets"])
                    if component["id"] == "j15-engine"
                )
                changed_package["objects"]["equipmentAssets"][target_index]["quantity"] = 3
                self._json(base_url, "POST", "/modeling-imports", changed_package, auth_token=auth_token)
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
                stored = self._json(base_url, "GET", f"/modeling-imports/{import_id}")

                self.assertEqual(stored["draftPackage"]["lifecycle"]["state"], "draft")
                self.assertEqual(stored["draftPackage"]["lifecycle"]["version"], 2)
                self.assertEqual(stored["draftPackage"]["objects"]["equipmentAssets"][target_index]["quantity"], 3)
                self.assertEqual(stored["publishedPackage"]["lifecycle"]["state"], "published")
                self.assertEqual(stored["publishedPackage"]["lifecycle"]["version"], 1)
                self.assertEqual(stored["publishedPackage"]["objects"]["equipmentAssets"][target_index]["quantity"], 2)
            finally:
                second_server.shutdown()
                second_server.server_close()
                second_thread.join(timeout=5)

    def test_http_modeling_import_compile_scenario_route_uses_simulation_adapter(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                auth_token = self._login_token(base_url, "data", "data")

                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
                self._json(base_url, "POST", f"/modeling-imports/{import_package['importId']}/publish", auth_token=auth_token)
                compiled = self._json(
                    base_url,
                    "POST",
                    f"/modeling-imports/{import_package['importId']}/compile-scenario",
                    {"model_family": "smoke"},
                    auth_token=auth_token,
                )

                self.assertEqual(compiled["compiled_from_import"]["import_id"], import_package["importId"])
                self.assertEqual(compiled["scenario"]["project_id"], import_package["projectId"])
                self.assertEqual(compiled["scenario"]["compiled_by"], "Simulation Adapter Agent")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_create_project_requires_session_and_data_role(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                encoded_import_id = quote(import_package["importId"], safe="")
                data_token = self._login_token(base_url, "data", "data")
                user_token = self._login_token(base_url, "user", "user")

                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=data_token)
                self._json(base_url, "POST", f"/modeling-imports/{encoded_import_id}/publish", auth_token=data_token)

                unauthenticated = self._json_error(
                    base_url,
                    "POST",
                    f"/modeling-imports/{encoded_import_id}/create-project",
                )
                forbidden = self._json_error(
                    base_url,
                    "POST",
                    f"/modeling-imports/{encoded_import_id}/create-project",
                    auth_token=user_token,
                )
                created = self._json(
                    base_url,
                    "POST",
                    f"/modeling-imports/{encoded_import_id}/create-project",
                    auth_token=data_token,
                )
                stored_project = self._json(base_url, "GET", f"/projects/{quote(import_package['projectId'], safe='')}")

                self.assertEqual(unauthenticated["code"], "unauthorized")
                self.assertEqual(forbidden["code"], "forbidden")
                self.assertEqual(created["sourceImport"]["import_id"], import_package["importId"])
                self.assertEqual(created["project"]["project_id"], import_package["projectId"])
                self.assertEqual(created["project"]["equipment"]["wholeMachineModels"], ["J-15", "J-35"])
                self.assertGreaterEqual(len(created["project"]["components"]), 8)
                self.assertGreaterEqual(len(created["project"]["missionProfile"]["compositeTasks"]), 2)
                self.assertGreaterEqual(len(created["project"]["supportNodes"]), 3)
                self.assertIn("航电模块", created["project"]["supportNodes"][0]["inventory"])
                self.assertTrue(any(
                    activity["activityType"] == "修复性维修" and len(activity["jobs"]) >= 2
                    for activity in created["project"]["supportActivities"]
                ))
                self.assertEqual(created["savedProject"]["project_id"], import_package["projectId"])
                self.assertEqual(created["modelingSnapshot"]["project"]["project_id"], import_package["projectId"])
                self.assertTrue(created["modelingSnapshot"]["snapshot_id"])
                self.assertEqual(stored_project["project_id"], import_package["projectId"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_invalid_package_returns_field_level_issues(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                import_package["objects"]["supportActivities"][0]["resourceId"] = "missing-resource"
                auth_token = self._login_token(base_url, "data", "data")

                error = self._json_error(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)

                self.assertEqual(error["code"], "invalid_modeling_import")
                self.assertEqual(
                    error["details"]["issues"][0]["field_path"],
                    "objects.supportActivities[0].resourceId",
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_modeling_import_publish_rejects_referenced_import(self) -> None:
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
                import_package = self._fixture("modeling_import_project.json")
                import_package["lifecycle"] = {
                    "state": "published",
                    "version": 1,
                    "referencedRunIds": ["run-smoke-contract-001"],
                }
                auth_token = self._login_token(base_url, "data", "data")
                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)

                error = self._json_error(
                    base_url,
                    "POST",
                    f"/modeling-imports/{import_package['importId']}/publish",
                    auth_token=auth_token,
                )

                self.assertEqual(error["code"], "published_import_referenced")
                self.assertEqual(error["details"]["import_id"], import_package["importId"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def _login_token(self, base_url: str, username: str, password: str) -> str:
        session = self._json(base_url, "POST", "/auth/login", {"username": username, "password": password})
        return session["session"]["token"]

    def _create_imported_sample_project(self, base_url: str) -> dict:
        auth_token = self._login_token(base_url, "data", "data")
        import_package = self._fixture("modeling_import_project.json")
        self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
        self._json(
            base_url,
            "POST",
            f"/modeling-imports/{quote(import_package['importId'], safe='')}/publish",
            auth_token=auth_token,
        )
        return self._json(
            base_url,
            "POST",
            f"/modeling-imports/{quote(import_package['importId'], safe='')}/create-project",
            auth_token=auth_token,
        )

    def _json(
        self,
        base_url: str,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        auth_token: str | None = None,
    ) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"content-type": "application/json"} if payload is not None else {}
        if auth_token is not None:
            headers["authorization"] = f"Bearer {auth_token}"
        req = request.Request(
            f"{base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        opener = request.build_opener(request.ProxyHandler({}))
        with opener.open(req, timeout=10) as response:
            self.assertEqual(response.status, 200)
            return json.loads(response.read().decode("utf-8"))

    def _json_error(
        self,
        base_url: str,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        auth_token: str | None = None,
    ) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"content-type": "application/json"} if payload is not None else {}
        if auth_token is not None:
            headers["authorization"] = f"Bearer {auth_token}"
        req = request.Request(
            f"{base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        opener = request.build_opener(request.ProxyHandler({}))
        try:
            opener.open(req, timeout=10)
        except Exception as exc:
            response = exc
            if not hasattr(response, "read"):
                raise
            return json.loads(response.read().decode("utf-8"))
        self.fail("request unexpectedly succeeded")


if __name__ == "__main__":
    unittest.main()
