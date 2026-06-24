"""M9.6 platform case package export and field coverage helpers."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from src.spare_mvp_backend.modeling_import import modeling_import_to_project, validate_modeling_import_package
from src.spare_mvp_backend.monte_carlo_config import normalize_monte_carlo_run_config
from src.spare_mvp_contract.adapter import SimulationAdapter


M9_6_MODEL_FAMILY = "aviation_support"
M9_7_COVERAGE_MODEL_FAMILY = "aircraft_support_v1"
M9_6_FROZEN_AT = "2026-06-23T00:00:00Z"
M9_6_MODELING_SNAPSHOT_ID = "snapshot-m9-6-platform-case"
M9_6_EXPERIMENT_PLAN_ID = "experiment-plan-m9-6-platform-case"
M9_6_SINGLE_RUN_INTENT_ID = "run-intent-m9-6-single"
M9_6_MONTE_CARLO_RUN_INTENT_ID = "run-intent-m9-6-monte-carlo"
M9_6_MC_EXPERIMENT_ID = "mc-m9-6-platform-case"


def build_m9_6_platform_case_export(import_package: dict[str, Any], repo_root: Path | str | None = None) -> dict[str, Any]:
    """Build the deterministic M9.6 platform object chain from the canonical import package."""
    validation = validate_modeling_import_package(import_package)
    if not validation["ok"]:
        raise ValueError(f"M9.6 modeling import package is invalid: {validation['issues']}")
    published_import = copy.deepcopy(import_package)
    lifecycle = published_import.setdefault("lifecycle", {})
    lifecycle["state"] = "published"
    lifecycle.setdefault("version", 1)
    lifecycle.setdefault("referencedRunIds", [])
    published_import.setdefault("validation", {"status": "valid", "issues": []})

    project = modeling_import_to_project(published_import)
    modeling_snapshot = {
        "schema_version": "modeling-snapshot-v0",
        "snapshot_id": M9_6_MODELING_SNAPSHOT_ID,
        "project_id": project["project_id"],
        "project_version": project["project_version"],
        "source_import_id": published_import["importId"],
        "created_at": M9_6_FROZEN_AT,
        "projectJson": copy.deepcopy(project),
    }
    experiment_plan = {
        "schema_version": "experiment-plan-v0",
        "experiment_plan_id": M9_6_EXPERIMENT_PLAN_ID,
        "project_id": project["project_id"],
        "modeling_snapshot_id": modeling_snapshot["snapshot_id"],
        "name": "M9.6 平台案例冻结方案",
        "created_at": M9_6_FROZEN_AT,
        "config": {
            "steps": _positive_int(project.get("experiment", {}).get("steps"), 48),
            "projectJson": copy.deepcopy(project),
            "analysisRequests": copy.deepcopy(project.get("analysisRequests", {})),
        },
    }
    monte_carlo_config = normalize_monte_carlo_run_config(
        experiment_plan["config"],
        mc_experiment_id=M9_6_MC_EXPERIMENT_ID,
    ).to_adapter_payload()
    compiled_scenario = SimulationAdapter(repo_root).compile_scenario(project, model_family=M9_6_MODEL_FAMILY)
    compiled_scenario["compiled_at"] = M9_6_FROZEN_AT
    provenance = compiled_scenario["compiled_from"]["mapping_provenance"]
    provenance["modeling_snapshot_id"] = modeling_snapshot["snapshot_id"]
    provenance["experiment_plan_id"] = experiment_plan["experiment_plan_id"]

    return {
        "schema_version": "m9-6-platform-case-export-v0",
        "frozen_at": M9_6_FROZEN_AT,
        "source_fixture": "tests/fixtures/modeling_import_project.json",
        "validation": validation,
        "published_modeling_import": published_import,
        "project": project,
        "modeling_snapshot": modeling_snapshot,
        "experiment_plan": experiment_plan,
        "run_intents": {
            "single": _run_intent(M9_6_SINGLE_RUN_INTENT_ID, project, experiment_plan, "single"),
            "monte_carlo": _run_intent(
                M9_6_MONTE_CARLO_RUN_INTENT_ID,
                project,
                experiment_plan,
                "monte_carlo",
            ),
        },
        "monte_carlo_config": monte_carlo_config,
        "compiled_scenario": compiled_scenario,
    }


def build_m9_6_field_coverage(import_package: dict[str, Any]) -> dict[str, Any]:
    """Return one coverage entry for every business leaf path in the M9.6 case package."""
    entries = [_coverage_entry(path) for path in _business_leaf_paths(import_package)]
    return {
        "schema_version": "m9-6-field-coverage-v0",
        "source_fixture": "tests/fixtures/modeling_import_project.json",
        "source_import_id": str(import_package.get("importId") or ""),
        "model_family": M9_7_COVERAGE_MODEL_FAMILY,
        "entries": entries,
        "summary": {
            "total_fields": len(entries),
            "consumed": sum(1 for entry in entries if entry["status"] == "consumed"),
            "derived": sum(1 for entry in entries if entry["status"] == "derived"),
            "defaulted": sum(1 for entry in entries if entry["status"] == "defaulted"),
            "governance_only": sum(1 for entry in entries if entry["status"] == "governance_only"),
            "ignored": sum(1 for entry in entries if entry["status"] == "ignored"),
            "unsupported": sum(1 for entry in entries if entry["status"] == "unsupported"),
        },
    }


def m9_6_expected_artifact_kinds() -> dict[str, Any]:
    """Freeze the artifact kind surface M9.7 must preserve for this case."""
    return {
        "schema_version": "m9-6-expected-artifact-kinds-v0",
        "model_family": M9_6_MODEL_FAMILY,
        "single": [
            "run_config",
            "input_project",
            "compiled_scenario",
            "snapshot",
            "result_summary",
            "metrics",
            "report",
            "log",
            "visualization_state_series",
            "analysis_projection_spare_shortfall",
            "analysis_projection_carry_list",
            "analysis_projection_mission_reliability",
            "analysis_projection_downtime_factors",
        ],
        "monte_carlo": [
            "run_config",
            "input_project",
            "compiled_scenario",
            "sample_results",
            "aggregate_result",
            "result_summary",
            "metrics",
            "report",
            "log",
            "monte_carlo_base",
            "visualization_state_series",
            "analysis_projection_spare_shortfall",
            "analysis_projection_carry_list",
            "analysis_projection_mission_reliability",
            "analysis_projection_downtime_factors",
        ],
    }


def write_m9_6_golden_fixtures(repo_root: Path | str) -> None:
    root = Path(repo_root)
    import_package = json.loads((root / "tests/fixtures/modeling_import_project.json").read_text(encoding="utf-8"))
    outputs = {
        "tests/fixtures/m9_6_platform_case_export.json": build_m9_6_platform_case_export(
            import_package,
            repo_root=root,
        ),
        "tests/fixtures/m9_6_field_coverage.json": build_m9_6_field_coverage(import_package),
        "tests/fixtures/m9_6_expected_artifact_kinds.json": m9_6_expected_artifact_kinds(),
    }
    for relative_path, payload in outputs.items():
        _write_json(root / relative_path, payload)


def m9_6_golden_fixture_drift(repo_root: Path | str) -> list[str]:
    root = Path(repo_root)
    import_package = json.loads((root / "tests/fixtures/modeling_import_project.json").read_text(encoding="utf-8"))
    expected = {
        "tests/fixtures/m9_6_platform_case_export.json": build_m9_6_platform_case_export(
            import_package,
            repo_root=root,
        ),
        "tests/fixtures/m9_6_field_coverage.json": build_m9_6_field_coverage(import_package),
        "tests/fixtures/m9_6_expected_artifact_kinds.json": m9_6_expected_artifact_kinds(),
    }
    drifted = []
    for relative_path, payload in expected.items():
        path = root / relative_path
        if not path.exists():
            drifted.append(relative_path)
            continue
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing != payload:
            drifted.append(relative_path)
    return drifted


def _run_intent(intent_id: str, project: dict[str, Any], experiment_plan: dict[str, Any], run_type: str) -> dict[str, Any]:
    return {
        "schema_version": "run-intent-v0",
        "run_intent_id": intent_id,
        "project_id": project["project_id"],
        "experiment_plan_id": experiment_plan["experiment_plan_id"],
        "modeling_snapshot_id": experiment_plan["modeling_snapshot_id"],
        "model_family": M9_6_MODEL_FAMILY,
        "run_type": run_type,
        "formal_run": True,
        "created_at": M9_6_FROZEN_AT,
    }


def _coverage_entry(field_path: str) -> dict[str, str]:
    status, target, rationale = _coverage_classification(field_path)
    return {
        "field_path": field_path,
        "status": status,
        "target": target,
        "rationale": rationale,
    }


def _coverage_classification(field_path: str) -> tuple[str, str, str]:
    consumed_prefixes = (
        "importId",
        "projectId",
        "objects.missionProfiles[].durationHours",
        "objects.missionProfiles[].basicMission.equipmentQuantity",
        "objects.missionProfiles[].experiment.seed",
        "objects.equipment.quantity",
        "objects.supportResources[].personnelCapacity",
        "objects.supportResources[].equipmentCapacity",
        "objects.analysisRequests.largeSample.enabled",
        "objects.analysisRequests.largeSample.samples",
        "objects.analysisRequests.largeSample.sweep.failureRates[]",
        "objects.analysisRequests.largeSample.sweep.spareMultipliers[]",
        "objects.analysisRequests.largeSample.sweep.supportCapacities[]",
        "objects.equipmentAssets[].failureDistribution.",
        "objects.equipmentAssets[].kOutOfN.",
        "objects.equipmentAssets[].specialRepairProfile.repairTimeMinutes",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].connectionType",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].failureRate",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].id",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].mtbfHours",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].parentId",
        "objects.missionProfiles[].reliabilityBlockDiagram.edges[].to",
        "objects.missionProfiles[].reliabilityBlockDiagram.edges[].type",
        "objects.missionProfiles[].reliabilityBlockDiagram.edges[].weight",
        "objects.supportActivities[].jobs[].activityCode",
        "objects.supportActivities[].jobs[].durationMinutes",
        "objects.supportActivities[].jobs[].equipment",
        "objects.supportActivities[].jobs[].personnel",
        "objects.supportActivities[].jobs[].predecessors",
        "objects.supportActivities[].jobs[].predecessors[]",
        "objects.supportActivities[].jobs[].spare",
        "objects.supportActivities[].jobs[].workName",
    )
    derived_prefixes = (
        "objects.missionProfiles[].id",
        "objects.missionProfiles[].name",
        "objects.missionProfiles[].profileId",
        "objects.missionProfiles[].experiment.steps",
        "objects.missionProfiles[].basicMission.missionId",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].name",
        "objects.projectInfo.",
    )
    governance_only_prefixes = (
        "objects.equipmentAssets[].specialRepairProfile.repairRatio",
        "objects.equipmentAssets[].specialRepairProfile.replacementRatio",
        "objects.missionProfiles[].reliabilityBlockDiagram.edges[].from",
        "objects.missionProfiles[].reliabilityBlockDiagram.nodes[].type",
        "objects.supportActivities[].jobs[].ammunition",
        "objects.supportActivities[].jobs[].durationProfile.",
        "objects.supportActivities[].jobs[].facility",
        "objects.supportActivities[].jobs[].servicePersonnel",
        "objects.supportActivities[].transportStrategies[]",
        "objects.supportActivities[].organizationStrategies[]",
        "objects.supportOrganization.",
    )
    defaulted_prefixes = (
        "objects.missionProfiles[].missionCount",
    )
    if _matches_any(field_path, consumed_prefixes):
        return (
            "consumed",
            "M9.7.4 aircraft_support_v1 Scenario/runtime",
            "The formal aircraft_support_v1 compiler or runtime reads this frozen business field directly.",
        )
    if _matches_any(field_path, derived_prefixes):
        return (
            "derived",
            "M9.7.4 aircraft_support_v1 identity, output, and display metadata",
            "The value contributes to stable IDs, names, provenance, output sampling, or display metadata rather than direct simulation dynamics.",
        )
    if _matches_any(field_path, defaulted_prefixes):
        return (
            "defaulted",
            "Current aviation_support compiler default rule",
            "The M9.5 compiler has a stable default for this input until M9.7 consumes it explicitly.",
        )
    if _matches_any(field_path, governance_only_prefixes):
        return (
            "governance_only",
            "M9.7.4 aircraft_support_v1 governance metadata",
            "The field is preserved in the formal payload and provenance for audit/governance, but it is approved as non-behavior-driving in M9.7.4.",
        )
    return (
        "ignored",
        "M9.6 platform case package",
        "The field is preserved in the Project and golden fixtures, but the current M9.5 aviation_support adapter does not consume it.",
    )


def _matches_any(field_path: str, patterns: tuple[str, ...]) -> bool:
    return any(field_path == pattern or field_path.startswith(pattern) for pattern in patterns)


def _business_leaf_paths(value: Any, prefix: str = "") -> list[str]:
    if isinstance(value, dict):
        paths: list[str] = []
        for key in sorted(value):
            if prefix == "" and key in {"schemaVersion", "source", "lifecycle", "changes", "validation"}:
                continue
            paths.extend(_business_leaf_paths(value[key], f"{prefix}.{key}" if prefix else key))
        return paths
    if isinstance(value, list):
        if not value:
            return [prefix]
        paths: list[str] = []
        for item in value:
            for path in _business_leaf_paths(item, f"{prefix}[]"):
                if path not in paths:
                    paths.append(path)
        return paths
    return [prefix]


def _positive_int(value: Any, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
