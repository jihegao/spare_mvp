import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedSupportActivityDurationDistributions,
  deleteSupportActivityJobAt,
  deleteSupportActivityJobsAtIndexes,
  supportActivityJobFromBasicActivity,
  supportActivityJobs
} from "../front/support-activity-jobs.mjs";

test("support activity jobs distinguish legacy fallback from explicitly empty jobs", () => {
  const legacyActivity = { activityType: "飞行前保障", durationHours: 1.5 };
  const explicitlyEmptyActivity = { activityType: "飞行前保障", jobs: [] };
  const logisticsActivity = { activityType: "后勤保障" };

  assert.deepEqual(supportActivityJobs(legacyActivity), [{
    activityCode: "BA-001",
    workName: "飞行前保障",
    predecessors: [],
    durationMinutes: 90
  }]);
  assert.deepEqual(supportActivityJobs(explicitlyEmptyActivity), []);
  assert.deepEqual(supportActivityJobs(logisticsActivity), []);
});

test("support activity job deletion keeps empty state instead of recreating fallback", () => {
  const activity = {
    activityType: "飞行前保障",
    jobs: [{ activityCode: "BA-101", workName: "机务检查", durationMinutes: 30 }]
  };

  assert.equal(deleteSupportActivityJobAt(activity, 0), true);

  assert.deepEqual(activity.jobs, []);
  assert.deepEqual(supportActivityJobs(activity), []);
});

test("support activity batch deletion removes all selected jobs and preserves empty state", () => {
  const activity = {
    activityType: "预防性维修",
    jobs: [
      { activityCode: "PM-101", workName: "定检准备", durationMinutes: 20 },
      { activityCode: "PM-102", workName: "航电检查", durationMinutes: 40 }
    ]
  };

  assert.equal(deleteSupportActivityJobsAtIndexes(activity, [0, 1]), true);

  assert.deepEqual(activity.jobs, []);
  assert.deepEqual(supportActivityJobs(activity), []);
});

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
    personnel: "航电,2",
    equipment: "检测仪,1",
    spare: "航电模块,1",
    predecessors: ["BA-100"]
  };

  assert.deepEqual(supportActivityJobFromBasicActivity(basicActivity), {
    activityCode: "BA-220",
    workName: "航电通电检查",
    applicableAircraft: "J-15",
    durationProfile: { distributionType: "正态分布", mean: 25, stdDev: 5 },
    durationMinutes: 25,
    personnel: "航电,2",
    equipment: "检测仪,1",
    spare: "航电模块,1",
    predecessors: ["BA-100"]
  });
});
