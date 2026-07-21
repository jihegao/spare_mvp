"""Stable organization-dispatch identity and conservative event summaries."""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any


ORGANIZATION_EVENT_FACT_TYPES = {
    "organization_local_fulfilled": "local_fulfilled",
    "organization_resource_selected": "selection_made",
    "organization_supply_selected": "selection_made",
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
    stable = {
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
        "requirement_type": str(
            payload.get("requirement_type")
            or (payload.get("resource_kind") if payload.get("resource_kind") in {"personnel", "equipment"} else "")
            or ("spare" if payload.get("product_id") else "organization")
        ),
        "requirement_id": str(
            payload.get("requirement_id")
            or payload.get("resource_kind")
            or payload.get("product_id")
            or payload.get("resource_id")
            or payload.get("organization_node_id")
            or "organization"
        ),
    }
    existing_context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    stable["context"] = {
        **copy.deepcopy(existing_context),
        **{
            key: copy.deepcopy(value)
            for key, value in payload.items()
            if key not in stable and key != "context"
        },
    }
    return stable


def organization_dispatch_summary(
    events: Any,
    *,
    identity: dict[str, str],
) -> dict[str, Any]:
    raw_facts = [
        event for event in events if isinstance(event, dict) and str(event.get("event") or "").startswith("organization_")
    ] if isinstance(events, list) else []
    facts: list[dict[str, Any]] = []
    seen_source_ids: set[str] = set()
    for event in raw_facts:
        source_event_id = str(event.get("source_event_id") or "")
        if source_event_id and source_event_id in seen_source_ids:
            continue
        if source_event_id:
            seen_source_ids.add(source_event_id)
        facts.append(event)
    def values(event: dict[str, Any]) -> dict[str, Any]:
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        context = details.get("context") if isinstance(details.get("context"), dict) else {}
        return {**context, **details}

    selected = [event for event in facts if values(event).get("fact_type") == "selection_made"]
    local_fulfilled = [
        event for event in facts if values(event).get("fact_type") == "local_fulfilled"
    ]
    blocked = [event for event in facts if values(event).get("fact_type") == "supply_blocked"]
    arrived = [event for event in facts if values(event).get("fact_type") == "dispatch_arrived"]
    dispatched = [event for event in facts if values(event).get("fact_type") == "dispatch_started"]

    def counts(items: list[dict[str, Any]], field: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in items:
            value = str(values(item).get(field) or "unspecified")
            result[value] = result.get(value, 0) + 1
        return dict(sorted(result.items()))

    def fact_keys(event: dict[str, Any]) -> set[tuple[str, int, str]]:
        details = values(event)
        job_id = str(details.get("job_id") or "")
        task_index = int(details.get("task_index") or 0)
        requirement_type = str(details.get("requirement_type") or "organization")
        requirement_id = str(details.get("requirement_id") or "organization")
        return {(job_id, task_index, f"{requirement_type}:{requirement_id}")}

    request_keys: set[tuple[str, int, str]] = set()
    for event in selected + local_fulfilled + blocked:
        request_keys.update(fact_keys(event))
    fulfilled_keys: set[tuple[str, int, str]] = set()
    for event in local_fulfilled + arrived:
        fulfilled_keys.update(fact_keys(event))
    request_count = len(request_keys)
    fulfilled_count = len(fulfilled_keys)
    return {
        "schema_version": "organization-dispatch-summary-v0",
        **copy.deepcopy(identity),
        "summary_scope": "single_run",
        "sample_count": 1,
        "observed_request_count": request_count,
        "observed_fulfilled_count": fulfilled_count,
        "observed_fulfillment_rate": (fulfilled_count / request_count) if request_count else None,
        "selection_counts_by_source_mode": counts(selected + local_fulfilled, "source_mode"),
        "blocked_counts_by_reason": counts(blocked, "reason"),
        "candidate_rejection_counts_by_reason": counts(
            [event for event in facts if values(event).get("fact_type") == "candidate_rejected"],
            "reason",
        ),
        "transport_batch_count": len(dispatched),
        "transport_arrival_count": len(arrived),
        "observed_transport_wait_minutes": sum(
            max(0.0, float(values(event).get("wait_minutes") or 0)) for event in arrived
        ),
        "interpretation": "descriptive_observed_dispatch_facts_only_no_causal_attribution",
    }


def aggregate_organization_dispatch_summaries(
    summaries: Any,
    *,
    identity: dict[str, str],
) -> dict[str, Any]:
    """Aggregate already-isolated sample facts without merging sample-local request keys."""
    items = [item for item in summaries if isinstance(item, dict)] if isinstance(summaries, list) else []

    def sum_counts(field: str) -> dict[str, int]:
        result: dict[str, int] = {}
        for item in items:
            values = item.get(field) if isinstance(item.get(field), dict) else {}
            for key, value in values.items():
                normalized_key = str(key)
                result[normalized_key] = result.get(normalized_key, 0) + max(0, int(value or 0))
        return dict(sorted(result.items()))

    request_count = sum(max(0, int(item.get("observed_request_count") or 0)) for item in items)
    fulfilled_count = sum(max(0, int(item.get("observed_fulfilled_count") or 0)) for item in items)
    return {
        "schema_version": "organization-dispatch-summary-v0",
        **copy.deepcopy(identity),
        "summary_scope": "all_samples",
        "sample_count": len(items),
        "observed_request_count": request_count,
        "observed_fulfilled_count": fulfilled_count,
        "observed_fulfillment_rate": (fulfilled_count / request_count) if request_count else None,
        "selection_counts_by_source_mode": sum_counts("selection_counts_by_source_mode"),
        "blocked_counts_by_reason": sum_counts("blocked_counts_by_reason"),
        "candidate_rejection_counts_by_reason": sum_counts("candidate_rejection_counts_by_reason"),
        "transport_batch_count": sum(max(0, int(item.get("transport_batch_count") or 0)) for item in items),
        "transport_arrival_count": sum(max(0, int(item.get("transport_arrival_count") or 0)) for item in items),
        "observed_transport_wait_minutes": sum(
            max(0.0, float(item.get("observed_transport_wait_minutes") or 0)) for item in items
        ),
        "interpretation": "descriptive_observed_dispatch_facts_only_no_causal_attribution",
    }
