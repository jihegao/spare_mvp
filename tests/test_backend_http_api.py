from __future__ import annotations

import hashlib
import json
import http.client
from pathlib import Path
import sqlite3
import sys
import tempfile
from threading import Event, Thread
import unittest
from unittest import mock
from urllib import request
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.spare_mvp_backend.http_server import create_backend_server
from src.spare_mvp_backend.modeling_import import modeling_import_to_project
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]
HTTP_TEST_TIMEOUT_SECONDS = 30


def small_aircraft_support_project(project_id: str) -> dict:
    return {
        "schema_version": "project-v0",
        "project_id": project_id,
        "project_version": "project-v0.1",
        "scenarioId": f"{project_id}-scenario",
        "activeModule": "sparePlanning",
        "projectInfo": {"name": "small current project", "baseCode": "SM", "summary": "small current project"},
        "airports": ["A"],
        "missionAreas": [],
        "missionProfile": {"name": "small current mission", "durationHours": 1, "compositeTasks": [], "periodicTasks": []},
        "experiment": {"seed": 42},
        "basicMissions": [{
            "id": "basic-small",
            "name": "small sortie",
            "missionId": "basic-small",
            "minRequiredSorties": 1,
            "taskDurationMinutes": 30,
            "equipmentType": "J-15",
        }],
        "missionPhases": [],
        "combatUnit": {"members": [{"aircraftNo": "J15-001", "model": "J-15", "status": "ready", "airport": "A"}]},
        "components": [{
            "id": "whole-aircraft",
            "name": "whole aircraft",
            "aircraftModel": "J-15",
            "productType": "whole",
            "quantity": 1,
            "failureRate": 0.01,
            "mtbfHours": 100,
            "meanRepairTimeMinutes": 30,
            "failureDistribution": {"distributionType": "exponential", "parameters": "lambda=0.01"},
            "repairDistribution": {"distributionType": "fixed", "parameters": "value=30"},
        }],
        "supportNodes": [{
            "id": "node-a",
            "name": "node A",
            "personnelCapacity": 1,
            "equipmentCapacity": 1,
            "inventory": {"aircraft_support_v1_spares": 2},
        }],
        "supportActivities": [{"id": "corrective", "activityType": "corrective", "durationHours": 1, "jobs": []}],
        "supportOrganization": {},
        "reliabilityBlockDiagram": {
            "nodes": [{"id": "whole-aircraft", "name": "whole aircraft", "type": "system", "failureRate": 0.01}],
            "edges": [],
        },
        "modelingImportValidation": {"usedTables": {}, "disabledDomains": [], "warnings": []},
    }


