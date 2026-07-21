#!/usr/bin/env python3
"""Write or check reproducible multilevel/lateral organization fact cases."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import sys
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_abm.aircraft_support_v1 import AircraftSupportV1Model
from src.spare_mvp_abm.aircraft_support_v1.organization_observability import organization_dispatch_summary


SOURCE_SCENARIO = REPO_ROOT / "tests" / "fixtures" / "aircraft_support_v1_scenario.json"
OUTPUT_PATH = REPO_ROOT / "tests" / "fixtures" / "organization_observability_cases.json"


def _inputs(*, lateral_stock: int, parent_stock: int) -> dict[str, Any]:
    inputs = copy.deepcopy(json.loads(SOURCE_SCENARIO.read_text(encoding="utf-8"))["simulation_inputs"])
    inputs["seed"] = 317
    inputs["aircraft"]["fleet_count"] = 1
    inputs["aircraft"]["initial_ready"] = 1
    inputs["support_network"] = {
        "nodes": [
            {"id": "deck", "name": "Deck", "organization_node_id": "org-leaf", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {"shared-spare": 0}, "transport_policies": []},
            {"id": "parent-stock", "name": "Parent", "organization_node_id": "org-parent", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {"shared-spare": parent_stock}, "transport_policies": []},
            {"id": "lateral-stock", "name": "Lateral", "organization_node_id": "org-sibling", "personnel_capacity": 1, "equipment_capacity": 1, "inventory": {"shared-spare": lateral_stock}, "transport_policies": []},
        ],
        "organization_graph": {
            "runtime_mode": "vertical_lateral",
            "nodes": [
                {"id": "org-root", "name": "Root", "parent_id": None, "service_scope": {}},
                {"id": "org-parent", "name": "Parent", "parent_id": "org-root", "service_scope": {}},
                {"id": "org-leaf", "name": "Leaf", "parent_id": "org-parent", "service_scope": {}},
                {"id": "org-sibling", "name": "Sibling", "parent_id": "org-parent", "service_scope": {}},
            ],
            "parent_edges": [
                {"from_node_id": "org-root", "to_node_id": "org-parent"},
                {"from_node_id": "org-parent", "to_node_id": "org-leaf"},
                {"from_node_id": "org-parent", "to_node_id": "org-sibling"},
            ],
            "lateral_edges": [{"id": "sibling-to-leaf", "from_node_id": "org-sibling", "to_node_id": "org-leaf", "priority": 1, "enabled": True}],
            "resource_ownership": [],
            "transport_policies": [
                {"id": "lateral-policy", "from_organization_node_id": "org-sibling", "to_organization_node_id": "org-leaf", "product_id": "shared-spare", "capacity": 1, "priority": 1, "transport_time_hours": 0},
                {"id": "vertical-policy", "from_organization_node_id": "org-parent", "to_organization_node_id": "org-leaf", "product_id": "shared-spare", "capacity": 1, "priority": 1, "transport_time_hours": 0},
            ],
        },
    }
    activity = inputs["support_activities"]["activities"][0]
    activity.update({
        "id": "corrective",
        "activity_type": "corrective",
        "resource_id": "deck",
        "maintenance_methods": ["replacement"],
        "replacement_ratio": 1.0,
        "jobs": [{"activityCode": "replace", "durationMinutes": 1, "spare": [{"product_id": "shared-spare", "quantity": 1}]}],
    })
    return inputs


def _case(case_id: str, *, lateral_stock: int, parent_stock: int) -> dict[str, Any]:
    model = AircraftSupportV1Model(_inputs(lateral_stock=lateral_stock, parent_stock=parent_stock))
    model._create_job(model.aircraft[0], model.activities[0], kind="repair")
    model._start_waiting_jobs()
    if model.transport_shipments:
        model.minute = min(shipment.arrival_minute for shipment in model.transport_shipments)
        model._process_transport_arrivals()
    events = [event for event in model.event_log if event["event"].startswith("organization_")]
    selected = next((event for event in events if event["event"] == "organization_supply_selected"), None)
    blocked = next((event for event in events if event["event"] == "organization_dispatch_failed"), None)
    return {
        "case_id": case_id,
        "inventory": {"lateral": lateral_stock, "vertical_parent": parent_stock},
        "outcome": "blocked" if blocked else "arrived",
        "selected_source_mode": (selected or {}).get("details", {}).get("source_mode"),
        "blocked_reason": (blocked or {}).get("details", {}).get("reason"),
        "organization_graph_identity": copy.deepcopy(model.organization_graph_identity),
        "organization_dispatch_summary": organization_dispatch_summary(events, identity=model.organization_graph_identity),
        "events": events,
    }


def build_cases() -> dict[str, Any]:
    return {
        "schema_version": "organization-observability-cases-v0",
        "seed": 317,
        "source_scenario": str(SOURCE_SCENARIO.relative_to(REPO_ROOT)),
        "cases": [
            _case("lateral_success", lateral_stock=1, parent_stock=1),
            _case("vertical_fallback", lateral_stock=0, parent_stock=1),
            _case("fail_closed", lateral_stock=0, parent_stock=0),
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = build_cases()
    if args.write:
        OUTPUT_PATH.write_text(json.dumps(expected, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
        return 0
    actual = json.loads(OUTPUT_PATH.read_text(encoding="utf-8")) if OUTPUT_PATH.exists() else None
    if actual != expected:
        print(f"stale: {OUTPUT_PATH.relative_to(REPO_ROOT)}")
        return 1
    print("organization observability cases are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
