from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

import jsonschema

from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_contract.adapter import SimulationAdapter
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model, MissionState


ROOT = Path(__file__).resolve().parents[1]


class OperationsSupportPhasesTest(unittest.TestCase):
    def project(self):
        return json.loads((ROOT / "tests/fixtures/aircraft_support_v1_operations_project.json").read_text())

    def model(self, project=None):
        clean = ProjectJsonExporter(repo_root=ROOT).export(project or self.project())
        inputs = SimulationAdapter(ROOT).compile_scenario(clean)["simulation_inputs"]
        schema = json.loads((ROOT / "contracts/aircraft_support_v1_input.schema.json").read_text())
        jsonschema.validate(inputs, schema)
        inputs["disable_visualization_frames"] = True
        return AircraftSupportV1Model(inputs)

    def schedules(self, model, rows, duration=3000):
        model.duration_minutes = duration
        model.stop_policy = {"defaulted": True, "conditions": [{"type": "duration", "duration_minutes": duration}], "mode": "or"}
        model.missions = [MissionState(
            mission_id=f"flight-{index}", name=f"Flight {index}", planned_start=start,
            preparation_start=prepare, duration_minutes=flight, required_aircraft=1,
            min_required_aircraft=1, priority=1, cancel_minutes=120,
            operations_plan_group_id="ops", required_aircraft_type="J-15",
        ) for index, (start, prepare, flight) in enumerate(rows)]

    def phases(self, model):
        return [job.operations_phase for job in model.jobs if job.operations_phase]

    def test_project_to_runtime_daily_phases_consume_their_own_dag(self):
        model = self.model()
        result = model.run()
        self.assertEqual(self.phases(model), ["preflight", "relaunch", "postflight"])
        self.assertEqual(model.completed_sorties, 2)
        self.assertEqual(model.aircraft[0].daily_takeoffs, 2)
        starts = [event for event in result["events"] if event["event"] == "operations_step_started"]
        ends = [event for event in result["events"] if event["event"] == "operations_step_completed"]
        self.assertEqual([event["details"]["activity_code"] for event in starts], ["pre-a", "pre-b", "re", "post"])
        self.assertTrue(all(event["details"]["plan_group_id"] == "ops" for event in starts))
        self.assertGreaterEqual(starts[1]["time"], ends[0]["time"])
        self.assertEqual(starts[1]["details"]["predecessors"], ["pre-a"])
        self.assertGreaterEqual(starts[-1]["time"], model.missions[-1].return_time)
        self.assertEqual(model.nodes["node-a"]["personnel_in_use"], 0)
        self.assertEqual(model.nodes["node-a"]["equipment_in_use"], 0)

    def test_empty_stages_are_zero_time_zero_resource_even_with_old_duration(self):
        project = self.project()
        for stage in project["supportActivities"]:
            stage.update(activityCodes=[], predecessors={}, durationMinutes=999)
        project["supportResources"] = []
        model = self.model(project)
        model.run()
        self.assertEqual(self.phases(model), ["preflight", "relaunch", "postflight"])
        self.assertEqual(model.completed_sorties, 2)
        self.assertTrue(all(job.started_time == job.completed_time for job in model.jobs))
        self.assertTrue(all(not job.tasks and not job.resource_reservations for job in model.jobs))
        self.assertFalse(any(event["event"] == "operations_step_started" for event in model.event_log))

    def test_cancelled_first_attempt_does_not_select_relaunch(self):
        model = self.model()
        self.schedules(model, [(60, 60, 10), (120, 110, 10)])
        model.missions[0].cancel_minutes = 0
        model.run()
        self.assertEqual(model.missions[0].status, "cancelled")
        self.assertEqual(self.phases(model), ["preflight", "preflight", "postflight"])
        self.assertEqual(model.aircraft[0].daily_takeoffs, 1)

    def test_future_cancelled_mission_closes_pending_final_return(self):
        model = self.model()
        self.schedules(model, [(60, 50, 10), (100, 100, 10)])
        model.missions[1].cancel_minutes = 0
        model.run()
        self.assertEqual(model.missions[1].status, "cancelled")
        post = [job for job in model.jobs if job.operations_phase == "postflight"]
        self.assertEqual(len(post), 1)
        self.assertGreaterEqual(post[0].started_time, 100)
        self.assertFalse(model.aircraft[0].postflight_required)

    def test_cross_day_return_inspection_blocks_next_days_first_preparation(self):
        model = self.model()
        self.schedules(model, [(1430, 1420, 20), (1460, 1440, 10)])
        model.minute = 1419
        model.run()
        self.assertEqual(self.phases(model), ["preflight", "postflight", "preflight", "postflight"])
        first_check, next_prepare = model.jobs[1:3]
        self.assertGreaterEqual(first_check.started_time, 1450)
        self.assertGreaterEqual(next_prepare.started_time, first_check.completed_time)
        self.assertEqual(model.aircraft[0].daily_takeoffs, 1)

    def test_relaunch_preparation_crossing_midnight_is_invalidated_and_rebuilt(self):
        project = self.project()
        next(job for job in project["supportActivityJobs"] if job["activityCode"] == "re")["durationMinutes"] = 10
        model = self.model(project)
        self.schedules(model, [(1400, 1390, 5), (1438, 1435, 10)])
        model.minute = 1389
        model.run()
        self.assertEqual(self.phases(model), ["preflight", "relaunch", "postflight", "preflight", "postflight"])
        self.assertEqual(model.jobs[1].state, "cancelled")
        self.assertGreaterEqual(model.jobs[3].started_time, model.jobs[2].completed_time)
        self.assertGreaterEqual(model.missions[1].actual_start, 1440)

    def test_failed_final_return_repairs_then_checks_before_becoming_available(self):
        model = self.model()
        self.schedules(model, [(60, 50, 30)])
        def fail_once():
            if model.minute == 70:
                aircraft = model.aircraft[0]
                aircraft.in_flight_failure = True
                model._return_aircraft_from_mission(aircraft, early_return=True)
        model._evaluate_failures = fail_once
        model.run()
        repair = next(job for job in model.jobs if job.kind == "repair")
        post = next(job for job in model.jobs if job.operations_phase == "postflight")
        self.assertGreaterEqual(post.started_time, repair.completed_time)
        self.assertEqual(model.completed_sorties, 0)
        self.assertEqual(model.failed_sorties, 1)
        self.assertFalse(model.aircraft[0].postflight_required)

    def test_delayed_previous_day_missions_share_their_actual_departure_day(self):
        model = self.model()
        self.schedules(model, [(1430, 1430, 10), (1438, 1438, 10)])
        model.minute = 1440
        model.run()
        self.assertEqual(self.phases(model), ["preflight", "relaunch", "postflight"])
        self.assertEqual(model.aircraft[0].daily_takeoffs, 2)

    def test_invalidating_waiting_preparation_does_not_release_other_jobs_resources(self):
        model = self.model()
        aircraft = model.aircraft[0]
        model.minute = 60
        model._create_due_preflight_jobs()
        self.assertEqual(model.jobs[0].state, "waiting")
        model.nodes["node-a"]["personnel_in_use"] = 1
        model.nodes["node-a"]["equipment_in_use"] = 1
        model._cancel_aircraft_operations_preparation(aircraft)
        self.assertEqual(model.nodes["node-a"]["personnel_in_use"], 1)
        self.assertEqual(model.nodes["node-a"]["equipment_in_use"], 1)

    def test_cutoff_retains_waiting_inspection_without_completion(self):
        model = self.model()
        self.schedules(model, [(60, 50, 10)], duration=90)
        original = model._process_mission_returns
        def return_without_resources():
            original()
            if model.minute >= 70:
                model.nodes["node-a"]["equipment_capacity"] = 0
        model._process_mission_returns = return_without_resources
        model.run()
        post = next(job for job in model.jobs if job.operations_phase == "postflight")
        self.assertEqual(post.state, "waiting")
        self.assertIsNone(post.completed_time)
        self.assertTrue(model.aircraft[0].postflight_required)
        self.assertTrue(any(event["event"] == "operations_postflight_pending" for event in model.event_log))
        self.assertEqual(model.completed_sorties, 1)

    def test_cutoff_in_flight_records_pending_check_without_running_it(self):
        model = self.model()
        self.schedules(model, [(60, 50, 100)], duration=90)
        model.run()
        self.assertEqual(model.aircraft[0].state, "flying")
        self.assertNotIn("postflight", self.phases(model))
        self.assertTrue(any(event["event"] == "operations_postflight_pending" for event in model.event_log))

    def test_missing_stage_is_materialized_empty_without_copying_work(self):
        project = self.project()
        project["supportActivities"] = project["supportActivities"][:1]
        model = self.model(project)
        model.run()
        self.assertEqual(self.phases(model), ["preflight", "relaunch", "postflight"])
        self.assertTrue(all(not job.tasks for job in model.jobs[1:]))

    def test_plan_reference_selects_exact_group_and_rejects_incompatible_stage(self):
        project = self.project()
        alternate = copy.deepcopy(project["supportActivities"])
        for stage in alternate:
            stage["id"] += "-other"
            stage["activityName"] += " other"
            stage["planGroupId"] = "other"
        project["supportActivities"] = alternate + project["supportActivities"]
        model = self.model(project)
        model.run()
        self.assertEqual({job.plan_group_id for job in model.jobs}, {"ops"})
        project["supportActivities"][-1]["aircraftModel"] = "J-35"
        result = SimulationAdapter(ROOT).compile_scenario_with_gate(project)
        self.assertEqual(result["status"], "blocked")
        self.assertIn("invalid_operations_plan_reference", {issue["code"] for issue in result["issues"]})

    def test_final_inspection_uses_last_flown_task_group(self):
        project = self.project()
        alternate = copy.deepcopy(project["supportActivities"])
        for stage in alternate:
            stage["id"] += "-other"
            stage["activityName"] += " other"
            stage["planGroupId"] = "other"
        project["supportActivities"].extend(alternate)
        model = self.model(project)
        model.missions[-1].operations_plan_group_id = "other"
        model.run()
        self.assertEqual([(job.operations_phase, job.plan_group_id) for job in model.jobs],
                         [("preflight", "ops"), ("relaunch", "other"), ("postflight", "other")])

    def test_effective_composite_aircraft_override_is_rejected_at_compile_gate(self):
        project = self.project()
        project["missionProfile"]["compositeTasks"][0]["taskItems"][0]["equipmentType"] = "J-35"
        project["combatUnit"]["members"][0]["model"] = "J-35"
        project["components"][0]["aircraftModel"] = "J-35"
        clean = ProjectJsonExporter(repo_root=ROOT).export(project)
        result = SimulationAdapter(ROOT).compile_scenario_with_gate(clean)
        self.assertEqual(result["status"], "blocked")
        issue = next(issue for issue in result["issues"] if issue["code"] == "invalid_operations_plan_reference")
        self.assertIn("taskItems[0].equipmentType", issue["field_path"])

    def test_effective_override_selects_compatible_group_without_requiring_unused_basic_type(self):
        project = self.project()
        project["missionProfile"]["compositeTasks"][0]["taskItems"][0]["equipmentType"] = "J-35"
        project["combatUnit"]["members"][0]["model"] = "J-35"
        project["components"][0]["aircraftModel"] = "J-35"
        for activity in project["supportActivities"]:
            activity["aircraftModel"] = "J-35"
            activity["planGroupId"] = "ops-j35"
        for task in project["supportActivityJobs"]:
            task["applicableAircraft"] = "J-35"
        model = self.model(project)
        self.assertEqual({mission.required_aircraft_type for mission in model.missions}, {"J-35"})
        self.assertEqual({mission.operations_plan_group_id for mission in model.missions}, {"ops-j35"})
        model.run()
        self.assertEqual(model.completed_sorties, 2)
        self.assertEqual({job.plan_group_id for job in model.jobs}, {"ops-j35"})

    def test_one_basic_mission_can_bind_different_groups_for_each_item_aircraft(self):
        project = self.project()
        project["basicMissions"][0]["supportActivityName"] = ""
        alternate = copy.deepcopy(project["supportActivities"])
        for activity in alternate:
            activity["id"] += "-j35"
            activity["activityName"] += " J35"
            activity["aircraftModel"] = "J-35"
            activity["planGroupId"] = "ops-j35"
            activity["activityCodes"] = []
            activity["predecessors"] = {}
        project["supportActivities"].extend(alternate)
        member = copy.deepcopy(project["combatUnit"]["members"][0])
        member.update(aircraftNo="J35-001", model="J-35")
        project["combatUnit"]["members"].append(member)
        component = copy.deepcopy(project["components"][0])
        component.update(id="whole-j35", aircraftModel="J-35")
        project["components"].append(component)
        item = copy.deepcopy(project["missionProfile"]["compositeTasks"][0]["taskItems"][0])
        item["equipmentType"] = "J-35"
        project["missionProfile"]["compositeTasks"][0]["taskItems"].append(item)
        model = self.model(project)
        self.assertEqual({(mission.required_aircraft_type, mission.operations_plan_group_id) for mission in model.missions},
                         {("J-15", "ops"), ("J-35", "ops-j35")})
        model.run()
        self.assertEqual(model.completed_sorties, 4)

    def test_implicit_group_requires_all_stages_to_be_compatible(self):
        project = self.project()
        project["basicMissions"][0]["supportActivityName"] = ""
        alternate = copy.deepcopy(project["supportActivities"])
        for stage in alternate:
            stage["id"] += "-j35"
            stage["activityName"] += " J35"
            stage["planGroupId"] = "ops-j35"
            stage["aircraftModel"] = "J-35" if stage["planType"] == "直接准备方案" else ""
            stage["activityCodes"] = []
            stage["predecessors"] = {}
        project["supportActivities"].extend(alternate)
        model = self.model(project)
        self.assertEqual({mission.operations_plan_group_id for mission in model.missions}, {"ops"})
        model.run()
        self.assertEqual(model.completed_sorties, 2)
        # Naming an unrestricted stage of that incompatible group still reports
        # the incompatible phase, rather than falling back to a different group.
        project["basicMissions"][0]["supportActivityName"] = alternate[-1]["activityName"]
        clean = ProjectJsonExporter(repo_root=ROOT).export(project)
        result = SimulationAdapter(ROOT).compile_scenario_with_gate(clean)
        issue = next(issue for issue in result["issues"] if issue["code"] == "invalid_operations_plan_reference")
        self.assertIn("all operations plan phases", issue["message"])

    def test_multitype_task_requires_every_phase_to_cover_every_selectable_model(self):
        project = self.project()
        project["missionProfile"]["compositeTasks"][0]["taskItems"][0]["equipmentType"] = "J-15 / J-35"
        project["combatUnit"]["members"][0]["model"] = "J-35"
        project["components"][0]["aircraftModel"] = "J-35"
        adapter = SimulationAdapter(ROOT)
        clean = ProjectJsonExporter(repo_root=ROOT).export(project)
        self.assertEqual(adapter.compile_scenario_with_gate(clean)["status"], "blocked")
        for stage in project["supportActivities"]:
            stage["aircraftModel"] = "J-15、J-35"
            stage["activityCodes"] = []
            stage["predecessors"] = {}
        model = self.model(project)
        model.run()
        self.assertEqual(model.completed_sorties, 2)
        project["supportActivities"][-1]["aircraftModel"] = "J-15"
        self.assertEqual(adapter.compile_scenario_with_gate(ProjectJsonExporter(repo_root=ROOT).export(project))["status"], "blocked")
        for stage in project["supportActivities"]:
            stage["aircraftModel"] = ""
        model = self.model(project)
        model.run()
        self.assertEqual(model.completed_sorties, 2)
