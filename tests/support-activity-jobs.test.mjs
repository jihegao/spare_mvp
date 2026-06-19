import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteSupportActivityJobAt,
  deleteSupportActivityJobsAtIndexes,
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
