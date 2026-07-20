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

    def test_solara_uses_compiled_initial_life_state_without_visualization_fallback(self) -> None:
        model = AircraftSupportV1Model(self.default_inputs)
        frame = model.visualization_frame(run_id="solara-pre-life", step=0)
        expected_by_tail = {
            asset["tail_number"]: asset["initial_life_state"]
            for asset in self.default_inputs["aircraft"]["assets"]
        }

        self.assertEqual(
            {item["tail_number"]: item["initial_life_state"] for item in frame["aircraft"]},
            expected_by_tail,
        )

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
        self.assertFalse(hasattr(solara_app, "APP_TITLE"))
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
            "可视化推演",
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

        page_source = source[source.index("def Page()") :]
        self.assertNotIn("solara.AppBar", page_source)
        control_index = page_source.index("ControlPanel(model_state, inputs)")
        layout_index = page_source.index('classes=["sim-layout"]')
        left_rail_index = page_source.index('classes=["sim-left-rail"]')
        self.assertLess(control_index, layout_index)
        self.assertLess(layout_index, left_rail_index)
        self.assertEqual(page_source.count("ControlPanel(model_state, inputs)"), 1)

    def test_visible_metrics_and_model_parameters_hide_project_metadata(self) -> None:
        model = AircraftSupportV1Model(self.default_inputs)

        metric_labels = [label for label, _value in solara_app._metrics_rows(model)]
        parameter_labels = [label for label, _value in solara_app._model_parameter_rows(self.default_inputs)]

        self.assertNotIn("数据来源", metric_labels)
        self.assertNotIn("数据来源", parameter_labels)
        self.assertNotIn("项目编号", parameter_labels)
        self.assertEqual(metric_labels, ["仿真分钟", "任务成功率", "战备完好率", "可用飞机", "维修中", "缺件事件"])
        self.assertEqual(parameter_labels, ["仿真时长", "随机种子"])

    def test_event_stream_localizes_types_statuses_and_shortage_reasons(self) -> None:
        label, message, internal_id = solara_app._event_display({
            "time": 15,
            "event": "spare_shortage",
            "message": "job-0006 blocked by hyd-pump shortage at carrier-deck",
            "details": {
                "job_id": "job-0006",
                "spare_type": "航电模块",
                "resource_id": "基层",
            },
        })

        self.assertEqual(label, "备件短缺")
        self.assertEqual(internal_id, "job-0006")
        self.assertTrue(message.startswith("航电模块库存不足，保障作业等待备件补给"))
        self.assertIn("保障节点：基层", message)
        self.assertNotRegex(message, r"blocked by|shortage at")
        self.assertEqual(solara_app._job_state_label("blocked"), "受阻")
        self.assertEqual(solara_app._job_state_label("future_state"), "未知状态")
        self.assertEqual(solara_app._shortage_reason_label("equipment_capacity"), "保障设备可用数量不足")
        self.assertEqual(solara_app._shortage_reason_label("spare:hyd-pump"), "备件库存不足")

        row = solara_app._event_row_html({
            "time": 15,
            "event": "spare_shortage",
            "message": "job-0006 blocked by hyd-pump shortage at carrier-deck",
            "details": {"job_id": "job-0006", "spare_type": "航电模块", "resource_id": "基层"},
        })
        self.assertNotIn("job-0006", row)
        self.assertNotIn("内部标识", row)
        self.assertNotIn("spare_shortage", row)
        self.assertNotIn("blocked by", row)

    def test_task_surfaces_show_business_names_without_internal_ids(self) -> None:
        missions = [
            {
                "mission_id": "composite-day-cap-d1-w1",
                "basic_task_id": "basic-day-cap",
                "basic_task_name": "昼间警戒",
                "day_index": 1,
                "wave_index": 1,
                "required_aircraft_type": "J-15",
                "status": "scheduled",
                "start_minute": 60,
                "end_minute": 120,
            },
            {
                "mission_id": "composite-day-cap-d1-w2",
                "name": "composite-day-cap",
                "composite_task_id": "composite-day-cap",
                "day_index": 1,
                "wave_index": 2,
                "status": "preparing",
                "start_minute": 180,
                "end_minute": 240,
            },
        ]

        visible_html = "".join([
            solara_app._mission_timeline_html(missions),
            solara_app._mission_stage_rows_html(missions),
            solara_app._mission_detail_cards_html(missions),
        ])

        self.assertIn("昼间警戒", visible_html)
        self.assertIn("第1天 / 第1波 / J-15", visible_html)
        self.assertIn("未命名任务", visible_html)
        self.assertNotIn("composite-day-cap", visible_html)
        self.assertNotIn("basic-day-cap", visible_html)
        self.assertEqual(
            solara_app._current_mission_task_name("composite-day-cap-d1-w1", missions),
            "昼间警戒",
        )
        self.assertEqual(solara_app._current_mission_task_name("missing-internal-id", missions), "未命名任务")

        support_row = solara_app._support_job_row_html({
            "job_id": "job-internal-1",
            "task": "activity-code-internal-1",
            "kind": "preflight",
            "tail_number": "101",
            "state": "queued",
            "remaining": 10,
        })
        self.assertNotIn("job-internal-1", support_row)
        self.assertNotIn("activity-code-internal-1", support_row)
        self.assertIn("飞行前保障", support_row)


if __name__ == "__main__":
    unittest.main()
