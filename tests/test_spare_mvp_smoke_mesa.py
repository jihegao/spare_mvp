from __future__ import annotations

import unittest
import json
from pathlib import Path

from src.spare_mvp_abm.model import SpareMvpModel
from src.spare_mvp_abm.smoke_model import SmokeSpareMvpModel


REPO_ROOT = Path(__file__).resolve().parents[1]


class SpareMvpSmokeMesaTest(unittest.TestCase):
    def test_smoke_model_is_explicit_runtime_for_project_level_smokes(self) -> None:
        scenario_paths = [
            REPO_ROOT / "scenarios" / "spare-planning-smoke" / "experiment.json",
            REPO_ROOT / "scenarios" / "mission-reliability-smoke" / "experiment.json",
        ]

        for scenario_path in scenario_paths:
            with self.subTest(scenario=scenario_path.name):
                config = json.loads(scenario_path.read_text(encoding="utf-8"))
                self.assertEqual(config["model_class"], "SmokeSpareMvpModel")
                self.assertIn("projectJsonPath", config["parameters"])
                self.assertNotIn("equipment_count", config["parameters"])
                self.assertNotIn("initial_spare_stock", config["parameters"])

        self.assertIs(SpareMvpModel, SmokeSpareMvpModel)

    def test_model_inputs_are_derived_from_frontend_project_data(self) -> None:
        project_data = {
            "scenarioId": "unit-project",
            "activeModule": "sparePlanning",
            "experiment": {"seed": 9001, "steps": 12},
            "missionProfile": {"repeatCycleHours": 4},
            "basicMission": {
                "minRequiredSorties": 3,
                "taskDurationMinutes": 120,
            },
            "equipment": {
                "model": "A-Prototype",
                "quantity": 5,
                "initialReady": 4,
            },
            "components": [
                {"id": "engine", "name": "发动机", "spareType": "发动机备件", "failureRate": 0.10},
                {"id": "avionics", "name": "航电", "spareType": "航电模块", "failureRate": 0.02},
            ],
            "supportNodes": [
                {
                    "id": "deck-airport",
                    "equipmentCapacity": 2,
                    "inventory": {"发动机备件": 4, "航电模块": 6},
                }
            ],
            "supportActivities": [
                {"id": "corrective", "activityType": "修复性维修", "durationHours": 5}
            ],
        }

        model = SmokeSpareMvpModel(
            projectData=project_data,
            spareMultiplier=0.5,
            supportCapacity=3,
            minRequiredSorties=2,
            seed=23,
        )

        self.assertEqual(model.project_id, "unit-project")
        self.assertEqual(len(model.equipment), 5)
        self.assertEqual(sum(1 for item in model.equipment if item.status == "ready"), 4)
        self.assertEqual(model.min_required_sorties, 2)
        self.assertEqual(model.initial_spare_stock, 5)
        self.assertEqual(model.spare_stock, 5)
        self.assertEqual(model.support_capacity, 3)
        self.assertAlmostEqual(model.failure_rate, 0.06)
        self.assertEqual(model.repair_duration, 5)
        self.assertEqual(model.sortie_duration, 2)
        self.assertEqual(model.wave_interval, 4)

    def test_legacy_scalar_inputs_are_not_accepted(self) -> None:
        with self.assertRaises(TypeError):
            SmokeSpareMvpModel(equipment_count=4, initial_spare_stock=3)

    def test_model_snapshot_does_not_require_project_ontology(self) -> None:
        model = SmokeSpareMvpModel(
            projectJsonPath=str(REPO_ROOT / "scenarios" / "frontend-project-smoke" / "project.json"),
            seed=23,
        )

        for _ in range(8):
            model.step()

        snapshot = model.snapshot()
        self.assertIn("mission_success_rate", snapshot)
        self.assertIn("spare_fill_rate", snapshot)
        self.assertNotIn("ontology_entity_types", snapshot)
        self.assertNotIn("ontology_relationships", snapshot)
        self.assertFalse(hasattr(model, "ontology_mapping"))


if __name__ == "__main__":
    unittest.main()
