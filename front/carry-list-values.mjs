const OWN = Object.prototype.hasOwnProperty;

export function optionalNonnegativeFiniteNumber(value) {
  if (
    value === null
    || value === undefined
    || typeof value === "boolean"
    || (typeof value === "string" && value.trim() === "")
  ) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function normalizeCarryListValues(row = {}, { defaultMinimumSatisfactionRate = 0.9 } = {}) {
  const source = row && typeof row === "object" && !Array.isArray(row) ? row : {};
  const demandQuantity = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "demandQuantity",
    "demand_quantity",
    "demand",
    "demand_count"
  ]));
  let immediatelyFilledQuantity = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "immediatelyFilledQuantity",
    "immediately_filled_quantity",
    "observedFilled",
    "observed_filled_count"
  ]));
  if (demandQuantity !== null && immediatelyFilledQuantity !== null
      && immediatelyFilledQuantity > demandQuantity + Number.EPSILON) {
    immediatelyFilledQuantity = null;
  }
  const carriedQuantity = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "carriedQuantity",
    "carried_quantity"
  ]));
  const usedQuantity = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "consumedQuantity",
    "consumed_quantity",
    "usedQuantity",
    "used_quantity"
  ]));
  const minimumSatisfactionKeys = [
    "minimumSatisfactionRate",
    "minimum_satisfaction_rate"
  ];
  const hasMinimumSatisfactionRate = hasOwnedKey(source, minimumSatisfactionKeys);
  const rawMinimumSatisfactionRate = firstOwnedValue(source, minimumSatisfactionKeys);
  const parsedMinimumSatisfactionRate = optionalNonnegativeFiniteNumber(rawMinimumSatisfactionRate);
  const configuredDefault = optionalNonnegativeFiniteNumber(defaultMinimumSatisfactionRate);
  const minimumSatisfactionRate = hasMinimumSatisfactionRate
    ? (parsedMinimumSatisfactionRate === null ? null : clamp01(parsedMinimumSatisfactionRate))
    : clamp01(configuredDefault ?? 0.9);
  const projectedSatisfactionKeys = [
    "projectedSatisfactionRate",
    "projected_satisfaction_rate",
    "satisfaction_rate"
  ];
  const hasProjectedSatisfactionRate = hasOwnedKey(source, projectedSatisfactionKeys);
  const explicitProjectedSatisfactionRate = optionalNonnegativeFiniteNumber(
    firstOwnedValue(source, projectedSatisfactionKeys)
  );
  const multiplier = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "multiplier",
    "recommendedMultiplier",
    "recommended_multiplier"
  ]));
  const projectedSatisfactionRate = hasProjectedSatisfactionRate
    ? (explicitProjectedSatisfactionRate === null ? null : clamp01(explicitProjectedSatisfactionRate))
    : multiplier === null ? null : Math.min(1, multiplier / Math.max(multiplier, 1));
  const shortage = optionalNonnegativeFiniteNumber(firstOwnedValue(source, [
    "projectedShortageQuantity",
    "projected_shortage_quantity",
    "projectedShortageCount",
    "projected_shortage_count",
    "shortage"
  ]));
  const hasActualFillQuantities = demandQuantity !== null && immediatelyFilledQuantity !== null;
  const satisfactionRate = hasActualFillQuantities && demandQuantity > 0
    ? clamp01(immediatelyFilledQuantity / demandQuantity)
    : null;
  const hasUtilizationQuantities = usedQuantity !== null && carriedQuantity !== null;

  return {
    demandQuantity,
    demand: demandQuantity,
    immediatelyFilledQuantity,
    carriedQuantity,
    usedQuantity,
    hasActualFillQuantities,
    satisfactionRate,
    observedFillRate: satisfactionRate,
    projectedSatisfactionRate,
    shortage,
    minimumSatisfactionRate,
    satisfactionConstraintMet: satisfactionRate === null || minimumSatisfactionRate === null
      ? null
      : satisfactionRate >= minimumSatisfactionRate,
    satisfactionConstraintMargin: satisfactionRate === null || minimumSatisfactionRate === null
      ? null
      : satisfactionRate - minimumSatisfactionRate,
    hasUtilizationQuantities,
    utilization: hasUtilizationQuantities && carriedQuantity > 0
      ? usedQuantity / carriedQuantity
      : null,
    utilizationStatus: !hasUtilizationQuantities
      ? "data_unavailable"
      : carriedQuantity > 0 ? "available" : "zero_carried"
  };
}

function firstOwnedValue(source, keys) {
  for (const key of keys) {
    if (OWN.call(source, key)) return source[key];
  }
  return undefined;
}

function hasOwnedKey(source, keys) {
  return keys.some((key) => OWN.call(source, key));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
