import unittest
from types import SimpleNamespace

from src.spare_mvp_abm.aircraft_support_v1.mission_reliability import (
    mission_period_outcome,
    period_completion_summary,
)


class MissionPeriodReliabilityTest(unittest.TestCase):
    def test_period_succeeds_only_when_every_planned_mission_succeeds(self) -> None:
        missions = [
            SimpleNamespace(success_evaluated=True, succeeded=True),
            SimpleNamespace(success_evaluated=True, succeeded=True),
            SimpleNamespace(success_evaluated=True, succeeded=True),
        ]

        outcome = mission_period_outcome(missions, duration_days=21)

        self.assertEqual(outcome["planned_missions"], 3)
        self.assertEqual(outcome["successful_missions"], 3)
        self.assertEqual(outcome["failed_missions"], 0)
        self.assertEqual(outcome["duration_days"], 21)
        self.assertTrue(outcome["period_complete"])

    def test_failed_or_unevaluated_mission_fails_the_whole_period(self) -> None:
        failed = mission_period_outcome(
            [
                SimpleNamespace(success_evaluated=True, succeeded=True),
                SimpleNamespace(success_evaluated=True, succeeded=False),
            ],
            duration_days=7,
        )
        unevaluated = mission_period_outcome(
            [
                SimpleNamespace(success_evaluated=True, succeeded=True),
                SimpleNamespace(success_evaluated=False, succeeded=False),
            ],
            duration_days=30,
        )

        self.assertFalse(failed["period_complete"])
        self.assertEqual(failed["failed_missions"], 1)
        self.assertFalse(unevaluated["period_complete"])
        self.assertEqual(unevaluated["evaluated_missions"], 1)

    def test_summary_uses_every_executed_sample_as_denominator(self) -> None:
        summary = period_completion_summary(
            [
                {"period_outcome": {"duration_days": 3, "planned_missions": 2, "evaluated_missions": 2, "successful_missions": 2}},
                {"period_outcome": {"duration_days": 14, "planned_missions": 4, "evaluated_missions": 4, "successful_missions": 3}},
                {"period_outcome": {"duration_days": 30, "planned_missions": 1, "evaluated_missions": 0, "successful_missions": 0}},
            ]
        )

        self.assertEqual(summary["total_samples"], 3)
        self.assertEqual(summary["successful_samples"], 1)
        self.assertEqual(summary["failed_samples"], 2)
        self.assertAlmostEqual(summary["completion_probability"], 1 / 3)
        self.assertEqual(summary["duration_days"], 30)


if __name__ == "__main__":
    unittest.main()
