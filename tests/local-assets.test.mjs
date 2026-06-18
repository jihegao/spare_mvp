import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("local aviation support copy is project-owned and provenance-tagged", async () => {
  const base = new URL("../src/spare_mvp_abm/aviation_support/", import.meta.url);
  for (const file of [
    "model.py",
    "ontology.json",
    "ontology.normalized.json",
    "ontology.report.json",
    "smoke.json",
    "experiment.json",
    "visualization.html",
    "README.md",
    "SOURCE.md"
  ]) {
    await access(new URL(file, base));
  }

  const smoke = JSON.parse(await readFile(new URL("smoke.json", base), "utf8"));
  assert.equal(smoke.parameters.ontology_path, "src/spare_mvp_abm/aviation_support/ontology.json");

  const source = await readFile(new URL("SOURCE.md", base), "utf8");
  assert.match(source, /mesa-abm-skill\/mesa-abm-skill\/assets\/aviation_support/);
});

test("ship_front prototype is copied locally without runtime dependency on home path", async () => {
  const base = new URL("../vendor/ship_front/", import.meta.url);
  for (const file of ["index.html", "app.js", "styles.css", "SOURCE.md"]) {
    await access(new URL(file, base));
  }

  const source = await readFile(new URL("SOURCE.md", base), "utf8");
  assert.match(source, /\/Users\/gaojihe\/Models\/ship_front/);

  const entries = await readdir(new URL("../vendor/", import.meta.url), { recursive: true });
  assert.ok(!entries.some((entry) => String(entry).includes("__pycache__")));
});
