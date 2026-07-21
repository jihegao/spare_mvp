"""Stable organization-dispatch identity and conservative event summaries."""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any


ORGANIZATION_EVENT_FACT_TYPES = {
    "organization_local_fulfilled": "supply_selected",
    "organization_resource_selected": "supply_selected",
    "organization_supply_selected": "supply_selected",
    "organization_candidate_rejected": "candidate_rejected",
    "organization_resource_dispatched": "dispatch_started",
    "organization_transport_dispatched": "dispatch_started",
    "organization_resource_arrived": "dispatch_arrived",
    "organization_transport_arrived": "dispatch_arrived",
    "organization_resource_blocked": "supply_blocked",
    "organization_dispatch_failed": "supply_blocked",
    "organization_resources_released": "resource_released",
    "organization_spare_reservation_returned": "resource_released",
}


def canonical_organization_graph(graph: Any) -> dict[str, Any]:
    """Return an order-independent JSON-safe organization graph."""
    if not isinstance(graph, dict):
        graph = {}

    def normalize(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): normalize(value[key]) for key in sorted(value)}
        if isinstance(value, list):
            items = [normalize(item) for item in value]
            return sorted(
                items,
                key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    return normalize(copy.deepcopy(graph))


def organization_graph_identity(graph: Any) -> dict[str, str]:
    canonical = canonical_organization_graph(graph)
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    runtime_mode = str(canonical.get("runtime_mode") or canonical.get("runtimeMode") or "legacy")
    return {
        "runtime_mode": runtime_mode,
        "graph_hash": hashlib.sha256(encoded).hexdigest(),
        "hash_algorithm": "sha256",
    }


def normalize_organization_event(
    event: str,
    details: Any,
    *,
    minute: int | float,
    identity: dict[str, str],
) -> dict[str, Any]:
    payload = copy.deepcopy(details) if isinstance(details, dict) else {}
    path = payload.get("organization_path") if isinstance(payload.get("organization_path"), list) else []
    supply_mode = str(payload.get("supply_mode") or ("local" if event == "organization_local_fulfilled" else ""))
    requested_minute = payload.get("requested_minute", minute)
    arrival_minute = payload.get("arrival_minute")
    wait_minutes = payload.get("wait_minutes")
    if wait_minutes is None and isinstance(arrival_minute, (int, float)) and isinstance(requested_minute, (int, float)):
        wait_minutes = max(0, arrival_minute - requested_minute)
    payload.update({
        "fact_type": ORGANIZATION_EVENT_FACT_TYPES.get(event, "organization_fact"),
        "runtime_mode": identity["runtime_mode"],
        "organization_graph_hash": identity["graph_hash"],
        "source_mode": supply_mode,
        "source_organization_node_id": str(
            payload.get("source_organization_node_id") or (path[0] if path else "")
        ),
        "destination_organization_node_id": str(
            payload.get("destination_organization_node_id") or (path[-1] if path else payload.get("organization_node_id") or "")
        ),
        "destination_resource_id": str(
            payload.get("destination_resource_id") or payload.get("resource_id") or ""
        ),
        "reason": str(payload.get("reason") or ""),
        "relation_id": str(payload.get("relation_id") or ""),
        "requested_minute": requested_minute,
        "wait_minutes": max(0, float(wait_minutes or 0)),
    })
    return payload


def organization_dispatch_summary(
    events: Any,
    *,
    identity: dict[str, str],
) -> dict[str, Any]:
    facts = [
        event for event in events if isinstance(event, dict) and str(event.get("event") or "").startswith("organization_")
    ] if isinstance(events, list) else []
    selected = [event for event in facts if (event.get("details") or {}).get("fact_type") == "supply_selected"]
    blocked = [event for event in facts if (event.get("details") or {}).get("fact_type") == "supply_blocked"]
    arrived = [event for event in facts if (event.get("details") or {}).get("fact_type") == "dispatch_arrived"]
    dispatched = [event for event in facts if (event.get("details") or {}).get("fact_type") == "dispatch_started"]

    def counts(items: list[dict[str, Any]], field: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in items:
            value = str((item.get("details") or {}).get(field) or "unspecified")
            result[value] = result.get(value, 0) + 1
        return dict(sorted(result.items()))

    request_keys = {
        (
            str((event.get("details") or {}).get("job_id") or ""),
            int((event.get("details") or {}).get("task_index") or 0),
            str((event.get("details") or {}).get("resource_kind") or (event.get("details") or {}).get("product_id") or "job_task"),
        )
        for event in selected + blocked
    }
    fulfilled_keys = {
        (
            str((event.get("details") or {}).get("job_id") or ""),
            int((event.get("details") or {}).get("task_index") or 0),
            str((event.get("details") or {}).get("resource_kind") or (event.get("details") or {}).get("product_id") or "job_task"),
        )
        for event in selected
    }
    request_count = len(request_keys)
    fulfilled_count = len(fulfilled_keys)
    return {
        "schema_version": "organization-dispatch-summary-v0",
        **copy.deepcopy(identity),
        "observed_request_count": request_count,
        "observed_fulfilled_count": fulfilled_count,
        "observed_fulfillment_rate": (fulfilled_count / request_count) if request_count else None,
        "selection_counts_by_source_mode": counts(selected, "source_mode"),
        "blocked_counts_by_reason": counts(blocked, "reason"),
        "candidate_rejection_counts_by_reason": counts(
            [event for event in facts if (event.get("details") or {}).get("fact_type") == "candidate_rejected"],
            "reason",
        ),
        "transport_batch_count": len(dispatched),
        "transport_arrival_count": len(arrived),
        "observed_transport_wait_minutes": sum(
            max(0.0, float((event.get("details") or {}).get("wait_minutes") or 0)) for event in arrived
        ),
        "interpretation": "descriptive_observed_dispatch_facts_only_no_causal_attribution",
    }
