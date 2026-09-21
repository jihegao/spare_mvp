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
        self.started.set()
        progress_callback(
            {"processed": 1, "total": 2, "succeeded": 1, "failed": 0, "stage": "running"}
        )
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
