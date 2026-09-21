from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib import error, request

from src.spare_mvp_backend.errors import BackendApiError
from src.spare_mvp_backend.http_server import create_backend_server
from src.spare_mvp_backend.simulation_tasks import EngineRunner, SimulationTaskService


REPO_ROOT = Path(__file__).resolve().parents[1]


class BlockingEngine:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def run(self, payload, progress_callback):
        self.calls += 1
        progress_callback(
            {"processed": 1, "total": 2, "succeeded": 1, "failed": 0, "stage": "running"}
        )
        self.started.set()
        if not self.release.wait(timeout=5):
            raise RuntimeError("test engine release timed out")
        progress_callback(
            {"processed": 2, "total": 2, "succeeded": 2, "failed": 0, "stage": "running"}
        )
        return {"analysis_type": payload["analysis_type"], "status": "available"}


class SimulationTaskServiceTest(unittest.TestCase):
    def test_same_owner_and_active_fingerprint_is_idempotent_while_other_work_is_busy(self) -> None:
        engine = BlockingEngine()
        service = SimulationTaskService(EngineRunner(engine))
        payload = {"kind": "lite_mesa_analysis", "analysis_type": "carry_list", "settings": {"samples": 2}}

        first = service.submit("user-a", payload)
        self.assertTrue(engine.started.wait(timeout=2))
        duplicate = service.submit("user-a", payload)

        self.assertEqual(duplicate["task_id"], first["task_id"])
        self.assertEqual(engine.calls, 1)
        with self.assertRaises(BackendApiError) as busy:
            service.submit("user-b", payload)
        self.assertEqual(busy.exception.code, "simulation_task_busy")
        self.assertNotIn("task_id", busy.exception.details)
        engine.release.set()
        result = service.wait_result("user-a", first["task_id"], timeout_seconds=2)
        self.assertEqual(result["analysis_type"], "carry_list")
        status = service.status("user-a", first["task_id"])
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["processed"], 2)
        self.assertEqual(status["succeeded"], 2)

    def test_foreign_missing_and_expired_tasks_share_not_found_error(self) -> None:
        engine = BlockingEngine()
        now = [datetime(2026, 9, 22, tzinfo=timezone.utc)]
        service = SimulationTaskService(
            EngineRunner(engine),
            terminal_retention_seconds=60,
            clock=lambda: now[0],
        )
        submitted = service.submit("user-a", {"analysis_type": "spare_shortfall"})
        self.assertTrue(engine.started.wait(timeout=2))

        with self.assertRaises(BackendApiError) as foreign:
            service.status("user-b", submitted["task_id"])
        self.assertEqual(foreign.exception.code, "simulation_task_not_found")
        engine.release.set()
        service.wait_result("user-a", submitted["task_id"], timeout_seconds=2)
        now[0] += timedelta(seconds=61)
        with self.assertRaises(BackendApiError) as expired:
            service.status("user-a", submitted["task_id"])
        self.assertEqual(expired.exception.code, "simulation_task_not_found")

    def test_engine_error_is_retained_as_failed_terminal_result(self) -> None:
        class FailingEngine:
            def run(self, _payload, _progress_callback):
                raise BackendApiError("bad_analysis_request", "invalid analysis input", field="analysis_type")

        service = SimulationTaskService(EngineRunner(FailingEngine()))
        submitted = service.submit("user-a", {"analysis_type": "invalid"})
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            status = service.status("user-a", submitted["task_id"])
            if status["status"] == "failed":
                break
            time.sleep(0.01)

        self.assertEqual(status["status"], "failed")
        result = service.result("user-a", submitted["task_id"])
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["result"])
        self.assertEqual(result["error"]["code"], "bad_analysis_request")
        self.assertEqual(result["error"]["details"]["field"], "analysis_type")

    def test_semantically_equivalent_aliases_and_defaults_share_active_task(self) -> None:
        engine = BlockingEngine()
        service = SimulationTaskService(EngineRunner(engine))
        project = {"project_id": "project-alias"}
        first = service.submit(
            "user-a",
            {"analysisType": "carry_list", "projectJson": project, "settings": {"samples": 2, "topN": 7}},
        )
        self.assertTrue(engine.started.wait(timeout=2))

        duplicate = service.submit(
            "user-a",
            {
                "kind": "lite_mesa_analysis",
                "analysis_type": "carry_list",
                "project": project,
                "settings": {"samples": 2, "topN": 7},
                "model_family": "aircraft_support_v1",
            },
        )

        self.assertEqual(duplicate["task_id"], first["task_id"])
        self.assertEqual(engine.calls, 1)
        engine.release.set()
        service.wait_result("user-a", first["task_id"], timeout_seconds=2)

    def test_invalid_or_regressing_progress_is_ignored_and_terminal_stage_is_owned_by_service(self) -> None:
        class InvalidProgressEngine:
            def __init__(self):
                self.reported = threading.Event()
                self.release = threading.Event()

            def run(self, _payload, progress_callback):
                progress_callback({"processed": 1, "total": 3, "succeeded": 1, "failed": 0})
                progress_callback({"processed": -1, "total": 3, "succeeded": 0, "failed": 0})
                progress_callback({"processed": 0, "total": 2, "succeeded": 0, "failed": 0})
                progress_callback({"processed": 3, "total": 3, "succeeded": 1, "failed": 1})
                progress_callback(
                    {"processed": 1, "total": 3, "succeeded": 1, "failed": 0, "stage": "completed"}
                )
                self.reported.set()
                self.release.wait(timeout=2)
                return {"status": "available"}

        engine = InvalidProgressEngine()
        service = SimulationTaskService(EngineRunner(engine))
        submitted = service.submit("user-a", {"analysis_type": "carry_list", "settings": {"samples": 3}})
        self.assertTrue(engine.reported.wait(timeout=2))

        status = service.status("user-a", submitted["task_id"])
        self.assertEqual(status["stage"], "running")
        self.assertEqual(status["processed"], 1)
        self.assertEqual(status["total"], 3)
        self.assertEqual(status["succeeded"], 1)
        self.assertEqual(status["failed"], 0)
        engine.release.set()
        service.wait_result("user-a", submitted["task_id"], timeout_seconds=2)

    def test_unexpected_exception_is_logged_but_client_error_is_generic(self) -> None:
        class LeakingEngine:
            def run(self, _payload, _progress_callback):
                raise RuntimeError("secret filesystem path /private/model.db")

        service = SimulationTaskService(EngineRunner(LeakingEngine()))
        with self.assertLogs("src.spare_mvp_backend.simulation_tasks", level="ERROR") as captured:
            submitted = service.submit("user-a", {"analysis_type": "carry_list"})
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                status = service.status("user-a", submitted["task_id"])
                if status["status"] == "failed":
                    break
                time.sleep(0.01)
            result = service.result("user-a", submitted["task_id"])

        self.assertIn("secret filesystem path", "\n".join(captured.output))
        self.assertEqual(result["error"]["code"], "simulation_task_failed")
        self.assertEqual(result["error"]["message"], "仿真任务执行失败。")
        self.assertNotIn("secret", json.dumps(result, ensure_ascii=False))

    def test_blocked_engine_result_is_failed_but_remains_queryable_and_legacy_compatible(self) -> None:
        blocked_payload = {
            "status": "blocked",
            "message": "当前 Project 无法编译。",
            "issues": [{"code": "missing_task"}],
        }

        class BlockedEngine:
            def run(self, _payload, _progress_callback):
                return blocked_payload

        service = SimulationTaskService(EngineRunner(BlockedEngine()))
        submitted = service.submit("user-a", {"analysis_type": "carry_list"})
        legacy_result = service.wait_result("user-a", submitted["task_id"], timeout_seconds=2)
        task_result = service.result("user-a", submitted["task_id"])

        self.assertEqual(legacy_result, blocked_payload)
        self.assertEqual(task_result["status"], "failed")
        self.assertEqual(task_result["result"], blocked_payload)
        self.assertEqual(task_result["error"]["code"], "simulation_task_blocked")
        self.assertEqual(task_result["error"]["message"], blocked_payload["message"])


