"""Equipment tree, failure distribution samplers, kOutOfN redundancy, lifeLimit."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.stats import weibull_min, norm


def sample_exponential_failure(rate: float, dt: float, rng: np.random.Generator) -> bool:
    """Return True if a failure occurs in time interval dt (exponential distribution)."""
    if rate <= 0 or dt <= 0:
        return False
    prob = 1.0 - math.exp(-rate * dt)
    return bool(rng.random() < prob)


def sample_weibull_failure(beta: float, eta: float, dt: float, rng: np.random.Generator) -> bool:
    """Return True if a Weibull-distributed failure occurs in interval dt."""
    if beta <= 0 or eta <= 0 or dt <= 0:
        return False
    prob = 1.0 - math.exp(-((dt / eta) ** beta))
    return bool(rng.random() < prob)


def sample_normal_lifetime(mean: float, sigma: float, elapsed: float, rng: np.random.Generator) -> float:
    """Return remaining lifetime (hours) given elapsed hours, using normal distribution."""
    if sigma <= 0:
        return max(0.0, mean - elapsed)
    total_life = float(rng.normal(mean, sigma))
    return max(0.0, total_life - elapsed)


import re


class EquipmentNode:
    """A node in the equipment tree (SRU, LRU, or whole aircraft)."""

    def __init__(
        self,
        id: str,
        name: str,
        quantity: int = 1,
        parent_id: str | None = None,
        aircraft_model: str | None = None,
        product_type: str = "LRU",
        spare_type: str | None = None,
        failure_model: str = "随机",
        failure_distribution: dict[str, Any] | None = None,
        failure_rate: float = 0.0,
        mtbf_hours: float = 0.0,
        life_limit_hours: float = 0.0,
        connection_type: str = "串联",
        k_out_of_n: dict[str, Any] | None = None,
        special_repair_profile: dict[str, Any] | None = None,
        rms: dict[str, Any] | None = None,
    ) -> None:
        self.id = id
        self.name = name
        self.quantity = quantity
        self.parent_id = parent_id
        self.aircraft_model = aircraft_model
        self.product_type = product_type
        self.spare_type = spare_type
        self.failure_model = failure_model
        self.failure_distribution = failure_distribution or {}
        self.failure_rate = failure_rate
        self.mtbf_hours = mtbf_hours
        self.life_limit_hours = life_limit_hours
        self.connection_type = connection_type
        self.k_out_of_n = k_out_of_n or {"enabled": False, "n": 1, "k": 1}
        self.special_repair_profile = special_repair_profile or {}
        self.rms = rms or {}
        self.children: list[EquipmentNode] = []
        self.parent: EquipmentNode | None = None
        self.health = "healthy"
        self.accumulated_hours = 0.0
        self.failure_count = 0
        self.failed_children_count = 0


def parse_failure_distribution(
    raw: dict[str, Any] | None,
    failure_model: str,
    mtbf_hours: float,
) -> dict[str, Any]:
    """Parse a failureDistribution object into a typed sampler config."""
    if raw is None or not isinstance(raw, dict):
        return {"type": "exponential", "rate": 1.0 / max(mtbf_hours, 1.0)}
    dist_type = str(raw.get("distributionType", ""))
    params = str(raw.get("parameters", ""))
    if "指数" in dist_type:
        rate = _extract_param(params, "lambda", 1.0 / max(mtbf_hours, 1.0))
        return {"type": "exponential", "rate": float(rate)}
    if "威布尔" in dist_type or "weibull" in dist_type.lower():
        beta = _extract_param(params, "beta", 2.0)
        eta = _extract_param(params, "eta", max(mtbf_hours, 1.0))
        return {"type": "weibull", "beta": float(beta), "eta": float(eta)}
    if "正态" in dist_type or "normal" in dist_type.lower():
        mean = _extract_param(params, "mean", mtbf_hours)
        sigma = _extract_param(params, "sigma", max(mtbf_hours * 0.1, 1.0))
        return {"type": "normal", "mean": float(mean), "sigma": float(sigma)}
    return {"type": "exponential", "rate": 1.0 / max(mtbf_hours, 1.0)}


def _extract_param(params_str: str, key: str, fallback: float) -> float:
    """Extract a numeric parameter from a string like 'beta=1.8, eta=140'."""
    match = re.search(rf"\b{key}\s*=\s*([0-9.eE+-]+)", params_str)
    if match:
        return float(match.group(1))
    return fallback


def build_equipment_tree(assets: list[dict[str, Any]]) -> dict[str, EquipmentNode]:
    """Build a parent-child tree from a flat list of equipment asset dicts."""
    nodes: dict[str, EquipmentNode] = {}
    for row in assets:
        node_id = str(row.get("id") or row.get("name") or "")
        node = EquipmentNode(
            id=node_id,
            name=str(row.get("name") or node_id),
            quantity=int(row.get("quantity", 1)),
            parent_id=str(row["parentId"]) if row.get("parentId") else None,
            aircraft_model=str(row["aircraftModel"]) if row.get("aircraftModel") else None,
            product_type=str(row.get("productType", "LRU")),
            spare_type=str(row["spareType"]) if row.get("spareType") else None,
            failure_model=str(row.get("failureModel", "随机")),
            failure_distribution=parse_failure_distribution(
                row.get("failureDistribution"),
                str(row.get("failureModel", "随机")),
                float(row.get("mtbfHours", 0) or 0),
            ),
            failure_rate=float(row.get("failureRate", 0) or 0),
            mtbf_hours=float(row.get("mtbfHours", 0) or 0),
            life_limit_hours=float(row.get("lifeLimitHours", 0) or 0),
            connection_type=str(row.get("connectionType", "串联")),
            k_out_of_n=row.get("kOutOfN") or {"enabled": False, "n": 1, "k": 1},
            special_repair_profile=row.get("specialRepairProfile") or {},
            rms=row.get("rms") or {},
        )
        nodes[node_id] = node
    for node in nodes.values():
        if node.parent_id and node.parent_id in nodes:
            parent = nodes[node.parent_id]
            node.parent = parent
            parent.children.append(node)
    return nodes


def check_k_out_of_n(node: EquipmentNode) -> bool:
    """Return True if the node's kOutOfN failure threshold is met."""
    k_config = node.k_out_of_n or {}
    if not k_config.get("enabled", False):
        return False
    k = int(k_config.get("k", 1))
    return node.failed_children_count >= k
