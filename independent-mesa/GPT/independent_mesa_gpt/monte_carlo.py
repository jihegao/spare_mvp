"""Monte Carlo sweep runner for the方案二 visual mission model."""

from __future__ import annotations

import copy
import itertools
import json
from pathlib import Path
import statistics
from typing import Any

from .model import VisualMissionModel
from .visualization import export_frames


class MonteCarloRunner:
    def __init__(self, import_package: dict[str, Any], steps: int = 104, samples: int = 12, seed: int = 20260621) -> None:
        self.import_package = import_package
        self.steps = steps
        self.samples = samples
        self.seed = seed
        mission = import_package.get("objects", {}).get("missionProfiles", [{}])[0]
        mc = mission.get("monteCarlo", {})
        analysis = import_package.get("objects", {}).get("analysisRequests", {}).get("largeSample", {})
        sweep = analysis.get("sweep", mc)
        self.failure_rates = list(sweep.get("failureRates", [0.035, 0.055, 0.075]))
        self.spare_multipliers = list(sweep.get("spareMultipliers", [0.8, 1.0, 1.2]))
        self.support_capacities = list(sweep.get("supportCapacities", [2, 3, 4]))

    def build_param_grid(self) -> list[dict[str, Any]]:
        return [
            {"failure_rate": float(fr), "spare_multiplier": float(sm), "support_capacity": int(sc)}
            for fr, sm, sc in itertools.product(self.failure_rates, self.spare_multipliers, self.support_capacities)
        ]

    def _build_model(self, failure_rate: float, spare_multiplier: float, support_capacity: int, seed: int) -> VisualMissionModel:
        package = copy.deepcopy(self.import_package)
        objects = package.get("objects", {})
        for asset in objects.get("equipmentAssets", []):
            if "failureRate" in asset:
                asset["failureRate"] = failure_rate
        for resource in objects.get("supportResources", []):
            resource["capacity"] = support_capacity
            resource["personnelCapacity"] = support_capacity
            inv = resource.get("inventory")
            if isinstance(inv, dict):
                for key, value in list(inv.items()):
                    if isinstance(value, (int, float)):
                        inv[key] = max(0, int(round(value * spare_multiplier)))
        return VisualMissionModel(package, seed=seed)

    def run_group(self, failure_rate: float, spare_multiplier: float, support_capacity: int) -> dict[str, Any]:
        metrics: list[dict[str, Any]] = []
        failed = 0
        representative_frames: list[dict[str, Any]] = []
        for sample_idx in range(self.samples):
            try:
                model = self._build_model(failure_rate, spare_multiplier, support_capacity, self.seed + sample_idx)
                if not representative_frames:
                    representative_frames = export_frames(model, self.steps, max(1, self.steps // 24))
                    report = model.final_report()
                else:
                    for _ in range(self.steps):
                        model.step()
                    report = model.final_report()
                metrics.append(_metric_view(report))
            except Exception:
                failed += 1
        return {**_aggregate(metrics), "failed": failed, "representative_frames": representative_frames}

    def run_sweep(self) -> list[dict[str, Any]]:
        results = []
        for params in self.build_param_grid():
            results.append({**params, **self.run_group(**params)})
        return results

    def save_results(self, results: list[dict[str, Any]], output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps({"sweep_results": results}, ensure_ascii=False, indent=2), encoding="utf-8")

    def save_visualization(self, results: list[dict[str, Any]], output_path: Path, *, steps: int, samples: int, seed: int) -> None:
        from .monte_carlo_visualization import build_monte_carlo_html

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            build_monte_carlo_html(
                results,
                steps=steps,
                samples=samples,
                seed=seed,
                failure_rates=self.failure_rates,
                spare_multipliers=self.spare_multipliers,
                support_capacities=self.support_capacities,
            ),
            encoding="utf-8",
        )


def _metric_view(report: dict[str, Any]) -> dict[str, float]:
    metrics = report.get("metrics", {})
    return {
        "availability": float(metrics.get("readyAircraft", 0)) / max(
            float(metrics.get("readyAircraft", 0)) + float(metrics.get("supportAircraft", 0)) + float(metrics.get("flyingAircraft", 0)),
            1.0,
        ),
        "sortie_rate": float(metrics.get("launchRate", 0)),
        "turnaround_time": float(metrics.get("maintenanceCount", 0)) * 30.0,
        "spare_fill_rate": 1.0,
        "avg_spare_delay": float(metrics.get("delayedLaunches", 0)) * 15.0,
        "sortie_completion_rate": float(metrics.get("completionRate", 0)),
    }


def _aggregate(results: list[dict[str, float]]) -> dict[str, Any]:
    if not results:
        return {"mean": {}, "std": {}, "samples": 0}
    keys = results[0].keys()
    mean = {}
    std = {}
    for key in keys:
        values = [row[key] for row in results]
        mean[key] = statistics.mean(values)
        std[key] = statistics.stdev(values) if len(values) > 1 else 0.0
    return {"mean": mean, "std": std, "samples": len(results)}
