#!/usr/bin/env python3
"""Normalize the project ontology into the checked-in local IR."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize spare_mvp ontology artifacts.")
    parser.add_argument("--input", required=True, help="Canonical ontology JSON path.")
    parser.add_argument("--output", required=True, help="Normalized ontology output path.")
    parser.add_argument("--report", required=True, help="Validation report output path.")
    args = parser.parse_args()

    input_path = Path(args.input)
    ontology = json.loads(input_path.read_text(encoding="utf-8"))
    normalized = normalize_ontology(ontology)
    report = validation_report(input_path, normalized)

    write_json(Path(args.output), normalized)
    write_json(Path(args.report), report)


def normalize_ontology(ontology: dict[str, Any]) -> dict[str, Any]:
    normalized = json.loads(json.dumps(ontology))
    normalized.pop("metadata", None)
    normalized.pop("source", None)
    entity_ids = {
        entity["id"]: normalize_id(entity["id"])
        for entity in normalized.get("entityTypes", [])
        if isinstance(entity, dict) and entity.get("id")
    }

    for entity in normalized.get("entityTypes", []):
        if isinstance(entity, dict) and entity.get("id"):
            entity["id"] = normalize_id(entity["id"])

    for relationship in normalized.get("relationships", []):
        if not isinstance(relationship, dict):
            continue
        if relationship.get("id"):
            relationship["id"] = normalize_id(relationship["id"])
        if relationship.get("from") in entity_ids:
            relationship["from"] = entity_ids[relationship["from"]]
        if relationship.get("to") in entity_ids:
            relationship["to"] = entity_ids[relationship["to"]]

    return sort_json(normalized)


def normalize_id(value: str) -> str:
    return str(value).strip().replace("_", "-")


def validation_report(source_path: Path, normalized: dict[str, Any]) -> dict[str, Any]:
    entity_types = normalized.get("entityTypes", [])
    relationships = normalized.get("relationships", [])
    property_count = sum(
        len(entity.get("properties", []))
        for entity in entity_types
        if isinstance(entity, dict)
    )
    errors: list[str] = []
    entity_ids = {
        entity.get("id")
        for entity in entity_types
        if isinstance(entity, dict) and entity.get("id")
    }

    for relationship in relationships:
        if not isinstance(relationship, dict):
            continue
        if relationship.get("from") not in entity_ids:
            errors.append(f"{relationship.get('id', '<unknown>')}: missing from entity {relationship.get('from')}")
        if relationship.get("to") not in entity_ids:
            errors.append(f"{relationship.get('id', '<unknown>')}: missing to entity {relationship.get('to')}")

    return sort_json({
        "source": str(source_path),
        "valid": not errors,
        "entity_count": len(entity_types),
        "relationship_count": len(relationships),
        "property_count": property_count,
        "errors": errors,
        "warnings": [],
    })


def sort_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: sort_json(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [sort_json(item) for item in value]
    return value


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
