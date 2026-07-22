#!/usr/bin/env python3
"""Generate directly importable clean Project JSON templates."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from src.spare_mvp_backend.project_payload import ProjectJsonExporter
from src.spare_mvp_backend.repository import ContractRepository


EXPORT_DIR = REPO_ROOT / "exports"
CASE_LARGE_PATH = EXPORT_DIR / "project-case-large.json"
MINIMUM_PATH = EXPORT_DIR / "project-minimum-001.json"
MINIMUM_SOURCE_PROJECT_ID = "project-carrier-day-night"
MINIMUM_TEMPLATE_PROJECT_ID = "project-template-minimum-001"
MINIMUM_TEMPLATE_SCENARIO_ID = "template-minimum-001"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_project(database_path: Path, project_id: str) -> dict[str, Any]:
    connection = sqlite3.connect(database_path)
    try:
        return ContractRepository(connection).get_project(project_id)
    finally:
        connection.close()


def _template_project(
    project: dict[str, Any],
    *,
    exporter: ProjectJsonExporter,
    template_project_id: str | None = None,
    template_scenario_id: str | None = None,
) -> dict[str, Any]:
    source_project_id = str(project.get("project_id") or "").strip()
    clean = exporter.export(project)
    _canonicalize_support_activity_resource_refs(clean)
    if template_project_id:
        clean["project_id"] = template_project_id
    if template_scenario_id:
        clean["scenarioId"] = template_scenario_id

    project_info = clean.setdefault("projectInfo", {})
    project_info["isTemplate"] = True
    project_info["is_template"] = True
    if source_project_id and source_project_id != clean.get("project_id"):
        project_info["sourceProjectId"] = source_project_id
    return clean


def _canonicalize_support_activity_resource_refs(project: dict[str, Any]) -> None:
    nodes = project.get("supportNodes") if isinstance(project.get("supportNodes"), list) else []
    for index, activity in enumerate(project.get("supportActivities") or []):
        current = str(activity.get("resourceId") or "").strip()
        if not current:
            continue
        matches = [
            node
            for node in nodes
            if current
            in {
                str(node.get("id") or "").strip(),
                str(node.get("organizationNodeId") or "").strip(),
                str(node.get("name") or "").strip(),
                str(node.get("supportNodeName") or "").strip(),
            }
        ]
        if len(matches) != 1:
            raise ValueError(
                f"supportActivities[{index}].resourceId={current!r} does not resolve to exactly one support node"
            )
        activity["resourceId"] = str(
            matches[0].get("organizationNodeId") or matches[0].get("id") or ""
        ).strip()


def build_templates(database_path: Path) -> dict[Path, dict[str, Any]]:
    exporter = ProjectJsonExporter(target="aircraft_support_v1", repo_root=REPO_ROOT)
    case_large = _template_project(_load_json(CASE_LARGE_PATH), exporter=exporter)
    minimum = _template_project(
        _load_project(database_path, MINIMUM_SOURCE_PROJECT_ID),
        exporter=exporter,
        template_project_id=MINIMUM_TEMPLATE_PROJECT_ID,
        template_scenario_id=MINIMUM_TEMPLATE_SCENARIO_ID,
    )
    return {
        CASE_LARGE_PATH: case_large,
        MINIMUM_PATH: minimum,
    }


def _serialized(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_templates(database_path: Path) -> None:
    for path, payload in build_templates(database_path).items():
        path.write_text(_serialized(payload), encoding="utf-8")


def template_drift(database_path: Path) -> list[str]:
    return [
        str(path.relative_to(REPO_ROOT))
        for path, expected in build_templates(database_path).items()
        if not path.exists() or path.read_text(encoding="utf-8") != _serialized(expected)
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=REPO_ROOT / "runs" / "system-start" / "spare_mvp.sqlite3",
        help="backend SQLite database containing the MINIMUM-001 source Project",
    )
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--write", action="store_true")
    action.add_argument("--check", action="store_true")
    args = parser.parse_args()

    database_path = args.database.expanduser().resolve()
    if not database_path.is_file():
        parser.error(f"database does not exist: {database_path}")

    if args.write:
        write_templates(database_path)
        print("wrote importable Project JSON templates:")
        for path in build_templates(database_path):
            print(f"- {path.relative_to(REPO_ROOT)}")
        return 0

    drifted = template_drift(database_path)
    if drifted:
        print("Project JSON templates are missing or stale:")
        for path in drifted:
            print(f"- {path}")
        return 1
    print("Project JSON templates are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
