"""Reliability block diagram: series, parallel, standby connections."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ReliabilityBlock:
    id: str
    name: str
    block_type: str
    connection_type: str
    failure_rate: float
    mtbf_hours: float
    parent_id: str | None = None
    children: list["ReliabilityBlock"] = field(default_factory=list)
    weight: float = 1.0


def build_reliability_diagram(rbd: dict[str, Any]) -> dict[str, ReliabilityBlock]:
    """Build a reliability block diagram from the import package's reliabilityBlockDiagram."""
    blocks: dict[str, ReliabilityBlock] = {}
    edges = rbd.get("edges", [])
    edge_map: dict[str, float] = {}
    for edge in edges:
        edge_map[str(edge.get("to"))] = float(edge.get("weight", 1.0))

    for node in rbd.get("nodes", []):
        node_id = str(node["id"])
        block = ReliabilityBlock(
            id=node_id,
            name=str(node.get("name", node_id)),
            block_type=str(node.get("type", "component")),
            connection_type=str(node.get("connectionType", "串联")),
            failure_rate=float(node.get("failureRate", 0.0) or 0),
            mtbf_hours=float(node.get("mtbfHours", 0.0) or 0),
            parent_id=str(node["parentId"]) if node.get("parentId") else None,
            weight=edge_map.get(node_id, 1.0),
        )
        blocks[node_id] = block
    for block in blocks.values():
        if block.parent_id and block.parent_id in blocks:
            blocks[block.parent_id].children.append(block)
    return blocks


def evaluate_system_reliability(
    blocks: dict[str, ReliabilityBlock],
    dt_hours: float,
) -> float:
    """Evaluate top-level system reliability over dt_hours."""
    roots = [b for b in blocks.values() if b.parent_id is None]
    if not roots:
        return 1.0
    root = roots[0]
    return _evaluate_block_reliability(root, dt_hours)


def _evaluate_block_reliability(block: ReliabilityBlock, dt_hours: float) -> float:
    """Recursively evaluate a block's reliability based on its children's connection type."""
    if not block.children:
        if block.failure_rate <= 0:
            return 1.0
        return math.exp(-block.failure_rate * dt_hours)

    child_reliabilities = [_evaluate_block_reliability(child, dt_hours) for child in block.children]
    connection = block.children[0].connection_type if block.children else block.connection_type

    if "并联" in connection or "parallel" in connection.lower():
        fail_probs = [1.0 - r for r in child_reliabilities]
        return 1.0 - math.prod(fail_probs)

    if "备用" in connection or "standby" in connection.lower():
        primary_r = child_reliabilities[0] if child_reliabilities else 1.0
        backup_r = child_reliabilities[1] if len(child_reliabilities) > 1 else 1.0
        return primary_r + (1.0 - primary_r) * backup_r * block.weight

    return math.prod(child_reliabilities)