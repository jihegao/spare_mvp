import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = new URL("../", import.meta.url);
const normalizeScript = new URL("../scripts/normalize_ontology.py", import.meta.url).pathname;

async function readJson(pathUrl) {
  return JSON.parse(await readFile(pathUrl, "utf8"));
}

test("ontology directory documents source, generated, and report ownership", async () => {
  const readme = await readFile(new URL("../ontology/README.md", import.meta.url), "utf8");

  assert.match(readme, /spare_mvp\.ontology\.json[\s\S]*canonical source/);
  assert.match(readme, /spare_mvp\.normalized\.json[\s\S]*generated artifact/);
  assert.match(readme, /spare_mvp\.validation\.json[\s\S]*validation report/);
  assert.match(readme, /Do not edit generated files by hand/);
  assert.match(readme, /Simulation-Contract-First Development/);
});

test("checked-in normalized ontology artifacts are regenerated from source", async () => {
  assert.doesNotMatch(normalizeScript, /^\/Users\//);
  await access(normalizeScript);

  const tempDir = await mkdtemp(join(tmpdir(), "spare-mvp-ontology-"));
  const generatedOntology = join(tempDir, "spare_mvp.normalized.json");
  const generatedReport = join(tempDir, "spare_mvp.validation.json");

  await execFileAsync("python3", [
    normalizeScript,
    "--input",
    new URL("../ontology/spare_mvp.ontology.json", import.meta.url).pathname,
    "--output",
    generatedOntology,
    "--report",
    generatedReport,
  ], {
    cwd: repoRoot.pathname,
  });

  assert.deepEqual(
    await readJson(new URL("../ontology/spare_mvp.normalized.json", import.meta.url)),
    await readJson(new URL(`file://${generatedOntology}`))
  );

  const checkedReport = await readJson(new URL("../ontology/spare_mvp.validation.json", import.meta.url));
  const generatedReportJson = await readJson(new URL(`file://${generatedReport}`));
  assert.equal(checkedReport.valid, true);
  assert.deepEqual(
    { ...checkedReport, source: "<repo-local-source>" },
    { ...generatedReportJson, source: "<repo-local-source>" }
  );
});
