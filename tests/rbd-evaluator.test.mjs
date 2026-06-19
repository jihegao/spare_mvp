import assert from "node:assert/strict";
import test from "node:test";

import {
  kOfNReliability,
  parallelReliability,
  seriesReliability
} from "../front/rbd-evaluator.mjs";

test("series reliability multiplies child probabilities", () => {
  assert.equal(seriesReliability([0.99, 0.98, 0.97]).toFixed(6), "0.941094");
});

test("parallel reliability computes complement of joint failure", () => {
  assert.equal(parallelReliability([0.9, 0.8]).toFixed(3), "0.980");
});

test("k-of-n reliability sums successful state probabilities", () => {
  assert.equal(kOfNReliability(2, [0.9, 0.8, 0.7]).toFixed(3), "0.902");
});
