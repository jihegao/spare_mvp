"""Load the modeling-import-v1 package and apply documented numeric overrides."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
GPT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMPORT_PATH = ROOT / "tests" / "fixtures" / "modeling_import_project.json"
DEFAULT_OVERRIDES_PATH = GPT_ROOT / "data" / "input_overrides.json"


def load_scenario(
    import_path: Path | None = None,
    overrides_path: Path | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return a corrected import package plus the applied change ledger."""

    package_path = import_path or DEFAULT_IMPORT_PATH
    override_path = overrides_path or DEFAULT_OVERRIDES_PATH
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package = deepcopy(package)
    override_doc = json.loads(override_path.read_text(encoding="utf-8"))

    applied: list[dict[str, Any]] = []
    for item in override_doc.get("overrides", []):
        path = str(item["path"])
        old_value = _get_path(package, path)
        expected_old = item.get("from")
        if old_value != expected_old:
            raise ValueError(
                f"Override precondition failed for {path}: expected {expected_old!r}, got {old_value!r}"
            )
        _set_path(package, path, item.get("to"))
        applied.append(
            {
                "path": path,
                "from": old_value,
                "to": item.get("to"),
                "why": item.get("why", ""),
            }
        )
    return package, applied


def scenario_summary(package: dict[str, Any]) -> dict[str, Any]:
    objects = package["objects"]
    mission = objects["missionProfiles"][0]
    combat_members = mission.get("combatUnit", {}).get("members", [])
    return {
        "importId": package.get("importId"),
        "schemaVersion": package.get("schemaVersion"),
        "durationHours": mission.get("durationHours"),
        "aircraft": len(combat_members),
        "j15Count": sum(1 for item in combat_members if item.get("model") == "J-15"),
        "j35Count": sum(1 for item in combat_members if item.get("model") == "J-35"),
        "supportNodes": len(objects.get("supportResources", [])),
        "supportActivities": len(objects.get("supportActivities", [])),
        "equipmentAssets": len(objects.get("equipmentAssets", [])),
        "analysisRequests": objects.get("analysisRequests", {}),
        "monteCarlo": mission.get("monteCarlo", {}),
    }


def _get_path(data: Any, path: str) -> Any:
    node = data
    for token in _parse_path(path):
        node = node[token]
    return node


def _set_path(data: Any, path: str, value: Any) -> None:
    tokens = _parse_path(path)
    node = data
    for token in tokens[:-1]:
        node = node[token]
    node[tokens[-1]] = value


def _parse_path(path: str) -> list[str | int]:
    tokens: list[str | int] = []
    for part in path.split("."):
        while "[" in part:
            name, rest = part.split("[", 1)
            if name:
                tokens.append(name)
            index, part = rest.split("]", 1)
            tokens.append(int(index))
            if part.startswith("."):
                part = part[1:]
        if part:
            tokens.append(part)
    return tokens
