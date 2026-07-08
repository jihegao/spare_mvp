import unittest

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.solara_app import INITIAL_INPUTS


class AircraftSupportV1SolaraTest(unittest.TestCase):
    def test_model_step_advances_for_solara_controller(self) -> None:
        inputs = dict(INITIAL_INPUTS)
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
        model = AircraftSupportV1Model(INITIAL_INPUTS)

        self.assertGreater(len(model.aircraft), 0)
        self.assertGreater(model.duration_minutes, 0)
        self.assertTrue(hasattr(model, "step"))
        self.assertTrue(hasattr(model, "running"))


if __name__ == "__main__":
    unittest.main()
