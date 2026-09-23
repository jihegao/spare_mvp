from __future__ import annotations

import unittest

from src.spare_mvp_abm.aircraft_support_v1.metrics_engine import MetricsEngineMixin
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.state import AircraftState, JobState
from src.spare_mvp_contract.downtime import normalize_downtime_event_for_analysis
from tests.test_aircraft_support_v1_model import _minimal_inputs, _vertical_organization_inputs


class _LedgerHarness(MetricsEngineMixin):
    def __init__(self) -> None:
        self.minute = 20
        self.tick_minutes = 1
        self.running = True
        self.downtime_events = []
        self._active_downtime_events = {}
        self._downtime_event_sequence = 0
        self.jobs = []
        self.event_log = []
        self.nodes = {"deck": {"inventory": {"engine": 0}}}
        self.transport_shipments = []
        self.aircraft = [AircraftState("A-01", "T", "maintenance", 0, 0)]

    def _task_spare_requirements(self, job, task):
        return [("engine", 1)] if task.get("spare") else []

    def _shortage_spare_requirement(self, job, task):
        requirements = self._task_spare_requirements(job, task)
        return requirements[0] if requirements else (None, 0)

    def _aircraft_by_tail(self, tail_number):
        return next((item for item in self.aircraft if item.tail_number == tail_number), None)

    def _product_display_name(self, product_id):
        return product_id

    def _mission_by_id(self, mission_id):
        return None

    def _component_by_id(self, component_id):
        return {"id": component_id, "name": component_id} if component_id else None


def _job(reason: str | None, *, spare: bool = True, state: str = "waiting") -> JobState:
    return JobState(
        job_id="repair-1",
        tail_number="A-01",
        kind="repair",
        activity_id="repair",
        activity_name="修复性维修",
        tasks=[{"workName": "动力装置维修", "spare": "engine" if spare else None}],
        priority=1,
        resource_node_id="deck",
        state=state,
        shortage_reason=reason,
        maintenance_method="replacement" if spare else "non_replacement",
    )


