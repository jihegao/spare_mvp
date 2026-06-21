from __future__ import annotations

import copy
import hashlib
import http.client
import json
import sqlite3
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.http_server import create_backend_server
from src.spare_mvp_backend.modeling_import import modeling_import_to_project
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_backend.run_service import RunService, RunServiceError
from src.spare_mvp_contract.adapter import AdapterError, SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]
M7_MONTE_CARLO_ARTIFACT_KINDS = {
    "run_config",
    "input_project",
    "compiled_scenario",
    "sample_results",
    "aggregate_result",
    "result_summary",
    "metrics",
    "report",
    "log",
    "monte_carlo_base",
    "analysis_projection_spare_shortfall",
    "analysis_projection_carry_list",
    "analysis_projection_mission_reliability",
    "analysis_projection_downtime_factors",
    "visualization_state_series",
}


class RecordingAdapter(SimulationAdapter):
    def __init__(self) -> None:
        super().__init__(REPO_ROOT)
        self.compile_calls: list[tuple[dict, str]] = []
        self.run_calls: list[tuple[dict, int]] = []
        self.monte_carlo_run_calls: list[dict] = []

    def compile_scenario(self, project: dict, model_family: str = "smoke") -> dict:
        self.compile_calls.append((copy.deepcopy(project), model_family))
        return super().compile_scenario(project, model_family=model_family)

    def compile_scenario_with_gate(self, project: dict, model_family: str = "smoke") -> dict:
        self.compile_calls.append((copy.deepcopy(project), model_family))
        return super().compile_scenario_with_gate(project, model_family=model_family)

    def run_scenario(
        self,
        scenario: dict,
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict]:
        self.run_calls.append((copy.deepcopy(scenario), steps, run_id))
        return super().run_scenario(scenario, output_dir=output_dir, steps=steps, run_id=run_id)

    def run_monte_carlo_scenario(
        self,
        scenario: dict,
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
        **kwargs,
    ) -> dict[str, dict]:
        self.monte_carlo_run_calls.append(
            {
                "scenario": copy.deepcopy(scenario),
                "steps": steps,
                "run_id": run_id,
                "kwargs": copy.deepcopy(kwargs),
            }
        )
        return super().run_monte_carlo_scenario(
            scenario,
            output_dir=output_dir,
            steps=steps,
            run_id=run_id,
            **kwargs,
        )


class FailingRunAdapter(RecordingAdapter):
    def run_scenario(
        self,
        scenario: dict,
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict]:
        self.run_calls.append((copy.deepcopy(scenario), steps, run_id))
        raise AdapterError("executor_failed", "synthetic executor failure", run_id=run_id)


class BackendApiContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = sqlite3.connect(":memory:")
        initialize_database(self.connection)
        self.repository = ContractRepository(self.connection)
        self.adapter = RecordingAdapter()
        self.tempdir = tempfile.TemporaryDirectory()
        self.api = BackendApi(self.repository, self.adapter, output_dir=Path(self.tempdir.name))

    def tearDown(self) -> None:
        self.connection.close()
        self.tempdir.cleanup()

    def _fixture(self, name: str) -> dict:
        return json.loads((REPO_ROOT / "tests" / "fixtures" / name).read_text(encoding="utf-8"))

    def _run_side_effect_counts(self) -> dict[str, int]:
        return {
            table: self.connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("scenarios", "simulation_runs", "result_summaries", "artifact_manifests")
        } | {
            "artifact_files": len([path for path in Path(self.tempdir.name).glob("**/*") if path.is_file()])
        }

    def _artifact_by_kind(self, manifest: dict, kind: str) -> dict:
        return next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == kind)

    def _state_series_artifact(self, run_id: str) -> dict:
        return self._artifact_by_kind(self.api.get_run_artifacts(run_id), "visualization_state_series")

    def _submit_successful_smoke_run(self) -> dict[str, Any]:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m7 artifact download", "steps": 2})
        return self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )

    def test_smoke_backend_flow_persists_complete_run_chain(self) -> None:
        project = self._fixture("smoke_project.json")

        validation = self.api.validate_project(project)
        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "contract smoke", "steps": 4})
        run = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")

        self.assertTrue(validation["ok"])
        self.assertEqual(saved["project_id"], "project-smoke-contract-001")
        self.assertEqual(snapshot["project_id"], saved["project_id"])
        self.assertEqual(snapshot["project_version"], "project-v0.1")
        self.assertEqual(plan["project_id"], saved["project_id"])
        self.assertEqual(plan["config"]["steps"], 4)
        self.assertRegex(run["run_id"], r"^run-scenario-smoke-contract-demo-[0-9a-f]{12}-\d{4}$")
        self.assertEqual(run["project_id"], "project-smoke-contract-001")
        self.assertRegex(run["scenario_id"], r"^scenario-smoke-contract-demo-[0-9a-f]{12}-\d{4}$")
        self.assertEqual(run["result_summary_id"], f"result-{run['run_id']}")
        self.assertEqual(run["artifact_manifest_id"], f"artifact-manifest-{run['run_id']}")
        self.assertEqual(run["status"], "succeeded")

        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0], (project, "smoke"))
        self.assertEqual(len(self.adapter.run_calls), 1)
        self.assertEqual(self.adapter.run_calls[0][0]["scenario_id"], run["scenario_id"])
        self.assertEqual(self.adapter.run_calls[0][1], 4)
        self.assertEqual(self.adapter.run_calls[0][2], run["run_id"])

        stored_run = self.api.get_run(run["run_id"])
        result = self.api.get_run_result(run["run_id"])
        manifest = self.api.get_run_artifacts(run["run_id"])
        chain = self.api.get_run_chain(run["run_id"])

        self.assertEqual(stored_run["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(stored_run["status"], "succeeded")
        self.assertEqual(result["result_id"], run["result_summary_id"])
        self.assertEqual(result["run_id"], run["run_id"])
        self.assertIn("mission_success_rate", result["metrics"])
        self.assertEqual(manifest["artifact_manifest_id"], run["artifact_manifest_id"])
        self.assertEqual(manifest["run_id"], run["run_id"])
        self.assertEqual(chain["project_id"], run["project_id"])
        self.assertEqual(chain["modeling_snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(chain["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(chain["scenario_id"], run["scenario_id"])
        self.assertEqual(chain["run_id"], run["run_id"])
        self.assertEqual(chain["result_summary_id"], run["result_summary_id"])
        self.assertEqual(chain["artifact_manifest_id"], run["artifact_manifest_id"])

    def test_run_service_submits_smoke_run_and_returns_status_envelope(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m6 status", "steps": 2})

        service = RunService(self.repository, self.adapter, self.api.output_dir)
        submitted = service.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )
        status = service.get_run_status(submitted["run_id"])

        self.assertEqual(submitted["status"], "succeeded")
        self.assertEqual(submitted["phase"], "completed")
        self.assertEqual(submitted["progress"], 1)
        self.assertEqual(submitted["run_type"], "single")
        self.assertEqual(submitted["model_family"], "smoke")
        self.assertEqual(status["run_id"], submitted["run_id"])
        self.assertEqual(status["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(status["modeling_snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(status["result_summary_id"], submitted["result_summary_id"])
        self.assertEqual(status["artifact_manifest_id"], submitted["artifact_manifest_id"])
        self.assertEqual(self.adapter.run_calls[0][1], 2)

    def test_run_service_augments_run_config_artifact_with_plan_and_snapshot_identity(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m7 run config", "steps": 2})

        submitted = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )
        manifest = self.api.get_run_artifacts(submitted["run_id"])
        run_config_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "run_config")
        payload = json.loads((Path(self.api.output_dir) / run_config_artifact["path"]).read_text(encoding="utf-8"))

        self.assertEqual(payload["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(payload["modeling_snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(payload["project_id"], saved["project_id"])
        self.assertEqual(payload["run_id"], submitted["run_id"])

    def test_run_service_keeps_disk_artifact_manifest_in_sync_after_run_config_augmentation(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "m7 manifest sync", "steps": 2})

        submitted = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )
        repository_manifest = self.api.get_run_artifacts(submitted["run_id"])
        disk_manifest_path = Path(self.api.output_dir) / submitted["run_id"] / "artifact-manifest.json"
        disk_manifest = json.loads(disk_manifest_path.read_text(encoding="utf-8"))
        repository_run_config = self._artifact_by_kind(repository_manifest, "run_config")
        disk_run_config = self._artifact_by_kind(disk_manifest, "run_config")

        for key in ("sha256", "size_bytes", "path", "artifact_id"):
            self.assertEqual(disk_run_config[key], repository_run_config[key])
        for artifact in repository_manifest["artifacts"]:
            artifact_path = Path(self.api.output_dir) / artifact["path"]
            data = artifact_path.read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), artifact["sha256"], artifact)
            self.assertEqual(len(data), artifact["size_bytes"], artifact)

    def test_backend_api_lists_runs_with_strict_include_deleted_flag_and_limit_clamp(self) -> None:
        runs = [self._submit_successful_smoke_run() for _ in range(3)]
        self.api.soft_delete_run(runs[0]["run_id"], actor_user_id="user-admin")

        hidden = self.api.list_runs({"include_deleted": "0", "limit": "500"})
        visible = self.api.list_runs({"include_deleted": "1", "limit": "500"})
        truthy_true = self.api.list_runs({"include_deleted": "True"})
        truthy_lower = self.api.list_runs({"include_deleted": "true"})
        truthy_bool = self.api.list_runs({"include_deleted": True})
        false_string = self.api.list_runs({"include_deleted": "yes"})
        limited = self.api.list_runs({"include_deleted": "1", "limit": "2"})

        self.assertNotIn(runs[0]["run_id"], [item["run_id"] for item in hidden["runs"]])
        self.assertNotIn(runs[0]["run_id"], [item["run_id"] for item in false_string["runs"]])
        self.assertIn(runs[0]["run_id"], [item["run_id"] for item in visible["runs"]])
        self.assertIn(runs[0]["run_id"], [item["run_id"] for item in truthy_true["runs"]])
        self.assertIn(runs[0]["run_id"], [item["run_id"] for item in truthy_lower["runs"]])
        self.assertIn(runs[0]["run_id"], [item["run_id"] for item in truthy_bool["runs"]])
        self.assertEqual(len(limited["runs"]), 2)

    def test_backend_api_resolves_artifact_download_with_hash_verification(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        artifact = manifest["artifacts"][0]

        download = self.api.get_run_artifact_download(
            run["run_id"],
            artifact["artifact_id"],
            actor_user_id="user-admin",
        )

        self.assertEqual(download["artifact"]["artifact_id"], artifact["artifact_id"])
        self.assertTrue(download["path"].is_file())
        self.assertEqual(download["content_type"], artifact["media_type"])
        self.assertEqual(hashlib.sha256(download["body"]).hexdigest(), artifact["sha256"])
        audit = self.repository.list_audit_events(resource_id=run["run_id"])
        self.assertEqual([event["action"] for event in audit], ["runs.artifact.download"])
        self.assertEqual(audit[0]["actor_user_id"], "user-admin")

    def test_successful_smoke_runs_publish_downloadable_visualization_state_series(self) -> None:
        project = self._fixture("smoke_project.json")
        branch_project = copy.deepcopy(project)
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        single_plan = self.api.create_experiment_plan(
            saved["project_id"],
            {"name": "m9 single state series", "steps": 2},
        )
        monte_carlo_plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "m9 mc state series",
                "steps": 2,
                "projectJson": branch_project,
                "analysisRequests": {
                    "largeSample": {
                        "enabled": True,
                        "samples": 3,
                        "sweep": {
                            "failureRates": [0.05],
                            "spareMultipliers": [1.0],
                            "supportCapacities": [2],
                        },
                    }
                },
            },
        )
        submitted_runs = [
            self.api.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": single_plan["experiment_plan_id"],
                    "model_family": "smoke",
                    "run_type": "single",
                }
            ),
            self.api.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": monte_carlo_plan["experiment_plan_id"],
                    "model_family": "smoke",
                    "run_type": "monte_carlo",
                }
            ),
        ]

        for submitted in submitted_runs:
            with self.subTest(run_type=submitted["run_type"]):
                manifest = self.api.get_run_artifacts(submitted["run_id"])
                state_series_artifact = self._artifact_by_kind(manifest, "visualization_state_series")
                payload_path = Path(self.api.output_dir) / state_series_artifact["path"]
                payload_data = payload_path.read_bytes()
                payload = json.loads(payload_data.decode("utf-8"))
                download = self.api.get_run_artifact_download(
                    submitted["run_id"],
                    state_series_artifact["artifact_id"],
                    actor_user_id="user-admin",
                )

                self.assertEqual(state_series_artifact["schema_version"], "visualization-state-series-v0")
                self.assertEqual(state_series_artifact["media_type"], "application/json")
                self.assertEqual(state_series_artifact["source_run_id"], submitted["run_id"])
                self.assertEqual(state_series_artifact["source_result_summary_id"], submitted["result_summary_id"])
                self.assertEqual(state_series_artifact["source_scenario_id"], submitted["scenario_id"])
                self.assertEqual(hashlib.sha256(payload_data).hexdigest(), state_series_artifact["sha256"])
                self.assertEqual(len(payload_data), state_series_artifact["size_bytes"])
                self.assertEqual(download["body"], payload_data)
                self.assertEqual(payload["schema_version"], "visualization-state-series-v0")
                self.assertEqual(payload["run_id"], submitted["run_id"])
                self.assertEqual(payload["scenario_id"], submitted["scenario_id"])
                self.assertEqual(payload["scenario_version"], manifest["scenario_version"])
                self.assertEqual(payload["model_family"], "smoke")
                self.assertEqual(payload["artifact_manifest_id"], submitted["artifact_manifest_id"])
                self.assertEqual(payload["result_summary_id"], submitted["result_summary_id"])
                self.assertEqual(payload["run_config_artifact_id"], f"run_config-{submitted['run_id']}")
                self.assertEqual(payload["input_project_artifact_id"], f"input_project-{submitted['run_id']}")
                self.assertEqual(payload["compiled_scenario_artifact_id"], f"compiled_scenario-{submitted['run_id']}")
                self.assertGreater(len(payload["frames"]), 0)
                frame_steps = [frame["step"] for frame in payload["frames"]]
                self.assertEqual(frame_steps, sorted(frame_steps))
                self.assertEqual(len(frame_steps), len(set(frame_steps)))
                for frame in payload["frames"]:
                    self.assertEqual(frame["run_id"], submitted["run_id"])
                    self.assertEqual(frame["trace"]["run_id"], submitted["run_id"])
                    self.assertEqual(frame["trace"]["scenario_id"], submitted["scenario_id"])
                    self.assertEqual(frame["trace"]["result_summary_id"], submitted["result_summary_id"])
                    self.assertEqual(frame["trace"]["artifact_manifest_id"], submitted["artifact_manifest_id"])
                    self.assertIsInstance(frame["step"], int)
                    self.assertIsInstance(frame["aircraft_state"], dict)
                    self.assertIsInstance(frame["mission_state"], dict)
                    self.assertIsInstance(frame["resource_state"], dict)
                    self.assertIsInstance(frame["event_summary"], dict)
                    self.assertIsInstance(frame["aircraft"], list)
                    self.assertIsInstance(frame["missions"], list)
                    self.assertIsInstance(frame["resources"], list)
                    self.assertIsInstance(frame["events"], list)
                    self.assertGreater(len(frame["aircraft"]), 0)
                    self.assertGreater(len(frame["missions"]), 0)
                    self.assertGreater(len(frame["resources"]), 0)
                    self.assertGreater(len(frame["events"]), 0)
                    for event in frame["events"]:
                        self.assertTrue(event["event_id"])
                        self.assertEqual(event["run_id"], submitted["run_id"])
                        self.assertEqual(event["step"], frame["step"])
                        self.assertIsInstance(event["metric_refs"], list)
                    if submitted["run_type"] == "monte_carlo":
                        self.assertIsInstance(frame["sample_index"], int)
                        self.assertIsInstance(frame["sample_step"], int)

    def test_m9_2_subscribe_run_state_stream_reuses_visualization_state_series(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]
        artifact = self._state_series_artifact(run_id)
        payload = json.loads((Path(self.api.output_dir) / artifact["path"]).read_text(encoding="utf-8"))

        envelope = self.api.subscribe_run_state_stream(run_id)

        self.assertEqual(envelope["stream_id"], f"state-stream-{run_id}")
        self.assertEqual(envelope["run_id"], run_id)
        self.assertEqual(envelope["status"]["run_id"], run_id)
        self.assertEqual(envelope["status"]["status"], "succeeded")
        self.assertEqual(envelope["artifact_id"], artifact["artifact_id"])
        event_types = [event["event_type"] for event in envelope["events"]]
        self.assertEqual(event_types, ["run_status", *["state_frame"] * len(payload["frames"]), "artifact_ready"])
        self.assertEqual(envelope["events"][0]["payload"], envelope["status"])
        for index, event in enumerate(envelope["events"][1:-1]):
            source_frame = payload["frames"][index]
            self.assertEqual(event["event_type"], "state_frame")
            self.assertEqual(
                event["payload"],
                {
                    "schema_version": "visualization-state-frame-v0",
                    "stream_id": f"state-stream-{run_id}",
                    "run_id": run_id,
                    "artifact_id": artifact["artifact_id"],
                    "scenario_id": payload["scenario_id"],
                    "scenario_version": payload["scenario_version"],
                    "model_family": payload["model_family"],
                    "artifact_manifest_id": payload["artifact_manifest_id"],
                    "result_summary_id": payload["result_summary_id"],
                    "run_config_artifact_id": payload["run_config_artifact_id"],
                    "input_project_artifact_id": payload["input_project_artifact_id"],
                    "compiled_scenario_artifact_id": payload["compiled_scenario_artifact_id"],
                    "step": source_frame["step"],
                    "frame_index": index,
                    "frame_count": len(payload["frames"]),
                    "frame": source_frame,
                },
            )
        self.assertEqual(envelope["events"][-1]["event_type"], "artifact_ready")
        self.assertEqual(envelope["events"][-1]["payload"]["run_id"], run_id)
        self.assertEqual(envelope["events"][-1]["payload"]["artifact_id"], artifact["artifact_id"])
        self.assertEqual(envelope["events"][-1]["payload"]["kind"], "visualization_state_series")

        with self.assertRaises(KeyError):
            self.api.subscribe_run_state_stream("run-missing")

    def test_m9_3_run_control_cancel_is_backend_confirmed_and_audited(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]

        controlled = self.api.control_run(run_id, "cancel", actor_user_id="user-admin")

        self.assertEqual(controlled["run_id"], run_id)
        self.assertEqual(controlled["status"], "cancelled")
        self.assertEqual(controlled["phase"], "cancelled")
        self.assertEqual(controlled["progress"], 1)
        self.assertTrue(controlled["cancelled_at"])
        self.assertEqual(controlled["cancelled_by"], "user-admin")
        self.assertEqual(controlled["control"]["action"], "cancel")
        self.assertEqual(controlled["control"]["outcome"], "allowed")
        self.assertEqual(controlled["control"]["actor_user_id"], "user-admin")
        self.assertTrue(controlled["control"]["controlled_at"])

        stored = self.api.get_run(run_id)
        self.assertEqual(stored["status"], "cancelled")
        self.assertEqual(stored["cancelled_by"], "user-admin")
        events = self.repository.list_audit_events(resource_id=run_id)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["action"], "runs.control.cancel")
        self.assertEqual(events[0]["outcome"], "allowed")
        self.assertEqual(events[0]["actor_user_id"], "user-admin")
        self.assertEqual(events[0]["details"]["status"], "cancelled")

    def test_m9_3_unsupported_run_control_fails_closed_and_audits_denial(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]
        before = self.api.get_run(run_id)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.control_run(run_id, "pause", actor_user_id="user-admin")

        self.assertEqual(ctx.exception.code, "unsupported_run_control")
        self.assertEqual(self.api.get_run(run_id), before)
        events = self.repository.list_audit_events(resource_id=run_id)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["action"], "runs.control.pause")
        self.assertEqual(events[0]["outcome"], "denied")
        self.assertEqual(events[0]["actor_user_id"], "user-admin")
        self.assertEqual(events[0]["details"]["reason"], "unsupported_run_control")

        deleted = self.api.soft_delete_run(run_id, actor_user_id="user-admin")
        self.assertEqual(deleted["lifecycle_status"], "deleted")
        with self.assertRaises(BackendApiError) as deleted_ctx:
            self.api.control_run(run_id, "cancel", actor_user_id="user-admin")
        self.assertEqual(deleted_ctx.exception.code, "run_deleted")
        deleted_events = self.repository.list_audit_events(resource_id=run_id)
        self.assertEqual(deleted_events[-1]["action"], "runs.control.cancel")
        self.assertEqual(deleted_events[-1]["outcome"], "denied")
        self.assertEqual(deleted_events[-1]["details"]["reason"], "run_deleted")

    def test_m9_3_retry_blocks_stale_official_result_and_artifact_reads(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]
        self.assertEqual(self.api.get_run_result(run_id)["run_id"], run_id)
        self.assertEqual(self.api.get_run_artifacts(run_id)["run_id"], run_id)

        self.api.control_run(run_id, "cancel", actor_user_id="user-admin")
        retried = self.api.control_run(run_id, "retry", actor_user_id="user-admin")

        self.assertEqual(retried["status"], "queued")
        self.assertEqual(retried["phase"], "queued")
        self.assertEqual(retried["progress"], 0)
        self.assertIsNone(retried["result_summary_id"])
        self.assertIsNone(retried["artifact_manifest_id"])
        with self.assertRaises(KeyError):
            self.api.get_run_result(run_id)
        with self.assertRaises(KeyError):
            self.api.get_run_artifacts(run_id)

    def test_m9_3_retry_keeps_run_detail_refreshable_with_pending_manifest(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]

        self.api.control_run(run_id, "cancel", actor_user_id="user-admin")
        self.api.control_run(run_id, "retry", actor_user_id="user-admin")
        detail = self.api.get_run_detail(run_id)

        self.assertEqual(detail["run"]["status"], "queued")
        self.assertEqual(detail["run"]["phase"], "queued")
        self.assertIsNone(detail["result_summary"])
        self.assertEqual(detail["artifact_manifest"]["run_id"], run_id)
        self.assertEqual(
            detail["artifact_manifest"]["artifact_manifest_id"],
            f"artifact-manifest-{run_id}-retry-pending",
        )
        self.assertEqual(detail["artifact_manifest"]["status"], "pending")
        self.assertEqual(detail["artifact_manifest"]["artifacts"], [])
        self.assertEqual(detail["chain"]["artifact_manifest_id"], detail["artifact_manifest"]["artifact_manifest_id"])
        self.assertEqual(detail["download_base"], f"/api/runs/{run_id}/artifacts")

    def test_m9_3_cancel_after_retry_keeps_detail_refreshable_without_stale_outputs(self) -> None:
        submitted = self._submit_successful_smoke_run()
        run_id = submitted["run_id"]

        first_cancel = self.api.control_run(run_id, "cancel", actor_user_id="user-data")
        retried = self.api.control_run(run_id, "retry", actor_user_id="user-admin")
        self.assertIsNone(retried.get("cancelled_at"))
        self.assertIsNone(retried.get("cancelled_by"))
        second_cancel = self.api.control_run(run_id, "cancel", actor_user_id="user-admin")
        detail = self.api.get_run_detail(run_id)

        self.assertEqual(detail["run"]["status"], "cancelled")
        self.assertEqual(detail["run"]["phase"], "cancelled")
        self.assertTrue(first_cancel["cancelled_at"])
        self.assertTrue(second_cancel["cancelled_at"])
        self.assertEqual(second_cancel["cancelled_by"], "user-admin")
        self.assertEqual(detail["run"]["cancelled_at"], second_cancel["cancelled_at"])
        self.assertEqual(detail["run"]["cancelled_by"], "user-admin")
        self.assertIsNone(detail["run"]["result_summary_id"])
        self.assertIsNone(detail["run"]["artifact_manifest_id"])
        self.assertIsNone(detail["result_summary"])
        self.assertEqual(detail["artifact_manifest"]["run_id"], run_id)
        self.assertEqual(
            detail["artifact_manifest"]["artifact_manifest_id"],
            f"artifact-manifest-{run_id}-retry-pending",
        )
        self.assertEqual(detail["artifact_manifest"]["status"], "pending")
        self.assertEqual(detail["artifact_manifest"]["artifacts"], [])
        self.assertEqual(detail["chain"]["artifact_manifest_id"], detail["artifact_manifest"]["artifact_manifest_id"])
        with self.assertRaises(KeyError):
            self.api.get_run_result(run_id)
        with self.assertRaises(KeyError):
            self.api.get_run_artifacts(run_id)

    def test_m9_2_subscribe_run_state_stream_fails_closed_for_invalid_state_series(self) -> None:
        cases = (
            (
                "deleted",
                lambda run_id, manifest, artifact: self.api.soft_delete_run(run_id, actor_user_id="user-admin"),
                "run_deleted",
            ),
            (
                "missing",
                lambda run_id, manifest, artifact: (
                    manifest["artifacts"].remove(artifact),
                    self.repository.upsert_artifact_manifest(manifest),
                ),
                "visualization_state_series_missing",
            ),
            (
                "path_escape",
                lambda run_id, manifest, artifact: (
                    artifact.update({"path": "../escape.json"}),
                    self.repository.upsert_artifact_manifest(manifest),
                ),
                "artifact_path_escape",
            ),
            (
                "run_mismatch",
                self._write_mismatched_state_series_payload,
                "visualization_state_series_run_mismatch",
            ),
            (
                "malformed_json",
                lambda run_id, manifest, artifact: (
                    (Path(self.api.output_dir) / artifact["path"]).write_text("{", encoding="utf-8")
                ),
                "visualization_state_series_invalid",
            ),
            (
                "missing_frame_trace",
                self._remove_state_series_frame_trace,
                "visualization_state_series_invalid",
            ),
        )
        for label, mutate, expected_code in cases:
            with self.subTest(label):
                submitted = self._submit_successful_smoke_run()
                run_id = submitted["run_id"]
                manifest = self.api.get_run_artifacts(run_id)
                artifact = self._artifact_by_kind(manifest, "visualization_state_series")
                mutate(run_id, manifest, artifact)

                with self.assertRaises(BackendApiError) as ctx:
                    self.api.subscribe_run_state_stream(run_id)

                self.assertEqual(ctx.exception.code, expected_code)

    def _write_mismatched_state_series_payload(self, run_id: str, manifest: dict, artifact: dict) -> None:
        target = Path(self.api.output_dir) / artifact["path"]
        payload = json.loads(target.read_text(encoding="utf-8"))
        payload["run_id"] = f"{run_id}-other"
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def _remove_state_series_frame_trace(self, run_id: str, manifest: dict, artifact: dict) -> None:
        target = Path(self.api.output_dir) / artifact["path"]
        payload = json.loads(target.read_text(encoding="utf-8"))
        del payload["frames"][0]["trace"]
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def test_m9_2_http_state_stream_returns_sse_for_bearer_and_access_token_auth(self) -> None:
        server, thread, run_id, token = self._start_state_stream_server()
        try:
            for label, path, headers in (
                (
                    "bearer",
                    f"/api/runs/{run_id}/state-stream",
                    {"Authorization": f"Bearer {token}"},
                ),
                (
                    "access_token",
                    f"/api/runs/{run_id}/state-stream?access_token={token}",
                    {},
                ),
            ):
                with self.subTest(label):
                    response, body = self._http_request(server, "GET", path, headers=headers)

                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.getheader("content-type"), "text/event-stream; charset=utf-8")
                    self.assertEqual(response.getheader("cache-control"), "no-cache")
                    self.assertIsNone(response.getheader("access-control-allow-origin"))
                    events = self._parse_sse_events(body.decode("utf-8"))
                    self.assertEqual(events[0][0], "run_status")
                    self.assertIn("state_frame", [event_type for event_type, _payload in events])
                    self.assertEqual(events[-1][0], "artifact_ready")
                    state_frame = next(payload for event_type, payload in events if event_type == "state_frame")
                    self.assertEqual(state_frame["schema_version"], "visualization-state-frame-v0")
                    self.assertEqual(state_frame["run_id"], run_id)
                    self.assertTrue(state_frame["artifact_id"].startswith("visualization_state_series-"))
                    self.assertEqual(state_frame["artifact_manifest_id"], f"artifact-manifest-{run_id}")
        finally:
            self._stop_http_server(server, thread)

    def test_m9_2_http_state_stream_requires_auth_and_maps_unknown_run_to_404(self) -> None:
        server, thread, run_id, token = self._start_state_stream_server()
        try:
            missing_auth, missing_body = self._http_request(server, "GET", f"/api/runs/{run_id}/state-stream")
            unknown, unknown_body = self._http_request(
                server,
                "GET",
                "/api/runs/run-missing/state-stream",
                headers={"Authorization": f"Bearer {token}"},
            )
            json_api_with_query_token, _ = self._http_request(
                server,
                "GET",
                f"/api/auth/session?access_token={token}",
            )

            self.assertEqual(missing_auth.status, 401)
            self.assertEqual(json.loads(missing_body.decode("utf-8"))["code"], "unauthorized")
            self.assertEqual(unknown.status, 404)
            self.assertEqual(json.loads(unknown_body.decode("utf-8"))["code"], "not_found")
            self.assertEqual(json_api_with_query_token.status, 401)
        finally:
            self._stop_http_server(server, thread)

    def _start_state_stream_server(self) -> tuple[Any, threading.Thread, str, str]:
        database_path = Path(self.tempdir.name) / "state-stream.sqlite3"
        connection = sqlite3.connect(database_path)
        try:
            initialize_database(connection)
            repository = ContractRepository(connection)
            api = BackendApi(repository, RecordingAdapter(), output_dir=Path(self.tempdir.name))
            token = api.login("admin", "admin")["session"]["token"]
            project = self._fixture("smoke_project.json")
            saved = api.save_project(project)
            api.create_modeling_snapshot(saved["project_id"])
            plan = api.create_experiment_plan(saved["project_id"], {"name": "http state stream", "steps": 2})
            submitted = api.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "model_family": "smoke",
                    "run_type": "single",
                }
            )
        finally:
            connection.close()
        server = create_backend_server(
            ("127.0.0.1", 0),
            repo_root=REPO_ROOT,
            database_path=database_path,
            output_dir=Path(self.tempdir.name),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server, thread, submitted["run_id"], token

    def _http_request(
        self,
        server: Any,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
    ) -> tuple[http.client.HTTPResponse, bytes]:
        connection = http.client.HTTPConnection(server.server_address[0], server.server_address[1], timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response, response.read()
        finally:
            connection.close()

    def _parse_sse_events(self, body: str) -> list[tuple[str, dict[str, Any]]]:
        events = []
        for block in body.strip().split("\n\n"):
            lines = block.splitlines()
            event_type = next(line.removeprefix("event: ").strip() for line in lines if line.startswith("event: "))
            data = next(line.removeprefix("data: ").strip() for line in lines if line.startswith("data: "))
            events.append((event_type, json.loads(data)))
        return events

    def _stop_http_server(self, server: Any, thread: threading.Thread) -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    def test_backend_api_requires_explicit_actor_for_m7_lifecycle_and_download(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        artifact = manifest["artifacts"][0]
        cases = [
            ("archive", lambda: self.api.archive_run(run["run_id"])),
            ("delete", lambda: self.api.soft_delete_run(run["run_id"])),
            ("download", lambda: self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"])),
        ]

        for label, call in cases:
            with self.subTest(label):
                with self.assertRaises(BackendApiError) as ctx:
                    call()

                self.assertEqual(ctx.exception.code, "missing_actor")

        stored = self.api.get_run(run["run_id"])
        self.assertEqual(stored["lifecycle_status"], "active")
        self.assertEqual(self.repository.list_audit_events(resource_id=run["run_id"]), [])

    def test_backend_api_lifecycle_requires_admin_or_data_manager_actor(self) -> None:
        forbidden_run = self._submit_successful_smoke_run()

        for label, mutate in (
            ("archive", lambda: self.api.archive_run(forbidden_run["run_id"], actor_user_id="user-basic")),
            ("delete", lambda: self.api.soft_delete_run(forbidden_run["run_id"], actor_user_id="user-basic")),
        ):
            with self.subTest(label):
                with self.assertRaises(BackendApiError) as ctx:
                    mutate()

                self.assertEqual(ctx.exception.code, "forbidden")
                stored = self.api.get_run(forbidden_run["run_id"])
                self.assertEqual(stored["lifecycle_status"], "active")
                audit = self.repository.list_audit_events(resource_id=forbidden_run["run_id"])
                self.assertFalse(any(event["outcome"] == "allowed" for event in audit))

        admin_run = self._submit_successful_smoke_run()
        archived = self.api.archive_run(admin_run["run_id"], actor_user_id="user-admin")
        self.assertEqual(archived["lifecycle_status"], "archived")

        data_run = self._submit_successful_smoke_run()
        deleted = self.api.soft_delete_run(data_run["run_id"], actor_user_id="user-data")
        self.assertEqual(deleted["lifecycle_status"], "deleted")

    def test_backend_api_lifecycle_audit_failure_rolls_back_state(self) -> None:
        cases = [
            ("archive", lambda run_id: self.api.archive_run(run_id, actor_user_id="missing-user")),
            ("delete", lambda run_id: self.api.soft_delete_run(run_id, actor_user_id="missing-user")),
        ]
        for label, mutate in cases:
            with self.subTest(label):
                run = self._submit_successful_smoke_run()

                with self.assertRaises(sqlite3.IntegrityError):
                    mutate(run["run_id"])

                stored = self.api.get_run(run["run_id"])
                self.assertEqual(stored["lifecycle_status"], "active")
                self.assertEqual(self.repository.list_audit_events(resource_id=run["run_id"]), [])

    def test_backend_api_rejects_artifact_path_escape(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        manifest["artifacts"][0]["path"] = "../escape.json"
        self.repository.upsert_artifact_manifest(manifest)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.get_run_artifact_download(
                run["run_id"],
                manifest["artifacts"][0]["artifact_id"],
                actor_user_id="system",
            )

        self.assertEqual(ctx.exception.code, "artifact_path_escape")
        self.assertEqual(self.repository.list_audit_events(resource_id=run["run_id"]), [])

    def test_backend_api_rejects_artifact_hash_mismatch(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        artifact = manifest["artifacts"][0]
        target = Path(self.api.output_dir) / artifact["path"]
        target.write_text('{"tampered": true}\n', encoding="utf-8")

        with self.assertRaises(BackendApiError) as ctx:
            self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"], actor_user_id="system")

        self.assertEqual(ctx.exception.code, "artifact_hash_mismatch")
        self.assertEqual(self.repository.list_audit_events(resource_id=run["run_id"]), [])

    def test_backend_api_rejects_missing_artifact_file(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        artifact = manifest["artifacts"][0]
        target = Path(self.api.output_dir) / artifact["path"]
        target.unlink()

        with self.assertRaises(BackendApiError) as ctx:
            self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"], actor_user_id="system")

        self.assertEqual(ctx.exception.code, "artifact_missing")
        self.assertEqual(self.repository.list_audit_events(resource_id=run["run_id"]), [])

    def test_backend_api_rejects_deleted_run_artifact_download(self) -> None:
        run = self._submit_successful_smoke_run()
        manifest = self.api.get_run_artifacts(run["run_id"])
        artifact = manifest["artifacts"][0]
        self.api.soft_delete_run(run["run_id"], actor_user_id="user-admin")

        with self.assertRaises(BackendApiError) as ctx:
            self.api.get_run_artifact_download(run["run_id"], artifact["artifact_id"], actor_user_id="system")

        self.assertEqual(ctx.exception.code, "run_deleted")

    def test_run_service_submits_formal_monte_carlo_run_and_persists_projection_artifacts(self) -> None:
        project = self._fixture("smoke_project.json")
        branch_project = copy.deepcopy(project)
        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "formal mc status",
                "steps": 2,
                "seed": branch_project["experiment"]["seed"],
                "projectJson": branch_project,
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
            },
        )
        service = RunService(self.repository, self.adapter, self.api.output_dir)

        submitted = service.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "monte_carlo",
            }
        )
        status = service.get_run_status(submitted["run_id"])
        stored_run = self.api.get_run(submitted["run_id"])
        manifest = self.api.get_run_artifacts(submitted["run_id"])
        kinds = {artifact["kind"] for artifact in manifest["artifacts"]}
        base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
        projection_artifacts = [
            artifact
            for artifact in manifest["artifacts"]
            if artifact["kind"].startswith("analysis_projection_")
        ]

        self.assertEqual(submitted["status"], "succeeded")
        self.assertEqual(submitted["run_type"], "monte_carlo")
        self.assertEqual(status["run_type"], "monte_carlo")
        self.assertEqual(stored_run["run_type"], "monte_carlo")
        self.assertEqual(status["modeling_snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(kinds, M7_MONTE_CARLO_ARTIFACT_KINDS)
        self.assertEqual(len(projection_artifacts), 4)
        self.assertTrue(all(artifact["source_artifact_id"] == base_artifact["artifact_id"] for artifact in projection_artifacts))
        self.assertTrue(all(artifact["schema_version"] == "analysis-projection-v0" for artifact in projection_artifacts))

    def test_monte_carlo_run_uses_plan_large_sample_config(self) -> None:
        project = self._fixture("smoke_project.json")
        branch_project = copy.deepcopy(project)
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "canonical MC config",
                "steps": 4,
                "projectJson": branch_project,
                "analysisRequests": {
                    "largeSample": {
                        "enabled": True,
                        "samples": 5,
                        "sweep": {
                            "failureRates": [0.06, 0.08],
                            "spareMultipliers": [1.0],
                            "supportCapacities": [2, 3],
                        },
                    }
                },
            },
        )

        status = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "monte_carlo",
                "mc_experiment_id": "mc-canonical-config",
            }
        )
        manifest = self.api.get_run_artifacts(status["run_id"])
        base_artifact = next(artifact for artifact in manifest["artifacts"] if artifact["kind"] == "monte_carlo_base")
        payload = json.loads((Path(self.tempdir.name) / base_artifact["path"]).read_text(encoding="utf-8"))

        self.assertEqual(payload["sample_count"], 5)
        self.assertEqual(payload["mc_experiment_id"], "mc-canonical-config")
        self.assertEqual(payload["sweep"]["failureRates"], [0.06, 0.08])
        self.assertEqual(payload["sweep"]["supportCapacities"], [2, 3])

    def test_run_service_hands_normalized_monte_carlo_config_to_adapter(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "adapter normalized mc config",
                "steps": 3,
                "projectJson": copy.deepcopy(project),
                "analysisRequests": {
                    "largeSample": {
                        "enabled": True,
                        "samples": 6,
                        "sweep": {
                            "failureRates": [0.05],
                            "spareMultipliers": [1.0, 1.2],
                            "supportCapacities": [2],
                        },
                    }
                },
            },
        )

        self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "monte_carlo",
                "mc_experiment_id": "mc-adapter-normalized",
            }
        )

        adapter_config = self.adapter.monte_carlo_run_calls[-1]["kwargs"].get("monte_carlo_config")
        self.assertIsNotNone(adapter_config)
        self.assertEqual(adapter_config["sample_count"], 6)
        self.assertEqual(adapter_config["mc_experiment_id"], "mc-adapter-normalized")
        self.assertEqual(adapter_config["sweep"]["failureRates"], [0.05])
        self.assertEqual(adapter_config["sweep"]["spareMultipliers"], [1.0, 1.2])
        self.assertEqual(adapter_config["sweep"]["supportCapacities"], [2])

    def test_monte_carlo_run_rejects_request_level_samples_and_sweep(self) -> None:
        project = self._fixture("smoke_project.json")
        branch_project = copy.deepcopy(project)
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "reject request MC config",
                "steps": 4,
                "projectJson": branch_project,
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
            },
        )
        before_counts = self._run_side_effect_counts()
        before_compile_calls = len(self.adapter.compile_calls)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "model_family": "smoke",
                    "run_type": "monte_carlo",
                    "sample_count": 99,
                    "samples": 99,
                    "sweep": {"supportCapacities": [9]},
                    "monte_carlo": {"samples": 99},
                }
            )

        self.assertEqual(ctx.exception.code, "bad_run_request")
        self.assertIn("ExperimentPlan.config.analysisRequests.largeSample", str(ctx.exception))
        self.assertIn("sample_count", ctx.exception.details.get("fields", []))
        self.assertIn("sweep", ctx.exception.details.get("fields", []))
        self.assertEqual(self._run_side_effect_counts(), before_counts)
        self.assertEqual(len(self.adapter.compile_calls), before_compile_calls)
        self.assertEqual(self.adapter.monte_carlo_run_calls, [])

    def test_monte_carlo_bad_request_wins_before_compile_gate_model_family(self) -> None:
        project = self._fixture("aviation_support_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "bad request before aviation compile gate",
                "steps": 1,
                "projectJson": copy.deepcopy(project),
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
            },
        )
        before_counts = self._run_side_effect_counts()
        before_compile_calls = len(self.adapter.compile_calls)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "model_family": "aviation_support",
                    "run_type": "monte_carlo",
                    "sample_count": 99,
                }
            )

        self.assertEqual(ctx.exception.code, "bad_run_request")
        self.assertIn("ExperimentPlan.config.analysisRequests.largeSample", str(ctx.exception))
        self.assertNotEqual(ctx.exception.code, "unsupported_model_family")
        self.assertEqual(self._run_side_effect_counts(), before_counts)
        self.assertEqual(len(self.adapter.compile_calls), before_compile_calls)
        self.assertEqual(self.adapter.monte_carlo_run_calls, [])

    def test_monte_carlo_config_rejects_fractional_integer_fields(self) -> None:
        cases = [
            ("fractional samples", {"samples": 2.5}, "analysisRequests.largeSample.samples"),
            (
                "fractional support capacity",
                {"sweep": {"failureRates": [0.07], "spareMultipliers": [1.0], "supportCapacities": [2.5]}},
                "analysisRequests.largeSample.sweep.supportCapacities",
            ),
        ]
        for label, override, expected_field in cases:
            with self.subTest(label):
                project = self._fixture("smoke_project.json")
                branch_project = copy.deepcopy(project)
                large_sample = {
                    "enabled": True,
                    "samples": 4,
                    "sweep": {
                        "failureRates": [0.07],
                        "spareMultipliers": [1.0],
                        "supportCapacities": [3],
                    },
                }
                if "samples" in override:
                    large_sample["samples"] = override["samples"]
                if "sweep" in override:
                    large_sample["sweep"] = override["sweep"]
                saved = self.api.save_project(project)
                self.api.create_modeling_snapshot(saved["project_id"])
                plan = self.api.create_experiment_plan(
                    saved["project_id"],
                    {
                        "name": f"reject {label}",
                        "steps": 4,
                        "projectJson": branch_project,
                        "analysisRequests": {"largeSample": large_sample},
                    },
                )
                before_counts = self._run_side_effect_counts()
                before_compile_calls = len(self.adapter.compile_calls)

                with self.assertRaises(BackendApiError) as ctx:
                    self.api.submit_run(
                        {
                            "project_id": saved["project_id"],
                            "experiment_plan_id": plan["experiment_plan_id"],
                            "model_family": "smoke",
                            "run_type": "monte_carlo",
                        }
                    )

                self.assertEqual(ctx.exception.code, "bad_run_request")
                self.assertEqual(
                    ctx.exception.details.get("field") or ctx.exception.details.get("field_path"),
                    expected_field,
                )
                self.assertEqual(self._run_side_effect_counts(), before_counts)
                self.assertEqual(len(self.adapter.compile_calls), before_compile_calls)
                self.assertEqual(self.adapter.monte_carlo_run_calls, [])

    def test_run_service_rejects_missing_model_family_on_canonical_submit(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "missing family", "steps": 2})
        service = RunService(self.repository, self.adapter, self.api.output_dir)

        with self.assertRaises(RunServiceError) as ctx:
            service.submit_run(
                {
                    "project_id": saved["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "run_type": "single",
                }
            )

        self.assertEqual(ctx.exception.code, "bad_run_request")

    def test_run_service_fail_closed_when_compiler_gate_blocks_model_family(self) -> None:
        project = self._fixture("aviation_support_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "aviation blocked", "steps": 1})
        service = RunService(self.repository, self.adapter, self.api.output_dir)

        submitted = service.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "aviation_support",
                "run_type": "single",
            }
        )
        artifacts = self.api.get_run_artifacts(submitted["run_id"])
        chain = self.api.get_run_chain(submitted["run_id"])
        scenario_rows = self.connection.execute(
            "SELECT scenario_id FROM scenarios WHERE scenario_id LIKE 'uncompiled-%'"
        ).fetchall()

        self.assertEqual(submitted["status"], "failed")
        self.assertEqual(submitted["phase"], "failed")
        self.assertEqual(submitted["progress"], 0)
        self.assertIsNone(submitted["scenario_id"])
        self.assertEqual(submitted["error"]["code"], "unsupported_model_family")
        self.assertIn("issues", submitted["error"]["details"])
        self.assertIn("provenance", submitted["error"]["details"])
        self.assertEqual(submitted["result_summary_id"], None)
        self.assertIsNone(artifacts["scenario_id"])
        self.assertEqual([artifact["kind"] for artifact in artifacts["artifacts"]], ["log"])
        self.assertIsNone(chain.get("scenario_id"))
        self.assertIsNone(chain.get("scenario_version"))
        self.assertIsNone(chain.get("scenario_schema_version"))
        self.assertEqual(chain["artifact_manifest_id"], submitted["artifact_manifest_id"])
        self.assertEqual(scenario_rows, [])
        self.assertEqual(self.adapter.run_calls, [])

    def test_run_service_failed_compile_run_has_downloadable_log_artifact(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "blocked aviation"})

        submitted = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "aviation_support",
                "run_type": "single",
            }
        )
        manifest = self.api.get_run_artifacts(submitted["run_id"])
        log_artifacts = [artifact for artifact in manifest["artifacts"] if artifact["kind"] == "log"]

        self.assertEqual(submitted["status"], "failed")
        self.assertEqual(len(log_artifacts), 1)
        self.assertRegex(log_artifacts[0]["sha256"], r"^[0-9a-f]{64}$")
        self.assertGreater(log_artifacts[0]["size_bytes"], 0)
        log_path = Path(self.api.output_dir) / log_artifacts[0]["path"]
        log_data = log_path.read_bytes()
        log_payload = json.loads(log_data.decode("utf-8"))
        self.assertEqual(hashlib.sha256(log_data).hexdigest(), log_artifacts[0]["sha256"])
        self.assertEqual(len(log_data), log_artifacts[0]["size_bytes"])
        self.assertEqual(log_payload["run_id"], submitted["run_id"])
        self.assertEqual(log_payload["status"], "failed")
        self.assertEqual(log_payload["events"][0]["event"], "compile_gate_failed")
        self.assertEqual(log_payload["events"][0]["error"]["code"], "unsupported_model_family")
        self.assertTrue(log_payload["events"][0]["issues"])
        self.assertEqual(log_payload["events"][0]["provenance"]["model_family"], "aviation_support")

    def test_backend_api_submit_run_uses_m6_status_envelope(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "submit run", "steps": 1})

        submitted = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )
        status = self.api.get_run_status(submitted["run_id"])

        self.assertEqual(submitted["status"], "succeeded")
        self.assertEqual(submitted["phase"], "completed")
        self.assertEqual(status["run_id"], submitted["run_id"])
        self.assertEqual(status["experiment_plan_id"], plan["experiment_plan_id"])

    def test_backend_api_submit_run_rejects_project_plan_mismatch(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "mismatch", "steps": 1})
        other_project = copy.deepcopy(project)
        other_project["project_id"] = "project-other"
        other_project["scenarioId"] = "other-smoke-contract-demo"
        other_saved = self.api.save_project(other_project)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.submit_run(
                {
                    "project_id": other_saved["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "model_family": "smoke",
                    "run_type": "single",
                }
            )

        self.assertEqual(ctx.exception.code, "project_plan_mismatch")

    def test_backend_api_submit_run_keeps_aviation_support_blocked(self) -> None:
        project = self._fixture("aviation_support_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "aviation blocked", "steps": 1})

        submitted = self.api.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "aviation_support",
                "run_type": "single",
            }
        )

        self.assertEqual(submitted["status"], "failed")
        self.assertEqual(submitted["phase"], "failed")
        self.assertEqual(submitted["error"]["code"], "unsupported_model_family")
        self.assertEqual(submitted["error"]["details"]["provenance"]["model_family"], "aviation_support")
        self.assertEqual(self.adapter.run_calls, [])

    def test_backend_api_start_simulation_run_delegates_to_m6_run_service(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "compat", "steps": 1})

        run = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")
        status = self.api.get_run_status(run["run_id"])

        self.assertEqual(run["status"], "succeeded")
        self.assertEqual(status["phase"], "completed")
        self.assertEqual(status["run_id"], run["run_id"])
        self.assertEqual(status["experiment_plan_id"], plan["experiment_plan_id"])

    def test_run_service_persists_failed_status_when_executor_fails_after_scenario_compile(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)
        self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "failed executor", "steps": 1})
        failing_adapter = FailingRunAdapter()
        service = RunService(self.repository, failing_adapter, self.api.output_dir)

        submitted = service.submit_run(
            {
                "project_id": saved["project_id"],
                "experiment_plan_id": plan["experiment_plan_id"],
                "model_family": "smoke",
                "run_type": "single",
            }
        )
        stored = self.api.get_run(submitted["run_id"])
        artifacts = self.api.get_run_artifacts(submitted["run_id"])

        self.assertEqual(submitted["status"], "failed")
        self.assertEqual(submitted["phase"], "failed")
        self.assertEqual(submitted["progress"], 0)
        self.assertEqual(submitted["error"]["code"], "executor_failed")
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(artifacts["run_id"], submitted["run_id"])
        self.assertEqual([artifact["kind"] for artifact in artifacts["artifacts"]], ["log"])

    def test_run_chain_preserves_snapshot_and_plan_after_project_resave(self) -> None:
        project = self._fixture("smoke_project.json")

        first_saved = self.api.save_project(project)
        first_snapshot = self.api.create_modeling_snapshot(first_saved["project_id"])
        first_plan = self.api.create_experiment_plan(first_saved["project_id"], {"name": "same config", "steps": 1})
        first_run = self.api.start_simulation_run(
            first_saved["project_id"],
            first_plan["experiment_plan_id"],
            model_family="smoke",
        )

        changed_project = copy.deepcopy(project)
        changed_project["experiment"]["name"] = "changed after first run"
        second_saved = self.api.save_project(changed_project)
        second_snapshot = self.api.create_modeling_snapshot(second_saved["project_id"])
        second_plan = self.api.create_experiment_plan(second_saved["project_id"], {"name": "same config", "steps": 1})
        second_run = self.api.start_simulation_run(
            second_saved["project_id"],
            second_plan["experiment_plan_id"],
            model_family="smoke",
        )

        first_chain = self.api.get_run_chain(first_run["run_id"])
        second_chain = self.api.get_run_chain(second_run["run_id"])

        self.assertNotEqual(first_snapshot["snapshot_id"], second_snapshot["snapshot_id"])
        self.assertNotEqual(first_plan["experiment_plan_id"], second_plan["experiment_plan_id"])
        self.assertEqual(first_chain["modeling_snapshot_id"], first_snapshot["snapshot_id"])
        self.assertEqual(first_chain["experiment_plan_id"], first_plan["experiment_plan_id"])
        self.assertEqual(second_chain["modeling_snapshot_id"], second_snapshot["snapshot_id"])
        self.assertEqual(second_chain["experiment_plan_id"], second_plan["experiment_plan_id"])
        self.assertEqual(first_chain["run_id"], first_run["run_id"])
        self.assertEqual(second_chain["run_id"], second_run["run_id"])

    def test_experiment_plan_config_branch_does_not_mutate_source_project(self) -> None:
        project = self._fixture("smoke_project.json")
        saved = self.api.save_project(project)

        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "branch before mutation",
                "steps": 4,
                "assumptions": {
                    "support_capacity": 2,
                },
            },
        )
        plan["config"]["name"] = "branch after mutation"
        plan["config"]["assumptions"]["support_capacity"] = 99
        self.repository.upsert_experiment_plan(plan)

        stored_project = self.api.get_project(saved["project_id"])

        self.assertEqual(stored_project, project)
        self.assertEqual(stored_project["experiment"]["seed"], project["experiment"]["seed"])
        self.assertNotIn("assumptions", stored_project["experiment"])

    def test_single_run_compiles_from_experiment_plan_project_branch(self) -> None:
        project = self._fixture("smoke_project.json")
        branch_project = copy.deepcopy(project)
        branch_project["experiment"]["seed"] = 99
        branch_project["components"][0]["failureRate"] = 0.21
        branch_project["supportNodes"][0]["equipmentCapacity"] = 8

        saved = self.api.save_project(project)
        snapshot = self.api.create_modeling_snapshot(saved["project_id"])
        plan = self.api.create_experiment_plan(
            saved["project_id"],
            {
                "name": "single input branch",
                "steps": 5,
                "projectJson": branch_project,
            },
        )

        run = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")

        compiled_project, model_family = self.adapter.compile_calls[-1]
        compiled_scenario, steps, run_id = self.adapter.run_calls[-1]
        provenance = compiled_scenario["compiled_from"]["mapping_provenance"]

        self.assertEqual(model_family, "smoke")
        self.assertEqual(compiled_project["experiment"]["seed"], 99)
        self.assertEqual(compiled_project["components"][0]["failureRate"], 0.21)
        self.assertEqual(compiled_project["supportNodes"][0]["equipmentCapacity"], 8)
        self.assertEqual(compiled_scenario["simulation_inputs"]["seed"], 99)
        self.assertEqual(compiled_scenario["simulation_inputs"]["failure_rate"], 0.21)
        self.assertEqual(compiled_scenario["simulation_inputs"]["support_capacity"], 8)
        self.assertEqual(steps, 5)
        self.assertEqual(run_id, run["run_id"])
        self.assertEqual(provenance["experiment_plan_id"], plan["experiment_plan_id"])
        self.assertEqual(provenance["modeling_snapshot_id"], snapshot["snapshot_id"])
        self.assertEqual(self.api.get_project(saved["project_id"]), project)

    def test_repeated_smoke_runs_create_distinct_run_chains(self) -> None:
        project = self._fixture("smoke_project.json")

        saved = self.api.save_project(project)
        plan = self.api.create_experiment_plan(saved["project_id"], {"name": "repeatable smoke", "steps": 1})
        first = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")
        second = self.api.start_simulation_run(saved["project_id"], plan["experiment_plan_id"], model_family="smoke")

        self.assertNotEqual(first["run_id"], second["run_id"])
        self.assertNotEqual(first["scenario_id"], second["scenario_id"])
        self.assertNotEqual(first["result_summary_id"], second["result_summary_id"])
        self.assertNotEqual(first["artifact_manifest_id"], second["artifact_manifest_id"])
        self.assertEqual(self.api.get_run_chain(first["run_id"])["run_id"], first["run_id"])
        self.assertEqual(self.api.get_run_chain(second["run_id"])["run_id"], second["run_id"])

    def test_unsupported_aviation_support_path_is_explicit(self) -> None:
        project = self._fixture("aviation_support_project.json")
        self.api.save_project(project)
        plan = self.api.create_experiment_plan(project["project_id"], {"steps": 1})

        submitted = self.api.start_simulation_run(
            project["project_id"],
            plan["experiment_plan_id"],
            model_family="aviation_support",
        )

        self.assertEqual(submitted["status"], "failed")
        self.assertEqual(submitted["phase"], "failed")
        self.assertEqual(submitted["error"]["code"], "unsupported_model_family")
        self.assertIn("issues", submitted["error"]["details"])
        self.assertEqual(
            submitted["error"]["message"],
            "aviation_support scenario compilation is blocked until governed field derivation rules are approved",
        )
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "aviation_support")
        self.assertEqual(self.adapter.run_calls, [])

    def test_modeling_import_api_validates_saves_and_publishes_package_as_system(self) -> None:
        import_package = self._fixture("modeling_import_project.json")

        validation = self.api.validate_modeling_import(import_package)
        saved = self.api.save_modeling_import_as_system(import_package)
        published = self.api.publish_modeling_import_as_system(import_package["importId"])
        stored = self.api.get_modeling_import(import_package["importId"])

        self.assertTrue(validation["ok"])
        self.assertEqual(validation["status"], "valid")
        self.assertEqual(validation["issues"], [])
        self.assertEqual(saved["import_id"], import_package["importId"])
        self.assertEqual(saved["project_id"], import_package["projectId"])
        self.assertEqual(saved["validation_status"], "valid")
        self.assertEqual(published["lifecycle"]["state"], "published")
        self.assertEqual(stored["validation"]["status"], "valid")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(
            [(event["action"], event["outcome"], event["actor_user_id"]) for event in events],
            [
                ("modeling_import.save", "allowed", None),
                ("modeling_import.publish", "allowed", None),
            ],
        )
        self.assertTrue(all(event["details"].get("actor") == "system" for event in events))

    def test_modeling_import_api_rejects_missing_actor_for_save(self) -> None:
        import_package = self._fixture("modeling_import_project.json")

        with self.assertRaises(BackendApiError) as ctx:
            self.api.save_modeling_import(import_package)

        self.assertEqual(ctx.exception.code, "unauthorized")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(events[-1]["action"], "modeling_import.save")
        self.assertEqual(events[-1]["outcome"], "denied")
        self.assertIsNone(events[-1]["actor_user_id"])
        self.assertEqual(events[-1]["details"]["reason"], "missing_actor")

    def test_modeling_import_api_rejects_missing_actor_for_publish(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.publish_modeling_import(import_package["importId"])

        self.assertEqual(ctx.exception.code, "unauthorized")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(events[-1]["action"], "modeling_import.publish")
        self.assertEqual(events[-1]["outcome"], "denied")
        self.assertIsNone(events[-1]["actor_user_id"])
        self.assertEqual(events[-1]["details"]["reason"], "missing_actor")

    def test_m4_data_admin_can_save_publish_and_audit_modeling_import(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        session = self.api.login("data", "data")

        saved = self.api.save_modeling_import(import_package, actor_user_id=session["user"]["user_id"])
        published = self.api.publish_modeling_import(
            import_package["importId"],
            actor_user_id=session["user"]["user_id"],
        )

        self.assertEqual(session["user"]["role"], "数据管理员")
        self.assertEqual(saved["status"], "draft")
        self.assertEqual(published["lifecycle"]["state"], "published")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(
            [(event["action"], event["outcome"]) for event in events],
            [
                ("modeling_import.save", "allowed"),
                ("modeling_import.publish", "allowed"),
            ],
        )
        self.assertEqual({event["actor_user_id"] for event in events}, {session["user"]["user_id"]})
        login_events = self.repository.list_audit_events()
        login_event = next(event for event in login_events if event["action"] == "auth.login")
        self.assertNotEqual(login_event["resource_id"], session["session"]["token"])
        self.assertRegex(login_event["resource_id"], r"^session-[0-9a-f]{16}$")

    def test_create_project_from_modeling_import_saves_project_and_snapshot(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)
        self.api.publish_modeling_import_as_system(import_package["importId"])

        created = self.api.create_project_from_modeling_import_as_system(import_package["importId"])

        self.assertEqual(created["sourceImport"]["import_id"], import_package["importId"])
        self.assertEqual(created["project"]["project_id"], import_package["projectId"])
        self.assertEqual(created["project"]["missionProfile"]["sourceImportId"], import_package["importId"])
        self.assertEqual(created["project"]["equipment"]["wholeMachineModels"], ["J-15", "J-35"])
        self.assertGreaterEqual(created["project"]["equipment"]["quantity"], 6)
        self.assertGreaterEqual(len(created["project"]["components"]), 8)
        self.assertTrue(any(
            component.get("id") == "j15-avionics"
            and component.get("aircraftModel") == "J-15"
            and component.get("parentId") == "aircraft-root"
            and component.get("spareType") == "航电模块"
            for component in created["project"]["components"]
        ))
        self.assertGreaterEqual(len(created["project"]["missionProfile"]["compositeTasks"]), 2)
        self.assertGreaterEqual(len(created["project"]["missionProfile"]["periodicTasks"]), 1)
        self.assertGreaterEqual(len(created["project"]["missionPhases"]), 4)
        self.assertGreaterEqual(len(created["project"]["combatUnit"]["members"]), 4)
        self.assertGreaterEqual(len(created["project"]["supportNodes"]), 3)
        self.assertIn("航电模块", created["project"]["supportNodes"][0]["inventory"])
        activity_types = {activity["activityType"] for activity in created["project"]["supportActivities"]}
        self.assertTrue({"飞行前保障", "修复性维修", "预防性维修", "后勤保障"}.issubset(activity_types))
        self.assertGreaterEqual(len(created["project"]["supportActivities"][0]["jobs"]), 2)
        self.assertGreaterEqual(len(created["project"]["reliabilityBlockDiagram"]["nodes"]), 4)
        self.assertEqual(created["savedProject"]["project_id"], import_package["projectId"])
        self.assertEqual(created["modelingSnapshot"]["project"]["project_id"], import_package["projectId"])
        self.assertEqual(self.api.get_project(import_package["projectId"])["project_id"], import_package["projectId"])
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        create_events = [event for event in events if event["action"] == "modeling_import.create_project"]
        self.assertEqual(len(create_events), 1)
        self.assertEqual(create_events[0]["outcome"], "allowed")
        self.assertEqual(create_events[0]["resource_id"], import_package["importId"])
        self.assertEqual(create_events[0]["details"]["project_id"], import_package["projectId"])
        self.assertEqual(create_events[0]["details"]["import_version"], 1)
        self.assertEqual(create_events[0]["details"]["actor"], "system")

    def test_modeling_import_to_project_preserves_full_authoring_surfaces(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        objects = import_package["objects"]

        project = modeling_import_to_project(import_package)

        self.assertEqual(project["projectInfo"], objects["projectInfo"])
        self.assertIsNot(project["projectInfo"], objects["projectInfo"])
        self.assertEqual(project["supportOrganization"]["tree"], objects["supportOrganization"]["tree"])
        self.assertIsNot(project["supportOrganization"], objects["supportOrganization"])
        self.assertEqual(
            project["analysisRequests"]["largeSample"]["samples"],
            objects["analysisRequests"]["largeSample"]["samples"],
        )
        self.assertEqual(
            project["analysisRequests"]["largeSample"]["sweep"],
            objects["analysisRequests"]["largeSample"]["sweep"],
        )
        self.assertIsNot(
            project["analysisRequests"]["largeSample"]["sweep"]["failureRates"],
            objects["analysisRequests"]["largeSample"]["sweep"]["failureRates"],
        )
        self.assertGreaterEqual(len(project["reliabilityBlockDiagram"]["nodes"]), 4)
        self.assertEqual(project["monteCarlo"], objects["missionProfiles"][0]["monteCarlo"])
        objects["analysisRequests"]["largeSample"]["sweep"]["failureRates"].append(0.99)
        self.assertNotIn(0.99, project["analysisRequests"]["largeSample"]["sweep"]["failureRates"])

    def test_modeling_import_to_project_preserves_explicit_empty_collections(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        mission = import_package["objects"]["missionProfiles"][0]
        mission["combatUnit"] = {"members": []}
        import_package["objects"]["reliabilityBlockDiagram"] = {"nodes": [], "edges": []}
        import_package["objects"]["monteCarlo"] = {
            "failureRates": [],
            "spareMultipliers": [],
            "supportCapacities": [],
            "minRequiredSorties": [],
        }

        project = modeling_import_to_project(import_package)

        self.assertEqual(project["combatUnit"], {"members": []})
        self.assertEqual(project["reliabilityBlockDiagram"], {"nodes": [], "edges": []})
        self.assertEqual(
            project["monteCarlo"],
            {
                "failureRates": [],
                "spareMultipliers": [],
                "supportCapacities": [],
                "minRequiredSorties": [],
            },
        )

    def test_m4_regular_user_cannot_publish_modeling_import_and_denial_is_audited(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        data_session = self.api.login("data", "data")
        user_session = self.api.login("user", "user")
        self.api.save_modeling_import(import_package, actor_user_id=data_session["user"]["user_id"])

        with self.assertRaises(BackendApiError) as ctx:
            self.api.publish_modeling_import(
                import_package["importId"],
                actor_user_id=user_session["user"]["user_id"],
            )

        self.assertEqual(ctx.exception.code, "forbidden")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(events[-1]["action"], "modeling_import.publish")
        self.assertEqual(events[-1]["outcome"], "denied")
        self.assertEqual(events[-1]["actor_user_id"], user_session["user"]["user_id"])

    def test_m4_regular_user_cannot_save_modeling_import_and_denial_is_audited(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        user_session = self.api.login("user", "user")

        with self.assertRaises(BackendApiError) as ctx:
            self.api.save_modeling_import(
                import_package,
                actor_user_id=user_session["user"]["user_id"],
            )

        self.assertEqual(ctx.exception.code, "forbidden")
        events = self.repository.list_audit_events(resource_id=import_package["importId"])
        self.assertEqual(events[-1]["action"], "modeling_import.save")
        self.assertEqual(events[-1]["outcome"], "denied")

    def test_m4_admin_can_list_create_and_update_users_with_audit(self) -> None:
        admin_session = self.api.login("admin", "admin")

        created = self.api.create_user(
            {
                "username": "planner",
                "password": "planner",
                "role": "数据管理员",
                "display_name": "规划员",
                "status": "active",
            },
            actor_user_id=admin_session["user"]["user_id"],
        )
        updated = self.api.update_user(
            created["user_id"],
            {
                "display_name": "规划员二号",
                "role": "普通用户",
                "status": "disabled",
            },
            actor_user_id=admin_session["user"]["user_id"],
        )
        users = self.api.list_users(actor_user_id=admin_session["user"]["user_id"])

        self.assertEqual(created["username"], "planner")
        self.assertNotIn("password_hash", created)
        self.assertEqual(updated["display_name"], "规划员二号")
        self.assertEqual(updated["role"], "普通用户")
        self.assertEqual(updated["status"], "disabled")
        self.assertIn("planner", {user["username"] for user in users["users"]})
        events = self.repository.list_audit_events(resource_id=created["user_id"])
        self.assertEqual(
            [(event["action"], event["outcome"]) for event in events],
            [
                ("users.create", "allowed"),
                ("users.update", "allowed"),
            ],
        )

    def test_m4_regular_user_cannot_create_or_update_users_and_denial_is_audited(self) -> None:
        admin_session = self.api.login("admin", "admin")
        user_session = self.api.login("user", "user")
        created = self.api.create_user(
            {"username": "readonly", "password": "readonly", "role": "普通用户", "display_name": "只读用户"},
            actor_user_id=admin_session["user"]["user_id"],
        )

        with self.assertRaises(BackendApiError) as create_ctx:
            self.api.create_user(
                {"username": "blocked", "password": "blocked", "role": "普通用户"},
                actor_user_id=user_session["user"]["user_id"],
            )
        with self.assertRaises(BackendApiError) as update_ctx:
            self.api.update_user(
                created["user_id"],
                {"display_name": "不应修改"},
                actor_user_id=user_session["user"]["user_id"],
            )

        self.assertEqual(create_ctx.exception.code, "forbidden")
        self.assertEqual(update_ctx.exception.code, "forbidden")
        create_events = self.repository.list_audit_events(resource_id="blocked")
        update_events = self.repository.list_audit_events(resource_id=created["user_id"])
        self.assertEqual(create_events[-1]["action"], "users.create")
        self.assertEqual(create_events[-1]["outcome"], "denied")
        self.assertEqual(update_events[-1]["action"], "users.update")
        self.assertEqual(update_events[-1]["outcome"], "denied")

    def test_compile_modeling_import_scenario_requires_published_valid_import(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(ctx.exception.code, "unpublished_modeling_import")

    def test_compile_modeling_import_scenario_uses_simulation_adapter(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)
        self.api.publish_modeling_import_as_system(import_package["importId"])

        compiled = self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(compiled["compiled_from_import"]["import_id"], import_package["importId"])
        self.assertEqual(compiled["project"]["project_id"], import_package["projectId"])
        self.assertEqual(compiled["scenario"]["project_id"], import_package["projectId"])
        self.assertEqual(compiled["scenario"]["compiled_by"], "Simulation Adapter Agent")
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "smoke")

    def test_compile_modeling_import_scenario_preserves_aviation_support_error_mapping(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)
        self.api.publish_modeling_import_as_system(import_package["importId"])

        with self.assertRaises(BackendApiError) as ctx:
            self.api.compile_modeling_import_scenario(
                import_package["importId"],
                model_family="aviation_support",
            )

        self.assertEqual(ctx.exception.code, "unsupported_model_family")
        self.assertEqual(
            str(ctx.exception),
            "aviation_support scenario compilation is blocked until governed field derivation rules are approved",
        )
        self.assertEqual(ctx.exception.details["provenance"]["model_family"], "aviation_support")
        self.assertEqual(
            ctx.exception.details["issues"][0]["field_path"],
            "missionProfile.durationHours",
        )
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "aviation_support")

    def test_modeling_import_api_reports_field_level_issues(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["objects"]["supportActivities"][0]["resourceId"] = "missing-resource"
        import_package["objects"]["equipmentAssets"][1]["quantity"] = 0

        validation = self.api.validate_modeling_import(import_package)

        self.assertFalse(validation["ok"])
        self.assertEqual(validation["status"], "invalid")
        self.assertEqual(
            sorted(issue["code"] for issue in validation["issues"]),
            ["invalid_number", "missing_reference"],
        )
        self.assertEqual(
            {issue["field_path"] for issue in validation["issues"]},
            {
                "objects.equipmentAssets[1].quantity",
                "objects.supportActivities[0].resourceId",
            },
        )

    def test_modeling_import_api_covers_contract_parity_issues(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["schemaVersion"] = "modeling-import-v0"
        import_package["objects"].pop("supportResources")
        import_package["objects"]["equipmentAssets"].append(
            {
                "id": "j15-radar",
                "name": "重复雷达 LRU",
                "parentId": "aircraft-root",
                "quantity": 1,
                "mtbfHours": 900,
            }
        )
        import_package["lifecycle"] = {
            "state": "published",
            "version": 1,
            "referencedRunIds": ["run-smoke-contract-001"],
        }
        import_package["changes"] = [
            {
                "operation": "update",
                "objectType": "equipmentAssets",
                "objectId": "j15-radar",
                "fieldPath": "objects.equipmentAssets[id=j15-radar].name",
            }
        ]

        validation = self.api.validate_modeling_import(import_package)
        issues_by_code = {issue["code"]: issue for issue in validation["issues"]}

        self.assertFalse(validation["ok"])
        self.assertIn("invalid_schema_version", issues_by_code)
        self.assertIn("missing_required_root", issues_by_code)
        self.assertIn("duplicate_id", issues_by_code)
        self.assertIn("published_reference_protection", issues_by_code)
        self.assertEqual(
            issues_by_code["published_reference_protection"]["field_path"],
            "objects.equipmentAssets[id=j15-radar].name",
        )
        self.assertEqual(
            issues_by_code["published_reference_protection"]["page"],
            "装备组成建模",
        )

    def test_modeling_import_api_rejects_invalid_save_and_referenced_publish(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        invalid_package = copy.deepcopy(import_package)
        invalid_package["objects"]["missionProfiles"][0].pop("name")

        with self.assertRaises(BackendApiError) as invalid_ctx:
            self.api.save_modeling_import_as_system(invalid_package)

        self.assertEqual(invalid_ctx.exception.code, "invalid_modeling_import")
        self.assertEqual(
            invalid_ctx.exception.details["issues"][0]["field_path"],
            "objects.missionProfiles[0].name",
        )

        referenced_package = copy.deepcopy(import_package)
        referenced_package["lifecycle"] = {
            "state": "published",
            "version": 1,
            "referencedRunIds": ["run-smoke-contract-001"],
        }
        self.repository.upsert_modeling_import(
            referenced_package,
            {"ok": True, "status": "valid", "issues": []},
        )

        with self.assertRaises(BackendApiError) as publish_ctx:
            self.api.publish_modeling_import_as_system(import_package["importId"])

        self.assertEqual(publish_ctx.exception.code, "published_import_referenced")

        changed_package = copy.deepcopy(import_package)
        changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
        target_index = next(
            index for index, component in enumerate(changed_package["objects"]["equipmentAssets"])
            if component["id"] == "j15-engine"
        )
        changed_package["objects"]["equipmentAssets"][target_index]["quantity"] = 3
        saved = self.api.save_modeling_import_as_system(changed_package)
        stored = self.api.get_modeling_import(import_package["importId"])

        self.assertEqual(saved["status"], "draft")
        self.assertEqual(stored["draftPackage"]["objects"]["equipmentAssets"][target_index]["quantity"], 3)
        self.assertEqual(stored["publishedPackage"]["objects"]["equipmentAssets"][target_index]["quantity"], 2)

        with self.assertRaises(BackendApiError) as republish_ctx:
            self.api.publish_modeling_import_as_system(import_package["importId"])

        self.assertEqual(republish_ctx.exception.code, "published_import_referenced")

    def test_compile_modeling_import_scenario_uses_persisted_published_snapshot_after_new_draft(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import_as_system(import_package)
        self.api.publish_modeling_import_as_system(import_package["importId"])

        changed_package = copy.deepcopy(import_package)
        changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
        target_index = next(
            index for index, component in enumerate(changed_package["objects"]["equipmentAssets"])
            if component["id"] == "j15-engine"
        )
        changed_package["objects"]["equipmentAssets"][target_index]["quantity"] = 3
        self.api.save_modeling_import_as_system(changed_package)

        compiled = self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(compiled["compiled_from_import"]["import_version"], 1)
        self.assertEqual(compiled["project"]["project_version"], "import-v1")
        self.assertEqual(
            next(component for component in compiled["project"]["components"] if component["id"] == "j15-engine")["quantity"],
            2,
        )

    def test_modeling_import_api_rejects_invalid_lifecycle_before_compile(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["lifecycle"] = {
            "state": "published",
            "version": 0,
            "referencedRunIds": "run-smoke-contract-001",
        }

        validation = self.api.validate_modeling_import(import_package)

        self.assertFalse(validation["ok"])
        self.assertEqual(
            [issue["code"] for issue in validation["issues"]],
            ["invalid_lifecycle_version", "invalid_lifecycle_references"],
        )

        with self.assertRaises(BackendApiError) as save_ctx:
            self.api.save_modeling_import_as_system(import_package)

        self.assertEqual(save_ctx.exception.code, "invalid_modeling_import")

    def test_modeling_import_api_accepts_json_schema_integer_version_semantics(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["lifecycle"]["version"] = 1.0

        validation = self.api.validate_modeling_import(import_package)

        self.assertTrue(validation["ok"])


if __name__ == "__main__":
    unittest.main()
