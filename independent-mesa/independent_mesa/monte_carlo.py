"""Monte Carlo sweep runner over failureRates x spareMultipliers x supportCapacities."""

from __future__ import annotations

import copy
import itertools
import json
import statistics
from pathlib import Path
from typing import Any

from .model import IndependentMesaModel


class MonteCarloRunner:
    """Runs parameter sweep over the monteCarlo config from the import package."""

    def __init__(
        self,
        import_package: dict[str, Any],
        steps: int = 48,
        samples: int = 24,
        seed: int = 20260621,
    ) -> None:
        self.import_package = import_package
        self.steps = steps
        self.samples = samples
        self.seed = seed
        objects = import_package.get("objects", {})
        mission = objects.get("missionProfiles", [{}])[0]
        mc = mission.get("monteCarlo", {})
        analysis = objects.get("analysisRequests", {}).get("largeSample", {})
        sweep = analysis.get("sweep", mc)
        self.failure_rates = list(sweep.get("failureRates", [0.055]))
        self.spare_multipliers = list(sweep.get("spareMultipliers", [1.0]))
        self.support_capacities = list(sweep.get("supportCapacities", [3]))

    def build_param_grid(self) -> list[dict[str, Any]]:
        """Build the 27-combination parameter grid (3x3x3)."""
        grid = []
        for fr, sm, sc in itertools.product(
            self.failure_rates, self.spare_multipliers, self.support_capacities
        ):
            grid.append({
                "failure_rate": float(fr),
                "spare_multiplier": float(sm),
                "support_capacity": int(sc),
            })
        return grid

    def run_single(
        self,
        failure_rate: float,
        spare_multiplier: float,
        support_capacity: int,
        seed: int,
    ) -> dict[str, Any]:
        """Run a single sample and return metrics."""
        package = copy.deepcopy(self.import_package)
        objects = package.get("objects", {})
        for asset in objects.get("equipmentAssets", []):
            if "failureRate" in asset:
                asset["failureRate"] = failure_rate
            if "failureDistribution" in asset:
                params = str(asset["failureDistribution"].get("parameters", ""))
                if "lambda" in params:
                    asset["failureDistribution"]["parameters"] = f"lambda={failure_rate}"
        for res in objects.get("supportResources", []):
            res["capacity"] = support_capacity
            res["personnelCapacity"] = support_capacity
            res["equipmentCapacity"] = max(1, support_capacity - 1)
        for res in objects.get("supportResources", []):
            if isinstance(res.get("inventory"), dict):
                for key in res["inventory"]:
                    res["inventory"][key] = max(1, int(res["inventory"][key] * spare_multiplier))
        model = IndependentMesaModel(package, steps=self.steps, seed=seed)
        for _ in range(self.steps):
            model.step()
        return model.compute_final_metrics()

    def run_group(
        self,
        failure_rate: float,
        spare_multiplier: float,
        support_capacity: int,
    ) -> dict[str, Any]:
        """Run `samples` samples for one parameter combination and aggregate."""
        results: list[dict[str, Any]] = []
        failed: int = 0
        for sample_idx in range(self.samples):
            seed = self.seed + sample_idx
            try:
                metrics = self.run_single(
                    failure_rate, spare_multiplier, support_capacity, seed,
                )
                results.append(metrics)
            except Exception:
                failed += 1
        return self._aggregate(results, failed)

    def run_sweep(self) -> list[dict[str, Any]]:
        """Run the full sweep over all parameter combinations."""
        grid = self.build_param_grid()
        results = []
        for params in grid:
            group_result = self.run_group(
                params["failure_rate"],
                params["spare_multiplier"],
                params["support_capacity"],
            )
            results.append({**params, **group_result})
        return results

    def _aggregate(
        self,
        results: list[dict[str, Any]],
        failed: int,
    ) -> dict[str, Any]:
        if not results:
            return {"mean": {}, "std": {}, "samples": 0, "failed": failed}
        keys = results[0].keys()
        mean = {}
        std = {}
        for key in keys:
            values = [float(r[key]) for r in results if key in r and isinstance(r[key], (int, float))]
            if values:
                mean[key] = statistics.mean(values)
                std[key] = statistics.stdev(values) if len(values) > 1 else 0.0
        return {
            "mean": mean,
            "std": std,
            "samples": len(results),
            "failed": failed,
        }

    def save_results(self, results: list[dict[str, Any]], output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps({"sweep_results": results}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
