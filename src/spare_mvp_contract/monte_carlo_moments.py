"""Canonical Monte Carlo moments for product-facing aircraft support metrics."""

from __future__ import annotations

import math
import sys
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
        "metric_id": "operational_availability",
        "label": "使用可用度(A)",
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

RATIO_OF_TOTALS_METRICS: dict[str, tuple[str, str]] = {
    "spare_fill_rate": ("spare_immediately_filled_total", "spare_demand_total"),
    "spare_utilization": ("spare_consumed_total", "spare_carried_total"),
}


def is_finite_json_number(value: Any) -> bool:
    """Return true only for finite native JSON numbers, never booleans or strings."""

    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:
        return False


def finite_mean(values: list[float]) -> float | None:
    """Return a finite arithmetic mean without overflowing the intermediate sum."""

    if not values:
        return None
    count = len(values)
    try:
        mean = math.fsum(value / count for value in values)
    except (OverflowError, ValueError):
        return None
    return mean if math.isfinite(mean) else None


def _finite_sample_variance(values: list[float], mean: float | None) -> tuple[float | None, str | None]:
    if len(values) < 2 or mean is None:
        return None, None
    try:
        direct_variance = math.fsum((value - mean) ** 2 for value in values) / (len(values) - 1)
        if math.isfinite(direct_variance):
            return direct_variance, None
    except (OverflowError, ValueError):
        pass
    scale = max(abs(value) for value in values)
    if scale == 0:
        return 0.0, None
    try:
        scaled_mean = mean / scale
        scaled_sum_squares = math.fsum((value / scale - scaled_mean) ** 2 for value in values)
        scaled_variance = scaled_sum_squares / (len(values) - 1)
        standard_deviation = scale * math.sqrt(scaled_variance)
        if not math.isfinite(standard_deviation) or standard_deviation > math.sqrt(sys.float_info.max):
            return None, "sample_variance_not_finite"
        variance = standard_deviation * standard_deviation
    except (OverflowError, ValueError):
        return None, "sample_variance_not_finite"
    if not math.isfinite(variance):
        return None, "sample_variance_not_finite"
    return variance, None


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
        ratio_fields = RATIO_OF_TOTALS_METRICS.get(metric_id)
        ratio_pairs: list[tuple[float, float]] = []
        unavailable_sample_count = 0
        zero_denominator_sample_count = 0
        if ratio_fields:
            numerator_field, denominator_field = ratio_fields
            for sample in samples:
                sample_metrics = sample.get("metrics") if isinstance(sample, dict) else None
                if not isinstance(sample_metrics, dict):
                    unavailable_sample_count += 1
                    continue
                numerator = sample_metrics.get(numerator_field)
                denominator = sample_metrics.get(denominator_field)
                if not is_finite_json_number(numerator) or not is_finite_json_number(denominator):
                    unavailable_sample_count += 1
                    continue
                numerator_value = float(numerator)
                denominator_value = float(denominator)
                if numerator_value < 0 or denominator_value < 0:
                    unavailable_sample_count += 1
                elif denominator_value == 0:
                    zero_denominator_sample_count += 1
                else:
                    ratio_pairs.append((numerator_value, denominator_value))
            values = [numerator / denominator for numerator, denominator in ratio_pairs]
        else:
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
        arithmetic_mean = finite_mean(values)
        numerator_total = math.fsum(pair[0] for pair in ratio_pairs) if ratio_pairs else None
        denominator_total = math.fsum(pair[1] for pair in ratio_pairs) if ratio_pairs else None
        overall_ratio = (
            numerator_total / denominator_total
            if ratio_fields and denominator_total is not None and denominator_total > 0
            else None
        )
        mean = arithmetic_mean
        sample_variance, invalid_reason = _finite_sample_variance(values, arithmetic_mean)
        if valid_sample_count and mean is None:
            invalid_reason = "mean_not_finite"
        if ratio_fields and not valid_sample_count:
            invalid_reason = "zero_denominator" if zero_denominator_sample_count else "data_unavailable"
        metrics.append(
            {
                **definition,
                "mean": mean,
                "sample_variance": sample_variance,
                "valid_sample_count": valid_sample_count,
                "invalid_reason": invalid_reason,
                "mean_aggregation_method": "arithmetic_mean",
                **({
                    "numerator_field": ratio_fields[0],
                    "denominator_field": ratio_fields[1],
                    "numerator_total": numerator_total,
                    "denominator_total": denominator_total,
                    "overall_ratio": overall_ratio,
                    "overall_aggregation_method": "ratio_of_totals",
                    "overall_status": (
                        "available"
                        if overall_ratio is not None
                        else "zero_denominator" if zero_denominator_sample_count else "data_unavailable"
                    ),
                    "zero_denominator_sample_count": zero_denominator_sample_count,
                    "unavailable_sample_count": unavailable_sample_count,
                } if ratio_fields else {}),
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