class SimulationTaskHttpTest(unittest.TestCase):
    def test_task_routes_require_auth_and_return_status_and_wrapped_result(self) -> None:
        engine = BlockingEngine()
        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
                simulation_engine=engine,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                unauthenticated_status, unauthenticated = self._json_error(
                    base_url, "POST", "/simulation-tasks", {"analysis_type": "carry_list"}
                )
                self.assertEqual(unauthenticated_status, 401)
                self.assertEqual(unauthenticated["code"], "unauthorized")
                token = self._json(
                    base_url,
                    "POST",
                    "/auth/login",
                    {"username": "data", "password": "data"},
                )["session"]["token"]
                other_token = self._json(
                    base_url,
                    "POST",
                    "/auth/login",
                    {"username": "user", "password": "user"},
                )["session"]["token"]
                submitted = self._json(
                    base_url,
                    "POST",
                    "/simulation-tasks",
                    {
                        "kind": "lite_mesa_analysis",
                        "analysis_type": "carry_list",
                        "settings": {"samples": 2},
                    },
                    token=token,
                )
                self.assertEqual(submitted["status"], "running")
                self.assertTrue(engine.started.wait(timeout=2))
                foreign_status, foreign_error = self._json_error(
                    base_url,
                    "GET",
                    f"/simulation-tasks/{submitted['task_id']}",
                    token=other_token,
                )
                self.assertEqual(foreign_status, 404)
                self.assertEqual(foreign_error["code"], "simulation_task_not_found")
                busy_status, busy_error = self._json_error(
                    base_url,
                    "POST",
                    "/simulation-tasks",
                    {"analysis_type": "mission_reliability", "settings": {"samples": 3}},
                    token=other_token,
                )
                self.assertEqual(busy_status, 409)
                self.assertEqual(busy_error["code"], "simulation_task_busy")
                self.assertNotIn("task_id", busy_error["details"])
                status = self._json(
                    base_url, "GET", f"/simulation-tasks/{submitted['task_id']}", token=token
                )
                self.assertEqual(status["processed"], 1)
                running_status, running_error = self._json_error(
                    base_url,
                    "GET",
                    f"/simulation-tasks/{submitted['task_id']}/result",
                    token=token,
                )
                self.assertEqual(running_status, 409)
                self.assertEqual(running_error["code"], "simulation_task_not_completed")
                engine.release.set()
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    status = self._json(
                        base_url, "GET", f"/simulation-tasks/{submitted['task_id']}", token=token
                    )
                    if status["status"] == "completed":
                        break
                    time.sleep(0.01)
                result = self._json(
                    base_url,
                    "GET",
                    f"/simulation-tasks/{submitted['task_id']}/result",
                    token=token,
                )
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["result"]["analysis_type"], "carry_list")
            finally:
                engine.release.set()
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_blocked_result_stays_http_200_for_legacy_and_failed_for_task_api(self) -> None:
        class BlockedEngine:
            def run(self, _payload, _progress_callback):
                return {"status": "blocked", "message": "当前 Project 无法编译。", "issues": []}

        with tempfile.TemporaryDirectory() as tmp:
            server = create_backend_server(
                ("127.0.0.1", 0),
                repo_root=REPO_ROOT,
                database_path=":memory:",
                output_dir=Path(tmp) / "artifacts",
                simulation_engine=BlockedEngine(),
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f"http://127.0.0.1:{server.server_address[1]}/api"
                token = self._json(
                    base_url,
                    "POST",
                    "/auth/login",
                    {"username": "data", "password": "data"},
                )["session"]["token"]
                legacy = self._json(
                    base_url,
                    "POST",
                    "/mesa-analysis-runs",
                    {"analysis_type": "carry_list"},
                    token=token,
                )
                self.assertEqual(legacy["status"], "blocked")

                submitted = self._json(
                    base_url,
                    "POST",
                    "/simulation-tasks",
                    {"analysis_type": "carry_list"},
                    token=token,
                )
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    status = self._json(
                        base_url, "GET", f"/simulation-tasks/{submitted['task_id']}", token=token
                    )
                    if status["status"] == "failed":
                        break
                    time.sleep(0.01)
                result = self._json(
                    base_url,
                    "GET",
                    f"/simulation-tasks/{submitted['task_id']}/result",
                    token=token,
                )
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["result"]["status"], "blocked")
                self.assertEqual(result["error"]["code"], "simulation_task_blocked")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def _json(self, base_url, method, path, payload=None, *, token=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"content-type": "application/json"}
        if token:
            headers["authorization"] = f"Bearer {token}"
        req = request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
        with request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _json_error(self, base_url, method, path, payload=None, *, token=None):
        try:
            self._json(base_url, method, path, payload, token=token)
        except error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))
        self.fail("request unexpectedly succeeded")


if __name__ == "__main__":
    unittest.main()
