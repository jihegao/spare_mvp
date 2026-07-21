from __future__ import annotations

import copy
import unittest

from src.spare_mvp_abm.aircraft_support_v1.organization_observability import (
    aggregate_organization_dispatch_summaries,
    normalize_organization_event,
    organization_dispatch_summary,
    organization_graph_identity,
)


class OrganizationObservabilityTest(unittest.TestCase):
    def test_graph_identity_is_order_independent_but_semantic_changes_are_visible(self) -> None:
        # Arrange.
        graph = {
            "runtime_mode": "vertical_lateral",
            "nodes": [{"id": "b"}, {"id": "a"}],
            "relations": [
                {"id": "r2", "enabled": True},
                {"id": "r1", "enabled": True},
            ],
        }
        reordered = copy.deepcopy(graph)
        reordered["nodes"].reverse()
        reordered["relations"].reverse()

        # Act.
        first = organization_graph_identity(graph)
        second = organization_graph_identity(reordered)
        changed_graph = copy.deepcopy(graph)
        changed_graph["relations"][0]["enabled"] = False
        changed = organization_graph_identity(changed_graph)

        # Assert.
        self.assertEqual(first, second)
        self.assertEqual(first["runtime_mode"], "vertical_lateral")
        self.assertNotEqual(first["graph_hash"], changed["graph_hash"])

    def test_event_normalization_and_summary_are_stable_descriptive_facts(self) -> None:
        # Arrange.
        identity = organization_graph_identity({"runtime_mode": "vertical_lateral"})
        raw_events = [
            ("organization_resource_selected", 2, {
                "job_id": "job-1",
                "task_index": 0,
                "product_id": "spare-a",
                "supply_mode": "lateral",
                "organization_path": ["org-b", "org-a"],
                "resource_id": "resource-a",
            }),
            ("organization_transport_dispatched", 2, {
                "job_id": "job-1",
                "task_index": 0,
                "product_id": "spare-a",
                "supply_mode": "lateral",
                "organization_path": ["org-b", "org-a"],
                "resource_id": "resource-a",
                "requested_minute": 2,
            }),
            ("organization_transport_arrived", 5, {
                "job_id": "job-1",
                "task_index": 0,
                "product_id": "spare-a",
                "supply_mode": "lateral",
                "organization_path": ["org-b", "org-a"],
                "resource_id": "resource-a",
                "requested_minute": 2,
                "arrival_minute": 5,
            }),
            ("organization_resource_blocked", 6, {
                "job_id": "job-2",
                "task_index": 0,
                "product_id": "spare-b",
                "reason": "no_eligible_source",
                "organization_node_id": "org-a",
            }),
            ("organization_candidate_rejected", 6, {
                "job_id": "job-2",
                "task_index": 0,
                "product_id": "spare-b",
                "reason": "scope_mismatch",
            }),
        ]

        # Act.
        events = [
            {
                "event": event,
                "minute": minute,
                "details": normalize_organization_event(
                    event,
                    details,
                    minute=minute,
                    identity=identity,
                ),
            }
            for event, minute, details in raw_events
        ]
        summary = organization_dispatch_summary(events, identity=identity)

        # Assert.
        stable_fields = {
            "fact_type",
            "runtime_mode",
            "organization_graph_hash",
            "source_mode",
            "source_organization_node_id",
            "destination_organization_node_id",
            "destination_resource_id",
            "reason",
            "relation_id",
            "requested_minute",
            "wait_minutes",
        }
        self.assertTrue(all(stable_fields <= set(event["details"]) for event in events))
        self.assertEqual(summary["observed_request_count"], 2)
        self.assertEqual(summary["observed_fulfilled_count"], 1)
        self.assertEqual(summary["observed_fulfillment_rate"], 0.5)
        self.assertEqual(summary["selection_counts_by_source_mode"], {"lateral": 1})
        self.assertEqual(summary["blocked_counts_by_reason"], {"no_eligible_source": 1})
        self.assertEqual(summary["candidate_rejection_counts_by_reason"], {"scope_mismatch": 1})
        self.assertEqual(summary["transport_batch_count"], 1)
        self.assertEqual(summary["transport_arrival_count"], 1)
        self.assertEqual(summary["observed_transport_wait_minutes"], 3.0)
        self.assertEqual(
            summary["interpretation"],
            "descriptive_observed_dispatch_facts_only_no_causal_attribution",
        )

    def test_fulfillment_requires_local_fact_or_arrival_not_selection_or_block(self) -> None:
        # Arrange.
        identity = organization_graph_identity({"runtime_mode": "vertical_lateral"})

        def event(name: str, *, reason: str = "") -> dict:
            details = normalize_organization_event(
                name,
                {
                    "job_id": "job-1",
                    "task_index": 0,
                    "product_id": "spare-a",
                    "supply_mode": "lateral",
                    "reason": reason,
                },
                minute=2,
                identity=identity,
            )
            return {"event": name, "minute": 2, "details": details}

        cases = {
            "selected_only": ([event("organization_supply_selected")], 0),
            "selected_then_arrived": ([
                event("organization_supply_selected"),
                event("organization_transport_arrived"),
            ], 1),
            "local_fulfilled": ([event("organization_local_fulfilled")], 1),
            "blocked": ([event("organization_dispatch_failed", reason="no_eligible_source")], 0),
        }

        # Act / Assert.
        for label, (events, fulfilled_count) in cases.items():
            with self.subTest(label=label):
                summary = organization_dispatch_summary(events, identity=identity)
                self.assertEqual(summary["observed_request_count"], 1)
                self.assertEqual(summary["observed_fulfilled_count"], fulfilled_count)
                self.assertEqual(summary["observed_fulfillment_rate"], float(fulfilled_count))

    def test_aggregate_keeps_equal_sample_local_keys_separate(self) -> None:
        # Arrange.
        identity = organization_graph_identity({"runtime_mode": "vertical_lateral"})
        selected = {
            "event": "organization_supply_selected",
            "source_event_id": "organization-000001",
            "details": normalize_organization_event(
                "organization_supply_selected",
                {"job_id": "job-1", "task_index": 0, "product_id": "spare-a"},
                minute=1,
                identity=identity,
            ),
        }
        arrived = {
            "event": "organization_transport_arrived",
            "source_event_id": "organization-000002",
            "details": normalize_organization_event(
                "organization_transport_arrived",
                {"job_id": "job-1", "task_index": 0, "product_id": "spare-a"},
                minute=2,
                identity=identity,
            ),
        }
        blocked = {
            "event": "organization_dispatch_failed",
            "source_event_id": "organization-000002",
            "details": normalize_organization_event(
                "organization_dispatch_failed",
                {
                    "job_id": "job-1",
                    "task_index": 0,
                    "product_id": "spare-a",
                    "reason": "no_eligible_source",
                },
                minute=2,
                identity=identity,
            ),
        }
        fulfilled_sample = organization_dispatch_summary([selected, arrived], identity=identity)
        blocked_sample = organization_dispatch_summary([selected, blocked], identity=identity)

        # Act.
        aggregate = aggregate_organization_dispatch_summaries(
            [fulfilled_sample, blocked_sample],
            identity=identity,
        )

        # Assert.
        self.assertEqual(aggregate["summary_scope"], "all_samples")
        self.assertEqual(aggregate["sample_count"], 2)
        self.assertEqual(aggregate["observed_request_count"], 2)
        self.assertEqual(aggregate["observed_fulfilled_count"], 1)
        self.assertEqual(aggregate["observed_fulfillment_rate"], 0.5)
        self.assertEqual(aggregate["blocked_counts_by_reason"], {"no_eligible_source": 1})


if __name__ == "__main__":
    unittest.main()