class BackendHttpApiTest(unittest.TestCase):
    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def _submit_m7_http_run(self, base_url: str) -> dict:
        created = self._create_imported_sample_project(base_url)
        saved = created["savedProject"]
        auth_token = created["authToken"]
        plan = self._json(
            base_url,
            "POST",
            f"/projects/{saved['project_id']}/experiment-plans",
            {"config": {"name": "m7 http management", "steps": 2, "projectJson": created["project"]}},
            auth_token=auth_token,
        )
        submitted = self._json(
            base_url,
            "POST",
            "/runs",
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "aircraft_support_v1",
                "run_type": "single",
            },
            auth_token=auth_token,
        )
        return {"created": created, "plan": plan, "run": submitted}

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
                created = self._create_imported_sample_project(base_url)
                project = created["project"]
                saved = created["savedProject"]
                snapshot = created["modelingSnapshot"]
                auth_token = created["authToken"]

                validation = self._json(base_url, "POST", "/projects/validate", project)
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "http contract current", "steps": 2}},
                    auth_token=auth_token,
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )
                status = self._json(base_url, "GET", f"/runs/{run['run_id']}")
                result = self._json(base_url, "GET", f"/runs/{run['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/runs/{run['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{run['run_id']}/chain")

                self.assertTrue(validation["ok"])
                self.assertEqual(snapshot["project_id"], saved["project_id"])
                self.assertEqual(status["run_id"], run["run_id"])
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

    def test_http_current_analysis_result_returns_formal_projection_record(self) -> None:
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
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {
                        "config": {
                            "name": "http current analysis",
                            "steps": 2,
                            "projectJson": created["project"],
                            "analysisRequests": {
                                "largeSample": {
                                    "enabled": True,
                                    "samples": 1,
                                    "sweep": {
                                        "failureRates": [0.05],
                                        "spareMultipliers": [1.0],
                                        "supportCapacities": [2],
                                    },
                                },
                                "spareShortfall": {"enabled": True},
                            },
                        }
                    },
                    auth_token=auth_token,
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "monte_carlo",
                        "analysis_type": "spare_shortfall",
                    },
                    auth_token=auth_token,
                )

                current = self._json(
                    base_url,
                    "GET",
                    f"/projects/{quote(saved['project_id'], safe='')}/analysis-results/spare_shortfall",
                    auth_token=auth_token,
                )

                self.assertEqual(run["status"], "succeeded")
                self.assertEqual(current["analysis_type"], "spare_shortfall")
                self.assertEqual(current["status"], "completed")
                self.assertEqual(current["source"], "formal_backend")
                self.assertEqual(current["last_success_result"]["run_id"], run["run_id"])
                self.assertEqual(current["last_success_result"]["projection_type"], "spare_shortfall")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_api_persists_stage5_system_config_and_user_delete(self) -> None:
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
                data_token = self._login_token(base_url, "data", "data")
                payload = {
                    "projectDataModules": [{"key": "modeling-data-source", "sheetKeys": ["equipment-system"]}],
                    "modelingForms": {"fieldUnits": {"equipment-system:mtbfHours": "小时"}, "personnelSpecialties": ["机务"]},
                }

                saved_config = self._json(
                    base_url,
                    "POST",
                    "/system-configs/system-runtime-support",
                    {"payload": payload},
                    auth_token=data_token,
                )
                loaded_config = self._json(
                    base_url,
                    "GET",
                    "/system-configs/system-runtime-support",
                    auth_token=admin_token,
                )
                created_user = self._json(
                    base_url,
                    "POST",
                    "/users",
                    {"username": "stage5-planner", "password": "planner", "role": "普通用户"},
                    auth_token=admin_token,
                )
                deleted_user = self._json(
                    base_url,
                    "DELETE",
                    f"/users/{quote(created_user['user_id'], safe='')}",
                    auth_token=admin_token,
                )
                users = self._json(base_url, "GET", "/users", auth_token=admin_token)

                self.assertEqual(saved_config["payload"]["modelingForms"]["personnelSpecialties"], ["机务"])
                self.assertEqual(loaded_config["payload"]["modelingForms"]["fieldUnits"]["equipment-system:mtbfHours"], "小时")
                self.assertEqual(deleted_user["deleted"], True)
                self.assertNotIn("stage5-planner", {user["username"] for user in users["users"]})
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()

    def test_http_experiment_plan_delete_soft_deletes_associated_runs(self) -> None:
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "http visual cleanup", "steps": 2, "projectJson": created["project"]}},
                    auth_token=auth_token,
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )

                plans = self._json(base_url, "GET", f"/projects/{saved['project_id']}/experiment-plans")
                deleted = self._json(
                    base_url,
                    "DELETE",
                    f"/projects/{quote(saved['project_id'], safe='')}/experiment-plans/{quote(plan['experiment_plan_id'], safe='')}",
                    auth_token=admin_token,
                )
                after = self._json(base_url, "GET", f"/projects/{saved['project_id']}/experiment-plans")
                run_list = self._json(base_url, "GET", "/runs?include_deleted=1")

                self.assertEqual(plans["experiment_plans"][0]["experiment_plan_id"], plan["experiment_plan_id"])
                self.assertEqual(plans["experiment_plans"][0]["run_count"], 1)
                self.assertEqual(deleted["soft_deleted_run_ids"], [run["run_id"]])
                self.assertEqual(after["experiment_plans"], [])
                deleted_run = next(item for item in run_list["runs"] if item["run_id"] == run["run_id"])
                self.assertEqual(deleted_run["lifecycle_status"], "deleted")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_experiment_plan_delete_waits_for_inflight_run_before_tombstone(self) -> None:
        class BlockingAdapter(SimulationAdapter):
            started = Event()
            release = Event()

            def run_scenario(self, *args, **kwargs):
                self.started.set()
                self.release.wait(timeout=HTTP_TEST_TIMEOUT_SECONDS)
                return super().run_scenario(*args, **kwargs)

        with tempfile.TemporaryDirectory() as tmp, mock.patch(
            "src.spare_mvp_backend.http_server.SimulationAdapter",
            BlockingAdapter,
        ):
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=Path(tmp) / "spare_mvp.sqlite3",
                output_dir=Path(tmp) / "artifacts",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                admin_token = self._login_token(base_url, "admin", "admin")
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "http visual inflight cleanup", "steps": 2, "projectJson": created["project"]}},
                    auth_token=auth_token,
                )
                results: dict[str, dict] = {}

                def submit_run() -> None:
                    results["run"] = self._json(
                        base_url,
                        "POST",
                        "/runs",
                        {
                            "project_id": saved["project_id"],
                            "experiment_plan_id": plan["experiment_plan_id"],
                            "model_family": "aircraft_support_v1",
                            "run_type": "single",
                        },
                        auth_token=auth_token,
                    )

                def delete_plan() -> None:
                    results["delete"] = self._json(
                        base_url,
                        "DELETE",
                        f"/projects/{quote(saved['project_id'], safe='')}/experiment-plans/{quote(plan['experiment_plan_id'], safe='')}",
                        auth_token=admin_token,
                    )

                run_thread = Thread(target=submit_run)
                run_thread.start()
                self.assertTrue(BlockingAdapter.started.wait(timeout=HTTP_TEST_TIMEOUT_SECONDS))
                delete_thread = Thread(target=delete_plan)
                delete_thread.start()
                BlockingAdapter.release.set()
                run_thread.join(timeout=HTTP_TEST_TIMEOUT_SECONDS)
                delete_thread.join(timeout=HTTP_TEST_TIMEOUT_SECONDS)

                self.assertFalse(run_thread.is_alive())
                self.assertFalse(delete_thread.is_alive())
                self.assertIn(results["run"]["run_id"], results["delete"]["soft_deleted_run_ids"])
                run_list = self._json(base_url, "GET", "/runs?include_deleted=1")
                deleted_run = next(item for item in run_list["runs"] if item["run_id"] == results["run"]["run_id"])
                self.assertEqual(deleted_run["lifecycle_status"], "deleted")
                after = self._json(base_url, "GET", f"/projects/{saved['project_id']}/experiment-plans")
                self.assertEqual(after["experiment_plans"], [])
            finally:
                BlockingAdapter.release.set()
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_api_exposes_canonical_run_status_routes(self) -> None:
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
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "canonical runs", "steps": 2}},
                    auth_token=auth_token,
                )

                defaulted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )
                submitted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )
                status = self._json(base_url, "GET", f"/runs/{submitted['run_id']}")
                result = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{submitted['run_id']}/chain")

                self.assertEqual(defaulted["phase"], "completed")
                self.assertEqual(defaulted["model_family"], "aircraft_support_v1")
                self.assertEqual(submitted["phase"], "completed")
                self.assertEqual(submitted["progress"], 1)
                self.assertEqual(submitted["experiment_plan_id"], plan["experiment_plan_id"])
                self.assertEqual(status["run_id"], submitted["run_id"])
                self.assertEqual(status["modeling_snapshot_id"], snapshot["snapshot_id"])
                self.assertEqual(result["run_id"], submitted["run_id"])
                self.assertEqual(artifacts["run_id"], submitted["run_id"])
                self.assertEqual(chain["run_id"], submitted["run_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_m7_run_list_detail_archive_delete_and_legacy_retirement(self) -> None:
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
                submitted = self._submit_m7_http_run(base_url)
                run_id = submitted["run"]["run_id"]
                admin_token = self._login_token(base_url, "admin", "admin")
                user_token = self._login_token(base_url, "user", "user")

                listed = self._json(base_url, "GET", "/runs")
                self.assertIn(run_id, [item["run_id"] for item in listed["runs"]])

                detail = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/detail")
                self.assertEqual(detail["run"]["run_id"], run_id)
                self.assertEqual(detail["chain"]["run_id"], run_id)
                self.assertEqual(detail["artifact_manifest"]["run_id"], run_id)
                self.assertEqual(detail["download_base"], f"/api/runs/{run_id}/artifacts")
                audit_before_lifecycle = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(run_id, safe='')}",
                    auth_token=admin_token,
                )
                self.assertEqual(audit_before_lifecycle["events"], [])

                unauth_archive = self._json_error(base_url, "POST", f"/runs/{quote(run_id, safe='')}/archive")
                unauth_delete = self._json_error(base_url, "DELETE", f"/runs/{quote(run_id, safe='')}")
                self.assertEqual(unauth_archive["code"], "unauthorized")
                self.assertEqual(unauth_delete["code"], "unauthorized")

                forbidden_archive_status, forbidden_archive = self._json_error_with_status(
                    base_url,
                    "POST",
                    f"/runs/{quote(run_id, safe='')}/archive",
                    auth_token=user_token,
                )
                forbidden_delete_status, forbidden_delete = self._json_error_with_status(
                    base_url,
                    "DELETE",
                    f"/runs/{quote(run_id, safe='')}",
                    auth_token=user_token,
                )
                still_active = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/detail")
                audit_after_forbidden = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(run_id, safe='')}",
                    auth_token=admin_token,
                )
                self.assertEqual(forbidden_archive_status, 403)
                self.assertEqual(forbidden_archive["code"], "forbidden")
                self.assertEqual(forbidden_delete_status, 403)
                self.assertEqual(forbidden_delete["code"], "forbidden")
                self.assertEqual(still_active["run"]["lifecycle_status"], "active")
                self.assertFalse(any(event["outcome"] == "allowed" for event in audit_after_forbidden["events"]))

                archive = self._json(
                    base_url,
                    "POST",
                    f"/runs/{quote(run_id, safe='')}/archive",
                    auth_token=admin_token,
                )
                self.assertEqual(archive["run_id"], run_id)
                self.assertEqual(archive["lifecycle_status"], "archived")

                deleted = self._json(
                    base_url,
                    "DELETE",
                    f"/runs/{quote(run_id, safe='')}",
                    auth_token=admin_token,
                )
                self.assertEqual(deleted["run_id"], run_id)
                self.assertEqual(deleted["lifecycle_status"], "deleted")

                hidden = self._json(base_url, "GET", "/runs")
                self.assertNotIn(run_id, [item["run_id"] for item in hidden["runs"]])
                hidden_zero = self._json(base_url, "GET", "/runs?include_deleted=0")
                self.assertNotIn(run_id, [item["run_id"] for item in hidden_zero["runs"]])

                visible = self._json(base_url, "GET", "/runs?include_deleted=1")
                self.assertIn(run_id, [item["run_id"] for item in visible["runs"]])
                tombstone = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/detail")
                self.assertEqual(tombstone["run"]["lifecycle_status"], "deleted")

                audit_after_lifecycle = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(run_id, safe='')}",
                    auth_token=admin_token,
                )
                actions = [event["action"] for event in audit_after_lifecycle["events"]]
                self.assertIn("runs.archive", actions)
                self.assertIn("runs.delete", actions)
                self.assertTrue(all(event["outcome"] == "allowed" for event in audit_after_lifecycle["events"]))
                self.assertTrue(all(event["actor_user_id"] == "user-admin" for event in audit_after_lifecycle["events"]))
                self.assertTrue(all(event["created_at"] for event in audit_after_lifecycle["events"]))

                legacy_status, legacy_body = self._json_error_with_status(base_url, "POST", "/simulation-runs", {})
                self.assertEqual(legacy_status, 410)
                self.assertEqual(legacy_body["code"], "legacy_run_api_retired")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_m7_artifact_download_and_deleted_run_rejection(self) -> None:
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
                submitted = self._submit_m7_http_run(base_url)
                run_id = submitted["run"]["run_id"]
                manifest = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/artifacts")
                artifact = manifest["artifacts"][0]
                user_token = self._login_token(base_url, "user", "user")

                connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=HTTP_TEST_TIMEOUT_SECONDS)
                connection.request("GET", f"/api/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}")
                response = connection.getresponse()
                unauth_body = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 401)
                self.assertEqual(unauth_body["code"], "unauthorized")
                connection.close()

                admin_token = self._login_token(base_url, "admin", "admin")
                connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=HTTP_TEST_TIMEOUT_SECONDS)
                connection.request(
                    "GET",
                    f"/api/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}",
                    headers={"authorization": f"Bearer {user_token}"},
                )
                response = connection.getresponse()
                body = response.read()
                self.assertEqual(response.status, 200)
                self.assertIn(artifact["media_type"], response.headers["content-type"])
                self.assertIn("attachment", response.headers["content-disposition"])
                self.assertGreater(len(body), 0)
                connection.close()

                audit_after_download = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={quote(run_id, safe='')}",
                    auth_token=admin_token,
                )
                download_events = [
                    event for event in audit_after_download["events"] if event["action"] == "runs.artifact.download"
                ]
                self.assertEqual(len(download_events), 1)
                self.assertEqual(download_events[0]["actor_user_id"], "user-basic")
                self.assertEqual(download_events[0]["outcome"], "allowed")
                self.assertTrue(download_events[0]["created_at"])

                self._json(base_url, "DELETE", f"/runs/{quote(run_id, safe='')}", auth_token=admin_token)
                status, payload = self._json_error_with_status(
                    base_url,
                    "GET",
                    f"/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}",
                    auth_token=admin_token,
                )
                self.assertEqual(status, 410)
                self.assertEqual(payload["code"], "run_deleted")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_m9_3_run_control_requires_admin_and_records_audit(self) -> None:
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
                submitted = self._submit_m7_http_run(base_url)
                run_id = submitted["run"]["run_id"]
                encoded_run_id = quote(run_id, safe="")
                admin_token = self._login_token(base_url, "admin", "admin")
                data_token = self._login_token(base_url, "data", "data")
                user_token = self._login_token(base_url, "user", "user")

                unauthenticated = self._json_error(
                    base_url,
                    "POST",
                    f"/runs/{encoded_run_id}/control",
                    {"action": "cancel"},
                )
                forbidden_status, forbidden = self._json_error_with_status(
                    base_url,
                    "POST",
                    f"/runs/{encoded_run_id}/control",
                    {"action": "cancel"},
                    auth_token=user_token,
                )
                still_running_detail = self._json(base_url, "GET", f"/runs/{encoded_run_id}/detail")
                audit_after_denial = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={encoded_run_id}",
                    auth_token=admin_token,
                )

                self.assertEqual(unauthenticated["code"], "unauthorized")
                self.assertEqual(forbidden_status, 403)
                self.assertEqual(forbidden["code"], "forbidden")
                self.assertEqual(still_running_detail["run"]["status"], "succeeded")
                self.assertEqual(audit_after_denial["events"][-1]["action"], "runs.control.cancel")
                self.assertEqual(audit_after_denial["events"][-1]["outcome"], "denied")
                self.assertEqual(audit_after_denial["events"][-1]["actor_user_id"], "user-basic")

                cancelled = self._json(
                    base_url,
                    "POST",
                    f"/runs/{encoded_run_id}/control",
                    {"action": "cancel"},
                    auth_token=admin_token,
                )
                retried = self._json(
                    base_url,
                    "POST",
                    f"/runs/{encoded_run_id}/control",
                    {"action": "retry"},
                    auth_token=data_token,
                )
                audit = self._json(
                    base_url,
                    "GET",
                    f"/audit-events?resource_id={encoded_run_id}",
                    auth_token=admin_token,
                )

                self.assertEqual(cancelled["status"], "cancelled")
                self.assertEqual(cancelled["phase"], "cancelled")
                self.assertEqual(cancelled["cancelled_by"], "user-admin")
                self.assertEqual(retried["status"], "queued")
                self.assertEqual(retried["phase"], "queued")
                self.assertEqual(retried["progress"], 0)
                self.assertEqual(retried["retried_by"], "user-data")
                actions = [event["action"] for event in audit["events"]]
                self.assertIn("runs.control.cancel", actions)
                self.assertIn("runs.control.retry", actions)
                allowed = [event for event in audit["events"] if event["outcome"] == "allowed"]
                self.assertEqual([event["actor_user_id"] for event in allowed[-2:]], ["user-admin", "user-data"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_m7_artifact_download_sanitizes_content_disposition_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            database_path = Path(tmp) / "m7-download.sqlite3"
            artifact_dir = Path(tmp) / "artifacts"
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=database_path,
                output_dir=artifact_dir,
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                submitted = self._submit_m7_http_run(base_url)
                run_id = submitted["run"]["run_id"]
                admin_token = self._login_token(base_url, "admin", "admin")
                manifest = self._json(base_url, "GET", f"/runs/{quote(run_id, safe='')}/artifacts")
                artifact = dict(manifest["artifacts"][0])
                malicious_name = "evil\"\r\nX-Injected: yes.json"
                malicious_path = f"{run_id}/evil-safe.json"
                body = b'{"safe": true}\n'
                target = artifact_dir / malicious_path
                target.write_bytes(body)
                artifact["path"] = malicious_path
                artifact["filename"] = malicious_name
                artifact["sha256"] = hashlib.sha256(body).hexdigest()
                artifact["size_bytes"] = len(body)
                manifest["artifacts"][0] = artifact
                connection = sqlite3.connect(database_path)
                try:
                    connection.execute(
                        """
                        UPDATE artifact_manifests
                        SET payload_json = ?
                        WHERE artifact_manifest_id = ?
                        """,
                        (
                            json.dumps(manifest, ensure_ascii=False, sort_keys=True),
                            manifest["artifact_manifest_id"],
                        ),
                    )
                    connection.commit()
                finally:
                    connection.close()

                connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=HTTP_TEST_TIMEOUT_SECONDS)
                connection.request(
                    "GET",
                    f"/api/runs/{quote(run_id, safe='')}/artifacts/{quote(artifact['artifact_id'], safe='')}",
                    headers={"authorization": f"Bearer {admin_token}"},
                )
                response = connection.getresponse()
                downloaded = response.read()
                disposition = response.headers["content-disposition"]
                connection.close()

                self.assertEqual(response.status, 200)
                self.assertEqual(downloaded, body)
                self.assertIn('filename="evil___X-Injected: yes.json"', disposition)
                self.assertNotIn("\r", disposition)
                self.assertNotIn("\n", disposition)
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()

    def test_http_api_lists_saved_projects_for_project_catalog(self) -> None:
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
                saved_project = created["savedProject"]
                project_json = created["project"]

                catalog = self._json(base_url, "GET", "/projects")

                self.assertEqual(len(catalog["projects"]), 1)
                entry = catalog["projects"][0]
                self.assertEqual(entry["project_id"], saved_project["project_id"])
                self.assertEqual(entry["experiment_name"], project_json["projectInfo"]["name"])
                self.assertEqual(entry["base_code"], project_json["projectInfo"]["baseCode"])
                self.assertEqual(entry["summary"], project_json["projectInfo"]["summary"])
                self.assertEqual(entry["scenario_id"], project_json["scenarioId"])
                self.assertEqual(entry["source_import_id"], project_json["missionProfile"]["sourceImportId"])
                self.assertEqual(entry["is_template"], False)
                self.assertIn("updated_at", entry)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_api_deletes_project_from_backend_catalog(self) -> None:
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
                project_id = created["savedProject"]["project_id"]
                auth_token = created["authToken"]

                deleted = self._json(
                    base_url,
                    "DELETE",
                    f"/projects/{quote(project_id, safe='')}",
                    auth_token=auth_token,
                )
                catalog = self._json(base_url, "GET", "/projects")

                self.assertEqual(deleted["project_id"], project_id)
                self.assertTrue(deleted["deleted"])
                self.assertNotIn(project_id, [entry["project_id"] for entry in catalog["projects"]])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_api_deletes_project_with_run_chain_from_backend_catalog(self) -> None:
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
                submitted = self._submit_m7_http_run(base_url)
                project_id = submitted["created"]["savedProject"]["project_id"]
                auth_token = submitted["created"]["authToken"]

                deleted = self._json(
                    base_url,
                    "DELETE",
                    f"/projects/{quote(project_id, safe='')}",
                    auth_token=auth_token,
                )
                catalog = self._json(base_url, "GET", "/projects")

                self.assertEqual(deleted["project_id"], project_id)
                self.assertTrue(deleted["deleted"])
                self.assertGreaterEqual(deleted["deleted_simulation_runs"], 1)
                self.assertGreaterEqual(deleted["deleted_result_summaries"], 1)
                self.assertGreaterEqual(deleted["deleted_artifact_manifests"], 1)
                self.assertNotIn(project_id, [entry["project_id"] for entry in catalog["projects"]])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_project_write_delete_experiment_plan_and_run_submit_require_m4_session(self) -> None:
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
                project = small_aircraft_support_project("project-http-authz-current")
                data_token = self._login_token(base_url, "data", "data")
                saved = self._json(base_url, "POST", "/projects", project, auth_token=data_token)
                self._json(
                    base_url,
                    "POST",
                    f"/projects/{quote(saved['project_id'], safe='')}/modeling-snapshots",
                    auth_token=data_token,
                )
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{quote(saved['project_id'], safe='')}/experiment-plans",
                    {"config": {"name": "authorized setup", "steps": 1}},
                    auth_token=data_token,
                )

                cases = [
                    ("POST", "/projects", project),
                    (
                        "POST",
                        f"/projects/{quote(saved['project_id'], safe='')}/modeling-snapshots",
                        None,
                    ),
                    (
                        "POST",
                        f"/projects/{quote(saved['project_id'], safe='')}/experiment-plans",
                        {"config": {"name": "unauthorized"}},
                    ),
                    (
                        "POST",
                        "/runs",
                        {
                            "project_id": saved["project_id"],
                            "experiment_plan_id": plan["experiment_plan_id"],
                            "model_family": "aircraft_support_v1",
                            "run_type": "single",
                        },
                    ),
                    ("DELETE", f"/projects/{quote(saved['project_id'], safe='')}", None),
                ]

                for method, path, payload in cases:
                    with self.subTest(method=method, path=path):
                        status, body = self._json_error_with_status(base_url, method, path, payload)
                        self.assertEqual(status, 401)
                        self.assertEqual(body["code"], "unauthorized")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_legacy_simulation_run_routes_are_retired(self) -> None:
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
                cases = [
                    ("POST", "/simulation-runs", {"project_id": "project", "experiment_plan_id": "plan"}),
                    ("GET", "/simulation-runs/run-retired", None),
                    ("GET", "/simulation-runs/run-retired/result", None),
                    ("GET", "/simulation-runs/run-retired/artifacts", None),
                    ("GET", "/simulation-runs/run-retired/chain", None),
                    ("GET", "/simulation-runs%2Frun-retired", None),
                    ("GET", "/simulation%2Druns/run-retired", None),
                ]

                for method, path, payload in cases:
                    with self.subTest(method=method, path=path):
                        status, body = self._json_error_with_status(base_url, method, path, payload)
                        self.assertEqual(status, 410)
                        self.assertEqual(body["code"], "legacy_run_api_retired")
                        self.assertIn("/api/runs", body["message"])
                        self.assertEqual(body["details"]["replacement"], "/api/runs")
                        migration = body["details"]["migration"]
                        self.assertEqual(
                            migration["docs"],
                            "docs/archive/deprecated/superpowers/plans/2026-06-21-legacy-run-api-retirement.md",
                        )
                        self.assertEqual(migration["mapping"]["/api/simulation-runs"], "/api/runs")
                        self.assertEqual(
                            migration["mapping"]["/api/simulation-runs/{run_id}/chain"],
                            "/api/runs/{run_id}/chain",
                        )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_legacy_simulation_run_post_malformed_json_is_retired(self) -> None:
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
                status, body = self._raw_json_error_with_status(
                    server.server_address[1],
                    "POST",
                    "/api/simulation-runs",
                    b"{",
                )

                self.assertEqual(status, 410)
                self.assertEqual(body["code"], "legacy_run_api_retired")
                self.assertEqual(body["details"]["replacement"], "/api/runs")
                self.assertEqual(
                    body["details"]["migration"]["mapping"]["/api/simulation-runs/{run_id}"],
                    "/api/runs/{run_id}",
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_legacy_simulation_run_post_oversized_json_is_retired(self) -> None:
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
                status, body = self._raw_json_error_with_status(
                    server.server_address[1],
                    "POST",
                    "/api/simulation-runs",
                    b"",
                    content_length=1024 * 1024 + 1,
                )

                self.assertEqual(status, 410)
                self.assertEqual(body["code"], "legacy_run_api_retired")
                self.assertEqual(body["details"]["replacement"], "/api/runs")
                self.assertEqual(
                    body["details"]["migration"]["mapping"]["/api/simulation-runs/{run_id}/result"],
                    "/api/runs/{run_id}/result",
                )
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
                project = small_aircraft_support_project("project-http-formal-gate-current")
                auth_token = self._login_token(base_url, "data", "data")
                saved = self._json(base_url, "POST", "/projects", project, auth_token=auth_token)
                self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/modeling-snapshots",
                    auth_token=auth_token,
                )
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "canonical formal run gate", "steps": 1}},
                    auth_token=auth_token,
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )

                self.assertEqual(error["code"], "formal_run_requires_imported_sample")
                self.assertEqual(error["details"]["project_id"], saved["project_id"])
                self.assertIsNone(error["details"]["source_import_id"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_lite_mesa_analysis_runs_in_memory_without_formal_side_effects(self) -> None:
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
                project = small_aircraft_support_project("project-http-lite-mesa-analysis")

                visualization_status, visualization_error = self._json_error_with_status(
                    base_url,
                    "POST",
                    "/mesa-visualization-runs",
                    {"project": project, "model_family": "aircraft_support_v1"},
                    auth_token=auth_token,
                )
                payload = self._json(
                    base_url,
                    "POST",
                    "/mesa-analysis-runs",
                    {
                        "project": project,
                        "analysis_type": "mission_reliability",
                        "settings": {"samples": 2, "seed": 20260704},
                        "model_family": "aircraft_support_v1",
                    },
                    auth_token=auth_token,
                )
                catalog = self._json(base_url, "GET", "/projects")

                self.assertEqual(visualization_status, 404)
                self.assertEqual(visualization_error["code"], "not_found")
                self.assertEqual(payload["status"], "session_complete")
                self.assertEqual(payload["source"], "lite_mesa_aircraft_support_v1")
                self.assertEqual(payload["model_family"], "aircraft_support_v1")
                self.assertEqual(payload["analysis_type"], "mission_reliability")
                self.assertEqual(payload["project_id"], "project-http-lite-mesa-analysis")
                self.assertEqual(payload["sample_count"], 2)
                self.assertEqual(payload["seed_list"], [20260704, 20260705])
                self.assertTrue(payload["rows"])
                self.assertEqual(payload["rows"], payload["wave_rows"])
                self.assertNotIn("seed", payload["rows"][0])
                self.assertEqual(catalog["projects"], [])
                self.assertEqual([path.name for path in (Path(tmp) / "artifacts").glob("*")], [])
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
                forged_project = small_aircraft_support_project("project-http-forged-current")
                forged_project["project_id"] = import_package["projectId"]
                forged_project["missionProfile"] = {"sourceImportId": import_package["importId"]}
                saved = self._json(base_url, "POST", "/projects", forged_project, auth_token=auth_token)
                self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/modeling-snapshots",
                    auth_token=auth_token,
                )
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "forged canonical formal run", "steps": 1}},
                    auth_token=auth_token,
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
                )

                self.assertEqual(error["code"], "formal_run_requires_imported_sample")
                self.assertEqual(error["details"]["project_id"], saved["project_id"])
                self.assertEqual(error["details"]["source_import_id"], import_package["importId"])
                self.assertEqual(error["details"]["reason"], "missing_create_project_audit")
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
                auth_token = created["authToken"]
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
                                    "samples": 1,
                                    "sweep": {
                                        "failureRates": [0.06],
                                        "spareMultipliers": [1.0],
                                        "supportCapacities": [2],
                                    },
                                },
                                "spareShortfall": {"enabled": True},
                                "carryList": {"enabled": True},
                                "missionReliability": {"enabled": True},
                                "downtimeFactors": {"enabled": True},
                            },
                        }
                    },
                    auth_token=auth_token,
                )

                submitted = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "monte_carlo",
                    },
                    auth_token=auth_token,
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
                self.assertEqual(payload["sample_count"], 1)
                self.assertEqual(payload["sweep"]["supportCapacities"], [2])
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
                auth_token = created["authToken"]
                self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/modeling-snapshots",
                    auth_token=auth_token,
                )
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
                    auth_token=auth_token,
                )

                error = self._json_error(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "monte_carlo",
                        "sample_count": 99,
                        "sweep": {"supportCapacities": [9]},
                    },
                    auth_token=auth_token,
                )

                self.assertEqual(error["code"], "bad_run_request")
                self.assertIn("ExperimentPlan.config.analysisRequests.largeSample", error["message"])
                self.assertIn("sample_count", error["details"]["fields"])
                self.assertIn("sweep", error["details"]["fields"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_canonical_runs_reject_retired_formal_model_families(self) -> None:
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
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {
                        "config": {
                            "name": "http formal aviation monte carlo",
                            "steps": 2,
                            "projectJson": created["project"],
                            "analysisRequests": {
                                "largeSample": {
                                    "enabled": True,
                                    "samples": 8,
                                    "sweep": {
                                        "failureRates": [0.05, 0.08],
                                        "spareMultipliers": [1.0, 1.25],
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
                    auth_token=auth_token,
                )

                for model_family, run_type in (("aviation_support", "single"), ("aviation_support", "monte_carlo"), ("smoke", "single")):
                    with self.subTest(model_family=model_family, run_type=run_type):
                        error = self._json_error(
                            base_url,
                            "POST",
                            "/runs",
                            {
                                "project_id": saved["project_id"],
                                "experiment_plan_id": plan["experiment_plan_id"],
                                "model_family": model_family,
                                "run_type": run_type,
                                "formal_run": True,
                            },
                            auth_token=auth_token,
                        )
                        self.assertEqual(error["code"], "retired_model_family")
                        self.assertEqual(error["details"]["model_family"], model_family)
                        self.assertEqual(error["details"]["replacement_model_family"], "aircraft_support_v1")
                        self.assertIn(model_family, error["details"]["retired_model_families"])
                        self.assertNotIn("run_id", error)
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
                with opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("text/html", response.headers["content-type"])
                    body = response.read().decode("utf-8")
                self.assertIn("备件规划", body)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_http_server_serves_modeling_import_templates_on_same_origin(self) -> None:
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
                url = f"http://127.0.0.1:{server.server_address[1]}/import-templates/canonical_platform_case.json"
                req = request.Request(url, method="GET")
                opener = request.build_opener(request.ProxyHandler({}))
                with opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn("application/json", response.headers["content-type"])
                    payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(payload["schemaVersion"], "modeling-import-v1")
                self.assertEqual(payload["importId"], "import-carrier-day-night-001")
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
                connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=HTTP_TEST_TIMEOUT_SECONDS)
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
                created = self._create_imported_sample_project(base_url)
                saved = created["savedProject"]
                auth_token = created["authToken"]
                plan = self._json(
                    base_url,
                    "POST",
                    f"/projects/{saved['project_id']}/experiment-plans",
                    {"config": {"name": "persistent http current", "steps": 2}},
                    auth_token=auth_token,
                )
                run = self._json(
                    base_url,
                    "POST",
                    "/runs",
                    {
                        "project_id": saved["project_id"],
                        "experiment_plan_id": plan["experiment_plan_id"],
                        "model_family": "aircraft_support_v1",
                        "run_type": "single",
                    },
                    auth_token=auth_token,
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
                status = self._json(base_url, "GET", f"/runs/{run['run_id']}")
                result = self._json(base_url, "GET", f"/runs/{run['run_id']}/result")
                artifacts = self._json(base_url, "GET", f"/runs/{run['run_id']}/artifacts")
                chain = self._json(base_url, "GET", f"/runs/{run['run_id']}/chain")

                self.assertEqual(stored_project["project_id"], saved["project_id"])
                self.assertEqual(status["run_id"], run["run_id"])
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
                    opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS)
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
                    {"model_family": "aircraft_support_v1"},
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

    def test_http_project_data_templates_route_hides_import_versions(self) -> None:
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
                import_id = quote(import_package["importId"], safe="")
                auth_token = self._login_token(base_url, "data", "data")

                self._json(base_url, "POST", "/modeling-imports", import_package, auth_token=auth_token)
                self._json(base_url, "POST", f"/modeling-imports/{import_id}/publish", auth_token=auth_token)
                templates = self._json(base_url, "GET", "/project-data-templates?state=published", auth_token=auth_token)

                self.assertEqual([template["template_id"] for template in templates["templates"]], [import_package["importId"]])
                self.assertEqual(templates["templates"][0]["template_type"], "project_data")
                self.assertEqual(templates["templates"][0]["source_import_id"], import_package["importId"])
                self.assertNotIn("schema_version", templates["templates"][0])
                self.assertNotIn("version", templates["templates"][0])
                self.assertNotIn("lifecycle_state", templates["templates"][0])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

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
                    {"model_family": "aircraft_support_v1"},
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
                second_created = self._json(
                    base_url,
                    "POST",
                    f"/modeling-imports/{encoded_import_id}/create-project",
                    auth_token=data_token,
                )
                stored_project = self._json(base_url, "GET", f"/projects/{quote(import_package['projectId'], safe='')}")
                second_stored_project = self._json(
                    base_url,
                    "GET",
                    f"/projects/{quote(second_created['savedProject']['project_id'], safe='')}",
                )
                catalog = self._json(base_url, "GET", "/projects")

                self.assertEqual(unauthenticated["code"], "unauthorized")
                self.assertEqual(forbidden["code"], "forbidden")
                self.assertEqual(created["sourceImport"]["import_id"], import_package["importId"])
                self.assertEqual(created["project"]["project_id"], import_package["projectId"])
                self.assertNotIn("equipment", created["project"])
                self.assertEqual(
                    sorted({
                        component["aircraftModel"]
                        for component in created["project"]["components"]
                        if component.get("aircraftModel")
                    }),
                    ["J-15", "J-35"],
                )
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
                self.assertNotEqual(second_created["savedProject"]["project_id"], created["savedProject"]["project_id"])
                self.assertRegex(second_created["savedProject"]["project_id"], rf"^{import_package['projectId']}-copy-[0-9]+$")
                self.assertEqual(second_created["project"]["project_id"], second_created["savedProject"]["project_id"])
                self.assertEqual(second_created["project"]["missionProfile"]["sourceImportId"], import_package["importId"])
                self.assertEqual(second_created["modelingSnapshot"]["project"]["project_id"], second_created["savedProject"]["project_id"])
                self.assertEqual(second_stored_project["project_id"], second_created["savedProject"]["project_id"])
                self.assertTrue({
                    created["savedProject"]["project_id"],
                    second_created["savedProject"]["project_id"],
                }.issubset({entry["project_id"] for entry in catalog["projects"]}))
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
                    "referencedRunIds": ["run-aircraft-support-contract-001"],
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
        created = self._json(
            base_url,
            "POST",
            f"/modeling-imports/{quote(import_package['importId'], safe='')}/create-project",
            auth_token=auth_token,
        )
        created["authToken"] = auth_token
        return created

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
        with opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS) as response:
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
            opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS)
        except Exception as exc:
            response = exc
            if not hasattr(response, "read"):
                raise
            return json.loads(response.read().decode("utf-8"))
        self.fail("request unexpectedly succeeded")

    def _json_error_with_status(
        self,
        base_url: str,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        auth_token: str | None = None,
    ) -> tuple[int, dict]:
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
            opener.open(req, timeout=HTTP_TEST_TIMEOUT_SECONDS)
        except Exception as exc:
            response = exc
            if not hasattr(response, "read") or not hasattr(response, "code"):
                raise
            return response.code, json.loads(response.read().decode("utf-8"))
        self.fail("request unexpectedly succeeded")

    def _raw_json_error_with_status(
        self,
        port: int,
        method: str,
        path: str,
        body: bytes,
        *,
        content_length: int | None = None,
    ) -> tuple[int, dict]:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=HTTP_TEST_TIMEOUT_SECONDS)
        connection.putrequest(method, path)
        connection.putheader("content-type", "application/json")
        connection.putheader("content-length", str(len(body) if content_length is None else content_length))
        connection.endheaders()
        if body:
            connection.send(body)
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, payload


if __name__ == "__main__":
    unittest.main()