class DowntimeIssue401Tests(unittest.TestCase):
    def test_only_spare_organization_failures_are_classified_as_spare_shortage(self) -> None:
        model = _LedgerHarness()
        for code in (
            "organization_no_available_ancestor",
            "organization_no_available_supplier",
            "organization_no_vertical_path",
            "organization_no_supply_path",
        ):
            with self.subTest(code=code):
                self.assertTrue(model._is_spare_shortage_job(_job(f"{code}:engine")))

        self.assertTrue(model._is_spare_shortage_job(_job("spare:engine")))
        self.assertTrue(model._is_spare_shortage_job(_job("in_transit")))
        self.assertFalse(model._is_spare_shortage_job(_job("organization_no_available_supplier:personnel")))
        self.assertFalse(model._is_spare_shortage_job(_job("organization_resources_in_transit")))
        self.assertFalse(model._is_spare_shortage_job(_job("equipment_capacity", spare=False)))

    def test_shortage_reason_labels_distinguish_local_inventory_and_dispatch_failures(self) -> None:
        cases = {
            "spare:engine": ("spare", "本地备件库存不足"),
            "organization_no_available_ancestor:engine": (
                "organization_no_available_ancestor",
                "上级组织无可用库存",
            ),
            "organization_no_available_supplier:engine": (
                "organization_no_available_supplier",
                "供应组织无可用库存",
            ),
            "organization_no_vertical_path:engine": (
                "organization_no_vertical_path",
                "缺少纵向调拨路径",
            ),
            "organization_no_supply_path:engine": (
                "organization_no_supply_path",
                "缺少供应调拨路径",
            ),
        }
        for reason, (code, label) in cases.items():
            with self.subTest(reason=reason):
                projected = normalize_downtime_event_for_analysis({
                    "factor": "spare_shortage",
                    "details": {"shortage_reason": reason},
                })
                self.assertEqual(projected["details"]["shortage_reason_code"], code)
                self.assertEqual(projected["details"]["shortage_reason_label"], label)

    def test_wait_transition_and_repair_are_exclusive_segments_with_true_end_state(self) -> None:
        model = _LedgerHarness()
        aircraft = model.aircraft[0]
        aircraft.failed_component_id = "engine"
        waiting = _job("in_transit")
        model.jobs = [waiting]
        model._active_downtime_events[aircraft.tail_number] = {
            "factor": "spare_shortage",
            "job_id": waiting.job_id,
            "fault_related": True,
            "start_minute": 0.0,
            "end_minute": 10.0,
            "duration_minutes": 10.0,
            "details": {"shortage_reason": "in_transit", "arrival_minute": None, "wait_end_minute": None},
        }

        waiting.shortage_reason = None
        waiting.state = "running"
        model.event_log.append({
            "event": "organization_transport_arrived",
            "time": 10,
            "details": {"job_id": waiting.job_id, "product_id": "engine", "arrival_minute": 10},
        })
        model._close_downtime_event(aircraft.tail_number)
        wait_event = model.downtime_events[0]
        self.assertEqual(wait_event["end_reason"], "wait_completed")
        self.assertEqual(wait_event["end_state"], "repairing")
        self.assertEqual(wait_event["details"]["arrival_minute"], 10.0)
        self.assertEqual(wait_event["details"]["wait_end_minute"], 10.0)

        model._active_downtime_events[aircraft.tail_number] = {
            "factor": "failure",
            "job_id": waiting.job_id,
            "start_minute": 10.0,
            "end_minute": 20.0,
            "duration_minutes": 10.0,
            "details": {"repair_completed_minute": None},
        }
        waiting.state = "completed"
        waiting.completed_time = 19
        aircraft.failed_component_id = None
        model._close_downtime_event(aircraft.tail_number)
        repair_event = model.downtime_events[1]
        self.assertEqual(repair_event["end_reason"], "repair_completed")
        self.assertEqual(repair_event["details"]["repair_completed_minute"], 19)
        self.assertEqual(sum(item["duration_minutes"] for item in model.downtime_events), 20.0)

    def test_cutoff_does_not_invent_arrival_wait_end_or_repair_completion(self) -> None:
        model = _LedgerHarness()
        model.running = False
        model.jobs = [_job("organization_no_available_supplier:engine")]
        model._active_downtime_events["A-01"] = {
            "factor": "spare_shortage",
            "job_id": model.jobs[0].job_id,
            "fault_related": True,
            "start_minute": 5.0,
            "end_minute": 20.0,
            "duration_minutes": 15.0,
            "details": {
                "shortage_reason": "organization_no_available_supplier:engine",
                "scheduled_arrival_minute": None,
                "arrival_minute": None,
                "wait_end_minute": None,
            },
        }

        model._close_all_downtime_events()
        event = model.downtime_events[0]
        self.assertEqual(event["end_reason"], "simulation_cutoff")
        self.assertEqual(event["end_state"], "waiting_spare")
        self.assertIsNone(event["details"]["arrival_minute"])
        self.assertIsNone(event["details"]["wait_end_minute"])

        projected = normalize_downtime_event_for_analysis(event)
        self.assertEqual(projected["end_time_label"], "仿真截止：DAY_1 00:20")
        self.assertEqual(projected["status_label"], "未修复·仍等待备件")
        self.assertEqual(projected["details"]["shortage_reason_code"], "organization_no_available_supplier")
        self.assertEqual(projected["details"]["shortage_reason_label"], "供应组织无可用库存")

    def test_same_segment_refreshes_shortage_reason_without_incrementing_count(self) -> None:
        model = _LedgerHarness()
        aircraft = model.aircraft[0]
        aircraft.failed_component_id = "engine"
        job = _job("spare:engine")
        model.jobs = [job]
        model.minute = 10
        model._record_downtime_minutes()
        first_id = model._active_downtime_events["A-01"]["event_id"]

        job.shortage_reason = "in_transit"
        model.minute = 20
        model._record_downtime_minutes()
        event = model._active_downtime_events["A-01"]
        self.assertEqual(event["event_id"], first_id)
        self.assertEqual(event["details"]["shortage_reason"], "in_transit")
        self.assertEqual(len(model.downtime_events), 0)

    def test_non_fault_cutoff_is_incomplete_and_transfer_is_distinct(self) -> None:
        model = _LedgerHarness()
        model.running = False
        job = _job("in_transit")
        job.kind = "preflight"
        model.jobs = [job]
        model.aircraft[0].failed_component_id = None
        model._active_downtime_events["A-01"] = {
            "factor": "spare_shortage",
            "job_id": job.job_id,
            "job_kind": "preflight",
            "fault_related": False,
            "start_minute": 5.0,
            "end_minute": 20.0,
            "duration_minutes": 15.0,
            "details": {"shortage_reason": "in_transit", "arrival_minute": None, "wait_end_minute": None},
        }
        model._close_all_downtime_events()
        projected = normalize_downtime_event_for_analysis(model.downtime_events[0])
        self.assertEqual(projected["end_state"], "waiting_transfer")
        self.assertEqual(projected["status_label"], "未完成·仍等待备件调拨")

    def test_equipment_cutoff_status_respects_fault_relationship(self) -> None:
        for fault_related, expected in (
            (True, "未修复·仍等待保障设备"),
            (False, "未完成·仍等待保障设备"),
        ):
            with self.subTest(fault_related=fault_related):
                projected = normalize_downtime_event_for_analysis({
                    "factor": "equipment_shortage",
                    "fault_related": fault_related,
                    "end_reason": "simulation_cutoff",
                    "end_state": "waiting_equipment",
                    "status": "unresolved",
                    "start_minute": 0,
                    "end_minute": 20,
                    "details": {},
                })
                self.assertEqual(projected["status_label"], expected)
                self.assertEqual(projected["end_state_label"], "仍等待保障设备")
                self.assertNotIn("当前", projected["description"])

    def test_real_runtime_records_180_minute_repair_and_actual_completion_timestamp(self) -> None:
        inputs = _minimal_inputs()
        inputs["time"]["duration_minutes"] = 300
        inputs["aircraft"].update({"fleet_count": 1, "initial_ready": 1})
        inputs["mission_profile"]["basic_missions"] = []
        repair = inputs["support_activities"]["activities"][1]
        repair.update({
            "maintenance_methods": ["non_replacement"],
            "replacement_ratio": 0,
            "jobs": [{"activityCode": "repair", "durationMinutes": 180, "workName": "LRU 自动换件"}],
        })
        model = AircraftSupportV1Model(inputs)
        aircraft = model.aircraft[0]
        aircraft.failed_component_id = "engine"
        aircraft.failed_component_minute = 0
        model._create_job(
            aircraft,
            repair,
            kind="repair",
            component={
                "id": "engine",
                "name": "动力装置",
                "product_type": "SRU",
                "repair_duration_minutes": 180,
            },
        )

        result = model.run()
        event = next(item for item in result["downtime_events"] if item["factor"] == "failure")
        repair_job = next(job for job in model.jobs if job.kind == "repair")
        self.assertEqual(event["duration_minutes"], 180)
        self.assertEqual(event["end_reason"], "repair_completed")
        self.assertEqual(event["details"]["repair_completed_minute"], repair_job.completed_time)
        self.assertEqual(event["details"]["maintenance_method"], "non_replacement")
        self.assertFalse(event["details"]["requires_spare"])
        projected = normalize_downtime_event_for_analysis(event)
        self.assertEqual(projected["task_phase_label"], "任务外事件；阶段：原位维修")

    def test_real_organization_paths_cover_local_parent_empty_and_missing_path(self) -> None:
        local = AircraftSupportV1Model(_vertical_organization_inputs(local_quantity=1, parent_quantity=0))
        local._create_job(local.aircraft[0], local.activities[1], kind="repair")
        local._start_waiting_jobs()
        self.assertEqual(local.jobs[-1].state, "running")
        self.assertIsNone(local.jobs[-1].shortage_reason)

        parent = AircraftSupportV1Model(_vertical_organization_inputs(local_quantity=0, parent_quantity=1))
        parent._create_job(parent.aircraft[0], parent.activities[1], kind="repair")
        parent._start_waiting_jobs()
        self.assertEqual(parent.jobs[-1].shortage_reason, "in_transit")
        self.assertEqual(parent._current_downtime_context(parent.aircraft[0], active_jobs=[parent.jobs[-1]])[0], "spare_shortage")

        empty = AircraftSupportV1Model(_vertical_organization_inputs(local_quantity=0, parent_quantity=0))
        empty._create_job(empty.aircraft[0], empty.activities[1], kind="repair")
        empty._start_waiting_jobs()
        self.assertEqual(empty.jobs[-1].shortage_reason, "organization_no_available_ancestor:shared-spare")
        self.assertEqual(empty._current_downtime_context(empty.aircraft[0], active_jobs=[empty.jobs[-1]])[0], "spare_shortage")

        missing_path_inputs = _vertical_organization_inputs(local_quantity=0, parent_quantity=1)
        missing_path_inputs["support_network"]["organization_graph"]["transport_policies"] = []
        missing_path = AircraftSupportV1Model(missing_path_inputs)
        missing_path._create_job(missing_path.aircraft[0], missing_path.activities[1], kind="repair")
        missing_path._start_waiting_jobs()
        self.assertEqual(missing_path.jobs[-1].shortage_reason, "organization_no_vertical_path:shared-spare")
        self.assertEqual(missing_path._current_downtime_context(
            missing_path.aircraft[0], active_jobs=[missing_path.jobs[-1]],
        )[0], "spare_shortage")


if __name__ == "__main__":
    unittest.main()
