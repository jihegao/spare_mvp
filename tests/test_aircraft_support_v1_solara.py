import ast
import copy
import unittest
from pathlib import Path
from unittest.mock import patch

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1 import solara_app
from src.spare_mvp_abm.aircraft_support_v1.solara_app import _load_backend_project_json, _model_inputs, _query_runtime_config


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

    def test_model_inputs_apply_validated_plan_runtime_config_without_mutating_project(self) -> None:
        project = copy.deepcopy(self.default_source["project"])
        project["project_id"] = "project-solara-runtime"
        project.pop("experiment", None)
        original_project = copy.deepcopy(project)
        runtime_config = _query_runtime_config({
            "experiment_plan_id": ["plan-solara-runtime"],
            "plan_steps": ["77"],
            "plan_samples": ["8"],
            "plan_seed": ["88"],
        })

        with patch(
            "src.spare_mvp_abm.aircraft_support_v1.solara_app._load_backend_project_json",
            return_value=project,
        ):
            inputs, source = _model_inputs("project-solara-runtime", runtime_config=runtime_config)

        self.assertEqual(inputs["time"]["requested_steps"], 77)
        self.assertEqual(inputs["monte_carlo"]["sample_count"], 8)
        self.assertEqual(inputs["seed"], 88)
        self.assertEqual(inputs["source_context"]["experiment_plan_id"], "plan-solara-runtime")
        self.assertEqual(source["project"], original_project)
        self.assertEqual(project, original_project)

    def test_query_runtime_config_ignores_invalid_or_unbounded_values(self) -> None:
        self.assertEqual(_query_runtime_config({"experiment_plan_id": ["invalid plan id"]}), {})
        runtime_config = _query_runtime_config({
            "experiment_plan_id": ["plan-valid"],
            "plan_steps": ["0"],
            "plan_samples": ["1001"],
            "plan_seed": ["-1"],
        })
        self.assertEqual(runtime_config, {"experiment_plan_id": "plan-valid"})

    def test_backend_project_errors_are_user_facing_chinese(self) -> None:
        with self.assertRaisesRegex(ValueError, "缺少项目编号"):
            _load_backend_project_json("")

    def test_solara_page_labels_match_platform_copy(self) -> None:
        self.assertEqual(solara_app.APP_TITLE, "可视化推演")
        self.assertEqual(solara_app.METRICS_PANEL_TITLE, "指标")
        self.assertEqual(solara_app.VISUAL_TAB_LABELS, ["飞机视图", "任务视图", "保障视图"])
        self.assertEqual(solara_app.CONTROL_PANEL_TITLE, "运行控制")
        self.assertEqual(solara_app.PLAY_INTERVAL_LABEL, "刷新间隔(ms)")
        self.assertEqual(solara_app.RENDER_INTERVAL_LABEL, "渲染周期帧数")
        self.assertEqual(solara_app.RESET_BUTTON_LABEL, "重置")
        self.assertEqual(solara_app.STEP_BUTTON_LABEL, "单步推进")
        self.assertEqual(solara_app.MODEL_PARAMETERS_TITLE, "模型参数")
        self.assertEqual(solara_app.INFORMATION_TITLE, "信息")

        source = Path(solara_app.__file__).read_text(encoding="utf-8")
        string_literals = {
            node.value
            for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }
        for retired_label in [
            "aircraft_support_v1 Solara 推演",
            "飞机保障 Solara 推演",
            "会话指标",
            "Page {index}",
            "Controls",
            "Play Interval",
            "Render Interval",
            "RESET",
            "STEP",
            "Model Parameters",
            "Information",
            "会话信息",
        ]:
            self.assertNotIn(retired_label, string_literals)


if __name__ == "__main__":
    unittest.main()
