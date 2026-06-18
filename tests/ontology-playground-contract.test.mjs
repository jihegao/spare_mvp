import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ontologyUrl = new URL("../ontology/spare_mvp.ontology.json", import.meta.url);

test("project ontology is authored as an Ontology Playground style graph", async () => {
  const ontology = JSON.parse(await readFile(ontologyUrl, "utf8"));

  assert.equal(ontology.metadata?.developmentMode, "Simulation-Contract-First Development");
  assert.ok(Array.isArray(ontology.entityTypes));
  assert.ok(Array.isArray(ontology.relationships));
  assert.ok(Array.isArray(ontology.bindings));
  assert.equal(ontology.entityTypes.length, 8);
  assert.equal(ontology.relationships.length, 13);

  for (const entity of ontology.entityTypes) {
    assert.match(entity.id, /^[a-z0-9_-]+$/);
    assert.ok(entity.icon, `${entity.id} should define a Playground icon`);
    assert.match(entity.color, /^#[0-9A-Fa-f]{6}$/, `${entity.id} should define a graph color`);
    assert.ok(
      entity.properties.some((property) => property.isIdentifier),
      `${entity.id} should have an identifier property`
    );
  }

  const entityIds = new Set(ontology.entityTypes.map((entity) => entity.id));
  for (const relationship of ontology.relationships) {
    assert.ok(entityIds.has(relationship.from), `${relationship.id} has missing from entity`);
    assert.ok(entityIds.has(relationship.to), `${relationship.id} has missing to entity`);
    assert.match(relationship.cardinality, /^(one-to-one|one-to-many|many-to-one|many-to-many)$/);
  }

  const boundEntities = new Set(ontology.bindings.map((binding) => binding.boundEntityId));
  for (const entityId of ["mission_profile", "equipment", "support_node", "support_activity", "component"]) {
    assert.ok(boundEntities.has(entityId), `${entityId} should have a data binding`);
  }
});
