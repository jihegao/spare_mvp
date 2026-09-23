import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCarryListValues,
  optionalNonnegativeFiniteNumber
} from "../front/carry-list-values.mjs";

test("optional carry quantities accept zero and numeric strings without coercing missing values", () => {
  assert.equal(optionalNonnegativeFiniteNumber(0), 0);
  assert.equal(optionalNonnegativeFiniteNumber("0"), 0);
  assert.equal(optionalNonnegativeFiniteNumber(" 2.5 "), 2.5);
  for (const value of [null, undefined, "", "  ", false, true, "illegal", -1, Infinity, [], {}, [2]]) {
    assert.equal(optionalNonnegativeFiniteNumber(value), null);
  }
});

test("carry quantity normalization uses canonical alias precedence and preserves explicit null", () => {
  const canonical = normalizeCarryListValues({
    demandQuantity: null,
    demand_quantity: 7,
    demand: 8,
    immediatelyFilledQuantity: "0",
    carriedQuantity: "0",
    consumedQuantity: 0
  });
  assert.equal(canonical.demandQuantity, null);
  assert.equal(canonical.immediatelyFilledQuantity, 0);
  assert.equal(canonical.carriedQuantity, 0);
  assert.equal(canonical.usedQuantity, 0);
  assert.equal(canonical.satisfactionRate, null);
  assert.equal(canonical.utilizationStatus, "zero_carried");

  const snake = normalizeCarryListValues({
    demand_quantity: "4",
    immediately_filled_quantity: "3",
    carried_quantity: 5,
    used_quantity: 2
  });
  assert.equal(snake.demandQuantity, 4);
  assert.equal(snake.satisfactionRate, 0.75);
  assert.equal(snake.utilization, 0.4);
  assert.equal(snake.satisfactionConstraintMet, false);
  assert.equal(snake.satisfactionConstraintMargin, -0.15000000000000002);
});

test("carry constraints and derived values stay unavailable when explicit source values are invalid", () => {
  const invalidThreshold = normalizeCarryListValues({
    demand: 2,
    observed_filled_count: 1,
    minimumSatisfactionRate: false,
    minimum_satisfaction_rate: 0.4,
    projectedSatisfactionRate: null,
    satisfaction_rate: 0.8,
    projectedShortageQuantity: null,
    projected_shortage_count: 3
  });
  assert.equal(invalidThreshold.minimumSatisfactionRate, null);
  assert.equal(invalidThreshold.satisfactionConstraintMet, null);
  assert.equal(invalidThreshold.satisfactionConstraintMargin, null);
  assert.equal(invalidThreshold.projectedSatisfactionRate, null);
  assert.equal(invalidThreshold.shortage, null);

  const impossibleFill = normalizeCarryListValues({ demand: 2, observedFilled: 3 });
  assert.equal(impossibleFill.immediatelyFilledQuantity, null);
  assert.equal(impossibleFill.satisfactionRate, null);
});

test("carry projection fallback and exact threshold comparison share one normalization", () => {
  const values = normalizeCarryListValues({
    demand_count: 10,
    observed_filled_count: 9,
    recommended_multiplier: 1.2,
    projectedShortageQuantity: "1",
    shortage: 4,
    minimum_satisfaction_rate: 0.9
  });
  assert.equal(values.projectedSatisfactionRate, 1);
  assert.equal(values.shortage, 1);
  assert.equal(values.satisfactionRate, 0.9);
  assert.equal(values.satisfactionConstraintMet, true);
  assert.equal(values.satisfactionConstraintMargin, 0);

  const justBelow = normalizeCarryListValues({
    demand: 1,
    observedFilled: 0.8999999999999999,
    minimumSatisfactionRate: 0.9
  });
  assert.equal(justBelow.satisfactionConstraintMet, false);
});
