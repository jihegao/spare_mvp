from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter


REPO_ROOT = Path(__file__).resolve().parents[1]


class SupportOrganizationContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = SimulationAdapter(REPO_ROOT)

    def _project(self) -> dict:
        project = json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "aircraft_support_v1_project.json").read_text(
                encoding="utf-8"
            )
        )
        project["airports"] = [
            {"id": "airport-a", "name": "A"},
            {"id": "airport-b", "name": "B"},
        ]
        project["supportOrganization"] = {
            "tree": {
                "id": "org-root",
                "name": "总保障中心",
                "serviceScope": {
                    "airportIds": [],
                    "aircraftModels": [],
                    "productIds": [],
                },
                "children": [
                    {
                        "id": "org-b",
                        "name": "乙保障站",
                        "serviceScope": {
                            "airportIds": ["airport-b"],
                            "aircraftModels": ["J-15"],
                            "productIds": ["product-whole-aircraft"],
                        },
                        "children": [],
                    },
                    {
                        "id": "org-a",
                        "name": "甲保障站",
                        "serviceScope": {
                            "airportIds": ["airport-a"],
                            "aircraftModels": ["J-15"],
                            "productIds": ["product-whole-aircraft"],
                        },
                        "children": [],
                    },
                ],
            },
            "relations": [
                {
                    "id": "lateral-a-b",
                    "type": "lateral",
                    "fromOrganizationNodeId": "org-a",
                    "toOrganizationNodeId": "org-b",
                    "priority": 2,
                }
            ],
        }
        project["supportNodes"] = [
            {
                "id": "support-a",
                "name": "node A",
                "organizationNodeId": "org-a",
            },
            {
                "id": "support-b",
                "name": "node B",
                "organizationNodeId": "org-b",
            },
        ]
        project["supportResources"] = [
            {
                "id": "resource-personnel",
                "supportNodeName": "node A",
                "organizationNodeId": "org-a",
                "type": "personnel",
                "name": "甲站机务人员",
                "quantity": 2,
            },
            {
                "id": "resource-equipment",
                "supportNodeName": "node B",
                "organizationNodeId": "org-b",
                "type": "equipment",
                "name": "乙站检测设备",
                "quantity": 1,
            },
            {
                "id": "resource-spare",
                "supportNodeName": "node A",
                "organizationNodeId": "org-a",
                "type": "spare",
                "name": "整机备件",
                "productId": "product-whole-aircraft",
                "quantity": 3,
            },
        ]
        project["transportPolicies"] = [
            {
                "id": "policy-a-b",
                "fromOrganizationNodeId": "org-a",
                "toOrganizationNodeId": "org-b",
                "productId": "product-whole-aircraft",
                "capacity": 2,
                "priority": 3,
                "transportTimeHours": 1.5,
            }
        ]
        for activity in project["supportActivities"]:
            activity["resourceId"] = "node A"
        return project

    def _organization_graph(self, project: dict) -> dict:
        # Arrange is performed by each caller through _project/mutations.
        # Act.
        scenario = self.adapter.compile_scenario(project)

        # Assert the graph exists at the single canonical Scenario boundary.
        return scenario["simulation_inputs"]["support_network"]["organization_graph"]

    def _assert_blocked_at(self, project: dict, field_path: str) -> None:
        # Act.
        result = self.adapter.compile_scenario_with_gate(project)

        # Assert.
        self.assertEqual(result["status"], "blocked")
        matching = [
            issue
            for issue in result["issues"]
            if issue.get("category") == "invalid_support_organization"
        ]
        self.assertTrue(matching, result["issues"])
        self.assertEqual(matching[0]["field_path"], field_path)

    def test_canonical_single_root_compiles_stable_organization_graph(self) -> None:
        # Arrange.
        project = self._project()

        # Act.
        graph = self._organization_graph(project)

        # Assert.
        self.assertEqual(
            graph["nodes"],
            [
                {
                    "id": "org-a",
                    "name": "甲保障站",
                    "parent_id": "org-root",
                    "service_scope": {
                        "airport_ids": ["airport-a"],
                        "aircraft_models": ["J-15"],
                        "product_ids": ["product-whole-aircraft"],
                        "resource_types": [],
                    },
                },
                {
                    "id": "org-b",
                    "name": "乙保障站",
                    "parent_id": "org-root",
                    "service_scope": {
                        "airport_ids": ["airport-b"],
                        "aircraft_models": ["J-15"],
                        "product_ids": ["product-whole-aircraft"],
                        "resource_types": [],
                    },
                },
                {
                    "id": "org-root",
                    "name": "总保障中心",
                    "parent_id": None,
                    "service_scope": {
                        "airport_ids": [],
                        "aircraft_models": [],
                        "product_ids": [],
                        "resource_types": [],
                    },
                },
            ],
        )

        self.assertEqual(
            graph["parent_edges"],
            [
                {"from_node_id": "org-root", "to_node_id": "org-a"},
                {"from_node_id": "org-root", "to_node_id": "org-b"},
            ],
        )
        self.assertEqual(
            graph["lateral_edges"],
            [
                {
                    "id": "lateral-a-b",
                    "from_node_id": "org-a",
                    "to_node_id": "org-b",
                    "priority": 2,
                }
            ],
        )
        self.assertEqual(
            graph["resource_ownership"],
            [
                {
                    "resource_id": "resource-equipment",
                    "resource_type": "equipment",
                    "organization_node_id": "org-b",
                },
                {
                    "resource_id": "resource-personnel",
                    "resource_type": "personnel",
                    "organization_node_id": "org-a",
                },
                {
                    "resource_id": "resource-spare",
                    "resource_type": "spare",
                    "organization_node_id": "org-a",
                },
            ],
        )
        self.assertEqual(
            graph["transport_policies"],
            [
                {
                    "id": "policy-a-b",
                    "from_organization_node_id": "org-a",
                    "to_organization_node_id": "org-b",
                    "product_id": "product-whole-aircraft",
                    "capacity": 2,
                    "priority": 3,
                    "transport_time_hours": 1.5,
                }
            ],
        )

    def test_empty_support_resource_ids_block_in_either_input_order(self) -> None:
        for reverse in (False, True):
            with self.subTest(reverse=reverse):
                project = self._project()
                resources = copy.deepcopy(project["supportResources"][:2])
                resources[0]["id"] = ""
                if reverse:
                    resources.reverse()
                project["supportResources"] = resources

                result = self.adapter.compile_scenario_with_gate(project)

                self.assertEqual(result["status"], "blocked")
                issues = [
                    issue
                    for issue in result["issues"]
                    if issue.get("code") == "missing_support_resource_id"
                ]
                self.assertEqual(len(issues), 1, result["issues"])
                expected_index = 1 if reverse else 0
                self.assertEqual(issues[0]["field_path"], f"supportResources[{expected_index}].id")

    def test_legacy_single_element_tree_array_migrates_without_changing_graph(self) -> None:
        # Arrange.
        canonical = self._project()
        legacy = copy.deepcopy(canonical)
        legacy["supportOrganization"]["tree"] = [legacy["supportOrganization"]["tree"]]

        # Act.
        canonical_graph = self._organization_graph(canonical)
        result = self.adapter.compile_scenario_with_gate(legacy)

        # Assert.
        self.assertEqual(result["status"], "compiled")
        legacy_graph = result["scenario"]["simulation_inputs"]["support_network"]["organization_graph"]
        self.assertEqual(legacy_graph, canonical_graph)
        defaults = result["scenario"]["compiled_from"]["mapping_provenance"]["defaults_applied"]
        self.assertTrue(any("supportOrganization.tree" in item for item in defaults), defaults)

    def test_multiple_tree_roots_fail_closed(self) -> None:
        # Arrange.
        project = self._project()
        project["supportOrganization"]["tree"] = [
            project["supportOrganization"]["tree"],
            {"id": "other-root", "name": "另一根", "children": []},
        ]

        # Act / Assert.
        self._assert_blocked_at(project, "supportOrganization.tree")

    def test_duplicate_organization_id_fails_at_second_declaration(self) -> None:
        # Arrange.
        project = self._project()
        project["supportOrganization"]["tree"]["children"][1]["id"] = "org-b"

        # Act / Assert.
        self._assert_blocked_at(project, "supportOrganization.tree.children[1].id")

    def test_ancestor_cycle_fails_at_recursive_child(self) -> None:
        # Arrange.
        project = self._project()
        root = project["supportOrganization"]["tree"]
        root["children"][0]["children"] = [root]

        # Act / Assert.
        self._assert_blocked_at(
            project,
            "supportOrganization.tree.children[0].children[0]",
        )

    def test_orphan_support_node_owner_fails_at_canonical_reference(self) -> None:
        # Arrange.
        project = self._project()
        project["supportNodes"][0]["organizationNodeId"] = "missing-org"

        # Act / Assert.
        self._assert_blocked_at(project, "supportNodes[0].organizationNodeId")

    def test_duplicate_name_alias_is_ambiguous_for_legacy_resource_owner(self) -> None:
        # Arrange.
        project = self._project()
        project["supportOrganization"]["tree"]["children"][0]["name"] = "同名站"
        project["supportOrganization"]["tree"]["children"][1]["name"] = "同名站"
        resource = project["supportResources"][0]
        resource.pop("organizationNodeId")
        resource["organizationNodeName"] = "同名站"

        # Act / Assert.
        self._assert_blocked_at(project, "supportResources[0].organizationNodeName")

    def test_resource_owner_alias_conflict_fails_for_each_resource_type(self) -> None:
        for resource_index, resource_type in enumerate(("personnel", "equipment", "spare")):
            with self.subTest(resource_type=resource_type):
                # Arrange.
                project = self._project()
                resource = project["supportResources"][resource_index]
                resource["organizationNodeId"] = "org-a"
                resource["organizationNodeName"] = "乙保障站"

                # Act / Assert.
                self._assert_blocked_at(
                    project,
                    f"supportResources[{resource_index}].organizationNodeName",
                )

    def test_lateral_self_duplicate_and_two_node_cycle_fail_closed(self) -> None:
        cases = []

        self_relation = self._project()
        self_relation["supportOrganization"]["relations"][0]["toOrganizationNodeId"] = "org-a"
        cases.append((self_relation, "supportOrganization.relations[0].toOrganizationNodeId"))

        duplicate = self._project()
        duplicate["supportOrganization"]["relations"].append(
            {
                "id": "lateral-a-b-copy",
                "type": "lateral",
                "fromOrganizationNodeId": "org-a",
                "toOrganizationNodeId": "org-b",
                "priority": 4,
            }
        )
        cases.append((duplicate, "supportOrganization.relations[1].toOrganizationNodeId"))

        cycle = self._project()
        cycle["supportOrganization"]["relations"].append(
            {
                "id": "lateral-b-a",
                "type": "lateral",
                "fromOrganizationNodeId": "org-b",
                "toOrganizationNodeId": "org-a",
                "priority": 4,
            }
        )
        cases.append((cycle, "supportOrganization.relations[1].toOrganizationNodeId"))

        for project, field_path in cases:
            with self.subTest(field_path=field_path):
                # Act / Assert.
                self._assert_blocked_at(project, field_path)

    def test_transport_policy_invalid_endpoints_ids_and_scope_fail_closed(self) -> None:
        cases = []

        missing_endpoint = self._project()
        del missing_endpoint["transportPolicies"][0]["toOrganizationNodeId"]
        cases.append((missing_endpoint, "transportPolicies[0].toOrganizationNodeId"))

        self_policy = self._project()
        self_policy["transportPolicies"][0]["toOrganizationNodeId"] = "org-a"
        cases.append((self_policy, "transportPolicies[0].toOrganizationNodeId"))

        alias_conflict = self._project()
        alias_conflict["transportPolicies"][0]["fromSupportNodeName"] = "node B"
        cases.append((alias_conflict, "transportPolicies[0].fromSupportNodeName"))

        duplicate_id = self._project()
        duplicate_id["transportPolicies"].append(
            {
                **duplicate_id["transportPolicies"][0],
                "fromOrganizationNodeId": "org-b",
                "toOrganizationNodeId": "org-root",
            }
        )
        cases.append((duplicate_id, "transportPolicies[1].id"))

        scope_conflict = self._project()
        scope_conflict["transportPolicies"][0]["productId"] = "product-outside-endpoint-scope"
        cases.append((scope_conflict, "transportPolicies[0].productId"))

        for project, field_path in cases:
            with self.subTest(field_path=field_path):
                # Act / Assert.
                self._assert_blocked_at(project, field_path)

    def test_sibling_order_does_not_change_compiled_graph(self) -> None:
        # Arrange.
        forward = self._project()
        reversed_siblings = copy.deepcopy(forward)
        reversed_siblings["supportOrganization"]["tree"]["children"].reverse()

        # Act.
        forward_graph = self._organization_graph(forward)
        reversed_graph = self._organization_graph(reversed_siblings)

        # Assert.
        self.assertEqual(reversed_graph, forward_graph)

    def test_organization_governance_labels_do_not_change_vertical_runtime_network_or_metrics(self) -> None:
        # Arrange.
        baseline = self._project()
        changed_organization = copy.deepcopy(baseline)
        changed_organization["supportOrganization"]["tree"]["name"] = "更名后的总保障中心"
        changed_organization["supportOrganization"]["tree"]["description"] = "治理信息变化"

        # Act.
        baseline_scenario = self.adapter.compile_scenario(baseline)
        changed_scenario = self.adapter.compile_scenario(changed_organization)
        baseline_inputs = baseline_scenario["simulation_inputs"]
        changed_inputs = changed_scenario["simulation_inputs"]
        baseline_metrics = AircraftSupportV1Model(copy.deepcopy(baseline_inputs)).run()["metrics"]
        changed_metrics = AircraftSupportV1Model(copy.deepcopy(changed_inputs)).run()["metrics"]

        # Assert.
        self.assertNotEqual(
            baseline_inputs["support_network"]["organization_graph"],
            changed_inputs["support_network"]["organization_graph"],
        )
        self.assertEqual(
            changed_inputs["support_network"]["nodes"],
            baseline_inputs["support_network"]["nodes"],
        )
        self.assertEqual(changed_metrics, baseline_metrics)

    def test_legacy_single_node_save_reload_compile_preserves_runtime_network(self) -> None:
        project = json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "aircraft_support_v1_project.json").read_text(encoding="utf-8")
        )
        project["transportPolicies"] = []
        project["supportResources"] = []
        project["supportNodes"] = [
            {
                "id": "node-a",
                "name": "node A",
                "organizationNodeId": "node-a",
                "personnelCapacity": 9,
                "equipmentCapacity": 8,
                "inventory": {"product-whole-aircraft": 7},
            }
        ]

        direct = self.adapter.compile_scenario(project)["simulation_inputs"]["support_network"]["nodes"]
        saved = ProjectJsonExporter(repo_root=REPO_ROOT).export(project)
        reloaded = json.loads(json.dumps(saved, ensure_ascii=False))
        after_reload = self.adapter.compile_scenario(reloaded)["simulation_inputs"]["support_network"]["nodes"]

        self.assertEqual(after_reload, direct)
        self.assertEqual(len(after_reload), 1)
        self.assertEqual(after_reload[0]["personnel_capacity"], 9)
        self.assertEqual(after_reload[0]["equipment_capacity"], 8)
        self.assertEqual(after_reload[0]["inventory"], {"product-whole-aircraft": 7})

    def test_no_support_data_exports_and_compiles_as_explicit_empty_graph(self) -> None:
        project = json.loads(
            (REPO_ROOT / "tests" / "fixtures" / "aircraft_support_v1_project.json").read_text(
                encoding="utf-8"
            )
        )
        project["supportNodes"] = []
        project["supportResources"] = []
        project["transportPolicies"] = []
        project.pop("supportOrganization", None)
        project["modelingImportValidation"] = {
            "usedTables": {"supportResources": False},
            "disabledDomains": ["supportResources"],
            "warnings": [],
        }

        saved = ProjectJsonExporter(repo_root=REPO_ROOT).export(project)
        graph = self.adapter.compile_scenario(saved)["simulation_inputs"]["support_network"]["organization_graph"]

        self.assertEqual(
            saved["supportOrganization"],
            {"runtimeMode": "legacy", "tree": None, "relations": []},
        )
        self.assertEqual(
            graph,
            {
                "runtime_mode": "legacy",
                "nodes": [],
                "parent_edges": [],
                "lateral_edges": [],
                "resource_ownership": [],
                "transport_policies": [],
            },
        )

    def test_node_scoped_legacy_policy_uses_host_owner_and_preserves_runtime_projection(self) -> None:
        canonical = self._project()
        expected = self.adapter.compile_scenario(canonical)["simulation_inputs"]["support_network"]["nodes"]
        legacy = copy.deepcopy(canonical)
        policy = legacy["transportPolicies"].pop()
        policy.pop("id")
        policy.pop("fromOrganizationNodeId")
        legacy["supportNodes"][0]["transportPolicies"] = [policy]

        result = self.adapter.compile_scenario_with_gate(legacy)

        self.assertEqual(result["status"], "compiled")
        self.assertEqual(result["scenario"]["simulation_inputs"]["support_network"]["nodes"], expected)
        compiled_policy = result["scenario"]["simulation_inputs"]["support_network"]["organization_graph"]["transport_policies"][0]
        self.assertRegex(compiled_policy["id"], r"^migrated-transport-[0-9a-f]{12}$")
        defaults = result["scenario"]["compiled_from"]["mapping_provenance"]["defaults_applied"]
        self.assertTrue(any("migratedHostOrganizationNodeId" in item for item in defaults), defaults)

    def test_service_scope_references_and_resource_owner_scope_fail_closed(self) -> None:
        unknown_airport = self._project()
        unknown_airport["supportOrganization"]["tree"]["children"][0]["serviceScope"]["airportIds"] = ["missing-airport"]
        self._assert_blocked_at(
            unknown_airport,
            "supportOrganization.tree.children[0].serviceScope.airportIds[0]",
        )

        resource_scope = self._project()
        resource_scope["supportOrganization"]["tree"]["children"][0]["serviceScope"]["resourceTypes"] = ["spare"]
        self._assert_blocked_at(resource_scope, "supportResources[1].type")

    def test_legacy_policy_with_business_data_never_drops_missing_or_self_route(self) -> None:
        missing_target = self._project()
        missing_target["transportPolicies"] = [{"fromOrganizationNodeId": "org-a", "capacity": 2}]
        self._assert_blocked_at(missing_target, "transportPolicies[0].toOrganizationNodeId")

        self_route = self._project()
        self_route["transportPolicies"] = [{
            "fromSupportNodeName": "node A",
            "toSupportNodeName": "node A",
            "capacity": 2,
        }]
        self._assert_blocked_at(self_route, "transportPolicies[0].toOrganizationNodeId")


if __name__ == "__main__":
    unittest.main()
