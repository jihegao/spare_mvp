from __future__ import annotations

import unittest

from independent_mesa_gpt import VisualMissionModel, load_scenario
from independent_mesa_gpt.visualization import export_frames


class VisualMissionModelTest(unittest.TestCase):
    def test_input_overrides_make_daytime_j15_wave_executable(self) -> None:
        package, changes = load_scenario()
        self.assertTrue(any(change["path"].endswith("minRequiredSystems") for change in changes))
        mission = package["objects"]["missionProfiles"][0]
        day_task = mission["compositeTasks"][0]["taskItems"][0]
        j15_count = sum(
            1
            for member in mission["combatUnit"]["members"]
            if member["model"] == "J-15"
        )
        self.assertEqual(day_task["minRequiredSystems"], j15_count)

    def test_complete_aircraft_task_lifecycle_is_visible(self) -> None:
        package, _ = load_scenario()
        model = VisualMissionModel(package, seed=20260621)
        frames = export_frames(model, steps=104, sample_every=1)
        final = frames[-1]["snapshot"]
        self.assertGreaterEqual(final["completedSorties"], 9)
        self.assertEqual(final["cancelledSorties"], 0)

        phases = {
            aircraft["phase"]
            for frame in frames
            for aircraft in frame["aircraft"]
        }
        self.assertIn("preparing", phases)
        self.assertIn("flying", phases)
        self.assertIn("recovery", phases)
        self.assertIn("ready", phases)


if __name__ == "__main__":
    unittest.main()
