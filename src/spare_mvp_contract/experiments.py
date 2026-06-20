"""Contract-layer simulation experiments over compiled Scenario JSON."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
from typing import Any

from src.spare_mvp_abm.smoke_model import SmokeSpareMvpModel

from .adapter import (
    ARTIFACT_MANIFEST_SCHEMA_VERSION,
    MESA_CONTRACT_VERSION,
    RESULT_SCHEMA_VERSION,
    RUN_SCHEMA_VERSION,
    SCENARIO_SCHEMA_VERSION,
    AdapterError,
)


MONTE_CARLO_ARTIFACT_SCHEMA_VERSION = "monte-carlo-artifact-v0"
ANALYSIS_PROJECTION_SCHEMA_VERSION = "analysis-projection-v0"
PROJECTION_REQUESTS = {
    "largeSample": "large_sample_summary",
    "spareShortfall": "spare_shortfall",
    "carryList": "carry_list",
    "missionReliability": "mission_reliability",
    "downtimeFactors": "downtime_factors",
}


class SimulationExperimentBase:
    """Shared artifact and identity helpers for synchronous experiments."""

    def __init__(self, *, output_dir: Path | str) -> None:
        self.output_root = Path(output_dir)

    def _write_artifact(
        self,
        *,
        run_dir: Path,
        kind: str,
        filename: str,
        payload: Any,
        schema_version: str | None,
    ) -> dict[str, Any]:
        target = run_dir / filename
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        data = target.read_bytes()
        artifact = {
            "artifact_id": f"{kind}-{run_dir.name}",
            "kind": kind,
            "path": target.relative_to(self.output_root).as_posix(),
            "media_type": "application/json",
            "sha256": hashlib.sha256(data).hexdigest(),
            "size_bytes": len(data),
        }
        if schema_version is not None:
            artifact["schema_version"] = schema_version
        return artifact

    def _scenario_identity(self, scenario: dict[str, Any]) -> dict[str, Any]:
        model = scenario.get("simulation_model", {})
        return {
            "scenario_id": scenario.get("scenario_id"),
            "scenario_version": scenario.get("scenario_version"),
            "scenario_schema_version": scenario.get("schema_version"),
            "project_id": scenario.get("project_id"),
            "model_family": model.get("family"),
            "model_id": model.get("model_id"),
            "mesa_contract_version": model.get("contract_version") or MESA_CONTRACT_VERSION,
        }

    def _stable_hash(self, payload: Any) -> str:
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:16]


class MonteCarloBatchExperiment(SimulationExperimentBase):
    """Run a deterministic local Monte Carlo batch from one compiled Scenario."""

    def __init__(self, *, ontology_path: Path | str, output_dir: Path | str) -> None:
        super().__init__(output_dir=output_dir)
        self.ontology_path = Path(ontology_path)

    def run(
        self,
        scenario: dict[str, Any],
        *,
        plan_config: dict[str, Any],
        steps: int,
        run_id: str | None = None,
    ) -> dict[str, dict[str, Any]]:
        self._assert_smoke_scenario(scenario)
        if steps < 0:
            raise AdapterError("bad_steps", "steps must be non-negative", steps=steps)

        run_id = run_id or f"run-{scenario['scenario_id']}"
        run_dir = self.output_root / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        now = _utc_now()

        profile = _normalize_analysis_profile(plan_config, scenario)
        samples = self._run_samples(scenario, profile=profile, steps=steps)
        aggregate_metrics = _aggregate_metrics([sample["metrics"] for sample in samples])
        base_payload = self._base_artifact_payload(
            scenario,
            plan_config=plan_config,
            profile=profile,
            samples=samples,
            aggregate_metrics=aggregate_metrics,
        )
        base_artifact = self._write_artifact(
            run_dir=run_dir,
            kind="monte_carlo_base",
            filename="monte-carlo-base.json",
            payload=base_payload,
            schema_version=MONTE_CARLO_ARTIFACT_SCHEMA_VERSION,
        )

        projection_payloads = AnalysisTaskProjection(
            base_artifact_id=base_artifact["artifact_id"],
            base_payload=base_payload,
            profile=profile,
        ).build_payloads()
        artifacts = [base_artifact]
        for kind, payload in projection_payloads.items():
            artifacts.append(
                self._write_artifact(
                    run_dir=run_dir,
                    kind=kind,
                    filename=f"{kind}.json",
                    payload=payload,
                    schema_version=ANALYSIS_PROJECTION_SCHEMA_VERSION,
                )
            )

        result_id = f"result-{run_id}"
        manifest_id = f"artifact-manifest-{run_id}"
        result = {
            "schema_version": RESULT_SCHEMA_VERSION,
            "model_family": "smoke",
            "result_id": result_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "compiler_provenance": copy.deepcopy(base_payload["mapping_provenance"]),
            "metrics": {
                "sample_count": profile["sample_count"],
                "seed": profile["seed"],
                "aggregate_metrics": aggregate_metrics,
                **aggregate_metrics,
            },
            "analysis_outputs": _analysis_output_summary(profile, projection_payloads),
        }
        run = {
            "schema_version": RUN_SCHEMA_VERSION,
            "run_id": run_id,
            "project_id": scenario["project_id"],
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "model_family": "smoke",
            "model_id": "SmokeSpareMvpModel",
            "status": "succeeded",
            "run_type": "monte_carlo",
            "seed": profile["seed"],
            "progress": 1,
            "started_at": now,
            "completed_at": now,
            "result_summary_id": result_id,
            "artifact_manifest_id": manifest_id,
            "error": None,
        }
        manifest = {
            "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
            "artifact_manifest_id": manifest_id,
            "run_id": run_id,
            "scenario_id": scenario["scenario_id"],
            "scenario_version": scenario["scenario_version"],
            "created_at": now,
            "artifacts": artifacts,
        }
        (run_dir / "artifact-manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return {"run": run, "result": result, "artifact_manifest": manifest}

    def _run_samples(self, scenario: dict[str, Any], *, profile: dict[str, Any], steps: int) -> list[dict[str, Any]]:
        base_inputs = scenario["simulation_inputs"]
        sweep_points = list(_sweep_points(profile["sweep_dimensions"]))
        samples = []
        for sample_index in range(profile["sample_count"]):
            sweep = sweep_points[sample_index % len(sweep_points)]
            sample_inputs = {
                "seed": int(profile["seed"]) + sample_index,
                "failure_rate": float(sweep.get("failureRate", base_inputs["failure_rate"])),
                "spare_multiplier": float(sweep.get("spareMultiplier", base_inputs["spare_multiplier"])),
                "support_capacity": int(sweep.get("capacity", base_inputs["support_capacity"])),
                "sweep_index": sample_index % len(sweep_points),
            }
            model = SmokeSpareMvpModel(
                projectData=copy.deepcopy(base_inputs["project_snapshot"]),
                ontologyPath=str(self.ontology_path),
                activeModule=base_inputs["active_module"],
                spareMultiplier=sample_inputs["spare_multiplier"],
                failureRate=sample_inputs["failure_rate"],
                supportCapacity=sample_inputs["support_capacity"],
                minRequiredSorties=base_inputs["min_required_sorties"],
                seed=sample_inputs["seed"],
            )
            for _ in range(steps):
                model.step()
            samples.append(
                {
                    "sample_index": sample_index,
                    "inputs": sample_inputs,
                    "metrics": model.snapshot(),
                }
            )
        return samples

    def _base_artifact_payload(
        self,
        scenario: dict[str, Any],
        *,
        plan_config: dict[str, Any],
        profile: dict[str, Any],
        samples: list[dict[str, Any]],
        aggregate_metrics: dict[str, Any],
    ) -> dict[str, Any]:
        provenance = copy.deepcopy(scenario.get("compiled_from", {}).get("mapping_provenance") or {})
        return {
            "schema_version": MONTE_CARLO_ARTIFACT_SCHEMA_VERSION,
            "compiled_scenario_identity": self._scenario_identity(scenario),
            "mapping_version": provenance.get("mapping_version"),
            "mapping_provenance": provenance,
            "mapping_input_hash": self._stable_hash(
                {
                    "scenario_inputs": scenario.get("simulation_inputs"),
                    "analysis_profile": profile,
                }
            ),
            "sample_count": profile["sample_count"],
            "seed": profile["seed"],
            "sweep_dimensions": profile["sweep_dimensions"],
            "per_sample_inputs": [copy.deepcopy(sample["inputs"]) for sample in samples],
            "per_sample_metrics": [
                {
                    "sample_index": sample["sample_index"],
                    "metrics": copy.deepcopy(sample["metrics"]),
                }
                for sample in samples
            ],
            "aggregate_metrics": aggregate_metrics,
            "analysis_requests": copy.deepcopy(profile["analysis_requests"]),
            "plan_config_hash": self._stable_hash(plan_config),
            "logs_summary": {
                "status": "completed",
                "sample_count": profile["sample_count"],
                "message": "local synchronous Monte Carlo batch completed",
            },
        }

    def _assert_smoke_scenario(self, scenario: dict[str, Any]) -> None:
        model = scenario.get("simulation_model", {})
        if scenario.get("schema_version") != SCENARIO_SCHEMA_VERSION:
            raise AdapterError("invalid_scenario", "unsupported scenario schema version")
        if model.get("family") != "smoke" or model.get("model_id") != "SmokeSpareMvpModel":
            raise AdapterError("unsupported_model_family", "run_monte_carlo_batch currently supports only smoke scenarios")


class AnalysisTaskProjection:
    """Build enabled projections from one base Monte Carlo artifact."""

    def __init__(self, *, base_artifact_id: str, base_payload: dict[str, Any], profile: dict[str, Any]) -> None:
        self.base_artifact_id = base_artifact_id
        self.base_payload = base_payload
        self.profile = profile

    def build_payloads(self) -> dict[str, dict[str, Any]]:
        payloads: dict[str, dict[str, Any]] = {}
        for request_key, kind in PROJECTION_REQUESTS.items():
            if not self.profile["analysis_requests"].get(request_key, {}).get("enabled"):
                continue
            payloads[kind] = self._projection_payload(request_key, kind)
        return payloads

    def _projection_payload(self, request_key: str, kind: str) -> dict[str, Any]:
        request = copy.deepcopy(self.profile["analysis_requests"].get(request_key) or {})
        aggregate = self.base_payload["aggregate_metrics"]
        payload = {
            "schema_version": ANALYSIS_PROJECTION_SCHEMA_VERSION,
            "kind": kind,
            "status": "completed",
            "analysis_request": request_key,
            "base_monte_carlo_artifact_id": self.base_artifact_id,
            "compiled_scenario_identity": copy.deepcopy(self.base_payload["compiled_scenario_identity"]),
            "mapping_version": self.base_payload.get("mapping_version"),
            "sample_count": self.base_payload["sample_count"],
            "seed": self.base_payload["seed"],
            "summary": self._summary_for(request_key, aggregate, request),
        }
        return payload

    def _summary_for(self, request_key: str, aggregate: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
        if request_key == "largeSample":
            return {"aggregate_metrics": copy.deepcopy(aggregate)}
        if request_key == "spareShortfall":
            threshold = _optional_float(request.get("threshold", 0.95), "analysisRequests.spareShortfall.threshold")
            fill_rate = float(aggregate.get("spare_fill_rate", 0))
            return {
                "threshold": threshold,
                "spare_fill_rate": fill_rate,
                "shortfall": max(0.0, threshold - fill_rate),
                "meets_threshold": fill_rate >= threshold,
            }
        if request_key == "carryList":
            spare_multipliers = [
                float(sample_input.get("spare_multiplier"))
                for sample_input in self.base_payload.get("per_sample_inputs", [])
                if _is_number(sample_input.get("spare_multiplier"))
            ]
            recommended_spare_multiplier = (
                sum(spare_multipliers) / len(spare_multipliers)
                if spare_multipliers
                else 1.0
            )
            return {
                "mission_window_hours": _optional_int(
                    request.get("missionWindowHours", 72),
                    "analysisRequests.carryList.missionWindowHours",
                ),
                "recommended_spare_multiplier": recommended_spare_multiplier,
                "basis": "Monte Carlo aggregate spare fill rate and mission success rate",
            }
        if request_key == "missionReliability":
            target = _optional_float(request.get("target", 0.9), "analysisRequests.missionReliability.target")
            success_rate = float(aggregate.get("mission_success_rate", 0))
            return {
                "target": target,
                "mission_success_rate": success_rate,
                "meets_target": success_rate >= target,
            }
        if request_key == "downtimeFactors":
            top_n = _optional_int(request.get("topN", 10), "analysisRequests.downtimeFactors.topN")
            factors = [
                {"factor": key, "value": value}
                for key, value in sorted(aggregate.items())
                if isinstance(value, (int, float)) and ("down" in key or "fail" in key or "delay" in key)
            ]
            return {"top_n": top_n, "factors": factors[:top_n]}
        return {}


def _normalize_analysis_profile(plan_config: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    analysis_requests = copy.deepcopy(plan_config.get("analysisRequests") or {})
    monte_carlo = plan_config.get("monteCarlo") or {}
    inputs = scenario["simulation_inputs"]
    top_seed = plan_config.get("seed", inputs.get("seed", 0))
    large_sample = analysis_requests.setdefault("largeSample", {})
    large_sample.setdefault("enabled", True)
    large_sample.setdefault("samples", plan_config.get("samples", 1))
    large_sample.setdefault("seed", top_seed)
    sweep = large_sample.setdefault("sweep", {})
    sweep.setdefault("failureRates", monte_carlo.get("failureRates", [inputs["failure_rate"]]))
    sweep.setdefault("spareMultipliers", monte_carlo.get("spareMultipliers", [inputs["spare_multiplier"]]))
    sweep.setdefault("capacities", monte_carlo.get("supportCapacities", [inputs["support_capacity"]]))
    analysis_requests.setdefault("spareShortfall", {"enabled": True, "threshold": 0.95})
    analysis_requests.setdefault("carryList", {"enabled": True, "missionWindowHours": 72})
    analysis_requests.setdefault("missionReliability", {"enabled": True, "target": 0.9})
    analysis_requests.setdefault("downtimeFactors", {"enabled": True, "topN": 10})
    _validate_analysis_requests(analysis_requests)
    return {
        "seed": _optional_int(
            large_sample.get("seed"),
            "analysisRequests.largeSample.seed",
            allow_zero=True,
        ),
        "sample_count": _optional_int(large_sample.get("samples"), "analysisRequests.largeSample.samples"),
        "sweep_dimensions": {
            "failureRates": _number_list(
                sweep.get("failureRates"),
                "analysisRequests.largeSample.sweep.failureRates",
            ),
            "spareMultipliers": _number_list(
                sweep.get("spareMultipliers"),
                "analysisRequests.largeSample.sweep.spareMultipliers",
            ),
            "capacities": _int_list(sweep.get("capacities"), "analysisRequests.largeSample.sweep.capacities"),
        },
        "analysis_requests": analysis_requests,
    }


def _sweep_points(sweep_dimensions: dict[str, list[Any]]) -> list[dict[str, Any]]:
    failure_rates = sweep_dimensions.get("failureRates") or [0.05]
    spare_multipliers = sweep_dimensions.get("spareMultipliers") or [1.0]
    capacities = sweep_dimensions.get("capacities") or [1]
    return [
        {"failureRate": failure_rate, "spareMultiplier": spare_multiplier, "capacity": capacity}
        for failure_rate, spare_multiplier, capacity in itertools.product(failure_rates, spare_multipliers, capacities)
    ]


def _aggregate_metrics(metrics_list: list[dict[str, Any]]) -> dict[str, Any]:
    if not metrics_list:
        return {}
    numeric_keys = sorted(
        {
            key
            for metrics in metrics_list
            for key, value in metrics.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
    )
    aggregate = {
        key: sum(float(metrics.get(key, 0)) for metrics in metrics_list) / len(metrics_list)
        for key in numeric_keys
    }
    return aggregate


def _analysis_output_summary(profile: dict[str, Any], projection_payloads: dict[str, dict[str, Any]]) -> dict[str, Any]:
    output = {}
    kind_by_request = PROJECTION_REQUESTS
    for request_key, kind in kind_by_request.items():
        request = profile["analysis_requests"].get(request_key) or {}
        if not request.get("enabled"):
            output[request_key] = {"status": "unconfigured", "artifact_kind": kind}
        elif kind in projection_payloads:
            output[request_key] = {
                "status": "completed",
                "artifact_kind": kind,
                "base_monte_carlo_artifact_id": projection_payloads[kind]["base_monte_carlo_artifact_id"],
            }
        else:
            output[request_key] = {"status": "pending", "artifact_kind": kind}
    return output


def _validate_analysis_requests(analysis_requests: dict[str, Any]) -> None:
    large_sample = analysis_requests.get("largeSample", {})
    if large_sample.get("enabled"):
        _optional_int(large_sample.get("samples", 1), "analysisRequests.largeSample.samples")
        _optional_int(large_sample.get("seed", 0), "analysisRequests.largeSample.seed", allow_zero=True)
        sweep = large_sample.get("sweep") or {}
        _number_list(sweep.get("failureRates", [0.05]), "analysisRequests.largeSample.sweep.failureRates")
        _number_list(sweep.get("spareMultipliers", [1.0]), "analysisRequests.largeSample.sweep.spareMultipliers")
        _int_list(sweep.get("capacities", [1]), "analysisRequests.largeSample.sweep.capacities")
    if analysis_requests.get("spareShortfall", {}).get("enabled"):
        _optional_float(
            analysis_requests.get("spareShortfall", {}).get("threshold", 0.95),
            "analysisRequests.spareShortfall.threshold",
        )
    if analysis_requests.get("carryList", {}).get("enabled"):
        _optional_int(
            analysis_requests.get("carryList", {}).get("missionWindowHours", 72),
            "analysisRequests.carryList.missionWindowHours",
        )
    if analysis_requests.get("missionReliability", {}).get("enabled"):
        _optional_float(
            analysis_requests.get("missionReliability", {}).get("target", 0.9),
            "analysisRequests.missionReliability.target",
        )
    if analysis_requests.get("downtimeFactors", {}).get("enabled"):
        _optional_int(
            analysis_requests.get("downtimeFactors", {}).get("topN", 10),
            "analysisRequests.downtimeFactors.topN",
        )


def _number_list(value: Any, path: str) -> list[float]:
    if isinstance(value, list):
        if not value:
            raise AdapterError("bad_analysis_request", f"{path} must include at least one numeric value", field_path=path)
        numbers = []
        for index, item in enumerate(value):
            if not _is_number(item):
                raise AdapterError(
                    "bad_analysis_request",
                    f"{path}[{index}] must be numeric",
                    field_path=f"{path}[{index}]",
                    value=item,
                )
            numbers.append(float(item))
        return numbers
    if _is_number(value):
        return [float(value)]
    raise AdapterError("bad_analysis_request", f"{path} must be numeric", field_path=path, value=value)


def _int_list(value: Any, path: str) -> list[int]:
    if isinstance(value, list):
        if not value:
            raise AdapterError("bad_analysis_request", f"{path} must include at least one numeric value", field_path=path)
        numbers = []
        for index, item in enumerate(value):
            if not _is_number(item):
                raise AdapterError(
                    "bad_analysis_request",
                    f"{path}[{index}] must be numeric",
                    field_path=f"{path}[{index}]",
                    value=item,
                )
            numbers.append(max(1, int(round(float(item)))))
        return numbers
    if _is_number(value):
        return [max(1, int(round(float(value))))]
    raise AdapterError("bad_analysis_request", f"{path} must be numeric", field_path=path, value=value)


def _optional_float(value: Any, path: str) -> float:
    if not _is_number(value):
        raise AdapterError("bad_analysis_request", f"{path} must be numeric", field_path=path, value=value)
    return float(value)


def _optional_int(value: Any, path: str, *, allow_zero: bool = False) -> int:
    if not _is_number(value):
        raise AdapterError("bad_analysis_request", f"{path} must be numeric", field_path=path, value=value)
    return max(0 if allow_zero else 1, int(round(float(value))))


def _is_number(value: Any) -> bool:
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
