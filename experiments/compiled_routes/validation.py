"""Explicit compatibility boundary and resource/DAG invariants."""
import copy

from experiments.event_calendar.benchmark import first_difference

# Only polling-derived auxiliary observations are relaxed. Every other metric,
# mission/failure/maintenance/transport event, timestamp and RNG draw is checked.
AUX_METRICS = {"downtime_resource_delay_events"}
AUX_EVENTS = {"personnel_delay", "equipment_shortage"}


def core_result(result):
    result = copy.deepcopy(result)
    for key in AUX_METRICS:
        result["metrics"].pop(key, None)
    result["events"] = [event for event in result["events"] if event["event"] not in AUX_EVENTS]
    return result


def compare(reference, candidate):
    return {"exact_difference": first_difference(reference, candidate),
            "core_difference": first_difference(core_result(reference), core_result(candidate))}


class CheckedMixin:
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.initial_spares = sum(sum(node["inventory"].values()) for node in self.nodes.values())
        self.invariant_checks = 0

    def _record_downtime_minutes(self):
        super()._record_downtime_minutes()
        for node in self.nodes.values():
            for resource in ("personnel", "equipment"):
                assert 0 <= node[resource + "_in_use"] <= node[resource + "_capacity"], (self.minute, node["id"], resource)
            assert all(q >= 0 for q in node["inventory"].values())
        stock = sum(sum(node["inventory"].values()) for node in self.nodes.values())
        reserved = sum(sum(job.spare_reservations.values()) for job in self.jobs)
        travelling = sum(shipment.quantity for shipment in self.transport_shipments)
        assert stock + reserved + travelling + self.spare_consumed_total == self.initial_spares, "spare conservation"
        if self.canonical_organization_enabled:
            for node in self.nodes.values():
                for resource in ("personnel", "equipment"):
                    reserved_capacity = sum(job.resource_reservations.get(resource, ("", 0))[1]
                        for job in self.jobs if job.resource_reservations.get(resource, ("", 0))[0] == node["id"])
                    assert reserved_capacity == node[resource + "_in_use"], "capacity reservation conservation"
        for group in getattr(self, "dag_groups", {}).values():
            for i, child in enumerate(group["children"]):
                if child.state in {"running", "completed"}:
                    assert all(group["children"][p].state == "completed" for p in group["dag"].predecessors[i]), "DAG predecessor not completed"
        self.invariant_checks += 1
