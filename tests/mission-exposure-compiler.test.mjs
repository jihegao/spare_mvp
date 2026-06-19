import assert from "node:assert/strict";
import test from "node:test";

import { compileMissionExposure } from "../front/mission-exposure-compiler.mjs";
import { createDemoRmsAllocationProject } from "../front/rms-allocation-engine.mjs";

test("mission exposure compiler builds node phase rows and equivalent hours", () => {
  const project = createDemoRmsAllocationProject();
  const childNodes = project.equipmentNodes.filter((node) => node.parentId === project.rootId);
  const exposure = compileMissionExposure(project, childNodes);

  assert.equal(exposure.rows.length, childNodes.length * project.missionPhases.length);
  const propulsionSortie = exposure.rows.find((row) => row.nodeId === "propulsion-system" && row.missionPhaseId === "phase-sortie");
  assert.equal(propulsionSortie.equivalentHours.toFixed(2), "4.14");
  assert.ok(exposure.totalsByNode["propulsion-system"].equivalentHours > exposure.totalsByNode["mission-computer"].equivalentHours);
});
