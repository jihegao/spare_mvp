from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_SCRIPT = REPO_ROOT / "local-skills" / "aircraft-support-v1-project" / "scripts" / "aircraft_support_v1_project.py"


def _load_skill_module():
    spec = importlib.util.spec_from_file_location("aircraft_support_v1_project_skill", SKILL_SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load skill script from {SKILL_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AircraftSupportV1ProjectSkillTest(unittest.TestCase):
    def _project(self) -> dict:
        return json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "clean_projects" / "minimal_clean_project.json").read_text(
                encoding="utf-8"
            )
        )

    def test_lists_and_selects_backend_project_from_sqlite_without_repository_imports(self) -> None:
        skill = _load_skill_module()
        self.assertFalse(skill.uses_formal_project_path())

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "spare_mvp.sqlite3"
            project = self._project()
            self._insert_project(db_path, project)

            catalog = skill.list_backend_projects(db_path)
            self.assertEqual([entry["project_id"] for entry in catalog], [project["project_id"]])
            self.assertEqual(catalog[0]["scenario_id"], project["scenarioId"])

            selected = skill.load_backend_project(db_path, project["project_id"])
            self.assertEqual(selected["project_id"], project["project_id"])

    def test_saves_modified_project_as_new_template_without_overwriting_source(self) -> None:
        skill = _load_skill_module()

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "spare_mvp.sqlite3"
            project = self._project()
            self._insert_project(db_path, project)
            modified = json.loads(json.dumps(project))
            modified.setdefault("projectInfo", {})["name"] = "修改后的模板案例"
            modified["supportActivityJobs"][0]["workName"] = "模板维修作业"

            saved = skill.save_project_template(
                db_path,
                modified,
                template_id="project-carrier-template-local",
                template_name="本地案例模板",
            )

            self.assertEqual(saved["status"], "saved")
            self.assertEqual(saved["project_id"], "project-carrier-template-local")
            source = skill.load_backend_project(db_path, project["project_id"])
            template = skill.load_backend_project(db_path, "project-carrier-template-local")
            self.assertEqual(source["project_id"], project["project_id"])
            self.assertEqual(source.get("projectInfo", {}).get("name"), project.get("projectInfo", {}).get("name"))
            self.assertEqual(template["project_id"], "project-carrier-template-local")
            self.assertNotEqual(template["scenarioId"], project["scenarioId"])
            self.assertTrue(template["projectInfo"]["isTemplate"])
            self.assertTrue(template["projectInfo"]["is_template"])
            self.assertEqual(template["projectInfo"]["name"], "本地案例模板")
            self.assertEqual(template["projectInfo"]["sourceProjectId"], project["project_id"])
            self.assertEqual(template["supportActivityJobs"][0]["workName"], "模板维修作业")

    def test_save_template_cli_rejects_existing_template_id_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "spare_mvp.sqlite3"
            project = self._project()
            self._insert_project(db_path, project)
            project_path = Path(tmp) / "project.json"
            project_path.write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")

            first = subprocess.run(
                [
                    sys.executable,
                    str(SKILL_SCRIPT),
                    "save-template",
                    "--db",
                    str(db_path),
                    "--project-json",
                    str(project_path),
                    "--template-id",
                    "project-cli-template",
                    "--template-name",
                    "CLI 模板",
                ],
                check=True,
                text=True,
                capture_output=True,
            )
            self.assertEqual(json.loads(first.stdout)["project_id"], "project-cli-template")

            second = subprocess.run(
                [
                    sys.executable,
                    str(SKILL_SCRIPT),
                    "save-template",
                    "--db",
                    str(db_path),
                    "--project-json",
                    str(project_path),
                    "--template-id",
                    "project-cli-template",
                ],
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("already exists", second.stderr)

    def test_remembers_modeling_table_structure_and_explains_four_domains(self) -> None:
        skill = _load_skill_module()
        project = self._project()

        with tempfile.TemporaryDirectory() as tmp:
            memory_path = Path(tmp) / "schema-memory.json"
            memory = skill.remember_project_structure(project, memory_path=memory_path, project_source="unit-test")

            self.assertTrue(memory_path.exists())
            self.assertEqual(memory["project_id"], project["project_id"])
            self.assertIn("basicMissions", memory["tables"])
            self.assertIn("basicMissions.missionPhases", memory["tables"])
            self.assertIn("products", memory["tables"])
            self.assertIn("components", memory["tables"])
            self.assertIn("supportActivityJobs", memory["tables"])
            self.assertIn("durationMinutes", memory["tables"]["basicMissions.missionPhases"]["fields"])
            self.assertIn("durationHours", memory["tables"]["missionProfile"]["fields"])

            explanation = skill.explain_project(project, memory=memory)
            self.assertEqual(list(explanation), ["任务", "装备", "保障组织", "保障活动"])
            self.assertIn("basicMissions.missionPhases", explanation["任务"]["tables"])
            self.assertGreaterEqual(explanation["任务"]["row_count"], 1)
            self.assertGreaterEqual(explanation["装备"]["row_count"], 1)
            self.assertGreaterEqual(explanation["保障组织"]["row_count"], 1)
            self.assertGreaterEqual(explanation["保障活动"]["row_count"], 1)

    def test_compiles_activity_level_spares_without_deprecated_strategy_payload(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        activity = project["supportActivities"][0]
        activity.update(
            {
                "spareQuantity": 2,
                "calendarDayInterval": 7,
                "runHourInterval": 12,
                "takeoffLandingInterval": 3,
                "floatRatio": 0.2,
                "transportStrategies": [{"from": "node-a", "to": "node-a", "productId": "product-whole-aircraft"}],
                "organizationStrategies": [{"supportLevel": "base", "supportNodeId": "node-a"}],
            }
        )
        project["supportActivityJobs"][0].update({"name": "Inspect pump", "durationMinutes": 45})

        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)

        compiled_activity = inputs["support_activities"]["activities"][0]
        self.assertNotIn("spare_type", compiled_activity)
        self.assertEqual(compiled_activity["spare_quantity"], 2)
        self.assertEqual(compiled_activity["calendarDayInterval"], 7)
        self.assertEqual(compiled_activity["runHourInterval"], 12)
        self.assertEqual(compiled_activity["takeoffLandingInterval"], 3)
        self.assertEqual(compiled_activity["floatRatio"], 0.2)
        self.assertNotIn("transport_strategies", compiled_activity)
        self.assertNotIn("organization_strategies", compiled_activity)
        self.assertEqual(compiled_activity["jobs"][0]["activityCode"], "job-1")
        self.assertEqual(compiled_activity["jobs"][0]["workName"], "Inspect pump")

    def test_compiles_canonical_organization_for_vertical_runtime_dispatch(self) -> None:
        skill = _load_skill_module()
        project = self._project()

        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)

        graph = inputs["support_network"]["organization_graph"]
        self.assertEqual(graph["nodes"][0]["id"], "node-a")
        self.assertEqual(inputs["support_network"]["nodes"][0]["organization_node_id"], "node-a")
        self.assertEqual(graph["lateral_edges"], [])

    def test_compiles_enabled_direct_lateral_relation_for_vertical_lateral_runtime(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        leaf = project["supportOrganization"]["tree"]
        project["supportOrganization"] = {
            "runtimeMode": "vertical_lateral",
            "tree": {
                "id": "org-root",
                "name": "root",
                "serviceScope": {
                    "airportIds": [],
                    "aircraftModels": [],
                    "productIds": [],
                    "resourceTypes": [],
                },
                "children": [
                    leaf,
                    {
                        "id": "node-b",
                        "name": "node B",
                        "serviceScope": {
                            "airportIds": [],
                            "aircraftModels": [],
                            "productIds": [],
                            "resourceTypes": [],
                        },
                        "children": [],
                    },
                ],
            },
            "relations": [{
                "id": "lateral-b-a",
                "type": "lateral",
                "fromOrganizationNodeId": "node-b",
                "toOrganizationNodeId": "node-a",
                "priority": 1,
                "enabled": True,
            }],
        }
        project["supportNodes"].append({
            "id": "node-b",
            "name": "node B",
            "organizationNodeId": "node-b",
            "personnelCapacity": 1,
            "equipmentCapacity": 1,
            "inventory": {"product-whole-aircraft": 1},
        })
        project["transportPolicies"] = [{
            "id": "policy-b-a",
            "fromOrganizationNodeId": "node-b",
            "toOrganizationNodeId": "node-a",
            "productId": "product-whole-aircraft",
            "capacity": 1,
            "priority": 1,
            "transportTimeHours": 0,
        }]
        project["supportActivities"][0]["resourceId"] = "node A"

        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)

        graph = inputs["support_network"]["organization_graph"]
        self.assertEqual(graph["runtime_mode"], "vertical_lateral")
        self.assertEqual(graph["lateral_edges"], [{
            "id": "lateral-b-a",
            "from_node_id": "node-b",
            "to_node_id": "node-a",
            "priority": 1,
            "enabled": True,
        }])

    def test_compiles_canonical_pre_life_and_blocks_missing_threshold_without_legacy_hour_fallback(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        member = project["combatUnit"]["members"][0]
        member.update({
            "preLifeCalendarDays": 1,
            "preLifeFlightHours": 2.5,
            "preLifeTakeoffLandingCount": 3,
            "preLifeRequirementHours": 999,
            "remainingLifeHours": 888,
        })
        project["supportActivities"].append({
            "id": "preventive",
            "activityType": "preventive",
            "planType": "预防性维修方案",
            "aircraftModel": "J-15",
            "equipmentId": "whole-aircraft",
            "calendarDayInterval": 2,
            "runHourInterval": 4.5,
            "takeoffLandingInterval": 6,
            "activityCodes": ["job-1"],
            "predecessors": {"job-1": []},
        })

        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)

        self.assertEqual(inputs["aircraft"]["assets"][0]["initial_life_state"], {
            "calendar_days": 1,
            "flight_hours": 2.5,
            "takeoff_landing_cycles": 3,
        })
        project["supportActivities"][-1]["runHourInterval"] = 0
        with self.assertRaisesRegex(ValueError, r"combatUnit\.members\[0\]\.preLifeFlightHours"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

        member.update({
            "preLifeCalendarDays": 0,
            "preLifeFlightHours": 0,
            "preLifeTakeoffLandingCount": 0,
        })
        project["supportActivities"][-1]["runHourInterval"] = 4.5
        conflict = json.loads(json.dumps(project["supportActivities"][-1]))
        conflict["id"] = "preventive-conflict"
        conflict["runHourInterval"] = 5
        project["supportActivities"].append(conflict)
        with self.assertRaisesRegex(ValueError, r"supportActivities\[2\]\.runHourInterval"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

    def test_compiles_canonical_maintenance_plan_scope_and_historical_default(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        activity = project["supportActivities"][0]
        activity.update({"aircraftModel": "J-20", "equipmentId": "component-engine"})

        historical = skill.compile_project_json_to_aircraft_support_inputs(project)
        compiled = historical["support_activities"]["activities"][0]
        self.assertEqual(compiled["maintenance_methods"], ["non_replacement"])
        self.assertEqual(compiled["replacement_ratio"], 0.0)
        self.assertEqual(compiled["aircraft_model"], "J-20")
        self.assertEqual(compiled["equipment_id"], "component-engine")
        self.assertEqual(
            compiled["maintenance_plan_source"],
            {
                "activity_id": "corrective",
                "aircraft_model": "J-20",
                "equipment_id": "component-engine",
            },
        )
        self.assertEqual(compiled["jobs"][0]["predecessors"], [])

        project["supportActivities"].append(
            {
                "id": "preflight",
                "activityType": "飞行前保障",
                "planType": "使用保障方案",
                "activityCodes": [],
                "predecessors": {},
            }
        )
        with_operations = skill.compile_project_json_to_aircraft_support_inputs(project)
        compiled_operations = with_operations["support_activities"]["activities"][1]
        self.assertNotIn("maintenance_methods", compiled_operations)
        self.assertNotIn("replacement_ratio", compiled_operations)

        activity.update(
            {
                "maintenanceMethods": ["non_replacement", "replacement"],
                "replacementRatio": 0.35,
            }
        )
        canonical = skill.compile_project_json_to_aircraft_support_inputs(project)
        self.assertEqual(
            canonical["support_activities"]["activities"][0]["maintenance_methods"],
            ["non_replacement", "replacement"],
        )
        self.assertEqual(canonical["support_activities"]["activities"][0]["replacement_ratio"], 0.35)

    def test_migrates_only_exact_legacy_maintenance_type_and_rejects_conflicts(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        activity = project["supportActivities"][0]
        activity["repairType"] = "换件维修"

        migrated = skill.compile_project_json_to_aircraft_support_inputs(project)
        self.assertEqual(
            migrated["support_activities"]["activities"][0]["maintenance_methods"],
            ["replacement"],
        )
        self.assertEqual(migrated["support_activities"]["activities"][0]["replacement_ratio"], 1.0)

        activity["repairType"] = "未知维修"
        with self.assertRaisesRegex(ValueError, "unsupported legacy repairType"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

        activity.update(
            {
                "repairType": "原位维修",
                "maintenanceMethods": ["replacement"],
                "replacementRatio": 1,
            }
        )
        with self.assertRaisesRegex(ValueError, "conflicts with canonical"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

        preventive = self._project()
        preventive_activity = preventive["supportActivities"][0]
        preventive_activity.update({
            "activityType": "预防性维修",
            "planType": "预防性维修方案",
            "repairType": "换件维修",
        })
        with self.assertRaisesRegex(ValueError, "only supported for corrective maintenance"):
            skill.compile_project_json_to_aircraft_support_inputs(preventive)

    def test_maintenance_plan_precision_and_type_scope_fail_closed(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        activity = project["supportActivities"][0]
        activity.update({
            "maintenanceMethods": ["non_replacement", "replacement"],
            "replacementRatio": 0.1234,
        })
        compiled = skill.compile_project_json_to_aircraft_support_inputs(project)
        self.assertEqual(compiled["support_activities"]["activities"][0]["replacement_ratio"], 0.1234)

        activity["replacementRatio"] = 0.12345
        with self.assertRaisesRegex(ValueError, "at most four decimal places"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

        activity.update({"activityType": "使用保障", "planType": "使用保障方案", "name": "repair-looking-name"})
        with self.assertRaisesRegex(ValueError, "only valid on corrective or preventive activities"):
            skill.compile_project_json_to_aircraft_support_inputs(project)

    def test_compiles_missing_or_zero_spare_quantity_as_zero(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        activity = project["supportActivities"][0]
        activity.pop("spareQuantity", None)

        missing_quantity_inputs = skill.compile_project_json_to_aircraft_support_inputs(project)
        self.assertEqual(missing_quantity_inputs["support_activities"]["activities"][0]["spare_quantity"], 0)

        activity["spareQuantity"] = 0
        zero_quantity_inputs = skill.compile_project_json_to_aircraft_support_inputs(project)
        self.assertEqual(zero_quantity_inputs["support_activities"]["activities"][0]["spare_quantity"], 0)

    def test_nested_support_node_transport_policies_are_remembered_explained_and_compiled(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        project["transportPolicies"] = []
        project["supportNodes"][0]["transportPolicies"] = [
            {
                "id": "nested-tp-1",
                "fromSupportNodeId": "node-a",
                "toSupportNodeId": "node-a",
                "productId": "product-whole-aircraft",
                "capacity": 3,
                "priority": 2,
                "transportTimeHours": 1.5,
            }
        ]

        with tempfile.TemporaryDirectory() as tmp:
            memory = skill.remember_project_structure(
                project,
                memory_path=Path(tmp) / "schema-memory.json",
                project_source="unit-test",
            )
        explanation = skill.explain_project(project, memory=memory)
        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)

        self.assertIn("supportNodes.transportPolicies", memory["tables"])
        self.assertIn("productId", memory["tables"]["supportNodes.transportPolicies"]["fields"])
        self.assertIn("supportNodes.transportPolicies", explanation["保障组织"]["tables"])
        self.assertEqual(
            inputs["support_network"]["nodes"][0]["transport_policies"],
            [
                {
                    "from": "node A",
                    "to": "node A",
                    "productId": "product-whole-aircraft",
                    "capacity": 3,
                    "priority": 2,
                    "transportTimeHours": 1.5,
                }
            ],
        )

    def test_compiles_canonical_organization_ownership_and_transport_endpoints(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        project["supportNodes"].append(
            {"id": "node-b", "name": "node B", "organizationNodeId": "org-b"}
        )
        project["supportNodes"][0]["organizationNodeId"] = "org-a"
        project["supportResources"][0].pop("supportNodeName", None)
        project["supportResources"][0]["organizationNodeId"] = "org-a"
        project["supportActivities"][0]["resourceId"] = "node A"
        project["transportPolicies"] = [
            {
                "id": "tp-canonical",
                "fromOrganizationNodeId": "org-a",
                "toOrganizationNodeId": "org-b",
                "capacity": 2,
                "priority": 1,
                "transportTimeHours": 3,
            }
        ]

        inputs = skill.compile_project_json_to_aircraft_support_inputs(project)
        nodes = {node["name"]: node for node in inputs["support_network"]["nodes"]}

        self.assertEqual(nodes["node A"]["personnel_capacity"], 2)
        self.assertEqual(nodes["node B"]["transport_policies"][0]["from"], "node A")
        self.assertEqual(nodes["node B"]["transport_policies"][0]["to"], "node B")

    def test_compiles_project_json_and_runs_aircraft_support_v1_without_simulation_adapter(self) -> None:
        skill = _load_skill_module()
        project = self._project()
        project["basicMissions"][0]["missionAreas"] = [{"id": "nested-basic-area"}]
        project["missionProfile"]["compositeTasks"] = [{"id": "composite-a", "mission_areas": [{"id": "nested-composite-area"}]}]
        project["supportActivityJobs"][0]["missionAreas"] = [{"id": "nested-job-area"}]
        project["supportActivities"][0]["transportStrategies"] = [{"missionAreas": [{"id": "nested-strategy-area"}]}]

        inputs = skill.compile_project_json_to_aircraft_support_inputs(
            project,
            runtime_config={"duration_minutes": 60, "sample_every_minutes": 15, "seed": 7},
        )

        self.assertEqual(inputs["schema_version"], "aircraft-support-v1-input-v0")
        self.assertEqual(inputs["project_identity"]["project_id"], project["project_id"])
        self.assertNotIn("mission_areas", inputs["mission_profile"])
        serialized_inputs = json.dumps(inputs, ensure_ascii=False)
        self.assertNotIn("missionAreas", serialized_inputs)
        self.assertNotIn("mission_areas", serialized_inputs)
        self.assertNotIn("reliability_block_diagram", inputs)
        self.assertEqual(inputs["aircraft"]["fleet_count"], 1)
        self.assertEqual(inputs["support_activities"]["activities"][0]["jobs"][0]["activityCode"], "job-1")

        result = skill.run_aircraft_support_v1_project(
            project,
            repo_root=REPO_ROOT,
            runtime_config={"duration_minutes": 60, "sample_every_minutes": 15, "seed": 7},
        )

        self.assertEqual(result["model_family"], "aircraft_support_v1")
        self.assertEqual(result["project_id"], project["project_id"])
        self.assertIn("metrics", result)
        self.assertIn("frames", result)
        self.assertGreaterEqual(len(result["frames"]), 2)

    def _insert_project(self, db_path: Path, project: dict) -> None:
        connection = sqlite3.connect(db_path)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
              project_id TEXT PRIMARY KEY,
              schema_version TEXT,
              project_version TEXT,
              scenario_id TEXT,
              active_module TEXT,
              payload_json TEXT NOT NULL,
              updated_at TEXT
            )
            """
        )
        connection.execute(
            """
            INSERT INTO projects (
              project_id, schema_version, project_version, scenario_id, active_module, payload_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project["project_id"],
                project["schema_version"],
                project["project_version"],
                project.get("scenarioId"),
                project["activeModule"],
                json.dumps(project, ensure_ascii=False),
                "2026-07-08T00:00:00Z",
            ),
        )
        connection.commit()
        connection.close()


if __name__ == "__main__":
    unittest.main()
