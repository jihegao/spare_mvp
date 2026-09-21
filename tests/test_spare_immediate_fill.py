from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest

from jsonschema import validate
from test_aircraft_support_v1_model import _minimal_inputs, _vertical_organization_inputs
from src.spare_mvp_abm.aircraft_support_v1.model import AircraftSupportV1Model
from src.spare_mvp_backend.api import (
    _lite_mesa_projection_event_required,
    _lite_mesa_carry_list_result,
    _lite_mesa_downtime_frame_snapshot,
)
from src.spare_mvp_contract import SimulationAdapter
from src.spare_mvp_contract.monte_carlo_moments import build_monte_carlo_metric_moments


class ImmediateSpareFillTest(unittest.TestCase):
    def model(self, stock=0, quantity=5, canonical=False):
        inputs = _vertical_organization_inputs(local_quantity=stock, parent_quantity=0) if canonical else _minimal_inputs()
        inputs["support_network"]["nodes"][0]["inventory"] = {"shared-spare": stock}
        inputs["support_activities"]["activities"][1]["maintenance_methods"] = ["replacement"]
        inputs["support_activities"]["activities"][1]["jobs"][0]["spare"] = [{"product_id": "shared-spare", "quantity": quantity}]
        model = AircraftSupportV1Model(inputs)
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        return model

    def test_full_partial_empty_and_zero_demand(self):
        for canonical in (False, True):
            for stock, quantity, expected in ((5, 5, 1), (3, 5, 0), (0, 5, 0), (0, 0, None)):
                with self.subTest(canonical=canonical, stock=stock, quantity=quantity):
                    model = self.model(stock, quantity, canonical)
                    model._start_waiting_jobs()
                    metrics = model.snapshot()
                    self.assertEqual(metrics["spare_fill_rate"], expected)
                    self.assertEqual(metrics["spare_demand_total"], quantity)
                    self.assertEqual(metrics["spare_immediately_filled_total"], quantity if expected == 1 else 0)
                    if stock < quantity:
                        self.assertEqual(model.nodes["deck"]["inventory"]["shared-spare"], stock)

    def test_later_replenishment_and_retries_do_not_revise_initial_shortfall(self):
        for canonical in (False, True):
            model = self.model(3, 5, canonical)
            model._start_waiting_jobs()
            model._start_waiting_jobs()
            model.nodes["deck"]["inventory"]["shared-spare"] = 5
            model._start_waiting_jobs()
            self.assertEqual(model.snapshot()["spare_fill_rate"], 0)
            self.assertEqual(model.spare_consumed_total, 5)
            self.assertEqual(model.spare_demand_total, 5)
            self.assertEqual(len([e for e in model.event_log if e["event"] == "spare_request"]), 1)

    def test_actual_remote_shipment_arrival_does_not_backfill_immediate_rate(self):
        model = self.model(0, 1, True)
        model.nodes["stock"]["inventory"]["shared-spare"] = 1
        model._start_waiting_jobs()
        self.assertEqual(len(model.transport_shipments), 1)
        self.assertEqual(model.spare_immediately_filled_total, 0)
        model.minute = model.transport_shipments[0].arrival_minute
        model._process_transport_arrivals()
        model._start_waiting_jobs()
        self.assertEqual(model.spare_consumed_total, 1)
        self.assertEqual(model.spare_demand_total, 1)
        self.assertEqual(model.snapshot()["spare_fill_rate"], 0)

    def test_multi_product_request_is_all_or_nothing(self):
        for canonical in (False, True):
            model = self.model(5, 5, canonical)
            model.jobs[0].tasks[0]["spare"].append({"product_id": "second", "quantity": 2})
            model.nodes["deck"]["inventory"]["second"] = 1
            model._start_waiting_jobs()
            self.assertEqual(model.spare_demand_total, 7)
            self.assertEqual(model.spare_immediately_filled_total, 0)
            self.assertEqual(model.spare_consumed_total, 0)
            requests = [e["details"] for e in model.event_log if e["event"] == "spare_request"]
            self.assertEqual([e["immediately_filled_quantity"] for e in requests], [0, 0])

    def test_local_reservation_can_fill_before_personnel_and_cancel_does_not_erase_history(self):
        model = self.model(1, 1, True)
        for node in model.nodes.values():
            node["personnel_capacity"] = 0
        model._start_waiting_jobs()
        first = model.jobs[0]
        self.assertEqual(first.state, "waiting")
        self.assertEqual(first.spare_reservations, {(0, "shared-spare"): 1})
        self.assertEqual(model.spare_immediately_filled_total, 1)
        first.state = "cancelled"
        model._return_cancelled_spare_reservations()
        model._create_job(model.aircraft[0], model.activities[1], kind="repair")
        model._start_waiting_jobs()
        self.assertEqual(model.spare_demand_total, 2)
        self.assertEqual(model.spare_immediately_filled_total, 2)
        self.assertEqual(model.spare_consumed_total, 0)

    def test_same_stock_is_not_committed_to_concurrent_requests_twice(self):
        model = self.model(1, 1, True)
        for node in model.nodes.values():
            node["personnel_capacity"] = 0
        other = copy.deepcopy(model.jobs[0])
        other.job_id += "-other"
        model.jobs.append(other)
        model._start_waiting_jobs()
        self.assertEqual(model.spare_demand_total, 2)
        self.assertEqual(model.spare_immediately_filled_total, 1)
        self.assertEqual(model.snapshot()["spare_fill_rate"], 0.5)

    def test_legacy_waits_for_personnel_before_first_actual_spare_request(self):
        model = self.model(1, 1)
        model.nodes["deck"]["personnel_capacity"] = 0
        model._start_waiting_jobs()
        self.assertEqual(model.spare_demand_total, 0)
        model.jobs[0].state = "cancelled"
        self.assertIsNone(model.snapshot()["spare_fill_rate"])

    def test_steps_of_one_job_are_distinct_and_event_stats_preserve_counts(self):
        model = self.model(1, 1)
        model._start_waiting_jobs()
        model._release_job_resources(model.jobs[0])
        job = model.jobs[0]
        job.tasks.append(copy.deepcopy(job.tasks[0]))
        job.task_index = 1
        job.state = "waiting"
        model._start_waiting_jobs()
        self.assertEqual((model.spare_demand_total, model.spare_immediately_filled_total), (2, 1))
        samples = [{"sample_index": 0, "events": model.event_log}]
        stats = SimulationAdapter()._aircraft_support_v1_spare_event_stats(samples, {"deck"})
        product = next(iter(stats.values()))
        self.assertEqual(product["demand_quantity"], 2)
        self.assertEqual(product["immediately_filled_quantity"], 1)
        self.assertEqual(product["consumed_quantity"], 1)
        self.assertEqual(product["shortage_count"], 1)
        self.assertEqual(product["request_count"], 2)
        self.assertEqual(product["shortage_quantity"], 1)
        self.assertTrue(all(_lite_mesa_projection_event_required(event) for event in model.event_log if event["event"] == "spare_request"))

    def test_moments_weight_actual_quantities_and_utilization_is_independent(self):
        filled, shortage = self.model(1, 1), self.model(0, 5)
        filled._start_waiting_jobs()
        shortage._start_waiting_jobs()
        samples = [{"metrics": model.snapshot()} for model in (filled, shortage)]
        moments = build_monte_carlo_metric_moments(samples, total_sample_count=2, failed_sample_count=0)
        metric = next(row for row in moments["metrics"] if row["metric_id"] == "spare_fill_rate")
        self.assertEqual(metric["mean"], 0.5)
        self.assertEqual(metric["overall_ratio"], 1 / 6)
        self.assertEqual(metric["sample_variance"], 0.5)
        self.assertEqual(filled.snapshot()["spare_utilization"], 1)
        self.assertEqual(filled.snapshot()["spare_fill_rate"], 1)

    def test_legacy_aviation_unknown_fill_is_nullable_and_not_inferred_from_stock(self):
        adapter = SimulationAdapter()
        metrics = {"spare_stock_total": 9, "spare_consumed_total": 1}
        self.assertIsNone(adapter._aviation_spare_fill_rate(metrics))
        projection = adapter._aviation_analysis_projections(metrics, "legacy")["spare_shortfall"]
        self.assertIsNone(projection["data"][0]["fill_rate"])
        self.assertEqual(projection["applicability"]["status"], "not_applicable")
        schema = json.loads((Path(__file__).parents[1] / "contracts/result.schema.json").read_text())
        validate(None, schema["properties"]["metrics"]["properties"]["spare_fill_rate"])
        self.assertIsNone(adapter._aviation_spare_fill_rate({"spare_demand_total": 0, "spare_immediately_filled_total": 0}))
        self.assertEqual(adapter._aviation_spare_fill_rate({"spare_fill_rate": 0.2, "spare_demand_total": 5, "spare_immediately_filled_total": 2}), 0.2)

    def test_api_distinguishes_planned_and_actual_fill(self):
        projection = {"data": [
            {"aircraft_model": "A", "spare_type": "spare", "demand_count": 5,
             "immediately_filled_quantity": 0, "projected_satisfaction_rate": 1,
             "recommended_quantity": 5},
            {"aircraft_model": "A", "spare_type": "old", "projected_satisfaction_rate": 0.9},
        ]}
        result = _lite_mesa_carry_list_result(projection, {"shortage_events": 0}, [], {"missionConfidenceTarget": 0.9})
        self.assertEqual(result["rows"][0]["projectedSatisfactionRate"], 1)
        self.assertEqual(result["rows"][0]["satisfactionRate"], 0)
        self.assertEqual(result["rows"][0]["observedFillRate"], 0)
        self.assertIsNone(result["rows"][1]["satisfactionRate"])
        self.assertIsNone(result["rows"][1]["observedFillRate"])

    def test_old_visualization_and_anomaly_snapshots_preserve_unknown_fill(self):
        adapter = SimulationAdapter()
        frame = adapter._aviation_visualization_state_frame("old", {
            "snapshot": {"spare_stock_total": 9, "spare_consumed_total": 1}
        }, 0)
        self.assertIsNone(frame["resource_state"]["spare_fill_rate"])
        self.assertEqual(frame["resource_state"]["spare_utilization"], 0.1)
        schema = json.loads((Path(__file__).parents[1] / "contracts/visualization_state_series.schema.json").read_text())
        validate(frame["resource_state"], {"$ref": "#/$defs/resource_state", "$defs": schema["$defs"]})
        args = dict(ordinal=1, sample_index=0, seed=1, sweep={}, frame=frame,
                    event_type="spare_shortage", event={})
        api_snapshot = _lite_mesa_downtime_frame_snapshot(**args)
        self.assertIsNone(api_snapshot["support_activity_state"]["spare_fill_rate"])

    def test_product_quantities_and_request_shortfall_rate_use_distinct_denominators(self):
        model = self.model(0, 5)
        model._start_waiting_jobs()
        other = copy.deepcopy(model.jobs[0])
        other.job_id += "-other"
        other.requested_spare_task_indexes.clear()
        other.tasks[0]["spare"][0]["quantity"] = 2
        model.jobs[0].state = "cancelled"
        model.jobs.append(other)
        model.nodes["deck"]["inventory"]["shared-spare"] = 2
        model._start_waiting_jobs()
        stats = SimulationAdapter()._aircraft_support_v1_spare_event_stats(
            [{"sample_index": 0, "events": model.event_log}], {"deck"}
        )
        product = next(iter(stats.values()))
        self.assertEqual(product["demand_quantity"], 7)
        self.assertEqual(product["immediately_filled_quantity"], 2)
        self.assertEqual(product["shortage_quantity"], 5)
        self.assertEqual(product["request_count"], 2)
        self.assertEqual(product["shortage_count"], 1)
        self.assertEqual(model.snapshot()["spare_fill_rate"], 2 / 7)
        projection_inputs = copy.deepcopy(model.inputs)
        projection_inputs["aircraft"]["assets"] = [{"model": model.aircraft[0].aircraft_type, "airport": "Deck"}]
        projections = SimulationAdapter()._aircraft_support_v1_analysis_projections(
            model.snapshot(), "base", samples=[{"sample_index": 0, "events": model.event_log}],
            simulation_inputs=projection_inputs,
        )
        shortfall = next(row for row in projections["spare_shortfall"]["data"] if row["product_id"] == "shared-spare")
        self.assertEqual(shortfall["shortage_probability"], 0.5)
        self.assertEqual(shortfall["shortage_quantity"], 5)
        self.assertEqual(shortfall["fill_rate"], 2 / 7)
        carry = next(row for row in projections["carry_list"]["data"] if row["product_id"] == "shared-spare")
        self.assertEqual(carry["observed_request_shortfall_rate"], 0.5)
        self.assertEqual(carry["observed_fill_rate"], 2 / 7)
        self.assertEqual(carry["satisfaction_rate"], 2 / 7)
        self.assertEqual(carry["projected_satisfaction_rate"], 1)
