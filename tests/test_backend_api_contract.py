from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
from pathlib import Path
import unittest

from src.spare_mvp_backend.api import BackendApi, BackendApiError
from src.spare_mvp_backend.repository import ContractRepository, initialize_database
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class RecordingAdapter(SimulationAdapter):
    def __init__(self) -> None:
        super().__init__(REPO_ROOT)
        self.compile_calls: list[tuple[dict, str]] = []
        self.run_calls: list[tuple[dict, int]] = []

    def compile_scenario(self, project: dict, model_family: str = "smoke") -> dict:
        self.compile_calls.append((copy.deepcopy(project), model_family))
        return super().compile_scenario(project, model_family=model_family)

    def run_scenario(
        self,
        scenario: dict,
        output_dir: Path | str,
        steps: int = 3,
        run_id: str | None = None,
    ) -> dict[str, dict]:
        self.run_calls.append((copy.deepcopy(scenario), steps, run_id))
        return super().run_scenario(scenario, output_dir=output_dir, steps=steps, run_id=run_id)


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

        with self.assertRaises(BackendApiError) as ctx:
            self.api.start_simulation_run(
                project["project_id"],
                plan["experiment_plan_id"],
                model_family="aviation_support",
            )

        self.assertEqual(ctx.exception.code, "unsupported_model_family")
        self.assertEqual(
            str(ctx.exception),
            "aviation_support scenario compilation is blocked until governed field derivation rules are approved",
        )
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "aviation_support")
        self.assertEqual(self.adapter.run_calls, [])

    def test_modeling_import_api_validates_saves_and_publishes_package(self) -> None:
        import_package = self._fixture("modeling_import_project.json")

        validation = self.api.validate_modeling_import(import_package)
        saved = self.api.save_modeling_import(import_package)
        published = self.api.publish_modeling_import(import_package["importId"])
        stored = self.api.get_modeling_import(import_package["importId"])

        self.assertTrue(validation["ok"])
        self.assertEqual(validation["status"], "valid")
        self.assertEqual(validation["issues"], [])
        self.assertEqual(saved["import_id"], import_package["importId"])
        self.assertEqual(saved["project_id"], import_package["projectId"])
        self.assertEqual(saved["validation_status"], "valid")
        self.assertEqual(published["lifecycle"]["state"], "published")
        self.assertEqual(stored["validation"]["status"], "valid")

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
        self.api.save_modeling_import(import_package)

        with self.assertRaises(BackendApiError) as ctx:
            self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(ctx.exception.code, "unpublished_modeling_import")

    def test_compile_modeling_import_scenario_uses_simulation_adapter(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import(import_package)
        self.api.publish_modeling_import(import_package["importId"])

        compiled = self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(compiled["compiled_from_import"]["import_id"], import_package["importId"])
        self.assertEqual(compiled["project"]["project_id"], import_package["projectId"])
        self.assertEqual(compiled["scenario"]["project_id"], import_package["projectId"])
        self.assertEqual(compiled["scenario"]["compiled_by"], "Simulation Adapter Agent")
        self.assertEqual(len(self.adapter.compile_calls), 1)
        self.assertEqual(self.adapter.compile_calls[0][1], "smoke")

    def test_compile_modeling_import_scenario_preserves_aviation_support_error_mapping(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import(import_package)
        self.api.publish_modeling_import(import_package["importId"])

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
                "id": "radar-lru",
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
                "objectId": "radar-lru",
                "fieldPath": "objects.equipmentAssets[1].name",
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
            "objects.equipmentAssets[1].name",
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
            self.api.save_modeling_import(invalid_package)

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
            self.api.publish_modeling_import(import_package["importId"])

        self.assertEqual(publish_ctx.exception.code, "published_import_referenced")

        changed_package = copy.deepcopy(import_package)
        changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
        changed_package["objects"]["equipmentAssets"][1]["quantity"] = 2
        saved = self.api.save_modeling_import(changed_package)
        stored = self.api.get_modeling_import(import_package["importId"])

        self.assertEqual(saved["status"], "draft")
        self.assertEqual(stored["draftPackage"]["objects"]["equipmentAssets"][1]["quantity"], 2)
        self.assertEqual(stored["publishedPackage"]["objects"]["equipmentAssets"][1]["quantity"], 1)

        with self.assertRaises(BackendApiError) as republish_ctx:
            self.api.publish_modeling_import(import_package["importId"])

        self.assertEqual(republish_ctx.exception.code, "published_import_referenced")

    def test_compile_modeling_import_scenario_uses_persisted_published_snapshot_after_new_draft(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        self.api.save_modeling_import(import_package)
        self.api.publish_modeling_import(import_package["importId"])

        changed_package = copy.deepcopy(import_package)
        changed_package["lifecycle"] = {"state": "draft", "version": 2, "referencedRunIds": []}
        changed_package["objects"]["equipmentAssets"][1]["quantity"] = 2
        self.api.save_modeling_import(changed_package)

        compiled = self.api.compile_modeling_import_scenario(import_package["importId"])

        self.assertEqual(compiled["compiled_from_import"]["import_version"], 1)
        self.assertEqual(compiled["project"]["project_version"], "import-v1")
        self.assertEqual(
            next(component for component in compiled["project"]["components"] if component["id"] == "radar-lru")["quantity"],
            1,
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
            self.api.save_modeling_import(import_package)

        self.assertEqual(save_ctx.exception.code, "invalid_modeling_import")

    def test_modeling_import_api_accepts_json_schema_integer_version_semantics(self) -> None:
        import_package = self._fixture("modeling_import_project.json")
        import_package["lifecycle"]["version"] = 1.0

        validation = self.api.validate_modeling_import(import_package)

        self.assertTrue(validation["ok"])


if __name__ == "__main__":
    unittest.main()
