import unittest
from unittest.mock import patch

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.solara_app import _model_inputs


class AircraftSupportV1SolaraTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.default_inputs, cls.default_source = _model_inputs()

    def test_model_step_advances_for_solara_controller(self) -> None:
        inputs = dict(self.default_inputs)
        inputs["time"] = {**inputs.get("time", {}), "duration_minutes": 3, "tick_minutes": 1}
        model = AircraftSupportV1Model(inputs)

        self.assertTrue(model.running)
        self.assertEqual(model.minute, 0)
        self.assertTrue(model.step())
        self.assertEqual(model.minute, 1)
        self.assertEqual(model.time, 1)
        self.assertEqual(model.steps, 1)

        model.step()
        model.step()
        self.assertFalse(model.running)
        self.assertFalse(model.step())
        self.assertEqual(model.minute, 3)

    def test_solara_default_inputs_create_nonempty_model(self) -> None:
        model = AircraftSupportV1Model(self.default_inputs)

        self.assertGreater(len(model.aircraft), 0)
        self.assertGreater(model.duration_minutes, 0)
        self.assertTrue(hasattr(model, "step"))
        self.assertTrue(hasattr(model, "running"))

    def test_model_inputs_can_load_backend_project_by_query_project_id(self) -> None:
        project = dict(self.default_source["project"])
        project["project_id"] = "project-from-frontend-modeling"

        with patch(
            "src.spare_mvp_abm.aircraft_support_v1.solara_app._load_backend_project_json",
            return_value=project,
        ) as loader:
            inputs, source = _model_inputs("project-from-frontend-modeling")

        loader.assert_called_once_with("project-from-frontend-modeling")
        self.assertEqual(source["source"], "backend_project")
        self.assertEqual(inputs["source_context"]["source"], "backend_project")
        self.assertEqual(inputs["source_context"]["project_id"], "project-from-frontend-modeling")

    def test_model_inputs_fail_closed_when_backend_project_is_unavailable(self) -> None:
        with patch(
            "src.spare_mvp_abm.aircraft_support_v1.solara_app._load_backend_project_json",
            side_effect=RuntimeError("backend unavailable"),
        ):
            with self.assertRaisesRegex(RuntimeError, "backend unavailable"):
                _model_inputs("missing-project")


if __name__ == "__main__":
    unittest.main()
