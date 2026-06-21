import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FRONTEND_ENTRYPOINTS = [
  "front/api-client.mjs",
  "front/app.js",
  "front/run-intent.mjs"
];

const LEGACY_PATTERNS = [
  { name: "legacy simulation run route", pattern: /\/simulation-runs/ },
  { name: "legacy raw run alias", pattern: /\bgetRun\s*\(/ }
];

test("frontend entrypoints do not reintroduce legacy run API calls", async () => {
  const violations = [];
  for (const filePath of FRONTEND_ENTRYPOINTS) {
    const source = await readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
    for (const { name, pattern } of LEGACY_PATTERNS) {
      if (pattern.test(source)) {
        violations.push(`${filePath}: ${name}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
