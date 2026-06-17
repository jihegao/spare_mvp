from __future__ import annotations

import unittest
import json
from pathlib import Path

from src.spare_mvp_abm.model import SpareMvpModel
from src.spare_mvp_abm.smoke_model import SmokeSpareMvpModel


REPO_ROOT = Path(__file__).resolve().parents[1]


class SpareMvpOntologyMesaTest(unittest.TestCase):
    def test_smoke_model_is_explicit_runtime_for_project_level_smokes(self) -> None:
        scenario_paths = [
            REPO_ROOT / "scenarios" / "spare-planning-smoke" / "experiment.json",
            REPO_ROOT / "scenarios" / "mission-reliability-smoke" / "experiment.json",
        ]

        for scenario_path in scenario_paths:
            with self.subTest(scenario=scenario_path.name):
                config = json.loads(scenario_path.read_text(encoding="utf-8"))
                self.assertEqual(config["model_class"], "SmokeSpareMvpModel")

        self.assertIs(SpareMvpModel, SmokeSpareMvpModel)

    def test_model_exposes_ontology_mapping_contract(self) -> None:
        model = SmokeSpareMvpModel(
            ontology_path=str(REPO_ROOT / "ontology" / "spare_mvp.ontology.json"),
            equipment_count=4,
            min_required_sorties=2,
            initial_spare_stock=3,
            failure_rate=0.25,
            support_capacity=1,
            seed=23,
        )

        for _ in range(8):
            model.step()

        snapshot = model.snapshot()
        self.assertEqual(snapshot["ontology_entity_types"], 8.0)
        self.assertEqual(snapshot["ontology_relationships"], 13.0)
        self.assertEqual(snapshot["ontology_bound_entities"], 6.0)
        self.assertGreaterEqual(snapshot["ontology_simulated_entity_types"], 5.0)
        self.assertGreaterEqual(snapshot["ontology_simulated_relationships"], 6.0)

        contract = model.ontology_mapping()
        self.assertIn("equipment", contract["simulated_entity_types"])
        self.assertIn("support_activity", contract["simulated_entity_types"])
        self.assertIn("equipment_creates_support_activity", contract["simulated_relationships"])
        self.assertIn("activity_updates_inventory", contract["simulated_relationships"])
        self.assertEqual(contract["development_mode"], "Simulation-Contract-First Development")


if __name__ == "__main__":
    unittest.main()
