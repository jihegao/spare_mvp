"""Canonical Monte Carlo moments for product-facing aircraft support metrics."""

from __future__ import annotations

import math
from typing import Any


MONTE_CARLO_METRIC_DEFINITIONS: tuple[dict[str, str], ...] = (
    {
        "metric_id": "mission_success_rate",
        "label": "任务可靠度",
        "unit": "比例",
        "variance_unit": "比例²",
        "value_format": "ratio",
    },
    {
        "metric_id": "spare_fill_rate",
        "label": "备件满足率",
        "unit": "比例",
        "variance_unit": "比例²",
        "value_format": "ratio",
    },
    {
        "metric_id": "spare_utilization",
        "label": "备件利用率",
        "unit": "比例",
        "variance_unit": "比例²",
        "value_format": "ratio",
    },
    {
        "metric_id": "ready_rate",
        "label": "战备完好率",
        "unit": "比例",
        "variance_unit": "比例²",
        "value_format": "ratio",
    },
    {
        "metric_id": "sortie_rate",
        "label": "出动架次率",
        "unit": "架次/机/天",
        "variance_unit": "(架次/机/天)²",
        "value_format": "number",
    },
    {
        "metric_id": "mean_transport_delay",
        "label": "平均备件延误时间",
        "unit": "小时",
        "variance_unit": "小时²",
        "value_format": "number",
    },
    {
        "metric_id": "repair_backlog",
        "label": "维修积压",
        "unit": "项",
        "variance_unit": "项²",
        "value_format": "number",
    },
)


def is_finite_json_number(value: Any) -> bool:
    """Return true only for finite native JSON numbers, never booleans or strings."""

    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def build_monte_carlo_metric_moments(
    samples: list[dict[str, Any]],
    *,
    total_sample_count: int,
    failed_sample_count: int,
) -> dict[str, Any]:
    """Build ordered per-metric mean and unbiased sample variance statistics."""

    successful_sample_count = len(samples)
    metrics = []
    for definition in MONTE_CARLO_METRIC_DEFINITIONS:
        metric_id = definition["metric_id"]
        values = [
            float(value)
            for sample in samples
            if isinstance(sample, dict)
            for sample_metrics in [sample.get("metrics")]
            if isinstance(sample_metrics, dict)
            for value in [sample_metrics.get(metric_id)]
            if is_finite_json_number(value)
        ]
        valid_sample_count = len(values)
        mean = math.fsum(values) / valid_sample_count if valid_sample_count else None
        sample_variance = (
            math.fsum((value - mean) ** 2 for value in values) / (valid_sample_count - 1)
            if valid_sample_count >= 2 and mean is not None
            else None
        )
        metrics.append(
            {
                **definition,
                "mean": mean,
                "sample_variance": sample_variance,
                "valid_sample_count": valid_sample_count,
            }
        )

    return {
        "schema_version": "monte-carlo-metric-moments-v0",
        "variance_method": "unbiased_sample_variance",
        "variance_denominator": "n-1",
        "total_sample_count": max(0, int(total_sample_count)),
        "successful_sample_count": successful_sample_count,
        "failed_sample_count": max(0, int(failed_sample_count)),
        "metrics": metrics,
    }
