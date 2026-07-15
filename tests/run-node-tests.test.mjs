import assert from "node:assert/strict";
import test from "node:test";

import { discoverNodeTestFiles } from "../scripts/run-node-tests.mjs";

test("cross-platform Node test runner discovers every test file in sorted order", async () => {
  const testFiles = await discoverNodeTestFiles();

  assert.ok(testFiles.length > 0);
  assert.ok(testFiles.every((file) => file.startsWith("tests/") && file.endsWith(".test.mjs")));
  assert.deepEqual(testFiles, [...testFiles].sort());
  assert.ok(testFiles.includes("tests/system-runtime-contract.test.mjs"));
});
