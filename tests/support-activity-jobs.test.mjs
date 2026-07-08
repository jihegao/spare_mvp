import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedSupportActivityDurationDistributions,
  supportActivityJobFromBasicActivity,
} from "../front/support-activity-jobs.mjs";

test("support activity duration distributions are limited to the four shared equipment distributions", () => {
  assert.deepEqual(allowedSupportActivityDurationDistributions(), [
    "固定值",
    "指数分布",
    "正态分布",
    "均匀分布"
  ]);
});

test("support activity jobs can be populated from a basic activity library row", () => {
  const basicActivity = {
    activityCode: "BA-220",
    workName: "航电通电检查",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
    durationMinutes: 25,
    personnel: [{ professional: "航电", quantity: 2 }],
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 1 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 1 }],
    predecessors: ["BA-100"]
  };

  assert.deepEqual(supportActivityJobFromBasicActivity(basicActivity), {
    activityCode: "BA-220",
    workName: "航电通电检查",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
    durationMinutes: 25,
    personnel: [{ professional: "航电", quantity: 2 }],
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 1 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 1 }],
    predecessors: ["BA-100"]
  });
});

test("support activity jobs preserve structured resource requirements from basic activity rows", () => {
  const basicActivity = {
    activityCode: "BA-330",
    workName: "资源配置活动",
    personnelProfessional: "航电",
    personnel: [
      { professional: "航电", quantity: 1 },
      { professional: "机务人员", quantity: 2 }
    ],
    equipmentModel: "TEST-1",
    equipment: [{ model: "TEST-1", name: "检测仪", quantity: 2 }],
    spare: [{ model: "LRU", name: "航电模块", quantity: 3 }]
  };

  const job = supportActivityJobFromBasicActivity(basicActivity);

  assert.equal(job.personnelProfessional, "航电");
  assert.equal(Object.hasOwn(job, "personnelRequirements"), false);
  assert.equal(job.equipmentModel, "TEST-1");
  assert.equal(Object.hasOwn(job, "equipmentRequirements"), false);
  assert.equal(Object.hasOwn(job, "spareRequirements"), false);
  assert.deepEqual(job.personnel, [
    { professional: "航电", quantity: 1 },
    { professional: "机务人员", quantity: 2 }
  ]);
  assert.deepEqual(job.equipment, [{ model: "TEST-1", name: "检测仪", quantity: 2 }]);
  assert.deepEqual(job.spare, [{ model: "LRU", name: "航电模块", quantity: 3 }]);
});
