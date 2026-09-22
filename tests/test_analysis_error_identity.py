from __future__ import annotations

import copy
import unittest
from unittest import mock

from tests import test_backend_api_contract as fixtures


class AnalysisErrorIdentityTest(unittest.TestCase):
    setUp = fixtures.BackendApiContractTest.setUp
    tearDown = fixtures.BackendApiContractTest.tearDown

    def test_compile_block_has_modeling_error_code_and_current_project_identity(self) -> None:
        project = fixtures.small_aircraft_support_project("identity-current")
        project["projectInfo"]["name"] = "Current Source"
        project["supportActivities"] = []

        payload = self.api.run_lite_mesa_analysis(
            project,
            analysis_type="mission_reliability",
            settings={"samples": 1},
        )

        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["error_code"], "modeling_validation_failed")
        self.assertEqual(payload["analysis_source"], {
            "kind": "current-project",
            "projectName": "Current Source",
            "projectId": "identity-current",
            "experimentPlanName": None,
            "experimentPlanId": None,
        })

    def test_all_timeout_and_all_runtime_failure_have_distinct_codes(self) -> None:
        project = fixtures.small_aircraft_support_project("identity-errors")
        failures = {
            "analysis_samples_timeout": "sample_timeout",
            "analysis_samples_failed": "sample_failed",
        }
        for expected, sample_code in failures.items():
            with self.subTest(expected=expected), mock.patch(
                "src.spare_mvp_backend.api._run_lite_mesa_analysis_samples",
                return_value=([], [{"sample_index": 0, "seed": 7, "error": {"code": sample_code, "message": "failed"}}], 1, []),
            ):
                payload = self.api.run_lite_mesa_analysis(
                    project,
                    analysis_type="mission_reliability",
                    settings={"samples": 1, "seed": 7},
                )
            self.assertEqual(payload["error_code"], expected)
            if expected == "analysis_samples_failed":
                self.assertNotIn("建模粒度不足", payload["message"])

    def test_frozen_plan_identity_is_bound_to_resolved_source(self) -> None:
        project = fixtures.small_aircraft_support_project("identity-plan")
        project["projectInfo"]["name"] = "Bound Project"
        self.api.save_project(project)
        plan = self.api.create_experiment_plan(
            project["project_id"],
            {"name": "Bound Plan", "projectJson": copy.deepcopy(project), "samples": 1, "seed": 17},
        )
        frozen = self.api.freeze_experiment_plan(project["project_id"], plan["experiment_plan_id"])
        failure = [{"sample_index": 0, "seed": 17, "error": {"code": "sample_failed", "message": "failed"}}]

        with mock.patch(
            "src.spare_mvp_backend.api._run_lite_mesa_analysis_samples",
            return_value=([], failure, 1, []),
        ):
            payload = self.api.run_lite_mesa_analysis(
                analysis_type="mission_reliability",
                context={
                    "type": "frozen_plan",
                    "project_id": project["project_id"],
                    "experiment_plan_id": plan["experiment_plan_id"],
                    "planFingerprint": frozen["canonical_fingerprint"],
                },
            )

        self.assertEqual(payload["analysis_source"], {
            "kind": "experiment-plan",
            "projectName": "Bound Project",
            "projectId": "identity-plan",
            "experimentPlanName": "Bound Plan",
            "experimentPlanId": plan["experiment_plan_id"],
        })


if __name__ == "__main__":
    unittest.main()
